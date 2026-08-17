"""Copy the nikbot agent definitions into the site and build their manifest.

Only the general-purpose `nikbot-*` agents are published. Project-specific
agents are skipped, and the script refuses to copy anything that mentions an
internal project name so a company-specific agent cannot leak into a public
site by accident.

    python scripts/build_agents.py [source-dir]
"""
import json
import os
import re
import shutil
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEST = os.path.join(ROOT, "agents")

DEFAULT_SOURCE = os.path.join(
    os.path.expanduser("~"), "OneDrive - ABB", "dev", "APM FM", ".github", "agents"
)

# Anything matching these is company-specific and must not be published.
FORBIDDEN = re.compile(
    r"\bAbb\b|\bABB\b|Genix|AbilityServices|APM\s*FM|DuckDB\b.*cgroup|ErrorSanitizer",
    re.IGNORECASE,
)

# Only publish the general-purpose set.
INCLUDE = re.compile(r"^nikbot-.*\.agent\.md$")


def parse_frontmatter(text):
    """Pull name/description out of the YAML frontmatter block."""
    match = re.match(r"^---\s*\n(.*?)\n---\s*\n(.*)$", text, re.DOTALL)
    if not match:
        return {}, text

    meta = {}
    key = None
    for line in match.group(1).split("\n"):
        if line.startswith("#") or not line.strip():
            continue
        field = re.match(r"^(\w[\w-]*):\s*(.*)$", line)
        if field:
            key = field.group(1).lower()
            value = field.group(2).strip()
            if value.startswith(('"', "'")) and value.endswith(('"', "'")) and len(value) > 1:
                value = value[1:-1]
            meta[key] = value
        elif key and line.startswith((" ", "\t")):
            meta[key] += " " + line.strip()

    return meta, match.group(2)


def short_title(name):
    """nikbot-unit-dotnet -> Unit Tests (.NET)"""
    stem = name.replace("nikbot-", "")
    special = {
        "pr": "Pull Request Review",
        "req": "Requirements Review",
        "arch": "Architecture",
        "bug": "Bug Hunt",
        "dev": "Developer",
        "docs": "Documentation",
        "perf": "Performance",
        "test": "Test Strategy",
        "unit-dotnet": "Unit Tests (.NET)",
        "unit-python": "Unit Tests (Python)",
        "upgrade-dotnet": "Upgrade (.NET)",
        "upgrade-python": "Upgrade (Python)",
        "sanity": "Sanity Check",
        "triage": "Triage",
        "summary": "Summary",
        "review": "Code Review",
        "security": "Security Review",
        "research": "Research",
        "explain": "Explain",
        "upgrade": "Dependency Upgrade",
    }
    return special.get(stem, stem.replace("-", " ").title())


ICONS = {
    "arch": "🏛", "bug": "🐛", "dev": "⚒", "docs": "📄", "explain": "💡",
    "perf": "⚡", "pr": "🔀", "req": "📋", "research": "🔎", "review": "👁",
    "sanity": "✅", "security": "🔒", "summary": "📝", "test": "🧪",
    "triage": "🚨", "unit-dotnet": "🧪", "unit-python": "🧪",
    "upgrade": "⬆", "upgrade-dotnet": "⬆", "upgrade-python": "⬆",
}


def main():
    source = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_SOURCE
    if not os.path.isdir(source):
        print(f"Source directory not found: {source}")
        sys.exit(1)

    os.makedirs(DEST, exist_ok=True)
    for stale in os.listdir(DEST):
        if stale.endswith((".md", ".json")):
            os.remove(os.path.join(DEST, stale))

    manifest = []
    skipped = []

    for filename in sorted(os.listdir(source)):
        if not INCLUDE.match(filename):
            skipped.append((filename, "not a general-purpose nikbot agent"))
            continue

        with open(os.path.join(source, filename), encoding="utf-8") as handle:
            text = handle.read()

        leak = FORBIDDEN.search(text)
        if leak:
            skipped.append((filename, f"mentions '{leak.group(0)}' - not published"))
            continue

        meta, body = parse_frontmatter(text)
        name = meta.get("name") or filename.replace(".agent.md", "")
        slug = name.replace("nikbot-", "")

        out_name = f"{name}.md"
        shutil.copyfile(os.path.join(source, filename), os.path.join(DEST, out_name))

        manifest.append({
            "id": f"agent-{slug}",
            "agent": name,
            "title": short_title(name),
            "icon": ICONS.get(slug, "🤖"),
            "description": meta.get("description", "").strip(),
            "file": out_name,
            "words": len(body.split()),
        })

    with open(os.path.join(DEST, "index.json"), "w", encoding="utf-8", newline="\n") as handle:
        json.dump({"version": 1, "agents": manifest}, handle, indent=2)
        handle.write("\n")

    print(f"published {len(manifest)} agents to agents/")
    for entry in manifest:
        print(f"  {entry['agent']:26} {entry['title']:24} {entry['words']:>5} words")
    if skipped:
        print(f"\nskipped {len(skipped)}:")
        for filename, why in skipped:
            print(f"  {filename:32} {why}")


if __name__ == "__main__":
    main()
