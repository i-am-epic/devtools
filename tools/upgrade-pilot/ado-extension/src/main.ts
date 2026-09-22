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
  fleet = {"org":"https://github.com/i-am-epic","projects":["github"],"counts":{"repos":10,"pipelines":0,"packages":155,"release_branches":0},"build_tree":{"nodes":[],"edges":[]},"package_graph":{"nodes":[{"id":"github/switchup","publishes":[]},{"id":"github/portfolio","publishes":[]},{"id":"github/FamilyTree","publishes":[]},{"id":"github/husts","publishes":[]},{"id":"github/devtools","publishes":[]},{"id":"github/avios","publishes":[]},{"id":"github/HouseAsAInvestment","publishes":[]},{"id":"github/MakeME","publishes":[]},{"id":"github/Healios","publishes":[]},{"id":"github/TailorPro","publishes":[]}],"edges":[]},"internal_packages":[],"cascades":{},"cycles":[],"drift":[{"ecosystem":"npm","name":"@types/node","consumers":2,"versions":["^20","^22"],"latest":"26.6.2","median_majors_behind":5.0,"max_majors_behind":6,"median_minors_behind":0.0,"split_major":true,"repos":["github/switchup","github/portfolio"]},{"ecosystem":"npm","name":"framer-motion","consumers":3,"versions":["^11.3.0","^12.42.2","^12.6.0"],"latest":"13.4.0","median_majors_behind":1,"max_majors_behind":2,"median_minors_behind":0,"split_major":true,"repos":["github/switchup","github/portfolio","github/FamilyTree"]},{"ecosystem":"npm","name":"@vitejs/plugin-react","consumers":2,"versions":["^4.3.1","^6.0.4"],"latest":"6.1.1","median_majors_behind":1.0,"max_majors_behind":2,"median_minors_behind":0.5,"split_major":true,"repos":["github/switchup","github/FamilyTree"]},{"ecosystem":"npm","name":"clsx","consumers":2,"versions":["^2.1.1","latest"],"latest":"2.1.1","median_majors_behind":1.0,"max_majors_behind":2,"median_minors_behind":0.0,"split_major":true,"repos":["github/switchup","github/portfolio"]},{"ecosystem":"npm","name":"eslint","consumers":2,"versions":["^8.57.0","^9"],"latest":"10.11.0","median_majors_behind":1.5,"max_majors_behind":2,"median_minors_behind":0.0,"split_major":true,"repos":["github/switchup","github/FamilyTree"]},{"ecosystem":"npm","name":"typescript","consumers":2,"versions":["^5"],"latest":"7.0.2","median_majors_behind":2.0,"max_majors_behind":2,"median_minors_behind":0.0,"split_major":false,"repos":["github/switchup","github/portfolio"]},{"ecosystem":"npm","name":"react","consumers":4,"versions":["19.2.0","19.2.4","^18.2.0","^18.3.1"],"latest":"19.3.0","median_majors_behind":0.5,"max_majors_behind":1,"median_minors_behind":0.5,"split_major":true,"repos":["github/switchup","github/portfolio","github/FamilyTree","github/husts"]},{"ecosystem":"npm","name":"react-dom","consumers":4,"versions":["19.2.0","19.2.4","^18.2.0","^18.3.1"],"latest":"19.3.0","median_majors_behind":0.5,"max_majors_behind":1,"median_minors_behind":0.5,"split_major":true,"repos":["github/switchup","github/portfolio","github/FamilyTree","github/husts"]},{"ecosystem":"npm","name":"@types/react","consumers":3,"versions":["^18.3.3","^19"],"latest":"19.3.0","median_majors_behind":0,"max_majors_behind":1,"median_minors_behind":3,"split_major":true,"repos":["github/switchup","github/portfolio","github/FamilyTree"]},{"ecosystem":"npm","name":"@types/react-dom","consumers":3,"versions":["^18.3.0","^19"],"latest":"19.3.0","median_majors_behind":0,"max_majors_behind":1,"median_minors_behind":3,"split_major":true,"repos":["github/switchup","github/portfolio","github/FamilyTree"]},{"ecosystem":"npm","name":"tailwindcss","consumers":3,"versions":["^3.4.17","^3.4.4","^4"],"latest":"4.3.3","median_majors_behind":1,"max_majors_behind":1,"median_minors_behind":0,"split_major":true,"repos":["github/switchup","github/portfolio","github/FamilyTree"]},{"ecosystem":"npm","name":"@google/genai","consumers":2,"versions":["^1.27.0","^1.46.0"],"latest":"2.24.0","median_majors_behind":1.0,"max_majors_behind":1,"median_minors_behind":0.0,"split_major":false,"repos":["github/portfolio","github/FamilyTree"]},{"ecosystem":"npm","name":"lucide-react","consumers":2,"versions":["^0.390.0","latest"],"latest":"1.47.0","median_majors_behind":1.0,"max_majors_behind":1,"median_minors_behind":0.0,"split_major":false,"repos":["github/portfolio","github/FamilyTree"]},{"ecosystem":"npm","name":"next","consumers":2,"versions":["15.5.14","16.2.11"],"latest":"16.3.5","median_majors_behind":0.5,"max_majors_behind":1,"median_minors_behind":0.5,"split_major":true,"repos":["github/switchup","github/portfolio"]},{"ecosystem":"pypi","name":"numpy","consumers":2,"versions":["2.2.3",">=1.26"],"latest":"2.5.3","median_majors_behind":0.5,"max_majors_behind":1,"median_minors_behind":1.5,"split_major":true,"repos":["github/HouseAsAInvestment","github/Healios"]},{"ecosystem":"npm","name":"postcss","consumers":2,"versions":["^8","^8.4.38"],"latest":"8.5.28","median_majors_behind":0.0,"max_majors_behind":0,"median_minors_behind":3.0,"split_major":false,"repos":["github/portfolio","github/FamilyTree"]}],"release_trains":[],"convergence":{"nodes":[{"id":"github/switchup","label":"switchup","deps":23,"kind":"Next 16 + Prisma"},{"id":"github/portfolio","label":"portfolio","deps":28,"kind":"Next 15 + three.js"},{"id":"github/FamilyTree","label":"FamilyTree","deps":15,"kind":"Vite + React"},{"id":"github/husts","label":"husts","deps":11,"kind":"Create React App"},{"id":"github/avios","label":"avios","deps":2,"kind":"Flask"},{"id":"github/HouseAsAInvestment","label":"HouseAsAInvestment","deps":44,"kind":"Streamlit"},{"id":"github/MakeME","label":"MakeME","deps":2,"kind":"Flask + OpenAI"},{"id":"github/Healios","label":"Healios","deps":6,"kind":"FastAPI"},{"id":"github/TailorPro","label":"TailorPro","deps":24,"kind":"Flutter + Firebase"}],"edges":[{"a":"github/switchup","b":"github/portfolio","n":10,"packages":["@types/node","@types/react","@types/react-dom","clsx","framer-motion","next","react","react-dom"]},{"a":"github/portfolio","b":"github/FamilyTree","n":9,"packages":["@google/genai","@types/react","@types/react-dom","framer-motion","lucide-react","postcss","react","react-dom"]},{"a":"github/switchup","b":"github/FamilyTree","n":8,"packages":["@types/react","@types/react-dom","@vitejs/plugin-react","eslint","framer-motion","react","react-dom","tailwindcss"]},{"a":"github/switchup","b":"github/husts","n":2,"packages":["react","react-dom"]},{"a":"github/portfolio","b":"github/husts","n":2,"packages":["react","react-dom"]},{"a":"github/FamilyTree","b":"github/husts","n":2,"packages":["react","react-dom"]},{"a":"github/portfolio","b":"github/MakeME","n":1,"packages":["openai"]},{"a":"github/avios","b":"github/MakeME","n":1,"packages":["Flask"]},{"a":"github/HouseAsAInvestment","b":"github/Healios","n":1,"packages":["numpy"]}]},"repos":[{"key":"github/switchup","publishes":[]},{"key":"github/portfolio","publishes":[]},{"key":"github/FamilyTree","publishes":[]},{"key":"github/husts","publishes":[]},{"key":"github/devtools","publishes":[]},{"key":"github/avios","publishes":[]},{"key":"github/HouseAsAInvestment","publishes":[]},{"key":"github/MakeME","publishes":[]},{"key":"github/Healios","publishes":[]},{"key":"github/TailorPro","publishes":[]}]} as Fleet;
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