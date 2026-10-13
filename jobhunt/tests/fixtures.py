"""Canned API responses shaped like each source's real payload, plus a fake transport."""
from __future__ import annotations

import json
from datetime import date, datetime, time, timedelta, timezone

TODAY = date.today()


def D(days: int) -> str:
    return (TODAY - timedelta(days=days)).isoformat()


def epoch(days: int) -> int:
    return int(datetime.combine(TODAY - timedelta(days=days), time(12), tzinfo=timezone.utc).timestamp())

GREENHOUSE_BOARD = {"name": "Acme Data", "content": "<p>About Acme</p>"}
GREENHOUSE_JOBS = {
    "jobs": [
        {
            "id": 4001, "title": "Senior Backend Engineer, Streaming",
            "location": {"name": "Bengaluru, India"}, "absolute_url": "https://boards.greenhouse.io/acmedata/jobs/4001",
            "first_published": f"{D(3)}T10:00:00-04:00", "updated_at": f"{D(1)}T10:00:00-04:00",
            "departments": [{"name": "Platform"}], "offices": [{"name": "Bengaluru"}],
            "content": ("&lt;p&gt;Acme Data is a streaming analytics platform used by 500 enterprises.&lt;/p&gt;"
                        "&lt;ul&gt;&lt;li&gt;4+ years of experience building distributed systems&lt;/li&gt;"
                        "&lt;li&gt;Python or Go, Kafka, Kubernetes, PostgreSQL&lt;/li&gt;"
                        "&lt;li&gt;Compensation: &amp;#8377;35L &amp;ndash; &amp;#8377;50L + ESOPs&lt;/li&gt;&lt;/ul&gt;"),
        },
        {
            "id": 4002, "title": "Engineering Manager, Platform", "location": {"name": "Bengaluru"},
            "absolute_url": "https://boards.greenhouse.io/acmedata/jobs/4002", "first_published": f"{D(2)}T10:00:00Z",
            "content": "&lt;p&gt;Lead a team.&lt;/p&gt;",
        },
        {
            "id": 4003, "title": "Backend Engineer", "location": {"name": "San Francisco, CA"},
            "absolute_url": "https://boards.greenhouse.io/acmedata/jobs/4003", "first_published": f"{D(2)}T10:00:00Z",
            "content": "&lt;p&gt;Python services.&lt;/p&gt;",
        },
    ],
    "meta": {"total": 3},
}

LEVER_POSTINGS = [
    {
        "id": "b7c9-1", "text": "Software Engineer II - Data Platform",
        "categories": {"commitment": "Full-time", "team": "Data", "location": "Remote - India",
                       "allLocations": ["Remote - India"]},
        "workplaceType": "remote", "createdAt": epoch(10) * 1000,
        "hostedUrl": "https://jobs.lever.co/zenith/b7c9-1", "applyUrl": "https://jobs.lever.co/zenith/b7c9-1/apply",
        "descriptionPlain": "Zenith builds the ledger for modern payments.",
        "lists": [{"text": "What you'll need", "content": "<li>3-6 years experience with Python, Spark, Airflow</li>"
                                                          "<li>Experience with event-driven microservices</li>"}],
        "additionalPlain": "Equal opportunity employer.",
        "salaryRange": {"min": 3000000, "max": 4200000, "currency": "INR", "interval": "per-year-salary"},
    }
]

ASHBY_BOARD = {
    "apiVersion": "1",
    "jobs": [
        {
            "id": "a1", "title": "AI Engineer (LLM Platform)", "department": "Engineering", "team": "AI",
            "employmentType": "FullTime", "location": "Bengaluru", "secondaryLocations": [{"location": "Remote (India)"}],
            "publishedAt": f"{D(1)}T08:00:00.000+00:00", "isListed": True, "isRemote": False, "workplaceType": "Hybrid",
            "jobUrl": "https://jobs.ashbyhq.com/nimbus/a1", "applyUrl": "https://jobs.ashbyhq.com/nimbus/a1/application",
            "descriptionPlain": "Nimbus helps enterprises ship agents. You will build RAG pipelines, tool calling, "
                                "evaluation harnesses. Python, FastAPI, Postgres, Redis. 3+ years of experience.",
            "compensation": {
                "compensationTierSummary": "₹40L – ₹60L • Offers Equity",
                "summaryComponents": [{"compensationType": "Salary", "interval": "1 YEAR", "currencyCode": "INR",
                                       "minValue": 4000000, "maxValue": 6000000}],
            },
        },
        {"id": "a2", "title": "Hidden role", "location": "Bengaluru", "isListed": False,
         "jobUrl": "https://jobs.ashbyhq.com/nimbus/a2", "descriptionPlain": "x"},
    ],
}

SMARTRECRUITERS_LIST = {
    "offset": 0, "limit": 100, "totalFound": 1,
    "content": [{
        "id": "744000", "name": "Backend Developer - Payments", "releasedDate": f"{D(5)}T09:00:00.000Z",
        "company": {"identifier": "Orbitpay", "name": "Orbitpay"},
        "location": {"city": "Bangalore", "region": "KA", "country": "in", "remote": False,
                     "fullLocation": "Bangalore, KA, India"},
        "department": {"label": "Engineering"},
    }],
}
SMARTRECRUITERS_DETAIL = {
    "applyUrl": "https://jobs.smartrecruiters.com/Orbitpay/744000-backend-developer/apply",
    "postingUrl": "https://jobs.smartrecruiters.com/Orbitpay/744000-backend-developer",
    "jobAd": {"sections": {
        "companyDescription": {"text": "<p>Orbitpay is a payments company.</p>"},
        "jobDescription": {"text": "<p>Build idempotent payment APIs in Java and Kafka.</p>"},
        "qualifications": {"text": "<p>4-7 years of experience</p>"},
    }},
}

WORKABLE_WIDGET = {
    "name": "Quanta",
    "jobs": [{
        "title": "Platform Engineer", "shortcode": "ABC123", "telecommuting": True, "department": "Infra",
        "url": "https://apply.workable.com/j/ABC123", "application_url": "https://apply.workable.com/j/ABC123/apply",
        "published_on": D(4), "created_at": D(4), "country": "India", "city": "Bengaluru",
        "locations": [{"country": "India", "countryCode": "IN", "city": "Bengaluru", "region": "Karnataka"}],
        "description": "<p>Kubernetes, Helm, Prometheus, Go.</p>", "requirements": "<p>5+ years experience</p>",
    }],
}

RECRUITEE_OFFERS = {"offers": [{
    "id": 99, "title": "Data Engineer", "location": "Bengaluru, India", "remote": False,
    "careers_url": "https://lumen.recruitee.com/o/data-engineer",
    "careers_apply_url": "https://lumen.recruitee.com/o/data-engineer/c/new",
    "description": "<p>ClickHouse, DuckDB, Parquet and Spark pipelines.</p>", "requirements": "<p>3+ years experience</p>",
    "published_at": f"{D(8)} 10:00:00 UTC",
}]}

WORKDAY_JOBS = {"total": 2, "jobPostings": [
    {"title": "Senior Software Engineer - Data Streaming", "externalPath": "/job/Bangalore/Senior-SWE_JR100",
     "locationsText": "India, Bengaluru", "postedOn": "Posted 2 Days Ago", "bulletFields": ["JR100"]},
    {"title": "Software Engineer", "externalPath": "/job/Santa-Clara/SWE_JR200",
     "locationsText": "US, CA, Santa Clara", "postedOn": "Posted 30+ Days Ago", "bulletFields": ["JR200"]},
]}
WORKDAY_DETAIL = {"jobPostingInfo": {
    "jobDescription": "<p>Kafka, Flink and Python at scale. 4+ years of experience.</p>",
    "externalUrl": "https://megacorp.wd5.myworkdayjobs.com/en-US/External/job/Bangalore/Senior-SWE_JR100",
}}

REMOTEOK = [
    {"legal": "API Terms of Service: link back to Remote OK."},
    {"id": "1001", "epoch": 0, "date": f"{D(2)}T00:00:00+00:00", "company": "Driftwood", "position": "Senior Backend Engineer",
     "tags": ["python", "kafka"], "description": "<p>Python, Kafka, Postgres.</p>", "location": "Worldwide",
     "salary_min": 90000, "salary_max": 130000, "url": "https://remoteok.com/remote-jobs/1001",
     "apply_url": "https://remoteok.com/l/1001"},
    {"id": "1002", "date": f"{D(2)}T00:00:00+00:00", "company": "Statewide", "position": "Backend Engineer",
     "description": "<p>Go.</p>", "location": "USA only", "url": "https://remoteok.com/remote-jobs/1002"},
]

REMOTIVE = {"job-count": 2, "jobs": [
    {"id": 2001, "url": "https://remotive.com/remote-jobs/software-dev/2001", "title": "Backend Engineer (Python)",
     "company_name": "Lighthouse", "category": "Software Development", "publication_date": f"{D(6)}T10:00:00",
     "candidate_required_location": "Worldwide", "salary": "$80k - $110k", "description": "<p>FastAPI, Redis</p>"},
    {"id": 2002, "url": "https://remotive.com/remote-jobs/software-dev/2002", "title": "Backend Engineer",
     "company_name": "Americana", "publication_date": f"{D(6)}T10:00:00", "candidate_required_location": "USA",
     "salary": "", "description": "<p>Ruby</p>"},
]}

HIMALAYAS = {"offset": 0, "limit": 20, "totalCount": 1, "jobs": [
    {"title": "Data Platform Engineer", "companyName": "Polaris", "locationRestrictions": ["India", "Singapore"],
     "minSalary": 60000, "maxSalary": 80000, "description": "<p>Spark, Airflow, Kafka</p>",
     "pubDate": epoch(3), "applicationLink": "https://himalayas.app/companies/polaris/jobs/dpe",
     "guid": "himalayas-polaris-dpe"},
]}

JOBICY = {"jobCount": 1, "jobs": [
    {"id": 3001, "url": "https://jobicy.com/jobs/3001", "jobTitle": "Backend Developer", "companyName": "Kestrel",
     "jobGeo": "APAC", "jobDescription": "<p>Node.js and Postgres</p>", "pubDate": f"{D(9)} 10:00:00",
     "annualSalaryMin": "50000", "annualSalaryMax": "70000", "salaryCurrency": "USD"},
]}

WWR_RSS = f"""<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel><title>WWR</title>
<item><title>Northwind: Senior Backend Engineer</title><region>Anywhere in the World</region>
<pubDate>{(TODAY - timedelta(days=1)).strftime('%a, %d %b %Y')} 10:00:00 +0000</pubDate>
<link>https://weworkremotely.com/remote-jobs/northwind-senior-backend-engineer</link>
<description>&lt;p&gt;Python, Kubernetes, gRPC&lt;/p&gt;</description></item>
</channel></rss>""".encode()

AMAZON = {"hits": 1, "jobs": [
    {"id_icims": "2800001", "title": "Software Development Engineer II, Kinesis", "location": "IN, KA, Bengaluru",
     "normalized_location": "Bengaluru, Karnataka, IND", "posted_date": (TODAY - timedelta(days=4)).strftime("%B %d, %Y"),
     "description": "Build streaming infrastructure.", "basic_qualifications": "- 3+ years of non-internship professional software development experience",
     "preferred_qualifications": "- Java, distributed systems", "job_path": "/en/jobs/2800001/sde-ii-kinesis",
     "company_name": "Amazon Development Centre (India) Private Limited"},
]}

HN_SEARCH = {"hits": [{"objectID": "41000000", "title": "Ask HN: Who is hiring? (October 2026)"}]}
HN_ITEM = {"id": 41000000, "children": [
    {"id": 41000001, "created_at_i": epoch(5),
     "text": "Ferrite | Senior Backend Engineer | REMOTE (Worldwide) or Bangalore | $90k-$130k<p>We build "
             "data infrastructure in Python and Rust. Email jobs [at] ferrite [dot] dev</p>"},
    {"id": 41000002, "created_at_i": epoch(5),
     "text": "Gridline | Full Stack Engineer | ONSITE San Francisco<p>React + Node.</p>"},
    {"id": 41000003, "text": "just a comment without the format"},
]}

YC = [
    {"name": "Ferrite", "slug": "ferrite", "website": "https://ferrite.dev", "one_liner": "Data infra for robots",
     "industry": "B2B", "regions": ["India", "Remote"], "all_locations": "Bengaluru, KA, India", "status": "Active",
     "batch": "W25", "team_size": 12, "isHiring": True},
    {"name": "Bayside", "slug": "bayside", "website": "https://bayside.com", "one_liner": "SF only",
     "regions": ["America / Canada"], "all_locations": "San Francisco, CA, USA", "status": "Active"},
]

NEWS_RSS = f"""<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel><title>News</title>
<item><title>Bengaluru-based AI startup Nimbus raises $30 Mn in Series B - Inc42 Media</title>
<link>https://news.example/nimbus</link><pubDate>{(TODAY - timedelta(days=4)).strftime('%a, %d %b %Y')} 06:00:00 GMT</pubDate></item>
<item><title>Why every founder should read this - Blog</title><link>https://news.example/x</link>
<pubDate>{(TODAY - timedelta(days=2)).strftime('%a, %d %b %Y')} 06:00:00 GMT</pubDate></item>
<item><title>Old startup raises $5 Mn - Old</title><link>https://news.example/old</link>
<pubDate>Mon, 01 Jan 2024 06:00:00 GMT</pubDate></item>
</channel></rss>""".encode()


ROUTES: list[tuple[str, str, object]] = [
    # (method, url prefix, payload)
    ("GET", "https://boards-api.greenhouse.io/v1/boards/acmedata/jobs", GREENHOUSE_JOBS),
    ("GET", "https://boards-api.greenhouse.io/v1/boards/acmedata", GREENHOUSE_BOARD),
    ("GET", "https://api.lever.co/v0/postings/zenith", LEVER_POSTINGS),
    ("GET", "https://api.ashbyhq.com/posting-api/job-board/nimbus", ASHBY_BOARD),
    ("GET", "https://api.smartrecruiters.com/v1/companies/orbitpay/postings/744000", SMARTRECRUITERS_DETAIL),
    ("GET", "https://api.smartrecruiters.com/v1/companies/orbitpay/postings", SMARTRECRUITERS_LIST),
    ("GET", "https://apply.workable.com/api/v1/widget/accounts/quanta", WORKABLE_WIDGET),
    ("GET", "https://lumen.recruitee.com/api/offers/", RECRUITEE_OFFERS),
    ("POST", "https://megacorp.wd5.myworkdayjobs.com/wday/cxs/megacorp/External/jobs", WORKDAY_JOBS),
    ("GET", "https://megacorp.wd5.myworkdayjobs.com/wday/cxs/megacorp/External/job/Bangalore", WORKDAY_DETAIL),
    ("GET", "https://remoteok.com/api", REMOTEOK),
    ("GET", "https://remotive.com/api/remote-jobs", REMOTIVE),
    ("GET", "https://himalayas.app/jobs/api", HIMALAYAS),
    ("GET", "https://jobicy.com/api/v2/remote-jobs", JOBICY),
    ("GET", "https://weworkremotely.com/categories/", WWR_RSS),
    ("GET", "https://www.amazon.jobs/en/search.json", AMAZON),
    ("GET", "https://hn.algolia.com/api/v1/search_by_date", HN_SEARCH),
    ("GET", "https://hn.algolia.com/api/v1/items/41000000", HN_ITEM),
    ("GET", "https://yc-oss.github.io/api/companies/hiring.json", YC),
    ("GET", "https://news.google.com/rss/search", NEWS_RSS),
]


class FakeTransport:
    """Routes requests to canned payloads by longest matching URL prefix; 404 otherwise."""

    def __init__(self, routes=ROUTES, overrides: dict | None = None):
        self.routes = sorted(routes, key=lambda r: -len(r[1]))
        self.overrides = overrides or {}
        self.calls: list[tuple[str, str]] = []

    def __call__(self, method, url, body, headers):
        self.calls.append((method, url))
        for prefix, payload in self.overrides.items():
            if url.startswith(prefix):
                return self._encode(payload)
        for m, prefix, payload in self.routes:
            if m == method and url.startswith(prefix):
                # Paginated sources: second page is empty.
                if ("offset=20" in url or "offset=100" in url) and isinstance(payload, dict):
                    return 200, json.dumps({k: ([] if isinstance(v, list) else v) for k, v in payload.items()}).encode()
                return self._encode(payload)
        return 404, b'{"error":"not found"}'

    @staticmethod
    def _encode(payload):
        if isinstance(payload, tuple):
            return payload
        if isinstance(payload, bytes):
            return 200, payload
        return 200, json.dumps(payload).encode()


APPLY_FORM = """<!doctype html><html><body>
<h1>Apply: Senior Backend Engineer</h1>
<form id="application_form">
  <label for="first_name">First Name *</label><input id="first_name" name="job_application[first_name]" required>
  <label for="last_name">Last Name *</label><input id="last_name" name="job_application[last_name]" required>
  <label for="email">Email *</label><input id="email" type="email" name="job_application[email]" required>
  <label for="phone">Phone</label><input id="phone" type="tel" name="job_application[phone]">
  <div class="field"><label>Resume/CV *</label><input type="file" id="resume" name="resume" style="display:none"></div>
  <div class="field"><label>LinkedIn Profile</label><input type="text" name="urls[LinkedIn]"></div>
  <div class="field"><label>GitHub</label><input type="text" name="urls[GitHub]"></div>
  <div class="field"><label>Website</label><input type="text" name="urls[Portfolio]"></div>
  <div class="field"><label>Current company</label><input type="text" name="org"></div>
  <div class="field"><label>What is your notice period?</label><input type="text" name="q1"></div>
  <div class="field"><label>Expected CTC (LPA)</label><input type="text" name="q2"></div>
  <div class="field"><label>Who referred you?</label><input type="text" name="q3"></div>
  <div class="field"><label>Why do you want to join us? *</label><textarea name="q4" required></textarea></div>
  <div class="field"><label>Cover Letter</label><textarea name="cover_letter"></textarea></div>
  <button type="submit">Submit application</button>
</form></body></html>"""
