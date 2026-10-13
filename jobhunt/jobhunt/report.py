"""Static HTML dashboard and the plain-text daily digest."""
from __future__ import annotations

import html
from datetime import date
from pathlib import Path

from . import config, db
from .config import Profile
from .inbox import followups
from .materials import kit_dir, platform_links

e = html.escape

CSS = """
:root { --bg:#f7f7f5; --card:#fff; --ink:#1d1d1f; --muted:#6b6b70; --line:#e4e4e0; --accent:#2f6fde;
        --good:#1f8a4c; --warn:#b26b00; --bad:#c23b3b; --chip:#eef2fb; }
@media (prefers-color-scheme: dark) { :root { --bg:#141416; --card:#1d1d20; --ink:#ececee; --muted:#9a9aa2;
        --line:#2c2c31; --accent:#7aa5ff; --good:#4cc283; --warn:#e3a33a; --bad:#ff7a7a; --chip:#232a3a; } }
* { box-sizing:border-box; }
body { margin:0; background:var(--bg); color:var(--ink); font:14px/1.45 system-ui,-apple-system,Segoe UI,sans-serif; }
main { max-width:1200px; margin:0 auto; padding:24px 16px 64px; }
h1 { font-size:22px; margin:0 0 4px; } h2 { font-size:16px; margin:32px 0 10px; }
.muted { color:var(--muted); } a { color:var(--accent); text-decoration:none; } a:hover { text-decoration:underline; }
.kpis { display:grid; grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); gap:10px; margin-top:16px; }
.kpi { background:var(--card); border:1px solid var(--line); border-radius:10px; padding:12px 14px; }
.kpi b { display:block; font-size:22px; } .bar { height:6px; background:var(--line); border-radius:3px; margin-top:6px; }
.bar i { display:block; height:100%; background:var(--accent); border-radius:3px; }
.table { width:100%; border-collapse:collapse; background:var(--card); border:1px solid var(--line); border-radius:10px;
         overflow:hidden; } .table th, .table td { text-align:left; padding:8px 10px; border-top:1px solid var(--line);
         vertical-align:top; } .table th { border-top:0; font-weight:600; color:var(--muted); font-size:12px; }
.wrap { overflow-x:auto; } .wrap .table { min-width:760px; } .nowrap { white-space:nowrap; }
.score { font-weight:700; } .s-hi { color:var(--good); } .s-mid { color:var(--warn); } .s-lo { color:var(--bad); }
.chip { display:inline-block; padding:1px 8px; border-radius:999px; background:var(--chip); font-size:12px; margin:1px 2px 1px 0; }
.cols { display:grid; grid-template-columns:repeat(auto-fit,minmax(210px,1fr)); gap:10px; }
.col { background:var(--card); border:1px solid var(--line); border-radius:10px; padding:10px; }
.col h3 { margin:0 0 8px; font-size:13px; color:var(--muted); text-transform:uppercase; letter-spacing:.04em; }
.card { border-top:1px solid var(--line); padding:6px 0; } .card:first-of-type { border-top:0; }
ul.links { columns:2 300px; padding-left:18px; }
"""


def _score_class(score: float) -> str:
    return "s-hi" if score >= 70 else "s-mid" if score >= 50 else "s-lo"


def _why(row, n: int = 2) -> str:
    items = [b for b in db.breakdown(row) if b["points"] > 0 and b["part"] != "gaps"]
    items.sort(key=lambda b: -b["points"])
    return "; ".join(b["why"] for b in items[:n])


def _band(row) -> str:
    lo, hi = row["salary_min_lpa"], row["salary_max_lpa"]
    if hi:
        return f"{lo:.0f}-{hi:.0f} LPA" if lo and lo != hi else f"{hi:.0f} LPA"
    return ""


def stats(conn, profile: Profile) -> dict:
    count = lambda where, *p: conn.execute(f"SELECT COUNT(*) FROM jobs WHERE {where}", p).fetchone()[0]
    applied = count("applied_at IS NOT NULL")
    replied = conn.execute("""SELECT COUNT(DISTINCT job_n) FROM emails
                              WHERE job_n IS NOT NULL AND classification != 'ack'""").fetchone()[0]
    return {
        "applied": applied,
        "goal": int(profile.target.get("application_goal", 50)),
        "active": count("status IN ('applied', 'assessment', 'interview', 'referral_asked')"),
        "interviews": count("status IN ('interview', 'offer')"),
        "offers": count("status = 'offer'"),
        "rejected": count("status = 'rejected'"),
        "replied": replied,
        "response_rate": (replied / applied * 100) if applied else 0,
        "new_week": count("eligible = 1 AND first_seen >= datetime('now', '-7 days')"),
        "eligible_open": count("eligible = 1 AND status IN ('new', 'shortlisted')"),
    }


def build(conn, profile: Profile) -> str:
    s = stats(conn, profile)
    top = db.top_jobs(conn, limit=40, per_company=int(profile.target.get("companies_per_campaign", 2)))
    pipeline = {st: db.jobs(conn, "status = ?", (st,), order="status_at DESC")
                for st in ("referral_asked", "applied", "assessment", "interview", "offer")}
    fu = followups(conn)
    replies = conn.execute("""SELECT emails.*, jobs.company, jobs.title, jobs.n FROM emails
                              LEFT JOIN jobs ON jobs.n = emails.job_n
                              ORDER BY received_at DESC LIMIT 40""").fetchall()
    funded = db.recent_funding(conn, days=int(profile.funding.get("days", 45)) + 15)

    out = [f"<!doctype html><html lang=en><head><meta charset=utf-8>"
           f"<meta name=viewport content='width=device-width,initial-scale=1'><title>Job hunt</title>"
           f"<style>{CSS}</style></head><body><main>",
           f"<h1>Job hunt</h1><div class=muted>{date.today():%A %d %B %Y} · {e(profile.name)} · "
           f"floor {profile.min_lpa:g} LPA · Bengaluru or remote</div>"]
    pct = min(100, s["applied"] / max(1, s["goal"]) * 100)
    out.append("<div class=kpis>"
               f"<div class=kpi>Applied<b>{s['applied']} / {s['goal']}</b><div class=bar><i style='width:{pct:.0f}%'></i></div></div>"
               f"<div class=kpi>In flight<b>{s['active']}</b></div>"
               f"<div class=kpi>Interviews<b>{s['interviews']}</b></div>"
               f"<div class=kpi>Offers<b>{s['offers']}</b></div>"
               f"<div class=kpi>Response rate<b>{s['response_rate']:.0f}%</b></div>"
               f"<div class=kpi>New matches (7d)<b>{s['new_week']}</b></div>"
               "</div>")

    out.append("<h2>Next up -- best open matches</h2><div class=wrap><table class=table><tr>"
               "<th>#</th><th>Fit</th><th>Company / role</th><th>Where</th><th>Pay</th><th>Why</th><th></th></tr>")
    for row in top:
        kit = kit_dir(row)
        kit_link = f"<a href='{e(kit.as_uri())}/README.md'>kit</a> · " if kit.exists() else ""
        out.append(
            f"<tr><td>{row['n']}</td><td class='score {_score_class(row['score'])}'>{row['score']:.0f}</td>"
            f"<td><b>{e(row['company'])}</b><br>{e(row['title'])}<br><span class=muted>{e(row['source'])}"
            f"{' · ' + e(row['posted_at']) if row['posted_at'] else ''}</span></td>"
            f"<td>{e((row['location'] or '')[:60])}</td><td class=nowrap>{e(_band(row))}</td><td class=muted>{e(_why(row))}</td>"
            f"<td>{kit_link}<a href='{e(row['apply_url'] or row['url'])}'>apply</a></td></tr>")
    if not top:
        out.append("<tr><td colspan=7 class=muted>Nothing yet -- run <code>python -m jobhunt discover</code>.</td></tr>")
    out.append("</table></div>")

    out.append("<h2>Pipeline</h2><div class=cols>")
    for status, rows in pipeline.items():
        out.append(f"<div class=col><h3>{status.replace('_', ' ')} · {len(rows)}</h3>")
        for row in rows[:25]:
            out.append(f"<div class=card><b>{e(row['company'])}</b> <span class=muted>#{row['n']}</span><br>"
                       f"{e(row['title'])}<br><span class=muted>{(row['status_at'] or '')[:10]}</span></div>")
        out.append("</div>")
    out.append("</div>")

    if fu["due"] or fu["ghosted"]:
        out.append("<h2>Follow-ups</h2><div class=wrap><table class=table><tr><th>#</th><th>Company / role</th>"
                   "<th>Days</th><th>Action</th></tr>")
        for row, age, action in fu["due"]:
            out.append(f"<tr><td>{row['n']}</td><td><b>{e(row['company'])}</b> {e(row['title'])}</td><td>{age}</td>"
                       f"<td>{e(action)} (message in referral.md), then <code>jobhunt mark {row['n']} --followed-up</code></td></tr>")
        for row, age in fu["ghosted"]:
            out.append(f"<tr><td>{row['n']}</td><td><b>{e(row['company'])}</b> {e(row['title'])}</td><td>{age}</td>"
                       f"<td class=muted>no reply in 4 weeks -- <code>jobhunt mark {row['n']} ghosted</code></td></tr>")
        out.append("</table></div>")

    out.append("<h2>Replies and inbound</h2><div class=wrap><table class=table><tr><th>When</th><th>Type</th>"
               "<th>From / subject</th><th>Job</th></tr>")
    for r in replies:
        job = f"#{r['n']} {e(r['company'])}" if r["n"] else "<span class=muted>unmatched</span>"
        out.append(f"<tr><td>{(r['received_at'] or '')[:10]}</td><td><span class=chip>{e(r['classification'])}</span></td>"
                   f"<td>{e(r['sender'])}<br><span class=muted>{e(r['subject'])}</span></td><td>{job}</td></tr>")
    if not replies:
        out.append("<tr><td colspan=4 class=muted>No replies tracked yet -- <code>python -m jobhunt inbox</code>.</td></tr>")
    out.append("</table></div>")

    out.append("<h2>Recently funded</h2><div class=wrap><table class=table><tr><th>Date</th><th>Company</th>"
               "<th>Round</th><th>Board</th><th>Open matches</th><th>Headline</th></tr>")
    for f in funded[:60]:
        c = db.company(conn, f["company_key"])
        board = f"{c['ats']}/{c['ats_slug']}" if c and c["ats"] else "<span class=muted>not found</span>"
        matches = conn.execute("SELECT COUNT(*) FROM jobs WHERE company_key = ? AND eligible = 1 AND status = 'new'",
                               (f["company_key"],)).fetchone()[0]
        out.append(f"<tr><td>{f['published_at'] or ''}</td><td><b>{e(f['company'])}</b></td>"
                   f"<td>{e(f['round'] or '')} {e(f['amount'] or '')}</td><td>{board}</td><td>{matches or ''}</td>"
                   f"<td><a href='{e(f['url'])}'>{e(f['headline'][:110])}</a></td></tr>")
    if not funded:
        out.append("<tr><td colspan=6 class=muted>Run <code>python -m jobhunt funding</code>.</td></tr>")
    out.append("</table></div>")

    manual = db.companies(conn, "careers_url IS NOT NULL AND careers_url != '' AND (ats IS NULL OR ats = '')")
    if manual:
        out.append("<h2>Check by hand -- in-house careers sites</h2><ul class=links>")
        out += [f"<li><a href='{e(c['careers_url'])}'>{e(c['name'])}</a> <span class=muted>"
                f"{e(c['tier'] or '')}</span></li>" for c in manual]
        out.append("</ul>")

    out.append("<h2>Search elsewhere</h2>")
    for group, links in platform_links(profile).items():
        out.append(f"<h3 class=muted style='font-size:13px'>{e(group)}</h3><ul class=links>")
        out += [f"<li><a href='{e(url)}'>{e(label)}</a></li>" for label, url in links]
        out.append("</ul>")
    out.append("</main></body></html>")
    return "\n".join(out)


def write(conn, profile: Profile) -> Path:
    path = config.out_dir() / "dashboard.html"
    path.write_text(build(conn, profile))
    return path


def digest(conn, profile: Profile, discover_stats: dict | None = None, inbox_results: list | None = None) -> str:
    s = stats(conn, profile)
    lines = [f"Job hunt digest -- {date.today():%a %d %b}", "",
             f"Applied {s['applied']}/{s['goal']} · in flight {s['active']} · interviews {s['interviews']} · "
             f"offers {s['offers']} · response rate {s['response_rate']:.0f}%", ""]
    if inbox_results:
        lines.append("Replies:")
        for r in inbox_results:
            job = r["job"]
            where = f"#{job['n']} {job['company']}" if job is not None else "unmatched"
            lines.append(f"  [{r['label']}] {where}: {r['mail'].subject}")
        lines.append("")
    if discover_stats:
        lines.append(f"Discovered {discover_stats.get('new', 0)} new postings "
                     f"({discover_stats.get('eligible', 0)} eligible this run).")
    top = db.top_jobs(conn, limit=10, statuses=("new",), per_company=1)
    if top:
        lines += ["", "Top new matches:"]
        lines += [f"  #{r['n']:<5} {r['score']:>3.0f}  {r['company']} -- {r['title']} ({(r['location'] or '')[:40]})"
                  for r in top]
    fu = followups(conn)
    if fu["due"]:
        lines += ["", "Follow-ups due:"]
        lines += [f"  #{r['n']} {r['company']} ({age}d): {action}" for r, age, action in fu["due"]]
    return "\n".join(lines)
