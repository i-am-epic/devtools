#!/usr/bin/env node
/**
 * Migrate a consumer across a release, using fixes read out of the package
 * itself (see lib/remedy.mjs) - no changelog, no guessing.
 *
 * Usage: node fix.mjs <repo-dir> <package> <to> [--from <version>] [--apply] [--json out.json]
 *
 * Without --apply it prints the plan. With --apply it makes the edits; run the
 * repo's own type-check and tests afterwards, as with any change.
 */
import fs from "node:fs";
import path from "node:path";
import { packument } from "./lib/apidiff.mjs";
import { diffIsolated } from "./lib/isolated.mjs";
import { plan, apply } from "./lib/migrate.mjs";
import { reachability, siteIsLive } from "./lib/reach.mjs";
import { manifestsUsing, lockedVersion, resolveRange } from "./lib/resolve.mjs";

const args = process.argv.slice(2);
const opt = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const positional = args.filter((a, i) => !a.startsWith("--") && !["--from", "--json"].includes(args[i - 1]));
const [repo, pkg, to] = positional;
if (!repo || !pkg || !to) {
  console.error("usage: fix <repo-dir> <package> <to> [--from <version>] [--apply] [--json out.json]");
  process.exit(2);
}
const root = process.env.RELEASE_CONTRACT_WORK || path.join(process.cwd(), ".work");

let from = opt("--from");
let dir = repo;
if (!from) {
  const m = manifestsUsing(repo, pkg)[0];
  if (!m) { console.error(`${pkg} is not a dependency of ${repo}`); process.exit(1); }
  dir = m.dir;
  const meta = await packument(pkg);
  from = lockedVersion(m.dir, pkg)?.version ?? resolveRange(Object.keys(meta.versions), m.spec, meta["dist-tags"]?.latest);
}
const diff = diffIsolated(pkg, from, to, root);
if (!diff.typed) { console.log(`${pkg} ${from} -> ${to}: ${diff.reason}`); process.exit(0); }
const reach = reachability(dir);
const p = plan(dir, pkg, diff, { isLive: site => siteIsLive(reach, site) });

console.log(`${path.basename(dir)} × ${pkg} ${from} -> ${to}\n`);
console.log(`automatic (${p.edits.length}) - derived from the package's own declarations:`);
for (const e of p.edits) console.log(`  ${e.site.padEnd(34)} ${e.from}  ->  ${e.to}\n  ${" ".repeat(34)} ${e.why}`);
if (p.silent.length) {
  console.log(`\nsilent (${p.silent.length}) - compiles today, stops matching after the upgrade:`);
  for (const s of p.silent) console.log(`  ${s.site.padEnd(34)} "${s.value}" is now ${s.enum}.${s.member} = "${s.now}"`);
}
if (p.dynamic.length) {
  console.log(`\ndynamic (${p.dynamic.length}) - lookups by runtime key into a map that renamed keys:`);
  for (const d of p.dynamic) console.log(`  ${d.site.padEnd(34)} ${d.owner}[...]: ${d.keys.slice(0, 4).join(", ")}${d.keys.length > 4 ? ` and ${d.keys.length - 4} more` : ""}`);
}
if (p.manual.length) {
  console.log(`\nmanual (${p.manual.length}) - removed, and the package names no replacement:`);
  for (const m of p.manual) {
    console.log(`  ${m.name.padEnd(20)} ${m.sites.slice(0, 3).join(", ")}${m.live ? "" : "  (dead code)"}`);
    if (m.note) console.log(`  ${" ".repeat(20)} owner's note: ${m.note.slice(0, 160)}`);
  }
}
if (p.deadFiles.length) console.log(`\ndead code: nothing imports ${p.deadFiles.join(", ")} - deleting it is the whole fix`);
if (!p.edits.length && !p.silent.length && !p.dynamic.length && !p.manual.length) console.log("nothing to change");

if (args.includes("--apply") && p.edits.length) {
  const touched = apply(dir, p.edits);
  console.log(`\napplied ${p.edits.length} edit(s) to ${touched.length} file(s). Run the repo's type-check and tests.`);
}
const out = opt("--json");
if (out) fs.writeFileSync(out, JSON.stringify({ package: pkg, from, to, ...p }, null, 1));
