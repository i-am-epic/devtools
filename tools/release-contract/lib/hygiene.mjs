#!/usr/bin/env node
/**
 * Consumer hygiene: the things in a repository that turn a routine upgrade into
 * an incident, or hide one until production. Each finding comes with its fix.
 *
 *   floating    a spec such as "latest" or "*": any fresh install can jump majors
 *   lockfiles   none at all, one out of sync with package.json (npm ci refuses
 *               it), or two that disagree about what is installed
 *   ungated     a build that never type-checks, so an incompatible upgrade
 *               ships and fails at runtime instead
 *   dead        files no entry point reaches that still import packages; every
 *               upgrade "breaks" them and nobody runs them
 *   unused      runtime dependencies nothing imports: scanner findings, upgrade
 *               PRs and review time spent on code that never runs
 *   deprecated  installed versions the package's owner has marked deprecated
 */
import fs from "node:fs";
import path from "node:path";
import { packument } from "./apidiff.mjs";
import { indexRepo, sourceFiles } from "./usage.mjs";
import { reachability } from "./reach.mjs";
import { lockedVersion } from "./resolve.mjs";

const SKIP = new Set(["node_modules", ".git", "dist", "build", "out", ".next", "vendor", "coverage"]);
// Used by a framework, a CLI or a config file rather than imported from code.
const IMPLICIT = /^(next|react-dom|typescript|tailwindcss|postcss|autoprefixer|eslint.*|prettier.*|@types\/.*|vite|@vitejs\/.*|sharp|prisma|@prisma\/.*|tailwindcss-animate|@tailwindcss\/.*|@angular\/.*|tslib|zone\.js)$/;
const LOCKFILES = ["package-lock.json", "pnpm-lock.yaml", "yarn.lock", "bun.lockb", "bun.lock"];

export function manifests(root, depth = 3) {
  const out = [];
  const walk = (dir, d) => {
    if (fs.existsSync(path.join(dir, "package.json"))) out.push(dir);
    if (d >= depth) return;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory() && !SKIP.has(e.name) && !e.name.startsWith(".")) walk(path.join(dir, e.name), d + 1);
    }
  };
  walk(root, 0);
  return out;
}

const read = f => { try { return fs.readFileSync(f, "utf8"); } catch { return ""; } };
const packuments = new Map();
async function deprecation(pkg, version) {
  if (!packuments.has(pkg)) packuments.set(pkg, packument(pkg).catch(() => null));
  const meta = await packuments.get(pkg);
  const flagged = meta?.versions?.[version]?.deprecated;
  if (flagged) return { note: flagged, where: "npm deprecated field" };
  // Owners often announce the end only in prose: npm's field stays empty and
  // every scanner reads the package as healthy.
  const readme = (meta?.readme ?? "").slice(0, 4000);
  const m = readme.match(/[^.\n]*\b(?:is (?:now )?(?:considered )?(?:legacy|deprecated)|no longer (?:maintained|supported)|end[- ]of[- ](?:life|support))\b[^.\n]*/i);
  return m ? { note: m[0].replace(/[*_`]/g, "").trim(), where: "README only" } : null;
}

export async function check(dir, repoName, { online = true } = {}) {
  const findings = [];
  const add = (kind, severity, detail, fix) => findings.push({ kind, severity, detail, fix });
  const manifest = JSON.parse(read(path.join(dir, "package.json")) || "{}");
  const deps = manifest.dependencies ?? {}, dev = manifest.devDependencies ?? {};
  const where = path.basename(dir) === repoName ? repoName : `${repoName}/${path.basename(dir)}`;

  for (const [name, spec] of Object.entries({ ...dev, ...deps })) {
    if (/^(latest|\*|x|)$/.test(String(spec).trim()) || /^>=?\s*\d/.test(spec)) {
      add("floating", deps[name] ? "high" : "medium", `${name}: "${spec}"`,
          `pin a range (e.g. "^${"<current>"}") so a fresh install can't jump a major`);
    }
  }

  const locks = LOCKFILES.filter(f => fs.existsSync(path.join(dir, f)));
  if (!locks.length) add("lockfiles", "high", "no lockfile", "commit one; without it every install resolves ranges afresh");
  if (locks.length > 1) {
    const disagree = Object.keys(deps).map(n => [n, lockedVersion(dir, n)]).filter(([, l]) => l?.note);
    add("lockfiles", "high", `${locks.join(" + ")}${disagree.length ? `; they disagree on ${disagree.length} package(s), e.g. ${disagree[0][0]}: ${disagree[0][1].note}` : ""}`,
        "keep the lockfile your deploy actually uses and delete the other");
  }
  if (locks.includes("package-lock.json")) {
    const stale = Object.keys(deps).map(n => lockedVersion(dir, n)).find(l => l?.note?.includes("package-lock.json is out of sync")
      || l?.note?.includes("package-lock.json (out of sync)"));
    if (stale) add("lockfiles", "high", "package-lock.json is out of sync with package.json; npm ci refuses it",
                   "run npm install once and commit the result");
  }

  const nextConfig = ["next.config.js", "next.config.mjs", "next.config.ts"].map(f => read(path.join(dir, f))).join("\n");
  if (/ignoreBuildErrors\s*:\s*true/.test(nextConfig)) {
    add("ungated", "high", "next.config sets typescript.ignoreBuildErrors: true",
        "remove it, or run `tsc --noEmit` as a CI step; otherwise an incompatible upgrade builds and fails at runtime");
  }
  const build = manifest.scripts?.build ?? "";
  if (fs.existsSync(path.join(dir, "tsconfig.json")) && /\bvite\b/.test(build) && !/\b(tsc|vue-tsc)\b/.test(build)) {
    add("ungated", "high", `build script "${build}" never type-checks (vite does not)`,
        'make it "tsc --noEmit && vite build"');
  }

  const uses = indexRepo(dir);
  const reach = reachability(dir);
  if (reach.known) {
    const dead = [...sourceFiles(dir)].map(f => path.relative(dir, f).split(path.sep).join("/"))
      .filter(f => !reach.reachable.has(f))
      .filter(f => Object.values(uses).some(syms => Object.values(syms).some(sites => sites.some(s => s.startsWith(f + ":")))));
    if (dead.length) add("dead", "medium", `${dead.length} file(s) no entry point reaches still import packages: ${dead.slice(0, 4).join(", ")}${dead.length > 4 ? ", ..." : ""}`,
                         "delete them; each upgrade otherwise 'breaks' code nothing runs");
  }

  const scripts = JSON.stringify(manifest.scripts ?? {});
  const configText = [...sourceFiles(dir)].filter(f => /\.config\.|\.css$/.test(f)).map(read).join("\n")
    + [...fs.readdirSync(dir)].filter(f => /\.css$|\.config\.|^angular\.json$/.test(f)).map(f => read(path.join(dir, f))).join("\n");
  const unused = Object.keys(deps).filter(n => !uses[n] && !IMPLICIT.test(n) && !scripts.includes(n) && !configText.includes(n));
  if (unused.length) add("unused", "low", `${unused.length} runtime dependenc${unused.length > 1 ? "ies" : "y"} never imported: ${unused.slice(0, 6).join(", ")}${unused.length > 6 ? ", ..." : ""}`,
                         "remove them; every scanner finding and upgrade PR on them is pure cost");

  for (const name of online ? Object.keys(deps) : []) {
    const v = lockedVersion(dir, name)?.version;
    if (!v) continue;
    const d = await deprecation(name, v);
    if (d) add("deprecated", "high", `${name}@${v} (${d.where}): ${d.note.slice(0, 140)}`,
               "migrate off it; deprecated packages stop getting security fixes");
  }
  return { where, findings };
}
