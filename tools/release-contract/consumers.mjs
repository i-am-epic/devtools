#!/usr/bin/env node
/**
 * The owner's view of a release: before publishing <package>@<to>, which
 * consumers does it break, where, and which are untouched?
 *
 * Each consumer is compared from the version it actually runs (its lockfile),
 * not from the previous release, because a consumer three minors behind takes
 * all three at once. The result is the consumer section of a release manifest.
 *
 * Usage: node consumers.mjs <package> <to> <repo-dir>... [--json out.json]
 */
import fs from "node:fs";
import path from "node:path";
import { packument } from "./lib/apidiff.mjs";
import { diffIsolated } from "./lib/isolated.mjs";
import { indexRepo } from "./lib/usage.mjs";
import { blast, liveness } from "./lib/blast.mjs";
import { reachability, siteIsLive } from "./lib/reach.mjs";
import { manifestsUsing, lockedVersion, resolveRange } from "./lib/resolve.mjs";

const args = process.argv.slice(2);
const jsonAt = args.indexOf("--json");
const outFile = jsonAt >= 0 ? args[jsonAt + 1] : null;
const [pkg, to, ...repos] = args.filter((a, i) => !a.startsWith("--") && (jsonAt < 0 || i !== jsonAt + 1));
if (!pkg || !to || !repos.length) {
  console.error("usage: consumers <package> <to> <repo-dir>... [--json out.json]");
  process.exit(2);
}
const root = process.env.RELEASE_CONTRACT_WORK || path.join(process.cwd(), ".work");
const meta = await packument(pkg);
const versions = Object.keys(meta.versions);

const diffs = new Map();
const diffFrom = from => {
  if (!diffs.has(from)) diffs.set(from, diffIsolated(pkg, from, to, root));
  return diffs.get(from);
};

const rows = [];
for (const repo of repos) {
  const found = manifestsUsing(repo, pkg);
  if (!found.length) { rows.push({ repo: path.basename(repo), verdict: "not a consumer" }); continue; }
  for (const m of found) {
    const where = path.relative(repo, m.dir) || ".";
    const locked = lockedVersion(m.dir, pkg);
    const from = locked?.version ?? resolveRange(versions, m.spec, meta["dist-tags"]?.latest);
    const row = { repo: path.basename(repo), manifest: where, spec: m.spec, from,
                  pinnedBy: locked?.source ?? "range (no lockfile)", lockNote: locked?.note };
    rows.push(row);
    if (!from) { row.verdict = "unresolved"; continue; }
    if (from === to) { row.verdict = "already there"; continue; }
    const uses = indexRepo(m.dir, { only: new Set([pkg]) })[pkg] ?? {};
    const symbols = Object.keys(uses).filter(s => !s.startsWith("("));
    if (!symbols.length) {
      // Declared but never imported: the release cannot break it, and the
      // dependency itself is a candidate for removal.
      row.verdict = "unused dependency";
      continue;
    }
    const d = diffFrom(from);
    if (!d.typed) { row.verdict = "untyped - build it"; continue; }
    const reach = reachability(m.dir);
    const b = liveness(blast(d, uses), site => siteIsLive(reach, site));
    Object.assign(row, {
      entryPoints: reach.known ? reach.entries.length : "unknown - all files treated as live",
      declared: d.declared, computed: d.computed, verdict: b.verdict, used: b.used,
      releaseRemoved: d.removed.length, releaseBroken: d.broken.length,
      breaks: b.breaks.map(x => ({ name: x.name, why: x.why, live: x.live.slice(0, 5), dead: x.dead.slice(0, 5) })),
      typeRisk: b.typeRisk.map(x => ({ name: x.name, why: x.why, live: x.live.slice(0, 5), dead: x.dead.slice(0, 5) })),
    });
  }
}

console.log(`${pkg}@${to} — consumer impact before publish\n`);
for (const r of rows) {
  const head = `${(r.repo + (r.manifest && r.manifest !== "." ? "/" + r.manifest : "")).padEnd(22)}`;
  const note = () => r.lockNote && console.log(`${" ".repeat(24)}note: pinned by ${r.pinnedBy}; ${r.lockNote}`);
  if (!r.declared) { console.log(`${head} ${(r.from ?? "").padEnd(9)} ${r.verdict}`); note(); continue; }
  console.log(`${head} ${r.from.padEnd(9)} declared ${r.declared.padEnd(5)} computed ${r.computed.padEnd(5)} ` +
    `release: -${r.releaseRemoved} !${r.releaseBroken}  uses ${String(r.used).padStart(3)}  → ${r.verdict.toUpperCase()}`);
  const at = x => [...x.live.slice(0, 3), ...x.dead.slice(0, 3).map(s => `${s} (dead code)`)].slice(0, 3).join(", ");
  for (const x of r.breaks) console.log(`${" ".repeat(24)}BREAK ${x.name}: ${x.why} @ ${at(x)}`);
  for (const x of r.typeRisk) console.log(`${" ".repeat(24)}TYPE  ${x.name}: ${x.why} @ ${at(x)}`);
  if (r.verdict === "breaks dead code") {
    const files = [...new Set(r.breaks.flatMap(x => x.dead).map(s => s.replace(/:\d+$/, "")))];
    console.log(`${" ".repeat(24)}no entry point imports ${files.join(", ")}: a full type-check fails, the build does not; migration is deletion`);
  }
  note();
}
const counted = rows.filter(r => r.declared);
const tally = v => counted.filter(r => r.verdict === v).length;
console.log(`\n${counted.length} consumer(s) checked: ${tally("breaks")} break, ${tally("breaks dead code")} break only dead code, ` +
  `${tally("type-check")} need a type-check, ${tally("safe")} safe` +
  `; ${rows.filter(r => r.verdict === "unused dependency").length} declare it without importing it`);
if (outFile) fs.writeFileSync(outFile, JSON.stringify({ package: pkg, to, consumers: rows }, null, 1));
