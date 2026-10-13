"""Recently funded companies, from news RSS (Google News search + startup press).

A fresh round means a hiring plan and budget, usually before the roles reach
the big job sites. Each funded company is fed to the ATS resolver, so its open
roles show up in the next ``discover``.
"""
from __future__ import annotations

import re
import urllib.parse
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime

from .. import http
from ..models import Funding

VERBS = (r"raises|raised|secures|secured|bags|bagged|nets|netted|lands|landed|closes|closed|gets|got|"
         r"picks up|mops up|garners|receives|received|scoops up|snags|ropes in|grabs|attracts|announces|completes")
_SPLIT = re.compile(rf"^(?P<pre>.+?)\s+(?:has\s+|have\s+)?(?:{VERBS})\b\s*(?P<rest>.*)$", re.I)
_DESCRIPTOR = re.compile(
    r"^.*\b(?:startup|start-up|platform|firm|company|maker|provider|player|unicorn|soonicorn|marketplace|"
    r"app|brand|venture|enabler|developer|builder|operator|lender|nbfc|neobank|saas|aggregator|-based)\s+",
    re.I,
)
_SECTOR = re.compile(
    r"^(?:(?:indian|india's|bengaluru|bangalore|mumbai|delhi|gurugram|noida|pune|hyderabad|chennai|"
    r"us|uk|global|ai|genai|agentic|fintech|edtech|healthtech|insurtech|proptech|agritech|deeptech|"
    r"spacetech|cleantech|climate|ev|d2c|b2b|b2c|saas|logistics|gaming|cybersecurity|security|"
    r"devtools?|data|infra|quick commerce|commerce|e-commerce|ecommerce|robotics|biotech|web3|crypto)\s+)+",
    re.I,
)
_PREFIX = re.compile(r"^(?:exclusive|funding alert|breaking|scoop|startup funding|funding|deals?|"
                     r"funding roundup|weekly funding report)\s*[:|\-–]\s*", re.I)
_AMOUNT = re.compile(
    r"(?P<cur>\$|usd|us\$|rs\.?|inr|₹|€|eur|£|gbp)\s?(?P<num>\d+(?:[.,]\d+)?)\s?"
    r"(?P<unit>mn|m|million|cr|crore|crores|bn|b|billion|k|lakh)?\b",
    re.I,
)
_ROUND = re.compile(r"\b(pre-seed|seed|pre-series [a-f]|series [a-f]\d?|bridge|growth|pre-ipo|debt|venture debt)\b",
                    re.I)


def parse_headline(headline: str) -> dict | None:
    """Extract company, amount and round from a funding headline."""
    title = re.sub(r"\s+-\s+[^-]+$", "", headline).strip()  # Google News appends " - Publisher"
    title = _PREFIX.sub("", title)
    match = _SPLIT.match(title)
    if not match:
        return None
    pre, rest = match.group("pre").strip(" ,:'\""), match.group("rest")
    if not (_AMOUNT.search(rest) or _ROUND.search(rest) or re.search(r"\bfunding\b", rest, re.I)):
        return None
    if ":" in pre:
        pre = pre.split(":")[-1].strip()
    company = _DESCRIPTOR.sub("", pre)
    company = _SECTOR.sub("", company).strip(" ,'\"")
    company = re.sub(r"[’']s$", "", company)
    if not company or "," in company or " and " in company.lower() or len(company.split()) > 4:
        return None
    if not company[0].isupper() and not company[0].isdigit():
        return None
    amount = _AMOUNT.search(rest)
    rnd = _ROUND.search(rest)
    return {
        "company": company,
        "amount": amount.group(0).strip() if amount else "",
        "amount_usd_m": _usd_millions(amount) if amount else None,
        "round": rnd.group(1).title() if rnd else "",
    }


def _usd_millions(m, usd_inr: float = 88.0) -> float | None:
    cur = m.group("cur").lower().rstrip(".")
    num = float(m.group("num").replace(",", ""))
    unit = (m.group("unit") or "").lower()
    scale = {"mn": 1e6, "m": 1e6, "million": 1e6, "bn": 1e9, "b": 1e9, "billion": 1e9, "k": 1e3,
             "cr": 1e7, "crore": 1e7, "crores": 1e7, "lakh": 1e5}.get(unit)
    if scale is None:
        return None
    value = num * scale
    if cur in ("rs", "inr", "₹"):
        value /= usd_inr
    elif cur in ("€", "eur"):
        value *= 1.08
    elif cur in ("£", "gbp"):
        value *= 1.27
    return round(value / 1e6, 2)


def _items(xml_bytes: bytes):
    root = ET.fromstring(xml_bytes)
    for item in root.iter("item"):
        yield item.findtext("title") or "", item.findtext("link") or "", item.findtext("pubDate")
    atom = "{http://www.w3.org/2005/Atom}"
    for entry in root.iter(f"{atom}entry"):
        link = entry.find(f"{atom}link")
        yield (entry.findtext(f"{atom}title") or "", link.get("href") if link is not None else "",
               entry.findtext(f"{atom}updated"))


def _pub_date(raw: str | None) -> str | None:
    if not raw:
        return None
    try:
        return parsedate_to_datetime(raw).date().isoformat()
    except (TypeError, ValueError):
        match = re.match(r"\d{4}-\d{2}-\d{2}", raw)
        return match.group(0) if match else None


def google_news_url(query: str, days: int) -> str:
    q = urllib.parse.quote(f"{query} when:{days}d")
    return f"https://news.google.com/rss/search?q={q}&hl=en-IN&gl=IN&ceid=IN:en"


def scan(queries: list[str], feeds: list[str], days: int = 45) -> list[Funding]:
    cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).date().isoformat()
    urls = [(google_news_url(q, days), "google-news") for q in queries] + [(f, f) for f in feeds]
    seen: dict[str, Funding] = {}
    for url, source in urls:
        try:
            payload = http.get(url)
        except http.HTTPError:
            continue
        try:
            items = list(_items(payload))
        except ET.ParseError:
            continue
        for title, link, pub in items:
            published = _pub_date(pub)
            if published and published < cutoff:
                continue
            parsed = parse_headline(title)
            if not parsed:
                continue
            key = parsed["company"].lower()
            if key in seen:
                continue
            seen[key] = Funding(company=parsed["company"], headline=title, url=link, published_at=published,
                                round=parsed["round"], amount=parsed["amount"],
                                amount_usd_m=parsed["amount_usd_m"], source=source)
    return list(seen.values())
