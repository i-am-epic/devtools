#!/usr/bin/env python3
"""Walk an Azure DevOps organisation and build the fleet picture.

Answers the questions a single-repo inventory cannot:

  - what is in the estate at all (projects, repos, pipelines, release branches)
  - what feeds what at BUILD time   (pipeline resources -> build tree)
  - what feeds what at PACKAGE time (internal packages -> cascade waves)
  - what is fixed on main but not yet on a release train
  - which packages the estate shares, and how far each consumer has drifted

These are two different graphs and conflating them is the classic mistake. A
release pipeline depends on a build pipeline without consuming its library; an
internal package cascade often has no pipeline edge at all. Build order comes
from the first, upgrade order from the second.

Azure DevOps has no "who consumes package P" endpoint, so consumers are derived
by reading each repo's manifests - cheaply, over the items API, without cloning.

Usage:
    python discover.py --org https://dev.azure.com/contoso --out fleet.json
    python discover.py --from-dir captured/            # replay saved responses
"""
from __future__ import annotations

import argparse
import base64
import json
import os
import re
import statistics
import sys
import urllib.error
import urllib.parse
import urllib.request
from collections import defaultdict
from pathlib import Path

import inventory as inv

API = "7.1"
TIMEOUT = 30
MANIFESTS = ["package.json", "requirements.txt", "pyproject.toml", "pubspec.yaml",
             "Directory.Packages.props"]


# --------------------------------------------------------------------------- transport

class Ado:
    """The only part that talks to Azure DevOps.

    Kept deliberately thin: everything below operates on plain dicts, so the
    graph logic is testable without a live organisation.
    """

    def __init__(self, org: str, token: str | None = None, from_dir: Path | None = None):
        self.org = org.rstrip("/")
        self.token = token or os.environ.get("SYSTEM_ACCESSTOKEN") or os.environ.get("AZDO_PAT")
        self.from_dir = from_dir

    def get(self, path: str, **params) -> dict:
        params.setdefault("api-version", API)
        url = f"{self.org}/{path.lstrip('/')}?{urllib.parse.urlencode(params)}"
        if self.from_dir:                                   # replay mode
            key = re.sub(r"[^a-zA-Z0-9]+", "_", f"{path}_{sorted(params.items())}")[:120]
            f = self.from_dir / f"{key}.json"
            if not f.exists():
                raise FileNotFoundError(f"no captured response for {path} ({f.name})")
            return json.loads(f.read_text())
        req = urllib.request.Request(url, headers={"Accept": "application/json"})
        if self.token:
            req.add_header("Authorization",
                           "Basic " + base64.b64encode(f":{self.token}".encode()).decode())
        with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
            return json.load(r)

    def text(self, path: str, **params) -> str | None:
        """Manifest contents, or None when the repo does not have that file."""
        params.setdefault("api-version", API)
        url = f"{self.org}/{path.lstrip('/')}?{urllib.parse.urlencode(params)}"
        if self.from_dir:
            key = re.sub(r"[^a-zA-Z0-9]+", "_", f"{path}_{sorted(params.items())}")[:120]
            f = self.from_dir / f"{key}.txt"
            return f.read_text() if f.exists() else None
        req = urllib.request.Request(url)
        if self.token:
            req.add_header("Authorization",
                           "Basic " + base64.b64encode(f":{self.token}".encode()).decode())
        try:
            with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
                return r.read().decode("utf-8", "replace")
        except urllib.error.HTTPError as exc:
            if exc.code == 404:
                return None
            raise


# --------------------------------------------------------------------------- graph logic
# Everything below is a pure function of plain data, so it is tested against
# fixtures rather than against a live organisation.

def build_tree(pipelines: list[dict]) -> dict:
    """Edges between pipelines, from `resources.pipelines` in their YAML.

    `pipelines` entries look like {"id", "name", "project", "yaml": "<text>"}.
    """
    by_name = {p["name"]: p for p in pipelines}
    nodes = [{"id": p["id"], "name": p["name"], "project": p.get("project", "")}
             for p in pipelines]
    edges = []
    for p in pipelines:
        for source in referenced_pipelines(p.get("yaml") or ""):
            upstream = by_name.get(source)
            if upstream and upstream["id"] != p["id"]:
                edges.append({"from": upstream["id"], "to": p["id"], "via": source})
    return {"nodes": nodes, "edges": edges}


def referenced_pipelines(yaml_text: str) -> list[str]:
    """Pull `source:` names out of a `resources: pipelines:` block.

    Deliberately a narrow scan rather than a YAML parse: the agent may not have
    pyyaml, and this file only needs one construct.
    """
    out, in_resources, in_pipelines = [], False, False
    for raw in yaml_text.splitlines():
        line = raw.split("#")[0].rstrip()
        if not line.strip():
            continue
        indent = len(line) - len(line.lstrip())
        stripped = line.strip()
        if indent == 0:
            in_resources = stripped.startswith("resources:")
            in_pipelines = False
            continue
        if in_resources and stripped.startswith("pipelines:"):
            in_pipelines = True
            continue
        if in_resources and in_pipelines:
            if indent <= 2 and not stripped.startswith("-") and ":" in stripped:
                in_pipelines = False                        # a sibling of pipelines:
                continue
            m = re.match(r"-?\s*source:\s*['\"]?([^'\"\s]+)", stripped)
            if m:
                out.append(m.group(1))
    return out


def package_graph(repos: list[dict]) -> dict:
    """Edges from a repo that PUBLISHES an internal package to repos that consume it.

    A repo publishes what its feed provenance says it published; it consumes what
    its manifests declare. The join is by package name.
    """
    publisher = {}
    for repo in repos:
        for name in repo.get("publishes", []):
            publisher[name.lower()] = repo["key"]
    nodes = [{"id": r["key"], "publishes": r.get("publishes", [])} for r in repos]
    edges = []
    for repo in repos:
        for pkg in repo.get("packages", []):
            owner = publisher.get(pkg["name"].lower())
            if owner and owner != repo["key"]:
                edges.append({"from": owner, "to": repo["key"],
                              "package": pkg["name"],
                              "version": pkg.get("resolved") or pkg.get("spec")})
    return {"nodes": nodes, "edges": edges}


def waves(graph: dict, root: str) -> list[list[str]]:
    """Consumers of `root`, in the order they can actually be upgraded.

    Wave 1 is the direct consumers; wave N+1 cannot start until wave N has
    published, because nothing can bump to a version that is not on the feed yet.
    A node appears in the LAST wave that reaches it, so it is never scheduled
    before one of its own inputs.
    """
    downstream = defaultdict(list)
    for e in graph.get("edges", []):
        downstream[e["from"]].append(e["to"])

    depth: dict[str, int] = {}
    # Longest-path depth, with a visit cap so a cycle cannot spin forever.
    stack, guard = [(root, 0)], 0
    while stack and guard < 10000:
        node, d = stack.pop()
        guard += 1
        for child in downstream.get(node, []):
            if child == root:
                continue
            if depth.get(child, -1) < d + 1:
                depth[child] = d + 1
                stack.append((child, d + 1))
    if not depth:
        return []
    out: list[list[str]] = [[] for _ in range(max(depth.values()))]
    for node, d in sorted(depth.items()):
        out[d - 1].append(node)
    return out


def cycles(graph: dict) -> list[list[str]]:
    """Dependency cycles between repos. A finding in its own right, not a crash."""
    downstream = defaultdict(list)
    for e in graph.get("edges", []):
        downstream[e["from"]].append(e["to"])
    found, colour = [], {}

    def walk(node: str, path: list[str]) -> None:
        colour[node] = 1
        for child in downstream.get(node, []):
            if colour.get(child) == 1:
                found.append(path[path.index(child):] + [child] if child in path
                             else [child, node, child])
            elif colour.get(child, 0) == 0:
                walk(child, path + [child])
        colour[node] = 2

    for node in list(downstream):
        if colour.get(node, 0) == 0:
            walk(node, [node])
    return found


def release_train_diff(mainline: list[dict], release: list[dict]) -> list[dict]:
    """Packages where the release branch sits behind mainline.

    This is the question that bites during a remediation cycle: what has already
    been fixed on main and has not reached 26.1 yet.
    """
    main_by = {p["name"].lower(): p for p in mainline}
    out = []
    for pkg in release:
        ahead = main_by.get(pkg["name"].lower())
        if not ahead:
            continue
        here, there = pkg.get("resolved") or pkg.get("spec"), ahead.get("resolved") or ahead.get("spec")
        if here and there and inv.parse(there) > inv.parse(here):
            out.append({"package": pkg["name"], "release": here, "mainline": there,
                        "jump": inv.classify(here, there)})
    return sorted(out, key=lambda r: r["package"])


def drift(repos: list[dict]) -> list[dict]:
    """How far behind each shared package's consumers sit.

    Drift, not advisory count, is the leading indicator: consumers lagging six
    versions turn the next CVE into a multi-week cascade.
    """
    usage = defaultdict(list)
    for repo in repos:
        for pkg in repo.get("packages", []):
            if pkg.get("latest") and (pkg.get("resolved") or pkg.get("spec")):
                usage[(pkg["ecosystem"], pkg["name"])].append((repo["key"], pkg))
    out = []
    for (eco, name), uses in usage.items():
        if len(uses) < 2:
            continue
        majors_behind, minors_behind, versions = [], [], []
        for _key, pkg in uses:
            cur = inv.parse(pkg.get("resolved") or pkg.get("spec"))
            latest = inv.parse(pkg["latest"])
            # Majors and minors are different units; collapsing them into one
            # number produces a figure nobody can interpret.
            majors_behind.append(max(0, latest[0] - cur[0]))
            minors_behind.append(max(0, latest[1] - cur[1]) if latest[0] == cur[0] else 0)
            versions.append(pkg.get("resolved") or pkg.get("spec"))
        majors = {inv.parse(v)[0] for v in versions if v}
        out.append({
            "ecosystem": eco, "name": name, "consumers": len(uses),
            "versions": sorted(set(v for v in versions if v)),
            "latest": uses[0][1]["latest"],
            "median_majors_behind": round(statistics.median(majors_behind), 1),
            "max_majors_behind": max(majors_behind),
            "median_minors_behind": round(statistics.median(minors_behind), 1),
            "split_major": len(majors) > 1,
            "repos": [key for key, _ in uses],
        })
    return sorted(out, key=lambda d: (-d["max_majors_behind"], -d["consumers"], d["name"]))


# --------------------------------------------------------------------------- collection

def parse_manifest(name: str, text: str, root: Path) -> list[dict]:
    """Reuse inventory.py's readers by staging the file on disk."""
    (root / name).write_text(text)
    if name == "package.json":
        return inv.read_npm(root)
    if name in ("requirements.txt", "pyproject.toml"):
        return inv.read_pypi(root)
    if name == "pubspec.yaml":
        return inv.read_pub(root)
    if name == "Directory.Packages.props":
        return inv.read_nuget(root)
    return []


def collect(ado: Ado, project_filter: str | None = None) -> dict:
    import tempfile

    projects = [p for p in ado.get("_apis/projects").get("value", [])
                if not project_filter or p["name"] == project_filter]
    repos, pipelines = [], []

    for project in projects:
        name = project["name"]
        for repo in ado.get(f"{urllib.parse.quote(name)}/_apis/git/repositories").get("value", []):
            key = f"{name}/{repo['name']}"
            branches = [r["name"].replace("refs/heads/", "")
                        for r in ado.get(
                            f"{urllib.parse.quote(name)}/_apis/git/repositories/"
                            f"{repo['id']}/refs", filter="heads/").get("value", [])]
            release_branches = [b for b in branches
                                if re.search(r"^(release|hotfix)/|^\d+\.\d+$", b)]

            def manifests_at(version: str | None) -> list[dict]:
                found = []
                with tempfile.TemporaryDirectory() as tmp:
                    for manifest in MANIFESTS:
                        extra = {"versionDescriptor.version": version,
                                 "versionDescriptor.versionType": "branch"} if version else {}
                        body = ado.text(
                            f"{urllib.parse.quote(name)}/_apis/git/repositories/"
                            f"{repo['id']}/items",
                            path=manifest, includeContent="true",
                            **{"$format": "text"}, **extra)
                        if body:
                            found.extend(parse_manifest(manifest, body, Path(tmp)))
                return found

            repos.append({
                "key": key, "project": name, "repo": repo["name"],
                "branches": branches,
                "release_branches": release_branches,
                "packages": manifests_at(None),
                # One extra read per release branch; this is what makes the
                # "fixed on main, not yet on 26.1" question answerable.
                "branch_packages": {b: manifests_at(b) for b in release_branches},
                "publishes": [],
            })

        for pipe in ado.get(f"{urllib.parse.quote(name)}/_apis/pipelines").get("value", []):
            yaml_text = ""
            try:
                detail = ado.get(f"{urllib.parse.quote(name)}/_apis/pipelines/{pipe['id']}")
                yaml_text = ((detail.get("configuration") or {}).get("yaml")
                             or (detail.get("configuration") or {}).get("path") or "")
            except (urllib.error.HTTPError, FileNotFoundError):
                pass
            pipelines.append({"id": pipe["id"], "name": pipe["name"],
                              "project": name, "yaml": yaml_text})

    return {"projects": [p["name"] for p in projects], "repos": repos, "pipelines": pipelines}


def assemble(raw: dict, org: str = "") -> dict:
    repos, pipelines = raw["repos"], raw["pipelines"]
    pkg_graph = package_graph(repos)
    internal = sorted({e["package"] for e in pkg_graph["edges"]})
    return {
        "org": org,
        "projects": raw.get("projects", []),
        "counts": {
            "repos": len(repos), "pipelines": len(pipelines),
            "packages": sum(len(r.get("packages", [])) for r in repos),
            "release_branches": sum(len(r.get("release_branches", [])) for r in repos),
        },
        "repos": repos,
        "build_tree": build_tree(pipelines),
        "package_graph": pkg_graph,
        "internal_packages": internal,
        "cascades": {name: waves(pkg_graph, owner)
                     for name, owner in _owners(repos, internal).items()},
        "cycles": cycles(pkg_graph),
        "drift": drift(repos),
        "release_trains": release_trains(repos),
        "convergence": convergence(repos),
    }


def convergence(repos: list[dict]) -> dict:
    """Repositories linked by the third-party packages they share.

    Distinct from both other graphs: no build edge, no publisher. It answers
    "which repos should be upgraded as one group", because bumping React once
    across a cluster is cheaper than bumping it in each repo separately.
    """
    names = {r["key"]: {p["name"] for p in r.get("packages", [])} for r in repos}
    nodes = [{"id": r["key"], "label": r.get("repo") or r["key"],
              "deps": len(r.get("packages", [])), "kind": r.get("kind", "")}
             for r in repos if r.get("packages")]
    keys = [n["id"] for n in nodes]
    edges = []
    for i, a in enumerate(keys):
        for b in keys[i + 1:]:
            common = names[a] & names[b]
            if common:
                edges.append({"a": a, "b": b, "n": len(common),
                              "packages": sorted(common)[:8]})
    edges.sort(key=lambda e: -e["n"])
    return {"nodes": nodes, "edges": edges}


def release_trains(repos: list[dict]) -> list[dict]:
    """Per release branch, what mainline has already fixed and it has not."""
    out = []
    for repo in repos:
        for branch, packages in (repo.get("branch_packages") or {}).items():
            behind = release_train_diff(repo.get("packages", []), packages)
            out.append({"repo": repo["key"], "branch": branch,
                        "behind": behind, "count": len(behind)})
    return sorted(out, key=lambda t: (-t["count"], t["repo"]))


def _owners(repos: list[dict], internal: list[str]) -> dict[str, str]:
    out = {}
    for repo in repos:
        for name in repo.get("publishes", []):
            if name in internal:
                out[name] = repo["key"]
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--org", default="", help="https://dev.azure.com/<org>")
    ap.add_argument("--project", help="limit to one project")
    ap.add_argument("--from-dir", help="replay captured API responses instead of calling ADO")
    ap.add_argument("--out", default="fleet.json")
    args = ap.parse_args()

    if not args.org and not args.from_dir:
        print("need --org or --from-dir", file=sys.stderr)
        return 2

    ado = Ado(args.org, from_dir=Path(args.from_dir) if args.from_dir else None)
    try:
        raw = collect(ado, args.project)
    except (urllib.error.URLError, urllib.error.HTTPError) as exc:
        print(f"Azure DevOps unreachable: {exc}", file=sys.stderr)
        return 2

    fleet = assemble(raw, args.org)
    Path(args.out).write_text(json.dumps(fleet, indent=1))
    c = fleet["counts"]
    print(f"{c['repos']} repos · {c['pipelines']} pipelines · {c['packages']} packages · "
          f"{c['release_branches']} release branches")
    print(f"build tree: {len(fleet['build_tree']['edges'])} edges · "
          f"package graph: {len(fleet['package_graph']['edges'])} edges · "
          f"{len(fleet['internal_packages'])} internal packages")
    if fleet["cycles"]:
        print(f"WARNING: {len(fleet['cycles'])} dependency cycle(s) between repos",
              file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
