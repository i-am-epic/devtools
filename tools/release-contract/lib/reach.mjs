/**
 * Which source files can actually run.
 *
 * A usage site in a file that no entry point imports is still a usage - a
 * type-check over the whole project will fail on it - but it cannot break the
 * running product. portfolio's components/footer.tsx imports four icons that
 * lucide-react 1.0 removed; nothing imports footer.tsx, so `tsc` fails and
 * `next build` passes. The difference decides the fix: migrate the call site,
 * or delete the file.
 *
 * Entry points are recognised by framework convention (Next.js app and pages
 * routers, a Vite index.html, package.json entry fields, tests, config files).
 * When none is recognised, every file is assumed reachable.
 */
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { sourceFiles } from "./usage.mjs";

const NEXT_APP = /(^|\/)(src\/)?app\/(.+\/)?(page|layout|template|route|loading|error|global-error|not-found|default|opengraph-image|twitter-image|icon|apple-icon|sitemap|robots|manifest)\.(m|c)?(j|t)sx?$/;
const NEXT_PAGES = /(^|\/)(src\/)?pages\/.+\.(m|c)?(j|t)sx?$/;
const ROOT_ENTRY = /^(src\/)?(main|index|app|server|middleware|proxy|instrumentation)\.(m|c)?(j|t)sx?$/;
const TEST = /(\.|\/)(test|spec)\.(m|c)?(j|t)sx?$|(^|\/)(tests?|__tests__|e2e)\//;
const CONFIG = /^[^/]+\.config\.(m|c)?(j|t)s$/;
const SCRIPT = /^scripts\//;
const SOURCE = /\.(m|c)?(j|t)sx?$/;
const EXTS = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"];

function aliases(root) {
  for (const name of ["tsconfig.json", "jsconfig.json"]) {
    const file = path.join(root, name);
    if (!fs.existsSync(file)) continue;
    const { config } = ts.readConfigFile(file, f => fs.readFileSync(f, "utf8"));
    const opts = config?.compilerOptions ?? {};
    const base = path.resolve(root, opts.baseUrl ?? ".");
    return Object.entries(opts.paths ?? {}).map(([from, [to]]) => ({
      prefix: from.replace(/\*$/, ""), wildcard: from.endsWith("*"),
      target: path.resolve(base, to.replace(/\*$/, "")),
    }));
  }
  return [];
}

function resolveFile(candidate) {
  if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  // import "./x.js" may name a .ts source under TypeScript's resolution.
  const stem = candidate.replace(/\.(m|c)?js$/, "");
  for (const ext of EXTS) if (fs.existsSync(stem + ext)) return stem + ext;
  for (const ext of EXTS) {
    const idx = path.join(candidate, "index" + ext);
    if (fs.existsSync(idx)) return idx;
  }
  return null;
}

function specifiers(file) {
  const text = fs.readFileSync(file, "utf8");
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true,
    /\.tsx$|\.jsx$|\.js$/.test(file) ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const out = [];
  const visit = node => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node))
        && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) out.push(node.moduleSpecifier.text);
    if (ts.isCallExpression(node) && node.arguments[0] && ts.isStringLiteralLike(node.arguments[0])
        && (node.expression.kind === ts.SyntaxKind.ImportKeyword
            || (ts.isIdentifier(node.expression) && node.expression.text === "require"))) {
      out.push(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

function htmlEntries(root) {
  const html = path.join(root, "index.html");
  if (!fs.existsSync(html)) return [];
  const text = fs.readFileSync(html, "utf8");
  return [...text.matchAll(/<script[^>]+src=["']([^"']+)["']/g)]
    .map(m => resolveFile(path.join(root, m[1].replace(/^\//, "")))).filter(Boolean);
}

function manifestEntries(root) {
  try {
    const m = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
    const strings = [];
    const collect = v => typeof v === "string" ? strings.push(v)
      : v && typeof v === "object" ? Object.values(v).forEach(collect) : null;
    [m.main, m.module, m.browser, m.bin, m.exports].forEach(collect);
    return strings.map(s => resolveFile(path.resolve(root, s))).filter(Boolean);
  } catch { return []; }
}

export function reachability(root) {
  const files = [...sourceFiles(root)];
  const rel = f => path.relative(root, f).split(path.sep).join("/");
  const entries = new Set([
    ...files.filter(f => {
      const r = rel(f);
      return NEXT_APP.test(r) || NEXT_PAGES.test(r) || ROOT_ENTRY.test(r) || TEST.test(r) || CONFIG.test(r) || SCRIPT.test(r);
    }),
    ...htmlEntries(root), ...manifestEntries(root),
  ]);
  if (!entries.size) return { known: false, entries: [], reachable: new Set(files.map(rel)) };

  const alias = aliases(root);
  const resolve = (from, spec) => {
    if (spec.startsWith(".")) return resolveFile(path.resolve(path.dirname(from), spec));
    for (const a of alias) {
      if (a.wildcard ? spec.startsWith(a.prefix) : spec === a.prefix) {
        const hit = resolveFile(path.join(a.target, a.wildcard ? spec.slice(a.prefix.length) : ""));
        if (hit) return hit;
      }
    }
    return null;                                     // a package, not a file
  };

  const seen = new Set();
  const queue = [...entries];
  while (queue.length) {
    const f = queue.pop();
    if (seen.has(f)) continue;
    seen.add(f);
    let specs = [];
    try { specs = specifiers(f); } catch { continue; }
    for (const s of specs) {
      const target = resolve(f, s);
      if (target && SOURCE.test(target) && !seen.has(target)
          && !target.includes(`${path.sep}node_modules${path.sep}`)) queue.push(target);
    }
  }
  return { known: true, entries: [...entries].map(rel), reachable: new Set([...seen].map(rel)) };
}

/** "components/footer.tsx:2" -> is that file reachable? */
export const siteIsLive = (reach, site) => reach.reachable.has(site.replace(/:\d+$/, ""));
