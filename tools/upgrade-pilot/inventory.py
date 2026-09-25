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
import hashlib
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

TIMEOUT = 25
RETRIES = 3
BACKOFF = (1, 3, 8)          # seconds; a rate limit needs room, not a tight loop
CACHE_TTL = 6 * 3600
FEED = os.environ.get("UPGRADE_PILOT_FEED")  # e.g. https://pkgs.dev.azure.com/org/_packaging/feed/npm/registry


# --------------------------------------------------------------------------- registries

class NotFound(Exception):
    """The registry answered, and the package genuinely is not there."""


class Unavailable(Exception):
    """The registry did not answer. The inventory is incomplete, not empty."""


_cache_dir: Path | None = None


def _cache_path(url: str) -> Path | None:
    if _cache_dir is None:
        return None
    return _cache_dir / (hashlib.sha256(url.encode()).hexdigest()[:32] + ".json")


def _get_json(url: str):
    cached = _cache_path(url)
    if cached and cached.exists() and time.time() - cached.stat().st_mtime < CACHE_TTL:
        try:
            return json.loads(cached.read_text())
        except json.JSONDecodeError:
            cached.unlink(missing_ok=True)

    req = urllib.request.Request(url, headers={"Accept": "application/json"})
    token = os.environ.get("SYSTEM_ACCESSTOKEN")
    if token and "dev.azure.com" in url:
        import base64
        basic = base64.b64encode(f":{token}".encode()).decode()
        req.add_header("Authorization", f"Basic {basic}")

    last = ""
    for attempt in range(RETRIES):
        try:
            with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
                data = json.load(r)
            if cached:
                cached.parent.mkdir(parents=True, exist_ok=True)
                cached.write_text(json.dumps(data))
            return data
        except urllib.error.HTTPError as exc:
            if exc.code == 404:
                raise NotFound(url) from exc
            # 429 and 5xx are worth another go; 4xx otherwise is not.
            if exc.code != 429 and exc.code < 500:
                raise Unavailable(f"HTTP {exc.code} for {url}") from exc
            last = f"HTTP {exc.code}"
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
            last = str(exc)
        if attempt < RETRIES - 1:
            time.sleep(BACKOFF[attempt])
    raise Unavailable(f"{last} after {RETRIES} attempts: {url}")


def npm_meta(name: str) -> dict:
    base = FEED.rstrip("/") if FEED else "https://registry.npmjs.org"
    d = _get_json(f"{base}/{urllib.parse.quote(name, safe='@')}")
    latest = d.get("dist-tags", {}).get("latest")
    v = d.get("versions", {}).get(latest, {})
    # npm permits both {"type","url"} and the "github:owner/repo" shorthand.
    repo = v.get("repository") or {}
    if isinstance(repo, str):
        repo = {"url": repo}
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
        for raw in _pyproject_requirements(pyproject):
            m = re.match(r"^([A-Za-z0-9_.\-]+)", raw)
            if m and m.group(1).lower() not in seen:
                seen.add(m.group(1).lower())
                spec = raw[len(m.group(1)):].strip()
                out.append({
                    "name": m.group(1),
                    # Drop an extras marker: uvicorn[standard]>=0.32 pins uvicorn.
                    "spec": spec.lstrip("[").split("]")[-1].strip() or None,
                    "resolved": None, "direct": True, "dev": False,
                })
    return out


def _pyproject_requirements(path: Path) -> list[str]:
    """Runtime and optional dependencies from pyproject.toml.

    Parsed with the standard library TOML reader rather than a regex: a pattern
    that stops at the first "]" truncates the list at the first extras marker,
    which silently drops every dependency after it.
    """
    try:
        import tomllib
        data = tomllib.loads(path.read_text())
    except Exception:                                    # malformed or pre-3.11
        text = path.read_text()
        block = re.search(r"dependencies\s*=\s*\[(.*?)^\s*\]", text, re.S | re.M)
        return re.findall(r'"([^"]+)"', block.group(1)) if block else []
    project = data.get("project") or {}
    reqs = list(project.get("dependencies") or [])
    for group in (project.get("optional-dependencies") or {}).values():
        reqs.extend(group)
    poetry = ((data.get("tool") or {}).get("poetry") or {}).get("dependencies") or {}
    reqs.extend(f"{name}{spec if isinstance(spec, str) else ''}"
                for name, spec in poetry.items() if name.lower() != "python")
    return reqs


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


# Directories whose manifests describe something other than this repo's own
# dependencies, or a copy of them.
SKIP_DIRS = {"node_modules", ".git", "vendor", "dist", "build", "out", ".venv",
             "venv", "env", "site-packages", "third_party", "bower_components",
             ".next", ".nuxt", "__pycache__", ".tox", "Pods"}

MANIFEST_ECOSYSTEM = {
    "package.json": "npm",
    "requirements.txt": "pypi", "pyproject.toml": "pypi",
    "pubspec.yaml": "pub",
    "Directory.Packages.props": "nuget",
}


def detect(root: Path, max_depth: int = 4) -> list[tuple[str, Path]]:
    """Every manifest in the repository, not only the ones at its root.

    A monorepo keeps its manifests in `web/`, `frontend/`, `services/x/`; looking
    only at the root reports such a repo as having no dependencies at all, which
    is worse than reporting none, because it looks like a clean result.
    """
    found: set[tuple[str, Path]] = set()
    for path in root.rglob("*"):
        if not path.is_file():
            continue
        rel = path.relative_to(root)
        if any(part in SKIP_DIRS for part in rel.parts[:-1]):
            continue
        if len(rel.parts) > max_depth:
            continue
        eco = MANIFEST_ECOSYSTEM.get(path.name)
        if eco:
            found.add((eco, path.parent))
        elif path.suffix in (".csproj", ".fsproj"):
            found.add(("nuget", path.parent))
    return sorted(found, key=lambda pair: (str(pair[1]), pair[0]))


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("root")
    ap.add_argument("--out", default="inventory.json")
    ap.add_argument("--offline", action="store_true", help="skip registry lookups")
    ap.add_argument("--include-transitive", action="store_true")
    ap.add_argument("--cache-dir", help="reuse registry answers across runs")
    ap.add_argument("--allow-incomplete", action="store_true",
                    help="exit 0 even when some registry lookups failed")
    args = ap.parse_args()

    global _cache_dir
    _cache_dir = Path(args.cache_dir) if args.cache_dir else None

    root = Path(args.root).resolve()
    rows, cache = [], {}
    unreachable: list[str] = []
    seen_rows: set[tuple[str, str, str]] = set()

    for eco, where in detect(root):
        rel = str(where.relative_to(root)) if where != root else "."
        for dep in READERS[eco](where):
            if not dep["direct"] and not args.include_transitive:
                continue
            meta = {}
            if not args.offline:
                key = (eco, dep["name"])
                if key not in cache:
                    try:
                        cache[key] = REGISTRIES[eco](dep["name"])
                    except NotFound:
                        cache[key] = {"absent": True}
                    except (Unavailable, KeyError, ValueError, TypeError,
                            AttributeError) as exc:
                        # A single unreadable record is recorded and skipped; it
                        # must never take the rest of the inventory down with it.
                        cache[key] = {"error": f"{type(exc).__name__}: {exc}"}
                        unreachable.append(f"{eco}:{dep['name']}")
                meta = cache[key]
            current = dep["resolved"] or (dep["spec"] or "").lstrip("^~>=< ")
            # The same package declared in two workspaces is one dependency of
            # the repository, not two.
            key = (eco, dep["name"], current or "")
            if key in seen_rows:
                continue
            seen_rows.add(key)
            rows.append({
                "ecosystem": eco,
                "manifest": rel,
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

    manifests = sorted({r["manifest"] for r in rows})
    summary = {"repo": root.name, "total": len(rows), "unreachable": len(unreachable),
               "manifests": len(manifests)}
    for row in rows:
        summary[row["gap"]] = summary.get(row["gap"], 0) + 1

    Path(args.out).write_text(json.dumps(
        {"summary": summary, "packages": rows, "manifest_paths": manifests,
         "unreachable": unreachable}, indent=1))
    print(json.dumps(summary, indent=1))

    # A manifest range that already floats above what it declares is worth saying
    # out loud: the "safe minor bumps" it implies are usually already applied.
    drift = [r for r in rows if r["spec"] and r["resolved"]
             and parse(r["resolved"]) > parse(r["spec"].lstrip("^~>=< "))]
    if drift:
        print(f"\n{len(drift)} packages resolve above their declared range "
              f"(e.g. {drift[0]['name']} {drift[0]['spec']} -> {drift[0]['resolved']})")

    # A partial inventory that looks complete is the dangerous outcome: every
    # unreachable package silently reads as "nothing to upgrade".
    if unreachable:
        print(f"\n{len(unreachable)} package(s) could not be resolved: "
              f"{', '.join(unreachable[:8])}{' ...' if len(unreachable) > 8 else ''}",
              file=sys.stderr)
        if not args.allow_incomplete:
            print("inventory is incomplete; rerun or pass --allow-incomplete",
                  file=sys.stderr)
            return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
