# release-contract

These tools answer, for npm packages with TypeScript declarations, what a
release actually changed and whom it actually breaks. The design, and the case
for making this how releases work, is in
[`docs/release-contract.md`](../../docs/release-contract.md).

```
npm install
npm test                                   # 29 offline tests, no registry needed
```

## The tools

| Command | Answers |
|---|---|
| `node semver-check.mjs <pkg> <from> <to> [--json]` | What did this release do to the API? Declared bump vs computed bump. |
| `node usage.mjs <repo> [pkg…]` | Which exports of which packages does this repo use, and where? |
| `node blast.mjs <repo> <pkg> <from> <to>` | Does this release break this repo? |
| `node consumers.mjs <pkg> <to> <repo>… [--json out]` | The owner's view: before publishing, which consumers break, at which lines? |
| `node audit.mjs <pkg>[@major]… [--json out]` | How often does this package's declared version understate the change? |
| `node fix.mjs <repo> <pkg> <to> [--from v] [--apply]` | Migrate a consumer across a release, using fixes read out of the package itself. |
| `node catalogue.mjs <audit.json>… [--markdown]` | Across audited releases, which kinds of change broke things, how often, and the fix for each. |
| `node hygiene.mjs <repo>… [--json out]` | What in a consumer turns an upgrade into an incident, each finding with its fix. |

Each run installs the two versions side by side under `.work/`, as npm aliases
`old-api` and `new-api`, with install scripts disabled. Set
`RELEASE_CONTRACT_WORK` to move that directory and
`RELEASE_CONTRACT_REGISTRY` to point at a private feed.

## How a verdict is reached

1. **API diff** (`lib/apidiff.mjs`). Every export of the old version is looked
   up in the new one:
   - A value must be assignable from new to old, so code written against the
     old one still compiles.
   - A type must match in both directions, because consumers both build and
     receive it.

   Two things TypeScript compares by identity are normalised away first:
   private and protected members are stripped (with the parser), and each
   `unique symbol` gets a name-based type. Otherwise two copies of an
   identical declaration never match. Generic declarations are compared as
   normalised text, since their type parameters never unify. Only the TSDoc
   release tags (`@beta`, `@alpha`, `@experimental`, `@internal`) exempt a
   symbol. `@deprecated` makes a removal "announced".

   Each incompatible export is then traced to its root cause. The walk goes
   through properties, parameters, returns, overloads, unions and enums, and
   exports are grouped by cause: axios 1.20's 19 incompatible exports are one
   line, `enum HttpStatusCode gained ContentTooLarge, UnprocessableContent`.
2. **Usage index** (`lib/usage.mjs`). This parses each source file with no
   type-check. It records named, renamed, default and namespace imports, JSX
   member tags, `require` destructuring and re-exports.
3. **Reachability** (`lib/reach.mjs`). Follows imports from framework entry
   points through `tsconfig` path aliases. Entry points are:
   - Next.js app and pages routes;
   - the Vite `index.html`;
   - `package.json` entry fields;
   - tests, configs and scripts.

   A usage in a file nothing imports is dead code.
4. **Blast radius** (`lib/blast.mjs`). The diff intersected with the usage:

   | Verdict | When |
   |---|---|
   | `breaks` | a removed export is used in live code |
   | `breaks dead code` | a removed export is used, but only in unreachable files; the fix is deleting them |
   | `type-check` | a type changed incompatibly and a `.ts`/`.tsx` file uses it; run the real type-check |
   | `safe` | none of the above: the release touches nothing this consumer uses, whatever its version says |

5. **Consumer pin** (`lib/resolve.mjs`). The consumer is compared from the
   version its lockfile pins. A `package-lock.json` that is out of sync with
   `package.json` loses to one that is in sync, and the disagreement is
   reported.

## Fixes the package already contains

When a release removes or renames something, the new name is almost always
written down in the package. `lib/remedy.mjs` reads it out while the diff is
taken, from four places:

| Source | Example |
|---|---|
| The old version's `@deprecated` note | `Use \`ContentTooLarge\` instead` |
| An enum renamed in place, matched by name without its prefix, or by value | genai 1.48: `ServiceTier.SERVICE_TIER_FLEX` became `ServiceTier.FLEX` |
| An alias the new version keeps | lucide 1.41: `Trash as Trash2`, so `icons.Trash2` became `icons.Trash` |
| One added export whose declaration is identical to a removed one | a plain rename |

`fix.mjs` turns these into edits at the consumer's exact sites. It keeps local
names, so `import { Trash2 }` becomes `import { Trash as Trash2 }` and nothing
below it changes. It also reports what an edit can't fix:

- **Silent:** string literals holding an enum value the release changed. They
  compile, and silently stop matching.
- **Dynamic:** lookups such as `icons[name]` into a map that renamed keys.
- **Manual:** removals with no named replacement. The owner's note is
  attached, and the report says when deleting a dead file is the whole fix.

Validated on genai 1.47 → 1.48, with a two-file consumer written for the test:

| | `tsc` |
|---|---|
| on 1.47 | passes |
| after the upgrade | 1 error (`SERVICE_TIER_FLEX` does not exist) |
| after `fix.mjs --apply` | passes |

The fixer also flagged the one line `tsc` can't see: a comparison against
`"SERVICE_TIER_FLEX"`, which the API now sends as `"flex"`.

## Consumer hygiene

`hygiene.mjs` looks for what turns an upgrade into an incident, and gives the
fix for each:

- floating specs (`"latest"`, `"*"`);
- a missing lockfile, one out of sync with `package.json`, or two that
  disagree;
- builds that never type-check (`ignoreBuildErrors`, `vite build` without
  `tsc`);
- files no entry point reaches that still import packages;
- runtime dependencies nothing imports;
- deprecated packages. That includes the ones deprecated only in the README,
  where npm's field stays empty and every scanner reads the package as healthy.

## Validated against real builds

| Check | Prediction | Reality |
|---|---|---|
| FamilyTree × lucide-react 0.390.0 → 1.47.0 | safe (17 icons used, none removed) | `vite build` passes |
| FamilyTree + a `Facebook` icon, same release | breaks at `src/FamilyTree.jsx:47` | `vite build` exits 1: `"Facebook" is not exported`, at 47:2 |
| FamilyTree × framer-motion 11.18.2 → 13.4.0 | safe | `vite build` passes |
| portfolio × lucide-react → 1.47.0 | breaks dead code: 4 icons at `components/footer.tsx:2`, which nothing imports | `tsc`: exactly those 4 errors and no others. `next build` passes. |
| portfolio × framer-motion → 13.4.0 | type-check (`motion`, `useAnimation`) | `tsc`: no new errors |
| portfolio × @google/genai 1.46.0 → 2.24.0 | type-check (`GoogleGenAI`) | `tsc`: no new errors |

## Limits

- It checks types, not behaviour. "Safe" means safe to build and test.
- It trusts declarations. A package without them reports
  `untyped - build it`.
- Computed member access (`Icons[name]`) records the namespace, not the name.
- A consumer that subclasses a package class needs the real type-check,
  because protected members are excluded from the comparison.
- Root causes are best-effort. Whether an export is incompatible is always
  the compiler's verdict; the walk that explains why can pair overloads or
  union members imprecisely.
