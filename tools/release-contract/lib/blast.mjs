/**
 * Blast radius: the release diff intersected with what one consumer uses.
 *
 * The verdict depends on the consumer, not only on the release. A removed
 * export breaks every consumer that imports it, in any language: bundlers
 * refuse a named import that no longer exists. A type that changed shape only
 * breaks a consumer that type-checks against it, and only in the positions it
 * actually uses - which is why a TypeScript consumer is sent on to a real
 * type-check rather than being given a guess.
 */
const TS = /\.(m|c)?tsx?:\d+$/;

export function blast(diff, usage) {
  const used = usage ?? {};
  const names = new Set(Object.keys(used).filter(s => !s.startsWith("(") && s !== "*"));
  const removed = new Map(diff.removed.map(r => [r.name, r]));
  const broken = new Map(diff.broken.map(b => [b.name, b]));
  // An unstable tag excuses the owner from a major bump. It does not stop the
  // consumer that used the symbol anyway from breaking.
  const unstable = new Map((diff.unstable ?? []).map(u => [u.name, u]));
  const out = { breaks: [], typeRisk: [], untouched: 0, used: names.size, wildcard: Boolean(used["*"]) };

  for (const name of names) {
    const sites = used[name];
    if (removed.has(name)) { out.breaks.push({ name, why: "export removed", sites }); continue; }
    if (unstable.get(name)?.change === "removed") {
      out.breaks.push({ name, why: "export removed (it was marked unstable)", sites }); continue;
    }
    if (broken.has(name) || unstable.has(name)) {
      const why = broken.get(name)?.why ?? `${unstable.get(name).change} (marked unstable)`;
      const typedSites = sites.filter(s => TS.test(s));
      if (typedSites.length) out.typeRisk.push({ name, why, sites: typedSites });
      else out.untouched++;          // JS only: a type change cannot fail this build
      continue;
    }
    out.untouched++;
  }
  // `export * from "pkg"` re-exports everything, so any removal reaches it.
  const allRemoved = diff.removed.length + [...unstable.values()].filter(u => u.change === "removed").length;
  if (out.wildcard && allRemoved) {
    out.breaks.push({ name: "*", why: `re-exports all; ${allRemoved} export(s) removed`, sites: used["*"] });
  }
  out.verdict = out.breaks.length ? "breaks" : out.typeRisk.length ? "type-check" : "safe";
  return out;
}

/**
 * Split each site into live (reachable from an entry point) and dead. A break
 * with only dead sites fails a whole-project type-check but not the product,
 * and its migration is deleting the file.
 */
export function liveness(b, isLive) {
  const mark = x => ({ ...x, live: x.sites.filter(isLive), dead: x.sites.filter(s => !isLive(s)) });
  const breaks = b.breaks.map(mark), typeRisk = b.typeRisk.map(mark);
  const verdict = breaks.some(x => x.live.length) ? "breaks"
    : typeRisk.some(x => x.live.length) ? "type-check"
    : breaks.length ? "breaks dead code"
    : b.verdict;
  return { ...b, breaks, typeRisk, verdict };
}
