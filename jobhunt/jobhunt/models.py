from __future__ import annotations

from dataclasses import dataclass, field

STATUSES = [
    "new",            # discovered, not looked at
    "shortlisted",    # worth applying
    "referral_asked", # referral request sent, waiting
    "applied",
    "assessment",     # OA / take-home
    "interview",
    "offer",
    "rejected",
    "ghosted",
    "skipped",
    "withdrawn",
    "closed",         # posting disappeared before applying
]

# Ordering used so an inbox scan never moves a job backwards.
PROGRESS = {s: i for i, s in enumerate(
    ["new", "shortlisted", "referral_asked", "applied", "assessment", "interview", "offer"])}
TERMINAL = {"rejected", "ghosted", "skipped", "withdrawn", "closed", "offer"}
ACTIVE = {"applied", "assessment", "interview", "referral_asked"}


@dataclass
class Job:
    source: str
    native_id: str
    company: str
    title: str
    location: str = ""
    remote: bool | None = None
    url: str = ""
    apply_url: str = ""
    description: str = ""
    posted_at: str | None = None        # ISO date (YYYY-MM-DD)
    salary_text: str = ""
    salary_min_lpa: float | None = None
    salary_max_lpa: float | None = None
    contact_email: str = ""
    department: str = ""
    ats: str = ""                       # greenhouse / lever / ... when known
    detail_ref: str = ""                # source-specific handle to fetch the description later
    tags: list[str] = field(default_factory=list)

    @property
    def id(self) -> str:
        return f"{self.source}:{self.native_id}"


@dataclass
class Funding:
    company: str
    headline: str
    url: str
    published_at: str | None
    round: str = ""
    amount: str = ""
    amount_usd_m: float | None = None
    source: str = ""
