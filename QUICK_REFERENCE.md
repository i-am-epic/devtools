# Quick reference

## Run

```bash
python server.py 8000          # site + Service Bus relay on :8000
docker compose up --build      # same thing in a container, on :8080
```

No build step and no dependencies.

## Layout

```
index.html          shell
styles.css          design system, light + dark
server.py           static server + /api/servicebus relay
api/                the same relay as Vercel functions
js/app.js           search, categories, theme, hash routing
js/core/            ConfigManager, ToolFactory, SimpleTool, SearchService, UIManager, BaseTool
js/lib/             bytes, hashes, tabular, wordlist, loader, servicebus
js/tools/registry.js    source of truth for what exists
js/tools/specs/     declarative tools by category
js/tools/*.js       bespoke-UI tools
scripts/            tests and fixture generators
```

## Add a simple tool

Most tools are text-in / text-out. Add an object to the right file in
`js/tools/specs/` — it is picked up automatically because `registry.js` spreads
each category array.

```js
{
    id: 'my-tool',                    // unique; also the URL fragment
    name: 'My Tool',
    description: 'One line shown on the card.',
    category: 'text',                 // must exist in CATEGORIES
    icon: '★',
    keywords: ['search', 'terms'],    // ranked highly by search
    spec: {
        lede: 'Sentence shown under the title.',
        input: { label: 'Input', placeholder: '...', sample: 'try me' },
        output: { label: 'Output', filename: 'result.txt' },
        options: [
            { id: 'upper', type: 'checkbox', label: 'Uppercase', default: false },
        ],
        run: ({ input, options }) => options.upper ? input.toUpperCase() : input,
    },
}
```

### `run` contract

Receives `{ input, options, bytes, fileName, tool }`. May be async.

Returns either a string, or:

```js
{ output, extraHtml, note, filename }
```

Throw to show an error banner: `throw new Error('Not valid hex')`.

### Option types

| type | notes |
| --- | --- |
| `checkbox` | `default: true\|false` |
| `select` | `choices: [{ value, label }]` or `['a', 'b']` |
| `number` | `min`, `max`, `step` |
| `text` | `placeholder` |

### Spec fields

| field | meaning |
| --- | --- |
| `layout` | `'io'` (default) or `'output'` for generators |
| `live` | recompute while typing; default `true` |
| `actionLabel` | primary button text when `live: false` |
| `swap` | adds a button moving output back into input |
| `input.accept` | enables a file picker |
| `input.binary` | file arrives as `bytes` rather than text |
| `footnote` | caveat box under the tool (HTML allowed) |

## Add a bespoke tool

Extend `BaseTool`, implement `render()` and `onOpen()`, then register it in
`js/tools/registry.js` with `toolClass` instead of `spec`.

```js
import { BaseTool } from '../core/BaseTool.js';

export class MyTool extends BaseTool {
    render() { return `<div class="tool-interface">...</div>`; }
    onOpen() { setTimeout(() => { /* bind listeners */ }, 0); }
    onClose() { /* stop timers, drop buffers */ }
}
```

`render()` must include a `.tool-interface` wrapper — the smoke test checks for it.

## Loading a third-party library

Never add a `<script>` tag to `index.html`. Add an entry to `js/lib/loader.js`
and call it inside `run()`; it is fetched once, on first use.

```js
const yaml = await libs.yaml();
```

If a package uses bare import specifiers, use jsDelivr's `/+esm` endpoint —
that is why `hyparquetCompressors` does.

## CSS you can use

`.tool-interface` `.tool-section` `.io-grid` `.io-pane` `.field-group` `.opt-row`
`.check` `.action-btn` `.action-btn.secondary` `.action-btn.danger` `.mini-btn`
`.output-section` `.alert.ok|.err|.warn|.info` `.info-box` `.helper-text`
`.stat-grid` `.stat-tile` `.stat-label` `.stat-value` `.table-wrap` `table.data`
`.chip` `.file-input` `.file-row` `.message-card` `.template-btn`

Use the tokens (`var(--ink)`, `var(--surface)`, `var(--line)`, `var(--accent)`)
rather than literal colours, so both themes work.

## Tests

| URL / command | Checks |
| --- | --- |
| `/scripts/verify-hashes.html` | hashes + HMAC vs Python `hashlib` |
| `/scripts/smoke-test.html` | every tool runs on its own sample |
| `/scripts/parquet-test.html` | real Parquet files end to end |
| `/scripts/tools-test.html` | diff, xlsx round-trip, codecs |
| `/scripts/servicebus-js-test.html` | Node relay == Python relay |
| `python scripts/test_servicebus.py` | SAS signing, parsing, error paths |

Run the smoke test after adding a tool. It fails a tool that throws, and fails a
tool that returns nothing for its own sample input.

## Keyboard

| | |
| --- | --- |
| `/` or `Ctrl`/`Cmd`+`K` | focus search |
| `Esc` | close the tool |
| `#tool-id` in the URL | opens that tool directly |
