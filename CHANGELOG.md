# Changelog

All notable changes to DevToolkit will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [4.2.0] - 2026-08-17

### Fixed
- **Back did not return to the grid.** Opening a tool used `history.replaceState`, so it
  never created a history entry — pressing Back left the site entirely. Tools now push a
  history entry, the URL is the single source of truth, and `popstate` re-syncs the view.
  Back returns to the grid, Forward reopens the tool, two tools deep unwinds one at a
  time, and the in-page back arrow on a deep link lands on the grid instead of bouncing
  off the site.

### Added
- **SEO surface.** A single-page app with `#fragments` is one URL to a crawler, so 148
  tools were competing as one page. Every tool now has a real indexable URL at
  `/t/<id>/` with a unique title, meta description, `<h1>`, options table, how-to,
  FAQ and related-tool links (~1,300 words each), plus SoftwareApplication, FAQPage,
  HowTo and BreadcrumbList structured data. Also a `/t/` hub page linking all of them,
  a regenerated `sitemap.xml`, a `robots.txt` that explicitly welcomes the AI crawlers,
  and an `llms.txt` describing the site for language models.
- **Security category** — password strength checker (entropy plus the patterns crackers
  try first), TOTP/2FA generator (matches the RFC 6238 reference vectors), security
  headers analyser with a grade, CSP builder and analyser, Basic auth encoder/decoder,
  and a secret scanner for API keys, tokens and private keys.
- **Speciality features** on the most-used tools:
  - Text diff detects **moved blocks** — a line deleted here and added there is shown as
    moved rather than as an unrelated delete plus insert, with a colour legend.
  - UUID generator does **deterministic v3/v5** name-based UUIDs (verified against
    Python's `uuid` module), plus SQL / JSON / C# / TypeScript output formats.
  - JSON formatter has a **repair mode** (single quotes, trailing commas, bare keys,
    comments, `NaN`, Python literals) that reports every change it made, and a
    **size breakdown** showing which paths are costing the bytes.
- MCP server announced as coming soon on the homepage — not implemented.

### Changed
- UUID generator defaults to **1** and **copies to the clipboard automatically** on
  Generate. Password, passphrase and PIN generators have the same option but default it
  off, because clipboard managers keep history and a password sitting in one is a worse
  trade than a second click. Copying only happens on a real interaction — a clipboard
  write without a user gesture is refused by the browser anyway.
- The SEO build reads `tools-manifest.json`, exported from the browser by
  `scripts/export-manifest.html`, because Python cannot execute the JS registry. The
  registry stays the single source of truth.

## [4.1.0] - 2026-08-17

### Fixed
- **Dead space under short tools.** The tool view was a `position: fixed` overlay with
  `body { overflow: hidden }`. It looked right, but a full-page screenshot captures the
  *document* height rather than the overlay, producing a large blank band — and the same
  overlay broke printing and find-in-page. The view is now an ordinary block in document
  flow, and the body stops forcing a full screen once a tool has rendered content below
  the editors. Remaining gap is the 2rem bottom padding.
- **Markdown preview had a fixed 220px height with its own scrollbar.** It was a fully
  sandboxed iframe, which cannot be measured from the parent, so it could not auto-size.
  The preview now renders inline through the new sanitiser and sizes to its content.
- The Kubernetes checker never reported inline Secrets: the check sat after an early
  `continue` for documents with no pod template, so it was unreachable.
- Mermaid diagrams generated for the "copy as fenced block" button contained a literal
  triple backtick inside a template literal, which was a syntax error that stopped the
  whole registry loading.

### Added
- **Markdown Reader** — open or drag in a `.md` file and read it rendered: GFM tables,
  task lists, footnotes, heading anchors, generated table of contents, code copy buttons,
  and **Mermaid diagrams rendered in place**. Exports self-contained HTML or prints to PDF.
- **Mermaid Generator** — build flowcharts, sequence diagrams, mind maps, ER diagrams,
  pie charts and user journeys from plain lists or CSV. Every generated diagram is checked
  against the real Mermaid parser by the test suite.
- **Mermaid Validator** — parses with Mermaid itself and reports the failing line, with a
  preview when it succeeds.
- **DevOps & Config category** — YAML beautifier, Dockerfile linter, Docker Compose
  validator, Kubernetes manifest checker, GitHub Actions checker, Kubernetes Secret
  decoder/encoder, .gitignore generator.
- `js/lib/sanitize.js` — allowlist HTML sanitiser used wherever rendered Markdown is put
  into the page.
- `scripts/devops-test.html` — 83 assertions covering the linters, Mermaid generation and
  the sanitiser.

### Changed
- JSON Formatter is now "JSON Formatter & Beautifier" and matches searches for
  beautify/prettify/unminify.

## [4.0.0] - 2026-08-17

### Changed
- **Tools open full screen instead of in a dialog.** The old modal capped at 1000px
  wide with short editors; a tool now takes the whole viewport and the editor panes
  flex to fill whatever height is left, so a JSON document gets ~450px of editor on a
  1512×946 screen rather than ~220px.
- Search ranks a whole-word name match above a keyword match, so "token" finds the
  LLM Token Counter before the JWT Signer.

### Added
- **Quick search palette** on `Ctrl`+`Space`, `Alt`+`Space`, `Ctrl`/`Cmd`+`K` or `/`,
  with arrow-key navigation. Works on macOS and Windows. (A page cannot register a
  global OS hotkey — these fire while the tab has focus.)
- **Environment export and import.** Download all or just the active environment as
  JSON and import it back, with keep-both / replace / skip handling for name clashes.
  Accepts a bare array or a single environment object too, and regenerates ids so an
  import cannot overwrite an unrelated environment.
- **22 new tools.**
  - AI & LLM: token counter (real BPE via gpt-tokenizer, cl100k and o200k), cost
    calculator, prompt template renderer, chat API payload builder, JSONL toolkit.
  - JSON power tools: JSON→TypeScript/Python/Go/C#/Rust/Java, JSON Schema generator,
    JSONPath evaluator, structural JSON diff.
  - Developer utilities: ID decoder (UUID v1/v4/v6/v7, ULID, ObjectId, Snowflake),
    Unicode inspector, CIDR calculator, Kubernetes quantity converter, duration
    converter, semver checker, cURL converter, .env converter, JWT signer, HTTP
    reference, mock data generator, Markdown table formatter, line-ending inspector.
- **Nik Agents section** — 20 `nikbot-*` subagent definitions, rendered with copy and
  download. `scripts/build_agents.py` publishes only the general-purpose set and
  refuses to copy an agent that mentions an internal project name.
- Click-to-copy on hash digests, colour formats, JWT parts, JSONPath examples, MIME
  types, CIDR subnets, ISO durations, Unicode code points and Mermaid source, via one
  delegated handler.
- `scripts/newtools-test.html` — 131 correctness assertions for the new tools.

### Fixed
- The environment edit form only saved its own known variable names, so a variable
  brought in by an import was silently dropped on the next save.
- Mermaid viewer gained copy buttons for the source and the rendered SVG.

### Removed
- The MIT licence. The project now carries no licence — all rights reserved.

## [3.0.0] - 2026-08-17

Rewrite. Every listed tool now works; the tool list is generated from
implementations, so there is nowhere for a placeholder to hide.

### Fixed
- **Parquet Viewer returned fake data.** It generated `User 1..100` rows and never
  read the uploaded file (`"Mock implementation for demonstration"`). It now parses
  real Parquet via hyparquet.
- **Service Bus tools only simulated.** Both printed success without contacting
  Azure (`"Simulate sending"`). They now publish and consume for real.
- **CSV to Excel did not produce xlsx.** It wrote an HTML table with an `.xls`
  extension, which makes Excel warn that the format and extension disagree. It now
  writes a real workbook with native number, date and boolean cells.
- **Text diff aligned lines by index**, so inserting one line marked everything
  after it as changed. Replaced with an LCS alignment plus word-level highlighting
  and unified-diff export.
- Mermaid viewer appended a duplicate `<style>` element on every open, and ran with
  `securityLevel: 'loose'`, which allows markup injection from a pasted diagram.

### Added
- 90 working tools, covering the appdevtools.com feature set plus Parquet, Service
  Bus, JWT, cron, regex, colour and QR.
- **Parquet viewer**: multi-file, footer metadata (row groups, codecs, encodings,
  compression ratio, bytes per row), per-column statistics computed from the data,
  a filter language (`age > 30 AND city = 'London'`, `LIKE`, `IN`, `IS NULL`),
  sorting, CSV/JSON/NDJSON export, file stacking and schema comparison.
- **Service Bus relay** at `/api/servicebus` — `server.py` locally and in Docker,
  `api/servicebus.js` on Vercel, verified to produce identical SAS tokens. Publish
  with broker and application properties; consume by peek-lock with
  complete/abandon/renew, or receive-and-delete.
- Hash generator computing 12 algorithms at once. MD5, SHA-224, SHA-3, Keccak-256
  and RIPEMD-160 are implemented locally since WebCrypto lacks them, and are
  verified against Python's `hashlib`.
- Warm-paper design system with light and dark themes, WCAG-AA contrast throughout.
- Ranked search, category grouping, and per-tool deep links (`#json-formatter`).
- Test suites: `scripts/smoke-test.html`, `parquet-test.html`, `tools-test.html`,
  `verify-hashes.html`, `servicebus-js-test.html`, `test_servicebus.py`.

### Changed
- `tools-config.json` removed. The catalogue lives in `js/tools/registry.js`, so a
  tool cannot be listed without an implementation behind it.
- Most tools are now declarative specs rendered by `SimpleTool` rather than a class
  each.
- Docker image runs `server.py` on Python instead of nginx, so the Service Bus
  tools work in a container. It binds to localhost unless `DEVTOOLS_HOST` says
  otherwise.

### Removed
- 123 placeholder tool entries that had no implementation, including several that
  could not work client-side at all (port scanner, hash cracker, threat intel).
- `CACHE_FIX.md`, which documented a bug in the replaced architecture.

## [1.0.0] - 2024-12-18

### Added
- 🎨 Clean bento grid layout with black/white theme
- 🔍 Global search with category filtering
- ⚙️ Environment Manager with {{variable}} substitution
- 📦 11 categories: Backend, Frontend, DevOps, AI, Cybersecurity, Conversion, SQL, Cheatsheet, Data, Security, Utility
- 🛠️ 7 working tools:
  - JSON Beautifier
  - GUID Generator
  - SHA256 Hash Generator
  - Base64 Encoder/Decoder
  - Difference Checker
  - Azure Service Bus Sender
  - Azure Service Bus Listener
- 📝 120+ tool configurations (113 placeholders)
- 🐳 Docker support (Dockerfile + docker-compose.yml)
- 🤖 SEO optimization with AI-scrapeable metadata
- 📱 Fully responsive design
- ⚡ Smooth animations and transitions
- 💾 localStorage persistence for settings and configurations

### Architecture
- SOLID principles with clean separation of concerns
- Factory pattern for tool creation
- Template method pattern for tool interface
- ES6 modules (zero dependencies)
- Pure client-side (no server required)

### Categories
1. **Backend Development** (20+ tools)
   - JSON, Base64, JWT, RegEx, etc.
2. **Frontend Development** (15+ tools)
   - Color Picker, CSS Minifier, SVG Optimizer, etc.
3. **DevOps & Infrastructure** (15+ tools)
   - YAML Validator, Docker tools, Kubernetes configs, etc.
4. **AI & Machine Learning** (11 tools)
   - API Chat, Model Comparer, Token Counter, etc.
5. **Cybersecurity** (20+ tools)
   - SQL Injection, XSS, Hash Cracker, Port Scanner, etc.
6. **Data Conversion** (13 tools)
   - Parquet Viewer, CSV/Excel/JSON/Avro conversions
7. **SQL & Database** (10+ tools)
   - Query Formatter, Schema Validator, ER Diagram, etc.
8. **Cheat Sheets** (10+ tools)
   - Git, Docker, Kubernetes, SQL, RegEx, etc.
9. **Data Tools** (5+ tools)
   - Difference Checker, Data Validator, CSV Parser, etc.
10. **Security Tools** (5+ tools)
    - SHA256, Password Generator, Encryption, etc.
11. **Utilities** (15+ tools)
    - GUID Generator, QR Code, Timestamp Converter, etc.

### Technical Details
- **Framework:** Vanilla JavaScript (ES6 modules)
- **Architecture:** SOLID principles, Factory pattern
- **Storage:** Browser localStorage
- **Server:** Static file serving (Python/Node/nginx)
- **Browser Support:** Chrome 61+, Firefox 60+, Safari 11+, Edge 16+
- **Docker:** Multi-stage build with nginx:alpine
- **SEO:** Comprehensive meta tags, robots.txt, sitemap.xml

### Files Structure
```
devtoolkit/
├── index.html (5222 bytes)
├── styles.css
├── tools-config.json (1089+ lines, 120+ tools)
├── Dockerfile
├── docker-compose.yml
├── .dockerignore
├── robots.txt
├── sitemap.xml
├── README.md
├── CONTRIBUTING.md
├── CHANGELOG.md
└── js/
    ├── app.js (application bootstrap)
    ├── core/ (7 modules)
    │   ├── BaseTool.js
    │   ├── ToolFactory.js
    │   ├── ConfigManager.js
    │   ├── SearchService.js
    │   ├── UIManager.js
    │   └── EnvironmentManager.js
    ├── ui/ (1 module)
    │   └── EnvironmentUI.js
    ├── utils/ (1 module)
    │   └── StorageManager.js
    └── tools/ (8 implementations)
        ├── JsonBeautifierTool.js
        ├── GuidGeneratorTool.js
        ├── Sha256Tool.js
        ├── Base64Tool.js
        ├── DiffCheckerTool.js
        ├── ServiceBusSenderTool.js
        ├── ServiceBusListenerTool.js
        └── PlaceholderTool.js
```

### Credits
- Created by [@nikboson](https://github.com/nikboson)
- Font: [Inter](https://rsms.me/inter/) by Rasmus Andersson
- Icons: Emoji standards

## [0.9.0] - 2024-12-17 (Beta)

### Added
- Initial project structure
- Core architecture (BaseTool, ToolFactory, etc.)
- First 5 working tools
- Basic UI with search functionality

### Fixed
- UI rendering issues (missing 'visible' CSS class)
- ServiceBusListenerTool.js syntax errors
- EnvironmentManager.js duplicate closing brace
- Category filter not reselectable
- Browser cache issues

## [0.1.0] - 2024-12-15 (Alpha)

### Added
- Project inception
- Basic HTML structure
- CSS Grid layout
- JSON configuration system

---

## Version Guidelines

### Semantic Versioning
- **MAJOR** (1.x.x): Breaking changes
- **MINOR** (x.1.x): New features, backward compatible
- **PATCH** (x.x.1): Bug fixes, backward compatible

### Release Checklist
- [ ] Update CHANGELOG.md
- [ ] Update version in README.md
- [ ] Test all functionality
- [ ] Build Docker image
- [ ] Tag release on GitHub
- [ ] Update documentation

### Types of Changes
- `Added` - New features
- `Changed` - Changes to existing functionality
- `Deprecated` - Soon-to-be removed features
- `Removed` - Removed features
- `Fixed` - Bug fixes
- `Security` - Security vulnerability fixes

---

[Unreleased]: https://github.com/nikboson/devtoolkit/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/nikboson/devtoolkit/releases/tag/v1.0.0
[0.9.0]: https://github.com/nikboson/devtoolkit/releases/tag/v0.9.0
[0.1.0]: https://github.com/nikboson/devtoolkit/releases/tag/v0.1.0
