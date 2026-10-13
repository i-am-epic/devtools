"""Interview preparation plans, generated when a reply turns into an interview.

The plan is built from the posting (what they asked for), the company (what
they build, how big they are), and the profile (stories to tell). With Claude
available, the company brief and the design prompts are tailored further.
"""
from __future__ import annotations

import re
from datetime import date, timedelta
from pathlib import Path

from . import db, llm
from .config import Profile
from .materials import about_company, gaps, kit_dir, matched_skills, pick_highlights, referral_links, _short
from .text import keyword_in, pretty, truncate

# What to revise when the JD mentions a topic.
TOPICS: dict[str, list[str]] = {
    "kafka": ["Partitions, keys and ordering; consumer groups and rebalancing (cooperative sticky)",
              "Delivery semantics: idempotent producer, transactions, exactly-once in practice",
              "Lag, back-pressure, retries and DLQs; sizing partitions"],
    "distributed": ["Replication, quorum, leader election (Raft at whiteboard depth)",
                    "CAP / PACELC trade-offs with a real example from your work",
                    "Idempotency keys, outbox pattern, sagas vs 2PC, clock skew"],
    "streaming": ["Event time vs processing time, watermarks, windowing",
                  "Stateful stream processing and checkpointing (Flink/Kafka Streams concepts)"],
    "python": ["GIL, asyncio event loop, threads vs processes, when each wins",
               "Memory model, generators, context managers, typing/protocols", "Profiling (py-spy, cProfile)"],
    "go": ["Goroutines, channels, select, context cancellation", "Go memory model and the race detector",
           "Error handling idioms, interfaces, generics basics"],
    "java": ["JVM memory and GC basics, threads, CompletableFuture", "Spring Boot request lifecycle"],
    "c#": ["async/await, Task vs ValueTask, thread pool starvation", ".NET DI, middleware, IAsyncEnumerable"],
    "postgres": ["Indexes (B-tree, GIN, partial), EXPLAIN ANALYZE, MVCC and vacuum",
                 "Isolation levels and the anomalies each prevents", "Partitioning and connection pooling"],
    "sql": ["Window functions, CTEs, joins at scale", "Query plans and index choice"],
    "redis": ["Data structures and when to use each", "Caching patterns, eviction, stampede protection",
              "Rate limiting with Redis (token bucket / sliding window)"],
    "kubernetes": ["Pods, deployments, services, HPA/KEDA autoscaling", "Probes, resource limits, rollouts",
                   "Debugging a crashlooping pod end-to-end"],
    "aws": ["Core services map: EC2/ECS/EKS, S3, SQS/SNS, DynamoDB, Lambda -- your Azure equivalents",
            "IAM basics and VPC networking"],
    "gcp": ["GKE, Pub/Sub, BigQuery, Cloud Run -- map to the Azure services you know"],
    "microservices": ["Service boundaries, sync vs async calls, retries with jitter, circuit breakers",
                      "API versioning and backward-compatible schema evolution"],
    "grpc": ["Protobuf schema evolution, streaming RPCs, deadlines and cancellation"],
    "spark": ["Partitions, shuffles, skew; narrow vs wide transformations", "Tuning executors and memory"],
    "clickhouse": ["MergeTree engines, ORDER BY / primary key design, materialised views"],
    "llm": ["RAG pipeline: chunking, embeddings, hybrid retrieval, re-ranking",
            "Evaluation: offline evals, LLM-as-judge pitfalls, regression gates",
            "Latency/cost: caching, batching, model routing; guardrails and prompt injection"],
    "rag": ["Retrieval quality metrics (recall@k, MRR), query rewriting, citations"],
    "agent": ["Tool calling loops, planning vs reacting, failure recovery, MCP",
              "How you'd make an agent observable and safe in production"],
    "payments": ["Idempotency, double-entry ledgers, reconciliation, UPI flows"],
    "search": ["Inverted indexes, BM25, vector search (HNSW), hybrid ranking"],
    "observability": ["RED/USE metrics, SLOs and error budgets, tracing with OpenTelemetry"],
    "security": ["AuthN/AuthZ (OAuth2/OIDC, JWT pitfalls), secrets, OWASP top 10 for APIs"],
}

# System-design prompts keyed by what the company does.
DESIGN_PROMPTS: list[tuple[str, list[str]]] = [
    (r"payment|fintech|upi|lending|bank|ledger|wallet", [
        "Design a payment ledger with idempotent APIs and daily reconciliation",
        "Design UPI collect/intent flow with retries and timeouts"]),
    (r"delivery|logistics|quick commerce|grocery|food|ride|mobility", [
        "Design order dispatch / rider assignment for a city",
        "Design real-time ETA and location tracking"]),
    (r"observability|monitoring|logs|metrics|apm", [
        "Design a metrics ingestion pipeline (1M points/s) with downsampling",
        "Design a log search system with retention tiers"]),
    (r"\bai\b|llm|genai|agent|machine learning", [
        "Design a RAG service over company documents with evals and access control",
        "Design an LLM gateway: routing, caching, rate limits, cost tracking"]),
    (r"data platform|warehouse|lakehouse|etl|analytics|pipeline", [
        "Design a CDC pipeline from Postgres into a lakehouse with exactly-once semantics",
        "Design a multi-tenant analytics query service"]),
    (r"social|feed|content|creator|video|chat|messag", [
        "Design a news feed with fan-out trade-offs", "Design a chat system with delivery receipts"]),
    (r"e-?commerce|marketplace|retail|catalog", [
        "Design inventory reservation during a flash sale", "Design product search with ranking"]),
    (r"security|identity|auth", [
        "Design an authentication service with sessions, refresh tokens and revocation"]),
    (r"saas|b2b|crm|workflow|developer", [
        "Design a multi-tenant SaaS backend: isolation, noisy neighbours, per-tenant limits",
        "Design a webhook delivery system with retries and ordering"]),
]
DEFAULT_DESIGN = [
    "Design a rate limiter (distributed, per-tenant)",
    "Design a URL shortener / unique ID generator at scale",
    "Design a job scheduler with retries and exactly-once execution",
]

DSA_CORE = [
    "Arrays/hashing + two pointers + sliding window",
    "Binary search (incl. on the answer)",
    "Stacks/monotonic stack, heaps/top-k, intervals",
    "Trees: DFS/BFS, BST, LCA; Tries",
    "Graphs: BFS/DFS, topological sort, Dijkstra, union-find",
    "Dynamic programming: 1D/2D, knapsack, LIS, intervals",
    "Design-flavoured: LRU/LFU cache, rate limiter, iterator, time-based KV store",
]

BEHAVIOURAL = [
    ("Tell me about yourself (90 seconds)", ["impact", "ownership"]),
    ("A project you're proudest of", ["impact", "technical depth"]),
    ("A time you disagreed with a senior/peer", ["conflict"]),
    ("A production incident you handled", ["failure", "ownership"]),
    ("A time requirements were unclear", ["ambiguity"]),
    ("Why are you leaving / why us", ["motivation"]),
]


def interview_style(company: dict | None, row) -> str:
    name = (row["company"] or "").lower()
    big = {"amazon", "google", "microsoft", "uber", "atlassian", "flipkart", "walmart", "salesforce", "adobe",
           "nvidia", "oracle", "linkedin", "intuit", "goldman", "jpmorgan", "visa", "paypal", "cisco", "sap"}
    if any(b in name for b in big):
        return ("Large-company loop: online assessment, 2 DSA rounds (LeetCode medium/hard), LLD (OOP + design "
                "patterns), HLD, and a hiring-manager/behavioural round (Amazon: Leadership Principles in every "
                "round). Weight DSA heavily.")
    if row["remote"] and row["source"] in ("remoteok", "remotive", "himalayas", "jobicy", "weworkremotely", "hn"):
        return ("Remote startup loop: recruiter screen, take-home or live pairing on a realistic task, system "
                "design discussion, founder/culture call. Weight practical coding, written communication, and "
                "async collaboration stories.")
    return ("Indian product-startup loop: recruiter screen, DSA or machine-coding round (build a small working "
            "system in 90 min), LLD, HLD with a domain prompt, project deep-dive, and a hiring-manager round. "
            "Weight machine coding + your own project deep-dive.")


def build_plan(conn, profile: Profile, row, interview_on: date | None = None) -> str:
    company = db.company(conn, row["company_key"])
    company = dict(company) if company else None
    about = about_company(conn, row)
    jd = f"{row['title']}\n{row['description'] or ''}".lower()
    topics = [(k, v) for k, v in TOPICS.items() if keyword_in(jd, k) or keyword_in(jd, k + "*")]
    domain_text = f"{about} {jd}"
    designs: list[str] = []
    for pattern, prompts in DESIGN_PROMPTS:
        if re.search(pattern, domain_text, re.I):
            designs += prompts
    # The project deep-dive is the round a candidate can win outright: rehearse your own system.
    own = pick_highlights(profile, jd, 1)
    designs = (designs or DEFAULT_DESIGN)[:3]
    if own:
        designs.append(f"Your own system, end-to-end: {_short(own[0], 120)} -- throughput, failure modes, "
                       f"back-pressure, how you'd 10x it, what you'd redesign")
    today = date.today()
    days = max(3, min(14, (interview_on - today).days if interview_on else 7))
    skills = matched_skills(row, display=True)
    missing = [pretty(g) for g in gaps(row)]

    brief = llm.complete(profile, f"""Write a short company brief for a candidate interviewing at {row['company']} for
"{row['title']}". Use only the posting and description below; mark anything uncertain. Sections:
What they do (2-3 sentences), Who their customers are, What this team likely owns, Tech signals in the posting,
Smart questions to ask the interviewer (5). Markdown, under 300 words.

Company description: {about or 'none'}
Posting: {truncate(row['description'] or '', 6000)}""", max_tokens=2500)

    lines = [f"# Interview prep -- {row['company']}, {row['title']}", ""]
    if interview_on:
        lines += [f"Interview: **{interview_on.isoformat()}** ({days} days of prep)", ""]
    lines += ["## What they do", ""]
    if brief:
        lines += [brief, ""]
    else:
        lines += [about or "_No description captured -- read their site, recent news and the posting._", ""]
        if company and company.get("funding_round"):
            lines += [f"Recent funding: {company['funding_round']} {company.get('funding_amount') or ''} "
                      f"({company.get('funding_date') or ''}) -- ask what the money is for.", ""]
    lines += ["Research links:", ""]
    lines += [f"- [{k}]({v})" for k, v in referral_links(profile, row["company"]).items()
              if k.startswith(("Interview", "Salaries", "Engineers"))]
    lines += ["", "## Likely loop", "", interview_style(company, row), ""]
    lines += ["## What the posting tests", ""]
    lines += [f"- You match: {', '.join(skills) or '--'}", f"- Gaps to prepare an honest answer for: {', '.join(missing) or 'none flagged'}", ""]
    for key, items in topics:
        lines += [f"**{key}**"] + [f"- [ ] {i}" for i in items] + [""]
    lines += ["## System design prompts to rehearse", ""] + [f"- [ ] {d}" for d in designs]
    lines += ["", "Framework: requirements & numbers -> API -> data model -> high-level diagram -> deep dive on the "
                  "hardest part -> failure modes & scaling -> trade-offs you made.", ""]
    lines += ["## DSA", ""] + [f"- [ ] {d}" for d in DSA_CORE]
    lines += ["", "Do 2 timed mediums a day; say your approach and complexity out loud before coding.", ""]
    lines += ["## Behavioural (STAR, 2 minutes each)", ""]
    for question, themes in BEHAVIOURAL:
        story = next((s for s in profile.stories if set(s.get("themes", [])) & set(themes)), None)
        hint = f" -> use *{story['title']}*" if story else ""
        lines.append(f"- [ ] {question}{hint}")
    lines += ["", "## Day-by-day", ""]
    lines += _schedule(days, today, bool(topics))
    lines += ["", "## Questions to ask them", "",
              "- What does the first 90 days look like for this role, and how is success measured?",
              "- What's the hardest technical problem the team is working on right now?",
              "- How do you handle on-call and incidents?",
              "- How are design decisions made and written down?",
              "- What would make someone great (not just good) in this role?", ""]
    return "\n".join(lines)


def _schedule(days: int, start: date, has_topics: bool) -> list[str]:
    blocks = [
        "Company + posting deep dive; write your 90-second intro; map 4 STAR stories",
        "DSA: arrays/hashing/sliding window/binary search (4 timed mediums)",
        "DSA: trees/graphs/heaps (4 timed mediums)",
        "LLD: one machine-coding problem end-to-end (parking lot / rate limiter / LRU) with tests",
        "HLD: two prompts from the list above, timed 45 min each, drawn on paper",
        "Tech deep dives from 'What the posting tests'" if has_topics else "Your own systems: numbers, failure modes",
        "Own-system deep dive: rehearse your top two projects with real numbers and diagrams",
        "Mock interview (Pramp / a friend) + review weak spots",
        "Light review, sleep, logistics check",
    ]
    if days < len(blocks):
        keep = [0, 1, 4, 6, len(blocks) - 1]
        extra = [i for i in range(len(blocks)) if i not in keep]
        blocks = [blocks[i] for i in sorted(keep + extra[: max(0, days - len(keep))])]
    while len(blocks) < days:
        blocks.insert(-1, "Timed mixed practice: 2 DSA + 1 design; review mistakes")
    return [f"- [ ] **{(start + timedelta(days=i)).strftime('%a %d %b')}** -- {b}" for i, b in enumerate(blocks[:days])]


def write_plan(conn, profile: Profile, row, interview_on: date | None = None) -> Path:
    path = kit_dir(row)
    path.mkdir(parents=True, exist_ok=True)
    plan = build_plan(conn, profile, row, interview_on)
    out = path / "prep.md"
    out.write_text(plan)
    db.log(conn, row["n"], "prep", str(out))
    conn.commit()
    return out
