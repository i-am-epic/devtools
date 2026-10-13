"""Remote-job boards with public feeds, plus Amazon's job search JSON.

Each board's terms ask for attribution and low request rates; one discover run
per day is well inside all of them (Remotive asks for at most a few a day).
"""
from __future__ import annotations

import xml.etree.ElementTree as ET
from email.utils import parsedate_to_datetime

from .. import http
from ..comp import parse_salary, structured_to_lpa
from ..models import Job
from ..text import html_to_text
from .ats import _date


def remoteok(fx) -> list[Job]:
    data = http.get_json("https://remoteok.com/api")
    out = []
    for item in data or []:
        if not isinstance(item, dict) or "position" not in item:
            continue  # first element is the legal notice
        lo, hi = structured_to_lpa(item.get("salary_min"), item.get("salary_max"), "USD", fx)
        out.append(Job(
            source="remoteok", native_id=str(item.get("id")), company=item.get("company", ""),
            title=item.get("position", ""), location=f"Remote ({item.get('location') or 'unspecified'})",
            remote=True, url=item.get("url", ""), apply_url=item.get("apply_url") or item.get("url", ""),
            description=html_to_text(item.get("description")), posted_at=_date(item.get("date") or item.get("epoch")),
            salary_min_lpa=lo, salary_max_lpa=hi, tags=list(item.get("tags") or []),
        ))
    return out


def remotive(fx) -> list[Job]:
    out = []
    for category in ("software-dev", "devops", "data"):
        data = http.get_json("https://remotive.com/api/remote-jobs", params={"category": category})
        for item in data.get("jobs", []):
            salary = item.get("salary") or ""
            lo, hi = parse_salary(salary, fx, default_currency="USD")
            out.append(Job(
                source="remotive", native_id=str(item.get("id")), company=item.get("company_name", ""),
                title=item.get("title", ""),
                location=f"Remote ({item.get('candidate_required_location') or 'unspecified'})", remote=True,
                url=item.get("url", ""), apply_url=item.get("url", ""),
                description=html_to_text(item.get("description")), posted_at=_date(item.get("publication_date")),
                salary_text=salary, salary_min_lpa=lo, salary_max_lpa=hi, tags=list(item.get("tags") or []),
            ))
    return out


def himalayas(fx, pages: int = 5) -> list[Job]:
    out = []
    for page in range(pages):
        data = http.get_json("https://himalayas.app/jobs/api", params={"limit": 20, "offset": page * 20})
        jobs = data.get("jobs") or []
        for item in jobs:
            restrictions = item.get("locationRestrictions") or []
            lo, hi = structured_to_lpa(item.get("minSalary"), item.get("maxSalary"),
                                       item.get("currency") or "USD", fx)
            out.append(Job(
                source="himalayas", native_id=str(item.get("guid") or item.get("applicationLink")),
                company=item.get("companyName", ""), title=item.get("title", ""),
                location=f"Remote ({', '.join(restrictions) or 'worldwide'})", remote=True,
                url=item.get("applicationLink", ""), apply_url=item.get("applicationLink", ""),
                description=html_to_text(item.get("description") or item.get("excerpt")),
                posted_at=_date(item.get("pubDate")), salary_min_lpa=lo, salary_max_lpa=hi,
            ))
        if len(jobs) < 20:
            break
    return out


def jobicy(fx) -> list[Job]:
    out = []
    for geo in ("apac", "india", "anywhere"):
        try:
            data = http.get_json("https://jobicy.com/api/v2/remote-jobs",
                                 params={"count": 50, "geo": geo, "industry": "dev"})
        except http.HTTPError:
            continue
        for item in data.get("jobs", []):
            lo, hi = structured_to_lpa(item.get("annualSalaryMin"), item.get("annualSalaryMax"),
                                       item.get("salaryCurrency") or "USD", fx)
            out.append(Job(
                source="jobicy", native_id=str(item.get("id")), company=item.get("companyName", ""),
                title=html_to_text(item.get("jobTitle", "")), location=f"Remote ({item.get('jobGeo') or geo})",
                remote=True, url=item.get("url", ""), apply_url=item.get("url", ""),
                description=html_to_text(item.get("jobDescription") or item.get("jobExcerpt")),
                posted_at=_date(item.get("pubDate")), salary_min_lpa=lo, salary_max_lpa=hi,
            ))
    return out


def weworkremotely(fx) -> list[Job]:
    out = []
    for feed in ("remote-back-end-programming-jobs", "remote-full-stack-programming-jobs",
                 "remote-devops-sysadmin-jobs"):
        root = ET.fromstring(http.get(f"https://weworkremotely.com/categories/{feed}.rss"))
        for item in root.iter("item"):
            title = item.findtext("title") or ""
            company, _, role = title.partition(": ")
            pub = item.findtext("pubDate")
            try:
                posted = parsedate_to_datetime(pub).date().isoformat() if pub else None
            except (TypeError, ValueError):
                posted = None
            link = item.findtext("link") or ""
            out.append(Job(
                source="weworkremotely", native_id=link.rstrip("/").rsplit("/", 1)[-1] or title,
                company=company.strip(), title=(role or title).strip(),
                location=f"Remote ({item.findtext('region') or 'unspecified'})", remote=True,
                url=link, apply_url=link, description=html_to_text(item.findtext("description")),
                posted_at=posted,
            ))
    return out


def amazon(fx, query: str = "software development engineer", location: str = "Bengaluru") -> list[Job]:
    out = []
    for offset in (0, 100):
        data = http.get_json("https://www.amazon.jobs/en/search.json", params={
            "base_query": query, "loc_query": location, "result_limit": 100, "offset": offset, "sort": "recent"})
        jobs = data.get("jobs") or []
        for item in jobs:
            path = item.get("job_path", "")
            description = "\n\n".join(html_to_text(item.get(k)) for k in
                                      ("description", "basic_qualifications", "preferred_qualifications"))
            out.append(Job(
                source="amazon", ats="amazon", native_id=str(item.get("id_icims") or path),
                company=item.get("company_name") or "Amazon", title=item.get("title", ""),
                location=item.get("normalized_location") or item.get("location", ""),
                url=f"https://www.amazon.jobs{path}", apply_url=f"https://www.amazon.jobs{path}",
                description=description, posted_at=_amazon_date(item.get("posted_date")),
            ))
        if len(jobs) < 100:
            break
    return out


def _amazon_date(text: str | None) -> str | None:
    from datetime import datetime
    try:
        return datetime.strptime(text or "", "%B %d, %Y").date().isoformat()
    except ValueError:
        return None


BOARDS = {
    "remoteok": remoteok,
    "remotive": remotive,
    "himalayas": himalayas,
    "jobicy": jobicy,
    "weworkremotely": weworkremotely,
    "amazon": amazon,
}
