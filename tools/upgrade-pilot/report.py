#!/usr/bin/env python3
"""Correlate the dependency inventory with scanner findings and decide what
may be upgraded without a human.

The branch decides the policy. A release branch takes the smallest change that
clears a security finding and nothing else; main takes routine upgrades too.
Auto-merge is gated on test quality, not on how small the version jump looks -
a patch bump into an untested repo is riskier than a major into a tested one.

Usage:
    python report.py --inventory inventory.json --findings findings.json \
                     --branch release/26.1 --out-md summary.md --out-json plan.json
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

SEV_RANK = {"critical": 0, "high": 1, "medium": 2, "low": 3, "info": 4}
BLOCKING = {"critical", "high"}


def parse(v: str | None) -> list[int]:
    if not v:
        return []
    nums = [int(x) for x in re.findall(r"\d+", v)[:3]]
    return nums + [0] * (3 - len(nums))


def branch_policy(branch: str) -> dict:
    """Release branches are for fixing what is broken, not for staying current."""
    if re.search(r"(release|hotfix)/", branch or "") or re.match(r"^\d+\.\d+$", branch or ""):
        return {
            "name": "release",
            "allow": ["security"],
            "auto_gap": ["patch"],
            "note": "Security fixes only, smallest version change that clears the finding. "
                    "Routine currency work belongs on main and arrives here by merge.",
        }
    return {
        "name": "mainline",
        "allow": ["security", "routine"],
        "auto_gap": ["patch", "minor"],
        "note": "Security first, then grouped patch and minor. Majors one at a time, never batched.",
    }


def gate(findings: list[dict], min_coverage: float) -> tuple[bool, str]:
    """Sonar decides whether anything may merge unattended."""
    gates = [f for f in findings if f.get("kind") == "quality-gate"]
    if not gates:
        return False, "no Sonar result - nothing auto-merges without a coverage signal"
    measures = gates[0].get("measures") or {}
    try:
        coverage = float(measures.get("coverage", 0) or 0)
    except ValueError:
        coverage = 0.0
    if gates[0]["severity"] == "high":
        return False, "Sonar quality gate is failing - fix that before upgrading anything"
    if coverage < min_coverage:
        return False, f"coverage {coverage:.1f}% is below the {min_coverage:.0f}% auto-merge bar"
    return True, f"coverage {coverage:.1f}% clears the {min_coverage:.0f}% bar"


def build(inventory: dict, findings: list[dict], branch: str, min_coverage: float) -> dict:
    policy = branch_policy(branch)
    packages = {p["name"].lower(): p for p in inventory.get("packages", [])}
    may_automerge, gate_reason = gate(findings, min_coverage)

    security: dict[str, dict] = {}
    unfixable: list[dict] = []
    base_image: list[dict] = []
    for f in findings:
        if f.get("kind") != "vulnerability" or not f.get("package"):
            continue
        key = f["package"].lower()
        if f.get("ecosystem") == "os":
            base_image.append(f)
            continue
        if not f.get("actionable"):
            unfixable.append(f)
            continue
        entry = security.setdefault(key, {
            "package": f["package"], "ecosystem": f.get("ecosystem"),
            "installed": f.get("installed"),
            "target": f.get("fixed"), "advisories": [], "severity": "info",
        })
        entry["advisories"].append({"id": f.get("id"), "severity": f["severity"],
                                    "title": f.get("title"), "source": f["source"]})
        if SEV_RANK.get(f["severity"], 9) < SEV_RANK.get(entry["severity"], 9):
            entry["severity"] = f["severity"]
        # take the highest fixed version any advisory demands
        if f.get("fixed") and parse(f["fixed"]) > parse(entry["target"] or ""):
            entry["target"] = f["fixed"]

    auto, review, deferred = [], [], []

    for key, sec in security.items():
        pkg = packages.get(key, {})
        jump = "patch"
        if pkg.get("resolved") and sec.get("target"):
            a, b = parse(pkg["resolved"]), parse(sec["target"])
            jump = "major" if a[0] != b[0] else "minor" if a[1] != b[1] else "patch"
        item = {
            "package": sec["package"], "from": pkg.get("resolved") or sec.get("installed"),
            "to": sec["target"], "reason": "security", "jump": jump,
            "severity": sec["severity"],
            "ecosystem": sec.get("ecosystem"),
            "advisories": [a["id"] for a in sec["advisories"] if a["id"]],
            "changelog": (pkg.get("changelog") or [None])[0],
        }
        if jump in policy["auto_gap"] and may_automerge:
            auto.append(item)
        else:
            item["why_manual"] = (
                f"{jump} version change" if jump not in policy["auto_gap"] else gate_reason)
            review.append(item)

    if "routine" in policy["allow"]:
        for pkg in inventory.get("packages", []):
            if pkg["name"].lower() in security or not pkg.get("latest"):
                continue
            if pkg["gap"] in policy["auto_gap"] and may_automerge:
                auto.append({"package": pkg["name"], "ecosystem": pkg["ecosystem"],
                             "from": pkg.get("resolved") or pkg.get("spec"),
                             "to": pkg["latest"], "reason": "routine", "jump": pkg["gap"],
                             "severity": "info", "advisories": [],
                             "changelog": (pkg.get("changelog") or [None])[0]})
            elif pkg["gap"] == "major":
                review.append({"package": pkg["name"], "from": pkg.get("resolved") or pkg.get("spec"),
                               "to": pkg["latest"], "reason": "routine", "jump": "major",
                               "severity": "info", "advisories": [],
                               "why_manual": "major version change - read the changelog first",
                               "changelog": (pkg.get("changelog") or [None])[0]})
            elif pkg["gap"] == "unpinned":
                deferred.append({"package": pkg["name"],
                                 "why": "no version declared - pin it before it can be upgraded"})

    for pkg in inventory.get("packages", []):
        if pkg.get("deprecated"):
            deferred.append({"package": pkg["name"], "why": f"deprecated: {pkg['deprecated'][:120]}"})
        elif pkg.get("published") and pkg["published"] < "2024-01-01" and pkg["gap"] == "current":
            deferred.append({"package": pkg["name"],
                             "why": f"newest release is {pkg['published']} - unmaintained, "
                                    f"no upgrade will ever fix it"})

    return {
        "branch": branch, "policy": policy, "may_automerge": may_automerge,
        "gate_reason": gate_reason, "auto": auto, "review": review,
        "deferred": deferred, "unfixable": unfixable, "base_image": base_image,
    }


def markdown(plan: dict, inventory: dict, findings: list[dict]) -> str:
    sev: dict[str, int] = {}
    for f in findings:
        sev[f["severity"]] = sev.get(f["severity"], 0) + 1
    counts = "  ".join(f"**{v}** {k}" for k, v in sorted(sev.items(), key=lambda kv: SEV_RANK.get(kv[0], 9)))
    lines = [
        f"## Upgrade plan — `{plan['branch']}`",
        "",
        f"Policy: **{plan['policy']['name']}**. {plan['policy']['note']}",
        "",
        f"Scanners reported {len(findings)} findings: {counts or '_none_'}. "
        f"Inventory: {inventory['summary'].get('total', 0)} direct dependencies.",
        "",
        f"Auto-merge: {'**enabled** — ' if plan['may_automerge'] else '**disabled** — '}{plan['gate_reason']}.",
        "",
    ]
    if plan["auto"]:
        lines += [f"### Applying automatically ({len(plan['auto'])})", "",
                  "| Package | From | To | Why |", "| --- | --- | --- | --- |"]
        for a in plan["auto"]:
            why = ", ".join(a["advisories"]) if a["advisories"] else f"routine {a['jump']}"
            lines.append(f"| `{a['package']}` | {a['from'] or '—'} | {a['to']} | {why} |")
        lines.append("")
    if plan["review"]:
        lines += [f"### Needs a human ({len(plan['review'])})", ""]
        for r in sorted(plan["review"], key=lambda x: SEV_RANK.get(x["severity"], 9)):
            adv = f" — {', '.join(r['advisories'])}" if r["advisories"] else ""
            lines.append(f"- **`{r['package']}`** {r['from'] or '—'} → {r['to']}{adv}  ")
            lines.append(f"  {r['why_manual']}" + (f" · [changelog]({r['changelog']})" if r.get("changelog") else ""))
        lines.append("")
    if plan.get("base_image"):
        lines += [f"### Base image ({len(plan['base_image'])})", "",
                  "OS packages. These are fixed by rebuilding on a newer base image, "
                  "not by any language package manager.", ""]
        for b in plan["base_image"]:
            fix = f" → {b['fixed']}" if b.get("fixed") else " — no fix published"
            lines.append(f"- `{b['package']}` {b.get('installed') or ''}{fix} ({b['severity']}, {b['id']})")
        lines.append("")
    if plan["unfixable"]:
        lines += [f"### No fixed version available ({len(plan['unfixable'])})", "",
                  "These need a mitigation or an exception, not an upgrade.", ""]
        for u in plan["unfixable"][:10]:
            lines.append(f"- `{u.get('package') or u.get('target')}` — {u['id']} ({u['severity']})")
        lines.append("")
    if plan["deferred"]:
        lines += [f"### Hygiene ({len(plan['deferred'])})", ""]
        for d in plan["deferred"][:15]:
            lines.append(f"- `{d['package']}` — {d['why']}")
        lines.append("")
    lines += ["---", "",
              "_Generated by upgrade-pilot. Verification is the pipeline's job, not this report's: "
              "a finding is closed only when the rebuilt SBOM no longer contains it and the suite is green._"]
    return "\n".join(lines)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--inventory", required=True)
    ap.add_argument("--findings", required=True)
    ap.add_argument("--branch", default="main")
    ap.add_argument("--min-coverage", type=float, default=60.0)
    ap.add_argument("--out-md", default="summary.md")
    ap.add_argument("--out-json", default="plan.json")
    args = ap.parse_args()

    inventory = json.loads(Path(args.inventory).read_text())
    findings = json.loads(Path(args.findings).read_text())
    plan = build(inventory, findings, args.branch, args.min_coverage)

    Path(args.out_json).write_text(json.dumps(plan, indent=1))
    Path(args.out_md).write_text(markdown(plan, inventory, findings))
    print(f"branch={args.branch} policy={plan['policy']['name']} "
          f"auto={len(plan['auto'])} review={len(plan['review'])} "
          f"unfixable={len(plan['unfixable'])} hygiene={len(plan['deferred'])}")
    print(f"auto-merge: {plan['may_automerge']} ({plan['gate_reason']})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
