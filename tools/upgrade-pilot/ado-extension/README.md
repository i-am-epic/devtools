# Upgrade Pilot Azure DevOps hub

A read-only Azure DevOps project hub for the evidence emitted by the Upgrade
Pilot pipeline. It finds the latest build with an `upgrade-pilot` artifact and
shows the branch decision, Sonar gate, findings, automatic lane, human-review
lane, base-image routing and apply receipt without copying data to another
service.

The pilot targets Azure DevOps Services. Azure DevOps Server needs its collection
URL supplied through the host location service and is deliberately not declared
as a supported installation target yet.

The hub requests only the `vso.build` read scope. Evidence stays in
Azure DevOps and is read with the signed-in user's extension token.

## Build and package

```bash
npm ci
npm run check
npm run package
```

Before packaging, replace `CHANGE-ME` in `vss-extension.json` with the ID of your
[Visual Studio Marketplace publisher](https://learn.microsoft.com/azure/devops/extend/publish/overview).
The VSIX is written to `dist/`. Keep the extension private while piloting it,
share it with the Azure DevOps organization, and install it there. A new
**Upgrade Pilot → Evidence** hub then appears in project navigation.

## Local evidence preview

Azure DevOps hosts extensions in an authenticated iframe, so the normal view is
inside a project. The empty state also accepts the artifact ZIP downloaded from
**Pipelines → Run → Artifacts → upgrade-pilot**. This exercises the same ZIP
reader and rendering path without granting extra access.

For a populated design preview, run `npm run build`, serve `dist/` on localhost,
and open it in a browser. Localhost automatically uses representative fixture
data; installed Azure DevOps instances always use live pipeline evidence.

## Artifact contract

The hub reads these files from the pipeline artifact:

- `plan.json` — required; branch policy and upgrade lanes
- `findings.json` — required; normalized scanner results
- `applied.json` — optional; per-package apply/revert receipt

It intentionally does not create PRs or queue builds. Those remain pipeline
actions, preserving the existing permission boundary and audit trail.