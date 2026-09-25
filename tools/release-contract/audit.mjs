#!/usr/bin/env node
/**
 * Declared vs computed, across a package's real release history.
 *
 * For each package, take the newest patch of consecutive minor lines within a
 * major (and a sample of consecutive patches) and compute what each step
 * actually did to the API. Reports every step where the declared bump
 * understates the change - a "minor" that removed an export - and every step
 * where it overstates it - a "major" that broke nothing.
 *
 * Usage: node audit.mjs <package>[@<major>] ... [--json out.json]
 */
import path from "node:path";
import fs from "node:fs";
import { packument } from "./lib/apidiff.mjs";
import { diffIsolated } from "./lib/isolated.mjs";

const args = process.argv.slice(2);
const jsonAt = args.indexOf("--json");
const outFile = jsonAt >= 0 ? args[jsonAt + 1] : null;
const targets = args.filter((a, i) => !a.startsWith("--") && (jsonAt < 0 || i !== jsonAt + 1));
const root = process.env.RELEASE_CONTRACT_WORK || path.join(process.cwd(), ".work");
const PER_PACKAGE = Number(process.env.AUDIT_STEPS || 10);

const stable = v => /^\d+\.\d+\.\d+$/.test(v);
const parts = v => v.split(".").map(Number);
const cmp = (a, b) => { const x = parts(a), y = parts(b); return x[0] - y[0] || x[1] - y[1] || x[2] - y[2]; };

async function steps(pkg, major) {
  const meta = await packument(pkg);
  const all = Object.keys(meta.versions).filter(stable).sort(cmp);
  const line = major == null ? all : all.filter(v => parts(v)[0] === Number(major));
  // Newest patch of each minor, then consecutive pairs: these are the steps a
  // consumer on a caret range takes automatically.
  const lastOfMinor = new Map();
  for (const v of line) lastOfMinor.set(parts(v).slice(0, 2).join("."), v);
  const minors = [...lastOfMinor.values()];
  const pairs = [];
  for (let i = 1; i < minors.length; i++) pairs.push([minors[i - 1], minors[i]]);
  return pairs.slice(-PER_PACKAGE);
}

const rows = [];
for (const t of targets) {
  const at = t.lastIndexOf("@");
  const [pkg, major] = at > 0 ? [t.slice(0, at), t.slice(at + 1)] : [t, null];
  for (const [a, b] of await steps(pkg, major)) {
    try {
      const d = diffIsolated(pkg, a, b, root);
      if (!d.typed) { rows.push({ pkg, a, b, typed: false }); continue; }
      const row = { pkg, a, b, typed: true, declared: d.declared, computed: d.computed,
        removed: d.removed.filter(x => !x.announced).length, broken: d.broken.length, added: d.added.length,
        review: d.changed.length, unstable: d.unstable.length,
        removedNames: d.removed.slice(0, 6).map(x => x.name),
        brokenNames: d.broken.slice(0, 6).map(x => `${x.name}${x.members?.length ? " (" + x.members.slice(0, 3).join(", ") + ")" : ""}`),
        causes: (d.causes ?? []).map(c => c.what),
        remedies: {
          renamedExports: Object.values(d.remedies?.exports ?? {}).filter(x => x.to).length,
          unreplacedExports: Object.values(d.remedies?.exports ?? {}).filter(x => !x.to).length,
          enumRenames: d.remedies?.enumMembers?.length ?? 0,
          memberMoves: d.remedies?.members?.length ?? 0,
        },
        understated: d.understated,
        overstated: d.declared === "major" && d.computed !== "major" };
      rows.push(row);
      const flag = row.understated ? (row.removed ? "UNDERSTATED (removed)" : "understated (types)") : row.overstated ? "overstated" : "";
      console.log(`${pkg.padEnd(16)} ${a.padEnd(9)} -> ${b.padEnd(9)} declared ${d.declared.padEnd(5)} computed ${d.computed.padEnd(5)} ` +
        `-${String(row.removed).padStart(3)} !${String(row.broken).padStart(3)} +${String(row.added).padStart(4)}  ${flag}`);
    } catch (e) {
      rows.push({ pkg, a, b, typed: false, error: String(e.message).slice(0, 120) });
      console.log(`${pkg.padEnd(16)} ${a} -> ${b}  skipped: ${String(e.message).slice(0, 80)}`);
    }
  }
}
if (outFile) fs.writeFileSync(outFile, JSON.stringify(rows, null, 1));
const typed = rows.filter(r => r.typed);
const nonMajor = typed.filter(r => r.declared !== "major");
const under = nonMajor.filter(r => r.understated);
console.log(`\n${typed.length} typed steps · ${nonMajor.length} declared minor/patch · ` +
  `${under.length} understated (${under.filter(r => r.removed).length} by removing exports, ` +
  `${under.filter(r => !r.removed).length} by incompatible type changes only)`);
