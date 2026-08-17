---
name: nikbot-upgrade-python
description: Upgrades Python dependencies and the interpreter version - CVE audit, breaking changes, resolver conflicts, staged verification. Use for dependency or Python version upgrades in a Python repo. For other ecosystems use nikbot-upgrade or nikbot-upgrade-dotnet.
# recommended model tier: sonnet (map to your Copilot model list)
---

# Python dependency upgrader

Upgrade deliberately, verifying each step, using whichever tool this project actually uses.

## Identify the toolchain first

Do not assume. Look for `uv.lock`, `poetry.lock`, `Pipfile.lock`, `pdm.lock`,
`requirements*.txt`, `pyproject.toml`, `setup.cfg`, `constraints.txt`, `tox.ini`, `.python-version`.

Use that tool's own commands. Running `pip install -U` in a `uv` or Poetry project bypasses the
lockfile and produces an environment nobody else can reproduce.

## Inventory

- Outdated: `uv pip list --outdated`, `poetry show --outdated`, or `pip list --outdated`
- Vulnerabilities: `pip-audit`, or `uv pip audit` / `safety` if the project already uses one
- Read the **lockfile** for resolved versions; the manifest only holds constraints
- Note `requires-python` and the versions CI actually runs

## Method

1. **Classify** each upgrade: patch / minor / major / security. Python packages follow semver loosely
   - a minor bump can still break you, so read the changelog above patch level regardless.
2. **Read the release notes** and migration guide for anything above patch.
3. **Sequence**: security first, then patch and minor batched, then majors one at a time.
4. **Verify after each step**: install, full test suite, lint, type check (`mypy`/`pyright`) if the
   project has one. Type checkers catch upgrade breakage that tests miss.

## Python-specific traps

- **The resolver is the constraint.** A single package's requirement can block several others. Read
  the conflict message properly rather than force-installing past it.
- **Extras and optional dependencies** - `package[extra]` may resolve differently after an upgrade.
- **Transitive pins** in `constraints.txt` silently override what you asked for.
- **C extensions and wheels** - no wheel for your platform or Python version means a source build,
  which may fail or silently need system libraries. Check the target platform, not just yours.
- **`requires-python`** raised by a dependency, quietly excluding the interpreter CI uses.
- **Deprecation to removal** - a `DeprecationWarning` in one minor becomes an `AttributeError` in the
  next. Run the suite with `-W error::DeprecationWarning` before a major to find these early.
- **Framework majors** - Pydantic 1 to 2, SQLAlchemy 1.4 to 2, Django LTS steps, NumPy 2 - each has a
  real migration guide and usually a codemod. Read it; do not improvise.
- **Test and lint tooling** - a pytest or ruff major can change collection or default rules, making a
  green suite fail for reasons unrelated to your code.

## Interpreter upgrades

A separate exercise from package upgrades; do not combine them.

Check `requires-python`, CI matrix, Dockerfile base image, `.python-version`, and any deployment
runtime. Read the "What's New" removals section for each version you cross. Move one minor version at
a time.

## Output

- **Inventory** - locked versus latest, classified, with the toolchain you detected
- **Vulnerabilities** - package, severity, advisory, fixed version, direct or transitive
- **Plan** - ordered steps with the verification for each
- **Breaking changes** - per package, and what in this repo it touches
- **Applied** - what changed, with test and type-check results
- **Deferred** - what you did not do and why

## Rules

- Never bulk-upgrade and test once.
- Never hand-edit a lockfile - regenerate it with the project's tool and commit it.
- Do not mix package managers. If the project uses Poetry, use Poetry.
- Do not upgrade past `requires-python` or past what CI runs.
- Report test and type-check failures with real output. Never call an upgrade done with a red suite.
- Flag unmaintained packages - no release in a year or two, archived repository, no support for the
  current Python version.
- Leave the environment reproducible. If an upgrade cannot be completed, revert it and say so.
