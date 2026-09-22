# Upgrade Pilot: the flow, and what is missing

A handoff for whoever picks this up next. It describes what happens today, what
is deliberately absent, and what has to exist before the thing does what its
design note promises.

Read [`dependency-upgrade-platform.md`](dependency-upgrade-platform.md) first for
the why. This is the what-now.

---

## The honest summary

**What was built is an analyser, not an upgrader.**

The design note describes four layers: an inventory of facts, a change engine,
a repair agent, and a surface. The toolchain in `tools/upgrade-pilot/` implements
layer 1 well, a narrow slice of layer 2, and a first cut of layer 4. **Layer 3 —
the agent that fixes what the upgrade broke — does not exist at all.**

That matters because layer 3 was the entire argument. Renovate and Dependabot
already bump versions for free; the reason to build anything was that neither of
them fixes the build afterwards. `apply.py` bumps and reverts. When the bump
breaks the build it reverts and writes the failure down. Nothing reads the
changelog, edits the call sites, and tries again.

So the current state is genuinely useful — it answers *what should change and
what will that cost* across four ecosystems, which no off-the-shelf tool does
with this much specificity — but it is not yet the thing that saves the hours.

---

## The flow as it runs today

```
 ┌─ pipeline (scheduled, Monday 02:00) ────────────────────────────────┐
 │                                                                      │
 │  restore            npm ci / dotnet restore / flutter pub get        │
 │    │                so the LOCKFILE reflects this branch             │
 │    ▼                                                                 │
 │  inventory.py       read resolved versions, not manifest ranges      │
 │    │                resolve latest + peers + engines + deprecation   │
 │    │                derive changelog URLs from registry metadata     │
 │    ▼                                                                 │
 │  [scanners]         Trivy · Sonar · MetaDefender → JSON on disk      │
 │    │                                                                 │
 │    ▼                                                                 │
 │  scans.py           normalise to one finding model                   │
 │    │                tag OS packages so they route to the base image  │
 │    ▼                                                                 │
 │  report.py          correlate findings ↔ inventory                   │
 │    │                apply BRANCH POLICY  (release = security only)   │
 │    │                apply AUTO-MERGE GATE (Sonar coverage)           │
 │    │                → plan.json + summary.md                         │
 │    ▼                                                                 │
 │  apply.py           baseline verify → per package: install, verify,  │
 │    │                keep or revert → applied.json                    │
 │    ▼                                                                 │
 │  publish            artifact "upgrade-pilot" + build summary         │
 │    │                push bot branch, draft PR on release branches    │
 └────┼─────────────────────────────────────────────────────────────────┘
      ▼
   ado-extension      reads the artifact, renders the evidence in the portal
```

Three decisions are load-bearing and worth defending in review:

1. **Lockfile, not manifest.** A caret range silently absorbs minors. Running this
   against a real repo showed `vite ^5.3.1` resolving to `5.4.21` — so the "safe
   minor bumps" a manifest analysis proposes are frequently already applied.
2. **The branch decides the policy.** `release/*` takes security fixes only, at the
   smallest version that clears the finding. Routine currency lands on main and
   reaches the release branch by merge, never the reverse.
3. **Auto-merge is gated on test quality, not version distance.** A patch bump into
   an untested repo is riskier than a major into a tested one.

---

## What exists, and how far it is trusted

| Component | State | Evidence |
| --- | --- | --- |
| `inventory.py` npm / PyPI / pub | works | run against real repositories |
| `inventory.py` NuGet | **never executed** | no .NET repo was available |
| `scans.py` Trivy | works | run against fixtures |
| `scans.py` Sonar | works | run against fixtures |
| `scans.py` MetaDefender | **untested against a live instance** | envelope differs cloud vs on-prem |
| `report.py` branch policy | works | two policies, different plans, same findings |
| `report.py` auto-merge gate | works | fixtures |
| `apply.py` | works | real repo: baseline check, 2 applied, 3 reverted |
| `azure-pipelines.yml` | **never run** | parses; the scripts it calls are verified |
| `ado-extension` | **never run in ADO** | typechecks, bundles, localhost preview only |

---

## Missing: the things that block the premise

### 1. The repair agent — the whole point

When `apply.py` reverts a package, that is where the work actually starts, and
today it is where the tool stops. What is needed:

```
on revert:
  read  the failure output already captured in applied.json
  fetch the changelog URL already resolved in inventory.json
  scope the edit to files that reference the upgraded package
  apply the migration, re-run verification
  on success → keep, annotate the receipt with what changed and why
  on failure → revert, write the handover note
```

Every input it needs is already produced and thrown away. The failure text is in
`applied.json`. The changelog URL is in `inventory.json`. The blast radius is a
grep. Wiring is most of the work; the loop itself is small.

Guardrails belong in the harness, not the prompt — CI should reject the run if the
diff touches test files without an explicit label, and reject any diff that skips,
disables or quarantines a test.

**A worked example this must handle:** upgrading Tailwind 3 → 4 in a real repo
failed with an error that names its own fix (`the PostCSS plugin has moved to a
separate package`). Installing `@tailwindcss/postcss`, switching the plugin key
and replacing the `@tailwind` directives with the v4 CSS-first entry took eleven
lines and the build went green. That is exactly the class of failure to target
first: an actionable error message plus a documented migration.

### 2. The verification contract

The design note defines closure precisely. None of it is implemented. `report.py`
emits a plan and `apply.py` emits what it did, but nothing asserts the finding is
actually gone. Required:

- regenerate the SBOM on the upgraded branch
- assert the advisory ID is absent
- assert the **resolved** version clears the fix, transitively
- assert no new advisory appeared (before/after SBOM diff)
- emit a receipt per finding, **written by CI, not by the agent**

That last clause is the point: an agent that writes its own evidence is not
evidence. Until this exists, "fixed" is a claim rather than a fact, and the whole
thing fails an audit.

### 3. Fleet scope

Everything is per-repository. There is no store, so none of the estate-level
questions in the design note can be answered: who else uses this package, which
repos share a version, what is the drift per library, where is the cycle. The
inventory rows are already shaped for it — they need somewhere to land and a
`repo` column.

---

## Correctness gaps — closed

These are fixed, with tests. Kept here because the reasoning is the useful part.

| Gap | Why it bit | Resolution |
| --- | --- | --- |
| No cross-scanner dedupe | Trivy and MetaDefender both report CVEs, and an image scan overlaps the source scan, so the same advisory counted twice and inflated every figure in the report. | `scans.dedupe` keys on `(advisory, package)`; the survivor keeps the highest severity, the most specific fixed version, a known ecosystem over an unknown one, and every reporting source. |
| `guess_eco` defaulted to npm | On a mixed repository this sent `npm install` at NuGet packages. | `apply.resolve_eco` returns `None` when the ecosystem cannot be established, and the package is skipped with that reason recorded. Scanner types are mapped to one vocabulary; an unrecognised type is `unknown`, never a guess. |
| No exception / VEX path | An unfixable or formally accepted finding reappeared every run with no way to answer it. | `exceptions.json`, where every entry needs an expiry. An expired entry stops suppressing and is reported under its own heading. Suppressed findings are listed, never silently dropped. |
| No registry retry or caching | One rate-limited response and the inventory was silently incomplete — the error was swallowed into `{"error": ...}` and every missed package read as "nothing to upgrade". | Three attempts with backoff on 429, 5xx and transport errors; 404 distinguished from unreachable; answers cached to disk. **`inventory.py` now exits 2** when anything could not be resolved, unless `--allow-incomplete`. |
| The toolchain had no tests | Uncomfortable, given it refuses to auto-merge repos whose tests it does not trust. | 36 tests, standard-library `unittest`. The pipeline runs them before it trusts the toolchain with a repository. |

Still open: **PRs are opened only on release branches.** `azure-pipelines.yml`
gates PR creation on `eq(variables.isRelease, 'true')`, so on mainline it pushes a
branch and nothing asks anyone to look at it.

---

## Missing: the larger features

- **Internal-library cascade planner.** Topological ordering, wave-by-wave PRs,
  drift per library. The single highest-value piece for an estate with shared
  internal packages, and entirely absent.
- **Version catalogue generation.** Emit `Directory.Packages.props` from the
  shared-package analysis, so one file bump moves many services. This is the
  change that shrinks the problem instead of automating around it.
- **Work item and SLA sync.** A finding should open an Azure Boards item with a
  clock, and the receipt should close it.
- **Regression budgets.** The real run added 15% to a bundle and no gate noticed.
  Track size and build time across the upgrade.
- **Reachability.** Does the repo actually call the vulnerable function? Large
  payoff, large cost, needs per-language call graphs. Do not start here.

---

## Suggested order

1. ~~**Dedupe, ecosystem tagging, exceptions, registry retry.**~~ Done.
2. ~~**Tests around the fixtures.**~~ Done — 36 of them.
3. **Run the pipeline once, for real, on one .NET repo.** This is the step that
   converts three "never executed" rows into knowledge. Expect the NuGet path to
   need work on first contact.
4. **The verification contract.** Turns claims into evidence, and is a precondition
   for anyone trusting step 5.
5. **The repair agent.** The reason the project exists. Do it after 4, so it cannot
   mark its own homework.
6. **Fleet store, then the cascade planner.**

Steps 1 and 2 are done. Step 3 is the next one that matters, because it converts
three "never executed" rows into knowledge and is the only way to learn what the
NuGet path actually needs. Step 4 is a week. Step 5 is where the value is, and it
is only safe once 4 exists.
