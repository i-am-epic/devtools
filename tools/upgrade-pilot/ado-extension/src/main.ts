import * as SDK from "azure-devops-extension-sdk";
import JSZip from "jszip";
import { severityCounts, searchableRows, type Evidence, type Finding, type Plan } from "./model";
import { renderEstate, renderBuildTree, renderCascade, renderTrains, type Fleet } from "./fleet";

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
let fleet: Fleet | undefined;

type View = "build" | "estate" | "tree" | "cascade" | "trains";
const VIEWS: Array<{ id: View; label: string }> = [
  { id: "build", label: "This build" },
  { id: "estate", label: "Estate" },
  { id: "tree", label: "Build tree" },
  { id: "cascade", label: "Cascade" },
  { id: "trains", label: "Release trains" },
];
let view: View = "build";
let cascadePick: string | undefined;
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
  // The fleet document is optional: a repo-scoped run publishes evidence without it.
  fleet = (await jsonFrom(zip, "fleet.json").catch(() => undefined)) as Fleet | undefined;
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

function nav(): string {
  const available = (id: View): boolean => id === "build" || Boolean(fleet);
  return `<nav class="views" role="tablist">${VIEWS.map(v => {
    const on = v.id === view;
    return `<button role="tab" class="view-tab${on ? " on" : ""}" data-view="${v.id}"
      aria-selected="${on}"${available(v.id) ? "" : " disabled title='No fleet.json in this artifact'"}>${v.label}</button>`;
  }).join("")}</nav>`;
}

function viewBody(): string {
  if (view === "estate") return renderEstate(fleet!);
  if (view === "tree") return renderBuildTree(fleet!);
  if (view === "cascade") return renderCascade(fleet!, cascadePick);
  if (view === "trains") return renderTrains(fleet!);
  return buildView();
}

function wireNav(): void {
  document.querySelectorAll<HTMLButtonElement>("[data-view]").forEach(button =>
    button.addEventListener("click", () => {
      if (button.disabled) return;
      view = button.dataset.view as View;
      render();
    }));
  document.querySelector<HTMLSelectElement>("#cascadePick")?.addEventListener("change", event => {
    cascadePick = (event.target as HTMLSelectElement).value;
    render();
  });
  const driftSearch = document.querySelector<HTMLInputElement>("#driftSearch");
  driftSearch?.addEventListener("input", () => {
    const q = driftSearch.value.trim().toLowerCase();
    document.querySelectorAll<HTMLTableRowElement>("#driftRows tr").forEach(row => {
      row.hidden = Boolean(q) && !row.innerText.toLowerCase().includes(q);
    });
  });
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
      ${nav()}
      ${viewBody()}
    </main>`;
  wireNav();
  if (view === "build") {
    document.querySelector<HTMLInputElement>("#search")?.addEventListener("input", event => renderRows((event.target as HTMLInputElement).value));
    renderRows();
  }
  document.querySelector<HTMLInputElement>("#evidenceFile")?.addEventListener("change", importEvidence);
}

function buildView(): string {
  const counts = severityCounts(current!.findings);
  const gateTone = current!.plan.may_automerge ? "ok" : "held";
  const plan = current!.plan;
  return `
      <section class="decision-strip">
        <div><span class="overline">Branch policy</span><h1>${esc(current!.plan.branch ?? "Unknown branch")}</h1><p>${esc(current!.plan.policy?.note ?? current!.plan.gate_reason)}</p></div>
        <div class="decision ${gateTone}"><span>${statusText()}</span><strong>${current!.plan.may_automerge ? "GO" : "HOLD"}</strong><small>${esc(current!.plan.policy?.name ?? "unclassified")}</small></div>
      </section>
      <section class="metrics" aria-label="Finding summary">
        ${metric("Critical", counts.critical, "critical")}${metric("High", counts.high, "high")}
        ${metric("Needs review", current!.plan.review?.length ?? 0, "review")}
        ${metric("Automatic", current!.plan.auto?.length ?? 0, "automatic")}
        ${metric("No fix", current!.plan.unfixable?.length ?? 0)}
      </section>
      <section class="workspace">
        <article class="panel decisions">
          <div class="panel-head"><div><span class="overline">Change queue</span><h2>Upgrade decisions</h2></div><div class="filter"><input id="search" type="search" placeholder="Package, CVE, version…" aria-label="Filter upgrade decisions"><span id="resultCount"></span></div></div>
          <div class="table-wrap"><table><thead><tr><th>Package / advisory</th><th>Current</th><th></th><th>Target</th><th>Risk</th><th>Lane</th></tr></thead><tbody id="upgradeRows"></tbody></table></div>
        </article>
        <aside class="panel evidence-panel">
          <span class="overline">Verification contract</span><h2>Evidence</h2>
          <div class="evidence-line"><span class="evidence-icon ${gateTone}">${current!.plan.may_automerge ? "✓" : "!"}</span><div><strong>Quality gate</strong><p>${esc(current!.plan.gate_reason)}</p></div></div>
          <div class="evidence-line"><span class="evidence-icon">${current!.findings.length}</span><div><strong>Scanner findings</strong><p>Trivy, Sonar and MetaDefender normalized into one model.</p></div></div>
          <div class="evidence-line"><span class="evidence-icon">${current!.plan.base_image?.length ?? 0}</span><div><strong>Base image route</strong><p>OS packages kept out of language package managers.</p></div></div>
          <div class="receipt"><span>Apply receipt</span><strong>${esc(current!.applied?.summary ?? "Not run or not published")}</strong></div>
        </aside>
      </section>`;
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
  fleet = {"org":"https://dev.azure.com/contoso","projects":["Payments"],"counts":{"repos":4,"pipelines":4,"packages":7,"release_branches":2},"build_tree":{"nodes":[{"id":1,"name":"contoso-http-ci","project":"Payments"},{"id":2,"name":"payments-api-ci","project":"Payments"},{"id":3,"name":"payments-api-release","project":"Payments"},{"id":4,"name":"onboarding-web-ci","project":"Payments"}],"edges":[{"from":1,"to":2,"via":"contoso-http-ci"},{"from":2,"to":3,"via":"payments-api-ci"}]},"package_graph":{"nodes":[{"id":"Payments/contoso-http","publishes":["Contoso.Http"]},{"id":"Payments/contoso-auth","publishes":["Contoso.Auth.Tokens"]},{"id":"Payments/payments-api","publishes":[]},{"id":"Payments/onboarding-web","publishes":[]}],"edges":[{"from":"Payments/contoso-http","to":"Payments/contoso-auth","package":"Contoso.Http","version":"4.1.0"},{"from":"Payments/contoso-http","to":"Payments/payments-api","package":"Contoso.Http","version":"4.0.2"},{"from":"Payments/contoso-auth","to":"Payments/onboarding-web","package":"Contoso.Auth.Tokens","version":"2.8.4"}]},"internal_packages":["Contoso.Auth.Tokens","Contoso.Http"],"cascades":{"Contoso.Http":[["Payments/contoso-auth","Payments/payments-api"],["Payments/onboarding-web"]],"Contoso.Auth.Tokens":[["Payments/onboarding-web"]]},"cycles":[],"drift":[{"ecosystem":"nuget","name":"Newtonsoft.Json","consumers":4,"versions":["12.0.3","13.0.1","13.0.3"],"latest":"13.0.3","median_majors_behind":0.5,"max_majors_behind":1,"median_minors_behind":0.0,"split_major":true,"repos":["Payments/contoso-http","Payments/contoso-auth","Payments/payments-api","Payments/onboarding-web"]},{"ecosystem":"nuget","name":"Contoso.Http","consumers":2,"versions":["4.0.2","4.1.0"],"latest":"4.2.1","median_majors_behind":0.0,"max_majors_behind":0,"median_minors_behind":1.5,"split_major":false,"repos":["Payments/contoso-auth","Payments/payments-api"]}],"release_trains":[{"repo":"Payments/payments-api","branch":"release/26.1","behind":[{"package":"Contoso.Http","release":"3.9.0","mainline":"4.0.2","jump":"major"}],"count":1},{"repo":"Payments/contoso-http","branch":"release/26.1","behind":[],"count":0}],"repos":[{"key":"Payments/contoso-http","publishes":["Contoso.Http"]},{"key":"Payments/contoso-auth","publishes":["Contoso.Auth.Tokens"]},{"key":"Payments/payments-api","publishes":[]},{"key":"Payments/onboarding-web","publishes":[]}]} as Fleet;
  render();
}

/** Loopback covers IPv6 too; `::1` was previously missed. */
const PREVIEW_HOSTS = ["localhost", "127.0.0.1", "[::1]", "::1"];
const SDK_TIMEOUT_MS = 2500;

async function start(): Promise<void> {
  if (PREVIEW_HOSTS.includes(location.hostname)) {
    loadPreview();
    return;
  }
  // Outside an Azure DevOps host the SDK never answers rather than rejecting, so
  // race it. Anyone opening the bundle directly gets the preview instead of an
  // error about an extension host they are not in.
  let hosted = false;
  try {
    await Promise.race([
      (async () => {
        await SDK.init({ loaded: false, applyTheme: true });
        await SDK.ready();
        hosted = true;
      })(),
      new Promise((_resolve, reject) =>
        setTimeout(() => reject(new Error("No Azure DevOps host responded.")), SDK_TIMEOUT_MS)),
    ]);
    projectId = SDK.getWebContext().project?.id ?? "";
    if (!projectId) throw new Error("Open Upgrade Pilot from inside an Azure DevOps project.");
    const host = SDK.getHost();
    if (!host.isHosted) throw new Error("This pilot currently targets Azure DevOps Services, not Azure DevOps Server.");
    hostUri = `https://dev.azure.com/${encodeURIComponent(host.name)}/`;
    accessToken = await SDK.getAccessToken();
    SDK.notifyLoadSucceeded();
    await loadLatest();
  } catch (error) {
    if (!hosted) {
      loadPreview();
      return;
    }
    renderEmpty(error instanceof Error ? error.message : "Azure DevOps could not initialize the extension.");
  }
}

void start();