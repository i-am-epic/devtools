"""Application kits: cover letter, referral outreach, form answers, links.

Templates are grounded strictly in profile.toml. When Claude is available the
cover letter and "why us" answer are tailored by it, under the same rule:
nothing that isn't in the profile or the posting.
"""
from __future__ import annotations

import json
import re
import urllib.parse
from pathlib import Path

from . import config, db, llm
from .config import Profile
from .text import join_and, keyword_in, pretty, slugify, truncate

Q = urllib.parse.quote_plus


# -- picking what to say -------------------------------------------------------

def pick_highlights(profile: Profile, jd_text: str, n: int = 3) -> list[str]:
    jd = (jd_text or "").lower()
    weights = profile.skill_weights()
    scored = []
    for i, h in enumerate(profile.highlights):
        tags = h.get("tags", [])
        score = sum(weights.get(t, 1) for t in tags if keyword_in(jd, t))
        scored.append((score, -i, h["text"]))
    scored.sort(reverse=True)
    return [text for _, _, text in scored[:n]]


_GENERIC = {"backend", "rest", "sql", "microservices"}


def matched_skills(row, display: bool = False) -> list[str]:
    """Profile skills the posting mentions, most important first."""
    for item in db.breakdown(row):
        if item.get("part") == "skills" and ":" in item.get("why", ""):
            words = [w.strip() for w in item["why"].split(":", 1)[1].split(",")]
            words = [w for w in words if w and w != "none"]
            if display:
                words = [pretty(w) for w in words if w not in _GENERIC]
            return words
    return []


def gaps(row) -> list[str]:
    for item in db.breakdown(row):
        if item.get("part") == "gaps":
            return [g.strip() for g in item["why"].split(",") if g.strip()]
    return []


def about_company(conn, row) -> str:
    """A third-person description of the company, safe to quote back to them.

    The seed list's ``why`` is a note to you ("streaming is your core strength")
    and never goes into anything the company reads.
    """
    c = db.company(conn, row["company_key"])
    if c and c["about"]:
        return c["about"]
    # First sentence of the posting that describes the company.
    text = row["description"] or ""
    name = re.escape(row["company"].split()[0])
    m = re.search(rf"({name}[^.\n]{{0,40}}\b(?:is|builds|helps|provides|powers|makes|enables)\b[^.\n]{{10,240}}\.)",
                  text, re.I)
    return m.group(1).strip() if m else ""


# -- cover letter --------------------------------------------------------------

def cover_letter_template(profile: Profile, row, about: str) -> str:
    me = profile.me
    skills = join_and(matched_skills(row, display=True)[:3])
    picks = pick_highlights(profile, f"{row['title']}\n{row['description']}")
    missing = [pretty(g) for g in gaps(row)[:2]]
    city = re.split(r"[,;|(]", row["location"] or "")[0].strip()
    where = f" in {city}" if city and len(city) < 30 and "remote" not in city.lower() else ""
    lines = [
        f"Dear {row['company']} hiring team,",
        "",
        f"I'm applying for the {row['title']} role{where}. I'm a {me.get('current_title', 'software engineer').lower()} "
        f"at {me.get('current_company', '')} with about {me.get('years_experience', '')} years of experience. "
        f"{me.get('pitch', '')}",
        "",
    ]
    focus = f"The role's emphasis on {skills} is exactly the work I do every day." if skills else ""
    if about:
        lines.append(f"What draws me to {row['company']}: {about.rstrip('.')}. {focus}".strip())
    elif focus:
        lines.append(focus)
    lines += ["", "Some of that work:"]
    lines += [f"- {p}" for p in picks]
    if missing:
        lines += ["", f"I haven't used {' or '.join(missing)} in production yet and would ramp up on it quickly."]
    lines += [
        "", f"I'd welcome a conversation about how I could contribute to {row['company']}.", "",
        "Best regards,", profile.name,
        " · ".join(x for x in (me.get("phone"), me.get("email"), me.get("linkedin"), me.get("github")) if x),
    ]
    return "\n".join(lines)


def cover_letter(profile: Profile, row, about: str) -> tuple[str, str]:
    """Returns (text, author) where author is 'claude' or 'template'."""
    prompt = f"""Write a cover letter for this application.

Constraints: 170-230 words. No greeting clichés ("I am excited to apply"), no flattery, no
claims that are not in the profile below. Lead with the two or three pieces of the
candidate's work most relevant to this posting, with their real numbers. If the posting
asks for something the candidate lacks, acknowledge it in one honest clause. End with
the candidate's name and contact line exactly as given. Output only the letter.

<candidate>
{json.dumps({"me": profile.me, "highlights": [h["text"] for h in profile.highlights]}, indent=1)}
</candidate>

<company>{row['company']}: {about or 'no extra information'}</company>

<posting title="{row['title']}" location="{row['location']}">
{truncate(row['description'] or '', 7000)}
</posting>"""
    text = llm.complete(profile, prompt, max_tokens=2000)
    if text:
        return text, "claude"
    return cover_letter_template(profile, row, about), "template"


# -- referral outreach ---------------------------------------------------------

def referral_links(profile: Profile, company: str) -> dict[str, str]:
    me = profile.me
    college = me.get("college", "")
    li = "https://www.linkedin.com/search/results/people/?keywords="
    g = "https://www.google.com/search?q="
    return {
        "Engineers at company (LinkedIn)": li + Q(f'"{company}" software engineer Bengaluru'),
        f"{me.get('college_short', 'College')} alumni at company (LinkedIn)": li + Q(f'"{company}" "{college}"'),
        f"Ex-{me.get('current_company', 'colleagues')} people at company (LinkedIn)": li + Q(
            f'"{company}" "{me.get("current_company", "")}"'),
        "Recruiters at company (LinkedIn)": li + Q(f'"{company}" technical recruiter India'),
        "Google X-ray: engineers": g + Q(
            f'site:linkedin.com/in "{company}" ("software engineer" OR "backend") ("Bengaluru" OR "Bangalore")'),
        "Google X-ray: alumni": g + Q(f'site:linkedin.com/in "{company}" "{college}"'),
        "Interview experiences": g + Q(f'"{company}" software engineer interview experience '
                                       f'(site:glassdoor.co.in OR site:leetcode.com/discuss OR site:reddit.com)'),
        "Salaries (levels.fyi)": f"https://www.levels.fyi/companies/{slugify(company)}/salaries/software-engineer",
    }


def referral_messages(profile: Profile, row) -> dict[str, str]:
    me = profile.me
    first = profile.first_name
    company, title = row["company"], row["title"]
    link = row["url"] or row["apply_url"]
    skills = join_and(matched_skills(row, display=True)[:3]) or "backend systems"
    current = me.get("current_company", "")
    years = me.get("years_experience", "")
    top = pick_highlights(profile, f"{title}\n{row['description'] or ''}", 2)
    summary = "\n".join([f"- {years} yrs as {me.get('current_title', 'engineer')} at {current}: {skills}"]
                         + [f"- {_short(h)}" for h in top])
    connect = (f"Hi {{name}}, I'm a backend engineer at {current} ({skills}). I'm applying for {title} at "
               f"{company} and would value 2 minutes of your view on the team. Thanks! -{first}")
    if len(connect) > 300:
        connect = (f"Hi {{name}}, backend engineer at {current} here, applying for {truncate(title, 60)} at "
                   f"{company}. Would value a quick word about the team. Thanks! -{first}")
    return {
        "LinkedIn connection note (<=300 chars)": connect,
        "Referral ask (after they accept)": f"""Hi {{name}}, thanks for connecting!

I'm applying for {title} at {company}: {link}

Quick summary so it's easy to judge the fit:
{summary}

If you think I'd be a reasonable fit, would you be comfortable referring me? I can send my resume and a two-line blurb for the referral form. Totally fine if not -- any pointers on the team would help too.

Thanks,
{profile.name}""",
        f"Alumni variant ({me.get('college_short', 'college')})": f"""Hi {{name}}, fellow {me.get('college_short', '')} alum here ({me.get('college', '')}). I'm a backend engineer at {current} working on {skills}, and I'm applying for {title} at {company} ({link}). Would you be open to referring me or telling me a bit about the team? Happy to share my resume. Thanks! -{first}""",
        f"Ex-{current} variant": f"""Hi {{name}}, I noticed you were at {current} too -- I'm on the backend side there now ({skills}). I'm applying for {title} at {company} ({link}) and would love your honest take on the team, and a referral if you think I'd fit. Thanks! -{first}""",
        "Cold email to hiring manager / founder": f"""Subject: {title} -- backend engineer, streaming + data platforms ({years} yrs)

Hi {{name}},

I saw the {title} opening at {company}{' (' + link + ')' if link else ''}. I build streaming and data-intensive backends at {current}:

{summary}

I'd love to talk about what the team is building. Resume attached; GitHub: {me.get('github', '')}.

Thanks,
{profile.name}
{me.get('phone', '')} · {me.get('linkedin', '')}""",
        "Nudge (5 days, no reply)": f"""Hi {{name}}, just floating this back up in case it got buried -- no worries at all if now isn't a good time. The role is {title} at {company}: {link}. Thanks! -{first}""",
        "Recruiter follow-up (7 days after applying)": f"""Hi {{name}}, I applied for {title} at {company} on {(row['applied_at'] or '')[:10] or '<date>'} and wanted to check where things stand. Quick context: {years} years building streaming and data platforms ({skills}) at {current}. Happy to share anything that helps. Thanks, {profile.name}""",
    }


def _short(text: str, limit: int = 170) -> str:
    """First clause of a resume bullet, for messages that must stay short."""
    first = re.split(r"(?<=[a-z0-9)])[.;](?:\s|$)", text, maxsplit=1)[0]
    return truncate(first, limit)


# -- application form answers --------------------------------------------------

def why_company(profile: Profile, row, about: str) -> str:
    skills = join_and(matched_skills(row, display=True)[:3]) or "backend systems"
    prompt = f"""In 2-3 sentences, in the first person, answer "Why do you want to work at {row['company']}?"
for the role below. Tie one concrete thing from the posting or company description to one concrete
piece of the candidate's experience. No flattery, no invented facts. Output only the answer.

Candidate: {profile.me.get('pitch', '')}
Company: {about or 'unknown beyond the posting'}
Posting ({row['title']}): {truncate(row['description'] or '', 3500)}"""
    text = llm.complete(profile, prompt, max_tokens=600, effort="low")
    if text:
        return text
    context = f" {about.rstrip('.')}." if about else ""
    return (f"The {row['title']} role centres on {skills}, which is what I build today at "
            f"{profile.me.get('current_company', '')}.{context} I want to work where that is the core of the product, "
            f"not a side project.")


def application_answers(profile: Profile, row, about: str) -> dict[str, str]:
    me = profile.me
    expected = max(float(me.get("expected_ctc_lpa") or 0), float(row["salary_min_lpa"] or 0))
    remote_abroad = bool(row["remote"]) and "india" not in (row["location"] or "").lower()
    picks = pick_highlights(profile, row["description"] or "", 1)
    return {
        "Full name": profile.name,
        "Email": me.get("email", ""),
        "Phone": me.get("phone", ""),
        "Location": f"{me.get('city', '')}, India",
        "LinkedIn": me.get("linkedin", ""),
        "GitHub": me.get("github", ""),
        "Website / portfolio": me.get("portfolio", ""),
        "Current company / title": f"{me.get('current_company', '')} / {me.get('current_title', '')}",
        "Total experience": f"{me.get('years_experience', '')} years",
        "Notice period": me.get("notice_period", ""),
        "Current CTC": f"{me.get('current_ctc_lpa', '')} LPA" if me.get("current_ctc_lpa") else "(fill in profile.toml)",
        "Expected CTC": f"{expected:g} LPA (negotiable for the right scope)" if expected else "(fill in profile.toml)",
        "Willing to relocate": "Already in Bengaluru" if not row["remote"] else "N/A (remote)",
        "Work authorization / sponsorship": (me.get("work_authorization", "") if remote_abroad
                                             else "Indian citizen; no sponsorship needed"),
        "Why us?": why_company(profile, row, about),
        "Project you're proud of": picks[0] if picks else "",
        "How did you hear about us?": {"hn": "Hacker News 'Who is hiring'", "yc": "Y Combinator"}.get(
            row["source"], "Company careers page"),
    }


# -- kit -----------------------------------------------------------------------

def kit_dir(row) -> Path:
    return config.kits_dir() / f"{row['n']:04d}-{slugify(row['company'], 30)}-{slugify(row['title'], 40)}"


def write_kit(conn, profile: Profile, row) -> Path:
    path = kit_dir(row)
    path.mkdir(parents=True, exist_ok=True)
    about = about_company(conn, row)

    letter, author = cover_letter(profile, row, about)
    (path / "cover_letter.md").write_text(letter + "\n")

    answers = application_answers(profile, row, about)
    (path / "answers.md").write_text(
        f"# Form answers -- {row['company']}, {row['title']}\n\n"
        + "\n".join(f"**{k}:** {v}\n" for k, v in answers.items()))

    links = referral_links(profile, row["company"])
    messages = referral_messages(profile, row)
    ref = [f"# Referral plan -- {row['company']}\n",
           "Order that works: alumni -> ex-colleagues -> engineers on the team -> recruiter.",
           "Send 3-5 connection notes, ask for the referral only after they accept, and apply",
           "through the referral link they send (or right after they submit you).\n",
           "## Find people\n"]
    ref += [f"- [{label}]({url})" for label, url in links.items()]
    if row["contact_email"]:
        ref += ["", f"**Direct contact from the posting:** {row['contact_email']} -- use the cold email below."]
    ref += ["", "## Messages ({name} = their first name)\n"]
    for label, text in messages.items():
        ref += [f"### {label}\n", "```", text, "```", ""]
    (path / "referral.md").write_text("\n".join(ref))

    (path / "job.md").write_text(
        f"# {row['title']} -- {row['company']}\n\n"
        f"- Location: {row['location']}\n- Posted: {row['posted_at'] or '?'}\n"
        f"- Salary: {row['salary_text'] or ''}"
        f"{_band(row)}\n- Posting: {row['url']}\n- Apply: {row['apply_url']}\n- Source: {row['source']}\n\n"
        f"## Fit: {row['score']:.0f}/100\n\n"
        + "\n".join(f"- {b['part']} {b['points']:+g}: {b['why']}" for b in db.breakdown(row))
        + f"\n\n## Description\n\n{row['description'] or '(not fetched)'}\n")

    (path / "README.md").write_text(f"""# {row['company']} -- {row['title']}  (#{row['n']}, fit {row['score']:.0f})

Apply: {row['apply_url']}

1. [ ] Read job.md; skim the company (links in referral.md)
2. [ ] Send 3-5 referral connection notes (referral.md)
3. [ ] Apply with cover_letter.md ({author}) and answers.md
       `python -m jobhunt apply {row['n']} --assist` fills the form for you
4. [ ] `python -m jobhunt mark {row['n']} applied`
5. [ ] Follow up after 7 days if silent (message in referral.md)
""")
    db.log(conn, row["n"], "kit", str(path))
    conn.commit()
    return path


def _band(row) -> str:
    lo, hi = row["salary_min_lpa"], row["salary_max_lpa"]
    if hi:
        return f" ({lo:.0f}-{hi:.0f} LPA)" if lo and lo != hi else f" ({hi:.0f} LPA)"
    return " not posted" if not row["salary_text"] else ""


# -- discovery links -----------------------------------------------------------

def platform_links(profile: Profile) -> dict[str, list[tuple[str, str]]]:
    """Searches for the platforms jobhunt can't (or shouldn't) poll itself."""
    g = "https://www.google.com/search?tbs=qdr:w&q="
    li = "https://www.linkedin.com/jobs/search/?"
    role = "backend engineer"
    return {
        "LinkedIn (past week)": [
            ("Backend, Bengaluru, mid-senior", li + urllib.parse.urlencode(
                {"keywords": role, "location": "Bengaluru", "f_TPR": "r604800", "f_E": "4"})),
            ("Backend, remote India", li + urllib.parse.urlencode(
                {"keywords": role, "location": "India", "f_WT": "2", "f_TPR": "r604800"})),
            ("Data platform / streaming, Bengaluru", li + urllib.parse.urlencode(
                {"keywords": "data platform engineer kafka", "location": "Bengaluru", "f_TPR": "r604800"})),
            ("AI / LLM engineer, Bengaluru", li + urllib.parse.urlencode(
                {"keywords": "AI engineer LLM backend", "location": "Bengaluru", "f_TPR": "r604800"})),
        ],
        "Company boards via Google X-ray (past week) -- add new companies with `companies add-url`": [
            ("Greenhouse, Bengaluru", g + Q('(site:boards.greenhouse.io OR site:job-boards.greenhouse.io) '
                                            '("Bengaluru" OR "Bangalore") (backend OR platform OR "data")')),
            ("Lever, Bengaluru", g + Q('site:jobs.lever.co ("Bengaluru" OR "Bangalore") (backend OR platform)')),
            ("Ashby, India", g + Q('site:jobs.ashbyhq.com ("Bengaluru" OR "Bangalore" OR "India") engineer')),
            ("Workable, Bengaluru", g + Q('site:apply.workable.com ("Bengaluru" OR "Bangalore") backend')),
            ("Remote-from-India on any ATS", g + Q('(site:jobs.lever.co OR site:jobs.ashbyhq.com OR '
                                                   'site:boards.greenhouse.io) "remote" "India" backend')),
        ],
        "Indian platforms": [
            ("Naukri: backend, Bengaluru, 4 yrs", "https://www.naukri.com/backend-developer-jobs-in-bangalore?experience=4"),
            ("Instahyre (X-ray)", g + Q('site:instahyre.com backend Bangalore')),
            ("Cutshort (X-ray)", g + Q('site:cutshort.io backend Bangalore')),
            ("Hirist (X-ray)", g + Q('site:hirist.tech backend Bangalore')),
            ("Wellfound: backend, Bangalore", "https://wellfound.com/role/l/backend-engineer/bangalore"),
            ("YC Work at a Startup", "https://www.workatastartup.com/jobs"),
            ("Peerlist jobs", "https://peerlist.io/jobs"),
        ],
        "Remote-first talent networks (vetted once, matched repeatedly)": [
            ("Turing", "https://www.turing.com/jobs"),
            ("Uplers", "https://www.uplers.com/talent/"),
            ("Toptal", "https://www.toptal.com/developers"),
            ("Arc.dev", "https://arc.dev/remote-jobs"),
        ],
    }


def parse_board_url(url: str) -> tuple[str, str] | None:
    """Map a careers URL to (ats, slug) so a company found by hand can be tracked."""
    patterns = [
        ("greenhouse", r"(?:boards|job-boards)(?:\.eu)?\.greenhouse\.io/(?:embed/job_board\?for=)?([\w-]+)"),
        ("lever", r"jobs\.(?:eu\.)?lever\.co/([\w.-]+)"),
        ("ashby", r"jobs\.ashbyhq\.com/([\w.%-]+)"),
        ("workable", r"apply\.workable\.com/([\w-]+)"),
        ("smartrecruiters", r"(?:jobs|careers)\.smartrecruiters\.com/([\w-]+)"),
        ("recruitee", r"([\w-]+)\.recruitee\.com"),
        ("workday", r"([\w-]+)\.(wd\d+)\.myworkdayjobs\.com/(?:[a-z]{2}-[A-Z]{2}/)?([\w-]+)"),
    ]
    for ats_name, pattern in patterns:
        m = re.search(pattern, url)
        if m:
            if ats_name == "workday":
                return ats_name, "/".join(m.groups())
            return ats_name, urllib.parse.unquote(m.group(1))
    return None
