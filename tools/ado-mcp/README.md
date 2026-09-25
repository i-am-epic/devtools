# Azure DevOps for Claude Code (no admin rights needed)

`.mcp.json` at the repository root registers Microsoft's Azure DevOps MCP
server (`@azure-devops/mcp`, pinned to 2.10.0) through `start.mjs`. The same two
variables also drive `tools/upgrade-pilot/discover.py`.

The MCP server loads these tool groups:

| Tools | Group |
|---|---|
| projects, teams | core |
| repositories, files, branches, commits, pull requests | repositories |
| pipeline definitions, runs, logs, artifacts | pipelines |
| code search | search |
| Advanced Security alerts | advanced-security |

## 1. Make a token (any user can; no admin)

In Azure DevOps, open **User settings** (top right), then **Personal access
tokens**, then **New Token**:

- **Organization:** yours.
- **Expiration:** 30 days is plenty.
- **Scopes:** Custom defined, all **Read**. Pick Code, Build, Release,
  Packaging, and Project and Team.

Copy the token once. If your organisation's policy blocks PAT creation, see
"If PATs are blocked" below.

## 2. Give it to the Claude Code environment (your own settings; no admin)

In the Claude Code session, open the environment menu in the title bar, then
**Edit**. Add these environment variables:

```
AZDO_ORG=https://dev.azure.com/<your-org>
AZDO_PAT=<the token>
```

In the same screen:

- **Setup script:** add one line. The MCP server loads `keytar`, which needs
  the `libsecret` system library.

  ```
  apt-get install -y libsecret-1-0
  ```

- **Network access:** allow these hosts. `dev.azure.com` is usually allowed
  already.

  | Host | Needed for |
  |---|---|
  | `feeds.dev.azure.com` and `pkgs.dev.azure.com` | Azure Artifacts: package feeds and versions |
  | `vsrm.dev.azure.com` | Release pipelines |

Start a new session. Approve the `azure-devops` MCP server when asked.

Never paste the token into the chat.

## If PATs are blocked

Some organisations disable PAT creation. Two routes still need no admin:

- **Pipeline route.** You need permission to create a pipeline in one project,
  which contributors usually have. `azure-pipelines-fleet.yml` runs
  `discover.py` as the build's own identity (`System.AccessToken`) and publishes
  `fleet.json` as an artifact. Share that artifact and the analysis runs from
  it.
- **Azure CLI route.** Run the server with `--authentication azcli` after
  `az login --use-device-code`. The login code is entered in your own browser.
  This route needs `login.microsoftonline.com` allowed in the environment's
  network settings.

## Check it

```
AZDO_ORG=... AZDO_PAT=... node tools/ado-mcp/start.mjs
```

It should log `Starting Azure DevOps MCP Server`, then wait for MCP messages
on stdin.
