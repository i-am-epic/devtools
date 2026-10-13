"""SQLite store: companies, jobs, the status timeline, emails and funding news."""
from __future__ import annotations

import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

from . import config
from .models import Funding, Job, PROGRESS, TERMINAL
from .text import company_key, fingerprint

SCHEMA = """
CREATE TABLE IF NOT EXISTS companies (
    key            TEXT PRIMARY KEY,
    name           TEXT NOT NULL,
    domain         TEXT,
    tier           TEXT,
    category       TEXT,
    why            TEXT,
    about          TEXT,
    ats            TEXT,
    ats_slug       TEXT,
    ats_checked_at TEXT,
    careers_url    TEXT,
    source         TEXT,
    funding_round  TEXT,
    funding_amount TEXT,
    funding_date   TEXT,
    funding_url    TEXT,
    created_at     TEXT,
    updated_at     TEXT
);
CREATE TABLE IF NOT EXISTS jobs (
    n              INTEGER PRIMARY KEY AUTOINCREMENT,
    id             TEXT UNIQUE NOT NULL,
    source         TEXT NOT NULL,
    ats            TEXT,
    company        TEXT NOT NULL,
    company_key    TEXT NOT NULL,
    title          TEXT NOT NULL,
    location       TEXT,
    remote         INTEGER,
    url            TEXT,
    apply_url      TEXT,
    description    TEXT,
    department     TEXT,
    posted_at      TEXT,
    salary_text    TEXT,
    salary_min_lpa REAL,
    salary_max_lpa REAL,
    contact_email  TEXT,
    fingerprint    TEXT,
    score          REAL,
    eligible       INTEGER,
    breakdown      TEXT,
    status         TEXT NOT NULL DEFAULT 'new',
    status_at      TEXT,
    applied_at     TEXT,
    followup_at    TEXT,
    notes          TEXT,
    first_seen     TEXT,
    last_seen      TEXT
);
CREATE INDEX IF NOT EXISTS jobs_fp ON jobs(fingerprint);
CREATE INDEX IF NOT EXISTS jobs_status ON jobs(status);
CREATE INDEX IF NOT EXISTS jobs_company ON jobs(company_key);
CREATE TABLE IF NOT EXISTS events (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    job_n   INTEGER,
    at      TEXT NOT NULL,
    kind    TEXT NOT NULL,
    detail  TEXT
);
CREATE TABLE IF NOT EXISTS emails (
    message_id     TEXT PRIMARY KEY,
    job_n          INTEGER,
    received_at    TEXT,
    sender         TEXT,
    subject        TEXT,
    classification TEXT,
    snippet        TEXT
);
CREATE TABLE IF NOT EXISTS funding (
    url          TEXT PRIMARY KEY,
    company      TEXT,
    company_key  TEXT,
    round        TEXT,
    amount       TEXT,
    amount_usd_m REAL,
    headline     TEXT,
    published_at TEXT,
    source       TEXT
);
"""


def now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def today() -> str:
    return datetime.now(timezone.utc).date().isoformat()


def connect(path: Path | None = None) -> sqlite3.Connection:
    path = path or config.home() / "jobhunt.db"
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    conn.executescript(SCHEMA)
    return conn


# -- companies -----------------------------------------------------------------

def upsert_company(conn, name: str, **fields) -> str:
    key = company_key(name)
    row = conn.execute("SELECT * FROM companies WHERE key = ?", (key,)).fetchone()
    fields = {k: v for k, v in fields.items() if v not in (None, "")}
    if row is None:
        cols = {"key": key, "name": name, "created_at": now(), "updated_at": now(), **fields}
        conn.execute(
            f"INSERT INTO companies ({', '.join(cols)}) VALUES ({', '.join('?' * len(cols))})",
            list(cols.values()),
        )
    elif fields:
        # Seed data (source=seed) is authoritative for tier/why; don't let a
        # funding headline or YC entry overwrite it.
        if row["source"] == "seed":
            fields.pop("source", None)
            for k in ("tier", "category", "why"):
                if row[k]:
                    fields.pop(k, None)
        if fields:
            fields["updated_at"] = now()
            conn.execute(
                f"UPDATE companies SET {', '.join(f'{k} = ?' for k in fields)} WHERE key = ?",
                [*fields.values(), key],
            )
    return key


def companies(conn, where: str = "1=1", params: tuple = ()) -> list[sqlite3.Row]:
    return conn.execute(f"SELECT * FROM companies WHERE {where} ORDER BY name", params).fetchall()


def company(conn, key: str) -> sqlite3.Row | None:
    return conn.execute("SELECT * FROM companies WHERE key = ?", (key,)).fetchone()


# -- jobs ----------------------------------------------------------------------

def upsert_job(conn, job: Job) -> tuple[int, bool]:
    """Insert or refresh a job. Returns (n, is_new). Status and notes survive."""
    ts = now()
    row = conn.execute("SELECT n FROM jobs WHERE id = ?", (job.id,)).fetchone()
    values = dict(
        source=job.source, ats=job.ats or None, company=job.company,
        company_key=company_key(job.company), title=job.title, location=job.location,
        remote=None if job.remote is None else int(job.remote), url=job.url,
        apply_url=job.apply_url or job.url, description=job.description,
        department=job.department, posted_at=job.posted_at, salary_text=job.salary_text,
        salary_min_lpa=job.salary_min_lpa, salary_max_lpa=job.salary_max_lpa,
        contact_email=job.contact_email, fingerprint=fingerprint(job.company, job.title),
        last_seen=ts,
    )
    if row:
        conn.execute(
            f"UPDATE jobs SET {', '.join(f'{k} = ?' for k in values)} WHERE n = ?",
            [*values.values(), row["n"]],
        )
        return row["n"], False
    values.update(id=job.id, first_seen=ts, status="new", status_at=ts)
    cur = conn.execute(
        f"INSERT INTO jobs ({', '.join(values)}) VALUES ({', '.join('?' * len(values))})",
        list(values.values()),
    )
    return cur.lastrowid, True


def set_score(conn, n: int, score: float, eligible: bool, breakdown: list) -> None:
    conn.execute(
        "UPDATE jobs SET score = ?, eligible = ?, breakdown = ? WHERE n = ?",
        (score, int(eligible), json.dumps(breakdown), n),
    )


def job(conn, ref: str | int) -> sqlite3.Row | None:
    ref = str(ref).lstrip("#")
    if ref.isdigit():
        return conn.execute("SELECT * FROM jobs WHERE n = ?", (int(ref),)).fetchone()
    return conn.execute("SELECT * FROM jobs WHERE id = ?", (ref,)).fetchone()


def jobs(conn, where: str = "1=1", params: tuple = (), order: str = "score DESC", limit: int | None = None):
    sql = f"SELECT * FROM jobs WHERE {where} ORDER BY {order}"
    if limit:
        sql += f" LIMIT {int(limit)}"
    return conn.execute(sql, params).fetchall()


def top_jobs(conn, limit: int = 50, statuses=("new", "shortlisted"), min_score: float = 0,
             per_company: int | None = None, stale_days: int = 21) -> list[sqlite3.Row]:
    """Best eligible jobs, one row per fingerprint, optionally capped per company.

    Jobs not seen in a discover run for ``stale_days`` are assumed closed.
    """
    marks = ", ".join("?" * len(statuses))
    rows = conn.execute(
        f"""SELECT * FROM jobs
            WHERE eligible = 1 AND status IN ({marks}) AND score >= ?
              AND last_seen >= datetime('now', ?)
            ORDER BY score DESC, posted_at DESC""",
        (*statuses, min_score, f"-{int(stale_days)} days"),
    ).fetchall()
    seen_fp: set[str] = set()
    per: dict[str, int] = {}
    out = []
    for row in rows:
        if row["fingerprint"] in seen_fp:
            continue
        if per_company and per.get(row["company_key"], 0) >= per_company:
            continue
        seen_fp.add(row["fingerprint"])
        per[row["company_key"]] = per.get(row["company_key"], 0) + 1
        out.append(row)
        if len(out) >= limit:
            break
    return out


def set_status(conn, n: int, status: str, detail: str = "", force: bool = False) -> bool:
    """Move a job to ``status``; refuses to go backwards unless ``force``."""
    row = conn.execute("SELECT status FROM jobs WHERE n = ?", (n,)).fetchone()
    if row is None:
        raise KeyError(n)
    current = row["status"]
    if not force and current == status:
        return False
    if not force and status in PROGRESS and current in PROGRESS and PROGRESS[status] < PROGRESS[current]:
        return False
    if not force and current in TERMINAL and status != "offer":
        return False
    ts = now()
    extra = ""
    params: list = [status, ts]
    if status == "applied":
        extra = ", applied_at = COALESCE(applied_at, ?)"
        params.append(ts)
    conn.execute(f"UPDATE jobs SET status = ?, status_at = ?{extra} WHERE n = ?", (*params, n))
    log(conn, n, f"status:{status}", detail or f"{current} -> {status}")
    return True


def log(conn, n: int | None, kind: str, detail: str = "") -> None:
    conn.execute("INSERT INTO events (job_n, at, kind, detail) VALUES (?, ?, ?, ?)", (n, now(), kind, detail))


def events(conn, n: int) -> list[sqlite3.Row]:
    return conn.execute("SELECT * FROM events WHERE job_n = ? ORDER BY id", (n,)).fetchall()


# -- funding -------------------------------------------------------------------

def add_funding(conn, f: Funding) -> bool:
    cur = conn.execute(
        """INSERT OR IGNORE INTO funding (url, company, company_key, round, amount, amount_usd_m,
                                          headline, published_at, source)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (f.url, f.company, company_key(f.company), f.round, f.amount, f.amount_usd_m, f.headline,
         f.published_at, f.source),
    )
    return cur.rowcount > 0


def recent_funding(conn, days: int = 60) -> list[sqlite3.Row]:
    return conn.execute(
        """SELECT * FROM funding WHERE published_at >= date('now', ?)
           ORDER BY published_at DESC""",
        (f"-{int(days)} days",),
    ).fetchall()


def breakdown(row) -> list:
    try:
        return json.loads(row["breakdown"] or "[]")
    except (TypeError, ValueError):
        return []
