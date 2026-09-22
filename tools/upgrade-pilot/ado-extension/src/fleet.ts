/**
 * Fleet views: the estate-level questions a single build's evidence cannot answer.
 *
 * Two graphs live here and they are deliberately kept apart. The build tree says
 * what to REBUILD after a change lands; the package cascade says in what ORDER to
 * upgrade. A release pipeline depends on a build pipeline without consuming its
 * library, and an internal package cascade often has no pipeline edge at all.
 */

export interface FleetRepo {
  key: string;
  project?: string;
  repo?: string;
  branches?: string[];
  release_branches?: string[];
  publishes?: string[];
  packages?: Array<{ name: string; ecosystem?: string; resolved?: string; spec?: string; latest?: string }>;
}

export interface Graph {
  nodes: Array<{ id: string | number; name?: string; project?: string; publishes?: string[] }>;
  edges: Array<{ from: string | number; to: string | number; via?: string; package?: string; version?: string }>;
}

export interface DriftRow {
  ecosystem: string; name: string; consumers: number; versions: string[]; latest?: string;
  median_majors_behind: number; max_majors_behind: number; median_minors_behind: number;
  split_major: boolean; repos: string[];
}

export interface TrainRow {
  repo: string; branch: string; count: number;
  behind: Array<{ package: string; release: string; mainline: string; jump: string }>;
}

export interface Convergence {
  nodes: Array<{ id: string; label: string; deps: number; kind?: string }>;
  edges: Array<{ a: string; b: string; n: number; packages: string[] }>;
}

export interface Fleet {
  org?: string;
  projects?: string[];
  counts?: { repos: number; pipelines: number; packages: number; release_branches: number };
  repos?: FleetRepo[];
  build_tree?: Graph;
  package_graph?: Graph;
  internal_packages?: string[];
  cascades?: Record<string, string[][]>;
  cycles?: string[][];
  drift?: DriftRow[];
  release_trains?: TrainRow[];
  convergence?: Convergence;
}

const esc = (v: unknown): string => String(v ?? "—")
  .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

const short = (key: string): string => key.includes("/") ? key.slice(key.indexOf("/") + 1) : key;

/* ---------------------------------------------------------------- estate */

export function renderEstate(fleet: Fleet): string {
  const c = fleet.counts ?? { repos: 0, pipelines: 0, packages: 0, release_branches: 0 };
  const drift = fleet.drift ?? [];
  const cycleWarning = (fleet.cycles?.length ?? 0) > 0
    ? `<div class="warn-strip"><strong>${fleet.cycles!.length} dependency cycle(s)</strong>
       between repositories. A cycle has no valid upgrade order — break it before planning a cascade.</div>`
    : "";

  const rows = drift.length ? drift.map(d => `
    <tr>
      <td><strong>${esc(d.name)}</strong><small>${esc(d.ecosystem)}</small></td>
      <td>${d.consumers}</td>
      <td class="mono">${d.versions.map(esc).join(" · ")}</td>
      <td class="mono">${esc(d.latest)}</td>
      <td>${d.max_majors_behind > 0
        ? `<span class="pill critical">${d.max_majors_behind} major${d.max_majors_behind > 1 ? "s" : ""}</span>`
        : d.median_minors_behind > 0
          ? `<span class="pill medium">${d.median_minors_behind} minor</span>`
          : `<span class="pill low">current</span>`}</td>
      <td>${d.split_major ? `<span class="lane review">split</span>` : `<span class="lane automatic">aligned</span>`}</td>
    </tr>`).join("")
    : `<tr><td colspan="6" class="no-results">No package is shared by more than one repository.</td></tr>`;

  return `
    ${cycleWarning}
    <section class="metrics">
      <article class="metric automatic"><span>Repositories</span><strong>${c.repos}</strong></article>
      <article class="metric"><span>Pipelines</span><strong>${c.pipelines}</strong></article>
      <article class="metric"><span>Dependencies</span><strong>${c.packages}</strong></article>
      <article class="metric review"><span>Release branches</span><strong>${c.release_branches}</strong></article>
      <article class="metric critical"><span>Shared packages</span><strong>${drift.length}</strong></article>
    </section>
    <article class="panel" style="margin-bottom:16px">
      <div class="panel-head"><div><span class="overline">Shared dependencies</span><h2>Which repositories move together</h2></div>
        <div class="filter"><span>${fleet.convergence?.edges.length ?? 0} links</span></div></div>
      ${renderConvergence(fleet.convergence)}
    </article>
    <article class="panel">
      <div class="panel-head">
        <div><span class="overline">Convergence</span><h2>Packages more than one repo depends on</h2></div>
        <div class="filter"><input id="driftSearch" type="search" placeholder="Package…" aria-label="Filter shared packages"></div>
      </div>
      <div class="table-wrap"><table>
        <thead><tr><th>Package</th><th>Repos</th><th>Versions in use</th><th>Latest</th><th>Drift</th><th>State</th></tr></thead>
        <tbody id="driftRows">${rows}</tbody>
      </table></div>
    </article>`;
}

/* ----------------------------------------------------------- convergence */

/**
 * Repositories placed on a ring, linked by the packages they share. A ring
 * rather than columns because convergence has no direction — neither repo
 * depends on the other, they simply agree on a version and should move together.
 */
export function renderConvergence(conv: Convergence | undefined): string {
  const nodes = conv?.nodes ?? [];
  if (nodes.length < 2) {
    return `<div class="panel-body"><p class="no-results">
      Not enough repositories with dependencies to compare.</p></div>`;
  }
  const edges = conv!.edges;
  const W = 760, H = 460, cx = W / 2, cy = H / 2;
  const rx = Math.min(300, 120 + nodes.length * 14), ry = Math.min(180, 80 + nodes.length * 9);
  const pos = new Map(nodes.map((n, i) => {
    const angle = (i / nodes.length) * Math.PI * 2 - Math.PI / 2;
    return [n.id, { x: cx + Math.cos(angle) * rx, y: cy + Math.sin(angle) * ry }];
  }));

  const heaviest = Math.max(...edges.map(e => e.n), 1);
  const lines = edges.map(e => {
    const a = pos.get(e.a), b = pos.get(e.b);
    if (!a || !b) return "";
    const strong = e.n >= heaviest * 0.6;
    return `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}"
      class="conv-edge${strong ? " strong" : ""}" stroke-width="${Math.max(1, (e.n / heaviest) * 7).toFixed(1)}">
      <title>${esc(e.a)} ↔ ${esc(e.b)}: ${e.n} shared</title></line>`;
  }).join("");

  const maxDeps = Math.max(...nodes.map(n => n.deps), 1);
  const circles = nodes.map(n => {
    const { x, y } = pos.get(n.id)!;
    const r = 15 + (n.deps / maxDeps) * 18;
    return `<g class="conv-node">
      <circle cx="${x}" cy="${y}" r="${r}"><title>${esc(n.label)}: ${n.deps} dependencies${n.kind ? ` · ${esc(n.kind)}` : ""}</title></circle>
      <text x="${x}" y="${y + 4}" text-anchor="middle" class="conv-count">${n.deps}</text>
      <text x="${x}" y="${y + r + 15}" text-anchor="middle" class="conv-label">${esc(n.label)}</text>
    </g>`;
  }).join("");

  const top = edges.slice(0, 5).map(e => `<li>
      <span class="conv-pair">${esc(short(e.a))} ↔ ${esc(short(e.b))}</span>
      <span class="conv-n">${e.n} shared</span>
      <span class="conv-pkgs mono">${e.packages.slice(0, 5).map(esc).join(", ")}${e.packages.length > 5 ? " …" : ""}</span>
    </li>`).join("");

  return `<div class="panel-body">
    <p class="lead">Neither repo depends on the other — they simply agree on a package.
    Node size is dependency count, edge weight is packages in common. <strong>A tight cluster
    should be upgraded as one group</strong>: bumping React once across it is cheaper than
    bumping it in each repo separately.</p>
    <div class="graph-scroll"><svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}"
      role="img" aria-label="Repositories linked by shared dependencies">${lines}${circles}</svg></div>
    <ol class="conv-top">${top}</ol>
  </div>`;
}

/* ------------------------------------------------------------ layered graph */

interface Placed { id: string; label: string; sub: string; col: number; row: number }

/** Longest-path layering: a node sits to the right of everything that feeds it. */
export function layer(graph: Graph, labels: Map<string, { label: string; sub: string }>): Placed[] {
  const ids = graph.nodes.map(n => String(n.id));
  const incoming = new Map<string, string[]>();
  ids.forEach(id => incoming.set(id, []));
  for (const e of graph.edges) incoming.get(String(e.to))?.push(String(e.from));

  const col = new Map<string, number>();
  ids.forEach(id => col.set(id, 0));
  // Relax |V| times; enough for any acyclic graph, and bounded if a cycle exists.
  for (let pass = 0; pass < ids.length; pass++) {
    let moved = false;
    for (const e of graph.edges) {
      const next = (col.get(String(e.from)) ?? 0) + 1;
      if (next > (col.get(String(e.to)) ?? 0)) { col.set(String(e.to), next); moved = true; }
    }
    if (!moved) break;
  }

  const perCol = new Map<number, number>();
  return ids.map(id => {
    const c = col.get(id) ?? 0;
    const row = perCol.get(c) ?? 0;
    perCol.set(c, row + 1);
    const meta = labels.get(id) ?? { label: id, sub: "" };
    return { id, label: meta.label, sub: meta.sub, col: c, row };
  });
}

function graphSvg(placed: Placed[], edges: Graph["edges"], emptyMessage: string): string {
  if (!placed.length) return `<p class="no-results">${esc(emptyMessage)}</p>`;
  // The column gap must fit an edge label, or the label renders underneath the
  // next node box. GX - W is that gap; keep it comfortably wider than a label.
  const W = 208, H = 62, GAP = 104, GX = W + GAP, GY = 84, PAD = 26;
  const pos = new Map(placed.map(p => [p.id, { x: PAD + p.col * GX, y: PAD + 26 + p.row * GY }]));
  const width = PAD * 2 + (Math.max(...placed.map(p => p.col)) * GX) + W;
  const height = PAD * 2 + 26 + (Math.max(...placed.map(p => p.row)) + 1) * GY;

  const lines = edges.map(e => {
    const a = pos.get(String(e.from)), b = pos.get(String(e.to));
    if (!a || !b) return "";
    const x1 = a.x + W, y1 = a.y + H / 2, x2 = b.x, y2 = b.y + H / 2, mx = (x1 + x2) / 2;
    // Only label an edge that spans a single column: anything longer passes
    // behind intervening boxes and the label has nowhere clear to sit.
    const spansOneColumn = Math.abs(x2 - x1 - GAP) < 2;
    const label = e.package && spansOneColumn
      ? `<text x="${mx}" y="${(y1 + y2) / 2 - 8}" text-anchor="middle" class="edge-label">${esc(
          e.package.length > 13 ? e.package.slice(0, 12) + "…" : e.package)}</text>`
      : "";
    return `<path d="M${x1} ${y1} C${mx} ${y1} ${mx} ${y2} ${x2} ${y2}" class="edge"/>${label}`;
  }).join("");

  const cols = [...new Set(placed.map(p => p.col))].sort((a, b) => a - b);
  const headers = cols.map(c =>
    `<text x="${PAD + c * GX}" y="${PAD - 4}" class="col-label">${c === 0 ? "SOURCE" : `WAVE ${c}`}</text>`).join("");

  const boxes = placed.map(p => {
    const { x, y } = pos.get(p.id)!;
    return `<g class="node">
      <rect x="${x}" y="${y}" width="${W}" height="${H}" rx="3"/>
      <rect x="${x}" y="${y}" width="4" height="${H}" class="node-edge"/>
      <text x="${x + 16}" y="${y + 26}" class="node-label">${esc(p.label.slice(0, 24))}</text>
      <text x="${x + 16}" y="${y + 44}" class="node-sub">${esc(p.sub.slice(0, 30))}</text>
    </g>`;
  }).join("");

  return `<div class="graph-scroll"><svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}"
    role="img" aria-label="Dependency graph with ${placed.length} nodes">${lines}${headers}${boxes}</svg></div>`;
}

/* ------------------------------------------------------------- build tree */

export function renderBuildTree(fleet: Fleet): string {
  const tree = fleet.build_tree ?? { nodes: [], edges: [] };
  const labels = new Map(tree.nodes.map(n =>
    [String(n.id), { label: String(n.name ?? n.id), sub: String(n.project ?? "") }]));
  return `
    <article class="panel">
      <div class="panel-head">
        <div><span class="overline">Build order</span><h2>Pipeline tree</h2></div>
        <div class="filter"><span>${tree.nodes.length} pipelines · ${tree.edges.length} edges</span></div>
      </div>
      <div class="panel-body">
        <p class="lead">Edges come from <code>resources.pipelines</code>. This answers what to
        <strong>rebuild</strong> after a change lands — not what to upgrade, which is the cascade.</p>
        ${graphSvg(layer(tree, labels), tree.edges,
          "No pipeline declares another as a resource, so there is no build tree to draw.")}
      </div>
    </article>`;
}

/* --------------------------------------------------------------- cascade */

export function renderCascade(fleet: Fleet, selected?: string): string {
  const names = Object.keys(fleet.cascades ?? {});
  if (!names.length) {
    return `<article class="panel"><div class="panel-body"><p class="no-results">
      No internal packages found. A package counts as internal when one repo publishes it
      and another consumes it — that link comes from the feed's provenance.</p></div></article>`;
  }
  const active = selected && names.includes(selected) ? selected : names[0];
  const waves = fleet.cascades![active] ?? [];
  const owner = (fleet.repos ?? []).find(r => (r.publishes ?? []).includes(active));

  const nodes: Placed[] = [];
  if (owner) nodes.push({ id: owner.key, label: short(owner.key), sub: `publishes ${active}`, col: 0, row: 0 });
  waves.forEach((wave, i) => wave.forEach((key, row) =>
    nodes.push({ id: key, label: short(key), sub: `wave ${i + 1}`, col: i + 1, row })));

  const edges = (fleet.package_graph?.edges ?? [])
    .filter(e => nodes.some(n => n.id === String(e.from)) && nodes.some(n => n.id === String(e.to)));

  const order = waves.map((wave, i) =>
    `<li><span class="wave-no">wave ${i + 1}</span><span>${wave.map(k => esc(short(k))).join(", ")}</span></li>`).join("");

  return `
    <article class="panel">
      <div class="panel-head">
        <div><span class="overline">Upgrade order</span><h2>Internal package cascade</h2></div>
        <div class="filter">
          <select id="cascadePick" aria-label="Internal package">
            ${names.map(n => `<option value="${esc(n)}"${n === active ? " selected" : ""}>${esc(n)}</option>`).join("")}
          </select>
        </div>
      </div>
      <div class="panel-body">
        <p class="lead">Wave N+1 cannot start until wave N has published — nothing can bump to a
        version that is not on the feed yet. A repo appears in the <em>last</em> wave that reaches it,
        so it is never scheduled ahead of one of its own inputs.</p>
        ${graphSvg(nodes, edges, "Nothing consumes this package.")}
        <ol class="wave-order">${order || `<li><span>No consumers.</span></li>`}</ol>
      </div>
    </article>`;
}

/* ---------------------------------------------------------------- trains */

export function renderTrains(fleet: Fleet): string {
  const trains = (fleet.release_trains ?? []).filter(t => t.count > 0);
  const clean = (fleet.release_trains ?? []).length - trains.length;

  const cards = trains.map(t => `
    <article class="panel train">
      <div class="panel-head">
        <div><span class="overline">${esc(short(t.repo))}</span><h2>${esc(t.branch)}</h2></div>
        <div class="filter"><span class="pill ${t.count > 3 ? "critical" : "medium"}">${t.count} behind</span></div>
      </div>
      <div class="table-wrap"><table>
        <thead><tr><th>Package</th><th>On ${esc(t.branch)}</th><th></th><th>On mainline</th><th>Jump</th></tr></thead>
        <tbody>${t.behind.map(b => `<tr>
          <td><strong>${esc(b.package)}</strong></td>
          <td class="mono">${esc(b.release)}</td><td class="arrow">→</td>
          <td class="mono">${esc(b.mainline)}</td>
          <td><span class="pill ${b.jump === "major" ? "critical" : "medium"}">${esc(b.jump)}</span></td>
        </tr>`).join("")}</tbody>
      </table></div>
    </article>`).join("");

  return `
    <p class="lead lead-standalone">What mainline has already fixed and the release branch has not.
    Under the release policy these arrive by <strong>merge from main</strong>, never by upgrading the
    branch directly — a release branch exists to fix what is broken, not to stay current.</p>
    ${cards || `<article class="panel"><div class="panel-body"><p class="no-results">
      Every release branch is level with mainline.</p></div></article>`}
    ${clean > 0 ? `<p class="footnote">${clean} release branch${clean > 1 ? "es are" : " is"} already level with mainline.</p>` : ""}`;
}
