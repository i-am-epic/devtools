/**
 * Computed semver.
 *
 * A version number is a human's prediction, made once for every consumer, of
 * whether a release will break them. This replaces the prediction with a check:
 * both versions are installed side by side and the TypeScript checker is asked
 * whether each export of the new version is still assignable to what the old
 * one promised. If it is not, code written against the old API stops compiling,
 * whatever the version number says.
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import ts from "typescript";

const REGISTRY = process.env.RELEASE_CONTRACT_REGISTRY || "https://registry.npmjs.org";

export async function packument(pkg) {
  const res = await fetch(`${REGISTRY}/${pkg.replace("/", "%2F")}`);
  if (!res.ok) throw new Error(`registry returned ${res.status} for ${pkg}`);
  return res.json();
}

/**
 * TypeScript compares a class that has private or protected members by
 * identity, not by shape: two separately compiled copies of the same class are
 * never assignable to each other, even when they are identical. Left alone,
 * every such class reports "broken" on every release, and so does everything
 * that mentions one - a stream class reached through an SDK's request options
 * is enough. Those members are not part of what a consumer can use, so they
 * are removed from both versions before the comparison. The one consumer that
 * can see protected members - a subclass - is outside what this check claims
 * to cover, and is sent to a real type-check.
 *
 * Members are found with the parser, not a pattern: a signature such as
 * `protected prepare({ url }: { url: string }): void;` defeats any regex.
 */
function withoutHiddenMembers(file, text) {
  if (!/\b(private|protected)\b|#/.test(text)) return text;
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, false, ts.ScriptKind.TS);
  const cuts = [];
  const hidden = m => (m.name && ts.isPrivateIdentifier(m.name))
    || (ts.canHaveModifiers(m) && (ts.getModifiers(m) ?? []).some(x =>
      x.kind === ts.SyntaxKind.PrivateKeyword || x.kind === ts.SyntaxKind.ProtectedKeyword));
  const visit = node => {
    if (ts.isClassLike(node)) for (const m of node.members) if (hidden(m)) cuts.push([m.getFullStart(), m.getEnd()]);
    ts.forEachChild(node, visit);
  };
  visit(sf);
  let out = text;
  for (const [a, b] of cuts.sort((x, y) => y[0] - x[0])) out = out.slice(0, a) + out.slice(b);
  return out;
}

/**
 * A `unique symbol` is nominal in the same way: `declare const brand: unique
 * symbol` in one copy of a package is a different type from the identical line
 * in the other copy, and so is everything that mentions it - a request method
 * whose default type parameter is branded, a generated SDK's headers type.
 * Across two versions of a package, the same name is the same symbol, so each
 * one is given a string-literal type derived from its name, in both copies.
 */
const UNIQUE_SYMBOL = /\b([A-Za-z_$][\w$]*)(\??)(\s*):(\s*)unique symbol\b/g;

function rewriteDeclarations(dir, rewrite) {
  let files = 0;
  const walk = d => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) walk(full);
      else if (/\.d\.[mc]?ts$/.test(e.name)) {
        const text = fs.readFileSync(full, "utf8");
        const next = rewrite(text, full);
        if (next !== text) { fs.writeFileSync(full, next); files++; }
      }
    }
  };
  walk(path.join(dir, "node_modules"));
  return files;
}

/** Remove what makes two copies of one declaration incomparable. Idempotent. */
export function stripHiddenMembers(dir) {
  return rewriteDeclarations(dir, (text, file) => withoutHiddenMembers(file, text)
    .replace(UNIQUE_SYMBOL, (_, name, opt, a, b) => `${name}${opt}${a}:${b}"unique symbol ${name}"`));
}

// Bumped whenever stripHiddenMembers learns something new, so that versions
// installed by an earlier run are normalised again without reinstalling.
const NORMALISED = ".normalised-3";

/** Install both versions under aliases so one program can see them together. */
export function prepare(pkg, oldV, newV, { root, extraTypes = [] }) {
  const dir = path.join(root, `${pkg.replace(/[/@]/g, "_")}__${oldV}__${newV}`);
  if (!fs.existsSync(path.join(dir, ".prepared"))) {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "package.json"), '{"name":"probe","private":true}');
    execFileSync("npm", [
      "install", "--ignore-scripts", "--no-audit", "--no-fund", "--legacy-peer-deps",
      `old-api@npm:${pkg}@${oldV}`, `new-api@npm:${pkg}@${newV}`, ...extraTypes,
    ], { cwd: dir, stdio: "pipe", timeout: 900_000 });
    fs.writeFileSync(path.join(dir, ".prepared"), "");
  }
  if (!fs.existsSync(path.join(dir, NORMALISED))) {
    stripHiddenMembers(dir);
    fs.writeFileSync(path.join(dir, NORMALISED), "");
  }
  return dir;
}

const bumpRank = { patch: 0, minor: 1, major: 2 };

export function declaredBump(oldV, newV) {
  const [a, b] = [oldV, newV].map(v => v.split(/[.+-]/).slice(0, 3).map(Number));
  // Under 1.0.0, semver treats a minor as the breaking position.
  if (a[0] === 0 && b[0] === 0) return a[1] !== b[1] ? "major" : a[2] !== b[2] ? "minor" : "patch";
  return a[0] !== b[0] ? "major" : a[1] !== b[1] ? "minor" : "patch";
}

function describe(checker, sym) {
  const f = sym.flags;
  if (f & ts.SymbolFlags.Class) return "class";
  if (f & ts.SymbolFlags.Function) return "function";
  if (f & ts.SymbolFlags.Enum) return "enum";
  if (f & ts.SymbolFlags.Interface) return "interface";
  if (f & ts.SymbolFlags.TypeAlias) return "type";
  if (f & ts.SymbolFlags.Variable) return "value";
  if (f & ts.SymbolFlags.Module) return "namespace";
  return "other";
}

/**
 * Release tags an owner can put on a declaration to say how stable it is: the
 * TSDoc release tags. Only those - a looser vocabulary misreads other tags, as
 * lucide-react's "@preview", which embeds an image of every icon and would
 * otherwise mark all of them unstable and excuse their removal.
 */
const UNSTABLE = new Set(["beta", "alpha", "experimental", "internal"]);

export function stabilityOf(sym) {
  const tags = new Set();
  for (const d of sym.declarations ?? []) {
    for (const t of ts.getJSDocTags(d)) tags.add(t.tagName.text.toLowerCase());
  }
  if ([...tags].some(t => UNSTABLE.has(t))) return "unstable";
  if (tags.has("deprecated")) return "deprecated";
  return "stable";
}

/** Declaration text with comments and whitespace normalised away. */
function declText(sym) {
  return (sym.declarations ?? []).map(d => d.getText())
    .join("\n").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "").replace(/\s+/g, " ").trim();
}

function isGenericType(sym) {
  return (sym.declarations ?? []).some(d => d.typeParameters && d.typeParameters.length);
}

/**
 * A symbol-keyed member such as [Symbol.iterator] has an internal name that
 * carries a per-program number ("__@iterator@25"), so it is matched by its
 * description instead.
 */
const memberName = name => name.replace(/^__@(.+)@\d+$/, "[Symbol.$1]");
function counterpartMember(checker, type, member) {
  return checker.getPropertyOfType(type, member.name)
    ?? checker.getPropertiesOfType(type).find(q => memberName(q.name) === memberName(member.name));
}

/** Which public members of a class or interface account for an incompatibility. */
function memberDiff(checker, oldT, newT, at) {
  const out = [];
  for (const op of checker.getPropertiesOfType(oldT)) {
    const np = counterpartMember(checker, newT, op);
    if (!np) { out.push(`${memberName(op.name)} removed`); continue; }
    const ot = checker.getTypeOfSymbolAtLocation(op, at), nt = checker.getTypeOfSymbolAtLocation(np, at);
    if (!checker.isTypeAssignableTo(nt, ot)) out.push(`${memberName(op.name)} changed`);
  }
  for (const np of checker.getPropertiesOfType(newT)) {
    const optional = (np.flags & ts.SymbolFlags.Optional) !== 0;
    if (!optional && !counterpartMember(checker, oldT, np)) out.push(`${memberName(np.name)} now required`);
  }
  return out.slice(0, 6);
}

const enumSymbol = t => {
  const s = t.symbol;
  if (!s) return null;
  if (s.flags & ts.SymbolFlags.Enum) return s;
  if (s.flags & ts.SymbolFlags.EnumMember) return s.parent ?? null;
  return null;
};

const CONTAINERS = new Set(["Array", "ReadonlyArray", "Set", "ReadonlySet", "Map", "ReadonlyMap",
  "Iterable", "AsyncIterable", "Iterator", "AsyncIterator", "Generator", "AsyncGenerator", "Record"]);

const PROMISE_MEMBERS = new Set(["then", "catch", "finally", "[Symbol.toStringTag]"]);

const isRequiredParam = p => {
  const d = p.valueDeclaration;
  return Boolean(d && ts.isParameter(d) && !d.questionToken && !d.initializer && !d.dotDotDotToken);
};

/**
 * Why is `now` not assignable to `was`? Walks into both types in step -
 * properties, call parameters and returns, awaited values, unions and enums -
 * and returns the smallest differences that account for it, each with the path
 * that reaches it. One release's broken exports are usually many paths to a
 * few such causes: every axios export that mentions a request config breaks
 * when one enum inside that config gains a member.
 *
 * Signatures are taken apart outside TypeScript's own unification of their
 * type parameters, so the `D` of one version never equals the `D` of the other
 * here. Same-named type parameters are treated as equal; an export whose only
 * differences are those comes back with no causes.
 */
export function explain(checker, was, now, at, root = [], limit = { nodes: 600 }) {
  const out = [];
  const seen = new Map();
  const str = t => checker.typeToString(t, undefined, ts.TypeFormatFlags.NoTruncation).slice(0, 120);
  const leaf = (trail, what) => {
    if (out.length < 4 && !out.some(o => o.what === what)) out.push({ path: trail.join(" › "), what });
    return "leaf";
  };
  const nameOf = t => { const n = (t.aliasSymbol ?? t.symbol)?.name; return n && !n.startsWith("__") ? n : null; };
  const counterpart = (t, pool) => {
    const n = nameOf(t);
    if (n) { const w = pool.find(x => nameOf(x) === n); if (w) return w; }
    if (t.getCallSignatures().length) return pool.find(x => x.getCallSignatures().length) ?? null;
    if (t.flags & ts.TypeFlags.Object) return pool.find(x => (x.flags & ts.TypeFlags.Object) && !nameOf(x)) ?? null;
    return null;
  };
  const combine = results => results.includes("leaf") ? "leaf" : results.includes("noise") ? "noise" : "none";

  const walk = (was, now, trail, depth, inbound = false) => {
    if (out.length >= 4 || --limit.nodes < 0) return "noise";
    if (checker.isTypeAssignableTo(now, was)) return "none";
    if ((was.flags & ts.TypeFlags.TypeParameter) && (now.flags & ts.TypeFlags.TypeParameter)) {
      return was.symbol?.name === now.symbol?.name ? "noise" : leaf(trail, `type parameter ${str(was)} → ${str(now)}`);
    }
    const key = `${was.id}:${now.id}`;
    if (seen.has(key)) return seen.get(key);
    seen.set(key, "noise");                          // cycles resolve to "no new information"
    const result = step(was, now, trail, depth, inbound);
    seen.set(key, result);
    return result;
  };

  const step = (was, now, trail, depth, inbound) => {
    // In a parameter the roles swap: `was` is the new type, `now` the old one,
    // and what is missing or extra means the opposite of what it means in a
    // return value. `before → after` below always reads old → new.
    const change = () => inbound ? `${str(now)} → ${str(was)}` : `${str(was)} → ${str(now)}`;
    if (depth > 8) return str(was) === str(now) ? "noise" : leaf(trail, change());

    // A value that became a different kind of thing (a RegExp parameter that
    // now takes a function) is one change, not a list of missing members.
    const [wn, nn] = [nameOf(was), nameOf(now)];
    const callable = t => t.getCallSignatures().length > 0;
    if ((wn && nn && wn !== nn && !enumSymbol(was)) || callable(was) !== callable(now)) return leaf(trail, change());

    const oe = enumSymbol(was), ne = enumSymbol(now);
    if (oe && ne) {
      const had = new Set([...(oe.exports?.keys() ?? [])].map(String));
      const gained = [...(ne.exports?.keys() ?? [])].map(String).filter(k => !had.has(k));
      const verb = inbound ? "lost" : "gained";
      return leaf(trail, gained.length ? `enum ${oe.name} ${verb} ${gained.join(", ")}` : `enum ${oe.name} changed`);
    }

    if (now.isUnion() && !(now.flags & ts.TypeFlags.Boolean)) {
      const pool = was.isUnion() ? was.types : [was];
      const results = [], gained = [], enumsDone = new Set();
      for (const t of now.types) {
        if (checker.isTypeAssignableTo(t, was)) continue;
        const en = enumSymbol(t)?.name;
        if (en) { if (enumsDone.has(en)) continue; enumsDone.add(en); }
        const w = counterpart(t, pool) ?? (en ? pool.find(x => enumSymbol(x)?.name === en) : null);
        if (w) results.push(walk(w, t, trail, depth + 1, inbound)); else gained.push(t);
      }
      if (gained.length) results.push(leaf(trail, inbound
        ? `no longer accepts ${gained.map(str).join(" | ")}`
        : `${str(was)} gained ${gained.map(str).join(" | ")}`));
      return combine(results);
    }

    // Any thenable - Promise or an SDK's own subclass of it - is compared by
    // what it resolves to, not by the type parameters of its `then`.
    const awaited = t => t.symbol?.name === "Promise" || checker.getPropertyOfType(t, "then")
      ? checker.getAwaitedType(t) : null;
    const [wa, na] = [awaited(was), awaited(now)];
    const thenable = Boolean(wa && na);
    if (thenable) {
      const r = walk(wa, na, [...trail, "await"], depth + 1, inbound);
      if (r !== "none") return r;                    // else: the SDK's own promise methods differ
    }

    // Built-in containers differ only in what they hold; walking Array's own
    // methods (push, concat, ...) would just report the element type again.
    const container = t => CONTAINERS.has(nameOf(t) ?? "") && (t.flags & ts.TypeFlags.Object)
      && (t.objectFlags & ts.ObjectFlags.Reference) ? checker.getTypeArguments(t) : null;
    const [wc, nc] = [container(was), container(now)];
    if (wc && nc && nameOf(was) === nameOf(now)) {
      const label = /Array$/.test(nameOf(was)) ? () => "[]" : i => `<${i + 1}>`;
      return combine(wc.map((w, i) => nc[i] ? walk(w, nc[i], [...trail, label(i)], depth + 1, inbound) : "none"));
    }

    // Overloads are paired in declaration order: every old overload is a way
    // of calling the function that code may rely on.
    const wsigs = was.getCallSignatures(), nsigs = now.getCallSignatures();
    if (wsigs.length && nsigs.length) {
      const results = [];
      if (wsigs.length > nsigs.length) {
        results.push(leaf(trail, inbound
          ? `must now provide ${wsigs.length} call overloads (was ${nsigs.length})`
          : `lost ${wsigs.length - nsigs.length} call overload(s)`));
      }
      // Pair each old overload with the new one that looks most like it: a
      // release that reorders or inserts overloads must not be read as having
      // changed every one of them.
      const shape = sig => sig.parameters.map(q => str(checker.getTypeOfSymbolAtLocation(q, at)));
      const nshapes = nsigs.map(shape);
      const pairFor = (ws, k) => {
        const w = shape(ws);
        let best = Math.min(k, nsigs.length - 1), score = -1;
        nshapes.forEach((n, j) => {
          const sc = (n.length === w.length ? 1 : 0) + n.filter((t, i) => t === w[i]).length * 2;
          if (sc > score) { score = sc; best = j; }
        });
        return nsigs[best];
      };
      wsigs.forEach((ws, k) => {
        const ns = pairFor(ws, k);
        const at2 = wsigs.length > 1 ? [...trail, `overload ${k + 1}`] : trail;
        if (ws.thisParameter && ns.thisParameter) {
          results.push(walk(checker.getTypeOfSymbolAtLocation(ns.thisParameter, at),
                            checker.getTypeOfSymbolAtLocation(ws.thisParameter, at), [...at2, "(this)"], depth + 1, !inbound));
        }
        ns.parameters.forEach((p, i) => {
          const q = ws.parameters[i];
          if (!q) { if (isRequiredParam(p)) results.push(leaf(at2, `now requires argument ${i + 1} (${p.name})`)); return; }
          // Arguments flow in: what callers pass, typed against the old
          // parameter, must be accepted by the new one.
          results.push(walk(checker.getTypeOfSymbolAtLocation(p, at), checker.getTypeOfSymbolAtLocation(q, at),
                            [...at2, `(${p.name})`], depth + 1, !inbound));
        });
        results.push(walk(checker.getReturnTypeOfSignature(ws), checker.getReturnTypeOfSignature(ns),
                          [...at2, "returns"], depth + 1, inbound));
      });
      const r = combine(results);
      if (r !== "none") return r;
    }

    const wprops = checker.getPropertiesOfType(was);
    if (wprops.length && !(was.flags & ts.TypeFlags.Primitive)) {
      const results = [];
      for (const wp of wprops) {
        if (thenable && PROMISE_MEMBERS.has(memberName(wp.name))) continue;
        const np = counterpartMember(checker, now, wp), name = memberName(wp.name);
        if (!np) {
          // A missing optional member never makes a type incompatible.
          if (wp.flags & ts.SymbolFlags.Optional) continue;
          const structural = t => /^[(<[]|^returns$|^await$|^overload /.test(t);
          const owner = (trail.length && !structural(trail.at(-1)) ? trail.at(-1) : null)
            ?? nameOf(was) ?? [...trail].reverse().find(t => !structural(t)) ?? "member";
          results.push(leaf([...trail, name], inbound ? `${owner}.${name} now required` : `${owner}.${name} removed`));
          continue;
        }
        results.push(walk(checker.getTypeOfSymbolAtLocation(wp, at), checker.getTypeOfSymbolAtLocation(np, at),
                          [...trail, name], depth + 1, inbound));
      }
      const r = combine(results);
      if (r !== "none") return r;
    }
    // Identical text on both sides says nothing about where the difference is.
    return str(was) === str(now) ? "noise" : leaf(trail, change());
  };

  walk(was, now, root, 0);
  return out;
}

/**
 * Compare the two installed versions. Returns every export classified as
 * removed, added, broken (still present but no longer compatible), widened
 * (compatible, but the new type accepts more), or unchanged.
 */
export function compare(dir) {
  const probe = path.join(dir, "probe.ts");
  fs.writeFileSync(probe,
    'import * as Old from "old-api";\nimport * as New from "new-api";\nexport { Old, New };\n');
  const program = ts.createProgram([probe], {
    noEmit: true, skipLibCheck: true, strict: true,
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true, allowSyntheticDefaultImports: true,
    types: [],
  });
  const checker = program.getTypeChecker();
  const sf = program.getSourceFile(probe);
  const [oldImp, newImp] = sf.statements.filter(ts.isImportDeclaration);
  const oldMod = checker.getSymbolAtLocation(oldImp.moduleSpecifier);
  const newMod = checker.getSymbolAtLocation(newImp.moduleSpecifier);
  if (!oldMod || !newMod) {
    return { typed: false, reason: "no type declarations resolved for one or both versions" };
  }

  const resolve = s => (s.flags & ts.SymbolFlags.Alias) ? checker.getAliasedSymbol(s) : s;
  const exportsOf = mod => new Map(checker.getExportsOfModule(mod).map(s => [s.name, s]));
  const oldEx = exportsOf(oldMod), newEx = exportsOf(newMod);

  const out = { typed: true, removed: [], added: [], broken: [], widened: [], changed: [],
                unstable: [], unchanged: 0, unknown: [],
                exports: { old: oldEx.size, new: newEx.size } };
  const isAny = t => (t.flags & ts.TypeFlags.Any) !== 0;
  const short = t => checker.typeToString(t, undefined, ts.TypeFormatFlags.NoTruncation).slice(0, 180);

  for (const [name, s] of oldEx) {
    if (newEx.has(name)) continue;
    const r = resolve(s), stability = stabilityOf(r);
    // Removing something marked unstable is what the tag is for; removing
    // something marked deprecated is announced. Neither understates a release.
    if (stability === "unstable") out.unstable.push({ name, change: "removed" });
    else out.removed.push({ name, kind: describe(checker, r), announced: stability === "deprecated" });
  }
  for (const [name, s] of newEx) {
    if (!oldEx.has(name)) out.added.push({ name, kind: describe(checker, resolve(s)) });
  }

  for (const [name, os] of oldEx) {
    const ns = newEx.get(name);
    if (!ns) continue;
    const o = resolve(os), n = resolve(ns);
    const unstableSym = stabilityOf(o) === "unstable" || stabilityOf(n) === "unstable";
    const note = (entry) => unstableSym ? out.unstable.push({ name, change: entry.why }) : out.broken.push(entry);
    const oVal = (o.flags & ts.SymbolFlags.Value) !== 0, nVal = (n.flags & ts.SymbolFlags.Value) !== 0;
    const oTyp = (o.flags & ts.SymbolFlags.Type) !== 0, nTyp = (n.flags & ts.SymbolFlags.Type) !== 0;
    if ((oVal && !nVal) || (oTyp && !nTyp)) {
      out.broken.push({ name, kind: describe(checker, o), why: "no longer exported as a " + (oVal && !nVal ? "value" : "type") });
      continue;
    }
    // Values: code that calls or reads the old export must still type-check
    // against the new one, so the new type must be assignable to the old.
    if (oVal) {
      const ot = checker.getTypeOfSymbolAtLocation(o, sf);
      const nt = checker.getTypeOfSymbolAtLocation(n, sf);
      if (isAny(ot) || isAny(nt)) { out.unknown.push(name); continue; }
      if (!checker.isTypeAssignableTo(nt, ot)) {
        const inst = (o.flags & ts.SymbolFlags.Class) && (n.flags & ts.SymbolFlags.Class)
          ? memberDiff(checker, checker.getDeclaredTypeOfSymbol(o), checker.getDeclaredTypeOfSymbol(n), sf) : [];
        note({ name, kind: describe(checker, o), members: inst,
               why: inst.length ? `members: ${inst.join(", ")}` : "new type is not assignable to the old",
               was: short(ot), now: short(nt), causes: explain(checker, ot, nt, sf, [name]) });
        continue;
      }
      if (!checker.isTypeAssignableTo(ot, nt)) { out.widened.push(name); continue; }
      out.unchanged++;
      continue;
    }
    // Types are used in both directions - consumers build values of them and
    // receive values of them - so only a change neither way round is safe.
    if (oTyp) {
      // A generic type's parameters are distinct in each version, so comparing
      // Operation<T> with Operation<T> by assignability can never succeed. For
      // those, the declaration text decides: identical means unchanged, and a
      // difference goes to review rather than being asserted as a break.
      if (isGenericType(o) || isGenericType(n)) {
        if (declText(o) === declText(n)) out.unchanged++;
        else if (unstableSym) out.unstable.push({ name, change: "generic declaration changed" });
        else out.changed.push({ name, kind: describe(checker, o), why: "generic declaration changed - review" });
        continue;
      }
      const ot = checker.getDeclaredTypeOfSymbol(o), nt = checker.getDeclaredTypeOfSymbol(n);
      if (isAny(ot) || isAny(nt)) { out.unknown.push(name); continue; }
      const fwd = checker.isTypeAssignableTo(nt, ot), back = checker.isTypeAssignableTo(ot, nt);
      if (fwd && back) out.unchanged++;
      else if (fwd || back) out.widened.push(name);
      else {
        const m = memberDiff(checker, ot, nt, sf);
        note({ name, kind: describe(checker, o), members: m,
               why: m.length ? `members: ${m.join(", ")}` : "type changed incompatibly",
               was: short(ot), now: short(nt), causes: explain(checker, ot, nt, sf, [name]) });
      }
      continue;
    }
    out.unchanged++;
  }
  // Root causes: the distinct leaf differences, with how many broken exports
  // reach each one. This is what an owner fixes; the broken list is the cascade.
  const causes = new Map();
  for (const b of out.broken) for (const c of b.causes ?? []) {
    const e = causes.get(c.what) ?? { what: c.what, exports: 0, example: c.path || b.name };
    e.exports++;
    causes.set(c.what, e);
  }
  out.causes = [...causes.values()].sort((a, b) => b.exports - a.exports);

  // The computed bump rests only on what is certain: a removal, or a change the
  // checker proves incompatible. "changed" needs a person; "unstable" is exempt
  // by the owner's own declaration.
  const hardRemovals = out.removed.filter(r => !r.announced).length;
  out.computed = hardRemovals || out.broken.length ? "major"
    : out.removed.length || out.added.length || out.widened.length || out.changed.length ? "minor"
    : "patch";
  return out;
}

export async function diff(pkg, oldV, newV, { root }) {
  const meta = await packument(pkg);
  const peers = Object.keys(meta.versions?.[newV]?.peerDependencies ?? {});
  const extraTypes = peers.includes("react") ? ["@types/react@19", "@types/react-dom@19"] : [];
  const dir = prepare(pkg, oldV, newV, { root, extraTypes });
  const result = compare(dir);
  const declared = declaredBump(oldV, newV);
  return {
    package: pkg, from: oldV, to: newV, declared, ...result,
    understated: result.typed ? bumpRank[result.computed] > bumpRank[declared] : null,
  };
}
