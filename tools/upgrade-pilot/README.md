# Upgrade Pilot

Dependency analysis and automatic upgrades, driven by the scanners you already run.

Runs inside your network on your pipeline's own identity. Nothing external needs
access to your code, which is also why this needs no new app registration.

## Why it exists

The version bump is the cheap part — Renovate and Dependabot already do it. The
expensive parts are deciding what matters, fixing what the bump broke, and proving
the finding is actually closed. This handles the first and the third, and hands the
second to an agent with the right context loaded.

## The pipeline

```
restore ─→ inventory ─→ scans ─→ correlate ─→ apply ─→ verify ─→ PR
           (lockfile)   (trivy/    (policy      (one at   (build +
                         sonar/     by branch)   a time)   tests)
                         metadefender)
```

| Script | Does |
| --- | --- |
| `inventory.py` | Reads what is **resolved**, not what the manifest asks for. npm, NuGet, PyPI, pub. Resolves latest versions, peer constraints, engine floors, deprecation and publish dates; derives changelog URLs from registry metadata. |
| `scans.py` | Normalises Trivy, SonarQube and MetaDefender into one finding model. OS packages are tagged as such so they never reach a language package manager. |
| `report.py` | Correlates findings with the inventory, applies the branch policy, and emits the plan plus a Markdown summary for the build page. |
| `apply.py` | Applies the automatic set **one package at a time**, verifying after each and reverting anything that fails. |
| `metadefender_poll.py` | Polls OPSWAT for submitted artifacts and writes one combined result file. |
| `tests/` | The toolchain's own tests. Standard library `unittest`: `python -m unittest discover -s tests`. |

## Azure DevOps UI

`ado-extension/` contains an optional, read-only Azure DevOps project hub. It
finds the latest pipeline run with an `upgrade-pilot` artifact and presents the
branch decision, scanner findings, automatic and review lanes, quality gate and
apply receipt in project navigation. It uses the signed-in user's Azure DevOps
identity and requests only the `vso.build` read scope; no evidence is copied to
an external service. See `ado-extension/README.md` for packaging and private
installation instructions.

## Accepted risks

A finding with no fixed version, or one the team has formally accepted, would
otherwise reappear on every run with no way to answer it. `exceptions.json`
(see `exceptions.example.json`) is that answer:

```json
{"exceptions": [
  {"advisory": "CVE-2026-90210", "package": "reactflow",
   "reason": "labels come from a fixed internal schema, never user input",
   "added_by": "security-review@corp", "ticket": "SEC-4412",
   "expires": "2026-12-31"}
]}
```

**Every entry needs an expiry**, and an entry without one is rejected rather than
honoured. An expired exception stops suppressing and is reported under its own
heading, so the decision gets revisited instead of quietly outliving the reasoning
that justified it. Suppressed findings are listed too — suppression is visible,
never silent.

## Branch policy

The branch decides what is allowed. This is the part that matters for a release
train like `release/26.1`:

| Branch | Allowed | Auto-applied |
| --- | --- | --- |
| `main` | security + routine currency | patch and minor, grouped |
| `release/*`, `hotfix/*`, `26.1` | **security only** | patch only, smallest change that clears the finding |

A release branch exists to fix what is broken, not to stay current. Routine
upgrades land on main and reach the release branch by merge — never the other way,
or the release branch drifts into a different product.

## Auto-merge is gated on test quality, not version distance

Sonar decides. No Sonar result, or coverage under the bar, or a failing quality
gate, and nothing merges unattended regardless of how small the bump looks. A patch
bump into an untested repo is riskier than a major into a tested one.

Set the bar with `--min-coverage`. Publish it, and let teams earn their way into
the automatic lane by meeting it.

## Running it

In the pipeline — copy `azure-pipelines.yml`, set these variables, done:

| Variable | For |
| --- | --- |
| `SonarHostUrl`, `SonarProjectKey`, `SonarToken` | pulling measures and the gate |
| `MetaDefenderUrl`, `MetaDefenderApiKey` | artifact scanning (skipped if unset) |
| `UpgradePilotFeed` | your Azure Artifacts upstream, so registry lookups work on a locked-down agent |
| `imageName` | the container image for `trivy image` |

`System.AccessToken` must be granted to the job, and the build service needs
**Contribute** and **Create pull request** on the repository. That is the whole
permission surface — no app registration, no PAT in a variable group.

Locally, against a checkout:

```bash
python inventory.py . --out inventory.json --include-transitive
python scans.py --trivy trivy.json --sonar sonar.json --out findings.json
python report.py --inventory inventory.json --findings findings.json \
                 --branch release/26.1 --out-md summary.md --out-json plan.json
python apply.py --plan plan.json --inventory inventory.json \
                --verify "npm run build && npm test" --report applied.json
```

`--dry-run` on `apply.py` prints what it would do and changes nothing.
`--offline` on `inventory.py` skips registry lookups, and `--cache-dir` reuses
registry answers between runs (roughly 8x faster on a warm cache, and the same
answers serve every repo in the estate).

**`inventory.py` exits 2 when it could not reach the registry for some package.**
A partial inventory that looks complete is the dangerous outcome, because every
unresolved package silently reads as "nothing to upgrade". Pass
`--allow-incomplete` to accept that and carry on.

## What it will not do

- **Merge.** It pushes a branch and opens a draft PR. A human or a policy merges.
- **Modify tests to make them pass.** If the only way to green is a test change,
  that is a human decision.
- **Upgrade past a blocker.** Anything unpinned, deprecated, or without a fixed
  version is reported, not bumped.
- **Claim a finding is closed.** Closure needs the rebuilt SBOM to no longer
  contain the advisory and the suite to be green. That is the pipeline's job, and
  deliberately not this tool's — the agent must not be able to write its own evidence.

## Adapting the scanners

Each loader in `scans.py` reads the tool's standard JSON. If your Trivy config
emits a different shape, or your MetaDefender is on-premises with a different
response envelope, that is the one file to change. Everything downstream works on
the normalised model:

```python
{"source", "kind", "id", "severity", "package", "installed", "fixed",
 "title", "target", "class", "ecosystem", "actionable", "refs"}
```

`fixtures/` holds one sample of each format for testing the chain without a build.
