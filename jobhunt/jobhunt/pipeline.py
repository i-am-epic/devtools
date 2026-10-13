"""Discovery pipeline: companies -> boards -> jobs -> scores."""
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date, datetime, timedelta, timezone

from . import db, http
from .comp import salary_from_description
from .config import Profile
from .models import Job
from .scoring import score_job, score_location, score_title, Score
from .sources import ats, boards, companies, funding, hn
from .text import company_key


def _log(msg: str) -> None:
    print(msg, flush=True)


def load_seed(conn) -> int:
    count = 0
    for c in companies.seed_companies():
        db.upsert_company(
            conn, c["name"], domain=c.get("domain"), tier=c.get("tier"), category=c.get("category"),
            why=c.get("why"), careers_url=c.get("careers"), source="seed",
            ats=c.get("ats"), ats_slug=c.get("slug"),
        )
        count += 1
    conn.commit()
    return count


def load_yc(conn, log=_log) -> int:
    try:
        found = companies.yc_hiring()
    except http.HTTPError as exc:
        log(f"  yc: failed ({exc})")
        return 0
    for c in found:
        db.upsert_company(conn, c["name"], domain=c["domain"], about=c["about"], category=c["category"],
                          careers_url=c["careers_url"], source="yc")
    conn.commit()
    log(f"  yc: {len(found)} hiring companies in India/remote")
    return len(found)


def load_funding(conn, profile: Profile, log=_log) -> list:
    cfg = profile.funding
    found = funding.scan(cfg.get("queries", []), cfg.get("feeds", []), int(cfg.get("days", 45)))
    fresh = 0
    for f in found:
        if db.add_funding(conn, f):
            fresh += 1
        db.upsert_company(conn, f.company, source="funding", funding_round=f.round, funding_amount=f.amount,
                          funding_date=f.published_at, funding_url=f.url)
    conn.commit()
    log(f"  funding: {len(found)} funded companies in the news ({fresh} new)")
    return found


def resolve_companies(conn, limit: int = 200, recheck_days: int = 14, log=_log, keys: list[str] | None = None) -> int:
    """Probe job boards for companies we don't have an ATS for yet."""
    cutoff = (datetime.now(timezone.utc) - timedelta(days=recheck_days)).isoformat()
    if keys:
        rows = [db.company(conn, k) for k in keys]
        rows = [r for r in rows if r is not None]
    else:
        rows = conn.execute(
            """SELECT * FROM companies
               WHERE (ats IS NULL OR ats = '') AND (ats_checked_at IS NULL OR ats_checked_at < ?)
               ORDER BY CASE source WHEN 'seed' THEN 0 WHEN 'funding' THEN 1 ELSE 2 END, name
               LIMIT ?""",
            (cutoff, limit),
        ).fetchall()
    if not rows:
        return 0
    log(f"  resolving job boards for {len(rows)} companies...")
    found = 0
    with ThreadPoolExecutor(max_workers=8) as pool:
        futures = {pool.submit(ats.resolve, r["name"], r["domain"], (r["ats"], r["ats_slug"])): r for r in rows}
        for fut in as_completed(futures):
            row = futures[fut]
            try:
                result = fut.result()
            except Exception as exc:  # one bad company must not stop the run
                log(f"    {row['name']}: {exc}")
                result = None
            fields = {"ats_checked_at": db.now()}
            if result:
                fields["ats"], fields["ats_slug"] = result
                found += 1
            conn.execute(
                f"UPDATE companies SET {', '.join(f'{k} = ?' for k in fields)} WHERE key = ?",
                [*fields.values(), row["key"]],
            )
    conn.commit()
    log(f"  resolved {found}/{len(rows)}")
    return found


def _fetch_company(row, fx) -> tuple[list[Job], str | None]:
    fetcher = ats.FETCHERS.get(row["ats"])
    if not fetcher:
        return [], None
    try:
        return fetcher(row["ats_slug"], row["name"], fx), None
    except http.NotFound:
        return [], "board gone (404)"
    except Exception as exc:
        return [], str(exc)


def _quick_ok(job: Job, profile: Profile) -> bool:
    s = Score()
    score_title(job.title, profile, s)
    if s.eligible:
        score_location({"location": job.location, "remote": job.remote, "description": job.description}, profile, s)
    return s.eligible


def discover(conn, profile: Profile, only: list[str] | None = None, log=_log) -> dict:
    """Run every enabled source and score what comes back."""
    run_start = db.now()
    fx = profile.fx
    stats: dict = {"sources": {}, "errors": [], "new": 0, "seen": 0}

    def enabled(name: str) -> bool:
        return (only is None or name in only) and profile.source_enabled(name)

    load_seed(conn)
    if enabled("yc"):
        load_yc(conn, log)
    if enabled("funding"):
        try:
            load_funding(conn, profile, log)
        except Exception as exc:
            stats["errors"].append(f"funding: {exc}")
    if enabled("ats"):
        resolve_companies(conn, log=log)

    collected: list[Job] = []
    fetched_ok: set[tuple[str, str]] = set()  # (source, company_key) pairs that answered

    if enabled("ats"):
        rows = conn.execute("SELECT * FROM companies WHERE ats IS NOT NULL AND ats != ''").fetchall()
        log(f"  fetching {len(rows)} company boards...")
        with ThreadPoolExecutor(max_workers=8) as pool:
            for row, (jobs, err) in zip(rows, pool.map(lambda r: _fetch_company(r, fx), rows)):
                if err:
                    stats["errors"].append(f"{row['name']} ({row['ats']}/{row['ats_slug']}): {err}")
                    continue
                fetched_ok.add((row["ats"], row["key"]))
                stats["sources"][row["ats"]] = stats["sources"].get(row["ats"], 0) + len(jobs)
                collected.extend(jobs)

    for name, fn in boards.BOARDS.items():
        if not enabled(name):
            continue
        try:
            jobs = fn(fx)
        except Exception as exc:
            stats["errors"].append(f"{name}: {exc}")
            continue
        stats["sources"][name] = len(jobs)
        for key in {company_key(j.company) for j in jobs}:
            fetched_ok.add((name, key))
        collected.extend(jobs)
        log(f"  {name}: {len(jobs)} jobs")

    if enabled("hn"):
        try:
            jobs = hn.who_is_hiring(fx)
            stats["sources"]["hn"] = len(jobs)
            collected.extend(jobs)
            log(f"  hn who's hiring: {len(jobs)} posts")
        except Exception as exc:
            stats["errors"].append(f"hn: {exc}")

    # Fetch descriptions only for jobs that pass the cheap title/location filter.
    needs_detail = [j for j in collected if j.detail_ref and not j.description and _quick_ok(j, profile)]
    if needs_detail:
        log(f"  fetching {min(len(needs_detail), 200)} job descriptions...")

        def detail(job: Job):
            try:
                ats.DETAILS[job.ats](job)
            except Exception:
                pass

        with ThreadPoolExecutor(max_workers=6) as pool:
            list(pool.map(detail, needs_detail[:200]))

    for job in collected:
        if not job.title or not job.company:
            continue
        if job.salary_max_lpa is None and job.description:
            job.salary_min_lpa, job.salary_max_lpa = salary_from_description(job.description, fx)
        n, is_new = db.upsert_job(conn, job)
        stats["seen"] += 1
        stats["new"] += int(is_new)
    conn.commit()

    # Postings that vanished from a board that answered are closed.
    seen_ids = {job.id for job in collected}
    for source, key in fetched_ok:
        for row in conn.execute("""SELECT n, id FROM jobs WHERE source = ? AND company_key = ?
                                   AND status IN ('new', 'shortlisted')""", (source, key)).fetchall():
            if row["id"] not in seen_ids:
                db.set_status(conn, row["n"], "closed", "posting no longer listed", force=True)
    conn.commit()
    stats["scored"] = rescore(conn, profile, where="last_seen >= ?", params=(run_start,))
    stats["eligible"] = conn.execute(
        "SELECT COUNT(*) FROM jobs WHERE eligible = 1 AND last_seen >= ?", (run_start,)).fetchone()[0]
    return stats


def _funding_for(company: dict | None) -> dict | None:
    if not company or not company.get("funding_date"):
        return None
    try:
        age = (date.today() - date.fromisoformat(company["funding_date"][:10])).days
    except ValueError:
        return None
    if age > 180:
        return None
    return {"round": company.get("funding_round"), "amount": company.get("funding_amount"),
            "published_at": company.get("funding_date")}


def rescore(conn, profile: Profile, where: str = "1=1", params: tuple = ()) -> int:
    comp_cache: dict[str, dict | None] = {}
    count = 0
    for row in db.jobs(conn, where, params, order="n"):
        key = row["company_key"]
        if key not in comp_cache:
            c = db.company(conn, key)
            comp_cache[key] = dict(c) if c else None
        company = comp_cache[key]
        s = score_job(dict(row), profile, company, _funding_for(company))
        db.set_score(conn, row["n"], s.total, s.eligible, s.as_list())
        count += 1
    conn.commit()
    return count
