/**
 * Which version of a package a consumer actually runs.
 *
 * The lockfile decides, never the manifest: "^0.447.0" in package.json says what
 * the consumer would accept, not what it installed. Without a lockfile the range
 * is resolved the way npm would resolve it today, and the result says so.
 */
import fs from "node:fs";
import path from "node:path";

const SKIP = new Set(["node_modules", ".git", "dist", "build", "out", ".next", "vendor", "coverage"]);

/** Every directory under root (to a small depth) whose package.json names pkg. */
export function manifestsUsing(root, pkg, depth = 3) {
  const out = [];
  const walk = (dir, d) => {
    const pj = path.join(dir, "package.json");
    if (fs.existsSync(pj)) {
      try {
        const m = JSON.parse(fs.readFileSync(pj, "utf8"));
        const spec = m.dependencies?.[pkg] ?? m.devDependencies?.[pkg] ?? m.peerDependencies?.[pkg];
        if (spec) out.push({ dir, spec, dev: !m.dependencies?.[pkg] && Boolean(m.devDependencies?.[pkg]) });
      } catch { /* unreadable manifest: not a consumer we can reason about */ }
    }
    if (d >= depth) return;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory() && !SKIP.has(e.name) && !e.name.startsWith(".")) walk(path.join(dir, e.name), d + 1);
    }
  };
  walk(root, 0);
  return out;
}

/**
 * A package-lock.json whose root entry no longer matches package.json is stale:
 * `npm ci` refuses it, so whatever installs this project is using something
 * else. portfolio has one of these next to a pnpm-lock.yaml that disagrees.
 */
function npmLockInSync(lock, manifest) {
  const root = lock.packages?.[""];
  if (!root || !manifest) return true;
  for (const field of ["dependencies", "devDependencies"]) {
    const want = manifest[field] ?? {}, have = root[field] ?? {};
    const keys = new Set([...Object.keys(want), ...Object.keys(have)]);
    for (const k of keys) if (want[k] !== have[k]) return false;
  }
  return true;
}

function fromNpm(dir, pkg) {
  const file = path.join(dir, "package-lock.json");
  if (!fs.existsSync(file)) return null;
  const lock = JSON.parse(fs.readFileSync(file, "utf8"));
  const version = lock.packages?.[`node_modules/${pkg}`]?.version ?? lock.dependencies?.[pkg]?.version;
  if (!version) return null;
  let manifest = null;
  try { manifest = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8")); } catch { /* none */ }
  return { version, source: "package-lock.json", stale: !npmLockInSync(lock, manifest) };
}

function fromPnpm(dir, pkg) {
  const file = path.join(dir, "pnpm-lock.yaml");
  if (!fs.existsSync(file)) return null;
  const text = fs.readFileSync(file, "utf8");
  const esc = pkg.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
  const m = text.match(new RegExp(`\\n\\s+'?${esc}'?:\\n\\s+specifier: [^\\n]+\\n\\s+version: ([0-9][^\\s(]*)`));
  return m ? { version: m[1], source: "pnpm-lock.yaml" } : null;
}

function fromYarn(dir, pkg) {
  const file = path.join(dir, "yarn.lock");
  if (!fs.existsSync(file)) return null;
  const text = fs.readFileSync(file, "utf8");
  const esc = pkg.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
  const m = text.match(new RegExp(`\\n"?${esc}@[^\\n]*:\\n\\s+version "?([^"\\n]+)"?`));
  return m ? { version: m[1], source: "yarn.lock" } : null;
}

/**
 * The version the lockfile pins. When lockfiles disagree, an in-sync one wins
 * over a stale one, and the result records the disagreement.
 */
export function lockedVersion(dir, pkg) {
  const found = [fromNpm(dir, pkg), fromPnpm(dir, pkg), fromYarn(dir, pkg)].filter(Boolean);
  if (!found.length) return null;
  const pick = found.find(f => !f.stale) ?? found[0];
  const others = found.filter(f => f !== pick && f.version !== pick.version);
  const notes = [];
  if (pick.stale) notes.push(`${pick.source} is out of sync with package.json`);
  for (const o of others) notes.push(`${o.source}${o.stale ? " (out of sync)" : ""} says ${o.version}`);
  return { version: pick.version, source: pick.source, note: notes.join("; ") || undefined };
}

const parts = v => v.split(/[.+-]/).slice(0, 3).map(Number);
const cmp = (a, b) => { const x = parts(a), y = parts(b); return x[0] - y[0] || x[1] - y[1] || x[2] - y[2]; };
const stable = v => /^\d+\.\d+\.\d+$/.test(v);

/** The subset of npm range syntax that manifests actually use. */
export function satisfies(v, spec) {
  spec = spec.trim();
  if (spec === "*" || spec === "" || spec === "latest") return true;
  const m = spec.match(/^([~^]|>=)?\s*v?(\d+)(?:\.(\d+|x|\*))?(?:\.(\d+|x|\*))?/);
  if (!m) return false;
  const [, op, M, mi, pa] = m;
  const want = [Number(M), mi == null || /[x*]/.test(mi) ? null : Number(mi), pa == null || /[x*]/.test(pa) ? null : Number(pa)];
  const [a, b, c] = parts(v);
  const floor = [want[0], want[1] ?? 0, want[2] ?? 0];
  const atLeast = cmp(v, floor.join(".")) >= 0;
  if (op === ">=") return atLeast;
  if (op === "^") {
    if (!atLeast) return false;
    if (want[0] !== 0) return a === want[0];
    if ((want[1] ?? 0) !== 0 || want[1] == null) return a === 0 && (want[1] == null || b === want[1]);
    return a === 0 && b === 0 && (want[2] == null || c === want[2]);
  }
  if (op === "~") return atLeast && a === want[0] && (want[1] == null || b === want[1]);
  return a === want[0] && (want[1] == null || b === want[1]) && (want[2] == null || c === want[2]);
}

export function resolveRange(versions, spec, latest) {
  if (spec === "latest" || spec === "*") return latest;
  const hits = versions.filter(v => stable(v) && satisfies(v, spec)).sort(cmp);
  return hits.at(-1) ?? null;
}
