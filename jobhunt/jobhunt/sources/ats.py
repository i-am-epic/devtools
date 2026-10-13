"""Company career boards via the public job-board APIs that power them.

These are the endpoints each ATS publishes for embedding a company's job list
on its own site, so no scraping or login is involved and the apply link is the
company's real application form.

    greenhouse       https://boards-api.greenhouse.io/v1/boards/{slug}/jobs?content=true
    lever            https://api.lever.co/v0/postings/{slug}?mode=json
    ashby            https://api.ashbyhq.com/posting-api/job-board/{slug}?includeCompensation=true
    smartrecruiters  https://api.smartrecruiters.com/v1/companies/{slug}/postings
    workable         https://apply.workable.com/api/v1/widget/accounts/{slug}?details=true
    recruitee        https://{slug}.recruitee.com/api/offers/
    workday          https://{tenant}.{wd}.myworkdayjobs.com/wday/cxs/{tenant}/{site}/jobs
"""
from __future__ import annotations

import re
from datetime import datetime, timedelta, timezone

from .. import http
from ..comp import structured_to_lpa
from ..models import Job
from ..text import company_key, html_to_text, slug_candidates


def _date(value) -> str | None:
    """ISO date from ISO strings, epoch seconds or epoch milliseconds."""
    if value in (None, ""):
        return None
    if isinstance(value, (int, float)):
        seconds = value / 1000 if value > 1e11 else value
        return datetime.fromtimestamp(seconds, tz=timezone.utc).date().isoformat()
    match = re.match(r"(\d{4}-\d{2}-\d{2})", str(value))
    return match.group(1) if match else None


# -- greenhouse ----------------------------------------------------------------

def fetch_greenhouse(slug: str, company: str, fx) -> list[Job]:
    data = http.get_json(f"https://boards-api.greenhouse.io/v1/boards/{slug}/jobs", params={"content": "true"})
    out = []
    for item in data.get("jobs", []):
        offices = ", ".join(o.get("name", "") for o in item.get("offices") or [] if o.get("name"))
        location = (item.get("location") or {}).get("name") or offices
        out.append(Job(
            source="greenhouse", ats="greenhouse", native_id=f"{slug}:{item['id']}", company=company,
            title=item.get("title", "").strip(), location=location,
            remote="remote" in location.lower() or None,
            url=item.get("absolute_url", ""), apply_url=item.get("absolute_url", ""),
            description=html_to_text(item.get("content")),
            department=", ".join(d.get("name", "") for d in item.get("departments") or []),
            posted_at=_date(item.get("first_published") or item.get("updated_at")),
        ))
    return out


def probe_greenhouse(slug: str, company: str) -> bool:
    data = http.get_json(f"https://boards-api.greenhouse.io/v1/boards/{slug}")
    return bool(data and data.get("name"))


# -- lever ---------------------------------------------------------------------

def fetch_lever(slug: str, company: str, fx) -> list[Job]:
    data = http.get_json(f"https://api.lever.co/v0/postings/{slug}", params={"mode": "json"})
    out = []
    for item in data or []:
        cats = item.get("categories") or {}
        locations = cats.get("allLocations") or [cats.get("location") or ""]
        location = ", ".join(l for l in locations if l)
        workplace = (item.get("workplaceType") or "").lower()
        parts = [item.get("descriptionPlain") or html_to_text(item.get("description"))]
        for section in item.get("lists") or []:
            parts.append(f"{section.get('text', '')}\n{html_to_text(section.get('content'))}")
        parts.append(item.get("additionalPlain") or html_to_text(item.get("additional")))
        salary = item.get("salaryRange") or {}
        lo, hi = structured_to_lpa(salary.get("min"), salary.get("max"), salary.get("currency", ""), fx,
                                   salary.get("interval"))
        out.append(Job(
            source="lever", ats="lever", native_id=f"{slug}:{item['id']}", company=company,
            title=item.get("text", "").strip(), location=location,
            remote=(workplace == "remote") or ("remote" in location.lower()) or None,
            url=item.get("hostedUrl", ""), apply_url=item.get("applyUrl") or item.get("hostedUrl", ""),
            description="\n\n".join(p for p in parts if p).strip(),
            department=cats.get("team") or cats.get("department") or "",
            posted_at=_date(item.get("createdAt")),
            salary_min_lpa=lo, salary_max_lpa=hi,
            salary_text=f"{salary.get('currency', '')} {salary.get('min', '')}-{salary.get('max', '')}" if salary else "",
        ))
    return out


def probe_lever(slug: str, company: str) -> bool:
    data = http.get_json(f"https://api.lever.co/v0/postings/{slug}", params={"mode": "json", "limit": "1"})
    return isinstance(data, list)


# -- ashby ---------------------------------------------------------------------

def fetch_ashby(slug: str, company: str, fx) -> list[Job]:
    data = http.get_json(f"https://api.ashbyhq.com/posting-api/job-board/{slug}",
                         params={"includeCompensation": "true"})
    out = []
    for item in data.get("jobs", []):
        if item.get("isListed") is False:
            continue
        locations = [item.get("location") or ""] + [
            s.get("location", "") for s in item.get("secondaryLocations") or []]
        location = ", ".join(l for l in locations if l)
        lo = hi = None
        salary_text = ""
        comp = item.get("compensation") or {}
        for component in comp.get("summaryComponents") or []:
            if (component.get("compensationType") or "").lower() == "salary":
                lo, hi = structured_to_lpa(component.get("minValue"), component.get("maxValue"),
                                           component.get("currencyCode", ""), fx, component.get("interval"))
                break
        salary_text = comp.get("compensationTierSummary") or comp.get("scrapeableCompensationSalarySummary") or ""
        out.append(Job(
            source="ashby", ats="ashby", native_id=f"{slug}:{item['id']}", company=company,
            title=item.get("title", "").strip(), location=location,
            remote=bool(item.get("isRemote")) or (item.get("workplaceType") or "").lower() == "remote" or None,
            url=item.get("jobUrl", ""), apply_url=item.get("applyUrl") or item.get("jobUrl", ""),
            description=item.get("descriptionPlain") or html_to_text(item.get("descriptionHtml")),
            department=item.get("team") or item.get("department") or "",
            posted_at=_date(item.get("publishedAt")),
            salary_min_lpa=lo, salary_max_lpa=hi, salary_text=salary_text,
        ))
    return out


def probe_ashby(slug: str, company: str) -> bool:
    data = http.get_json(f"https://api.ashbyhq.com/posting-api/job-board/{slug}")
    return bool(data and data.get("jobs"))


# -- smartrecruiters -----------------------------------------------------------

def fetch_smartrecruiters(slug: str, company: str, fx) -> list[Job]:
    out = []
    offset = 0
    while offset < 1000:
        data = http.get_json(f"https://api.smartrecruiters.com/v1/companies/{slug}/postings",
                             params={"limit": 100, "offset": offset})
        content = data.get("content") or []
        for item in content:
            loc = item.get("location") or {}
            location = loc.get("fullLocation") or ", ".join(
                x for x in (loc.get("city"), loc.get("region"), (loc.get("country") or "").upper()) if x)
            out.append(Job(
                source="smartrecruiters", ats="smartrecruiters", native_id=f"{slug}:{item['id']}",
                company=company, title=item.get("name", "").strip(), location=location,
                remote=bool(loc.get("remote")) or None,
                url=f"https://jobs.smartrecruiters.com/{slug}/{item['id']}",
                apply_url=f"https://jobs.smartrecruiters.com/{slug}/{item['id']}",
                department=(item.get("department") or {}).get("label", ""),
                posted_at=_date(item.get("releasedDate")),
                detail_ref=f"https://api.smartrecruiters.com/v1/companies/{slug}/postings/{item['id']}",
            ))
        offset += len(content)
        if not content or offset >= data.get("totalFound", 0):
            break
    return out


def detail_smartrecruiters(job: Job) -> None:
    data = http.get_json(job.detail_ref)
    sections = ((data.get("jobAd") or {}).get("sections") or {})
    parts = [html_to_text((sections.get(k) or {}).get("text"))
             for k in ("companyDescription", "jobDescription", "qualifications", "additionalInformation")]
    job.description = "\n\n".join(p for p in parts if p)
    job.apply_url = data.get("applyUrl") or job.apply_url
    job.url = data.get("postingUrl") or job.url


def probe_smartrecruiters(slug: str, company: str) -> bool:
    # This API answers 200 for any slug, so check the postings name the company.
    data = http.get_json(f"https://api.smartrecruiters.com/v1/companies/{slug}/postings", params={"limit": 1})
    if not data or not data.get("totalFound"):
        return False
    name = ((data.get("content") or [{}])[0].get("company") or {}).get("name", "")
    a, b = company_key(name), company_key(company)
    return bool(a and b and (a in b or b in a))


# -- workable ------------------------------------------------------------------

def fetch_workable(slug: str, company: str, fx) -> list[Job]:
    data = http.get_json(f"https://apply.workable.com/api/v1/widget/accounts/{slug}", params={"details": "true"})
    out = []
    for item in data.get("jobs", []):
        locs = item.get("locations") or []
        location = "; ".join(", ".join(x for x in (l.get("city"), l.get("region"), l.get("country")) if x)
                             for l in locs) or ", ".join(x for x in (item.get("city"), item.get("country")) if x)
        url = item.get("url") or item.get("shortlink") or ""
        out.append(Job(
            source="workable", ats="workable", native_id=f"{slug}:{item.get('shortcode')}", company=company,
            title=(item.get("title") or "").strip(), location=location,
            remote=bool(item.get("telecommuting")) or None,
            url=url, apply_url=item.get("application_url") or url,
            description=html_to_text((item.get("description") or "") + (item.get("requirements") or "")),
            department=item.get("department") or "",
            posted_at=_date(item.get("published_on") or item.get("created_at")),
        ))
    return out


def probe_workable(slug: str, company: str) -> bool:
    data = http.get_json(f"https://apply.workable.com/api/v1/widget/accounts/{slug}")
    return bool(data and "jobs" in data)


# -- recruitee -----------------------------------------------------------------

def fetch_recruitee(slug: str, company: str, fx) -> list[Job]:
    data = http.get_json(f"https://{slug}.recruitee.com/api/offers/")
    out = []
    for item in data.get("offers", []):
        salary = item.get("salary") or {}
        lo, hi = structured_to_lpa(salary.get("min"), salary.get("max"), salary.get("currency", ""), fx,
                                   salary.get("period"))
        out.append(Job(
            source="recruitee", ats="recruitee", native_id=f"{slug}:{item['id']}", company=company,
            title=(item.get("title") or "").strip(), location=item.get("location") or "",
            remote=bool(item.get("remote")) or None,
            url=item.get("careers_url", ""), apply_url=item.get("careers_apply_url") or item.get("careers_url", ""),
            description=html_to_text((item.get("description") or "") + (item.get("requirements") or "")),
            department=item.get("department") or "",
            posted_at=_date(item.get("published_at") or item.get("created_at")),
            salary_min_lpa=lo, salary_max_lpa=hi,
        ))
    return out


def probe_recruitee(slug: str, company: str) -> bool:
    data = http.get_json(f"https://{slug}.recruitee.com/api/offers/")
    return bool(data and "offers" in data)


# -- workday -------------------------------------------------------------------
# slug format: "tenant/wdN/site", e.g. "nvidia/wd5/NVIDIAExternalCareerSite"

def _workday_base(slug: str) -> tuple[str, str]:
    tenant, wd, site = slug.split("/")
    host = f"https://{tenant}.{wd}.myworkdayjobs.com"
    return host, f"{host}/wday/cxs/{tenant}/{site}"


def _workday_posted(text: str) -> str | None:
    text = (text or "").lower()
    today = datetime.now(timezone.utc).date()
    if "today" in text:
        return today.isoformat()
    if "yesterday" in text:
        return (today - timedelta(days=1)).isoformat()
    match = re.search(r"(\d+)\+?\s*days?", text)
    return (today - timedelta(days=int(match.group(1)))).isoformat() if match else None


def fetch_workday(slug: str, company: str, fx, search: str = "software engineer") -> list[Job]:
    host, api = _workday_base(slug)
    site = slug.split("/")[2]
    out = []
    for offset in range(0, 400, 20):
        data = http.post_json(f"{api}/jobs", {"appliedFacets": {}, "limit": 20, "offset": offset,
                                              "searchText": search})
        postings = data.get("jobPostings") or []
        for item in postings:
            path = item.get("externalPath", "")
            out.append(Job(
                source="workday", ats="workday", native_id=f"{slug}:{path.rsplit('_', 1)[-1] or path}",
                company=company, title=(item.get("title") or "").strip(),
                location=item.get("locationsText") or "", url=f"{host}/{site}{path}",
                apply_url=f"{host}/{site}{path}", posted_at=_workday_posted(item.get("postedOn")),
                detail_ref=f"{api}{path}",
            ))
        if len(postings) < 20 or offset + 20 >= (data.get("total") or 0):
            break
    return out


def detail_workday(job: Job) -> None:
    data = http.get_json(job.detail_ref)
    info = data.get("jobPostingInfo") or {}
    job.description = html_to_text(info.get("jobDescription"))
    job.url = info.get("externalUrl") or job.url
    job.apply_url = job.url


def probe_workday(slug: str, company: str) -> bool:
    _, api = _workday_base(slug)
    data = http.post_json(f"{api}/jobs", {"appliedFacets": {}, "limit": 1, "offset": 0, "searchText": ""})
    return bool(data and "jobPostings" in data)


FETCHERS = {
    "greenhouse": fetch_greenhouse,
    "lever": fetch_lever,
    "ashby": fetch_ashby,
    "workable": fetch_workable,
    "smartrecruiters": fetch_smartrecruiters,
    "recruitee": fetch_recruitee,
    "workday": fetch_workday,
}
PROBES = {
    "greenhouse": probe_greenhouse,
    "lever": probe_lever,
    "ashby": probe_ashby,
    "workable": probe_workable,
    "smartrecruiters": probe_smartrecruiters,
    "recruitee": probe_recruitee,
    "workday": probe_workday,
}
DETAILS = {
    "smartrecruiters": detail_smartrecruiters,
    "workday": detail_workday,
}
# Probe order: most common boards for Indian and remote-first tech companies first.
PROBE_ORDER = ["greenhouse", "lever", "ashby", "workable", "smartrecruiters", "recruitee"]


def resolve(name: str, domain: str | None = None, hint: tuple[str, str] | None = None) -> tuple[str, str] | None:
    """Find which ATS hosts a company's board. Returns (ats, slug) or None."""
    attempts: list[tuple[str, str]] = []
    if hint and hint[0] and hint[1]:
        attempts.append(hint)
    for slug in slug_candidates(name, domain):
        for ats in PROBE_ORDER:
            if (ats, slug) not in attempts:
                attempts.append((ats, slug))
    for ats, slug in attempts:
        try:
            if PROBES[ats](slug, name):
                return ats, slug
        except http.HTTPError:
            continue
    return None
