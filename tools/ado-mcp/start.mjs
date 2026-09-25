#!/usr/bin/env node
/**
 * Starts Microsoft's Azure DevOps MCP server (@azure-devops/mcp) with a
 * Personal Access Token, so the same two variables drive both the MCP tools
 * and tools/upgrade-pilot/discover.py:
 *
 *   AZDO_ORG  https://dev.azure.com/<org>  (or just <org>)
 *   AZDO_PAT  a PAT from User settings -> Personal access tokens. Creating one
 *             needs no admin rights. Read-only scopes are enough:
 *             Code, Build, Release, Packaging, Project and Team (all Read).
 *
 * The server's "pat" mode wants base64("<user>:<token>") in
 * PERSONAL_ACCESS_TOKEN; that encoding is done here so nobody has to.
 */
import { spawn } from "node:child_process";

const org = (process.env.AZDO_ORG || "").replace(/\/+$/, "").split("/").pop();
const pat = process.env.AZDO_PAT || "";
if (!org || !pat) {
  console.error("ado-mcp: set AZDO_ORG and AZDO_PAT in the environment (see tools/ado-mcp/README.md)");
  process.exit(1);
}

// Pinned: a new server version is a change to review, not something to pick up silently.
const VERSION = "2.10.0";
// Read-mostly domains: projects, repos and their files, pipelines and runs,
// code search, and Advanced Security alerts. Work items and wikis are left out.
const DOMAINS = ["core", "repositories", "pipelines", "search", "advanced-security"];

const child = spawn("npx", ["-y", `@azure-devops/mcp@${VERSION}`, org, "--authentication", "pat", "-d", ...DOMAINS], {
  stdio: "inherit",
  env: { ...process.env, PERSONAL_ACCESS_TOKEN: Buffer.from(`:${pat}`).toString("base64") },
});
child.on("exit", code => process.exit(code ?? 1));
