#!/usr/bin/env node
/**
 * The break catalogue: across a set of audited releases, which kinds of change
 * caused the incompatibilities, how often, and the fix for each on both sides.
 *
 * Usage: node catalogue.mjs <audit.json>... [--markdown]
 */
import fs from "node:fs";
import { classify, KINDS } from "./lib/classify.mjs";

const files = process.argv.slice(2).filter(a => !a.startsWith("--"));
const rows = files.flatMap(f => JSON.parse(fs.readFileSync(f, "utf8"))).filter(r => r.typed);
const breaking = rows.filter(r => r.computed === "major" && r.declared !== "major");

const kinds = new Map();
for (const r of breaking) {
  for (const [kind, causes] of Object.entries(classify(r.causes ?? []))) {
    const k = kinds.get(kind) ?? { releases: [], causes: 0, example: null };
    k.releases.push(`${r.pkg}@${r.b}`);
    k.causes += causes.length;
    k.example ??= `${r.pkg} ${r.b}: ${causes[0].slice(0, 90)}`;
    kinds.set(kind, k);
  }
}
const ranked = [...kinds.entries()].sort((a, b) => b[1].releases.length - a[1].releases.length);
const remedied = rows.reduce((a, r) => a + (r.remedies ? r.remedies.renamedExports + r.remedies.enumRenames + r.remedies.memberMoves : 0), 0);
const unreplaced = rows.reduce((a, r) => a + (r.remedies?.unreplacedExports ?? 0), 0);

if (process.argv.includes("--markdown")) {
  console.log(`| Kind of break | Releases (of ${breaking.length}) | Example | Consumer fix | Owner prevention |`);
  console.log("|---|---|---|---|---|");
  for (const [kind, k] of ranked) {
    const d = KINDS[kind];
    console.log(`| ${d.label} | ${k.releases.length} | ${k.example.replace(/\|/g, "\\|")} | ${d.consumer} | ${d.owner} |`);
  }
} else {
  console.log(`${rows.length} releases audited, ${breaking.length} declared minor/patch but computed major\n`);
  for (const [kind, k] of ranked) {
    const d = KINDS[kind];
    console.log(`${d.label}: ${k.releases.length} release(s), ${k.causes} root cause(s)`);
    console.log(`  e.g. ${k.example}`);
    console.log(`  consumer: ${d.consumer}`);
    console.log(`  owner:    ${d.owner}\n`);
  }
}
console.log(`\nrenames and removals the package itself resolves: ${remedied}; removals with no named replacement: ${unreplaced}`);
