/**
 * Remedies: the fix for a break, read out of the package itself.
 *
 * When a release removes or renames something, the new name is usually already
 * written down in one of four places. Nobody has to read a changelog, and no
 * model has to guess:
 *
 *  1. the old version's `@deprecated` note ("Use `ContentTooLarge` instead");
 *  2. an enum whose members were renamed in place (SERVICE_TIER_FLEX -> FLEX),
 *     matched by name without the enum's own prefix, or by value;
 *  3. an alias the new version keeps (`Trash as Trash2`), which says where a
 *     member of a map such as `icons` went;
 *  4. a single added export whose declaration is identical to a removed one
 *     apart from its name - a plain rename.
 *
 * Each remedy says how it was found, so a person can judge how far to trust it.
 * Enum renames also carry both values: code that compares against the old
 * string keeps compiling after an upgrade and silently stops matching.
 */
import ts from "typescript";

const docText = c => typeof c === "string" ? c : Array.isArray(c) ? c.map(x => x.text ?? "").join("") : "";

export function deprecationNote(sym) {
  for (const d of sym?.declarations ?? []) {
    for (const t of ts.getJSDocTags(d)) {
      if (t.tagName.text.toLowerCase() === "deprecated") return docText(t.comment).replace(/\s+/g, " ").trim() || "deprecated";
    }
  }
  return null;
}

/** Names a deprecation note offers as the replacement, most explicit first. */
export function namedReplacements(note) {
  if (!note) return [];
  const out = [];
  const add = raw => {
    const n = raw?.replace(/\(\)$/, "").replace(/\.+$/, "").split(".").pop();
    if (n && !out.includes(n)) out.push(n);
  };
  for (const m of note.matchAll(/\{@link\s+([\w$.]+)[^}]*\}/g)) add(m[1]);
  for (const m of note.matchAll(/`([A-Za-z_$][\w$.]*(?:\(\))?)`/g)) add(m[1]);
  for (const m of note.matchAll(/\b(?:use|replaced by|renamed to|in favou?r of|prefer)\s+([A-Za-z_$][\w$.]*)/gi)) add(m[1]);
  return out;
}

const screaming = name => name.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toUpperCase() + "_";
const squash = s => String(s).toLowerCase().replace(/[^a-z0-9]/g, "");

function enumMembers(checker, sym) {
  const out = new Map();
  for (const [key, m] of sym.exports ?? []) {
    const decl = m.valueDeclaration;
    out.set(String(key), { sym: m, value: decl && ts.isEnumMember(decl) ? checker.getConstantValue(decl) : undefined });
  }
  return out;
}

function renamedEnumMembers(checker, name, oldSym, newSym) {
  const was = enumMembers(checker, oldSym), now = enumMembers(checker, newSym);
  const lost = [...was.keys()].filter(k => !now.has(k));
  const gained = [...now.keys()].filter(k => !was.has(k));
  if (!lost.length || !gained.length) return [];
  const prefix = screaming(name);
  const bare = k => squash(k.startsWith(prefix) ? k.slice(prefix.length) : k);
  const bareValue = v => typeof v === "string" ? bare(v.toUpperCase()) : null;
  const out = [];
  for (const k of lost) {
    const old = was.get(k);
    const byNote = namedReplacements(deprecationNote(old.sym)).filter(n => gained.includes(n));
    const byName = gained.filter(g => bare(g) === bare(k));
    const byValue = gained.filter(g => {
      const a = bareValue(old.value), b = bareValue(now.get(g).value);
      return (a && a === b) || (typeof old.value === "number" && old.value === now.get(g).value);
    });
    const [pick, via] = byNote.length === 1 ? [byNote[0], "deprecation note"]
      : byName.length === 1 ? [byName[0], "same name without the enum prefix"]
      : byValue.length === 1 ? [byValue[0], "same value"] : [null, null];
    if (pick) out.push({ enum: name, from: k, to: pick, via, fromValue: old.value, toValue: now.get(pick).value });
  }
  return out;
}

function normalisedDeclaration(sym, name) {
  const text = (sym?.declarations ?? []).map(d => d.getText()).join("\n")
    .replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "").replace(/\s+/g, " ").trim();
  return text.split(new RegExp(`\\b${name.replace(/[$]/g, "\\$")}\\b`)).join("§");
}

export function remedies(checker, sf, oldEx, newEx, out) {
  const resolve = s => (s.flags & ts.SymbolFlags.Alias) ? checker.getAliasedSymbol(s) : s;
  const result = { exports: {}, enumMembers: [], members: [] };

  // 1 and 4: removed exports.
  const added = out.added.map(a => a.name);
  const addedShapes = new Map(added.map(n => [n, normalisedDeclaration(resolve(newEx.get(n)), n)]));
  for (const r of [...out.removed, ...out.unstable.filter(u => u.change === "removed")]) {
    const old = resolve(oldEx.get(r.name));
    const note = deprecationNote(old);
    const named = namedReplacements(note).filter(n => newEx.has(n));
    if (named.length) { result.exports[r.name] = { to: named[0], via: "deprecation note", note }; continue; }
    const shape = normalisedDeclaration(old, r.name);
    const same = shape ? added.filter(n => addedShapes.get(n) === shape) : [];
    if (same.length === 1) { result.exports[r.name] = { to: same[0], via: "identical declaration", note }; continue; }
    result.exports[r.name] = { to: null, note };
  }

  for (const [name, os] of oldEx) {
    const ns = newEx.get(name);
    if (!ns) continue;
    const o = resolve(os), n = resolve(ns);
    // 2: enums renamed in place.
    if ((o.flags & ts.SymbolFlags.Enum) && (n.flags & ts.SymbolFlags.Enum)) {
      result.enumMembers.push(...renamedEnumMembers(checker, name, o, n));
      continue;
    }
    // 3: members that left a map but survive as a top-level alias.
    if (!(o.flags & ts.SymbolFlags.Value) || !out.broken.some(b => b.name === name)) continue;
    const ot = checker.getTypeOfSymbolAtLocation(o, sf), nt = checker.getTypeOfSymbolAtLocation(n, sf);
    for (const p of checker.getPropertiesOfType(ot)) {
      if (checker.getPropertyOfType(nt, p.name)) continue;
      const top = newEx.get(p.name);
      if (!top || !(top.flags & ts.SymbolFlags.Alias)) continue;
      const target = checker.getAliasedSymbol(top).name;
      if (target !== p.name && checker.getPropertyOfType(nt, target)) {
        result.members.push({ owner: name, from: p.name, to: target, via: `top-level alias ${target} as ${p.name}` });
      }
    }
  }
  return result;
}
