/**
 * What kind of break a root cause is, and what fixes it on each side.
 *
 * A root cause (lib/apidiff.mjs `explain`) is one sentence, such as `enum
 * ServiceTier lost SERVICE_TIER_FLEX` or `Opts.region now required`. Grouped by
 * kind, they show which few habits cause most of the breaks - and each habit
 * has a fix the owner can make for free while the PR is still open.
 */
export const KINDS = {
  "enum-renamed": {
    label: "Enum members renamed",
    consumer: "Automatic: fix.mjs renames each member where it's used, and flags string literals that still hold the old value (they compile and silently stop matching).",
    owner: "Keep the old member as a deprecated alias of the new one for one major.",
  },
  "value-added": {
    label: "A value added to an output enum or union",
    consumer: "Nothing, unless code switches exhaustively over it. Then add a default branch.",
    owner: "Declare output enums open (`| (string & {})`), or call it out in the manifest as additive.",
  },
  "removed": {
    label: "An export or member removed",
    consumer: "Automatic when the package names the replacement (a deprecation note or a kept alias). Otherwise manual, and if every site is dead code, delete the file.",
    owner: "Keep an alias, and write the replacement's name into the @deprecated note. That makes the fix automatic for every consumer.",
  },
  "newly-required": {
    label: "A parameter or field became required",
    consumer: "Supply the new argument or field at each call site the check lists.",
    owner: "Make it optional with a default; almost always possible, and it keeps the release a minor.",
  },
  "input-narrowed": {
    label: "An input stopped accepting a value",
    consumer: "Change the value passed at the listed sites.",
    owner: "Keep accepting the old value and deprecate it.",
  },
  "signature-rewritten": {
    label: "A signature rewritten (overloads, callback shape, kind of value)",
    consumer: "Run the type-check; the verdict lists the sites.",
    owner: "Add an overload next to the old signature instead of replacing it.",
  },
  "type-changed": {
    label: "A type changed shape",
    consumer: "Run the type-check; the verdict lists the sites.",
    owner: "Widen rather than replace: add the new shape to a union with the old.",
  },
};

/** Classify the root causes of one release. Returns kind -> [causes]. */
export function classify(causes) {
  const gainedEnums = new Set(), lostEnums = new Set();
  for (const c of causes) {
    const g = c.match(/^enum (\S+) gained /); if (g) gainedEnums.add(g[1]);
    const l = c.match(/^enum (\S+) lost /); if (l) lostEnums.add(l[1]);
  }
  const out = {};
  const put = (k, c) => (out[k] ??= []).push(c);
  for (const c of causes) {
    const e = c.match(/^enum (\S+) (gained|lost) /);
    if (e) {
      const renamed = gainedEnums.has(e[1]) && lostEnums.has(e[1]);
      put(renamed ? "enum-renamed" : e[2] === "gained" ? "value-added" : "removed", c);
    } else if (/^[\w$.]+ removed$/.test(c)) put("removed", c);
    else if (/now required|now requires argument|must now provide/.test(c)) put("newly-required", c);
    else if (/^no longer accepts /.test(c)) put("input-narrowed", c);
    else if (/ gained /.test(c)) put("value-added", c);
    else if (/overload|^\(.*\) =>|=> .* → |→ \(|→ \{/.test(c)) put("signature-rewritten", c);
    else put("type-changed", c);
  }
  return out;
}
