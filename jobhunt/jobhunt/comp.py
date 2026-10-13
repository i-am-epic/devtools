"""Salary parsing into lakhs-per-annum (LPA).

Handles the shapes job boards actually use: "₹30L – ₹45L", "INR 25-40 LPA",
"₹3M – ₹4.5M", "$120k - $160k", "USD 90,000–120,000", "€70K", and structured
min/max/currency/interval fields.
"""
from __future__ import annotations

import re

_CURRENCY = {
    "₹": "INR", "rs": "INR", "rs.": "INR", "inr": "INR",
    "$": "USD", "usd": "USD", "us$": "USD",
    "€": "EUR", "eur": "EUR",
    "£": "GBP", "gbp": "GBP",
}
_UNIT = {
    "k": 1e3, "l": 1e5, "lakh": 1e5, "lakhs": 1e5, "lac": 1e5, "lacs": 1e5, "lpa": 1e5,
    "m": 1e6, "mn": 1e6, "million": 1e6, "cr": 1e7, "crore": 1e7, "crores": 1e7,
}
_INTERVAL = {"hour": 2080, "hr": 2080, "day": 260, "week": 52, "month": 12, "mo": 12, "year": 1, "yr": 1, "annum": 1}

_NUM = r"(\d{1,3}(?:,\d{2,3})+|\d+(?:\.\d+)?)"
_CUR = r"(₹|rs\.?|inr|us\$|\$|usd|€|eur|£|gbp)?"
_UNIT_RE = r"(k|lpa|lakhs?|lacs?|l|mn|million|m|crores?|cr)?"
_RANGE = re.compile(
    rf"{_CUR}\s*{_NUM}\s*{_UNIT_RE}\s*(?:-|–|—|to)\s*{_CUR}\s*{_NUM}\s*{_UNIT_RE}"
    r"(?:\s*(?:/|per|a|an)\s*(hour|hr|day|week|month|mo|year|yr|annum))?",
    re.I,
)
_SINGLE = re.compile(
    rf"{_CUR}\s*{_NUM}\s*{_UNIT_RE}(?:\s*(?:/|per|a|an)\s*(hour|hr|day|week|month|mo|year|yr|annum))?",
    re.I,
)


def _num(raw: str) -> float:
    return float(raw.replace(",", ""))


def to_lpa(amount: float, currency: str, fx, interval: str | None = None) -> float | None:
    """Convert an amount to LPA. ``fx`` maps currency code -> INR rate."""
    rate = fx(currency)
    if rate is None or amount <= 0:
        return None
    if interval:
        amount *= _INTERVAL.get(interval.lower().rstrip("s"), 1)
    return round(amount * rate / 1e5, 1)


def parse_salary(text: str, fx, default_currency: str | None = None) -> tuple[float | None, float | None]:
    """Find a salary band in free text and return (min_lpa, max_lpa)."""
    if not text:
        return None, None
    lowered = text.lower()
    m = _RANGE.search(lowered)
    if m:
        cur1, n1, u1, cur2, n2, u2, interval = m.groups()
        currency = _CURRENCY.get((cur1 or cur2 or "").lower()) or _infer_currency(lowered, u1 or u2, default_currency)
        unit2 = _UNIT.get((u2 or u1 or "").lower(), 1)
        unit1 = _UNIT.get((u1 or "").lower(), unit2)
        if currency:
            lo = to_lpa(_num(n1) * unit1, currency, fx, interval)
            hi = to_lpa(_num(n2) * unit2, currency, fx, interval)
            if _plausible(lo) and _plausible(hi):
                return min(lo, hi), max(lo, hi)
    for m in _SINGLE.finditer(lowered):
        cur, n, unit, interval = m.groups()
        if not cur and (unit or "").lower() not in _INR_UNITS:
            continue
        currency = _CURRENCY.get((cur or "").lower()) or _infer_currency(lowered, unit, default_currency)
        if not currency:
            continue
        value = to_lpa(_num(n) * _UNIT.get((unit or "").lower(), 1), currency, fx, interval)
        if _plausible(value):
            return value, value
    return None, None


_INR_UNITS = {"lpa", "l", "lakh", "lakhs", "lac", "lacs", "cr", "crore", "crores"}
_COMP_LINE = re.compile(r"salary|compensation|\bctc\b|\blpa\b|pay range|base pay|\bpay\b|₹|\$|€|£|inr|usd", re.I)


def _infer_currency(lowered: str, unit: str | None, default: str | None) -> str | None:
    if (unit or "").lower() in _INR_UNITS:
        return "INR"
    return default


def salary_from_description(text: str, fx) -> tuple[float | None, float | None]:
    """Only look at lines that talk about pay, so '$50M Series B' is ignored."""
    for line in (text or "").splitlines():
        if _COMP_LINE.search(line) and not re.search(r"raised|funding|series [a-f]|valuation|arr\b|revenue", line, re.I):
            lo, hi = parse_salary(line, fx)
            if lo:
                return lo, hi
    return None, None


def _plausible(lpa: float | None) -> bool:
    return lpa is not None and 3 <= lpa <= 1500


def structured_to_lpa(min_value, max_value, currency: str, fx, interval: str | None = None):
    """For boards that give numbers: Ashby, Lever salaryRange, RemoteOK, Himalayas."""
    interval_word = None
    if interval:
        low = interval.lower()
        for word in _INTERVAL:
            if word in low:
                interval_word = word
                break
    lo = to_lpa(float(min_value), currency, fx, interval_word) if min_value else None
    hi = to_lpa(float(max_value), currency, fx, interval_word) if max_value else None
    lo = lo if _plausible(lo) else None
    hi = hi if _plausible(hi) else None
    if lo and not hi:
        hi = lo
    if hi and not lo:
        lo = hi
    return lo, hi
