# jobhunt

A personal job-search pipeline for a backend / data-platform / AI engineer in
Bengaluru: it finds roles, ranks them against your profile, writes the
application and referral material, helps you apply, watches your inbox for
replies and turns interviews into prep plans.

```
 funding news ─┐                                   ┌─> cover letter, form answers
 YC hiring ────┼─> companies ─> job boards ─┐      ├─> referral targets + messages
 seed list ────┘   (ATS auto-detected)      ├─> fit score ─> campaign of 50 ─> assisted apply
 remote boards, HN, Amazon ─────────────────┘      │
                                                   └─> inbox ─> status ─> interview prep plan
```

Only Python 3.11+ is needed. `anthropic` and `playwright` are optional
extras (`pip install -r requirements.txt`).

## Quick start

```bash
cd jobhunt
python -m jobhunt init            # creates profile.toml -- fill in email, phone, resume path, CTC
python -m jobhunt discover        # a few minutes the first time (it detects every company's job board)
python -m jobhunt top -n 30       # best matches, with fit scores
python -m jobhunt show 12         # why #12 scored the way it did
python -m jobhunt campaign -n 50  # shortlist the best 50 (max 2 per company) and write a kit for each
python -m jobhunt report --open   # dashboard
```

## The 50-application playbook

`campaign` writes `var/out/campaign.md`, a checklist of your 50 best-fit roles,
and a kit per role in `var/kits/NNNN-company-role/`:

| file | what it's for |
|---|---|
| `README.md` | the 5 steps for this role |
| `job.md` | posting, pay band, fit breakdown, gaps |
| `cover_letter.md` | tailored to the posting: your three most relevant bullets lead |
| `referral.md` | LinkedIn/Google searches for alumni, ex-colleagues, engineers and recruiters at the company, plus 7 message templates (connection note under 300 characters, referral ask, alumni and ex-colleague variants, cold email, nudge, recruiter follow-up) |
| `answers.md` | the form answers (notice period, CTC, "why us", ...) |

A rhythm that works is about 10 roles a day:

1. **Morning:** send 3-5 connection notes per role from `referral.md`
   (alumni and ex-colleagues reply most often).
2. **Next day:** apply, through the referral if one has arrived. Otherwise apply
   directly rather than waiting: fresh postings fill fast.
   ```bash
   python -m jobhunt apply 12 --assist   # opens the real form and fills it in; you review and press Submit
   python -m jobhunt refer 12 --asked "Priya (college alum)"
   ```
3. **Every day:** `python -m jobhunt daily` scans for replies, moves statuses,
   writes prep plans for interviews, and lists who to follow up with.

## Sources

| source | what it covers | how |
|---|---|---|
| Company boards | ~125 seed companies plus everything found below, on Greenhouse, Lever, Ashby, Workable, SmartRecruiters, Recruitee and Workday | each ATS's public job-board API; the board is **detected automatically** from the company name |
| Funding news | companies that raised in the last ~45 days (Google News + Entrackr + Inc42 + TechCrunch) | headline parser extracts company, round, amount; its board is then detected and polled |
| YC | YC companies hiring in India or remote | community mirror of the YC directory |
| HN "Who is hiring" | founders posting directly, often with an email | Algolia API; the email goes into the cold-email template |
| Remote boards | RemoteOK, Remotive, Himalayas, Jobicy, We Work Remotely | public feeds; remote roles locked to US/EU are dropped |
| Amazon | SDE roles in Bengaluru | amazon.jobs search JSON |
| By hand | LinkedIn, Naukri, Instahyre, Wellfound, Cutshort, Hirist | `python -m jobhunt links` prints ready-made searches, including Google "X-ray" queries that surface company boards on Greenhouse/Lever/Ashby. Add what you find with `companies add-url <board url>` and it is polled from then on |

Adding a company you like: `python -m jobhunt companies add "Acme" --domain acme.com`
(the board is detected) or `companies add-url https://jobs.lever.co/acme`.

## How a job is scored

Every point has a reason; `show N` prints them.

| part | range | |
|---|---|---|
| title | 0-30 | backend / platform / data / AI titles score highest; manager, frontend, intern and similar are dropped |
| skills | 0-30 | weighted overlap between the posting and `[skills]` in your profile |
| location | 0-15 | Bengaluru, or remote and open to India; anything else is dropped |
| pay | -20 to +12 | posted band vs your 25 LPA floor; otherwise the company's tier |
| seniority | -15 to +10 | years asked for vs yours; level words in the title |
| freshness | -5 to +5 | early applicants get read |
| company | 0-10 | tier on the seed list; raised money in the last 6 months |

Skills the posting asks for that you don't list (Go, AWS, Rust, ...) are shown
as **gaps**. They aren't penalised; the cover letter acknowledges one honestly
and the prep plan includes it.

Edit `profile.toml` (titles, skills, floor, cities) and run `python -m jobhunt rescore`.

## Reply tracking

`inbox` reads (never sends or modifies) your mailbox over IMAP:

1. Google Account → Security → 2-Step Verification on → [App passwords](https://myaccount.google.com/apppasswords) → create one.
2. `export JOBHUNT_IMAP_PASSWORD=...` and set `[inbox] user` in `profile.toml`.
3. `python -m jobhunt inbox --dry-run`, then without `--dry-run`.

Messages are matched to applications by sender domain, company name and ATS
sender (Greenhouse, Lever, Ashby, Workday, HackerRank, Calendly, ...), then
classified as acknowledgement, assessment, interview, rejection or offer. The
job moves forward, never back. An interview or assessment writes `prep.md` into
the kit. Recruiters writing about *other* roles show up on the dashboard as
inbound leads, and LinkedIn job-alert emails are ignored.

`followups` lists applications 7+ days old with no reply (nudge them) and
28+ days old (mark them `ghosted` so the response rate stays honest).

## Interview prep

`python -m jobhunt prep 12 --date 2026-10-20` (written automatically on an
interview email) produces:

- **What they do**: the company in a few sentences, with research links
  (interview experiences, salaries, people)
- **The likely loop**: big-tech, Indian product startup, or remote startup
- **What the posting tests**: revision checklists for each technology it names
- **System design prompts** for their domain (payments, logistics, data
  platforms, AI, ...) plus a deep dive on your own strongest system
- **DSA patterns, STAR stories** (from `[[stories]]` in your profile), questions to ask
- **A day-by-day schedule** up to the interview date

## Claude (optional)

With `pip install anthropic` and `ANTHROPIC_API_KEY` set (or `ant auth login`),
cover letters, "why us" answers, unclear reply emails and company briefs are
written by Claude (`[llm]` in the profile picks the model and effort). It is
told to use only facts from your profile and the posting. Without it, the
built-in templates are used, and they are good enough on their own.

## Running it every day

- **Your machine:** `automation/daily.sh` from cron (details in the script).
  It runs discover + inbox + dashboard and emails you the digest
  (`[inbox] digest_to`).
- **GitHub Actions:** `automation/github-actions-daily.yml`, **in a private
  repository only**, since public workflow logs would show where you're applying.

## Deliberately not automated

- **Pressing Submit.** `apply --assist` fills every field it can, uploads your
  resume and cover letter, and lists the required questions it couldn't
  answer. You review and submit, and it marks the job applied when the
  confirmation page appears. Custom questions, consent boxes and CAPTCHAs need
  a human, and 50 reviewed applications beat 300 sprayed ones.
- **Scraping or auto-applying on LinkedIn and Naukri.** Both forbid it and ban
  accounts that do it, and your LinkedIn account is your referral network.
  jobhunt generates the searches and the messages; you send them.

## Skills checklist

`roadmap/sde2-bar.html` is a 238-item checklist of what a strong four-year
backend engineer is expected to know in 2026, from the basics up: DSA patterns,
Python/Go/Java, CS fundamentals, design patterns and LLD, distributed systems
and system design, data and streaming, cloud and reliability, AI engineering,
craft, and the classic papers. Items are tagged Floor / SDE-2 / Senior edge and
flagged when interviews lean on them. Open the file in a browser; your ticks
are kept in that browser.

## Privacy

`profile.toml`, the database, kits, the dashboard and the browser profile live
in `jobhunt/var/` and `jobhunt/profile.toml`, both gitignored. This directory
is also excluded from the devtools site's Vercel and Docker builds.

## Tests

```bash
python -m unittest discover -s tests -t .
```

The tests run offline: every source is exercised against fixture payloads
shaped like the real APIs, and the autofill test fills a Greenhouse-style form
in headless Chromium when Playwright is installed.
