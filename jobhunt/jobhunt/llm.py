"""Optional Claude integration.

If the ``anthropic`` package is installed and credentials resolve
(ANTHROPIC_API_KEY, or a profile from ``ant auth login``), cover letters,
reply classification, company briefs and prep plans are written by Claude.
Otherwise every caller falls back to the deterministic templates, so the tool
never depends on it.
"""
from __future__ import annotations

import os
import sys

from .config import Profile

try:
    import anthropic
except ImportError:  # optional dependency
    anthropic = None

_client = None
_disabled_reason: str | None = None

SYSTEM = (
    "You help a backend software engineer in Bengaluru with their job search. "
    "Write plainly and specifically, in the candidate's own voice where asked. "
    "Use only facts present in the candidate profile and the job posting; never invent "
    "achievements, numbers, employers, or company facts. If something is unknown, leave it out."
)


def available(profile: Profile) -> bool:
    global _client, _disabled_reason
    if os.environ.get("JOBHUNT_NO_LLM") or not profile.llm.get("enabled", True):
        _disabled_reason = "disabled in profile or JOBHUNT_NO_LLM"
        return False
    if anthropic is None:
        _disabled_reason = "anthropic package not installed (pip install anthropic)"
        return False
    if _client is None:
        try:
            _client = anthropic.Anthropic()
        except Exception as exc:  # no credentials configured
            _disabled_reason = f"no Claude credentials ({exc.__class__.__name__})"
            return False
    return True


def complete(profile: Profile, prompt: str, *, max_tokens: int = 4000, effort: str | None = None) -> str | None:
    """One-shot completion; returns None on any failure so callers can fall back."""
    if not available(profile):
        return None
    try:
        response = _client.beta.messages.create(
            model=profile.llm.get("model", "claude-opus-5-5"),
            max_tokens=max_tokens,
            system=SYSTEM,
            messages=[{"role": "user", "content": prompt}],
            output_config={"effort": effort or profile.llm.get("effort", "medium")},
            # Re-run a policy decline on Anthropic's recommended fallback model.
            betas=["server-side-fallback-2026-07-01"],
            fallbacks="default",
        )
    except anthropic.AuthenticationError:
        print("  claude: authentication failed; using templates", file=sys.stderr)
        return None
    except anthropic.RateLimitError:
        print("  claude: rate limited; using templates", file=sys.stderr)
        return None
    except anthropic.APIStatusError as exc:
        print(f"  claude: API error {exc.status_code}; using templates", file=sys.stderr)
        return None
    except anthropic.APIConnectionError:
        print("  claude: network error; using templates", file=sys.stderr)
        return None
    if response.stop_reason == "refusal":
        return None
    text = "".join(block.text for block in response.content if block.type == "text").strip()
    return text or None


def why_disabled() -> str | None:
    return _disabled_reason
