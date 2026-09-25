# The release contract

A proposal for how packages should be released: a standard way for anyone who
publishes a package to know, before publishing, exactly what a release changes
and exactly whom it breaks. Written from the package owner's side of the MCSR
problem.

[`dependency-upgrade-platform.md`](dependency-upgrade-platform.md) and
[`upgrade-pilot-flow.md`](upgrade-pilot-flow.md) cover the consumer side: a
scanner says upgrade, and a team works out what that costs. This document goes
upstream. Most of that consumer cost exists because the release in front of them
gave them almost nothing to work with: a version number and a changelog.

Everything claimed here was run against real packages and real repositories.
The tools are in [`tools/release-contract/`](../tools/release-contract/).

---

## The idea in one paragraph

A version number is a prediction. The owner makes it once, for every consumer
at once, knowing almost nothing about any of them. The prediction is "this
release won't break you" (a minor or patch) or "this release might break you"
(a major). Both halves fail. Minors break people, so consumers stop trusting
ranges and pin everything. Majors are all-or-nothing, so consumers stall on them
even when nothing they use changed. Pinning plus stalling is how an organisation
ends up with an MCSR backlog.

**The release contract replaces the prediction with two computations.** The
first is what the release did to the API, checked by a compiler, not described
by a person. The second is which consumer uses which of the changed symbols,
and where. The version number becomes a derived fact the registry enforces. The
decision to upgrade stops depending on the version number at all.

---

## What package owners actually face

The consumer's problems are well known. The owner's are the same problems seen
from the other end, and they are the ones worth fixing, because each owner
decision is multiplied by every consumer.

**1. The owner cannot see who uses what.**
A registry can say who depends on a package. It cannot say who calls
`Github` from `lucide-react`, or who reads `GoogleGenAI.interactions`. Azure
Artifacts cannot even say who depends: there is no reverse-dependency endpoint.
So every removal is a guess. Owners respond in one of two ways. Some never
remove anything, and the API only grows: lucide-react went from 4,927 exports
to 6,335. Others remove things and find out from the bug reports.

**2. Semver is filled in by hand, and hand-filled numbers are wrong.**
Nothing checks the number an owner types. The audit in this repository compared
the declared bump with the computed one across the real release history of four
packages this estate depends on (results under
[the evidence](#the-evidence)). Clearest example: `@google/genai` 1.48.0 is
declared a minor. It renamed every member of the `ServiceTier` enum and changed
every value: `SERVICE_TIER_FLEX = "SERVICE_TIER_FLEX"` became
`FLEX = "flex"`. Code that names a member stops compiling. Code that compares
the old strings keeps compiling and silently stops matching.

**3. Stability promises aren't machine-readable.**
The genai README calls its Interactions API beta. Nothing in the type
declarations does, and 1.43.0, a minor, made fields required that 1.42 left
optional (`input.call_id`). Nothing but a README can say whether that was
allowed, and a bot, a checker or a consumer's CI cannot read a README. Where
tags do exist, they collide. lucide-react puts `@preview` on every icon to
embed a picture of it. The first version of the checker here took that to
mean "preview API", excused every removal, and hid a real finding in
`portfolio`. A promise is only a promise when a program can read it.

**4. Deprecation doesn't reach the people it is addressed to.**
lucide-react did everything by the book. Every brand icon carried
`@deprecated … This icon will be removed in v1.0`, and they were removed in
1.0. `portfolio/components/footer.tsx:2` still imports four of them. A
deprecation notice is a tooltip in an editor, shown only if someone hovers over
that exact import, so nobody did. It happens that nothing imports
`footer.tsx`, so the right migration is deleting it. Neither side could know
that. The owner saw only a download count; the consumer saw nothing at all.

**5. A major release is all-or-nothing.**
framer-motion 13 removed 33 exports and changed 99 more. FamilyTree uses two of
them, neither affected, and upgraded with a green build. But "13.0.0" told
FamilyTree the same thing it told everyone: *might break you*. The version
number can't say "not you", so every consumer pays the full review cost of the
worst-affected consumer. That is why majors pile up in MCSR reports.

**6. The breaker doesn't migrate.**
The owner knows exactly what changed. Each consumer has to rediscover it from a
changelog, separately, often months later, by someone who has never read the
package's source. The work is done N times by the people least equipped to do
it.

**7. Security fixes land on the newest line only.**
Scanners report a CVE with a "fixed in" version, which is usually on the newest
major. A consumer on a release branch such as 26.1, where only patches are
allowed, has no legal upgrade. The owner didn't backport because nothing told
them who was stuck on the old line.

**8. Consumers' build hygiene hides the damage.**
All of this is in `portfolio`, in this estate:
- It declares `"lucide-react": "latest"`.
- It ships two lockfiles that disagree: `package-lock.json` says 0.484.0 and
  `pnpm-lock.yaml` says 0.577.0. The npm one is out of sync with
  `package.json`, so `npm ci` refuses it outright.
- Its `next.config.mjs` sets `typescript.ignoreBuildErrors: true`.
- `next build` with lucide-react 1.47.0 installed prints "Compiled
  successfully" and exits 0.

The type-checker doesn't gate that build, and the bundler only sees files that
some page imports. Nothing imports `footer.tsx`, so nothing complains, and
here that happens to be harmless. Whether a removed export breaks the product
depends on whether any page reaches the file that imports it. An owner can't
design around every consumer's configuration. The contract has to answer that
question itself, and hold even when the consumer's own safety nets are
switched off.

---

## The contract

Nine rules. Between them they close the problems above. None needs a new
ecosystem: most are already done somewhere, and the rest can be built from
existing parts. What is new is putting them together and making the registry
enforce them.

### 1. Versions are computed; the declared number may only be higher

At publish time, CI installs the last published version next to the candidate
and asks the compiler whether every export of the new one is still assignable
to what the old one promised. That gives:

- **major**: a removal without prior deprecation, or a change the compiler
  proves incompatible.
- **minor**: an addition, a widening, or the removal of something already
  deprecated.
- **patch**: no API change.

If the declared version is lower than the computed one, the publish fails. The
owner can always declare higher.

*Precedent:*
- Elm's package manager has computed and enforced versions for about a
  decade; you cannot publish a wrong one.
- Rust has `cargo-semver-checks`; Go has `gorelease`.
- .NET has this built in: `<EnablePackageValidation>` with
  `PackageValidationBaselineVersion` checks API compatibility against the last
  version at pack time.
- For TypeScript, `tools/release-contract/semver-check.mjs` does it.

### 2. Stability is declared in the types, from a closed vocabulary

The tags are the TSDoc release tags (`@public`, `@beta`, `@alpha`,
`@experimental`, `@internal`) plus `@deprecated`, and nothing else counts. An unstable symbol
may change in a minor. The contract still tracks it, because a consumer that
used it anyway still breaks (rule 4 reports it). Prose in a README has no
standing.

*Precedent:* Microsoft's API Extractor is built on these tags, and writes an
`.api.md` report that makes every public API change visible in review.

### 3. Every consumer publishes a usage index

Each consumer's CI records which exports of which packages it uses, and where:
`lucide-react → Github → components/footer.tsx:2`. It covers named, renamed,
default and namespace imports, JSX member tags such as `<motion.div>`,
`require` destructuring and re-exports. The index is small, cheap to build
(one parse, no type-check), and posted to wherever the packages live. For an
MNC on Azure DevOps, that means one artifact per build, collected per feed.

This is the piece no registry has, and the one everything else depends on. It
turns "who depends on this package" into "who uses this symbol".

*Built:* `lib/usage.mjs`, `usage.mjs`.

### 4. A release is checked against every consumer before it is published

Reverse CI. For each indexed consumer, the release's diff is intersected with
what that consumer uses:

| Consumer uses… | Verdict |
|---|---|
| a removed export, in a file reachable from an entry point | **breaks** |
| a removed export, only in files nothing imports | **breaks dead code**: a full type-check fails, the product doesn't; the migration is deletion |
| an export whose type changed, from a TypeScript file | **type-check**: run the consumer's real type-check against the candidate |
| an export whose type changed, from JavaScript only | **safe**: a type change can't fail a JS build |
| nothing that changed | **safe**, whatever the version number says |

"Reachable" is computed, not assumed. Imports are followed from the
framework's entry points (Next.js routes, the Vite `index.html`, `package.json`
entry fields, tests), through `tsconfig` path aliases.

Only the type-check row costs anything, and only for the consumers whose used
symbols changed type. This is the verification funnel:

```
  package diff         5,299 exports (lucide-react)     seconds, once per release
       │
  symbol intersection  × each consumer's usage index    milliseconds per consumer
       │
  consumer type-check  only "type-check" verdicts       one tsc per affected consumer
       │
  consumer build/tests only where types can't decide    the expensive step, rarely run
```

*Precedent:* Rust's crater compiles every public crate against a candidate
compiler. Here the check runs against the consumers a package actually has,
and the intersection step means most of them never need building.

*Built:* `lib/blast.mjs`, `lib/reach.mjs`, `blast.mjs` (one consumer),
`consumers.mjs` (all of them).

### 5. The breaker migrates

A release whose consumer check finds breaks has to ship the fix with it. For an
internal package that means pull requests to the affected repositories, opened
by the release pipeline, pointing at the exact sites the check found. For a
public package, it means a codemod in the release. The owner is the only person
who knows both sides of the change, and after rule 3 they also know every site.

A **breaking-change budget** makes this proportionate. A release may break up
to *N* consumer sites without migrations (say 0 on a release train, 5
elsewhere). Beyond that, the migrations are part of the release.

*Precedent:* the large-scale-change practice described in *Software
Engineering at Google*: whoever changes a shared API fixes its callers,
mechanically, in the same change.

*Built:* `lib/remedy.mjs` reads the migration out of the package itself (a
deprecation note naming the replacement, a kept alias, an enum renamed in
place), and `fix.mjs` applies it at the consumer's sites.

### 6. Deprecation counts usage, not calendar time

A deprecated symbol can be removed once the usage index shows no consumer
using it, or when every remaining consumer has a migration PR open. It does
not wait for a date. The notice is delivered to the site itself, as a work item
or PR against `footer.tsx:2`, not as an editor tooltip. The owner sees a
countdown ("`Github`: 1 consumer, 1 site") and removes it the day it reaches
zero.

lucide-react removed 51 brand icons after a public deprecation. `portfolio`
still imported four of them, from a file no page reaches. Under this rule the
owner would have seen "`Github`: 1 consumer, 1 site, dead code" before
publishing 1.0. portfolio would have had a one-line PR deleting a dead file,
instead of a type error waiting for whoever next turns type-checking back on.

### 7. Consumers upgrade by intersection, not by version number

Auto-merge eligibility is the consumer-specific verdict, not the bump type:

- **safe** merges itself, even across a major. framer-motion 11 → 13 is safe
  for FamilyTree.
- **type-check** merges itself when the real type-check passes.
- **breaks** never merges itself, even on a patch.

This is the inversion that clears MCSR backlogs. Most majors break almost
nobody (see the evidence), and "almost nobody" is now a named list.

*Precedent:* Renovate's "merge confidence" estimates the same thing from
statistics: how many other repositories upgraded and passed. The usage index
answers it for this specific repository.

### 8. Every release publishes a manifest

A machine-readable file next to the package, which scanners, bots, portals and
auditors read instead of a changelog:

```json
{
  "contract": "release-contract/v0",
  "package": "lucide-react",
  "version": "1.0.0",
  "previous": "0.577.0",
  "declared": "major",
  "computed": "major",
  "api": {
    "removed":   [{ "name": "Github", "announced": "0.x @deprecated" }],
    "broken":    [],
    "causes":    [],
    "unstable":  [],
    "added":     ["..."]
  },
  "consumers": [
    { "repo": "portfolio", "from": "0.577.0", "pinnedBy": "pnpm-lock.yaml",
      "verdict": "breaks dead code", "dead": ["components/footer.tsx:2"],
      "migration": "PR !1234: delete components/footer.tsx" },
    { "repo": "FamilyTree", "from": "0.390.0", "verdict": "safe", "used": 17 }
  ],
  "security": { "fixes": ["CVE-…"], "lines": ["1.0.1", "0.577.1"] },
  "trains":   ["26.1"]
}
```

`api.causes` lists root causes, not the cascade. When axios 1.20 reports 19
incompatible exports, its manifest says one thing:
`enum HttpStatusCode gained ContentTooLarge, UnprocessableContent`. That is
the line an owner can act on.

The `security.lines` field is how rule 9 and the MCSR scanner meet. A fix
names every supported line it was published on, so a scanner can recommend the
patch on your line instead of the newest major.

### 9. Release trains are certified sets, not branch names

A release train such as 26.1 is a set of `(package, version)` pairs. Each
package's consumer check passes against every consumer on the train. Changes
to a train are held to the strictest budget:

- computed **patch** only;
- zero consumer sites broken;
- security fixes backported to the train's line by the owner, because the
  manifest shows who is on it.

A train is certified when every member's check is green, and it stays
certified as long as that holds.

---

## The evidence

All of it was produced by the tools in `tools/release-contract/`, against the
public registry and the repositories under github.com/i-am-epic.

### Owner view: one release, every consumer

`node consumers.mjs <package> <version> <repos…>` compares each consumer from
the version its lockfile pins, which is what it would actually jump from.
Verdicts were then checked against the compiler or the bundler wherever that
could be run.

| Release | Consumer (pinned) | Release did | Consumer uses | Verdict | Checked against reality |
|---|---|---|---|---|---|
| lucide-react 1.47.0 | FamilyTree (0.390.0) | 54 removed, 4 incompatible | 17 icons | safe | `vite build` passes on 1.47.0 |
| | ipodigest (0.447.0, no lockfile) | 54 removed, 4 incompatible | 2 | safe | — |
| | **portfolio (0.577.0, pnpm)** | 57 removed, 1 incompatible | 17 | **breaks dead code**: `Instagram`, `Twitter`, `Linkedin`, `Github` at `components/footer.tsx:2`, which nothing imports | `tsc`: exactly those 4 errors, no others. `next build`: exits 0. |
| framer-motion 13.4.0 | FamilyTree (11.18.2) | 33 removed, 99 incompatible | 2 | safe | `vite build` passes |
| | portfolio (12.38.0, pnpm) | 0 removed, 171 incompatible | 4 | type-check (`motion`, `useAnimation`) | `tsc`: no new errors |
| | switchup (12.42.2) | 0 removed, 171 incompatible | 2 | type-check (`motion`) | `tsc`: 0 errors before, 0 after |
| @google/genai 2.24.0 | FamilyTree (1.27.0) | 1 removed, 29 incompatible | 1 | safe | — |
| | portfolio (1.46.0) | 0 removed, 35 incompatible | 1 | type-check (`GoogleGenAI`) | `tsc`: no new errors |

**Negative control.** A FamilyTree variant that renders lucide-react's
`Facebook` icon:

- The check predicted **breaks** at `src/FamilyTree.jsx:47`.
- `vite build` exited 1 on 1.47.0 with `"Facebook" is not exported`, at 47:2.
- The same variant built cleanly on 0.390.0.

So a removal in a live file fails the build, and a removal in a dead file fails
only a whole-project type-check. The check tells the two apart.

What it adds up to: three majors that a version-number policy would hold for
review in all eight places they appear.

- Four are **safe**, without anything being built.
- Three need a **type-check**, and all three type-checks came back with no new errors.
- One is **breaks dead code**, fixed by deleting a file nobody uses.

By the check, nothing in this estate breaks on any of these majors, and every
prediction that could be run against a compiler or a build held. The version
numbers said "might break you" eight times. The contract says it once, about a
dead file, and names the line.

### Owner view over time: what "minor" meant in 40 real releases

`node audit.mjs` takes the newest patch of each minor line and computes what
each step did. It covers the last ten minor steps of four packages this estate
uses. Every step here was declared a minor.

| Package | Steps | Computed patch | Computed minor | Computed major | Removed a named export |
|---|---|---|---|---|---|
| @google/genai 1.42 → 1.52 | 10 | 0 | 2 | **8** | 0 |
| axios 1.10 → 1.20 | 10 | 2 | 1 | **7** | 0 |
| lucide-react 1.38 → 1.48 | 10 | 0 | 7 | **3** | 0 |
| framer-motion 12.33 → 12.43 | 10 | 8 | 2 | 0 | 0 |
| **Total** | **40** | 10 | 12 | **18** | **0** |

Two packages couldn't be audited:
- zod 4.x: loading two copies of its types exceeds a 4 GB heap.
- zustand 5: it has shipped no minor releases.

**What the numbers say.** Owners are disciplined about the thing everyone
watches: no minor removed a named export. They aren't disciplined about the
thing nobody can see. Close to half of these minors (18 of 40) contain a
change the compiler proves incompatible, meaning some code written against
the previous version stops compiling. The checker traces each one to its root
cause, and each cause below was also confirmed in the declaration files:

- **An enum renamed.** genai 1.48 renamed and re-valued all four `ServiceTier`
  members (above). It is the only root cause the checker finds behind that
  release's 17 incompatible exports: `enum ServiceTier lost
  SERVICE_TIER_UNSPECIFIED, SERVICE_TIER_FLEX, …`.
- **A value added to an output enum.** genai 1.44 added two values to
  `TrafficType`, which appears in response usage metadata. axios 1.20 added
  `ContentTooLarge` and `UnprocessableContent` to `HttpStatusCode`, as new
  names for 413 and 422. A consumer with an exhaustive `switch` over either
  stops compiling.
- **A callback gained a required parameter.** axios 1.16 gave `beforeRedirect`
  a third parameter, `requestDetails`, reached from 13 exports. Consumers that
  pass their own callback are fine. Code that calls `beforeRedirect` from a
  config axios returns (`mergeConfig`, `defaults`) is not. Writing
  `requestDetails?:` would have kept it a true minor, at no cost.
- **A signature rewritten.** axios 1.17 split `AxiosHeaders.toJSON` into three
  overloads with narrower return types. axios 1.19 changed `AxiosHeaders.get`
  to take a parser function where it took a `RegExp`.
- **An untagged beta API tightened.** genai 1.43 made `call_id` required and
  narrowed `mime_type` to known values in the Interactions request types. With
  a `@beta` tag (rule 2) this is allowed in a minor. Without one, it isn't.
- **An alias kept, a map entry dropped.** lucide-react 1.41 turned `Trash2`
  into an alias of `Trash`. `import { Trash2 }` still works, but `icons.Trash2`
  is gone. Any dynamic lookup by name (`icons[name]`, the usual icon-picker
  pattern) now gets `undefined` at runtime. 1.44 and 1.45 did the same to five
  more icons. The checker reports these as `icons.Album removed`, and so on.

Two lessons for the design:

1. **The count of broken exports measures how connected a package's types
   are, not how big the change was.** axios 1.20 reports 19 incompatible
   exports. The checker traces all of them to one line:
   `enum HttpStatusCode gained ContentTooLarge, UnprocessableContent`. It is
   reached through `beforeRedirect`'s `statusCode`, inside a request config
   that appears everywhere. A release manifest should list root causes, not
   the cascade.
2. **"Computed major" is strict, and that is the point.** It proves that some
   code breaks, not that yours does. Acting on the package-level answer alone
   would stall most axios and genai upgrades. That is why the contract never
   stops there. The per-consumer intersection decides, and the evidence above
   shows it is usually "safe". The owner-side value is timing: every one of
   these causes costs nothing to avoid while the PR is open, and a lot once
   it's published.

### What the checker got wrong, and why that matters

The checker was wrong six times while this was being built. Each mistake was
found by checking a prediction against a real compiler or build, and each is a
lesson for anyone building this for real:

1. **Some types compare by identity, not shape.** Classes with private or
   protected members and `unique symbol` declarations are nominal in
   TypeScript: two copies of an identical declaration are never compatible.
   The first fix stripped private members with a pattern, and missed one
   written across several lines in genai's HTTP client. Everything that
   mentioned the client looked broken, which made genai 1.45 compute as a
   major when it's a clean minor. Members are now removed with the TypeScript
   parser, and each unique symbol gets a name-based identity that both copies
   share.
2. **Generic types can't be compared by assignability.** `Operation<T>` in one
   version and `Operation<T>` in the next have unrelated type parameters, so
   they never match. Generic type declarations are now compared by normalised
   text, and a difference goes to review instead of being called a break.
3. **`@preview` isn't a stability tag.** Accepting a loose vocabulary let
   lucide-react's image tag mark every icon unstable. That excused the
   removals and hid the portfolio finding entirely. The vocabulary is now the
   closed TSDoc set (rule 2), and a test pins it down.
4. **The first lockfile found isn't the one that installs.** portfolio's
   `package-lock.json` is out of sync with its `package.json`. The check now
   prefers an in-sync lockfile and reports when lockfiles disagree.
5. **A usage isn't a use.** The first verdict for portfolio was "breaks". The
   type-checker agreed; `next build` didn't, because the importing file is dead.
   The usage index now carries reachability from entry points, and the verdict
   says which kind of break it is.
6. **A count isn't a cause.** Twice while writing this, a root cause was
   guessed from the number of broken exports, and twice the guess was wrong.
   The checker now explains itself. It walks each incompatible export down
   through properties, parameters, returns, overloads, unions and enums to the
   smallest change behind it, and groups the exports by that change.

Three of them are the contract's own rules, learned the hard way. The third
is rule 2. The fifth is why rules 4 and 6 count reachable usage, not text
matches. The sixth is why the manifest (rule 8) lists root causes.

---

## What actually breaks, and the fix for each

The audit's 18 incompatible minors have 72 root causes between them.
`catalogue.mjs` sorts them by kind. A few habits cause almost all of it, and
each has a fix on both sides: one the consumer can apply, and one the owner
could have made for free while the PR was open.

| Kind of break | Breaking minors (of 18) | Consumer fix | Owner prevention |
|---|---|---|---|
| A type changed shape | 11 | Run the type-check; the verdict lists the sites | Widen instead of replacing: a union of the old and new shape |
| A value added to an output enum or union | 9 | Nothing, unless a `switch` is exhaustive; then add a default | Declare output enums open (`\| (string & {})`) |
| A parameter or field became required | 6 | Supply it at the listed call sites | Make it optional with a default |
| An input stopped accepting a value | 5 | Change the value at the listed sites | Keep accepting it and deprecate it |
| A signature rewritten | 4 | Run the type-check | Add an overload next to the old one |
| An export or member removed | 3 | **Automatic** when the package names the replacement | Keep an alias and name the replacement in `@deprecated` |
| Enum members renamed | 1 | **Automatic**, plus a silent-break scan | Keep the old member as a deprecated alias |

A release can contain several kinds, so the counts overlap. "Type changed
shape" is also the catch-all for anything the explanation walk can't pin down
more precisely.

The owner column is the argument for running the check at PR time. Every
prevention in it is a one-line change while the PR is open. After publishing,
the same change costs a major release.

### The fix is usually already in the package

When a release renames or removes something, the new name is almost always
written into the package itself:

- a `@deprecated` note that says what to use instead;
- an alias the owner kept;
- an enum renamed in place;
- a declaration that is identical apart from its name.

`lib/remedy.mjs` reads these out while the diff is taken. `fix.mjs` applies
them at the consumer's exact sites. There's no changelog to read and no model
guessing. It found:

| Release | Remedies found in the package |
|---|---|
| genai 1.48 | all four `ServiceTier` renames, each with old and new value |
| lucide-react 1.41, 1.44, 1.45 | `icons.Trash2` → `icons.Trash`, and five more, from the aliases kept at top level |
| lucide-react 0.484 → 1.47 | 54 icons renamed inside `icons` (for example `Smile` → `FaceSlightlySmiling`) |

Across the audited minors, the package itself resolved every rename and
removal: 10 remedies, none missing. The 54 brand icons lucide 1.0 dropped have
no replacement in the package. For those, the fixer carries the owner's note
and, for portfolio, says the fix is deleting a dead file.

**Checked against the compiler.** The consumer is a small one written against
genai 1.47 for the test, since none of these repos uses `ServiceTier`. The
package versions are the real ones.

| Step | `tsc` |
|---|---|
| on 1.47.0 | passes |
| upgraded to 1.48.0 | fails: `SERVICE_TIER_FLEX` does not exist |
| after `fix.mjs --apply` | passes |

The fixer also reported the break `tsc` can't see. A second file compares a
stored string with `"SERVICE_TIER_FLEX"`. That still compiles, and after the
upgrade the API sends `"flex"`, so the comparison silently never matches.
Silent breaks like this are what reach production. The check finds them
because it knows both values of every renamed member.

Rule 5 (the breaker migrates) gets cheaper because of this. An owner who keeps
an alias and writes the replacement's name into `@deprecated` has already
written the migration; every consumer's fix is automatic.

### The consumer's half: hygiene

Some breakage is caused by the consumer's own setup: nothing in the package
changed, and the upgrade still hurts. `hygiene.mjs` found all of the following
in five of this estate's npm projects:

| Finding | Where | Why it hurts |
|---|---|---|
| `"latest"` as a version spec | portfolio (`lucide-react`, `clsx`) | a fresh install can jump a major |
| Two lockfiles disagreeing on 9 packages; the npm one out of sync | portfolio | `npm ci` refuses it, and which versions ship depends on the tool |
| No lockfile | ipodigest/frontend | every install resolves ranges afresh |
| `ignoreBuildErrors: true` | portfolio | an incompatible upgrade builds, and fails at runtime |
| Files no entry point reaches, still importing packages | portfolio (9), ipodigest (2), switchup (1) | every upgrade "breaks" code nothing runs |
| Runtime dependencies never imported | portfolio (`axios`, `next-auth`), FamilyTree | scanner findings and upgrade PRs for code that never runs |
| A package whose end of support is announced only in its README | FamilyTree: `@google/generative-ai` ("now considered legacy") | npm's `deprecated` field is empty, so every scanner reads it as healthy |

The last row is problem 3 again, from the other side. A promise nobody can
read by program might as well not exist, and the hygiene check reads the
README because the registry field is empty.

---

## How it runs on Azure DevOps

```
 owner repo (package)                        consumer repos (every one)
 ─────────────────────                       ──────────────────────────
 PR ─► build ─► semver-check                 build ─► usage index artifact ─┐
                  │ computed ≥ declared?                                     │
                  ▼                                                           │
          consumer check ◄──────── usage indexes, collected per feed ─────────┘
                  │  breaks / type-check / safe per consumer
                  ├─► type-check jobs, only for "type-check" verdicts
                  ├─► migration PRs for "breaks" (rule 5) — or fail on budget
                  ▼
          publish to feed @prerelease + release manifest
                  │
          promote to @release view  ◄── only when the manifest is green
                  │
                  ▼
 consumers: bot opens upgrade PRs;  "safe" → auto-complete;  "type-check" → auto-complete on green
```

- **Feed views** already exist in Azure Artifacts (`@local`, `@prerelease`,
  `@release`). Promotion to `@release` becomes the contract gate, and
  consumers' upstream sources point at `@release`.
- **The usage index** is a pipeline artifact from each consumer build, the
  same step that already runs `inventory.py` in Upgrade Pilot.
- **Migration PRs and deprecation notices** are ADO pull requests and work
  items against the exact file and line.
- **.NET packages** get rule 1 from the SDK's package validation.
  **Python packages** can use `griffe check`. The contract is
  ecosystem-neutral; only the checker is per-language.
- **The owner view** in the Upgrade Pilot hub shows a package, its consumers
  and their verdicts, its deprecation countdowns, and its scorecard.

### The owner scorecard

Per package, from the manifests:

- declared-vs-computed agreement;
- consumer sites broken per release;
- migrations shipped per break;
- deprecated symbols still in use, and by whom;
- supported lines that carry each security fix.

It measures what consumers experience, not how often the owner ships.

---

## What exists, and what doesn't

Built and tested (`tools/release-contract/`, 29 offline tests plus the
real-world runs above):

- computed semver for npm packages with TypeScript declarations
  (`semver-check.mjs`);
- the symbol usage index (`usage.mjs`);
- the single-consumer blast radius (`blast.mjs`), with reachability from entry
  points;
- the owner's pre-publish consumer check (`consumers.mjs`);
- the release-history audit (`audit.mjs`) and the break catalogue
  (`catalogue.mjs`);
- remedies read from the package, and the fixer that applies them
  (`fix.mjs`), with silent-break detection for changed enum values;
- consumer hygiene (`hygiene.mjs`).

Not built:

- the collection service for usage indexes;
- the feed-promotion gate;
- opening migration PRs (the edits exist; `fix.mjs --apply` makes them locally);
- the manifest as a published artifact (today `consumers.mjs --json` writes
  its consumer section);
- the owner view in the hub;
- checkers for other ecosystems.

### Limits, stated plainly

- **Types, not behaviour.** The checker proves that code still compiles
  against the new API. It can't see a function that keeps its signature and
  changes what it returns. That is what the consumer's own tests are for, and
  why "safe" means "safe to build and test", not "safe to ship untested".
- **Declarations are the ground truth.** A package whose `.d.ts` files are
  wrong or missing (`untyped - build it`) falls through to a real build.
- **Dynamic access is invisible.** `Icons[name]` records the namespace
  import, not the name. The wildcard rule treats it conservatively.
- **Entry points are recognised by convention.** Next.js, Vite, `package.json`
  entry fields, tests, configs and scripts. When none is recognised, every file
  counts as live, which is the safe direction.
- **Subclassing.** Protected members are excluded from the comparison, so a
  consumer that extends a package's class needs the real type-check, and gets
  it only if its usage shows the class being used.
- **Root causes are best-effort.** The walk takes signatures apart outside
  TypeScript's own unification of type parameters, and pairs overloads and
  union members by resemblance. The incompatibility itself is always the
  compiler's verdict; the explanation of it can be imprecise.
- **Very large type graphs.** Two copies of zod's types exceed a 4 GB heap.
  Packages that size need comparing one export at a time.

---

## Where to start

1. **Measure.** Run `audit.mjs` over the internal packages the estate
   publishes. If the declared numbers are as unreliable as the public ones,
   that is the business case.
2. **Gate the owners.** Add `semver-check` to every internal package's
   publish pipeline: computed ≥ declared. No consumer changes needed.
3. **Index the consumers.** Add the usage index to the consumer builds that
   already run Upgrade Pilot.
4. **Check before publishing.** Run `consumers.mjs` in the publish pipeline
   against the collected indexes. Start in report-only mode.
5. **Switch auto-merge to intersection.** "Safe" and passing "type-check"
   verdicts complete themselves. The MCSR backlog should shrink to the
   releases that actually touch the code.
6. **Only then add the obligations:** the breaker migrates, deprecation by
   countdown, and certified trains. They are cheap once the owner can see
   every site, and unfair to demand before.
