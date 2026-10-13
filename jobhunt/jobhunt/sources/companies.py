"""Company discovery: the curated seed list and YC companies hiring in India/remote."""
from __future__ import annotations

import os
import tomllib

from .. import config, http


def seed_companies() -> list[dict]:
    path = os.environ.get("JOBHUNT_COMPANIES") or config.DATA_DIR / "companies.toml"
    with open(path, "rb") as fh:
        return tomllib.load(fh).get("company", [])


def yc_hiring() -> list[dict]:
    """YC companies flagged as hiring, filtered to India or remote.

    Source: the community-maintained mirror of the YC directory at
    https://github.com/yc-oss/api (refreshed daily from ycombinator.com).
    """
    data = http.get_json("https://yc-oss.github.io/api/companies/hiring.json")
    out = []
    for item in data or []:
        regions = " ".join(item.get("regions") or []).lower()
        locations = (item.get("all_locations") or "").lower()
        where = f"{regions} {locations}"
        if not any(k in where for k in ("india", "bengaluru", "bangalore", "remote")):
            continue
        if (item.get("status") or "").lower() not in ("active", "public", ""):
            continue
        website = item.get("website") or ""
        domain = website.split("//")[-1].split("/")[0].removeprefix("www.") if website else None
        out.append({
            "name": item.get("name", ""),
            "domain": domain,
            "about": item.get("one_liner") or "",
            "category": item.get("industry") or "",
            "careers_url": f"https://www.ycombinator.com/companies/{item.get('slug')}/jobs" if item.get("slug") else "",
            "batch": item.get("batch") or "",
            "team_size": item.get("team_size"),
            "in_india": "india" in where or "bengaluru" in where or "bangalore" in where,
        })
    return out
