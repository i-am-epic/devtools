import * as SDK from "azure-devops-extension-sdk";
import JSZip from "jszip";
import { severityCounts, searchableRows, type Evidence, type Finding, type Plan } from "./model";

const app = document.querySelector<HTMLElement>("#app")!;
const ARTIFACT = "upgrade-pilot";
let current: Evidence | undefined;
interface BuildRef {
  id?: number;
  buildNumber?: string;
  finishTime?: string;
  _links?: { web?: { href?: string } };
}
let currentBuild: BuildRef | undefined;
let projectId = "";
let hostUri = "";
let accessToken = "";

const esc = (value: unknown): string => String(value ?? "—")
  .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;").replaceAll("'", "&#039;");

function jsonFrom(zip: JSZip, suffix: string): Promise<unknown> {
  const match = Object.values(zip.files).find(file => !file.dir && file.name.endsWith(suffix));
  if (!match) return Promise.resolve(suffix === "findings.json" ? [] : {});
  return match.async("string").then(text => JSON.parse(text));
}

async function evidenceFromZip(bytes: ArrayBuffer): Promise<Evidence> {
  const zip = await JSZip.loadAsync(bytes);
  const [plan, findings, applied] = await Promise.all([
    jsonFrom(zip, "plan.json"), jsonFrom(zip, "findings.json"), jsonFrom(zip, "applied.json"),
  ]);
  return { plan: plan as Plan, findings: findings as Finding[], applied: applied as Evidence["applied"] };
}

async function adoFetch(path: string): Promise<Response> {
  const response = await fetch(`${hostUri}${encodeURIComponent(projectId)}/_apis/${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) throw new Error(`Azure DevOps returned ${response.status}`);
  return response;
}

async function loadLatest(): Promise<void> {
  const response = await adoFetch("build/builds?$top=30&queryOrder=finishTimeDescending&api-version=7.1");
  const { value: builds } = await response.json() as { value: BuildRef[] };

  for (const build of builds) {
    try {
      const artifact = await adoFetch(`build/builds/${build.id}/artifacts?artifactName=${ARTIFACT}&$format=zip&api-version=7.1`);
      const bytes = await artifact.arrayBuffer();
      currentBuild = build;
      current = await evidenceFromZip(bytes);
      render();
      return;
    } catch {
      // This build did not publish Upgrade Pilot evidence. Continue to the next one.
    }
  }
  renderEmpty("No recent build published an “upgrade-pilot” artifact.");
}

function metric(label: string, value: number, tone = ""): string {
  return `<article class="metric ${tone}"><span>${esc(label)}</span><strong>${value}</strong></article>`;
}

function statusText(): string {
  if (!current) return "No evidence";
  if (current.plan.review?.length) return "Human review";
  if (current.plan.may_automerge) return "Automatic lane";
  return "Gate held";
}

function renderRows(query = ""): void {
  if (!current) return;
  const needle = query.trim().toLowerCase();
  const rows = searchableRows(current).filter(item =>
    [item.package, item.from, item.to, item.reason, ...(item.advisories ?? [])]
      .some(value => String(value ?? "").toLowerCase().includes(needle)));
  const body = document.querySelector<HTMLTableSectionElement>("#upgradeRows");
  const count = document.querySelector<HTMLElement>("#resultCount");
  if (!body || !count) return;
  count.textContent = `${rows.length} decision${rows.length === 1 ? "" : "s"}`;
  body.innerHTML = rows.length ? rows.map(item => {
    const lane = current!.plan.auto?.includes(item) ? "automatic" : "review";
    return `<tr>
      <td><strong>${esc(item.package)}</strong><small>${esc((item.advisories ?? []).join(", ") || item.reason)}</small></td>
      <td class="mono">${esc(item.from)}</td><td class="arrow">→</td><td class="mono">${esc(item.to)}</td>
      <td><span class="pill ${esc(item.severity)}">${esc(item.severity ?? "info")}</span></td>
      <td><span class="lane ${lane}">${lane}</span></td>
    </tr>`;
  }).join("") : `<tr><td class="no-results" colspan="6">No decisions match this filter.</td></tr>`;
}

function render(): void {
  if (!current) return;
  const counts = severityCounts(current.findings);
  const buildUrl = currentBuild?._links?.web?.href as string | undefined;
  const finished = currentBuild?.finishTime ? new Date(currentBuild.finishTime).toLocaleString() : "imported evidence";
  const gateTone = current.plan.may_automerge ? "ok" : "held";
  app.innerHTML = `
    <header class="masthead">
      <div class="brand"><span class="brand-mark">UP</span><div><strong>Upgrade Pilot</strong><small>dependency control room</small></div></div>
      <div class="build-meta"><span class="pulse"></span><span>${esc(currentBuild?.buildNumber ?? "LOCAL")}</span><span class="divider"></span><span>${esc(finished)}</span></div>
      <div class="actions">
        <label class="import"><input id="evidenceFile" type="file" accept=".zip,application/zip"><span>Import evidence</span></label>
        ${buildUrl ? `<a class="primary" href="${esc(buildUrl)}" target="_top">Open build ↗</a>` : ""}
      </div>
    </header>
    <main>
      <section class="decision-strip">
        <div><span class="overline">Branch policy</span><h1>${esc(current.plan.branch ?? "Unknown branch")}</h1><p>${esc(current.plan.policy?.note ?? current.plan.gate_reason)}</p></div>
        <div class="decision ${gateTone}"><span>${statusText()}</span><strong>${current.plan.may_automerge ? "GO" : "HOLD"}</strong><small>${esc(current.plan.policy?.name ?? "unclassified")}</small></div>
      </section>
      <section class="metrics" aria-label="Finding summary">
        ${metric("Critical", counts.critical, "critical")}${metric("High", counts.high, "high")}
        ${metric("Needs review", current.plan.review?.length ?? 0, "review")}
        ${metric("Automatic", current.plan.auto?.length ?? 0, "automatic")}
        ${metric("No fix", current.plan.unfixable?.length ?? 0)}
      </section>
      <section class="workspace">
        <article class="panel decisions">
          <div class="panel-head"><div><span class="overline">Change queue</span><h2>Upgrade decisions</h2></div><div class="filter"><input id="search" type="search" placeholder="Package, CVE, version…" aria-label="Filter upgrade decisions"><span id="resultCount"></span></div></div>
          <div class="table-wrap"><table><thead><tr><th>Package / advisory</th><th>Current</th><th></th><th>Target</th><th>Risk</th><th>Lane</th></tr></thead><tbody id="upgradeRows"></tbody></table></div>
        </article>
        <aside class="panel evidence-panel">
          <span class="overline">Verification contract</span><h2>Evidence</h2>
          <div class="evidence-line"><span class="evidence-icon ${gateTone}">${current.plan.may_automerge ? "✓" : "!"}</span><div><strong>Quality gate</strong><p>${esc(current.plan.gate_reason)}</p></div></div>
          <div class="evidence-line"><span class="evidence-icon">${current.findings.length}</span><div><strong>Scanner findings</strong><p>Trivy, Sonar and MetaDefender normalized into one model.</p></div></div>
          <div class="evidence-line"><span class="evidence-icon">${current.plan.base_image?.length ?? 0}</span><div><strong>Base image route</strong><p>OS packages kept out of language package managers.</p></div></div>
          <div class="receipt"><span>Apply receipt</span><strong>${esc(current.applied?.summary ?? "Not run or not published")}</strong></div>
        </aside>
      </section>
    </main>`;
  document.querySelector<HTMLInputElement>("#search")?.addEventListener("input", event => renderRows((event.target as HTMLInputElement).value));
  document.querySelector<HTMLInputElement>("#evidenceFile")?.addEventListener("change", importEvidence);
  renderRows();
}

async function importEvidence(event: Event): Promise<void> {
  const file = (event.target as HTMLInputElement).files?.[0];
  if (!file) return;
  try {
    currentBuild = undefined;
    current = await evidenceFromZip(await file.arrayBuffer());
    render();
  } catch (error) {
    renderEmpty(`Could not read this artifact: ${error instanceof Error ? error.message : "invalid ZIP"}`);
  }
}

function renderEmpty(message: string): void {
  app.innerHTML = `<main class="empty"><span class="brand-mark">UP</span><span class="overline">No evidence loaded</span><h1>${esc(message)}</h1><p>Run the Upgrade Pilot pipeline, or import the published artifact ZIP to preview a result.</p><label class="primary import"><input id="evidenceFile" type="file" accept=".zip,application/zip"><span>Import evidence ZIP</span></label></main>`;
  document.querySelector<HTMLInputElement>("#evidenceFile")?.addEventListener("change", importEvidence);
}

function loadPreview(): void {
  currentBuild = { buildNumber: "PREVIEW-1042", finishTime: new Date().toISOString() };
  current = {
    findings: [
      { id: "CVE-2026-11002", package: "framer-motion", severity: "critical", source: "trivy", actionable: true },
      { id: "CVE-2025-31125", package: "vite", severity: "high", source: "trivy", actionable: true },
      { id: "CVE-2024-45590", package: "postcss", severity: "medium", source: "trivy", actionable: true },
      { id: "quality-gate", title: "Sonar quality gate", severity: "info", source: "sonar", actionable: false },
    ],
    plan: {
      branch: "main",
      policy: { name: "mainline", note: "Security first, then grouped patch and minor. Majors remain in the human lane." },
      may_automerge: true,
      gate_reason: "coverage 71.4% clears the 60% bar",
      auto: [
        { package: "vite", from: "5.4.21", to: "5.4.22", reason: "security", jump: "patch", severity: "high", advisories: ["CVE-2025-31125"] },
        { package: "postcss", from: "8.5.6", to: "8.6.0", reason: "security", jump: "patch", severity: "medium", advisories: ["CVE-2024-45590"] },
      ],
      review: [
        { package: "framer-motion", from: "13.4.0", to: "14.0.1", reason: "security", jump: "major", severity: "critical", advisories: ["CVE-2026-11002"], why_manual: "major version change" },
      ],
      deferred: [], unfixable: [], base_image: [],
    },
    applied: { summary: "2 applied, 0 reverted, 1 awaiting review" },
  };
  render();
}

async function start(): Promise<void> {
  if (["localhost", "127.0.0.1"].includes(location.hostname)) {
    loadPreview();
    return;
  }
  try {
    await SDK.init({ loaded: false, applyTheme: true });
    await SDK.ready();
    projectId = SDK.getWebContext().project?.id ?? "";
    if (!projectId) throw new Error("Open Upgrade Pilot from inside an Azure DevOps project.");
    const host = SDK.getHost();
    if (!host.isHosted) throw new Error("This pilot currently targets Azure DevOps Services, not Azure DevOps Server.");
    hostUri = `https://dev.azure.com/${encodeURIComponent(host.name)}/`;
    accessToken = await SDK.getAccessToken();
    SDK.notifyLoadSucceeded();
    await loadLatest();
  } catch (error) {
    renderEmpty(error instanceof Error ? error.message : "Azure DevOps could not initialize the extension.");
  }
}

void start();