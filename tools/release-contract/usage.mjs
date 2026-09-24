#!/usr/bin/env node
/** Usage: node usage.mjs <repo-dir> [package ...] */
import { indexRepo } from "./lib/usage.mjs";
const [root, ...pkgs] = process.argv.slice(2);
const uses = indexRepo(root, pkgs.length ? { only: new Set(pkgs) } : {});
for (const [pkg, syms] of Object.entries(uses).sort()) {
  const n = Object.values(syms).reduce((a, l) => a + l.length, 0);
  console.log(`${pkg}  (${Object.keys(syms).length} symbols, ${n} sites)`);
  for (const [s, locs] of Object.entries(syms).sort()) console.log(`    ${s.padEnd(26)} ${locs.length}x  ${locs.slice(0, 3).join(", ")}${locs.length > 3 ? " …" : ""}`);
}
