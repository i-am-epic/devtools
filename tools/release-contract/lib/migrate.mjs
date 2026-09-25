/**
 * Turn a release's remedies into edits at the consumer's exact sites.
 *
 * Edits keep the consumer's own local names, so nothing else in the file has
 * to change: `import { Trash2 }` becomes `import { Trash as Trash2 }`, and every
 * `<Trash2 />` below it keeps working. Member renames are rewritten where
 * they are read (`ServiceTier.SERVICE_TIER_FLEX` -> `ServiceTier.FLEX`,
 * `icons.Trash2` -> `icons.Trash`).
 *
 * Some findings can't be fixed by rewriting a name, and are reported instead:
 *  - silent: a string literal equal to an enum value that the release changed.
 *    It still compiles, and no longer matches at runtime.
 *  - dynamic: `icons[name]` on a map that lost keys; which keys a lookup reads
 *    is only known when it runs.
 *  - manual: a removal the package names no replacement for. The owner's
 *    deprecation note is attached. If every site is in dead code, the fix is
 *    deleting the file.
 */
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { sourceFiles, packageOf } from "./usage.mjs";

function kindFor(file) {
  if (file.endsWith(".tsx")) return ts.ScriptKind.TSX;
  if (/\.(m|c)?ts$/.test(file)) return ts.ScriptKind.TS;
  return ts.ScriptKind.JSX;
}

export function plan(root, pkg, diff, { isLive = () => true } = {}) {
  const r = diff.remedies ?? { exports: {}, enumMembers: [], members: [] };
  const exportFix = new Map(Object.entries(r.exports).filter(([, v]) => v.to));
  const noFix = new Map(Object.entries(r.exports).filter(([, v]) => !v.to));
  const enumFix = new Map();                          // enum -> from -> remedy
  for (const e of r.enumMembers) (enumFix.get(e.enum) ?? enumFix.set(e.enum, new Map()).get(e.enum)).set(e.from, e);
  const memberFix = new Map();                        // owner -> from -> remedy
  for (const m of r.members) (memberFix.get(m.owner) ?? memberFix.set(m.owner, new Map()).get(m.owner)).set(m.from, m);
  const oldValues = new Map(r.enumMembers.filter(e => typeof e.fromValue === "string" && e.fromValue !== e.toValue)
    .map(e => [e.fromValue, e]));

  const edits = [], silent = [], dynamic = [], manual = [];
  for (const file of sourceFiles(root)) {
    const rel = path.relative(root, file).split(path.sep).join("/");
    let text;
    try { text = fs.readFileSync(file, "utf8"); } catch { continue; }
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kindFor(file));
    const at = node => `${rel}:${sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1}`;
    const edit = (node, to, why) => edits.push({ file: rel, start: node.getStart(sf), end: node.getEnd(),
                                                 from: node.getText(sf), to, why, site: at(node) });
    const locals = new Map();                         // local name -> export name, for this package
    let namespace = null;

    for (const st of sf.statements) {
      if (!ts.isImportDeclaration(st) || !ts.isStringLiteral(st.moduleSpecifier)) continue;
      if (packageOf(st.moduleSpecifier.text) !== pkg || !st.importClause) continue;
      const nb = st.importClause.namedBindings;
      if (nb && ts.isNamespaceImport(nb)) namespace = nb.name.text;
      if (nb && ts.isNamedImports(nb)) for (const el of nb.elements) {
        const imported = (el.propertyName ?? el.name).text, local = el.name.text;
        locals.set(local, imported);
        const fix = exportFix.get(imported);
        if (fix) {
          // Keep the local name: only the import specifier changes.
          edit(el, `${el.isTypeOnly ? "type " : ""}${fix.to} as ${local}`, `${imported} was replaced by ${fix.to} (${fix.via})`);
        } else if (noFix.has(imported)) {
          manual.push({ site: at(el), name: imported, live: isLive(at(el)), note: noFix.get(imported).note });
        }
      }
    }
    // Files that don't import the package are still walked: a string the
    // package used to send can be compared anywhere - the silent kind of break.
    const exportOf = expr => {
      if (ts.isIdentifier(expr)) return locals.get(expr.text) ?? null;
      if (namespace && ts.isPropertyAccessExpression(expr) && ts.isIdentifier(expr.expression)
          && expr.expression.text === namespace) return expr.name.text;
      return null;
    };

    const visit = node => {
      // Namespace access to a removed export: NS.Old -> NS.New
      if (namespace && ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression)
          && node.expression.text === namespace) {
        const fix = exportFix.get(node.name.text);
        if (fix) edit(node.name, fix.to, `${node.name.text} was replaced by ${fix.to} (${fix.via})`);
        else if (noFix.has(node.name.text)) {
          manual.push({ site: at(node), name: node.name.text, live: isLive(at(node)), note: noFix.get(node.name.text).note });
        }
      }
      if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
        const owner = exportOf(node.expression);
        const key = ts.isPropertyAccessExpression(node) ? node.name.text
          : ts.isStringLiteralLike(node.argumentExpression) ? node.argumentExpression.text : null;
        const keyNode = ts.isPropertyAccessExpression(node) ? node.name : node.argumentExpression;
        if (owner && enumFix.get(owner)?.has(key)) {
          const e = enumFix.get(owner).get(key);
          edit(keyNode, ts.isPropertyAccessExpression(node) ? e.to : JSON.stringify(e.to),
               `${owner}.${key} was renamed to ${owner}.${e.to} (${e.via})`);
        } else if (owner && memberFix.get(owner)?.has(key)) {
          const m = memberFix.get(owner).get(key);
          edit(keyNode, ts.isPropertyAccessExpression(node) ? m.to : JSON.stringify(m.to),
               `${owner}.${key} moved to ${owner}.${m.to} (${m.via})`);
        } else if (owner && ts.isElementAccessExpression(node) && key === null && memberFix.has(owner)) {
          const lost = [...memberFix.get(owner).values()];
          dynamic.push({ site: at(node), owner, keys: lost.map(m => `${m.from} -> ${m.to}`) });
        }
      }
      if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) && oldValues.has(node.text)
          && !ts.isImportDeclaration(node.parent)) {
        const e = oldValues.get(node.text);
        silent.push({ site: at(node), value: node.text, enum: e.enum, member: e.to, now: e.toValue });
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }

  // A removal with no named replacement whose every site is dead code is fixed
  // by deleting the files, not by editing them.
  const byName = new Map();
  for (const m of manual) (byName.get(m.name) ?? byName.set(m.name, []).get(m.name)).push(m);
  const deadFiles = [...new Set(manual.filter(m => !m.live).map(m => m.site.replace(/:\d+$/, "")))];
  return { edits, silent, dynamic, manual: [...byName.entries()].map(([name, sites]) => ({ name, note: sites[0].note,
             sites: sites.map(s => s.site), live: sites.some(s => s.live) })), deadFiles };
}

/** Apply the planned edits, last first within each file, and return the files touched. */
export function apply(root, edits) {
  const byFile = new Map();
  for (const e of edits) (byFile.get(e.file) ?? byFile.set(e.file, []).get(e.file)).push(e);
  for (const [file, list] of byFile) {
    const full = path.join(root, file);
    let text = fs.readFileSync(full, "utf8");
    for (const e of list.sort((a, b) => b.start - a.start)) text = text.slice(0, e.start) + e.to + text.slice(e.end);
    fs.writeFileSync(full, text);
  }
  return [...byFile.keys()];
}
