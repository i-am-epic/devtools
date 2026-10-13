"""Reply tracking over IMAP.

Reads (never writes) the inbox, matches messages to applications by sender
domain, company name and ATS sender, classifies them, and moves the job along:
acknowledgement -> applied, assessment, interview (writes a prep plan),
rejection, offer. Unmatched recruiter mail is kept as an inbound lead.
"""
from __future__ import annotations

import email
import imaplib
import os
import re
from dataclasses import dataclass
from datetime import date, timedelta
from email import policy
from email.utils import parseaddr, parsedate_to_datetime

from . import db, llm
from .config import Profile
from .models import ACTIVE
from .text import html_to_text, keyword_in, truncate

ATS_SENDERS = (
    "greenhouse.io", "greenhouse-mail.io", "lever.co", "ashbyhq.com", "smartrecruiters.com", "workable.com",
    "workablemail.com", "myworkday.com", "myworkdayjobs.com", "icims.com", "recruitee.com", "darwinbox",
    "keka.com", "zohorecruit", "freshteam", "jobvite.com", "teamtailor", "hackerrank.com", "codesignal.com",
    "hackerearth.com", "codility.com", "calendly.com", "goodtime.io", "instahyre.com", "cutshort.io",
    "wellfound.com", "hirist", "naukri.com", "amazon.jobs",
)

RULES = [
    ("offer", r"pleased to (?:extend|offer)|offer letter|formal offer|we(?:'d| would) like to offer you|"
              r"excited to offer"),
    ("rejection", r"unfortunately|not (?:be )?(?:moving|proceed)|decided to (?:move|go) forward with other|"
                  r"won'?t be (?:moving|proceeding)|not (?:a|the right) (?:fit|match)|position has been filled|"
                  r"regret to inform|other candidates (?:whose|who)|will not be progressing|"
                  r"no longer (?:under )?consider|we have decided not to|not been selected|unable to offer"),
    ("assessment", r"assessment|hackerrank|codesignal|hackerearth|codility|take[- ]home|coding (?:test|challenge|"
                   r"exercise|round)|online test|technical assignment"),
    ("interview", r"schedul|your availability|interview|calendly|goodtime|phone screen|quick chat|"
                  r"next steps?|speak with you|meet the team|book a (?:time|slot)|time slots?|"
                  r"would love to (?:chat|connect|talk)"),
    ("ack", r"thank(?:s| you) for (?:applying|your application|your interest)|application (?:has been )?received|"
            r"we(?: have|'ve)? received your application|successfully submitted|application confirmation"),
]
_OUTREACH = re.compile(r"opportunit|\brole\b|position|hiring|your profile|open to (?:new|explor)|"
                       r"exploring|came across your|reach(?:ing)? out", re.I)

_BULK = re.compile(r"no-?reply|notifications?@|jobalerts?|digest|newsletter|alerts?@|updates@|mailer", re.I)

STATUS_FOR = {"offer": "offer", "rejection": "rejected", "assessment": "assessment", "interview": "interview",
              "ack": "applied"}


@dataclass
class Mail:
    message_id: str
    received_at: str
    sender: str
    sender_domain: str
    subject: str
    body: str


def classify(subject: str, body: str) -> str:
    text = f"{subject}\n{body[:6000]}"
    for label, pattern in RULES:
        if re.search(pattern, text, re.I):
            return label
    return "other"


def classify_with_llm(profile: Profile, mail: Mail) -> str:
    answer = llm.complete(profile, f"""Classify this email a job applicant received. Reply with exactly one word:
offer, rejection, assessment, interview, ack (application acknowledged), outreach (recruiter reaching out
about a different/new role), or other.

From: {mail.sender}
Subject: {mail.subject}

{truncate(mail.body, 4000)}""", max_tokens=300, effort="low")
    word = (answer or "").strip().lower().split()[0:1]
    return word[0] if word and word[0] in {"offer", "rejection", "assessment", "interview", "ack", "outreach"} else "other"


def _text_of(msg) -> str:
    part = msg.get_body(preferencelist=("plain", "html"))
    if part is None:
        return ""
    try:
        content = part.get_content()
    except (LookupError, ValueError):
        return ""
    return html_to_text(content) if part.get_content_type() == "text/html" else content


def fetch(profile: Profile, days: int | None = None) -> list[Mail]:
    cfg = profile.inbox
    password = os.environ.get(cfg.get("password_env", "JOBHUNT_IMAP_PASSWORD"))
    if not password:
        raise RuntimeError(f"set {cfg.get('password_env', 'JOBHUNT_IMAP_PASSWORD')} to an IMAP app password")
    days = days or int(cfg.get("days", 21))
    since = (date.today() - timedelta(days=days)).strftime("%d-%b-%Y")
    out: list[Mail] = []
    with imaplib.IMAP4_SSL(cfg.get("host", "imap.gmail.com")) as conn:
        conn.login(cfg["user"], password)
        conn.select("INBOX", readonly=True)
        _, data = conn.search(None, "SINCE", since)
        ids = data[0].split()[-600:]
        for i in range(0, len(ids), 50):
            _, chunk = conn.fetch(b",".join(ids[i:i + 50]), "(BODY.PEEK[])")
            for part in chunk:
                if isinstance(part, tuple):
                    out.append(parse(part[1]))
    return out


def parse(raw: bytes) -> Mail:
    msg = email.message_from_bytes(raw, policy=policy.default)
    name, addr = parseaddr(str(msg.get("From", "")))
    try:
        received = parsedate_to_datetime(str(msg.get("Date"))).isoformat()
    except (TypeError, ValueError):
        received = db.now()
    return Mail(
        message_id=str(msg.get("Message-ID") or f"{addr}-{received}"),
        received_at=received,
        sender=f"{name} <{addr}>" if name else addr,
        sender_domain=addr.rsplit("@", 1)[-1].lower() if "@" in addr else "",
        subject=str(msg.get("Subject", "")),
        body=_text_of(msg),
    )


def match(conn, mail: Mail, candidates) -> tuple[object, int] | tuple[None, int]:
    best, best_score = None, 0
    subject = mail.subject.lower()
    body = mail.body[:5000].lower()
    from_ats = any(a in mail.sender_domain for a in ATS_SENDERS)
    for row in candidates:
        name = row["company"].lower().strip()
        if len(name) < 3:
            continue
        score = 0
        company = db.company(conn, row["company_key"])
        domain = (company["domain"] or "").lower() if company else ""
        if domain and (mail.sender_domain == domain or mail.sender_domain.endswith("." + domain)):
            score += 3
        if keyword_in(subject, name):
            score += 2
        elif keyword_in(body, name) or keyword_in(mail.sender.lower(), name):
            score += 1
        if from_ats:
            score += 1
        title_words = [w for w in re.findall(r"[a-z]+", row["title"].lower()) if len(w) > 3]
        if title_words and sum(w in subject or w in body[:1500] for w in title_words) >= min(2, len(title_words)):
            score += 1
        if score > best_score:
            best, best_score = row, score
    return (best, best_score) if best_score >= 3 else (None, best_score)


def process(conn, profile: Profile, mails: list[Mail], dry_run: bool = False, prep_writer=None) -> list[dict]:
    me = (profile.me.get("email") or "").lower()
    candidates = db.jobs(conn, f"status IN ({', '.join('?' * (len(ACTIVE) + 1))})",
                         (*ACTIVE, "shortlisted"), order="applied_at DESC")
    results = []
    for mail in sorted(mails, key=lambda m: m.received_at):
        if me and me in mail.sender.lower():
            continue
        if conn.execute("SELECT 1 FROM emails WHERE message_id = ?", (mail.message_id,)).fetchone():
            continue
        row, _ = match(conn, mail, candidates)
        label = classify(mail.subject, mail.body)
        if row is not None and label == "other":
            label = classify_with_llm(profile, mail)
        if row is None:
            from_ats = any(a in mail.sender_domain for a in ATS_SENDERS)
            if _BULK.search(mail.sender) and not from_ats:
                continue  # job alerts and newsletters, not people
            looks_recruiting = from_ats or _OUTREACH.search(f"{mail.subject}\n{mail.body[:1500]}")
            if not looks_recruiting or (label == "other" and not _OUTREACH.search(mail.subject)):
                continue
            label = f"unmatched:{label if label != 'other' else 'outreach'}"
        result = {"mail": mail, "job": row, "label": label, "status_changed": False}
        if not dry_run:
            conn.execute(
                "INSERT OR IGNORE INTO emails (message_id, job_n, received_at, sender, subject, classification, snippet)"
                " VALUES (?, ?, ?, ?, ?, ?, ?)",
                (mail.message_id, row["n"] if row else None, mail.received_at, mail.sender, mail.subject, label,
                 truncate(mail.body.replace("\n", " "), 400)),
            )
            if row is not None and label in STATUS_FOR:
                result["status_changed"] = db.set_status(conn, row["n"], STATUS_FOR[label],
                                                         f"email: {truncate(mail.subject, 120)}")
                if label in ("interview", "assessment") and prep_writer:
                    result["prep"] = prep_writer(row)
            elif row is not None:
                db.log(conn, row["n"], "email", f"{label}: {truncate(mail.subject, 120)}")
            conn.commit()
        results.append(result)
    return results


def followups(conn, today: date | None = None) -> dict[str, list]:
    """Applications needing a nudge, and ones to write off."""
    today = today or date.today()
    due, ghosted = [], []
    for row in db.jobs(conn, "status IN ('applied', 'referral_asked')", order="applied_at"):
        since = (row["applied_at"] or row["status_at"] or "")[:10]
        if not since:
            continue
        age = (today - date.fromisoformat(since)).days
        replied = conn.execute("SELECT 1 FROM emails WHERE job_n = ? AND classification != 'ack'",
                               (row["n"],)).fetchone()
        if replied:
            continue
        nudged = conn.execute("SELECT 1 FROM events WHERE job_n = ? AND kind = 'followup'", (row["n"],)).fetchone()
        if row["status"] == "referral_asked" and age >= 4 and not nudged:
            due.append((row, age, "nudge the referrer"))
        elif row["status"] == "applied" and 7 <= age < 28 and not nudged:
            due.append((row, age, "follow up with the recruiter"))
        elif row["status"] == "applied" and age >= 28:
            ghosted.append((row, age))
    return {"due": due, "ghosted": ghosted}
