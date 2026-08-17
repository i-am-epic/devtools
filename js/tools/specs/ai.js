// Tools for working with LLMs: tokenising, costing, prompt templating and
// building API payloads.

import { libs } from '../../lib/loader.js';

const escapeHtml = (value) => String(value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const statTile = (label, value, sub = '') => `
    <div class="stat-tile">
        <div class="stat-label">${label}</div>
        <div class="stat-value">${value}</div>
        ${sub ? `<div class="stat-sub">${sub}</div>` : ''}
    </div>`;

/**
 * Indicative published list prices in USD per million tokens.
 *
 * These move often. They are a starting point you can overwrite in the tool,
 * not a source of truth — always check the provider's pricing page before
 * quoting a number to anyone.
 */
const PRICE_PRESETS = [
    { value: 'custom',                 label: 'Custom — enter your own rates', input: 0,    output: 0 },
    { value: 'gpt-4o',                 label: 'GPT-4o',                        input: 2.5,  output: 10 },
    { value: 'gpt-4o-mini',            label: 'GPT-4o mini',                   input: 0.15, output: 0.6 },
    { value: 'gpt-4-turbo',            label: 'GPT-4 Turbo',                   input: 10,   output: 30 },
    { value: 'gpt-3.5-turbo',          label: 'GPT-3.5 Turbo',                 input: 0.5,  output: 1.5 },
    { value: 'claude-sonnet',          label: 'Claude Sonnet',                 input: 3,    output: 15 },
    { value: 'claude-haiku',           label: 'Claude Haiku',                  input: 0.8,  output: 4 },
    { value: 'claude-opus',            label: 'Claude Opus',                   input: 15,   output: 75 },
    { value: 'gemini-flash',           label: 'Gemini Flash',                  input: 0.075, output: 0.3 },
    { value: 'gemini-pro',             label: 'Gemini Pro',                    input: 1.25, output: 5 },
];

const ENCODINGS = [
    { value: 'o200k_base', label: 'o200k_base — GPT-4o, GPT-4.1, o1' },
    { value: 'cl100k_base', label: 'cl100k_base — GPT-4, GPT-3.5, embeddings' },
];

async function tokenize(text, encoding) {
    const module = encoding === 'cl100k_base'
        ? await libs.tokenizerCl100k()
        : await libs.tokenizerO200k();
    return module.encode(text);
}

export const aiTools = [
    {
        id: 'token-counter',
        name: 'LLM Token Counter',
        description: 'Count tokens exactly with the real BPE tokenizer, and see how the text splits.',
        category: 'ai',
        icon: '⧉',
        keywords: ['token', 'tokens', 'tokenizer', 'llm', 'gpt', 'openai', 'context', 'window',
            'bpe', 'cl100k', 'o200k', 'prompt', 'count', 'claude', 'ai'],
        spec: {
            lede: 'Real BPE tokenisation running in your browser — not a characters-divided-by-four guess. Nothing is sent anywhere.',
            input: {
                label: 'Text',
                placeholder: 'Paste a prompt, a document, anything…',
                sample: 'You are a helpful assistant. Summarise the following in three bullet points, using British English spelling and keeping each bullet under twenty words.',
            },
            output: { label: 'Token IDs', filename: 'tokens.txt' },
            options: [
                { id: 'encoding', type: 'select', label: 'Encoding', default: 'o200k_base', choices: ENCODINGS },
                { id: 'contextWindow', type: 'number', label: 'Context window to compare against', default: 128000, min: 0 },
                { id: 'showPieces', type: 'checkbox', label: 'Show how the text splits', default: true },
            ],
            run: async ({ input, options }) => {
                const tokens = await tokenize(input, options.encoding);
                const module = options.encoding === 'cl100k_base'
                    ? await libs.tokenizerCl100k()
                    : await libs.tokenizerO200k();

                const chars = [...input].length;
                const words = input.trim() ? input.trim().split(/\s+/).length : 0;
                const ratio = tokens.length ? (chars / tokens.length) : 0;

                let pieces = '';
                if (options.showPieces && tokens.length <= 4000) {
                    const colours = ['var(--coral)', 'var(--blue)', 'var(--green)', 'var(--purple)', 'var(--yellow)'];
                    pieces = tokens.map((id, i) => {
                        const text = module.decode([id]);
                        const display = escapeHtml(text)
                            .replace(/ /g, '·')
                            .replace(/\n/g, '⏎');
                        return `<span title="token ${id}" style="background:color-mix(in srgb, ${colours[i % colours.length]} 22%, transparent);border-radius:4px;padding:1px 2px;margin:1px;display:inline-block">${display}</span>`;
                    }).join('');
                }

                const window = Number(options.contextWindow) || 0;
                const usage = window ? (tokens.length / window) * 100 : 0;

                const extraHtml = `
                    <div class="stat-grid" style="margin-top:1.5rem;">
                        ${statTile('Tokens', tokens.length.toLocaleString())}
                        ${statTile('Characters', chars.toLocaleString())}
                        ${statTile('Words', words.toLocaleString())}
                        ${statTile('Chars / token', ratio ? ratio.toFixed(2) : '—', 'the "÷4" rule of thumb')}
                        ${window ? statTile('Context used', `${usage.toFixed(usage < 1 ? 2 : 1)}%`, `of ${window.toLocaleString()}`) : ''}
                    </div>
                    ${pieces ? `
                        <div class="tool-section">
                            <h3>Token split</h3>
                            <div class="output-section" style="line-height:2.1;font-family:var(--mono);font-size:0.8rem;">
                                ${pieces}
                            </div>
                            <div class="helper-text">· is a space, ⏎ a newline. Hover a token to see its id.</div>
                        </div>` : ''}`;

                return {
                    output: tokens.join(', '),
                    extraHtml,
                    note: `${tokens.length.toLocaleString()} tokens · ${options.encoding}`,
                };
            },
            footnote: 'Exact for OpenAI models using these encodings. Anthropic, Google and Meta use different tokenizers and do not publish a browser-usable one — for those, treat this as a close estimate (usually within about 10%). Chat APIs also add a few tokens per message for role framing, which this does not count.',
        },
    },

    {
        id: 'llm-cost',
        name: 'LLM Cost Calculator',
        description: 'Estimate what a prompt, a batch or a month of traffic will cost.',
        category: 'ai',
        icon: '$',
        keywords: ['llm', 'cost', 'price', 'pricing', 'token', 'budget', 'openai', 'claude',
            'gpt', 'estimate', 'spend', 'ai'],
        spec: {
            lede: 'Paste your prompt to count its tokens, set the rates, and see the cost per call and at volume.',
            input: {
                label: 'Prompt (optional — or type a token count in the options)',
                placeholder: 'Paste the prompt to measure…',
                sample: 'Summarise the attached support ticket and classify it as bug, question or feature request.',
            },
            output: { label: 'Breakdown', filename: 'llm-cost.txt' },
            live: false,
            actionLabel: 'Calculate',
            options: [
                { id: 'preset', type: 'select', label: 'Rate preset', default: 'gpt-4o',
                  choices: PRICE_PRESETS.map(({ value, label }) => ({ value, label })),
                  hint: 'Indicative list prices — always confirm against the provider.' },
                { id: 'inputRate', type: 'number', label: 'Input $ / 1M tokens', default: 0, min: 0, step: 0.01,
                  hint: 'Leave 0 to use the preset' },
                { id: 'outputRate', type: 'number', label: 'Output $ / 1M tokens', default: 0, min: 0, step: 0.01 },
                { id: 'inputTokens', type: 'number', label: 'Input tokens (0 = measure the text)', default: 0, min: 0 },
                { id: 'outputTokens', type: 'number', label: 'Expected output tokens', default: 500, min: 0 },
                { id: 'calls', type: 'number', label: 'Calls per day', default: 1000, min: 0 },
                { id: 'encoding', type: 'select', label: 'Encoding for measuring', default: 'o200k_base', choices: ENCODINGS },
            ],
            run: async ({ input, options }) => {
                const preset = PRICE_PRESETS.find((p) => p.value === options.preset) || PRICE_PRESETS[0];
                const inputRate = options.inputRate > 0 ? options.inputRate : preset.input;
                const outputRate = options.outputRate > 0 ? options.outputRate : preset.output;

                if (!inputRate && !outputRate) {
                    throw new Error('Choose a preset or enter your own rates — both are currently zero.');
                }

                let inputTokens = Number(options.inputTokens) || 0;
                let measured = false;
                if (!inputTokens && input.trim()) {
                    inputTokens = (await tokenize(input, options.encoding)).length;
                    measured = true;
                }
                if (!inputTokens) throw new Error('Paste a prompt, or set an input token count.');

                const outputTokens = Number(options.outputTokens) || 0;
                const calls = Number(options.calls) || 0;

                const perCallIn = (inputTokens / 1e6) * inputRate;
                const perCallOut = (outputTokens / 1e6) * outputRate;
                const perCall = perCallIn + perCallOut;

                const money = (value) => (value < 0.01 && value > 0
                    ? `$${value.toFixed(6)}`
                    : `$${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);

                const daily = perCall * calls;
                const rows = [
                    ['Model / preset', preset.label],
                    ['Input rate', `$${inputRate}/1M tokens`],
                    ['Output rate', `$${outputRate}/1M tokens`],
                    ['Input tokens', `${inputTokens.toLocaleString()}${measured ? ' (measured from the text)' : ''}`],
                    ['Output tokens', outputTokens.toLocaleString()],
                    ['', ''],
                    ['Cost per call — input', money(perCallIn)],
                    ['Cost per call — output', money(perCallOut)],
                    ['Cost per call — total', money(perCall)],
                    ['', ''],
                    [`Per day (${calls.toLocaleString()} calls)`, money(daily)],
                    ['Per month (30 days)', money(daily * 30)],
                    ['Per year (365 days)', money(daily * 365)],
                ];

                const width = Math.max(...rows.map(([label]) => label.length));
                const text = rows
                    .map(([label, value]) => (label ? `${(`${label}:`).padEnd(width + 2)}${value}` : ''))
                    .join('\n');

                return {
                    output: text,
                    note: `${money(perCall)} per call`,
                    extraHtml: `
                        <div class="stat-grid" style="margin-top:1.5rem;">
                            ${statTile('Per call', money(perCall), `${inputTokens.toLocaleString()} in / ${outputTokens.toLocaleString()} out`)}
                            ${statTile('Per day', money(daily), `${calls.toLocaleString()} calls`)}
                            ${statTile('Per month', money(daily * 30))}
                            ${statTile('Per year', money(daily * 365))}
                        </div>
                        <div class="alert warn">
                            <span>!</span>
                            <span>Preset rates are indicative and go out of date. Confirm the current price
                            on the provider's pricing page before committing to a budget. Cached input,
                            batch discounts and long-context surcharges are not modelled here.</span>
                        </div>`,
                };
            },
        },
    },

    {
        id: 'prompt-template',
        name: 'Prompt Template Renderer',
        description: 'Fill {{variables}} in a prompt template and see the token cost of the result.',
        category: 'ai',
        icon: '{{}}',
        keywords: ['prompt', 'template', 'variable', 'placeholder', 'llm', 'render', 'jinja',
            'mustache', 'interpolate', 'ai'],
        spec: {
            lede: 'Keeps prompt templates and their test values in one place, and tells you which placeholders you forgot.',
            input: {
                label: 'Template',
                placeholder: 'You are a {{role}}. Answer in {{language}}.',
                sample: 'You are a {{role}} reviewing a {{artifact}}.\n\nFocus on: {{focus}}\n\nRespond in {{language}} using at most {{limit}} words.',
            },
            output: { label: 'Rendered prompt', filename: 'prompt.txt' },
            options: [
                { id: 'variables', type: 'text', label: 'Variables (JSON)',
                  default: '{"role":"staff engineer","artifact":"pull request","focus":"correctness and error handling","language":"English","limit":"200"}' },
                { id: 'syntax', type: 'select', label: 'Placeholder syntax', default: 'double',
                  choices: [
                      { value: 'double', label: '{{name}} — Mustache / Jinja' },
                      { value: 'single', label: '{name} — Python format' },
                      { value: 'dollar', label: '${name} — shell / JS template' },
                  ] },
                { id: 'strict', type: 'checkbox', label: 'Fail if a placeholder has no value', default: false },
            ],
            run: ({ input, options }) => {
                let variables;
                try {
                    variables = JSON.parse(options.variables || '{}');
                } catch (err) {
                    throw new Error(`Variables must be a JSON object: ${err.message}`);
                }
                if (variables === null || typeof variables !== 'object' || Array.isArray(variables)) {
                    throw new Error('Variables must be a JSON object, e.g. {"name": "value"}');
                }

                const patterns = {
                    double: /\{\{\s*(\w[\w.]*)\s*\}\}/g,
                    single: /\{\s*(\w[\w.]*)\s*\}/g,
                    dollar: /\$\{\s*(\w[\w.]*)\s*\}/g,
                };
                const pattern = patterns[options.syntax];

                const found = new Set();
                const missing = new Set();
                const used = new Set();

                const rendered = input.replace(pattern, (match, name) => {
                    found.add(name);
                    if (Object.prototype.hasOwnProperty.call(variables, name)) {
                        used.add(name);
                        return String(variables[name]);
                    }
                    missing.add(name);
                    return match;
                });

                if (options.strict && missing.size) {
                    throw new Error(`No value supplied for: ${[...missing].join(', ')}`);
                }

                const unused = Object.keys(variables).filter((key) => !found.has(key));

                const banner = [
                    missing.size
                        ? `<div class="alert warn"><span>!</span><span>Left unfilled: <strong>${[...missing].map(escapeHtml).join(', ')}</strong></span></div>`
                        : '',
                    unused.length
                        ? `<div class="alert info"><span>ℹ</span><span>Supplied but never used: <strong>${unused.map(escapeHtml).join(', ')}</strong></span></div>`
                        : '',
                    !missing.size && !unused.length && found.size
                        ? '<div class="alert ok"><span>✓</span><span>Every placeholder was filled.</span></div>'
                        : '',
                ].join('');

                return {
                    output: rendered,
                    note: `${found.size} placeholder${found.size === 1 ? '' : 's'}, ${used.size} filled`,
                    extraHtml: banner ? `<div class="tool-section">${banner}</div>` : '',
                };
            },
        },
    },

    {
        id: 'chat-payload',
        name: 'Chat API Payload Builder',
        description: 'Turn a system prompt and a conversation into a ready-to-send request body.',
        category: 'ai',
        icon: '💬',
        keywords: ['openai', 'anthropic', 'claude', 'chat', 'completion', 'messages', 'api',
            'payload', 'request', 'curl', 'json', 'ai'],
        spec: {
            lede: 'Write the conversation in plain text; get correct JSON for the OpenAI or Anthropic API, plus a curl command.',
            input: {
                label: 'Conversation — prefix lines with system:, user: or assistant:',
                placeholder: 'system: You are helpful.\nuser: Hello',
                sample: 'system: You are a concise assistant. Answer in British English.\nuser: What is the difference between a queue and a topic?\nassistant: A queue delivers each message to exactly one consumer.\nuser: And a topic?',
            },
            output: { label: 'Request body', filename: 'payload.json' },
            options: [
                { id: 'provider', type: 'select', label: 'API shape', default: 'openai',
                  choices: [
                      { value: 'openai', label: 'OpenAI — /v1/chat/completions' },
                      { value: 'anthropic', label: 'Anthropic — /v1/messages' },
                  ] },
                { id: 'model', type: 'text', label: 'Model', default: 'gpt-4o' },
                { id: 'temperature', type: 'number', label: 'Temperature', default: 1, min: 0, max: 2, step: 0.1 },
                { id: 'maxTokens', type: 'number', label: 'Max output tokens', default: 1024, min: 1 },
                { id: 'stream', type: 'checkbox', label: 'Stream the response', default: false },
                { id: 'curl', type: 'checkbox', label: 'Also show a curl command', default: true },
            ],
            run: ({ input, options }) => {
                const lines = input.split('\n');
                const messages = [];
                let current = null;

                for (const line of lines) {
                    const match = /^\s*(system|user|assistant|human)\s*:\s*(.*)$/i.exec(line);
                    if (match) {
                        if (current) messages.push(current);
                        const role = match[1].toLowerCase() === 'human' ? 'user' : match[1].toLowerCase();
                        current = { role, content: match[2] };
                    } else if (current) {
                        current.content += `\n${line}`;
                    } else if (line.trim()) {
                        current = { role: 'user', content: line };
                    }
                }
                if (current) messages.push(current);
                for (const message of messages) message.content = message.content.trim();

                if (!messages.length) throw new Error('No messages found. Prefix each turn with system:, user: or assistant:');

                let body;
                let url;
                let headers;

                if (options.provider === 'anthropic') {
                    // Anthropic takes the system prompt as a top-level field.
                    const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
                    const turns = messages.filter((m) => m.role !== 'system');

                    if (!turns.length) throw new Error('Anthropic requires at least one user message.');
                    if (turns[0].role !== 'user') throw new Error('The first non-system message must be from the user.');

                    body = {
                        model: options.model,
                        max_tokens: options.maxTokens,
                        ...(system ? { system } : {}),
                        messages: turns,
                        ...(options.temperature !== 1 ? { temperature: options.temperature } : {}),
                        ...(options.stream ? { stream: true } : {}),
                    };
                    url = 'https://api.anthropic.com/v1/messages';
                    headers = [
                        '-H "content-type: application/json"',
                        '-H "x-api-key: $ANTHROPIC_API_KEY"',
                        '-H "anthropic-version: 2023-06-01"',
                    ];
                } else {
                    body = {
                        model: options.model,
                        messages,
                        ...(options.temperature !== 1 ? { temperature: options.temperature } : {}),
                        max_tokens: options.maxTokens,
                        ...(options.stream ? { stream: true } : {}),
                    };
                    url = 'https://api.openai.com/v1/chat/completions';
                    headers = [
                        '-H "content-type: application/json"',
                        '-H "authorization: Bearer $OPENAI_API_KEY"',
                    ];
                }

                const json = JSON.stringify(body, null, 2);

                const curl = options.curl
                    ? `curl ${url} \\\n  ${headers.join(' \\\n  ')} \\\n  -d '${json.replace(/'/g, `'\\''`)}'`
                    : '';

                const roleCounts = messages.reduce((acc, m) => {
                    acc[m.role] = (acc[m.role] || 0) + 1;
                    return acc;
                }, {});

                return {
                    output: json,
                    note: Object.entries(roleCounts).map(([role, n]) => `${n} ${role}`).join(', '),
                    extraHtml: curl ? `
                        <div class="tool-section">
                            <div class="io-pane-head">
                                <h3>curl</h3>
                                <div class="io-pane-actions">
                                    <button class="copy-chip" data-copy="${escapeHtml(curl)}" data-copy-label="curl copied">Copy</button>
                                </div>
                            </div>
                            <div class="output-section"><pre>${escapeHtml(curl)}</pre></div>
                            <div class="helper-text">The API key is referenced as an environment variable rather than pasted in — keep it that way.</div>
                        </div>` : '',
                };
            },
        },
    },

    {
        id: 'jsonl-tools',
        name: 'JSONL Toolkit',
        description: 'Validate, convert and inspect JSON Lines — the format fine-tuning and log pipelines use.',
        category: 'ai',
        icon: '⋮',
        keywords: ['jsonl', 'ndjson', 'json lines', 'fine-tune', 'finetune', 'dataset', 'training',
            'openai', 'convert', 'validate', 'ai', 'logs'],
        spec: {
            lede: 'JSONL is one JSON document per line. This validates every line individually and tells you exactly which one is broken.',
            input: {
                label: 'JSONL or a JSON array',
                accept: '.jsonl,.ndjson,.json,.txt',
                placeholder: '{"a":1}\n{"a":2}',
                sample: '{"messages":[{"role":"user","content":"Hi"},{"role":"assistant","content":"Hello"}]}\n{"messages":[{"role":"user","content":"Bye"},{"role":"assistant","content":"Goodbye"}]}\n{"messages":[{"role":"user","content":"broken"}',
            },
            output: { label: 'Result', filename: 'converted.jsonl' },
            options: [
                { id: 'mode', type: 'select', label: 'Operation', default: 'validate',
                  choices: [
                      { value: 'validate', label: 'Validate and report' },
                      { value: 'toArray', label: 'JSONL → JSON array' },
                      { value: 'toJsonl', label: 'JSON array → JSONL' },
                      { value: 'pretty', label: 'Pretty-print each line' },
                  ] },
                { id: 'skipInvalid', type: 'checkbox', label: 'Skip invalid lines when converting', default: false },
            ],
            run: ({ input, options }) => {
                const trimmed = input.trim();
                if (!trimmed) return '';

                if (options.mode === 'toJsonl') {
                    let parsed;
                    try {
                        parsed = JSON.parse(trimmed);
                    } catch (err) {
                        throw new Error(`Input is not a valid JSON array: ${err.message}`);
                    }
                    if (!Array.isArray(parsed)) throw new Error('Expected a JSON array at the top level.');
                    return {
                        output: parsed.map((item) => JSON.stringify(item)).join('\n'),
                        note: `${parsed.length.toLocaleString()} lines`,
                    };
                }

                const lines = trimmed.split('\n');
                const parsed = [];
                const errors = [];

                lines.forEach((line, index) => {
                    if (!line.trim()) return;
                    try {
                        parsed.push({ line: index + 1, value: JSON.parse(line) });
                    } catch (err) {
                        errors.push({ line: index + 1, message: err.message, preview: line.slice(0, 70) });
                    }
                });

                if (options.mode !== 'validate' && errors.length && !options.skipInvalid) {
                    throw new Error(
                        `Line ${errors[0].line} is not valid JSON: ${errors[0].message}. `
                        + 'Tick "Skip invalid lines" to convert anyway.',
                    );
                }

                // Shape summary — what keys appear, and how consistently.
                const keyCounts = new Map();
                for (const { value } of parsed) {
                    if (value && typeof value === 'object' && !Array.isArray(value)) {
                        for (const key of Object.keys(value)) keyCounts.set(key, (keyCounts.get(key) || 0) + 1);
                    }
                }

                const errorTable = errors.length ? `
                    <div class="table-wrap" style="max-height:260px;">
                        <table class="data">
                            <thead><tr><th style="width:70px">Line</th><th>Problem</th><th>Content</th></tr></thead>
                            <tbody>
                                ${errors.slice(0, 100).map((e) => `
                                    <tr>
                                        <td class="num">${e.line}</td>
                                        <td style="white-space:normal">${escapeHtml(e.message)}</td>
                                        <td>${escapeHtml(e.preview)}</td>
                                    </tr>`).join('')}
                            </tbody>
                        </table>
                    </div>` : '';

                const keyTable = keyCounts.size ? `
                    <h3 style="margin-top:1.25rem;">Top-level keys</h3>
                    <div class="table-wrap" style="max-height:220px;">
                        <table class="data">
                            <thead><tr><th>Key</th><th>Present in</th><th>Coverage</th></tr></thead>
                            <tbody>
                                ${[...keyCounts.entries()].sort((a, b) => b[1] - a[1]).map(([key, count]) => `
                                    <tr>
                                        <td><strong>${escapeHtml(key)}</strong></td>
                                        <td class="num">${count.toLocaleString()}</td>
                                        <td class="num">${((count / Math.max(1, parsed.length)) * 100).toFixed(0)}%${count < parsed.length ? ' ⚠' : ''}</td>
                                    </tr>`).join('')}
                            </tbody>
                        </table>
                    </div>` : '';

                const extraHtml = `
                    <div class="tool-section" style="margin-top:1.5rem;">
                        <div class="alert ${errors.length ? 'err' : 'ok'}">
                            <span>${errors.length ? '✕' : '✓'}</span>
                            <span>${errors.length
                                ? `${errors.length} of ${lines.filter((l) => l.trim()).length} lines are not valid JSON`
                                : `All ${parsed.length.toLocaleString()} lines are valid JSON`}</span>
                        </div>
                        <div class="stat-grid">
                            ${statTile('Valid lines', parsed.length.toLocaleString())}
                            ${statTile('Invalid lines', errors.length.toLocaleString())}
                            ${statTile('Distinct keys', keyCounts.size.toLocaleString())}
                        </div>
                        ${errorTable}
                        ${keyTable}
                    </div>`;

                let output;
                if (options.mode === 'toArray') output = JSON.stringify(parsed.map((p) => p.value), null, 2);
                else if (options.mode === 'pretty') output = parsed.map((p) => JSON.stringify(p.value, null, 2)).join('\n\n');
                else {
                    output = errors.length
                        ? errors.map((e) => `line ${e.line}: ${e.message}`).join('\n')
                        : `All ${parsed.length} lines are valid JSON.`;
                }

                return { output, extraHtml, note: `${parsed.length} valid, ${errors.length} invalid` };
            },
        },
    },
];
