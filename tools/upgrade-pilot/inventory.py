#!/usr/bin/env python3
"""Lockfile-first dependency inventory.

Reads what is actually resolved, not what the manifest asks for - the gap
between the two is where the surprises live. Resolves latest versions and
peer constraints from the public registries, or from an Azure Artifacts
upstream feed when one is configured.

Usage:
    python inventory.py <repo-root> [--out inventory.json] [--offline]
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

TIMEOUT = 25
FEED = os.environ.get("UPGRADE_PILOT_FEED")  # e.g. https://pkgs.dev.azure.com/org/_packaging/feed/npm/registry


# --------------------------------------------------------------------------- registries

def _get_json(url: str):
    req = urllib.request.Request(url, headers={"Accept": "application/json"})
    token = os.environ.get("SYSTEM_ACCESSTOKEN")
    if token and "dev.azure.com" in url:
        import base64
        basic = base64.b64encode(f":{token}".encode()).decode()
        req.add_header("Authorization", f"Basic {basic}")
    with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
        return json.load(r)


def npm_meta(name: str) -> dict:
    base = FEED.rstrip("/") if FEED else "https://registry.npmjs.org"
    d = _get_json(f"{base}/{urllib.parse.quote(name, safe='@')}")
    latest = d.get("dist-tags", {}).get("latest")
    v = d.get("versions", {}).get(latest, {})
    repo = v.get("repository") or {}
    return {
        "latest": latest,
        "peers": v.get("peerDependencies") or {},
        "engines": v.get("engines") or {},
        "deprecated": v.get("deprecated"),
        "published": (d.get("time") or {}).get(latest, "")[:10],
        "repo_url": repo.get("url"),
        "repo_dir": repo.get("directory"),
        "homepage": v.get("homepage"),
    }


def pypi_meta(name: str) -> dict:
    d = _get_json(f"https://pypi.org/pypi/{urllib.parse.quote(name)}/json")
    info = d["info"]
    urls = d.get("urls") or []
    return {
        "latest": info["version"],
        "peers": {},
        "engines": {"python": info.get("requires_python") or ""},
        "deprecated": None,
        "published": (urls[0].get("upload_time") if urls else "")[:10],
        "repo_url": (info.get("project_urls") or {}).get("Source")
        or (info.get("project_urls") or {}).get("Homepage"),
        "repo_dir": None,
        "homepage": info.get("home_page"),
    }


def nuget_meta(name: str) -> dict:
    low = name.lower()
    base = "https://api.nuget.org/v3-flatcontainer"
    versions = _get_json(f"{base}/{urllib.parse.quote(low)}/index.json")["versions"]
    stable = [v for v in versions if not re.search(r"[-+]", v)] or versions
    return {
        "latest": stable[-1],
        "peers": {},
        "engines": {},
        "deprecated": None,
        "published": "",
        "repo_url": None,
        "repo_dir": None,
        "homepage": f"https://www.nuget.org/packages/{name}",
    }


def pub_meta(name: str) -> dict:
    d = _get_json(f"https://pub.dev/api/packages/{urllib.parse.quote(name)}")
    return {
        "latest": d["latest"]["version"],
        "peers": {},
        "engines": (d["latest"].get("pubspec") or {}).get("environment") or {},
        "deprecated": None,
        "published": (d["latest"].get("published") or "")[:10],
        "repo_url": (d["latest"].get("pubspec") or {}).get("repository"),
        "repo_dir": None,
        "homepage": f"https://pub.dev/packages/{name}",
    }


REGISTRIES = {"npm": npm_meta, "pypi": pypi_meta, "nuget": nuget_meta, "pub": pub_meta}


# --------------------------------------------------------------------------- lockfile readers

def read_npm(root: Path) -> list[dict]:
    """package-lock.json holds resolved versions; package.json only holds ranges."""
    pkg_path, lock_path = root / "package.json", root / "package-lock.json"
    if not pkg_path.exists():
        return []
    pkg = json.loads(pkg_path.read_text())
    declared = {**pkg.get("dependencies", {}), **pkg.get("devDependencies", {})}
    resolved: dict[str, str] = {}
    if lock_path.exists():
        lock = json.loads(lock_path.read_text())
        for path, entry in (lock.get("packages") or {}).items():
            if path.startswith("node_modules/") and entry.get("version"):
                resolved[path[len("node_modules/"):]] = entry["version"]
    return [
        {
            "name": n,
            "spec": s,
            "resolved": resolved.get(n),
            "direct": True,
            "dev": n in pkg.get("devDependencies", {}),
        }
        for n, s in declared.items()
    ] + [
        {"name": n, "spec": None, "resolved": v, "direct": False, "dev": False}
        for n, v in resolved.items()
        if n not in declared
    ]


def read_pypi(root: Path) -> list[dict]:
    out, seen = [], set()
    req = root / "requirements.txt"
    if req.exists():
        for line in req.read_text().splitlines():
            line = line.split("#")[0].strip()
            if not line or line.startswith("-"):
                continue
            m = re.match(r"^([A-Za-z0-9_.\-\[\]]+)\s*(==|>=|~=|>|<)?\s*([^;\s]+)?", line)
            if not m:
                continue
            name = m.group(1).split("[")[0]
            seen.add(name.lower())
            out.append({
                "name": name, "spec": (m.group(2) or "") + (m.group(3) or ""),
                "resolved": m.group(3) if m.group(2) == "==" else None,
                "direct": True, "dev": False,
            })
    pyproject = root / "pyproject.toml"
    if pyproject.exists():
        text = pyproject.read_text()
        block = re.search(r"dependencies\s*=\s*\[(.*?)\]", text, re.S)
        if block:
            for raw in re.findall(r'"([^"]+)"', block.group(1)):
                m = re.match(r"^([A-Za-z0-9_.\-]+)", raw)
                if m and m.group(1).lower() not in seen:
                    out.append({
                        "name": m.group(1), "spec": raw[len(m.group(1)):].strip() or None,
                        "resolved": None, "direct": True, "dev": False,
                    })
    return out


def read_nuget(root: Path) -> list[dict]:
    """Central Package Management first - with Directory.Packages.props, versions
    live there and a Version attribute on a PackageReference is an error."""
    out, central = [], {}
    cpm = root / "Directory.Packages.props"
    if cpm.exists():
        for m in re.finditer(r'<PackageVersion\s+Include="([^"]+)"\s+Version="([^"]+)"', cpm.read_text()):
            central[m.group(1)] = m.group(2)
    resolved = {}
    for lock in root.rglob("packages.lock.json"):
        data = json.loads(lock.read_text())
        for _tfm, deps in (data.get("dependencies") or {}).items():
            for name, meta in deps.items():
                if meta.get("resolved"):
                    resolved[name] = meta["resolved"]
    declared = dict(central)
    for proj in list(root.rglob("*.csproj")) + list(root.rglob("*.fsproj")):
        for m in re.finditer(r'<PackageReference\s+Include="([^"]+)"(?:\s+Version="([^"]+)")?', proj.read_text()):
            declared.setdefault(m.group(1), m.group(2) or central.get(m.group(1)))
    for name, spec in declared.items():
        out.append({"name": name, "spec": spec, "resolved": resolved.get(name),
                    "direct": True, "dev": False})
    for name, ver in resolved.items():
        if name not in declared:
            out.append({"name": name, "spec": None, "resolved": ver, "direct": False, "dev": False})
    return out


def read_pub(root: Path) -> list[dict]:
    spec = root / "pubspec.yaml"
    if not spec.exists():
        return []
    resolved = {}
    lock = root / "pubspec.lock"
    if lock.exists():
        cur = None
        for line in lock.read_text().splitlines():
            m = re.match(r"^  ([a-z0-9_]+):", line)
            if m:
                cur = m.group(1)
            v = re.match(r'^    version: "([^"]+)"', line)
            if v and cur:
                resolved[cur] = v.group(1)
    out, in_deps = [], False
    for line in spec.read_text().splitlines():
        if re.match(r"^(dev_)?dependencies:", line):
            in_deps = True
            continue
        if line and not line.startswith((" ", "\t")):
            in_deps = False
        m = re.match(r"^  ([a-z_0-9]+):\s*\^?([\d][^\s#]*)", line)
        if in_deps and m:
            out.append({"name": m.group(1), "spec": m.group(2),
                        "resolved": resolved.get(m.group(1)), "direct": True, "dev": False})
    return out


READERS = {"npm": read_npm, "pypi": read_pypi, "nuget": read_nuget, "pub": read_pub}


# --------------------------------------------------------------------------- comparison

def parse(v: str | None) -> list[int]:
    if not v:
        return []
    nums = [int(x) for x in re.findall(r"\d+", v)[:3]]
    return nums + [0] * (3 - len(nums))


def classify(current: str | None, latest: str | None) -> str:
    if not current:
        return "unpinned"
    if not latest:
        return "unknown"
    a, b = parse(current), parse(latest)
    if a >= b:
        return "current"
    return "major" if a[0] != b[0] else "minor" if a[1] != b[1] else "patch"


def changelog_sources(meta: dict) -> list[str]:
    """Three-tier fallback. Not every package ships a CHANGELOG at a derivable
    path, which is why this is a chain and not a rule."""
    out = []
    url = (meta.get("repo_url") or "")
    m = re.search(r"github\.com[:/]+([^/]+)/([^/.]+)", url)
    if m:
        org, repo = m.group(1), m.group(2)
        prefix = f"{meta['repo_dir']}/" if meta.get("repo_dir") else ""
        for branch in ("main", "master"):
            out.append(f"https://raw.githubusercontent.com/{org}/{repo}/{branch}/{prefix}CHANGELOG.md")
        out.append(f"https://github.com/{org}/{repo}/releases")
    if meta.get("homepage"):
        out.append(meta["homepage"])
    return out


def detect(root: Path) -> list[str]:
    found = []
    if (root / "package.json").exists():
        found.append("npm")
    if (root / "requirements.txt").exists() or (root / "pyproject.toml").exists():
        found.append("pypi")
    if any(root.rglob("*.csproj")) or (root / "Directory.Packages.props").exists():
        found.append("nuget")
    if (root / "pubspec.yaml").exists():
        found.append("pub")
    return found


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("root")
    ap.add_argument("--out", default="inventory.json")
    ap.add_argument("--offline", action="store_true", help="skip registry lookups")
    ap.add_argument("--include-transitive", action="store_true")
    args = ap.parse_args()

    root = Path(args.root).resolve()
    rows, cache = [], {}

    for eco in detect(root):
        for dep in READERS[eco](root):
            if not dep["direct"] and not args.include_transitive:
                continue
            meta = {}
            if not args.offline:
                key = (eco, dep["name"])
                if key not in cache:
                    try:
                        cache[key] = REGISTRIES[eco](dep["name"])
                    except (urllib.error.URLError, urllib.error.HTTPError, KeyError, ValueError) as exc:
                        cache[key] = {"error": str(exc)}
                meta = cache[key]
            current = dep["resolved"] or (dep["spec"] or "").lstrip("^~>=< ")
            rows.append({
                "ecosystem": eco,
                "name": dep["name"],
                "spec": dep["spec"],
                "resolved": dep["resolved"],
                "direct": dep["direct"],
                "dev": dep["dev"],
                "latest": meta.get("latest"),
                "gap": classify(current or None, meta.get("latest")),
                "peers": meta.get("peers") or {},
                "engines": meta.get("engines") or {},
                "deprecated": meta.get("deprecated"),
                "published": meta.get("published"),
                "changelog": changelog_sources(meta) if meta else [],
            })

    summary = {"repo": root.name, "total": len(rows)}
    for row in rows:
        summary[row["gap"]] = summary.get(row["gap"], 0) + 1

    Path(args.out).write_text(json.dumps({"summary": summary, "packages": rows}, indent=1))
    print(json.dumps(summary, indent=1))

    # A manifest range that already floats above what it declares is worth saying
    # out loud: the "safe minor bumps" it implies are usually already applied.
    drift = [r for r in rows if r["spec"] and r["resolved"]
             and parse(r["resolved"]) > parse(r["spec"].lstrip("^~>=< "))]
    if drift:
        print(f"\n{len(drift)} packages resolve above their declared range "
              f"(e.g. {drift[0]['name']} {drift[0]['spec']} -> {drift[0]['resolved']})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
