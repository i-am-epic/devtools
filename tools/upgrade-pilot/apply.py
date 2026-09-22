#!/usr/bin/env python3
"""Apply the automatic upgrades, one at a time, verifying after each.

Never bulk-upgrade everything and run the tests once: if it breaks you have no
idea which member broke it. Each package is applied, verified, and either kept
or reverted on its own.

Usage:
    python apply.py --plan plan.json --verify "npm run build" --report applied.json
"""
from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
import time
from pathlib import Path

MANIFESTS = ["package.json", "package-lock.json", "requirements.txt", "pyproject.toml",
             "pubspec.yaml", "pubspec.lock", "Directory.Packages.props", "packages.lock.json"]


def snapshot(root: Path) -> dict[str, bytes]:
    return {m: (root / m).read_bytes() for m in MANIFESTS if (root / m).exists()}


def restore(root: Path, snap: dict[str, bytes]) -> None:
    for name, data in snap.items():
        (root / name).write_bytes(data)


def install_cmd(eco: str, package: str, version: str, dev: bool) -> list[str] | None:
    if eco == "npm":
        return ["npm", "install", f"{package}@{version}", "--no-audit", "--no-fund"] + (["-D"] if dev else [])
    if eco == "nuget":
        return ["dotnet", "add", "package", package, "--version", version]
    if eco == "pypi":
        return ["python", "-m", "pip", "install", f"{package}=={version}"]
    if eco == "pub":
        return ["flutter", "pub", "add", f"{package}:^{version}"]
    return None


def run(cmd: list[str] | str, root: Path, timeout: int) -> tuple[int, str]:
    try:
        proc = subprocess.run(cmd, cwd=root, shell=isinstance(cmd, str), timeout=timeout,
                              capture_output=True, text=True)
        return proc.returncode, (proc.stdout + proc.stderr)[-4000:]
    except subprocess.TimeoutExpired:
        return 124, f"timed out after {timeout}s"
    except FileNotFoundError as exc:
        return 127, str(exc)


def guess_eco(package: str, inventory: dict | None) -> str:
    if inventory:
        for p in inventory.get("packages", []):
            if p["name"].lower() == package.lower():
                return p["ecosystem"]
    return "npm"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--plan", required=True)
    ap.add_argument("--inventory")
    ap.add_argument("--verify", required=True, help="shell command that must exit 0")
    ap.add_argument("--root", default=".")
    ap.add_argument("--report", default="applied.json")
    ap.add_argument("--timeout", type=int, default=900)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    root = Path(args.root).resolve()
    plan = json.loads(Path(args.plan).read_text())
    inventory = json.loads(Path(args.inventory).read_text()) if args.inventory else None

    # Establish the baseline first. An upgrade cannot be blamed for a build that
    # was already broken.
    code, out = run(args.verify, root, args.timeout)
    if code != 0:
        report = {"baseline": "red", "applied": [], "reverted": [],
                  "note": "baseline verification failed - nothing attempted", "output": out}
        Path(args.report).write_text(json.dumps(report, indent=1))
        print("baseline is red; refusing to upgrade on top of a broken build", file=sys.stderr)
        return 1
    print("baseline green")

    applied, reverted, skipped = [], [], []
    for item in plan.get("auto", []):
        pkg, target = item["package"], item.get("to")
        if not target:
            skipped.append({**item, "why": "no target version"})
            continue
        eco = item.get("ecosystem") or guess_eco(pkg, inventory)
        cmd = install_cmd(eco, pkg, target, item.get("dev", False))
        if cmd is None or (eco == "nuget" and shutil.which("dotnet") is None):
            skipped.append({**item, "why": f"no installer available for {eco}"})
            continue
        if args.dry_run:
            print(f"DRY  {pkg} -> {target}  ({' '.join(cmd)})")
            continue

        snap = snapshot(root)
        started = time.time()
        code, out = run(cmd, root, args.timeout)
        if code != 0:
            restore(root, snap)
            reverted.append({**item, "stage": "install", "output": out[-1200:]})
            print(f"REVERT {pkg} -> {target} (install failed)")
            continue

        code, out = run(args.verify, root, args.timeout)
        if code != 0:
            restore(root, snap)
            run(install_cmd(eco, pkg, item.get("from") or "", False) or "true", root, args.timeout)
            reverted.append({**item, "stage": "verify", "output": out[-1200:]})
            print(f"REVERT {pkg} -> {target} (verification failed)")
            continue

        applied.append({**item, "seconds": round(time.time() - started, 1)})
        print(f"OK     {pkg} {item.get('from')} -> {target}")

    report = {
        "baseline": "green",
        "applied": applied,
        "reverted": reverted,
        "skipped": skipped,
        "summary": f"{len(applied)} applied, {len(reverted)} reverted, {len(skipped)} skipped",
    }
    Path(args.report).write_text(json.dumps(report, indent=1))
    print("\n" + report["summary"])
    # Reverted upgrades are information, not failure: they are exactly the set a
    # human should look at next.
    return 0


if __name__ == "__main__":
    sys.exit(main())
