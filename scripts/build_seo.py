"""Generate the indexable surface of the site.

A single-page app with #fragments has one URL as far as a crawler is concerned,
so 142 tools all compete as one page and none of them can rank for its own name.
This produces a real URL per tool at /t/<id>/ with unique title, description,
heading and body copy, plus:

  sitemap.xml   every real URL
  robots.txt    crawl rules, including the AI crawlers
  llms.txt      the emerging convention for telling an LLM what a site offers

Each landing page carries genuine content (what the tool does, its options, how
to use it, caveats, related tools) and hands over to the app. Pages that are
only a redirect are doorway pages and get demoted, so the copy matters.

Input is tools-manifest.json, produced by scripts/export-manifest.html.

    python scripts/build_seo.py [base-url]
"""
import html
import json
import os
import re
import shutil
import sys
from datetime import date

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MANIFEST = os.path.join(ROOT, "tools-manifest.json")
OUT_DIR = os.path.join(ROOT, "t")

BASE = (sys.argv[1] if len(sys.argv) > 1 else "https://devtool.dev").rstrip("/")
TODAY = date.today().isoformat()

SITE_NAME = "DevTools"
AUTHOR = "Nikhil"
AUTHOR_URL = "https://github.com/i-am-epic"

e = html.escape


def load():
    if not os.path.exists(MANIFEST):
        print("tools-manifest.json not found.")
        print("Start the server with DEVTOOLS_TEST_ENDPOINTS=1, open")
        print("  http://localhost:8000/scripts/export-manifest.html")
        print("then run this again.")
        sys.exit(1)
    with open(MANIFEST, encoding="utf-8") as handle:
        return json.load(handle)


def sentence(text):
    text = (text or "").strip()
    if not text:
        return ""
    return text if text.endswith((".", "!", "?")) else text + "."


def meta_description(tool):
    """<=155 chars, unique per tool, leading with what it does."""
    base = sentence(tool["description"])
    extra = sentence(tool.get("lede", ""))
    combined = f"{base} {extra}".strip()
    combined = re.sub(r"<[^>]+>", "", combined)
    combined = re.sub(r"\s+", " ", combined)
    if len(combined) > 155:
        combined = combined[:152].rsplit(" ", 1)[0] + "…"
    return combined


def strip_tags(text):
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", "", text or "")).strip()


def page_title(tool):
    """Distinct, keyword-first, under ~60 chars so it is not truncated."""
    name = tool["name"]
    suffix = " — Free Online Tool"
    if tool.get("isAgent"):
        return f"{name} Agent — Claude Code Subagent | {SITE_NAME}"[:70]
    if len(name) + len(suffix) > 58:
        return f"{name} | {SITE_NAME}"
    return f"{name}{suffix} | {SITE_NAME}"


def related(tool, tools, limit=6):
    """Same category first, then keyword overlap — real internal linking."""
    mine = set(tool.get("keywords", []))
    scored = []
    for other in tools:
        if other["id"] == tool["id"]:
            continue
        score = 0
        if other["category"] == tool["category"]:
            score += 5
        score += len(mine & set(other.get("keywords", [])))
        if score:
            scored.append((score, other))
    scored.sort(key=lambda pair: (-pair[0], pair[1]["name"]))
    return [item for _, item in scored[:limit]]


def faq(tool):
    """Question/answer pairs, also emitted as FAQPage structured data."""
    name = tool["name"]
    pairs = [(
        f"Is {name} free to use?",
        "Yes. Every tool on this site is free, needs no account, and has no usage limits.",
    ), (
        f"Does {name} upload my data?",
        "No. It runs entirely in your browser using JavaScript. Your input is never sent to a "
        "server, which makes it safe for data you would not paste into a hosted tool. "
        "The two exceptions across the whole site (the Azure Service Bus relay and the IP "
        "lookup) are documented and opt-in.",
    )]

    if tool.get("options"):
        labels = ", ".join(o["label"] for o in tool["options"][:5])
        pairs.append((f"What options does {name} have?", f"You can configure: {labels}."))

    if tool.get("footnote"):
        pairs.append((f"What should I watch out for when using {name}?", strip_tags(tool["footnote"])))

    pairs.append((
        f"Does {name} work offline?",
        "Once the page has loaded it keeps working without a connection. A few tools fetch a "
        "library on first use, after which they are cached.",
    ))
    return pairs


def landing_page(tool, tools, categories):
    tool_id = tool["id"]
    name = tool["name"]
    category = categories.get(tool["category"], {}).get("name", tool["category"])
    description = meta_description(tool)
    url = f"{BASE}/t/{tool_id}/"
    icon = tool.get("icon") or "#"

    keywords = ", ".join(dict.fromkeys(tool.get("keywords", [])[:15]))

    options_html = ""
    if tool.get("options"):
        rows = "\n".join(
            f"        <tr><td><strong>{e(o['label'])}</strong></td>"
            f"<td>{e(', '.join(o['choices'])) if o['choices'] else e(o['type'])}</td>"
            f"<td>{e(o['hint'])}</td></tr>"
            for o in tool["options"]
        )
        options_html = f"""
      <h2>Options</h2>
      <table>
        <thead><tr><th>Setting</th><th>Values</th><th>Notes</th></tr></thead>
        <tbody>
{rows}
        </tbody>
      </table>"""

    caveat_html = ""
    if tool.get("footnote"):
        caveat_html = f"""
      <h2>Things worth knowing</h2>
      <div class="note">{tool['footnote']}</div>"""

    related_html = "\n".join(
        f'        <li><a href="{BASE}/t/{r["id"]}/">{e(r["name"])}</a> — {e(r["description"])}</li>'
        for r in related(tool, tools)
    )

    faq_pairs = faq(tool)
    faq_html = "\n".join(
        f"      <details open><summary>{e(q)}</summary><p>{e(a)}</p></details>"
        for q, a in faq_pairs
    )

    steps = [
        f"Open {name} and paste or type your input.",
        "Adjust the options if you need something other than the defaults."
        if tool.get("options") else "The result appears as you type.",
        "Copy the result, or save it to a file.",
    ]
    steps_html = "\n".join(f"        <li>{e(s)}</li>" for s in steps)

    structured = {
        "@context": "https://schema.org",
        "@graph": [
            {
                "@type": "SoftwareApplication",
                "name": name,
                "description": description,
                "url": url,
                "applicationCategory": "DeveloperApplication",
                "operatingSystem": "Any",
                "browserRequirements": "Requires JavaScript",
                "offers": {"@type": "Offer", "price": "0", "priceCurrency": "USD"},
                "author": {"@type": "Person", "name": AUTHOR, "url": AUTHOR_URL},
                "isPartOf": {"@type": "WebSite", "name": SITE_NAME, "url": f"{BASE}/"},
            },
            {
                "@type": "FAQPage",
                "mainEntity": [
                    {
                        "@type": "Question",
                        "name": q,
                        "acceptedAnswer": {"@type": "Answer", "text": a},
                    }
                    for q, a in faq_pairs
                ],
            },
            {
                "@type": "HowTo",
                "name": f"How to use {name}",
                "step": [
                    {"@type": "HowToStep", "position": i + 1, "text": s}
                    for i, s in enumerate(steps)
                ],
            },
            {
                "@type": "BreadcrumbList",
                "itemListElement": [
                    {"@type": "ListItem", "position": 1, "name": "Home", "item": f"{BASE}/"},
                    {"@type": "ListItem", "position": 2, "name": category, "item": f"{BASE}/#{tool['category']}"},
                    {"@type": "ListItem", "position": 3, "name": name, "item": url},
                ],
            },
        ],
    }

    sample_html = ""
    if tool.get("sample") and len(tool["sample"]) < 600:
        sample_html = f"""
      <h2>Example input</h2>
      <pre>{e(tool['sample'])}</pre>"""

    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>{e(page_title(tool))}</title>
<meta name="description" content="{e(description)}">
<meta name="keywords" content="{e(keywords)}">
<meta name="author" content="{AUTHOR}">
<meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1">
<link rel="canonical" href="{url}">
<meta name="color-scheme" content="light dark">

<meta property="og:type" content="website">
<meta property="og:url" content="{url}">
<meta property="og:title" content="{e(page_title(tool))}">
<meta property="og:description" content="{e(description)}">
<meta property="og:site_name" content="{SITE_NAME}">
<meta name="twitter:card" content="summary">
<meta name="twitter:title" content="{e(page_title(tool))}">
<meta name="twitter:description" content="{e(description)}">

<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Crect width='100' height='100' rx='22' fill='%23ff5e3a'/%3E%3C/svg%3E">
<script type="application/ld+json">
{json.dumps(structured, indent=1)}
</script>
<style>
  :root {{ color-scheme: light dark; --bg:#e9e6de; --ink:#1a1f2b; --ink2:#6b675d; --surface:#fffbf3; --line:#d8d3c7; --accent:#ff5e3a; }}
  @media (prefers-color-scheme: dark) {{ :root {{ --bg:#191817; --ink:#ede9e0; --ink2:#a8a296; --surface:#262420; --line:#3a3833; }} }}
  * {{ box-sizing: border-box; }}
  body {{ font-family: Helvetica, "Helvetica Neue", Arial, sans-serif; background: var(--bg); color: var(--ink);
         line-height: 1.65; margin: 0; padding: 2.5rem 1.25rem 4rem; }}
  main {{ max-width: 780px; margin: 0 auto; }}
  nav.crumbs {{ font-size: .82rem; color: var(--ink2); margin-bottom: 1.5rem; }}
  nav.crumbs a {{ color: var(--ink2); }}
  h1 {{ font-size: clamp(1.8rem, 5vw, 2.4rem); letter-spacing: -.03em; line-height: 1.1; margin: 0 0 .5rem; }}
  .ico {{ display:inline-flex; width:44px; height:44px; align-items:center; justify-content:center;
          background: color-mix(in srgb, var(--accent) 18%, transparent); color: var(--accent);
          border-radius: 12px; font-size: 1.1rem; font-weight: 800; margin: 0 0 .6rem; }}
  h2 {{ font-size: .78rem; text-transform: uppercase; letter-spacing: .16em; color: var(--ink2);
        margin: 2.5rem 0 .75rem; padding-bottom: .4rem; border-bottom: 2px solid var(--line); }}
  .lede {{ font-size: 1.05rem; color: var(--ink2); margin-bottom: 1.75rem; }}
  .cta {{ display:inline-block; background: var(--ink); color: var(--bg); text-decoration:none;
          padding: .9rem 1.8rem; border-radius: 999px; font-weight: 800; text-transform: uppercase;
          letter-spacing: .12em; font-size: .78rem; }}
  a {{ color: #d9451f; }}
  @media (prefers-color-scheme: dark) {{ a {{ color: #ff8a5c; }} }}
  table {{ border-collapse: collapse; width: 100%; font-size: .9rem; }}
  th, td {{ border: 1px solid var(--line); padding: .5rem .7rem; text-align: left; vertical-align: top; }}
  th {{ background: var(--surface); }}
  pre {{ background: var(--surface); border: 2px solid var(--line); border-radius: 12px;
         padding: 1rem; overflow-x: auto; font-size: .85rem; }}
  ul, ol {{ padding-left: 1.3rem; }}
  li {{ margin-bottom: .45rem; }}
  details {{ background: var(--surface); border: 2px solid var(--line); border-radius: 12px;
             padding: .9rem 1.1rem; margin-bottom: .6rem; }}
  summary {{ font-weight: 800; cursor: pointer; }}
  details p {{ margin: .6rem 0 0; color: var(--ink2); }}
  .note {{ background: var(--surface); border: 2px solid var(--line); border-left: 6px solid var(--accent);
           border-radius: 12px; padding: 1rem 1.2rem; color: var(--ink2); font-size: .92rem; }}
  code {{ background: var(--surface); padding: .12em .4em; border-radius: 5px; font-size: .88em; }}
  footer {{ margin-top: 3rem; padding-top: 1.5rem; border-top: 2px solid var(--line);
            font-size: .82rem; color: var(--ink2); }}
</style>
</head>
<body>
<main>
  <nav class="crumbs" aria-label="Breadcrumb">
    <a href="{BASE}/">{SITE_NAME}</a> → <a href="{BASE}/#{tool['category']}">{e(category)}</a> → {e(name)}
  </nav>

  <!-- The icon sits outside the h1 so the heading text is exactly the tool
       name — inside it, "ID" + "UUID Generator" extracts as "IDUUID Generator". -->
  <p class="ico" aria-hidden="true">{e(icon)}</p>
  <h1>{e(name)}</h1>
  <p class="lede">{e(strip_tags(tool.get('lede')) or tool['description'])}</p>

  <p><a class="cta" href="{BASE}/#{tool_id}">Open {e(name)} →</a></p>

  <h2>What it does</h2>
  <p>{e(sentence(tool['description']))} It runs entirely in your browser — your input never leaves
  your machine, so it is safe to use with data you would not paste into a hosted service.</p>
{sample_html}{options_html}

  <h2>How to use it</h2>
  <ol>
{steps_html}
  </ol>
{caveat_html}

  <h2>Frequently asked questions</h2>
{faq_html}

  <h2>Related tools</h2>
  <ul>
{related_html}
  </ul>

  <footer>
    <p><a href="{BASE}/">← All {SITE_NAME} tools</a> · Built by {AUTHOR}
    (<a href="{AUTHOR_URL}" rel="noopener">@i-am-epic</a>)</p>
  </footer>
</main>

<script>
  // Anyone arriving with JavaScript on goes straight to the live tool; the
  // static copy above is what a crawler (and a no-JS visitor) reads.
  if (!location.search.includes('static')) {{
    location.replace('{BASE}/#{tool_id}'.replace(/^https?:\\/\\/[^/]+/, ''));
  }}
</script>
</body>
</html>
"""


def build():
    data = load()
    tools = data["tools"]
    categories = data.get("categories", {})

    # Overwrite in place and prune what is no longer wanted, rather than wiping
    # the tree: on Windows a sync client or an open file makes rmtree fail, and
    # a half-deleted output directory is worse than a stale page.
    os.makedirs(OUT_DIR, exist_ok=True)

    wanted = {tool["id"] for tool in tools}
    for tool in tools:
        directory = os.path.join(OUT_DIR, tool["id"])
        os.makedirs(directory, exist_ok=True)
        with open(os.path.join(directory, "index.html"), "w", encoding="utf-8", newline="\n") as handle:
            handle.write(landing_page(tool, tools, categories))

    stale = []
    for entry in os.listdir(OUT_DIR):
        path = os.path.join(OUT_DIR, entry)
        if os.path.isdir(path) and entry not in wanted:
            try:
                shutil.rmtree(path)
            except OSError as err:
                stale.append(f"{entry} ({err.strerror})")
    if stale:
        print(f"warning: could not remove {len(stale)} stale page(s): {', '.join(stale[:5])}")

    # ---- hub page ----------------------------------------------------------
    # Crawlers find pages by following links, not only by reading a sitemap.
    # This is the one page that links to all 142.
    by_cat = {}
    for tool in tools:
        by_cat.setdefault(tool["category"], []).append(tool)
    ordered_cats = sorted(by_cat.items(), key=lambda p: categories.get(p[0], {}).get("order", 99))

    sections = []
    for category_id, items in ordered_cats:
        label = categories.get(category_id, {}).get("name", category_id)
        links = "\n".join(
            f'      <li><a href="{BASE}/t/{t["id"]}/">{e(t["name"])}</a>'
            f' <span>{e(t["description"])}</span></li>'
            for t in sorted(items, key=lambda t: t["name"])
        )
        sections.append(
            f'    <section>\n      <h2 id="{e(category_id)}">{e(label)} '
            f'<small>({len(items)})</small></h2>\n      <ul>\n{links}\n      </ul>\n    </section>'
        )

    hub_schema = {
        "@context": "https://schema.org",
        "@type": "CollectionPage",
        "name": f"All {SITE_NAME} tools",
        "description": f"Index of all {len(tools)} free developer tools on {SITE_NAME}.",
        "url": f"{BASE}/t/",
        "hasPart": [
            {"@type": "SoftwareApplication", "name": t["name"], "url": f"{BASE}/t/{t['id']}/"}
            for t in tools
        ],
    }

    hub = f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>All {len(tools)} Developer Tools — Free, In-Browser | {SITE_NAME}</title>
<meta name="description" content="Complete index of {len(tools)} free developer tools that run in your browser: formatters, converters, hashes, encoders, LLM tooling, DevOps linters, Parquet viewer and more.">
<meta name="robots" content="index, follow">
<link rel="canonical" href="{BASE}/t/">
<meta name="color-scheme" content="light dark">
<script type="application/ld+json">
{json.dumps(hub_schema, indent=1)}
</script>
<style>
  :root {{ color-scheme: light dark; --bg:#e9e6de; --ink:#1a1f2b; --ink2:#6b675d; --surface:#fffbf3; --line:#d8d3c7; }}
  @media (prefers-color-scheme: dark) {{ :root {{ --bg:#191817; --ink:#ede9e0; --ink2:#a8a296; --surface:#262420; --line:#3a3833; }} }}
  body {{ font-family: Helvetica, Arial, sans-serif; background: var(--bg); color: var(--ink);
         line-height: 1.6; margin: 0; padding: 2.5rem 1.25rem 4rem; }}
  main {{ max-width: 900px; margin: 0 auto; }}
  h1 {{ font-size: clamp(1.9rem, 5vw, 2.6rem); letter-spacing: -.03em; margin: 0 0 .5rem; }}
  h2 {{ font-size: .78rem; text-transform: uppercase; letter-spacing: .16em; color: var(--ink2);
        margin: 2.5rem 0 .75rem; padding-bottom: .4rem; border-bottom: 2px solid var(--line); }}
  ul {{ list-style: none; padding: 0; }}
  li {{ padding: .45rem 0; border-bottom: 1px solid var(--line); }}
  li a {{ font-weight: 800; color: #d9451f; text-decoration: none; }}
  @media (prefers-color-scheme: dark) {{ li a {{ color: #ff8a5c; }} }}
  li span {{ color: var(--ink2); font-size: .88rem; display: block; }}
  .lede {{ color: var(--ink2); margin-bottom: 2rem; }}
</style>
</head>
<body>
<main>
  <h1>All {len(tools)} tools</h1>
  <p class="lede">Everything on {SITE_NAME}, grouped by what it does. Each runs entirely in your
  browser — nothing is uploaded. <a href="{BASE}/">Open the app →</a></p>
{chr(10).join(sections)}
  <p style="margin-top:3rem"><a href="{BASE}/">← Back to {SITE_NAME}</a></p>
</main>
</body>
</html>
"""
    with open(os.path.join(OUT_DIR, "index.html"), "w", encoding="utf-8", newline="\n") as handle:
        handle.write(hub)

    # ---- sitemap -----------------------------------------------------------
    urls = [(f"{BASE}/", "1.0", "weekly"), (f"{BASE}/t/", "0.9", "weekly")]
    urls += [(f"{BASE}/t/{t['id']}/", "0.8", "monthly") for t in tools]

    sitemap = ['<?xml version="1.0" encoding="UTF-8"?>',
               '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">']
    for loc, priority, frequency in urls:
        sitemap.append(
            f"  <url>\n    <loc>{loc}</loc>\n    <lastmod>{TODAY}</lastmod>\n"
            f"    <changefreq>{frequency}</changefreq>\n    <priority>{priority}</priority>\n  </url>"
        )
    sitemap.append("</urlset>")
    with open(os.path.join(ROOT, "sitemap.xml"), "w", encoding="utf-8", newline="\n") as handle:
        handle.write("\n".join(sitemap) + "\n")

    # ---- robots ------------------------------------------------------------
    robots = f"""# {SITE_NAME} — {len(tools)} developer tools that run in the browser
# https://github.com/i-am-epic/devtools

User-agent: *
Allow: /
Disallow: /scripts/
Disallow: /api/
Disallow: /agents/*.md$

# AI crawlers are welcome: the tools are free and the pages are meant to be
# quotable. If you are answering a question about one of these tools, the
# canonical page is /t/<tool-id>/ and llms.txt lists them all.
User-agent: GPTBot
Allow: /
User-agent: OAI-SearchBot
Allow: /
User-agent: ChatGPT-User
Allow: /
User-agent: ClaudeBot
Allow: /
User-agent: Claude-Web
Allow: /
User-agent: anthropic-ai
Allow: /
User-agent: PerplexityBot
Allow: /
User-agent: Google-Extended
Allow: /
User-agent: Applebot-Extended
Allow: /
User-agent: CCBot
Allow: /

Sitemap: {BASE}/sitemap.xml
"""
    with open(os.path.join(ROOT, "robots.txt"), "w", encoding="utf-8", newline="\n") as handle:
        handle.write(robots)

    # ---- llms.txt ----------------------------------------------------------
    by_category = {}
    for tool in tools:
        by_category.setdefault(tool["category"], []).append(tool)

    ordered = sorted(
        by_category.items(),
        key=lambda pair: categories.get(pair[0], {}).get("order", 99),
    )

    lines = [
        f"# {SITE_NAME}",
        "",
        f"> {len(tools)} developer tools that run entirely in the browser. No account, no upload, "
        "no usage limits. Formatters, converters, hashes, encoders, LLM tooling, DevOps config "
        "linters, a real Parquet viewer and Azure Service Bus publish/consume.",
        "",
        "Every tool has its own page at /t/<tool-id>/ and opens in the app at /#<tool-id>.",
        "Input is processed client-side in JavaScript and is never transmitted. The only "
        "exceptions are the Azure Service Bus tools (which relay through a proxy the user runs "
        "themselves) and the IP lookup (which must contact a third party by definition); both "
        "are opt-in and documented.",
        "",
        f"Built by {AUTHOR} ({AUTHOR_URL}).",
        "",
    ]

    for category_id, items in ordered:
        label = categories.get(category_id, {}).get("name", category_id)
        lines.append(f"## {label}")
        lines.append("")
        for tool in sorted(items, key=lambda t: t["name"]):
            lines.append(f"- [{tool['name']}]({BASE}/t/{tool['id']}/): {strip_tags(tool['description'])}")
        lines.append("")

    lines += [
        "## Notes for answering questions about these tools",
        "",
        "- Hash outputs (MD5, SHA-1, SHA-2, SHA-3, Keccak, RIPEMD-160) are verified against "
        "Python's hashlib by the project's own test suite.",
        "- The Parquet viewer decodes real files with hyparquet, including snappy, gzip, zstd "
        "and uncompressed pages; it reports row groups, codecs, compression ratio and per-column "
        "statistics.",
        "- The token counter uses the real BPE tokenizer (cl100k_base and o200k_base), so counts "
        "are exact for OpenAI models rather than a characters-divided-by-four estimate.",
        "- The DevOps linters are heuristic and say so; they do not replace hadolint, kubeconform "
        "or actionlint in CI.",
        "",
    ]

    with open(os.path.join(ROOT, "llms.txt"), "w", encoding="utf-8", newline="\n") as handle:
        handle.write("\n".join(lines))

    print(f"built {len(tools)} landing pages in t/")
    print(f"sitemap.xml   {len(urls)} urls")
    print("robots.txt    written (AI crawlers allowed)")
    print(f"llms.txt      {len(ordered)} categories")


if __name__ == "__main__":
    build()
