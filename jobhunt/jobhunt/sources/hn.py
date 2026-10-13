"""Hacker News "Ask HN: Who is hiring?" — the monthly thread, via the Algolia API.

Posts here are usually written by founders or hiring managers and often carry
a direct email, which is the shortest path to a human in the whole pipeline.
"""
from __future__ import annotations

import re
from datetime import datetime, timezone

from .. import http
from ..comp import parse_salary
from ..models import Job
from ..text import find_emails, html_to_text

ROLE_WORDS = re.compile(
    r"\b(?:engineers?|developers?|sde|swe|backend|back-end|platform|infrastructure|data|ml|ai|sre|devops|"
    r"founding|programmer)\b",
    re.I,
)
LOCATION_WORDS = re.compile(
    r"\b(?:remote|onsite|on-site|hybrid|bangalore|bengaluru|india|worldwide|anywhere|global|apac|us|usa|"
    r"europe|london|berlin|nyc|new york|san francisco|sf|toronto|singapore|emea|timezone|utc)\b",
    re.I,
)


def latest_thread() -> tuple[int, str] | None:
    data = http.get_json("https://hn.algolia.com/api/v1/search_by_date",
                         params={"tags": "story,author_whoishiring", "hitsPerPage": 10})
    for hit in data.get("hits", []):
        if "who is hiring" in (hit.get("title") or "").lower():
            return int(hit["objectID"]), hit["title"]
    return None


def parse_post(item: dict, thread_title: str, fx) -> Job | None:
    text = html_to_text(item.get("text") or "")
    if not text:
        return None
    first_line = text.splitlines()[0]
    parts = [p.strip() for p in re.split(r"\s+\|\s+|\s+\|\||\|", first_line) if p.strip()]
    if len(parts) < 2:
        return None
    company = re.sub(r"\(.*?\)", "", parts[0]).strip(" -–:")
    roles = [p for p in parts[1:] if ROLE_WORDS.search(p) and not LOCATION_WORDS.fullmatch(p.lower())]
    locations = [p for p in parts[1:] if LOCATION_WORDS.search(p) and p not in roles]
    lo, hi = parse_salary(first_line, fx)
    emails = find_emails(text)
    created = item.get("created_at_i")
    posted = datetime.fromtimestamp(created, tz=timezone.utc).date().isoformat() if created else None
    url = f"https://news.ycombinator.com/item?id={item['id']}"
    return Job(
        source="hn", native_id=str(item["id"]), company=company[:80],
        title=" / ".join(roles)[:160] or "Engineering (see post)",
        location=" | ".join(locations)[:200], remote=bool(re.search(r"\bremote\b", first_line, re.I)) or None,
        url=url, apply_url=url, description=text, posted_at=posted,
        salary_min_lpa=lo, salary_max_lpa=hi, salary_text=first_line if lo else "",
        contact_email=emails[0] if emails else "", tags=[thread_title],
    )


def who_is_hiring(fx) -> list[Job]:
    thread = latest_thread()
    if not thread:
        return []
    story_id, title = thread
    tree = http.get_json(f"https://hn.algolia.com/api/v1/items/{story_id}")
    out = []
    for child in tree.get("children") or []:
        job = parse_post(child, title, fx)
        if job:
            out.append(job)
    return out
