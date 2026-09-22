#!/usr/bin/env python3
"""Poll MetaDefender for submitted files and write one combined result file."""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
import urllib.request
from pathlib import Path

BASE = os.environ.get("METADEFENDER_URL", "https://api.metadefender.com/v4")
KEY = os.environ.get("METADEFENDER_API_KEY", "")


def fetch(data_id: str) -> dict:
    req = urllib.request.Request(f"{BASE}/file/{data_id}", headers={"apikey": KEY})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--submissions", required=True, help="JSONL of submit responses")
    ap.add_argument("--out", default="metadefender.json")
    ap.add_argument("--attempts", type=int, default=20)
    ap.add_argument("--interval", type=int, default=15)
    args = ap.parse_args()

    path = Path(args.submissions)
    if not path.exists():
        Path(args.out).write_text("[]")
        return 0

    ids = []
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            ids.append(json.loads(line)["data_id"])
        except (json.JSONDecodeError, KeyError):
            continue

    results = []
    for data_id in ids:
        for attempt in range(args.attempts):
            try:
                res = fetch(data_id)
            except Exception as exc:                      # network or auth
                print(f"{data_id}: {exc}", file=sys.stderr)
                break
            if res.get("scan_results", {}).get("progress_percentage") == 100:
                results.append(res)
                break
            time.sleep(args.interval)
        else:
            print(f"{data_id}: still scanning after "
                  f"{args.attempts * args.interval}s", file=sys.stderr)

    Path(args.out).write_text(json.dumps(results, indent=1))
    print(f"{len(results)}/{len(ids)} scans complete")
    return 0


if __name__ == "__main__":
    sys.exit(main())
