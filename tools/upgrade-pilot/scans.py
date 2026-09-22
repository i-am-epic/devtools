#!/usr/bin/env python3
"""Normalise Trivy, SonarQube and MetaDefender output into one finding model.

Each scanner answers a different question, and the value is in the overlap:
Trivy says a dependency is vulnerable, Sonar says whether the code around it is
tested, MetaDefender says whether the shipped binary is clean. A finding that
all three touch is not three findings.

Usage:
    python scans.py --trivy trivy.json --sonar sonar.json --metadefender md.json \
                    --out findings.json
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

SEVERITY_ORDER = {"critical": 0, "high": 1, "medium": 2, "low": 3, "info": 4}

# Scanners name ecosystems their own way; downstream needs one vocabulary,
# because the ecosystem decides which installer (if any) can fix the finding.
ECOSYSTEM = {
    "npm": "npm", "yarn": "npm", "pnpm": "npm", "node-pkg": "npm",
    "pip": "pypi", "poetry": "pypi", "pipenv": "pypi", "python-pkg": "pypi",
    "nuget": "nuget", "dotnet-core": "nuget",
    "pubspec": "pub",
}


def _norm_sev(value: str | None) -> str:
    v = (value or "").lower()
    return v if v in SEVERITY_ORDER else {"blocker": "critical", "major": "high",
                                          "minor": "medium", "warning": "medium"}.get(v, "info")


def ecosystem_of(result_class: str | None, result_type: str | None) -> str:
    """Resolve a scanner's own type name to our vocabulary.

    An unrecognised language type returns "unknown" rather than a guess: a wrong
    ecosystem sends the wrong installer at the package, which is worse than
    admitting we do not know.
    """
    if result_class == "os-pkgs":
        return "os"
    return ECOSYSTEM.get((result_type or "").lower(), "unknown")


def dedupe(findings: list[dict]) -> list[dict]:
    """Collapse the same advisory reported by more than one scanner.

    Trivy and MetaDefender both report CVEs, and an artifact scan of a built
    image overlaps the dependency scan of its source. Counting those twice
    inflates every number downstream.

    Identity is (advisory id, package). The surviving record keeps the highest
    severity seen, the most specific fixed version, and records every source.
    """
    merged: dict[tuple, dict] = {}
    passthrough: list[dict] = []
    for f in findings:
        key = (f.get("id"), (f.get("package") or "").lower())
        if not f.get("id") or not f.get("package"):
            passthrough.append(f)          # secrets, gates, malware verdicts
            continue
        if key not in merged:
            f = {**f, "sources": [f["source"]]}
            merged[key] = f
            continue
        kept = merged[key]
        if f["source"] not in kept["sources"]:
            kept["sources"].append(f["source"])
        if SEVERITY_ORDER.get(f["severity"], 9) < SEVERITY_ORDER.get(kept["severity"], 9):
            kept["severity"] = f["severity"]
        # Prefer a record that knows how to fix it, and a known ecosystem.
        if f.get("fixed") and not kept.get("fixed"):
            kept["fixed"], kept["actionable"] = f["fixed"], True
        if kept.get("ecosystem") in (None, "unknown") and f.get("ecosystem") not in (None, "unknown"):
            kept["ecosystem"] = f["ecosystem"]
        if not kept.get("title") and f.get("title"):
            kept["title"] = f["title"]
    return list(merged.values()) + passthrough


# --------------------------------------------------------------------------- Trivy

def load_trivy(path: Path) -> list[dict]:
    """Trivy JSON: Results[].Vulnerabilities[] - the dependency-level truth."""
    data = json.loads(path.read_text())
    out = []
    for result in data.get("Results") or []:
        target, kind = result.get("Target", ""), result.get("Class", "")
        for v in result.get("Vulnerabilities") or []:
            out.append({
                "source": "trivy",
                "kind": "vulnerability",
                "id": v.get("VulnerabilityID"),
                "severity": _norm_sev(v.get("Severity")),
                "package": v.get("PkgName"),
                "installed": v.get("InstalledVersion"),
                "fixed": v.get("FixedVersion") or None,
                "title": v.get("Title") or (v.get("Description") or "")[:160],
                "target": target,
                "class": kind,
                # An OS package is fixed by rebuilding the base image, never by
                # a language package manager. Carry that through.
                "ecosystem": ecosystem_of(kind, result.get("Type")),
                # Trivy reports the resolved version, so a missing FixedVersion
                # means no upgrade closes this - it needs a mitigation, not a bump.
                "actionable": bool(v.get("FixedVersion")),
                "refs": (v.get("References") or [])[:3],
            })
        for s in result.get("Secrets") or []:
            out.append({
                "source": "trivy", "kind": "secret", "id": s.get("RuleID"),
                "severity": _norm_sev(s.get("Severity")), "package": None,
                "installed": None, "fixed": None,
                "title": f"{s.get('Title')} in {target}:{s.get('StartLine')}",
                "target": target, "class": "secret", "actionable": False, "refs": [],
            })
    return out


# --------------------------------------------------------------------------- SonarQube

def load_sonar(path: Path) -> list[dict]:
    """Accepts either /api/issues/search output or /api/measures/component."""
    data = json.loads(path.read_text())
    out = []
    for issue in data.get("issues") or []:
        out.append({
            "source": "sonar",
            "kind": issue.get("type", "CODE_SMELL").lower(),
            "id": issue.get("rule"),
            "severity": _norm_sev(issue.get("severity")),
            "package": None,
            "installed": None,
            "fixed": None,
            "title": issue.get("message", "")[:200],
            "target": issue.get("component", ""),
            "class": "code",
            "actionable": issue.get("type") != "SECURITY_HOTSPOT",
            "refs": [],
        })
    measures = {m["metric"]: m.get("value")
                for m in ((data.get("component") or {}).get("measures") or [])}
    gate = (data.get("projectStatus") or {}).get("status")
    if measures or gate:
        out.append({
            "source": "sonar", "kind": "quality-gate", "id": "quality_gate",
            "severity": "high" if gate == "ERROR" else "info",
            "package": None, "installed": None, "fixed": None,
            "title": f"Quality gate {gate or 'unknown'} · coverage {measures.get('coverage', 'n/a')}%"
                     f" · duplication {measures.get('duplicated_lines_density', 'n/a')}%",
            "target": "project", "class": "gate",
            "actionable": False, "refs": [], "measures": measures,
        })
    return out


# --------------------------------------------------------------------------- MetaDefender

def load_metadefender(path: Path) -> list[dict]:
    """OPSWAT MetaDefender scan result: per-file verdict plus CVE hits."""
    data = json.loads(path.read_text())
    out = []
    entries = data if isinstance(data, list) else [data]
    for entry in entries:
        res = entry.get("scan_results") or {}
        verdict = res.get("scan_all_result_a") or entry.get("scan_all_result_a")
        name = (entry.get("file_info") or {}).get("display_name") or entry.get("file_id", "?")
        if verdict and verdict not in ("No Threat Detected", "Clean"):
            out.append({
                "source": "metadefender", "kind": "malware", "id": entry.get("data_id"),
                "severity": "critical", "package": None, "installed": None, "fixed": None,
                "title": f"{verdict} in {name}", "target": name, "class": "artifact",
                "actionable": False, "refs": [],
            })
        for cve in (entry.get("vulnerability_info") or {}).get("result", []) or []:
            detected = cve.get("detected_product") or {}
            for v in cve.get("cve") or [cve]:
                out.append({
                    "source": "metadefender", "kind": "vulnerability",
                    "id": v.get("cve") if isinstance(v, dict) else str(v),
                    "severity": _norm_sev((v or {}).get("severity_name") if isinstance(v, dict) else None),
                    "package": detected.get("product"),
                    "installed": detected.get("version"),
                    "fixed": None,
                    "title": (v or {}).get("description", "")[:160] if isinstance(v, dict) else "",
                    "target": name, "class": "artifact", "ecosystem": "unknown",
                    "actionable": False, "refs": [],
                })
    return out


LOADERS = {"trivy": load_trivy, "sonar": load_sonar, "metadefender": load_metadefender}


def main() -> int:
    ap = argparse.ArgumentParser()
    for name in LOADERS:
        ap.add_argument(f"--{name}", action="append", default=[])
    ap.add_argument("--out", default="findings.json")
    args = ap.parse_args()

    findings: list[dict] = []
    for name, loader in LOADERS.items():
        for path in getattr(args, name):
            p = Path(path)
            if not p.exists():
                print(f"skip: {path} not found", file=sys.stderr)
                continue
            try:
                got = loader(p)
            except (json.JSONDecodeError, KeyError, TypeError) as exc:
                print(f"skip: {path} unreadable ({exc})", file=sys.stderr)
                continue
            findings.extend(got)
            print(f"{name:<13} {len(got):>4} findings from {p.name}")

    before = len(findings)
    findings = dedupe(findings)
    if before != len(findings):
        print(f"\ndeduped {before - len(findings)} duplicate finding(s) "
              f"reported by more than one scanner")

    findings.sort(key=lambda f: (SEVERITY_ORDER.get(f["severity"], 9), f["source"]))
    Path(args.out).write_text(json.dumps(findings, indent=1))

    counts: dict[str, int] = {}
    for f in findings:
        counts[f["severity"]] = counts.get(f["severity"], 0) + 1
    print(f"\ntotal {len(findings)}  " + "  ".join(f"{k}={v}" for k, v in counts.items()))
    return 0


if __name__ == "__main__":
    sys.exit(main())
