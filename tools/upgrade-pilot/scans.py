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


def _norm_sev(value: str | None) -> str:
    v = (value or "").lower()
    return v if v in SEVERITY_ORDER else {"blocker": "critical", "major": "high",
                                          "minor": "medium", "warning": "medium"}.get(v, "info")


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
                "ecosystem": "os" if kind == "os-pkgs" else (result.get("Type") or "lang"),
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
                    "target": name, "class": "artifact", "actionable": False, "refs": [],
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

    findings.sort(key=lambda f: (SEVERITY_ORDER.get(f["severity"], 9), f["source"]))
    Path(args.out).write_text(json.dumps(findings, indent=1))

    counts: dict[str, int] = {}
    for f in findings:
        counts[f["severity"]] = counts.get(f["severity"], 0) + 1
    print(f"\ntotal {len(findings)}  " + "  ".join(f"{k}={v}" for k, v in counts.items()))
    return 0


if __name__ == "__main__":
    sys.exit(main())
