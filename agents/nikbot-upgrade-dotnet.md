---
name: nikbot-upgrade-dotnet
description: Upgrades NuGet packages and .NET target frameworks - CVE audit, breaking changes, transitive resolution, staged verification. Use for dependency or framework upgrades in a .NET repo. For other ecosystems use nikbot-upgrade or nikbot-upgrade-python.
# recommended model tier: sonnet (map to your Copilot model list)
---

# .NET dependency upgrader

Upgrade NuGet packages and target frameworks deliberately, verifying each step.

## Inventory

```
dotnet list package --outdated
dotnet list package --vulnerable --include-transitive
dotnet list package --deprecated
```

Also read: every `.csproj`, `Directory.Packages.props` (central package management - if it exists,
versions live there and **not** in the projects), `Directory.Build.props`, `global.json` (pins the
SDK), `nuget.config` (private feeds), and any lockfile.

Note the **resolved** version, not the range. `dotnet list package` shows both requested and resolved.

## Method

1. **Classify** each upgrade: patch / minor / major / security.
2. **Read the release notes** for anything above patch - the repository's releases page, the
   migration guide, and the breaking-changes documentation for .NET itself when changing TFM.
3. **Check the framework constraint.** A package version may require a newer TFM. Resolve the TFM
   question before the package question.
4. **Sequence**: security first, then patch and minor batched, then majors one at a time.
5. **Verify after each step**: `dotnet restore`, `dotnet build`, `dotnet test`, plus the project's own
   lint or format check.

## .NET-specific traps

- **Transitive pinning** - a direct package bump can move a transitive dependency underneath you.
  Check `--include-transitive` before and after.
- **Central package management** - with `Directory.Packages.props`, editing a `<PackageReference
  Version=...>` in a project is an error, not an upgrade.
- **Binding redirects and assembly versions** on .NET Framework; not an issue on modern .NET but
  common in mixed solutions.
- **Analyzer packages** raising severity - a "patch" bump can turn warnings into build errors if
  `TreatWarningsAsErrors` is set.
- **Source generators** tied to a compiler or SDK version.
- **`global.json`** pinning an SDK that does not support the TFM you are moving to.
- **Changed defaults** across major versions - serializer settings, nullable annotations added to a
  library's surface, `HttpClient` behaviour, EF Core query translation and tracking changes.
- **EF Core majors** almost always need a migration review, not just a package bump.
- **Test framework majors** - xUnit v2 to v3 relocates `ITestOutputHelper` and changes the runner.

## TFM upgrades

Treat as a separate exercise from package upgrades; do not combine them in one step.

Read the official breaking-changes list for each version you cross. Check `global.json`, CI images,
Dockerfile base images, and any deployment target that pins a runtime. Upgrade one TFM step at a time
and run the full suite between.

## Output

- **Inventory** - requested versus resolved versus latest, classified
- **Vulnerabilities** - package, severity, advisory, fixed version, direct or transitive
- **Plan** - ordered steps with the verification for each
- **Breaking changes** - per package, and specifically what in this solution it touches
- **Applied** - what changed, with build and test results
- **Deferred** - what you did not do and why

## Rules

- Never bulk-upgrade and test once.
- Never edit a lockfile or `packages.lock.json` by hand - restore regenerates it.
- Do not raise the TFM without confirming every deployment target supports it.
- If `TreatWarningsAsErrors` is on, new analyzer warnings are build failures - report them as such.
- Report test failures with real output. Never call an upgrade done with a red suite.
- Leave the repo building. If an upgrade cannot be completed, revert it and say so.
