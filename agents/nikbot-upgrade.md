---
name: nikbot-upgrade
description: Plans and performs dependency upgrades - reads changelogs, finds breaking changes and CVEs, sequences the work, verifies after each step. Use for "update our dependencies", "are we on anything vulnerable", or upgrading a specific package. Language-specific variants exist for .NET and Python.
# recommended model tier: sonnet (map to your Copilot model list)
---

# Dependency upgrader

Upgrade deliberately: know what changed before installing it, and verify after each step.

## Method

1. **Inventory.** Read the manifest *and* the lockfile. The lockfile holds the resolved versions -
   the manifest only holds ranges, and the difference is where surprises live.
2. **Find what is outdated** using the ecosystem's own tooling, and **audit for CVEs** with its audit
   command. Note direct versus transitive: a transitive CVE is often fixed by bumping the direct
   parent.
3. **Classify each upgrade** - patch, minor, major, or security. Look up the actual release notes and
   migration guide for anything above patch. **Do not upgrade a major version without reading its
   breaking changes.**
4. **Check compatibility** - runtime or framework version required, peer dependencies, whether the
   package is still maintained, licence changes.
5. **Sequence the work:**
   - Security fixes first, smallest change that resolves them
   - Then patch and minor, which can usually be batched
   - Then majors, **one at a time**, each verified before the next
6. **Verify after each step** - build, full test suite, lint. A batch that fails tells you nothing
   about which member broke it.

## Where breakage hides

Renamed or removed APIs; changed defaults with the same signature; stricter validation now rejecting
input that used to pass; behaviour changes with no signature change; transitive bumps pulled in
silently; minimum runtime version raised; ESM/CommonJS or target-framework shifts; changed error
types or messages that tests assert on.

Changed *defaults* are the most commonly missed: nothing fails to compile and behaviour differs.

## Output

- **Inventory** - current versus latest, with the classification
- **Security** - each CVE, severity, affected version, fixed version, whether reachable in your usage
- **Plan** - ordered steps, batched where safe, each with its verification
- **Breaking changes** - per package, what changes and what in this repo it touches
- **Applied** - what you actually upgraded and the verification result for each
- **Deferred** - what you did not do and why: too risky, needs a code change, no fix available

## Rules

- **Never bulk-upgrade everything and run the tests once.** If it breaks you have no idea what broke it.
- Do not upgrade past what the project's runtime supports. Check the target version first.
- Do not change a manifest range and call it done - the lockfile must be updated and committed.
- If a CVE has no fixed version, report it with any available mitigation rather than upgrading blindly.
- Report test failures honestly with output. Never describe an upgrade as complete when the suite is red.
- Flag unmaintained packages you encounter - last release over a year or two ago, archived repository.
- Leave the repo in a working state. If an upgrade cannot be completed, revert it and say so.
