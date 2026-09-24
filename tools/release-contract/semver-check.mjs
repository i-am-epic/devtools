#!/usr/bin/env node
/** Usage: node semver-check.mjs <package> <from> <to> [--json] */
import path from "node:path";
import { diff } from "./lib/apidiff.mjs";

const [pkg, from, to] = process.argv.slice(2).filter(a => !a.startsWith("--"));
if (!pkg || !from || !to) { console.error("usage: semver-check <package> <from> <to> [--json]"); process.exit(2); }
const root = process.env.RELEASE_CONTRACT_WORK || path.join(process.cwd(), ".work");
const r = await diff(pkg, from, to, { root });
if (process.argv.includes("--json")) { console.log(JSON.stringify(r, null, 1)); process.exit(0); }
if (!r.typed) { console.log(`${pkg} ${from} -> ${to}: ${r.reason}`); process.exit(0); }
console.log(`${pkg} ${from} -> ${to}`);
console.log(`  declared ${r.declared.padEnd(6)} computed ${r.computed}${r.understated ? "   <- UNDERSTATED" : ""}`);
console.log(`  exports ${r.exports.old} -> ${r.exports.new}: removed ${r.removed.length}, broken ${r.broken.length}, review ${r.changed.length}, unstable ${r.unstable.length}, added ${r.added.length}, widened ${r.widened.length}, unchanged ${r.unchanged}, unknown ${r.unknown.length}`);
for (const x of r.removed.slice(0, 8)) console.log(`    - removed ${x.kind} ${x.name}`);
for (const x of r.broken.slice(0, 8)) console.log(`    ! broken  ${x.kind} ${x.name}: ${x.why}`);
for (const x of r.changed.slice(0, 4)) console.log(`    ? review  ${x.kind} ${x.name}: ${x.why}`);
if (r.causes?.length) {
  console.log(`  root causes (${r.causes.length}) behind ${r.broken.length} incompatible export(s):`);
  for (const c of r.causes.slice(0, 8)) console.log(`    * ${c.what}   [${c.exports} export(s), e.g. ${c.example}]`);
}
