"""Regenerate sitemap.xml.

The site is a single page: every tool is addressed by a fragment (/#json-formatter),
and crawlers treat a fragment as the same URL as the page it hangs off. Listing
one entry per tool would therefore be 90 duplicates of "/", which is noise at
best. The sitemap lists the one real URL.

(If per-tool indexing ever matters, the tools need real paths -- /t/json-formatter
served by the router -- and this script should be revisited then.)

    python scripts/generate_sitemap.py [base-url]
"""
import datetime as dt
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BASE = (sys.argv[1] if len(sys.argv) > 1 else "https://devtool.dev").rstrip("/")

today = dt.date.today().isoformat()

xml = f"""<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>{BASE}/</loc>
    <lastmod>{today}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>1.0</priority>
  </url>
</urlset>
"""

with open(os.path.join(ROOT, "sitemap.xml"), "w", encoding="utf-8", newline="\n") as handle:
    handle.write(xml)

print(f"sitemap.xml written for {BASE}/")
