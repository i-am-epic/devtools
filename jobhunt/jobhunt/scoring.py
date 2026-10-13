"""Fit scoring: how good a match is this job, and why.

Every point awarded or deducted carries a reason, so ``jobhunt show`` can
explain a ranking instead of asking you to trust it.

    title      0..30   role family match (backend/platform/data/AI > generic SWE)
    skills     0..30   weighted overlap between the JD and your profile skills
    location   0..15   Bengaluru or remote-eligible-from-India; ineligible otherwise
    comp       -20..12 stated band vs. your floor, else a company-tier estimate
    seniority  -15..10 years asked for and level words in the title
    fresh      -5..5   posting age
    company    0..10   seed-list tier, recent funding
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import date

from .config import Profile
from .text import keyword_in

# Signals that a "remote" role is not open to someone in India.
_RESTRICTED = re.compile(
    r"\b(?:us|u\.s\.|usa|united states|north america|americas|canada|europe|eu|uk|united kingdom|emea|latam|"
    r"germany|france|spain|netherlands|poland|brazil|mexico|australia|new zealand)\b"
    r"[\s-]*(?:only|based|residents?|citizens?|time ?zones?|hours)",
    re.I,
)
_RESTRICTED_PHRASE = re.compile(
    r"must (?:be|reside|live) (?:located |based )?in (?:the )?(?:us|u\.s\.|usa|united states|canada|europe|uk|eu)\b"
    r"|authori[sz]ed to work in the (?:us|united states)|us work authori[sz]ation|green card|"
    r"security clearance|w-?2 only",
    re.I,
)
_OTHER_INDIA = re.compile(
    r"\b(hyderabad|pune|chennai|mumbai|gurgaon|gurugram|noida|delhi|new delhi|ncr|kolkata|ahmedabad|"
    r"kochi|coimbatore|jaipur|indore|chandigarh|trivandrum|thiruvananthapuram|mysore|mysuru)\b",
    re.I,
)
_ABROAD = re.compile(
    r"\b(san francisco|new york|nyc|seattle|austin|boston|london|berlin|amsterdam|dublin|paris|toronto|"
    r"vancouver|singapore|sydney|melbourne|tokyo|tel aviv|dubai|usa|united states|canada|germany|uk|"
    r"united kingdom|ireland|netherlands|france|spain|poland|israel|australia|japan|mexico|brazil|"
    r"argentina|portugal|sweden|switzerland|denmark|norway|finland|estonia|romania|czech|"
    r"[A-Z][a-z]+, (?:CA|NY|WA|TX|MA|IL|CO|GA|NC|VA|OR|FL))\b",
)

# Skills commonly asked for that aren't on the profile: shown as "learn or
# mention adjacent experience", never as a penalty.
MARKET_SKILLS = [
    "go", "golang", "rust", "java", "kotlin", "scala", "typescript", "node.js", "c++",
    "aws", "gcp", "terraform", "flink", "airflow", "dbt", "snowflake", "bigquery", "databricks",
    "cassandra", "dynamodb", "elasticsearch", "opensearch", "kafka streams", "pulsar", "rabbitmq",
    "temporal", "ray", "pytorch", "vector database", "pgvector", "embeddings", "fine-tuning",
    "system design", "low-level design", "react", "next.js", "graphql", "envoy", "istio", "ebpf",
    "linux internals", "networking", "consensus", "raft", "lakehouse", "iceberg", "delta lake",
]


@dataclass
class Score:
    total: float = 0
    eligible: bool = True
    reasons: list[tuple[str, float, str]] = field(default_factory=list)
    gaps: list[str] = field(default_factory=list)
    matched: list[str] = field(default_factory=list)

    def add(self, part: str, points: float, why: str) -> None:
        self.total += points
        self.reasons.append((part, round(points, 1), why))

    def reject(self, part: str, why: str) -> None:
        self.eligible = False
        self.reasons.append((part, 0, f"INELIGIBLE: {why}"))

    def as_list(self) -> list:
        return [{"part": p, "points": pts, "why": w} for p, pts, w in self.reasons] + (
            [{"part": "gaps", "points": 0, "why": ", ".join(self.gaps)}] if self.gaps else [])


def _has_any(text: str, words) -> list[str]:
    return [w for w in words if keyword_in(text, w)]


def score_title(title: str, profile: Profile, s: Score) -> None:
    t = f" {title.lower()} "
    excluded = [w for w in profile.titles.get("exclude", []) if keyword_in(t, w.strip())]
    if excluded:
        s.reject("title", f"title contains '{excluded[0].strip()}'")
        return
    strong = _has_any(t, profile.titles.get("strong", []))
    ok = _has_any(t, profile.titles.get("ok", []))
    if strong:
        s.add("title", 30, f"strong role match ({', '.join(strong[:3])})")
    elif ok:
        s.add("title", 22, f"engineering role ({ok[0]})")
    elif re.search(r"engineer|developer|sde|swe", t):
        s.add("title", 12, "engineering title, unfamiliar family")
    else:
        s.reject("title", "not an engineering role")


def score_skills(text: str, profile: Profile, s: Score) -> None:
    weights = profile.skill_weights()
    matched = [(kw, w) for kw, w in weights.items() if keyword_in(text, kw)]
    total = sum(w for _, w in matched)
    points = min(30.0, total * 30 / 22)
    matched.sort(key=lambda x: -x[1])
    s.matched = [kw.rstrip("*") for kw, _ in matched]
    s.add("skills", points, f"{len(matched)} profile skills in JD: {', '.join(s.matched[:8]) or 'none'}")
    mine = set(weights)
    s.gaps = [kw for kw in MARKET_SKILLS if kw not in mine and keyword_in(text, kw)][:8]


def score_location(job: dict, profile: Profile, s: Score) -> None:
    location = job.get("location") or ""
    loc = location.lower()
    text = f"{location}\n{(job.get('description') or '')[:4000]}"
    blr = _has_any(loc, profile.target.get("locations", []))
    remote = bool(job.get("remote")) or "remote" in loc
    remote_ok = _has_any(loc, profile.target.get("remote_ok", []))
    if blr:
        s.add("location", 15, f"Bengaluru ({location[:60]})")
        return
    if remote:
        if remote_ok:
            s.add("location", 15, f"remote, open to {remote_ok[0]}")
            return
        listed = re.search(r"remote\s*\(([^)]*)\)", loc)
        if listed and listed.group(1).strip() not in ("", "unspecified"):
            s.reject("location", f"remote, limited to {listed.group(1).strip()[:50]}")
            return
        if _RESTRICTED.search(text) or _RESTRICTED_PHRASE.search(text):
            s.reject("location", "remote but restricted to another region")
            return
        if _ABROAD.search(location) and not re.search(r"\bremote\b", loc):
            s.reject("location", f"based abroad ({location[:60]})")
            return
        s.add("location", 8, "remote, region not stated -- check before applying")
        return
    if _OTHER_INDIA.search(loc):
        if profile.target.get("accept_other_india_cities"):
            s.add("location", 6, f"India, not Bengaluru ({location[:60]})")
        else:
            s.reject("location", f"India but not Bengaluru ({location[:60]})")
        return
    if "india" in loc:
        s.add("location", 10, "India (city unspecified)")
        return
    if not loc.strip():
        s.add("location", 3, "location not stated")
        return
    s.reject("location", f"not Bengaluru/remote ({location[:60]})")


def score_comp(job: dict, profile: Profile, company: dict | None, s: Score) -> None:
    target = profile.min_lpa
    lo, hi = job.get("salary_min_lpa"), job.get("salary_max_lpa")
    if hi:
        if lo and lo >= target:
            s.add("comp", 12, f"band {lo:.0f}-{hi:.0f} LPA starts above your {target:.0f} floor")
        elif hi >= target:
            s.add("comp", 8, f"band {lo or hi:.0f}-{hi:.0f} LPA reaches your {target:.0f} floor")
        elif hi >= target * 0.8:
            s.add("comp", -6, f"band tops out at {hi:.0f} LPA, a bit under {target:.0f}")
        else:
            s.add("comp", -20, f"band tops out at {hi:.0f} LPA, well under {target:.0f}")
        return
    tier = (company or {}).get("tier") or ""
    if tier == "A":
        s.add("comp", 8, "no band posted; tier-A company (typically clears the floor for ~4 YOE)")
    elif tier == "B":
        s.add("comp", 4, "no band posted; tier-B company (usually near the floor, negotiate)")
    elif job.get("remote") and job.get("source") in ("remoteok", "remotive", "himalayas", "jobicy", "weworkremotely"):
        s.add("comp", 3, "no band posted; international remote roles usually pay above the floor")
    else:
        s.add("comp", 0, "no band posted; unknown company tier")


_YEARS = re.compile(
    r"(\d{1,2})\s*(?:\+|plus)?\s*(?:(?:-|–|to)\s*(\d{1,2})\s*)?\+?\s*(?:years|yrs)", re.I)


def years_asked(text: str) -> tuple[int, int | None] | None:
    best = None
    for m in _YEARS.finditer(text or ""):
        window = text[max(0, m.start() - 80): m.end() + 80].lower()
        if "experience" not in window and "exp" not in window:
            continue
        lo = int(m.group(1))
        hi = int(m.group(2)) if m.group(2) else None
        if lo > 25:
            continue
        if best is None or lo < best[0]:
            best = (lo, hi)
    return best


def score_seniority(job: dict, profile: Profile, s: Score) -> None:
    title = f" {(job.get('title') or '').lower()} "
    years = float(profile.me.get("years_experience", 3.5))
    asked = years_asked(job.get("description") or "")
    if asked:
        lo, hi = asked
        if lo > years + 3:
            s.add("seniority", -15, f"asks {lo}+ years (you have ~{years:g})")
        elif lo > years + 1.5:
            s.add("seniority", -4, f"asks {lo}+ years, a stretch -- lead with scope, not tenure")
        elif hi is not None and hi < years - 1:
            s.add("seniority", -6, f"asks {lo}-{hi} years; likely under-levelled for your pay target")
        else:
            s.add("seniority", 8, f"asks {lo}{'-' + str(hi) if hi else '+'} years -- right band")
    penalised = [w for w in profile.titles.get("penalise", []) if re.search(rf"\b{re.escape(w)}\b", title)]
    if penalised:
        s.add("seniority", -6, f"title level '{penalised[0]}' is off-band")
    elif re.search(r"\b(senior|sr\.?|ii|2|sde-?2|sde ii|mts)\b", title):
        s.add("seniority", 2, "mid/senior level title")
    elif re.search(r"\b(i|1|sde-?1)\b", title):
        s.add("seniority", -5, "entry level title; band usually below target")


def score_freshness(job: dict, s: Score, today: date | None = None) -> None:
    posted = job.get("posted_at")
    if not posted:
        return
    try:
        age = ((today or date.today()) - date.fromisoformat(posted[:10])).days
    except ValueError:
        return
    if age <= 7:
        s.add("fresh", 5, f"posted {age}d ago -- early applicants get read")
    elif age <= 21:
        s.add("fresh", 2, f"posted {age}d ago")
    elif age > 60:
        s.add("fresh", -5, f"posted {age}d ago -- may be stale or evergreen")


def score_company(company: dict | None, funding: dict | None, s: Score) -> None:
    if company:
        tier = company.get("tier")
        if tier == "A":
            s.add("company", 5, f"target company (tier A){': ' + company['why'] if company.get('why') else ''}")
        elif tier == "B":
            s.add("company", 3, "target company (tier B)")
    if funding:
        s.add("company", 5, f"raised {funding.get('round') or ''} {funding.get('amount') or ''} on "
                            f"{funding.get('published_at') or '?'} -- hiring budget is fresh".replace("  ", " "))


def score_job(job: dict, profile: Profile, company: dict | None = None, funding: dict | None = None,
              today: date | None = None) -> Score:
    s = Score()
    score_title(job.get("title") or "", profile, s)
    if not s.eligible:
        return s
    text = f"{job.get('title', '')}\n{job.get('description') or ''}".lower()
    score_skills(text, profile, s)
    score_location(job, profile, s)
    score_comp(job, profile, company, s)
    score_seniority(job, profile, s)
    score_freshness(job, s, today)
    score_company(company, funding, s)
    if not (job.get("description") or "").strip():
        s.add("skills", 0, "no description fetched; skills score is from the title only")
    s.total = round(max(0.0, min(100.0, s.total)), 1)
    return s
