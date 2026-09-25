#!/usr/bin/env node
/**
 * Consumer hygiene: what in a repository turns a routine upgrade into an
 * incident, each finding with its fix. See lib/hygiene.mjs for the checks.
 *
 * Usage: node hygiene.mjs <repo>... [--json out.json]
 */
import fs from "node:fs";
import path from "node:path";
import { manifests, check } from "./lib/hygiene.mjs";

const args = process.argv.slice(2);
const jsonAt = args.indexOf("--json");
const repos = args.filter((a, i) => !a.startsWith("--") && (jsonAt < 0 || i !== jsonAt + 1));
const report = [];
for (const repo of repos) for (const dir of manifests(repo)) report.push(await check(dir, path.basename(repo)));

const order = { high: 0, medium: 1, low: 2 };
for (const r of report) {
  console.log(`${r.where}${r.findings.length ? "" : "  - clean"}`);
  for (const f of r.findings.sort((a, b) => order[a.severity] - order[b.severity])) {
    console.log(`  [${f.severity.padEnd(6)}] ${f.kind.padEnd(10)} ${f.detail}`);
    console.log(`  ${" ".repeat(20)}fix: ${f.fix}`);
  }
}
const tally = {};
for (const r of report) for (const f of r.findings) tally[f.kind] = (tally[f.kind] ?? 0) + 1;
console.log(`\n${report.length} manifest(s): ${Object.entries(tally).map(([k, n]) => `${k} ${n}`).join(", ") || "no findings"}`);
if (jsonAt >= 0) fs.writeFileSync(args[jsonAt + 1], JSON.stringify(report, null, 1));
