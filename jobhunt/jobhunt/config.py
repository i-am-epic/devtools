"""Profile loading and filesystem layout.

Everything personal (profile.toml, the database, generated kits, the dashboard)
lives outside version control: profile.toml is gitignored and the rest goes
under ``var/`` (or ``$JOBHUNT_HOME``).
"""
from __future__ import annotations

import copy
import os
import tomllib
from pathlib import Path

PKG_DIR = Path(__file__).resolve().parent
ROOT = PKG_DIR.parent
DATA_DIR = ROOT / "data"
EXAMPLE_PROFILE = ROOT / "profile.example.toml"


def home() -> Path:
    path = Path(os.environ.get("JOBHUNT_HOME", ROOT / "var")).expanduser()
    path.mkdir(parents=True, exist_ok=True)
    return path


def out_dir() -> Path:
    path = home() / "out"
    path.mkdir(parents=True, exist_ok=True)
    return path


def kits_dir() -> Path:
    path = home() / "kits"
    path.mkdir(parents=True, exist_ok=True)
    return path


def profile_path() -> Path:
    return Path(os.environ.get("JOBHUNT_PROFILE", ROOT / "profile.toml")).expanduser()


class Profile:
    """Thin read-only view over the parsed TOML with defaults filled in."""

    def __init__(self, data: dict):
        self.data = data

    # -- sections -----------------------------------------------------------
    @property
    def me(self) -> dict:
        return self.data.get("me", {})

    @property
    def target(self) -> dict:
        return self.data.get("target", {})

    @property
    def titles(self) -> dict:
        return self.target.get("titles", {})

    @property
    def highlights(self) -> list[dict]:
        return self.data.get("highlights", [])

    @property
    def stories(self) -> list[dict]:
        return self.data.get("stories", [])

    @property
    def llm(self) -> dict:
        return self.data.get("llm", {})

    @property
    def inbox(self) -> dict:
        return self.data.get("inbox", {})

    @property
    def sources(self) -> dict:
        return self.data.get("sources", {})

    @property
    def funding(self) -> dict:
        return self.data.get("funding", {})

    # -- convenience --------------------------------------------------------
    @property
    def name(self) -> str:
        return self.me.get("name", "")

    @property
    def first_name(self) -> str:
        return self.name.split()[0] if self.name else ""

    @property
    def min_lpa(self) -> float:
        return float(self.target.get("min_lpa", 25))

    def skill_weights(self) -> dict[str, int]:
        """keyword -> weight, highest weight wins if a keyword is listed twice."""
        weights: dict[str, int] = {}
        for weight, words in self.data.get("skills", {}).items():
            for word in words:
                w = int(weight)
                weights[word.lower()] = max(w, weights.get(word.lower(), 0))
        return weights

    def source_enabled(self, name: str) -> bool:
        return bool(self.sources.get(name, True))

    def fx(self, currency: str) -> float | None:
        currency = (currency or "").upper()
        if currency in ("INR", "₹", "RS"):
            return 1.0
        rates = {
            "USD": self.target.get("usd_inr", 88.0),
            "EUR": self.target.get("eur_inr", 95.0),
            "GBP": self.target.get("gbp_inr", 112.0),
        }
        return rates.get(currency)


def _deep_merge(base: dict, override: dict) -> dict:
    out = copy.deepcopy(base)
    for key, value in override.items():
        if isinstance(value, dict) and isinstance(out.get(key), dict):
            out[key] = _deep_merge(out[key], value)
        else:
            out[key] = value
    return out


def load_profile(path: Path | None = None) -> Profile:
    """Load profile.toml layered over profile.example.toml.

    The example supplies defaults for anything the user leaves out, so an
    older profile keeps working when new settings are added.
    """
    with open(EXAMPLE_PROFILE, "rb") as fh:
        defaults = tomllib.load(fh)
    path = path or profile_path()
    if path.exists():
        with open(path, "rb") as fh:
            user = tomllib.load(fh)
        # Arrays of tables (highlights, stories) replace rather than merge.
        data = _deep_merge(defaults, user)
    else:
        data = defaults
    return Profile(data)
