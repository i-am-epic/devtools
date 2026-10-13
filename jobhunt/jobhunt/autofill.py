"""Assisted apply: open the real application form and fill everything we know.

Works on any ATS form by reading each field's label, name, placeholder and
aria attributes, so Greenhouse, Lever, Ashby, Workable, SmartRecruiters and
most custom forms are covered without per-site scripts.

It deliberately stops short of pressing Submit. Custom questions, consent
boxes and the occasional CAPTCHA need a human, and a 30-second review is what
keeps 50 applications from turning into 50 slightly-wrong ones. When the page
shows a confirmation, the job is marked applied automatically.

Needs: pip install playwright && playwright install chromium
"""
from __future__ import annotations

import os
import re
import time
from pathlib import Path

from . import config
from .config import Profile

FIELD_RULES: list[tuple[str, str]] = [
    (r"first.?name|given.?name|\bfname\b", "first_name"),
    (r"last.?name|family.?name|surname|\blname\b", "last_name"),
    (r"e-?mail", "email"),
    (r"phone|mobile|contact number|whatsapp", "phone"),
    (r"linkedin", "linkedin"),
    (r"github", "github"),
    (r"portfolio|personal (?:web)?site|website|blog|other (?:website|link)", "portfolio"),
    (r"notice period", "notice_period"),
    (r"current (?:ctc|salary|compensation|annual)", "current_ctc"),
    (r"expected (?:ctc|salary|compensation)|salary expectation|desired (?:salary|compensation)", "expected_ctc"),
    (r"years of (?:professional |relevant |total )?experience|total experience|experience \(years\)", "years"),
    (r"current (?:company|employer|organi[sz]ation)|^org$|\borg\b|company name", "current_company"),
    (r"current (?:job )?title|current (?:role|position)|designation", "current_title"),
    (r"cover letter|additional information|anything else|message to (?:the )?hiring", "cover_letter"),
    (r"\bcity\b|current location|where are you (?:based|located)|^location$|location \(city\)", "location"),
    (r"full.?name|^name$|your name|legal name|\bname\b", "full_name"),
]
_SKIP = re.compile(r"referr|recruiter|manager'?s? name|school|university|college|degree|employer name \(previous|"
                   r"emergency|reference", re.I)
_CONFIRMED = re.compile(r"thank(?:s| you) for (?:applying|your application)|application (?:has been |was )?"
                        r"(?:submitted|received)|we(?:'ve| have) received your application|successfully applied",
                        re.I)

COLLECT_JS = """
() => Array.from(document.querySelectorAll('input, textarea, select')).map((el, i) => {
  el.setAttribute('data-jh', String(i));
  const labels = [];
  if (el.labels) for (const l of el.labels) labels.push(l.innerText || '');
  const by = el.getAttribute('aria-labelledby');
  if (by) by.split(/\\s+/).forEach(id => { const n = document.getElementById(id); if (n) labels.push(n.innerText || ''); });
  if (!labels.length) {
    const box = el.closest('fieldset, li, .field, .application-question, div');
    const l = box && box.querySelector('label, legend');
    if (l) labels.push(l.innerText || '');
  }
  const style = window.getComputedStyle(el);
  return {
    i, tag: el.tagName.toLowerCase(), type: (el.getAttribute('type') || '').toLowerCase(),
    name: el.name || '', id: el.id || '', placeholder: el.placeholder || '',
    aria: el.getAttribute('aria-label') || '', label: labels.join(' ').replace(/\\s+/g, ' ').trim().slice(0, 200),
    value: el.value || '',
    visible: !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length) && style.visibility !== 'hidden',
    required: !!el.required || el.getAttribute('aria-required') === 'true',
  };
})
"""


def values_for(profile: Profile, answers: dict[str, str], cover_letter: str) -> dict[str, str]:
    me = profile.me
    first, _, last = profile.name.partition(" ")
    return {
        "first_name": first, "last_name": last or first, "full_name": profile.name,
        "email": me.get("email", ""), "phone": me.get("phone", ""), "linkedin": me.get("linkedin", ""),
        "github": me.get("github", ""), "portfolio": me.get("portfolio", ""),
        "current_company": me.get("current_company", ""), "current_title": me.get("current_title", ""),
        "location": f"{me.get('city', '')}, India", "notice_period": me.get("notice_period", ""),
        "current_ctc": str(me.get("current_ctc_lpa") or ""),
        "expected_ctc": answers.get("Expected CTC", "").split(" ")[0] if answers else "",
        "years": str(me.get("years_experience", "")), "cover_letter": cover_letter,
    }


def classify_field(field: dict) -> str | None:
    descriptor = " ".join(field[k] for k in ("label", "name", "id", "placeholder", "aria")).lower()
    descriptor = descriptor.replace("_", " ").replace("-", " ")
    if not descriptor.strip() or _SKIP.search(descriptor):
        return None
    for pattern, key in FIELD_RULES:
        if re.search(pattern, descriptor):
            return key
    return None


def plan_fill(fields: list[dict], values: dict[str, str], resume: Path | None,
              letter_file: Path | None) -> tuple[list[tuple[int, str, str]], list[str]]:
    """Decide what goes where. Returns ([(index, kind, value)], [unfilled required labels])."""
    actions: list[tuple[int, str, str]] = []
    pending: list[str] = []
    files = [f for f in fields if f["type"] == "file"]
    for f in files:
        desc = f"{f['label']} {f['name']} {f['id']}".lower()
        if "cover" in desc and letter_file:
            actions.append((f["i"], "file", str(letter_file)))
        elif resume and ("resume" in desc or "cv" in desc.split() or len(files) == 1 or not desc.strip()):
            actions.append((f["i"], "file", str(resume)))
    for f in fields:
        if f["type"] in ("file", "hidden", "submit", "button", "checkbox", "radio", "password", "search") or \
                not f["visible"] or f["tag"] == "select":
            if f["required"] and f["visible"] and f["type"] not in ("hidden", "submit", "button", "file"):
                pending.append(f["label"] or f["name"] or f["placeholder"])
            continue
        key = classify_field(f)
        value = values.get(key or "", "")
        if key and value and not f["value"]:
            actions.append((f["i"], "fill", value))
        elif f["required"] and not f["value"]:
            pending.append(f["label"] or f["name"] or f["placeholder"])
    return actions, [p for p in pending if p]


def fill_page(page, values: dict[str, str], resume: Path | None, letter_file: Path | None) -> tuple[int, list[str]]:
    """Fill the form on an already-loaded page. Returns (fields filled, required fields left)."""
    _open_form(page)
    fields = page.evaluate(COLLECT_JS)
    actions, pending = plan_fill(fields, values, resume, letter_file)
    filled = 0
    for index, kind, value in actions:
        loc = page.locator(f'[data-jh="{index}"]')
        try:
            if kind == "file":
                loc.set_input_files(value)
            else:
                loc.fill(value)
            filled += 1
        except Exception as exc:
            print(f"  ! could not fill field {index}: {exc.__class__.__name__}")
    return filled, pending


def assist(url: str, profile: Profile, answers: dict, cover_letter: str, kit: Path,
           headless: bool = False, wait_minutes: int = 30) -> bool:
    """Open, fill, wait for the human to submit. Returns True if submission was detected."""
    try:
        from playwright.sync_api import sync_playwright
    except ImportError as exc:
        raise RuntimeError("pip install playwright && playwright install chromium") from exc

    resume = Path(os.path.expanduser(profile.me.get("resume", ""))) if profile.me.get("resume") else None
    if resume and not resume.exists():
        print(f"  ! resume not found at {resume}; upload it by hand")
        resume = None
    letter_file = kit / "cover_letter.txt"
    letter_file.write_text(cover_letter)
    values = values_for(profile, answers, cover_letter)

    with sync_playwright() as p:
        # A persistent profile keeps ATS logins (Workday, SmartRecruiters) between applications.
        ctx = p.chromium.launch_persistent_context(
            str(config.home() / "browser"), headless=headless,
            executable_path=os.environ.get("JOBHUNT_CHROMIUM") or None,
        )
        page = ctx.pages[0] if ctx.pages else ctx.new_page()
        page.goto(url, wait_until="domcontentloaded")
        filled, pending = fill_page(page, values, resume, letter_file)
        print(f"  filled {filled} fields" + (f"; still needs you: {', '.join(pending[:12])}" if pending else ""))
        if headless:
            ctx.close()
            return False
        print("  review the form, answer the rest, and press Submit in the browser. Waiting...")
        deadline = time.time() + wait_minutes * 60
        submitted = False
        while time.time() < deadline:
            try:
                if page.is_closed():
                    break
                if _CONFIRMED.search(page.inner_text("body")[:20000]) or re.search(
                        r"confirm|thank|success|submitted", page.url, re.I):
                    submitted = True
                    break
                page.wait_for_timeout(2000)
            except Exception:  # browser closed mid-poll
                break
        try:
            ctx.close()
        except Exception:
            pass
        return submitted


def _open_form(page) -> None:
    """Lever and some Greenhouse boards show the description first; click through to the form."""
    for text in ("Apply for this job", "Apply now", "Apply", "I'm interested"):
        try:
            btn = page.get_by_role("link", name=re.compile(rf"^{re.escape(text)}$", re.I)).first
            if btn.count() and btn.is_visible():
                btn.click()
                page.wait_for_load_state("domcontentloaded")
                return
        except Exception:
            continue
