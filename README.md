# DevTools

**148 developer tools** that run in your browser — formatters, converters, hashes,
encoders, LLM tooling, DevOps config linters, a real Parquet viewer, Azure Service Bus
publish/consume, and Nik's agent definitions.

Two rules the project holds itself to:

1. **Every listed tool works.** There are no "coming soon" tiles and nothing returns
   placeholder data. If it appears on the page, it does the thing it says.
2. **Your data stays in your browser.** The only exceptions are called out explicitly
   below, and both are opt-in.

---

## Running it

```bash
python server.py 8000
```

Then open <http://localhost:8000>. No build step, no `npm install`, no dependencies.

`server.py` does two jobs: it serves the static site, and it provides the relay the
Service Bus tools need (see [Azure Service Bus](#azure-service-bus)). If you only want
the client-side tools, any static server will do — but the Service Bus tools will tell
you the relay is missing.

### Docker

```bash
docker compose up --build
```

Serves on <http://localhost:8080>. The container binds to all interfaces internally but
compose publishes it to `127.0.0.1` only, because the relay will forward any connection
string it is handed.

### Deploying to Vercel

Push the repository. `api/servicebus.js` and `api/health.js` are picked up as serverless
functions automatically, so the Service Bus tools work in production too.

---

## What's in it

| Category | Tools |
| --- | --- |
| **AI & LLM** | Token counter (real BPE), cost calculator, prompt template renderer, chat API payload builder, JSONL toolkit |
| **Developer Utilities** | ID decoder (UUID/ULID/ObjectId/Snowflake), Unicode inspector, CIDR calculator, Kubernetes quantities, duration converter, semver checker, cURL converter, .env converter, JWT signer, HTTP reference, mock data, Markdown tables, line-ending inspector |
| **DevOps & Config** | YAML beautifier, Dockerfile linter, Docker Compose validator, Kubernetes manifest checker, GitHub Actions checker, Kubernetes Secret decoder, .gitignore generator |
| **Security** | Password strength checker, TOTP/2FA generator, security headers analyser, CSP builder, Basic auth encoder/decoder, secret scanner |
| **Diagrams** | Mermaid viewer, Mermaid generator, Mermaid validator, Markdown Reader (renders Mermaid inline) |
| **JSON Power Tools** | JSON→TypeScript/Python/Go/C#/Rust/Java, JSON Schema generator, JSONPath evaluator, structural JSON diff |
| **Nik Agents** | 20 subagent definitions for Claude Code and Copilot |
| **Text** | Word counter, case converter, line sorter, whitespace remover, lorem ipsum, text↔hex, string escaper, regex tester, text diff |
| **URL** | URL parser, encoder, decoder, slug generator, query string builder |
| **HTML, CSS & JS** | Formatters and minifiers for each, HTML encode/decode/escape/unescape, HTML checker, HTML stripper, CSS checker, JS escape/unescape, Markdown↔HTML |
| **JSON, XML & YAML** | JSON format/minify/validate/escape/unescape, XML format/minify/validate/escape/unescape, XML↔JSON, YAML↔JSON, YAML validator, PHP array↔JSON |
| **Data & Tables** | **Parquet viewer**, CSV↔JSON, CSV to Excel |
| **SQL** | Formatter (8 dialects), minifier, escaper |
| **Hashing & Crypto** | Hash generator (12 algorithms at once), HMAC generator, bcrypt generate/verify, JWT decoder |
| **Encoding** | Base64 / Base32 / Base58 encode, decode and hex conversion; file↔Base64 |
| **Generators** | Password, passphrase, PIN, UUID (v4/v7), random data |
| **Visual & Colour** | Colour converter with WCAG contrast, QR generator, QR reader, Mermaid viewer |
| **Time** | Timestamp converter, cron expression parser |
| **Network & Client** | User agent inspector, IP lookup |
| **Azure Service Bus** | Publisher, consumer |

### Getting around

Tools open **full screen**, not in a dialog — the editor panes take whatever height the
window has.

| | |
| --- | --- |
| `Ctrl`+`Space` · `Alt`+`Space` · `Ctrl`/`Cmd`+`K` · `/` | quick search |
| `↑` `↓` then `↵` | pick a tool |
| `Esc` | back to the grid |
| `#json-formatter` in the URL | opens that tool directly |

The shortcuts only work while the page has focus — a web page cannot claim a global
OS hotkey. On Windows, `Alt`+`Space` is sometimes swallowed by the window menu before
the page sees it, which is why `Ctrl`+`Space` is the one shown in the search box.

---

## The parts worth explaining

### Parquet viewer

Reads real Parquet files with [hyparquet](https://github.com/hyparam/hyparquet). Open as
many files as you like and it will:

- decode the data (snappy, gzip, zstd, brotli, lz4, or uncompressed)
- show the footer metadata: row groups, per-column codecs, encodings, compressed vs
  uncompressed sizes, compression ratio, bytes per row, and whatever the writer left in
  the key/value metadata
- compute per-column statistics from the actual values — null counts, distinct counts,
  min/max/mean/median/stddev, and the most frequent values
- filter with a small query language: `age > 30 AND city = 'London'`, plus `LIKE`, `IN`,
  `IS NULL` and parentheses
- sort by any column, and export the current selection to CSV, JSON or NDJSON
- **stack several files into one table**, or compare their schemas side by side and flag
  columns whose types disagree

Nested columns (`LIST`, `MAP`, `STRUCT`) are shown as one column and summarised, e.g.
`LIST<STRING>` or `STRUCT{k, n}`.

### Azure Service Bus

The Service Bus REST API sends no CORS headers, so **a browser page cannot call it
directly**. This is why so many "online Service Bus tools" only simulate sending — the
version of this tool that shipped previously did exactly that.

Instead, requests go to `/api/servicebus` on your own machine, which signs a SAS token
and forwards the call. Two implementations, kept behaviourally identical and verified to
produce byte-identical tokens:

- `server.py` — local and Docker, Python standard library only
- `api/servicebus.js` — Vercel serverless, `node:crypto` only

**Publisher** sends to a queue or topic with broker properties (message id, session id,
correlation id, subject, TTL) and arbitrary application properties, optionally repeating
a message N times.

**Consumer** reads from a queue or `topic/subscriptions/name` in either mode:

- *Peek-lock* — the message is locked, not removed. Inspect it, then **complete**
  (remove), **abandon** (release for redelivery) or **renew the lock**. This lets you
  look at live traffic without consuming it.
- *Receive and delete* — destructive read.

It can also poll continuously, and export everything it has collected as JSON.

Connection strings are only ever stored in your browser's `localStorage`, and only if you
press Save.

### Markdown Reader

Open a `.md` file (or drag one in) and read it rendered the way a repository would show
it: GFM tables, task lists, footnotes, heading anchors, a generated table of contents, and
**Mermaid diagrams rendered in place**. Export to a self-contained HTML file, or print to
PDF.

Markdown permits raw HTML and the input is arbitrary, so the rendered output goes through
`js/lib/sanitize.js` — an allowlist of elements and attributes — before it reaches the
page. Scripts, event handlers, `javascript:` URLs, iframes and style blocks are removed.

### DevOps linters

`yaml-formatter` reparses and re-emits YAML, so the output is guaranteed equivalent (and
it warns about the Norway problem — unquoted `NO` becoming `false`).

The four linters check the things that actually cause incidents rather than schema
conformance:

- **Dockerfile** — `COPY . .` before the dependency install (rebuilds everything on any
  source change), `apt-get install` split from `apt-get update`, missing `USER`, secrets
  baked into layers, shell-form `CMD` (your process is not PID 1 and never sees SIGTERM).
- **Docker Compose** — duplicate published host ports, `depends_on` naming a service that
  does not exist, `privileged: true`, host root mounts, literal secrets.
- **Kubernetes** — unpinned images, missing resource limits and probes, missing
  `runAsNonRoot`, inline secret values, deprecated API versions.
- **GitHub Actions** — actions pinned to a moving branch, `pull_request_target`, and
  script injection (interpolating `${{ github.event.* }}` straight into a `run:` block
  lets a PR title execute code on your runner).

Each says in its footnote what it does not cover, and none replaces `hadolint`,
`kubeconform` or `actionlint` in CI.

### Environments

Postman-style variables you set once and use anywhere with `{{name}}`. They can be
**exported to a JSON file and imported back** — for moving between machines or browsers,
or keeping a backup.

Import handles name clashes three ways (keep both / replace / skip), accepts a bare array
or a single environment object as well as this tool's own export, and regenerates ids so
an import can never overwrite an unrelated environment.

An export contains your variable **values in plain text**, including connection strings
and API keys. The tool says so next to the button. Do not commit one.

### Nik Agents

The `nikbot-*` subagent definitions — architecture, bug hunting, code review, security
review, performance, requirements, test strategy, upgrades and more. Each one shows its
description and full instructions, with buttons to copy or download the `.md`.

They come from `agents/index.json`, generated by `scripts/build_agents.py`, which only
publishes the general-purpose set and refuses to copy any agent that mentions an internal
project name.

### Hashing

MD5, SHA-1, SHA-224, SHA-256, SHA-384, SHA-512, SHA3-224/256/384/512, Keccak-256 and
RIPEMD-160, all computed at once so you can match a checksum without knowing which
algorithm produced it. SHA-1/256/384/512 come from WebCrypto; the rest are implemented in
`js/lib/hashes.js` because WebCrypto does not provide them.

Those implementations are checked against Python's `hashlib` — see [Tests](#tests).

---

## What leaves your machine

Almost nothing, but be precise about it:

| | |
| --- | --- |
| **Service Bus tools** | Send your connection string and messages to the relay running on your own machine, which forwards them to Azure. Nothing goes anywhere else. |
| **My IP Address** | Queries `ipapi.co`, which necessarily sees your IP. Button-triggered — it does nothing until you ask. |
| **Third-party libraries** | Loaded from jsDelivr on demand, and only for the tools that need them (Parquet, YAML, Markdown, Terser, SheetJS, bcrypt, QR, Mermaid, SQL formatter). Your *data* is never sent with them. |

Everything else — hashing, encoding, formatting, Parquet parsing, QR generation — happens
locally.

---

## Search visibility

A single-page app with `#fragments` is **one URL** to a crawler, so all 148 tools would
compete as a single page and none could rank for its own name. So the build also produces
a real indexable surface:

```bash
# 1. export the catalogue from the browser (Python cannot run the JS registry)
DEVTOOLS_TEST_ENDPOINTS=1 python server.py 8000
#    then open http://localhost:8000/scripts/export-manifest.html

# 2. build the pages
python scripts/build_seo.py https://your-domain.example
```

That writes:

| | |
| --- | --- |
| `/t/<tool-id>/` | a landing page per tool — unique title, meta description, `<h1>`, options table, how-to, FAQ, related tools (~1,300 words), and SoftwareApplication + FAQPage + HowTo + BreadcrumbList structured data |
| `/t/` | a hub page linking every tool, so crawlers find them by following links rather than only via the sitemap |
| `sitemap.xml` | every real URL |
| `robots.txt` | crawl rules, explicitly allowing GPTBot, ClaudeBot, PerplexityBot, Google-Extended and friends |
| `llms.txt` | the emerging convention for telling a language model what a site offers, with per-tool links and notes on what is verified |

Pages carry real content rather than a bare redirect, because a page that only redirects
is a doorway page and gets demoted. Visitors with JavaScript are handed straight to the
live tool; the static copy is what a crawler and a no-JS visitor read.

Regenerate after adding or renaming a tool — the smoke test will still pass without it,
but the new tool will have no page.

---

## Architecture

```
index.html            page shell
styles.css            design system (light + dark)
server.py             static server + Service Bus relay
api/                  Vercel serverless equivalents
js/
  app.js              wiring: search, categories, theme, routing
  core/
    ConfigManager.js  reads the tool registry
    ToolFactory.js    registry entry -> tool instance
    SimpleTool.js     the declarative tool engine
    SearchService.js  ranked search
    UIManager.js      grid + modal
    BaseTool.js       interface every tool implements
  lib/                bytes, hashes, tabular, wordlist, loader, servicebus
  tools/
    registry.js       THE source of truth for what exists
    specs/            declarative tools, grouped by category
    *.js              tools with bespoke UIs
```

Most tools are "text in, options, text out", so they are written as **spec objects** and
rendered by `SimpleTool` rather than hand-built:

```js
{
    id: 'slug-generator',
    name: 'Slug Generator',
    description: 'Turn any text into a clean, SEO-friendly URL slug.',
    category: 'url',
    icon: '/-/',
    keywords: ['slug', 'slugify', 'url', 'seo'],
    spec: {
        lede: 'Accents are folded to ASCII and words joined by a separator.',
        input: { label: 'Text', sample: 'Crème Brûlée & Café' },
        output: { label: 'Slug', filename: 'slug.txt' },
        options: [
            { id: 'lower', type: 'checkbox', label: 'Lowercase', default: true },
        ],
        run: ({ input, options }) => slugify(input, options),
    },
}
```

`run` receives `{ input, options, bytes, fileName, tool }`, may be async, and returns a
string or `{ output, extraHtml, note }`. Throwing shows the message in an error banner —
so validation is just `throw new Error('...')`.

Tools needing a bespoke interface (Parquet, Service Bus, diff, Mermaid, CSV to Excel)
implement `BaseTool` directly and provide `toolClass` instead of `spec`.

Adding a tool means writing the object and importing it in `registry.js`. There is no
separate config file to keep in sync — that is deliberate: the previous version listed
133 tools in JSON while only 10 existed.

---

## Tests

Open these in a browser with the server running:

| | |
| --- | --- |
| `/scripts/verify-hashes.html` | Every hash and HMAC against vectors from Python's `hashlib` |
| `/scripts/smoke-test.html` | Runs every tool against its own sample input |
| `/scripts/newtools-test.html` | Correctness of the AI, devx and codegen tools |
| `/scripts/devops-test.html` | DevOps linters, Mermaid generation, and the HTML sanitiser |
| `/scripts/parquet-test.html` | Real Parquet files: codecs, types, filters, statistics |
| `/scripts/tools-test.html` | Diff algorithm, xlsx round-trip, encoding round-trips |
| `/scripts/servicebus-js-test.html` | Confirms the Node and Python relays agree exactly |

And from a terminal:

```bash
python scripts/test_servicebus.py
```

Regenerating inputs:

```bash
python scripts/gen_hash_vectors.py > scripts/hash-vectors.json
python scripts/make_parquet_fixtures.py    # needs pyarrow, see the file header
python scripts/build_agents.py             # re-publish the agent definitions
python scripts/build_seo.py                # landing pages, sitemap, robots, llms.txt
```

---

## Credits

Built by **Nikhil**.

- GitHub — [@i-am-epic](https://github.com/i-am-epic)
- Instagram — [@nikboson](https://instagram.com/nikboson)

No licence is granted. All rights reserved.
