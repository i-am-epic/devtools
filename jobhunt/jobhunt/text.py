"""Text helpers shared by sources, scoring and materials."""
from __future__ import annotations

import html
import re
from html.parser import HTMLParser

_BLOCK_TAGS = {"p", "div", "br", "li", "ul", "ol", "h1", "h2", "h3", "h4", "h5", "h6", "tr", "section"}


class _Stripper(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []
        self._skip = 0

    def handle_starttag(self, tag, attrs):
        if tag in ("script", "style"):
            self._skip += 1
        elif tag == "li":
            self.parts.append("\n- ")
        elif tag in _BLOCK_TAGS:
            self.parts.append("\n")

    def handle_endtag(self, tag):
        if tag in ("script", "style") and self._skip:
            self._skip -= 1
        elif tag in _BLOCK_TAGS:
            self.parts.append("\n")

    def handle_data(self, data):
        if not self._skip:
            self.parts.append(data)


def html_to_text(markup: str | None) -> str:
    """Turn job-board HTML (possibly entity-escaped twice) into plain text."""
    if not markup:
        return ""
    # Greenhouse returns HTML that is itself HTML-escaped.
    if "&lt;" in markup and "<" not in markup:
        markup = html.unescape(markup)
    parser = _Stripper()
    parser.feed(markup)
    parser.close()
    text = "".join(parser.parts)
    text = re.sub(r"[ \t ]+", " ", text)
    text = re.sub(r" *\n *", "\n", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


_COMPANY_SUFFIXES = re.compile(
    r"\b(inc|inc\.|llc|ltd|ltd\.|limited|pvt|private|corp|corporation|co|gmbh|technologies|"
    r"technology|labs|software|solutions|india|hq)\b\.?",
    re.I,
)


def company_key(name: str) -> str:
    """Stable key for matching the same company across sources."""
    name = (name or "").lower().replace("&", "and")
    name = _COMPANY_SUFFIXES.sub(" ", name)
    return re.sub(r"[^a-z0-9]+", "", name) or re.sub(r"[^a-z0-9]+", "", (name or "").lower())


def slugify(value: str, limit: int = 60) -> str:
    value = re.sub(r"[^a-zA-Z0-9]+", "-", (value or "").lower()).strip("-")
    return value[:limit].rstrip("-") or "item"


def title_key(title: str) -> str:
    title = (title or "").lower()
    title = re.sub(r"\(.*?\)|\[.*?\]", " ", title)
    title = re.split(r"\s[-–|,]\s", title)[0]
    return re.sub(r"[^a-z0-9]+", " ", title).strip()


def fingerprint(company: str, title: str) -> str:
    return f"{company_key(company)}|{title_key(title)}"


def slug_candidates(name: str, domain: str | None = None) -> list[str]:
    """Plausible job-board slugs for a company, most likely first."""
    raw = (name or "").lower().replace("&", "and")
    words = re.findall(r"[a-z0-9]+", raw)
    core = [w for w in words if not _COMPANY_SUFFIXES.fullmatch(w)] or words
    seen: list[str] = []

    def add(slug: str) -> None:
        if slug and slug not in seen:
            seen.append(slug)

    add("".join(core))
    add("-".join(core))
    if domain:
        stem = domain.lower().removeprefix("www.").split(".")[0]
        add(stem)
    if len(core) > 1 and len(core[0]) >= 4:
        add(core[0])
    add("".join(words))
    return seen


_EMAIL = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")


def find_emails(text: str) -> list[str]:
    """Emails in text, including the usual 'name [at] company [dot] com' forms."""
    if not text:
        return []
    clean = re.sub(r"\s*[\[\(\{<]\s*at\s*[\]\)\}>]\s*", "@", text, flags=re.I)
    clean = re.sub(r"\s*[\[\(\{<]\s*dot\s*[\]\)\}>]\s*", ".", clean, flags=re.I)
    found = []
    for match in _EMAIL.findall(clean):
        match = match.rstrip(".")
        if match.lower() not in (f.lower() for f in found):
            found.append(match)
    return found


def keyword_in(text_lower: str, keyword: str) -> bool:
    """Word-boundary keyword match that copes with c#, .net, node.js, ci/cd.

    A trailing ``*`` makes it a prefix match (``scalab*`` matches scalable and
    scalability); anything else must match as a whole token.
    """
    kw = keyword.lower()
    prefix = kw.endswith("*")
    kw = kw.rstrip("*")
    left = r"(?<![a-z0-9])" if kw[0].isalnum() else ""
    right = "" if prefix else r"(?![a-z0-9#+])"
    return re.search(left + re.escape(kw) + right, text_lower) is not None


def truncate(text: str, limit: int) -> str:
    """Shorten to ``limit`` characters, preferring a word boundary."""
    text = text or ""
    if len(text) <= limit:
        return text
    cut = text[: limit - 1]
    if " " in cut[limit // 2:]:
        cut = cut[: cut.rfind(" ")]
    return cut.rstrip(" ,;:-") + "…"


_PRETTY = {
    "python": "Python", "kafka": "Kafka", "kubernetes": "Kubernetes", "spark": "Spark", "clickhouse": "ClickHouse",
    "duckdb": "DuckDB", "postgres": "Postgres", "mongodb": "MongoDB", "redis": "Redis", "fastapi": "FastAPI",
    "django": "Django", "azure": "Azure", "docker": "Docker", "helm": "Helm", "keda": "KEDA",
    "prometheus": "Prometheus", "grafana": "Grafana", "graphql": "GraphQL", "parquet": "Parquet", "java": "Java",
    "javascript": "JavaScript", "linux": "Linux", "terraform": "Terraform", "airflow": "Airflow", "flink": "Flink",
    "elasticsearch": "Elasticsearch", "event hub": "Event Hub", "service bus": "Service Bus", "asp.net": "ASP.NET",
    ".net": ".NET", "c#": "C#", "ci/cd": "CI/CD", "grpc": "gRPC", "rest": "REST", "llm": "LLMs", "rag": "RAG",
    "mcp": "MCP", "sql": "SQL", "kql": "KQL", "etl": "ETL", "iot": "IoT", "aws": "AWS", "gcp": "GCP",
    "mqtt": "MQTT", "flutter": "Flutter", "dart": "Dart", "bash": "Bash", "go": "Go", "golang": "Go",
    "rust": "Rust", "typescript": "TypeScript", "node.js": "Node.js", "scala": "Scala", "kotlin": "Kotlin",
    "snowflake": "Snowflake", "bigquery": "BigQuery", "databricks": "Databricks", "dbt": "dbt",
    "cassandra": "Cassandra", "dynamodb": "DynamoDB", "react": "React", "scalab": "scalability",
    "agentic": "agentic systems", "time series": "time-series data", "time-series": "time-series data",
}


def pretty(keyword: str) -> str:
    """Display form of a skill keyword: 'llm' -> 'LLMs', 'clickhouse' -> 'ClickHouse'."""
    kw = keyword.lower().rstrip("*")
    return _PRETTY.get(kw, kw)


def join_and(items: list[str]) -> str:
    items = [i for i in items if i]
    if len(items) <= 1:
        return "".join(items)
    return ", ".join(items[:-1]) + " and " + items[-1]
