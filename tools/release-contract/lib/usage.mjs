/**
 * Symbol-level usage index.
 *
 * "Who depends on package P" is the question every registry can answer, and it
 * is the wrong one: a consumer is affected by a release only if it uses a symbol
 * the release changed. This records, per consumer, exactly which exports of each
 * package it touches and where, including members reached through a namespace
 * import and JSX tags such as <motion.div>.
 */
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const SKIP = new Set(["node_modules", ".git", "dist", "build", "out", ".next", ".nuxt",
  "coverage", "vendor", ".turbo", ".vercel", "storybook-static"]);
const EXT = /\.(m|c)?(j|t)sx?$/;

export function* sourceFiles(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".") && entry.name !== ".") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) { if (!SKIP.has(entry.name)) yield* sourceFiles(full); }
    else if (EXT.test(entry.name) && !entry.name.endsWith(".d.ts")) yield full;
  }
}

function kindFor(file) {
  if (file.endsWith(".tsx")) return ts.ScriptKind.TSX;
  if (file.endsWith(".jsx")) return ts.ScriptKind.JSX;
  if (/\.(m|c)?ts$/.test(file)) return ts.ScriptKind.TS;
  return ts.ScriptKind.JSX;          // .js may contain JSX in React projects
}

/** Package a specifier belongs to: "@scope/name/sub" -> "@scope/name". */
export function packageOf(spec) {
  if (spec.startsWith(".") || spec.startsWith("/")) return null;
  const parts = spec.split("/");
  return spec.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
}

export function indexRepo(root, { only } = {}) {
  const uses = {};                                   // pkg -> symbol -> [loc]
  const add = (pkg, sym, file, node, sf) => {
    if (only && !only.has(pkg)) return;
    const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
    ((uses[pkg] ??= {})[sym] ??= []).push(`${path.relative(root, file)}:${line}`);
  };

  for (const file of sourceFiles(root)) {
    let text;
    try { text = fs.readFileSync(file, "utf8"); } catch { continue; }
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kindFor(file));
    const namespaces = new Map();                    // local name -> pkg

    const visitImports = node => {
      if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
        const spec = node.moduleSpecifier.text, pkg = packageOf(spec);
        const clause = node.importClause;
        if (pkg && clause) {
          const sub = spec === pkg ? "" : spec.slice(pkg.length);   // e.g. "/icons/x"
          if (clause.name) add(pkg, sub ? `${sub}#default` : "default", file, clause, sf);
          const nb = clause.namedBindings;
          if (nb && ts.isNamespaceImport(nb)) namespaces.set(nb.name.text, pkg);
          if (nb && ts.isNamedImports(nb)) for (const el of nb.elements) {
            add(pkg, (el.propertyName ?? el.name).text, file, el, sf);
          }
        } else if (pkg && !clause) {
          add(pkg, "(side-effect)", file, node, sf);
        }
      }
      if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
        const pkg = packageOf(node.moduleSpecifier.text);
        if (pkg && node.exportClause && ts.isNamedExports(node.exportClause)) {
          for (const el of node.exportClause.elements) add(pkg, (el.propertyName ?? el.name).text, file, el, sf);
        } else if (pkg) add(pkg, "*", file, node, sf);
      }
      // const { a, b } = require("pkg")
      if (ts.isVariableDeclaration(node) && node.initializer && ts.isCallExpression(node.initializer)
          && ts.isIdentifier(node.initializer.expression) && node.initializer.expression.text === "require"
          && node.initializer.arguments[0] && ts.isStringLiteral(node.initializer.arguments[0])) {
        const pkg = packageOf(node.initializer.arguments[0].text);
        if (pkg && ts.isObjectBindingPattern(node.name)) {
          for (const el of node.name.elements) {
            const nm = el.propertyName ?? el.name;
            if (ts.isIdentifier(nm)) add(pkg, nm.text, file, el, sf);
          }
        } else if (pkg && ts.isIdentifier(node.name)) namespaces.set(node.name.text, pkg);
      }
      ts.forEachChild(node, visitImports);
    };
    visitImports(sf);

    if (namespaces.size) {
      const visitMembers = node => {
        if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression)
            && namespaces.has(node.expression.text)) {
          add(namespaces.get(node.expression.text), node.name.text, file, node, sf);
        }
        ts.forEachChild(node, visitMembers);
      };
      visitMembers(sf);
    }
  }
  return uses;
}
