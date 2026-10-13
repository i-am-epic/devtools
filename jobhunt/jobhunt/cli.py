"""Command line: python -m jobhunt <command>."""
from __future__ import annotations

import argparse
import shutil
import sys
import webbrowser
from datetime import date

from . import config, db, inbox, llm, materials, pipeline, prep, report
from .models import STATUSES
from .text import company_key, truncate


def _band(row) -> str:
    lo, hi = row["salary_min_lpa"], row["salary_max_lpa"]
    if not hi:
        return ""
    return f"{lo:.0f}-{hi:.0f}L" if lo and lo != hi else f"{hi:.0f}L"


def _print_rows(rows) -> None:
    if not rows:
        print("  (none)")
        return
    for r in rows:
        print(f"  #{r['n']:<5} {r['score'] or 0:>3.0f}  {truncate(r['company'], 22):<22} "
              f"{truncate(r['title'], 46):<46} {truncate(r['location'] or '', 24):<24} {_band(r):>8}  {r['status']}")


def _job_or_exit(conn, ref):
    row = db.job(conn, ref)
    if row is None:
        sys.exit(f"no job {ref}")
    return row


# -- commands ------------------------------------------------------------------

def cmd_init(args, conn, profile):
    target = config.profile_path()
    if not target.exists():
        shutil.copy(config.EXAMPLE_PROFILE, target)
        print(f"created {target} -- fill in email, phone, resume path, CTC and notice period")
    else:
        print(f"{target} already exists")
    print(f"loaded {pipeline.load_seed(conn)} seed companies into {config.home() / 'jobhunt.db'}")
    print("claude:", "available" if llm.available(profile) else f"off ({llm.why_disabled()})")
    print("next: python -m jobhunt discover")


def cmd_discover(args, conn, profile):
    print("discovering...")
    stats = pipeline.discover(conn, profile, only=args.only)
    print(f"\n{stats['seen']} postings seen, {stats['new']} new, {stats['eligible']} eligible")
    for src, n in sorted(stats["sources"].items(), key=lambda x: -x[1]):
        print(f"  {src:<16} {n}")
    if stats["errors"]:
        print(f"\n{len(stats['errors'])} source errors (first 10):")
        for err in stats["errors"][:10]:
            print("  ", truncate(err, 140))
    print("\ntop matches:")
    _print_rows(db.top_jobs(conn, limit=args.n, per_company=2))
    if not args.no_report:
        print(f"\ndashboard: {report.write(conn, profile)}")
    return stats


def cmd_funding(args, conn, profile):
    found = pipeline.load_funding(conn, profile)
    keys = [company_key(f.company) for f in found]
    pipeline.resolve_companies(conn, keys=keys)
    for f, key in sorted(zip(found, keys), key=lambda x: x[0].published_at or "", reverse=True):
        c = db.company(conn, key)
        board = f"{c['ats']}/{c['ats_slug']}" if c and c["ats"] else "-"
        print(f"  {f.published_at or '?':<10} {truncate(f.company, 24):<24} {truncate(f.round, 10):<10} "
              f"{truncate(f.amount, 12):<12} {truncate(board, 28):<28} {truncate(f.headline, 70)}")
    print("\nrun `discover` to pull open roles from the boards found above")


def cmd_companies(args, conn, profile):
    if args.action == "resolve":
        pipeline.load_seed(conn)
        pipeline.resolve_companies(conn, limit=args.limit, recheck_days=0 if args.force else 14)
    elif args.action == "add":
        if not args.name:
            sys.exit("companies add NAME [--domain d] [--ats a --slug s]")
        key = db.upsert_company(conn, args.name, domain=args.domain, tier=args.tier, ats=args.ats,
                                ats_slug=args.slug, source="manual")
        conn.commit()
        if not args.ats:
            pipeline.resolve_companies(conn, keys=[key])
        row = db.company(conn, key)
        print(f"{row['name']}: {row['ats'] or 'no board found'} {row['ats_slug'] or ''}")
    elif args.action == "add-url":
        parsed = materials.parse_board_url(args.name or "")
        if not parsed:
            sys.exit("unrecognised board URL (greenhouse, lever, ashby, workable, smartrecruiters, recruitee, workday)")
        ats_name, slug = parsed
        name = args.as_name or slug.split("/")[0].replace("-", " ").title()
        db.upsert_company(conn, name, ats=ats_name, ats_slug=slug, tier=args.tier, source="manual")
        conn.commit()
        print(f"added {name}: {ats_name}/{slug}")
    else:
        where = "ats IS NULL OR ats = ''" if args.missing else "1=1"
        rows = db.companies(conn, where)
        for c in rows:
            print(f"  {truncate(c['name'], 28):<28} {c['tier'] or '-':<2} {c['source'] or '':<8} "
                  f"{(c['ats'] or '-') + '/' + (c['ats_slug'] or ''):<40} {truncate(c['category'] or '', 24)}")
        print(f"{len(rows)} companies")


def cmd_top(args, conn, profile):
    statuses = tuple(STATUSES) if args.all else ("new", "shortlisted")
    rows = db.top_jobs(conn, limit=args.n, statuses=statuses, min_score=args.min_score,
                       per_company=args.per_company or None)
    _print_rows(rows)


def cmd_show(args, conn, profile):
    row = _job_or_exit(conn, args.job)
    print(f"#{row['n']} {row['title']} -- {row['company']}  [{row['status']}]")
    print(f"  {row['location']} · {row['source']} · posted {row['posted_at'] or '?'} · {_band(row) or 'pay not posted'}")
    print(f"  {row['url']}")
    if row["contact_email"]:
        print(f"  contact: {row['contact_email']}")
    print(f"\nfit {row['score']:.0f}/100 {'(eligible)' if row['eligible'] else '(INELIGIBLE)'}")
    for b in db.breakdown(row):
        print(f"  {b['part']:<10} {b['points']:+6.1f}  {b['why']}")
    events = db.events(conn, row["n"])
    if events:
        print("\ntimeline:")
        for ev in events:
            print(f"  {ev['at'][:16]}  {ev['kind']:<18} {truncate(ev['detail'] or '', 90)}")
    if args.full:
        print("\n" + (row["description"] or "(no description)"))


def cmd_kit(args, conn, profile):
    row = _job_or_exit(conn, args.job)
    path = materials.write_kit(conn, profile, row)
    print(f"kit written: {path}")
    for f in sorted(path.iterdir()):
        print(f"  {f.name}")


def cmd_campaign(args, conn, profile):
    per = int(profile.target.get("companies_per_campaign", 2))
    rows = db.top_jobs(conn, limit=args.n, statuses=("new", "shortlisted"), min_score=args.min_score,
                       per_company=per)
    if not rows:
        sys.exit("no eligible jobs -- run discover first")
    out = [f"# Application campaign -- {date.today():%d %b %Y}", "",
           f"{len(rows)} roles, best fit first, at most {per} per company. For each: referral notes out today,",
           "apply tomorrow (or as soon as the referral lands), mark it applied.", ""]
    for i, row in enumerate(rows, 1):
        path = materials.write_kit(conn, profile, row) if not args.no_kits else materials.kit_dir(row)
        db.set_status(conn, row["n"], "shortlisted", "campaign")
        out.append(f"{i}. [ ] **{row['company']}** -- {row['title']} (#{row['n']}, fit {row['score']:.0f}"
                   f"{', ' + _band(row) if _band(row) else ''})  ")
        out.append(f"   {row['location']} · [apply]({row['apply_url'] or row['url']}) · kit: `{path}`")
        print(f"  {i:>2}. #{row['n']:<5} {row['score']:>3.0f}  {truncate(row['company'], 22):<22} {truncate(row['title'], 50)}")
    conn.commit()
    path = config.out_dir() / "campaign.md"
    path.write_text("\n".join(out) + "\n")
    print(f"\ncampaign checklist: {path}")


def cmd_apply(args, conn, profile):
    row = _job_or_exit(conn, args.job)
    kit = materials.kit_dir(row)
    if not (kit / "cover_letter.md").exists():
        kit = materials.write_kit(conn, profile, row)
    print(f"{row['company']} -- {row['title']}\n  kit: {kit}")
    url = row["apply_url"] or row["url"]
    if row["source"] == "hn" and row["contact_email"]:
        print(f"  HN post: email {row['contact_email']} (cold email template in referral.md)")
    submitted = False
    if args.assist:
        from . import autofill
        answers = materials.application_answers(profile, row, materials.about_company(conn, row))
        letter = (kit / "cover_letter.md").read_text()
        submitted = autofill.assist(url, profile, answers, letter, kit, headless=args.headless)
        if submitted:
            print("  submission detected")
    elif not args.yes:
        webbrowser.open(url)
        print(f"  opened {url}")
    if submitted or args.yes or (sys.stdin.isatty() and input("  submitted? [y/N] ").strip().lower() == "y"):
        db.set_status(conn, row["n"], "applied", "applied" + (" (assisted)" if args.assist else ""))
        conn.commit()
        print("  marked applied")


def cmd_refer(args, conn, profile):
    row = _job_or_exit(conn, args.job)
    print(f"Referral plan -- {row['company']} ({row['title']})\n")
    for label, url in materials.referral_links(profile, row["company"]).items():
        print(f"  {label}\n    {url}")
    msgs = materials.referral_messages(profile, row)
    print("\n" + "-" * 70)
    for label, text in list(msgs.items())[:2]:
        print(f"{label}:\n{text}\n" + "-" * 70)
    print(f"all variants: {materials.kit_dir(row) / 'referral.md'} (run `kit {row['n']}` if missing)")
    if args.asked:
        db.set_status(conn, row["n"], "referral_asked", args.asked)
        conn.commit()
        print(f"marked referral_asked ({args.asked})")


def cmd_mark(args, conn, profile):
    row = _job_or_exit(conn, args.job)
    if args.followed_up:
        db.log(conn, row["n"], "followup", args.note or "")
        conn.commit()
        print("follow-up logged")
        return
    if not args.status:
        sys.exit(f"status is one of: {', '.join(STATUSES)}")
    changed = db.set_status(conn, row["n"], args.status, args.note or "", force=args.force)
    if args.note and not changed:
        db.log(conn, row["n"], "note", args.note)
    conn.commit()
    print(f"#{row['n']} -> {args.status}" if changed else f"#{row['n']} stays {row['status']} (use --force)")
    if args.status == "interview" and changed:
        print(f"prep plan: {prep.write_plan(conn, profile, db.job(conn, row['n']))}")


def _write_prep(conn, profile):
    return lambda row: prep.write_plan(conn, profile, db.job(conn, row["n"]))


def cmd_inbox(args, conn, profile):
    mails = inbox.fetch(profile, args.days)
    results = inbox.process(conn, profile, mails, dry_run=args.dry_run, prep_writer=_write_prep(conn, profile))
    print(f"scanned {len(mails)} messages, {len(results)} relevant")
    for r in results:
        job = r["job"]
        where = f"#{job['n']} {job['company']}" if job is not None else "unmatched"
        extra = f" -> prep plan {r['prep']}" if r.get("prep") else ""
        print(f"  [{r['label']:<18}] {truncate(where, 30):<30} {truncate(r['mail'].subject, 70)}{extra}")
    return results


def cmd_prep(args, conn, profile):
    row = _job_or_exit(conn, args.job)
    when = date.fromisoformat(args.date) if args.date else None
    print(f"prep plan: {prep.write_plan(conn, profile, row, when)}")


def cmd_followups(args, conn, profile):
    fu = inbox.followups(conn)
    print("due:")
    for row, age, action in fu["due"]:
        print(f"  #{row['n']:<5} {truncate(row['company'], 24):<24} {age:>3}d  {action}")
    print("probably ghosted (mark them so the stats stay honest):")
    for row, age in fu["ghosted"]:
        print(f"  #{row['n']:<5} {truncate(row['company'], 24):<24} {age:>3}d")


def cmd_report(args, conn, profile):
    path = report.write(conn, profile)
    print(path)
    if args.open:
        webbrowser.open(path.as_uri())


def cmd_links(args, conn, profile):
    for group, links in materials.platform_links(profile).items():
        print(f"\n{group}")
        for label, url in links:
            print(f"  {label}\n    {url}")


def cmd_daily(args, conn, profile):
    stats = None
    if not args.skip_discover:
        stats = cmd_discover(argparse.Namespace(only=None, n=15, no_report=True), conn, profile)
    results = None
    if not args.skip_inbox:
        try:
            results = cmd_inbox(argparse.Namespace(days=None, dry_run=False), conn, profile)
        except Exception as exc:
            print(f"inbox skipped: {exc}")
    path = report.write(conn, profile)
    body = report.digest(conn, profile, stats, results)
    print("\n" + body + f"\n\ndashboard: {path}")
    if args.email:
        from .notify import send_digest
        print(f"digest sent to {send_digest(profile, body)}")


def cmd_rescore(args, conn, profile):
    print(f"rescored {pipeline.rescore(conn, profile)} jobs")


def cmd_stats(args, conn, profile):
    for k, v in report.stats(conn, profile).items():
        print(f"  {k:<16} {v:.0f}" if isinstance(v, float) else f"  {k:<16} {v}")


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="jobhunt", description="Find, rank, apply to and track roles.")
    sub = p.add_subparsers(dest="cmd", required=True)

    sub.add_parser("init", help="create profile.toml and the database")

    s = sub.add_parser("discover", help="pull jobs from every enabled source and score them")
    s.add_argument("--only", nargs="*", help="limit to sources, e.g. ats hn remotive")
    s.add_argument("-n", type=int, default=25)
    s.add_argument("--no-report", action="store_true")

    sub.add_parser("funding", help="scan funding news, add companies, find their job boards")

    s = sub.add_parser("companies", help="list / resolve / add companies")
    s.add_argument("action", nargs="?", default="list", choices=["list", "resolve", "add", "add-url"])
    s.add_argument("name", nargs="?", help="company name, or board URL for add-url")
    s.add_argument("--domain")
    s.add_argument("--tier", choices=["A", "B", "C"])
    s.add_argument("--ats")
    s.add_argument("--slug")
    s.add_argument("--as", dest="as_name", help="display name for add-url")
    s.add_argument("--missing", action="store_true", help="list companies without a board")
    s.add_argument("--limit", type=int, default=300)
    s.add_argument("--force", action="store_true", help="re-probe recently checked companies")

    s = sub.add_parser("top", help="best eligible open jobs")
    s.add_argument("-n", type=int, default=30)
    s.add_argument("--min-score", type=float, default=0)
    s.add_argument("--per-company", type=int, default=0)
    s.add_argument("--all", action="store_true", help="include every status")

    s = sub.add_parser("show", help="job details and why it scored that way")
    s.add_argument("job")
    s.add_argument("--full", action="store_true")

    s = sub.add_parser("kit", help="write cover letter, referral notes and form answers")
    s.add_argument("job")

    s = sub.add_parser("campaign", help="shortlist the best N roles and write a kit for each")
    s.add_argument("-n", type=int, default=50)
    s.add_argument("--min-score", type=float, default=55)
    s.add_argument("--no-kits", action="store_true")

    s = sub.add_parser("apply", help="open (or auto-fill) the application and mark it applied")
    s.add_argument("job")
    s.add_argument("--assist", action="store_true", help="fill the form in a browser (Playwright)")
    s.add_argument("--headless", action="store_true")
    s.add_argument("--yes", action="store_true", help="just mark applied")

    s = sub.add_parser("refer", help="who to ask for a referral, and what to say")
    s.add_argument("job")
    s.add_argument("--asked", metavar="WHO", help="record that you asked WHO")

    s = sub.add_parser("mark", help="set a job's status")
    s.add_argument("job")
    s.add_argument("status", nargs="?", choices=STATUSES)
    s.add_argument("--note")
    s.add_argument("--force", action="store_true")
    s.add_argument("--followed-up", action="store_true", help="log that you sent a follow-up")

    s = sub.add_parser("inbox", help="scan email for replies and update statuses")
    s.add_argument("--days", type=int)
    s.add_argument("--dry-run", action="store_true")

    s = sub.add_parser("prep", help="write an interview prep plan")
    s.add_argument("job")
    s.add_argument("--date", help="interview date YYYY-MM-DD")

    sub.add_parser("followups", help="who to nudge, who ghosted")

    s = sub.add_parser("report", help="write the HTML dashboard")
    s.add_argument("--open", action="store_true")

    sub.add_parser("links", help="search links for platforms jobhunt doesn't poll")

    s = sub.add_parser("daily", help="discover + inbox + dashboard + digest")
    s.add_argument("--email", action="store_true", help="email the digest to yourself")
    s.add_argument("--skip-discover", action="store_true")
    s.add_argument("--skip-inbox", action="store_true")

    sub.add_parser("rescore", help="re-score every job after editing profile.toml")
    sub.add_parser("stats", help="pipeline numbers")
    return p


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    profile = config.load_profile()
    conn = db.connect()
    try:
        globals()[f"cmd_{args.cmd.replace('-', '_')}"](args, conn, profile)
    except KeyboardInterrupt:
        return 130
    finally:
        conn.close()
    return 0
