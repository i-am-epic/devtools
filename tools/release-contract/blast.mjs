#!/usr/bin/env node
/** Usage: node blast.mjs <repo-dir> <package> <from> <to> */
import path from "node:path";
import { diff } from "./lib/apidiff.mjs";
import { indexRepo } from "./lib/usage.mjs";
import { blast, liveness } from "./lib/blast.mjs";
import { reachability, siteIsLive } from "./lib/reach.mjs";

const [repo, pkg, from, to] = process.argv.slice(2);
if (!repo || !pkg || !from || !to) { console.error("usage: blast <repo-dir> <package> <from> <to>"); process.exit(2); }
const root = process.env.RELEASE_CONTRACT_WORK || path.join(process.cwd(), ".work");
const d = await diff(pkg, from, to, { root });
if (!d.typed) { console.log(`${pkg} ${from} -> ${to}: ${d.reason} - build it`); process.exit(0); }
const uses = indexRepo(repo, { only: new Set([pkg]) })[pkg];
const reach = reachability(repo);
const b = liveness(blast(d, uses), site => siteIsLive(reach, site));
const at = x => [...x.live, ...x.dead.map(s => `${s} (dead code)`)].slice(0, 3).join(", ");
console.log(`${path.basename(repo)} × ${pkg} ${from} -> ${to}`);
console.log(`  release: declared ${d.declared}, computed ${d.computed} — ${d.removed.length} removed, ${d.broken.length} incompatible of ${d.exports.old}`);
console.log(`  consumer uses ${b.used} symbol(s): ${b.breaks.length} break, ${b.typeRisk.length} type-risk, ${b.untouched} untouched`);
for (const x of b.breaks) console.log(`    BREAK ${x.name}: ${x.why}  @ ${at(x)}`);
for (const x of b.typeRisk) console.log(`    TYPE  ${x.name}: ${x.why}  @ ${at(x)}`);
console.log(`  verdict: ${b.verdict.toUpperCase()}`);
