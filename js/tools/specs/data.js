// JSON, XML, YAML, CSV, PHP and SQL tools.
import { libs } from '../../lib/loader.js';
import { parseCsv, toCsv, sniffDelimiter, coerce, objectsToRows } from '../../lib/tabular.js';

const escapeHtml = (value) => String(value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

// --------------------------------------------------------------- helpers --

/**
 * Repair the JSON mistakes that actually occur: trailing commas, single
 * quotes, unquoted keys, Python/JS literals, comments, and a BOM. Returns the
 * repaired text plus a list of what was changed, so nothing is silent.
 */
function repairJson(text) {
    const fixes = [];
    let out = text;

    const apply = (label, fn) => {
        const before = out;
        out = fn(before);
        if (out !== before) fixes.push(label);
    };

    apply('removed a byte order mark', (s) => s.replace(/^﻿/, ''));
    apply('unwrapped a JSONP callback', (s) => {
        const match = /^\s*[\w.$]+\s*\(\s*([\s\S]*?)\s*\)\s*;?\s*$/.exec(s);
        return match && /^[[{]/.test(match[1]) ? match[1] : s;
    });

    // Walk the text so replacements never touch the inside of a string.
    const rewrite = (transform) => {
        let result = '';
        let i = 0;
        while (i < out.length) {
            const char = out[i];
            if (char === '"' || char === "'") {
                const quote = char;
                let literal = char;
                i++;
                while (i < out.length) {
                    if (out[i] === '\\') { literal += out[i] + (out[i + 1] ?? ''); i += 2; continue; }
                    literal += out[i];
                    if (out[i] === quote) { i++; break; }
                    i++;
                }
                result += transform.string ? transform.string(literal) : literal;
                continue;
            }
            if (char === '/' && out[i + 1] === '/') {
                while (i < out.length && out[i] !== '\n') i++;
                if (transform.comment) transform.comment();
                continue;
            }
            if (char === '/' && out[i + 1] === '*') {
                const end = out.indexOf('*/', i + 2);
                i = end === -1 ? out.length : end + 2;
                if (transform.comment) transform.comment();
                continue;
            }
            result += transform.code ? transform.code(char, result) : char;
            i++;
        }
        return result;
    };

    let removedComment = false;
    out = rewrite({ comment: () => { removedComment = true; } });
    if (removedComment) fixes.push('removed comments');

    // Single-quoted strings -> double-quoted.
    let requoted = false;
    out = rewrite({
        string: (literal) => {
            if (!literal.startsWith("'")) return literal;
            requoted = true;
            const inner = literal.slice(1, -1).replace(/\\'/g, "'").replace(/"/g, '\\"');
            return `"${inner}"`;
        },
    });
    if (requoted) fixes.push('converted single-quoted strings to double quotes');

    apply('quoted bare keys', (s) => s.replace(/([{,]\s*)([A-Za-z_$][\w$]*)(\s*:)/g, '$1"$2"$3'));
    apply('removed trailing commas', (s) => s.replace(/,(\s*[}\]])/g, '$1'));
    apply('replaced Python True/False/None', (s) => s
        .replace(/\bTrue\b/g, 'true').replace(/\bFalse\b/g, 'false').replace(/\bNone\b/g, 'null'));
    apply('replaced NaN and Infinity with null', (s) => s
        .replace(/\b(NaN|-?Infinity)\b/g, 'null'));
    apply('quoted a bare undefined', (s) => s.replace(/\bundefined\b/g, 'null'));

    return { text: out.trim(), fixes };
}

/** Parse JSON, turning the browser's terse message into something locatable. */
function parseJson(text) {
    try {
        return JSON.parse(text);
    } catch (err) {
        const position = /position (\d+)/.exec(err.message);
        if (position) {
            const index = Number(position[1]);
            const before = text.slice(0, index);
            const line = before.split('\n').length;
            const column = index - before.lastIndexOf('\n');
            const context = text.split('\n')[line - 1] || '';
            throw new Error(
                `${err.message.replace(/ in JSON at position \d+.*/, '')} — line ${line}, column ${column}\n`
                + `  ${context.trim().slice(0, 80)}`,
            );
        }
        throw new Error(err.message);
    }
}

function xmlDocument(text) {
    const doc = new DOMParser().parseFromString(text.trim(), 'application/xml');
    const failure = doc.querySelector('parsererror');
    if (failure) {
        const message = (failure.textContent || 'Invalid XML').replace(/\s+/g, ' ').trim();
        throw new Error(message.slice(0, 300));
    }
    return doc;
}

function formatXml(text, indent) {
    const doc = xmlDocument(text);
    const pad = ' '.repeat(indent);

    const serialise = (node, depth) => {
        const prefix = pad.repeat(depth);

        if (node.nodeType === Node.TEXT_NODE) {
            const value = node.nodeValue.trim();
            return value ? prefix + value : '';
        }
        if (node.nodeType === Node.CDATA_SECTION_NODE) return `${prefix}<![CDATA[${node.nodeValue}]]>`;
        if (node.nodeType === Node.COMMENT_NODE) return `${prefix}<!--${node.nodeValue}-->`;
        if (node.nodeType === Node.PROCESSING_INSTRUCTION_NODE) return `${prefix}<?${node.target} ${node.data}?>`;

        const attrs = [...(node.attributes || [])]
            .map((a) => ` ${a.name}="${a.value.replace(/"/g, '&quot;')}"`).join('');
        const children = [...node.childNodes].filter(
            (child) => child.nodeType !== Node.TEXT_NODE || child.nodeValue.trim(),
        );

        if (!children.length) return `${prefix}<${node.nodeName}${attrs}/>`;

        // a single text child stays on one line
        if (children.length === 1 && children[0].nodeType === Node.TEXT_NODE) {
            return `${prefix}<${node.nodeName}${attrs}>${children[0].nodeValue.trim()}</${node.nodeName}>`;
        }

        const inner = children.map((child) => serialise(child, depth + 1)).filter(Boolean).join('\n');
        return `${prefix}<${node.nodeName}${attrs}>\n${inner}\n${prefix}</${node.nodeName}>`;
    };

    const declaration = /^<\?xml[^?]*\?>/.exec(text.trim());
    const body = [...doc.childNodes]
        .map((node) => serialise(node, 0))
        .filter(Boolean)
        .join('\n');

    return (declaration ? `${declaration[0]}\n` : '') + body;
}

/** XML element tree -> plain JS value. Attributes become @-prefixed keys. */
function xmlToValue(node, options) {
    const children = [...node.children];
    const text = [...node.childNodes]
        .filter((n) => n.nodeType === Node.TEXT_NODE || n.nodeType === Node.CDATA_SECTION_NODE)
        .map((n) => n.nodeValue)
        .join('')
        .trim();

    const attributes = {};
    for (const attr of node.attributes || []) {
        attributes[`${options.attrPrefix}${attr.name}`] = options.coerce ? coerce(attr.value) : attr.value;
    }

    if (!children.length) {
        const value = options.coerce ? coerce(text) : text;
        if (!Object.keys(attributes).length) return value;
        return { ...attributes, ...(text ? { [options.textKey]: value } : {}) };
    }

    const result = { ...attributes };
    for (const child of children) {
        const value = xmlToValue(child, options);
        if (child.tagName in result) {
            if (!Array.isArray(result[child.tagName])) result[child.tagName] = [result[child.tagName]];
            result[child.tagName].push(value);
        } else {
            result[child.tagName] = value;
        }
    }
    if (text) result[options.textKey] = options.coerce ? coerce(text) : text;
    return result;
}

function valueToXml(value, tagName, depth, indent) {
    const pad = ' '.repeat(indent).repeat(depth);
    const safeTag = String(tagName).replace(/[^\w.:-]/g, '_').replace(/^[^A-Za-z_]/, '_');

    if (value === null || value === undefined) return `${pad}<${safeTag}/>`;

    if (Array.isArray(value)) {
        return value.map((item) => valueToXml(item, safeTag, depth, indent)).join('\n');
    }

    if (typeof value === 'object' && !(value instanceof Date)) {
        const attrs = [];
        const children = [];
        let inner = null;

        for (const [key, child] of Object.entries(value)) {
            if (key.startsWith('@')) attrs.push(` ${key.slice(1)}="${escapeHtml(String(child))}"`);
            else if (key === '#text') inner = child;
            else children.push(valueToXml(child, key, depth + 1, indent));
        }

        if (!children.length && inner === null) return `${pad}<${safeTag}${attrs.join('')}/>`;
        if (!children.length) return `${pad}<${safeTag}${attrs.join('')}>${escapeHtml(String(inner))}</${safeTag}>`;
        return `${pad}<${safeTag}${attrs.join('')}>\n${children.join('\n')}\n${pad}</${safeTag}>`;
    }

    return `${pad}<${safeTag}>${escapeHtml(String(value))}</${safeTag}>`;
}

/** Turn nested objects into flat dotted paths so they fit a CSV row. */
function flatten(value, prefix = '', out = {}) {
    if (value === null || typeof value !== 'object' || value instanceof Date) {
        out[prefix || 'value'] = value;
        return out;
    }
    if (Array.isArray(value)) {
        if (!value.length) out[prefix] = '';
        value.forEach((item, i) => flatten(item, prefix ? `${prefix}.${i}` : String(i), out));
        return out;
    }
    const entries = Object.entries(value);
    if (!entries.length) out[prefix] = '';
    for (const [key, child] of entries) {
        flatten(child, prefix ? `${prefix}.${key}` : key, out);
    }
    return out;
}

function toPhpArray(value, depth = 0, indent = 4) {
    const pad = ' '.repeat(indent * (depth + 1));
    const closePad = ' '.repeat(indent * depth);
    const literal = (v) => {
        if (v === null || v === undefined) return 'null';
        if (typeof v === 'boolean') return v ? 'true' : 'false';
        if (typeof v === 'number') return String(v);
        return `'${String(v).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
    };

    if (value === null || typeof value !== 'object') return literal(value);

    if (Array.isArray(value)) {
        if (!value.length) return '[]';
        const items = value.map((item) => `${pad}${toPhpArray(item, depth + 1, indent)}`);
        return `[\n${items.join(',\n')},\n${closePad}]`;
    }

    const entries = Object.entries(value);
    if (!entries.length) return '[]';
    const items = entries.map(([key, item]) => `${pad}${literal(key)} => ${toPhpArray(item, depth + 1, indent)}`);
    return `[\n${items.join(',\n')},\n${closePad}]`;
}

/** Parse PHP array syntax (both array(...) and [...]) into a JS value. */
function parsePhpArray(source) {
    let text = source.trim()
        .replace(/^<\?php\s*/i, '')
        .replace(/\?>\s*$/, '')
        .replace(/^\s*(?:return|\$\w+\s*=)\s*/i, '')
        .replace(/;\s*$/, '')
        .trim();

    let i = 0;
    const error = (message) => {
        const line = text.slice(0, i).split('\n').length;
        throw new Error(`${message} at line ${line}`);
    };

    const skip = () => {
        while (i < text.length) {
            if (/\s/.test(text[i])) { i++; continue; }
            if (text.startsWith('//', i) || text[i] === '#') {
                while (i < text.length && text[i] !== '\n') i++;
                continue;
            }
            if (text.startsWith('/*', i)) {
                const end = text.indexOf('*/', i);
                i = end === -1 ? text.length : end + 2;
                continue;
            }
            break;
        }
    };

    const parseString = (quote) => {
        i++;
        let out = '';
        while (i < text.length && text[i] !== quote) {
            if (text[i] === '\\') {
                const next = text[i + 1];
                const map = { n: '\n', t: '\t', r: '\r', '\\': '\\', "'": "'", '"': '"', 0: '\0' };
                out += map[next] ?? next;
                i += 2;
                continue;
            }
            out += text[i++];
        }
        if (text[i] !== quote) error('Unterminated string');
        i++;
        return out;
    };

    const parseValue = () => {
        skip();
        const char = text[i];
        if (char === undefined) error('Unexpected end of input');

        if (char === "'" || char === '"') return parseString(char);

        if (char === '[' || /^array\s*\(/i.test(text.slice(i))) {
            const open = char === '[' ? '[' : '(';
            const close = char === '[' ? ']' : ')';
            i += char === '[' ? 1 : text.slice(i).match(/^array\s*\(/i)[0].length;

            const items = [];
            const map = new Map();
            let isMap = false;

            for (;;) {
                skip();
                if (text[i] === close) { i++; break; }
                if (i >= text.length) error(`Missing closing ${close}`);

                const first = parseValue();
                skip();

                if (text.startsWith('=>', i)) {
                    i += 2;
                    isMap = true;
                    map.set(first, parseValue());
                } else {
                    items.push(first);
                    map.set(items.length - 1, first);
                }

                skip();
                if (text[i] === ',') { i++; continue; }
                if (text[i] === close) { i++; break; }
                if (i >= text.length) error(`Missing closing ${close}`);
                error(`Expected , or ${close} but found "${text[i]}"`);
            }
            void open;

            if (!isMap) return items;
            return Object.fromEntries(map);
        }

        const literal = /^(true|false|null|-?\d+\.?\d*(?:[eE][+-]?\d+)?)/i.exec(text.slice(i));
        if (literal) {
            i += literal[0].length;
            const token = literal[0].toLowerCase();
            if (token === 'true') return true;
            if (token === 'false') return false;
            if (token === 'null') return null;
            return Number(literal[0]);
        }

        error(`Unexpected character "${text[i]}"`);
        return null;
    };

    const value = parseValue();
    skip();
    if (i < text.length) error('Unexpected trailing content');
    return value;
}

const jsonSample = '{\n  "id": 42,\n  "name": "Ada Lovelace",\n  "active": true,\n  "tags": ["math", "computing"],\n  "address": { "city": "London", "postcode": "W1" }\n}';

// --------------------------------------------------------------------------

export const dataTools = [
    // ---------------------------------------------------------------- JSON
    {
        id: 'json-formatter',
        name: 'JSON Formatter & Beautifier',
        description: 'Format, beautify, validate and inspect JSON.',
        category: 'json',
        icon: '{ }',
        keywords: ['json', 'format', 'formatter', 'beautify', 'beautifier', 'prettify', 'pretty print',
            'validate', 'indent', 'tree', 'unminify', 'expand', 'sort keys'],
        spec: {
            lede: 'Reformats JSON and points at the exact line if it will not parse.',
            input: { label: 'JSON', placeholder: '{"a":1}', sample: jsonSample },
            output: { label: 'Formatted', filename: 'formatted.json' },
            options: [
                { id: 'indent', type: 'select', label: 'Indent', default: '2',
                  choices: [
                      { value: '2', label: '2 spaces' }, { value: '4', label: '4 spaces' },
                      { value: 'tab', label: 'Tab' }, { value: '0', label: 'Minified' },
                  ] },
                { id: 'sortKeys', type: 'checkbox', label: 'Sort keys alphabetically', default: false },
                { id: 'repair', type: 'checkbox', label: 'Repair broken JSON', default: false,
                  hint: 'Trailing commas, single quotes, bare keys, comments, NaN' },
                { id: 'sizes', type: 'checkbox', label: 'Show what is taking up the space', default: false },
            ],
            run: ({ input, options }) => {
                let source = input;
                let repairNotes = [];

                if (options.repair) {
                    try {
                        JSON.parse(input);
                    } catch {
                        const repaired = repairJson(input);
                        source = repaired.text;
                        repairNotes = repaired.fixes;
                    }
                }

                const value = parseJson(source);

                const sort = (node) => {
                    if (Array.isArray(node)) return node.map(sort);
                    if (node && typeof node === 'object') {
                        return Object.fromEntries(Object.keys(node).sort().map((k) => [k, sort(node[k])]));
                    }
                    return node;
                };

                const prepared = options.sortKeys ? sort(value) : value;
                const indent = options.indent === 'tab' ? '\t' : Number(options.indent);
                const output = JSON.stringify(prepared, null, indent);

                // quick structural summary
                let nodes = 0;
                let depth = 0;
                const walk = (node, level) => {
                    nodes++;
                    depth = Math.max(depth, level);
                    if (Array.isArray(node)) node.forEach((item) => walk(item, level + 1));
                    else if (node && typeof node === 'object') Object.values(node).forEach((item) => walk(item, level + 1));
                };
                walk(value, 1);

                const type = Array.isArray(value) ? `array of ${value.length}` : typeof value;

                const banners = [];
                if (repairNotes.length) {
                    banners.push(`
                        <div class="alert warn">
                            <span>!</span>
                            <span><strong>Repaired to make it parse.</strong> ${repairNotes.map(escapeHtml).join('; ')}.
                            Check the result is what you meant before using it.</span>
                        </div>`);
                }

                // Which keys are actually costing you bytes — the question you
                // have when a payload is unexpectedly large.
                if (options.sizes && value && typeof value === 'object') {
                    const sizes = [];
                    const measure = (node, path) => {
                        const bytes = new TextEncoder().encode(JSON.stringify(node) ?? 'null').length;
                        sizes.push({ path, bytes, type: Array.isArray(node) ? `array[${node.length}]` : typeof node });
                        return bytes;
                    };

                    const walkSizes = (node, path, depthLeft) => {
                        if (!node || typeof node !== 'object' || depthLeft <= 0) return;
                        const entries = Array.isArray(node)
                            ? node.map((v, i) => [`[${i}]`, v])
                            : Object.entries(node);
                        for (const [key, child] of entries) {
                            const childPath = Array.isArray(node) ? `${path}${key}` : `${path}.${key}`;
                            measure(child, childPath);
                            walkSizes(child, childPath, depthLeft - 1);
                        }
                    };
                    walkSizes(value, '$', 3);

                    const total = new TextEncoder().encode(JSON.stringify(value)).length;
                    const top = sizes.sort((a, b) => b.bytes - a.bytes).slice(0, 15);

                    banners.push(`
                        <div class="tool-section" style="margin-top:1.5rem;">
                            <h3>Size breakdown — ${total.toLocaleString()} bytes minified</h3>
                            <div class="table-wrap" style="max-height:340px;">
                                <table class="data">
                                    <thead><tr><th>Path</th><th style="width:100px">Type</th><th style="width:100px">Bytes</th><th style="width:180px">Share</th></tr></thead>
                                    <tbody>
                                        ${top.map((row) => {
                                            const percent = (row.bytes / total) * 100;
                                            return `<tr>
                                                <td><span class="copy-cell"><span>${escapeHtml(row.path)}</span>
                                                    <button class="copy-chip" data-copy="${escapeHtml(row.path)}">Copy</button></span></td>
                                                <td>${escapeHtml(row.type)}</td>
                                                <td class="num">${row.bytes.toLocaleString()}</td>
                                                <td><span class="bar" style="width:${Math.max(2, percent).toFixed(1)}%"></span>
                                                    <span class="bar-label">${percent.toFixed(1)}%</span></td>
                                            </tr>`;
                                        }).join('')}
                                    </tbody>
                                </table>
                            </div>
                            <div class="helper-text">Nested paths are counted inside their parent, so shares overlap by design — read it as "this subtree costs N bytes".</div>
                        </div>`);
                }

                return {
                    output,
                    extraHtml: banners.join(''),
                    note: `Valid JSON · ${type} · ${nodes.toLocaleString()} nodes · depth ${depth}`
                        + (repairNotes.length ? ` · repaired (${repairNotes.length} fixes)` : ''),
                };
            },
        },
    },
    {
        id: 'json-minifier',
        name: 'JSON Minifier',
        description: 'Strip all whitespace from JSON to make it as small as possible.',
        category: 'json',
        icon: '{·}',
        keywords: ['json', 'minify', 'compress', 'compact', 'shrink'],
        spec: {
            lede: 'Parses then re-serialises with no spacing, which also validates the input.',
            input: { label: 'JSON', placeholder: '{ "a": 1 }', sample: jsonSample },
            output: { label: 'Minified', filename: 'minified.json' },
            run: ({ input }) => {
                const output = JSON.stringify(parseJson(input));
                const saved = input.length - output.length;
                const percent = input.length ? ((saved / input.length) * 100).toFixed(1) : '0';
                return { output, note: `${output.length.toLocaleString()} chars — saved ${saved.toLocaleString()} (${percent}%)` };
            },
        },
    },
    {
        id: 'json-validator',
        name: 'JSON Validator',
        description: 'Check JSON for syntax errors and get the exact line and column.',
        category: 'json',
        icon: '{✓}',
        keywords: ['json', 'validate', 'check', 'syntax', 'error', 'lint'],
        spec: {
            lede: 'Reports the first syntax error with its position, plus a structure summary when valid.',
            input: { label: 'JSON', placeholder: '{"a": 1,}', sample: '{\n  "name": "test",\n  "values": [1, 2, 3,],\n  "ok": true\n}' },
            output: { label: 'Result', filename: 'validation.txt' },
            run: ({ input }) => {
                try {
                    const value = parseJson(input);
                    const describe = (node) => {
                        if (Array.isArray(node)) return `array (${node.length} items)`;
                        if (node === null) return 'null';
                        if (typeof node === 'object') return `object (${Object.keys(node).length} keys)`;
                        return typeof node;
                    };

                    const lines = ['✓ Valid JSON', '', `Root: ${describe(value)}`];
                    if (value && typeof value === 'object' && !Array.isArray(value)) {
                        lines.push('', 'Top-level keys:');
                        for (const [key, child] of Object.entries(value)) {
                            lines.push(`  ${key}: ${describe(child)}`);
                        }
                    }
                    return {
                        output: lines.join('\n'),
                        extraHtml: '<div class="alert ok" style="margin-top:1.5rem;"><span>✓</span><span>Valid JSON</span></div>',
                        note: 'Valid',
                    };
                } catch (err) {
                    return {
                        output: `✕ Invalid JSON\n\n${err.message}`,
                        extraHtml: `<div class="alert err" style="margin-top:1.5rem;"><span>✕</span><span>${escapeHtml(err.message)}</span></div>`,
                        note: 'Invalid',
                    };
                }
            },
        },
    },
    {
        id: 'json-escape',
        name: 'JSON Escape',
        description: 'Escape text so it can be used as a JSON string value.',
        category: 'json',
        icon: '{\\}',
        keywords: ['json', 'escape', 'string', 'quote'],
        spec: {
            lede: 'Escapes quotes, backslashes and control characters.',
            input: { label: 'Text', placeholder: 'He said "hi"', sample: 'He said "hi"\nSecond line\tTabbed' },
            output: { label: 'JSON string', filename: 'escaped.json' },
            swap: true,
            options: [{ id: 'quotes', type: 'checkbox', label: 'Include surrounding quotes', default: false }],
            run: ({ input, options }) => {
                const escaped = JSON.stringify(input);
                return options.quotes ? escaped : escaped.slice(1, -1);
            },
        },
    },
    {
        id: 'json-unescape',
        name: 'JSON Unescape',
        description: 'Turn an escaped JSON string back into raw text.',
        category: 'json',
        icon: '{/}',
        keywords: ['json', 'unescape', 'decode', 'string'],
        spec: {
            lede: 'Also useful for reading a JSON document that has been embedded inside another JSON string.',
            input: { label: 'Escaped string', placeholder: 'He said \\"hi\\"', sample: '{\\"name\\":\\"test\\",\\"line\\":\\"one\\\\ntwo\\"}' },
            output: { label: 'Raw text', filename: 'unescaped.txt' },
            swap: true,
            run: ({ input }) => {
                let text = input.trim();
                if (/^".*"$/s.test(text)) return JSON.parse(text);
                try {
                    return JSON.parse(`"${text}"`);
                } catch {
                    throw new Error('Not a valid escaped JSON string — check for unescaped quotes or a stray backslash');
                }
            },
        },
    },

    // ----------------------------------------------------------------- XML
    {
        id: 'xml-formatter',
        name: 'XML Formatter',
        description: 'Pretty-print XML with proper indentation and validate it as you go.',
        category: 'json',
        icon: '</>',
        keywords: ['xml', 'format', 'beautify', 'pretty', 'indent'],
        spec: {
            lede: 'Uses the browser XML parser, so malformed documents are reported rather than silently mangled.',
            input: { label: 'XML', placeholder: '<root><a>1</a></root>', sample: '<?xml version="1.0"?><catalog><book id="1"><title>XML Guide</title><price currency="GBP">29.99</price></book><book id="2"><title>More XML</title><price currency="GBP">35.00</price></book></catalog>' },
            output: { label: 'Formatted', filename: 'formatted.xml' },
            options: [{ id: 'indent', type: 'number', label: 'Indent size', default: 2, min: 0, max: 8 }],
            run: ({ input, options }) => formatXml(input, options.indent),
        },
    },
    {
        id: 'xml-minifier',
        name: 'XML Minifier',
        description: 'Remove whitespace between XML elements to shrink the document.',
        category: 'json',
        icon: '<·>',
        keywords: ['xml', 'minify', 'compress', 'compact'],
        spec: {
            lede: 'Validates first, then strips inter-element whitespace and comments.',
            input: { label: 'XML', placeholder: '<root>\n  <a>1</a>\n</root>', sample: '<?xml version="1.0"?>\n<catalog>\n    <!-- books -->\n    <book id="1">\n        <title>XML Guide</title>\n    </book>\n</catalog>' },
            output: { label: 'Minified', filename: 'minified.xml' },
            options: [{ id: 'comments', type: 'checkbox', label: 'Remove comments', default: true }],
            run: ({ input, options }) => {
                xmlDocument(input);
                let output = input.trim();
                if (options.comments) output = output.replace(/<!--[\s\S]*?-->/g, '');
                output = output.replace(/>\s+</g, '><').replace(/\s{2,}/g, ' ').trim();
                const saved = input.length - output.length;
                return { output, note: `${output.length.toLocaleString()} chars — saved ${saved.toLocaleString()}` };
            },
        },
    },
    {
        id: 'xml-validator',
        name: 'XML Validator',
        description: 'Check XML for well-formedness and get the exact error location.',
        category: 'json',
        icon: '<✓>',
        keywords: ['xml', 'validate', 'check', 'wellformed', 'syntax', 'error'],
        spec: {
            lede: 'Well-formedness checking via the browser XML parser.',
            input: { label: 'XML', placeholder: '<root><a></root>', sample: '<catalog>\n  <book id="1">\n    <title>Unclosed\n  </book>\n</catalog>' },
            output: { label: 'Result', filename: 'xml-validation.txt' },
            run: ({ input }) => {
                try {
                    const doc = xmlDocument(input);
                    const elements = doc.getElementsByTagName('*').length;
                    return {
                        output: `✓ Well-formed XML\n\nRoot element: <${doc.documentElement.nodeName}>\nTotal elements: ${elements}`,
                        extraHtml: '<div class="alert ok" style="margin-top:1.5rem;"><span>✓</span><span>Well-formed XML</span></div>',
                        note: 'Valid',
                    };
                } catch (err) {
                    return {
                        output: `✕ Not well-formed\n\n${err.message}`,
                        extraHtml: `<div class="alert err" style="margin-top:1.5rem;"><span>✕</span><span>${escapeHtml(err.message)}</span></div>`,
                        note: 'Invalid',
                    };
                }
            },
            footnote: 'This checks well-formedness (tags balanced, one root, valid characters). It does not validate against a DTD or XSD schema.',
        },
    },
    {
        id: 'xml-escape',
        name: 'XML Escape',
        description: 'Escape the five predefined XML entities.',
        category: 'json',
        icon: '<&',
        keywords: ['xml', 'escape', 'entity', 'encode'],
        spec: {
            lede: 'Escapes & < > " and \' — the only entities XML predefines.',
            input: { label: 'Text', placeholder: 'a < b & c', sample: 'Tom & Jerry — "5 < 10" said O\'Brien' },
            output: { label: 'Escaped', filename: 'escaped.xml' },
            swap: true,
            run: ({ input }) => input
                .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;').replace(/'/g, '&apos;'),
        },
    },
    {
        id: 'xml-unescape',
        name: 'XML Unescape',
        description: 'Decode XML entities back into plain characters.',
        category: 'json',
        icon: '&>',
        keywords: ['xml', 'unescape', 'entity', 'decode'],
        spec: {
            lede: 'Handles the five predefined entities plus numeric character references.',
            input: { label: 'Escaped XML', placeholder: 'a &lt; b', sample: 'Tom &amp; Jerry &#8212; &quot;5 &lt; 10&quot; said O&apos;Brien' },
            output: { label: 'Text', filename: 'unescaped.txt' },
            swap: true,
            run: ({ input }) => input
                .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
                .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
                .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
                .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
                .replace(/&amp;/g, '&'),
        },
    },
    {
        id: 'xml-to-json',
        name: 'XML to JSON',
        description: 'Convert an XML document into equivalent JSON.',
        category: 'json',
        icon: 'X→J',
        keywords: ['xml', 'json', 'convert', 'transform'],
        spec: {
            lede: 'Attributes become @-prefixed keys and repeated elements collapse into arrays.',
            input: { label: 'XML', placeholder: '<root><a>1</a></root>', sample: '<catalog>\n  <book id="1" lang="en">\n    <title>XML Guide</title>\n    <price>29.99</price>\n  </book>\n  <book id="2" lang="en">\n    <title>More XML</title>\n    <price>35.00</price>\n  </book>\n</catalog>' },
            output: { label: 'JSON', filename: 'converted.json' },
            options: [
                { id: 'coerce', type: 'checkbox', label: 'Convert numbers and booleans', default: true },
                { id: 'attrPrefix', type: 'text', label: 'Attribute prefix', default: '@' },
                { id: 'textKey', type: 'text', label: 'Text content key', default: '#text' },
                { id: 'indent', type: 'number', label: 'Indent', default: 2, min: 0, max: 8 },
            ],
            run: ({ input, options }) => {
                const doc = xmlDocument(input);
                const root = doc.documentElement;
                const value = { [root.nodeName]: xmlToValue(root, options) };
                return JSON.stringify(value, null, options.indent);
            },
        },
    },
    {
        id: 'json-to-xml',
        name: 'JSON to XML',
        description: 'Convert JSON into an XML document.',
        category: 'json',
        icon: 'J→X',
        keywords: ['json', 'xml', 'convert', 'transform'],
        spec: {
            lede: 'Keys starting with @ become attributes; #text becomes element content.',
            input: { label: 'JSON', placeholder: '{"root":{"a":1}}', sample: '{\n  "catalog": {\n    "book": [\n      { "@id": "1", "title": "XML Guide", "price": 29.99 },\n      { "@id": "2", "title": "More XML", "price": 35.0 }\n    ]\n  }\n}' },
            output: { label: 'XML', filename: 'converted.xml' },
            options: [
                { id: 'indent', type: 'number', label: 'Indent size', default: 2, min: 0, max: 8 },
                { id: 'declaration', type: 'checkbox', label: 'Include <?xml ... ?> declaration', default: true },
                { id: 'rootName', type: 'text', label: 'Root name (used when JSON has several top-level keys)', default: 'root' },
            ],
            run: ({ input, options }) => {
                const value = parseJson(input);
                const keys = value && typeof value === 'object' && !Array.isArray(value) ? Object.keys(value) : [];

                let body;
                if (keys.length === 1) body = valueToXml(value[keys[0]], keys[0], 0, options.indent);
                else body = valueToXml(value, options.rootName || 'root', 0, options.indent);

                return (options.declaration ? '<?xml version="1.0" encoding="UTF-8"?>\n' : '') + body;
            },
        },
    },

    // ---------------------------------------------------------------- YAML
    {
        id: 'yaml-to-json',
        name: 'YAML to JSON',
        description: 'Convert YAML into JSON, including multi-document files.',
        category: 'json',
        icon: 'Y→J',
        keywords: ['yaml', 'yml', 'json', 'convert', 'transform'],
        spec: {
            lede: 'Anchors and aliases are resolved. Multi-document YAML becomes a JSON array.',
            input: { label: 'YAML', placeholder: 'name: test\nvalues:\n  - 1\n  - 2', sample: 'name: my-service\nreplicas: 3\nenabled: true\nports:\n  - 8080\n  - 8443\nresources:\n  limits:\n    cpu: 500m\n    memory: 512Mi' },
            output: { label: 'JSON', filename: 'converted.json' },
            options: [{ id: 'indent', type: 'number', label: 'Indent', default: 2, min: 0, max: 8 }],
            run: async ({ input, options }) => {
                const yaml = await libs.yaml();
                try {
                    const documents = yaml.loadAll(input);
                    const value = documents.length === 1 ? documents[0] : documents;
                    return {
                        output: JSON.stringify(value ?? null, null, options.indent),
                        note: documents.length > 1 ? `${documents.length} YAML documents` : undefined,
                    };
                } catch (err) {
                    throw new Error(err.message.split('\n').slice(0, 3).join(' ').trim());
                }
            },
        },
    },
    {
        id: 'json-to-yaml',
        name: 'JSON to YAML',
        description: 'Convert JSON into readable YAML.',
        category: 'json',
        icon: 'J→Y',
        keywords: ['json', 'yaml', 'yml', 'convert', 'transform'],
        spec: {
            lede: 'Handy for turning API responses into Kubernetes or CI configuration.',
            input: { label: 'JSON', placeholder: '{"a": 1}', sample: jsonSample },
            output: { label: 'YAML', filename: 'converted.yaml' },
            options: [
                { id: 'indent', type: 'number', label: 'Indent', default: 2, min: 1, max: 8 },
                { id: 'quoteStrings', type: 'checkbox', label: 'Always quote strings', default: false },
                { id: 'flowLevel', type: 'number', label: 'Inline from depth (-1 = never)', default: -1, min: -1, max: 10 },
            ],
            run: async ({ input, options }) => {
                const yaml = await libs.yaml();
                return yaml.dump(parseJson(input), {
                    indent: options.indent,
                    lineWidth: 120,
                    noRefs: true,
                    quotingType: options.quoteStrings ? '"' : "'",
                    forceQuotes: options.quoteStrings,
                    flowLevel: options.flowLevel,
                });
            },
        },
    },
    {
        id: 'yaml-validator',
        name: 'YAML Validator',
        description: 'Check YAML syntax and report the failing line.',
        category: 'json',
        icon: 'Y✓',
        keywords: ['yaml', 'yml', 'validate', 'check', 'syntax', 'lint', 'error'],
        spec: {
            lede: 'YAML is whitespace-sensitive and easy to get wrong — this pinpoints where.',
            input: { label: 'YAML', placeholder: 'key: value', sample: 'name: test\nlist:\n  - one\n   - two\nbad: [unclosed' },
            output: { label: 'Result', filename: 'yaml-validation.txt' },
            run: async ({ input }) => {
                const yaml = await libs.yaml();
                try {
                    const documents = yaml.loadAll(input);
                    return {
                        output: `✓ Valid YAML\n\nDocuments: ${documents.length}\nRoot type: ${Array.isArray(documents[0]) ? 'array' : typeof documents[0]}`,
                        extraHtml: '<div class="alert ok" style="margin-top:1.5rem;"><span>✓</span><span>Valid YAML</span></div>',
                        note: 'Valid',
                    };
                } catch (err) {
                    const message = err.message.split('\n').slice(0, 4).join('\n');
                    return {
                        output: `✕ Invalid YAML\n\n${message}`,
                        extraHtml: `<div class="alert err" style="margin-top:1.5rem;"><span>✕</span><span>${escapeHtml(message)}</span></div>`,
                        note: 'Invalid',
                    };
                }
            },
        },
    },

    // ----------------------------------------------------------------- CSV
    {
        id: 'csv-to-json',
        name: 'CSV to JSON',
        description: 'Convert CSV or TSV into JSON, with automatic delimiter detection.',
        category: 'data',
        icon: 'C→J',
        keywords: ['csv', 'tsv', 'json', 'convert', 'transform', 'delimiter'],
        spec: {
            lede: 'Quoted fields, embedded newlines and doubled quotes are handled correctly.',
            input: {
                label: 'CSV',
                accept: '.csv,.tsv,.txt',
                placeholder: 'name,age\nAda,36',
                sample: 'name,age,city,active\nAda Lovelace,36,London,true\n"Smith, John",42,"New York",false\nGrace Hopper,85,Arlington,true',
            },
            output: { label: 'JSON', filename: 'converted.json' },
            options: [
                { id: 'delimiter', type: 'select', label: 'Delimiter', default: 'auto',
                  choices: [
                      { value: 'auto', label: 'Detect automatically' }, { value: ',', label: 'Comma' },
                      { value: ';', label: 'Semicolon' }, { value: '\t', label: 'Tab' }, { value: '|', label: 'Pipe' },
                  ] },
                { id: 'header', type: 'checkbox', label: 'First row is a header', default: true },
                { id: 'coerce', type: 'checkbox', label: 'Convert numbers and booleans', default: true },
                { id: 'skipEmpty', type: 'checkbox', label: 'Skip blank rows', default: true },
                { id: 'indent', type: 'number', label: 'Indent', default: 2, min: 0, max: 8 },
            ],
            run: ({ input, options }) => {
                const delimiter = options.delimiter === 'auto' ? sniffDelimiter(input) : options.delimiter;
                let rows = parseCsv(input, delimiter);
                if (options.skipEmpty) rows = rows.filter((row) => row.some((cell) => cell.trim() !== ''));
                if (!rows.length) return '[]';

                const convert = (cell) => (options.coerce ? coerce(cell) : cell);
                let result;

                if (options.header) {
                    const headers = rows[0].map((h, i) => h.trim() || `column_${i + 1}`);
                    result = rows.slice(1).map((row) => Object.fromEntries(
                        headers.map((key, i) => [key, convert(row[i] ?? '')]),
                    ));
                } else {
                    result = rows.map((row) => row.map(convert));
                }

                const names = { ',': 'comma', ';': 'semicolon', '\t': 'tab', '|': 'pipe' };
                return {
                    output: JSON.stringify(result, null, options.indent),
                    note: `${result.length.toLocaleString()} rows · ${names[delimiter] || delimiter}-delimited`,
                };
            },
        },
    },
    {
        id: 'json-to-csv',
        name: 'JSON to CSV',
        description: 'Flatten a JSON array into CSV, including nested objects.',
        category: 'data',
        icon: 'J→C',
        keywords: ['json', 'csv', 'convert', 'transform', 'flatten', 'export'],
        spec: {
            lede: 'Nested objects become dotted column names so nothing is lost.',
            input: {
                label: 'JSON array',
                placeholder: '[{"a":1},{"a":2}]',
                sample: '[\n  { "name": "Ada", "age": 36, "address": { "city": "London" } },\n  { "name": "Grace", "age": 85, "address": { "city": "Arlington" } }\n]',
            },
            output: { label: 'CSV', filename: 'converted.csv' },
            options: [
                { id: 'delimiter', type: 'select', label: 'Delimiter', default: ',',
                  choices: [{ value: ',', label: 'Comma' }, { value: ';', label: 'Semicolon' }, { value: '\t', label: 'Tab' }, { value: '|', label: 'Pipe' }] },
                { id: 'flatten', type: 'checkbox', label: 'Flatten nested objects', default: true },
                { id: 'header', type: 'checkbox', label: 'Include header row', default: true },
            ],
            run: ({ input, options }) => {
                const value = parseJson(input);
                let items = Array.isArray(value) ? value : [value];
                if (!items.length) return '';

                if (items.some((item) => item === null || typeof item !== 'object')) {
                    items = items.map((item) => (item !== null && typeof item === 'object' ? item : { value: item }));
                }
                if (options.flatten) items = items.map((item) => flatten(item));

                const { keys, rows } = objectsToRows(items);
                const all = options.header ? [keys, ...rows] : rows;
                return {
                    output: toCsv(all, options.delimiter),
                    note: `${rows.length.toLocaleString()} rows · ${keys.length} columns`,
                };
            },
        },
    },

    // ----------------------------------------------------------------- PHP
    {
        id: 'php-to-json',
        name: 'PHP Array to JSON',
        description: 'Convert PHP array syntax into JSON.',
        category: 'json',
        icon: 'P→J',
        keywords: ['php', 'array', 'json', 'convert', 'var_export'],
        spec: {
            lede: 'Understands both array(...) and short [...] syntax, with comments and trailing commas.',
            input: {
                label: 'PHP array',
                placeholder: "['a' => 1, 'b' => 2]",
                sample: "<?php\nreturn [\n    'name' => 'my-service',\n    'replicas' => 3,\n    'enabled' => true,\n    'ports' => [8080, 8443],\n    'limits' => array('cpu' => '500m', 'memory' => '512Mi'),\n];",
            },
            output: { label: 'JSON', filename: 'converted.json' },
            options: [{ id: 'indent', type: 'number', label: 'Indent', default: 2, min: 0, max: 8 }],
            run: ({ input, options }) => JSON.stringify(parsePhpArray(input), null, options.indent),
        },
    },
    {
        id: 'json-to-php',
        name: 'JSON to PHP Array',
        description: 'Convert JSON into a PHP array literal.',
        category: 'json',
        icon: 'J→P',
        keywords: ['json', 'php', 'array', 'convert', 'export'],
        spec: {
            lede: 'Emits modern short-array syntax with single-quoted strings.',
            input: { label: 'JSON', placeholder: '{"a": 1}', sample: jsonSample },
            output: { label: 'PHP', filename: 'array.php' },
            options: [
                { id: 'indent', type: 'number', label: 'Indent', default: 4, min: 1, max: 8 },
                { id: 'assign', type: 'checkbox', label: 'Wrap in <?php return ...;', default: false },
            ],
            run: ({ input, options }) => {
                const php = toPhpArray(parseJson(input), 0, options.indent);
                return options.assign ? `<?php\n\nreturn ${php};\n` : php;
            },
        },
    },

    // ----------------------------------------------------------------- SQL
    {
        id: 'sql-formatter',
        name: 'SQL Formatter',
        description: 'Format SQL for readability across many dialects.',
        category: 'sql',
        icon: 'SQL',
        keywords: ['sql', 'format', 'beautify', 'pretty', 'query', 'indent', 'postgres', 'mysql'],
        spec: {
            lede: 'Keyword casing and clause breaking tuned per dialect.',
            input: {
                label: 'SQL',
                placeholder: 'select * from users where id = 1',
                sample: 'select u.id, u.name, count(o.id) as order_count from users u left join orders o on o.user_id = u.id where u.active = true and u.created_at > \'2024-01-01\' group by u.id, u.name having count(o.id) > 5 order by order_count desc limit 10;',
            },
            output: { label: 'Formatted', filename: 'formatted.sql' },
            options: [
                { id: 'dialect', type: 'select', label: 'Dialect', default: 'sql',
                  choices: [
                      { value: 'sql', label: 'Standard SQL' }, { value: 'postgresql', label: 'PostgreSQL' },
                      { value: 'mysql', label: 'MySQL' }, { value: 'sqlite', label: 'SQLite' },
                      { value: 'tsql', label: 'SQL Server (T-SQL)' }, { value: 'bigquery', label: 'BigQuery' },
                      { value: 'snowflake', label: 'Snowflake' }, { value: 'spark', label: 'Spark SQL' },
                  ] },
                { id: 'keywordCase', type: 'select', label: 'Keyword case', default: 'upper',
                  choices: [{ value: 'upper', label: 'UPPERCASE' }, { value: 'lower', label: 'lowercase' }, { value: 'preserve', label: 'Preserve' }] },
                { id: 'indent', type: 'number', label: 'Indent size', default: 2, min: 1, max: 8 },
            ],
            run: async ({ input, options }) => {
                const formatter = await libs.sqlFormatter();
                try {
                    return formatter.format(input, {
                        language: options.dialect,
                        keywordCase: options.keywordCase,
                        tabWidth: options.indent,
                    });
                } catch (err) {
                    throw new Error(`Could not parse the SQL: ${err.message.split('\n')[0]}`);
                }
            },
        },
    },
    {
        id: 'sql-minifier',
        name: 'SQL Minifier',
        description: 'Collapse SQL onto a single line and strip comments.',
        category: 'sql',
        icon: 'SQL·',
        keywords: ['sql', 'minify', 'compress', 'compact', 'one line'],
        spec: {
            lede: 'Useful for pasting a query into a config file or log line. String literals are preserved.',
            input: { label: 'SQL', placeholder: 'SELECT *\nFROM users', sample: '-- fetch active users\nSELECT\n    id,\n    name  -- display name\nFROM users\nWHERE active = true\n  AND note = \'keep -- this\';' },
            output: { label: 'Minified', filename: 'minified.sql' },
            options: [{ id: 'comments', type: 'checkbox', label: 'Remove comments', default: true }],
            run: ({ input, options }) => {
                // Walk the text so we never touch the inside of a string literal.
                let out = '';
                let i = 0;
                while (i < input.length) {
                    const char = input[i];

                    if (char === "'" || char === '"' || char === '`') {
                        const quote = char;
                        let literal = char;
                        i++;
                        while (i < input.length) {
                            literal += input[i];
                            if (input[i] === quote && input[i - 1] !== '\\') {
                                if (input[i + 1] === quote) { literal += input[++i]; i++; continue; }
                                i++;
                                break;
                            }
                            i++;
                        }
                        out += literal;
                        continue;
                    }

                    if (options.comments && char === '-' && input[i + 1] === '-') {
                        while (i < input.length && input[i] !== '\n') i++;
                        out += ' ';
                        continue;
                    }
                    if (options.comments && char === '/' && input[i + 1] === '*') {
                        const end = input.indexOf('*/', i + 2);
                        i = end === -1 ? input.length : end + 2;
                        out += ' ';
                        continue;
                    }

                    out += char;
                    i++;
                }

                const output = out.replace(/\s+/g, ' ').replace(/\s*([(),;])\s*/g, '$1 ').replace(/\s+/g, ' ').trim();
                return { output, note: `${output.length.toLocaleString()} chars — saved ${(input.length - output.length).toLocaleString()}` };
            },
        },
    },
    {
        id: 'sql-escape',
        name: 'SQL Escape',
        description: 'Escape a string for safe use inside a SQL literal.',
        category: 'sql',
        icon: "'\\'",
        keywords: ['sql', 'escape', 'quote', 'literal', 'injection'],
        spec: {
            lede: 'Doubles single quotes, which is the portable way to write a literal quote in SQL.',
            input: { label: 'Text', placeholder: "O'Brien", sample: "O'Brien said \"it's fine\"" },
            output: { label: 'Escaped', filename: 'escaped.sql' },
            swap: true,
            options: [
                { id: 'quotes', type: 'checkbox', label: 'Wrap in single quotes', default: true },
                { id: 'backslash', type: 'checkbox', label: 'Also escape backslashes (MySQL)', default: false },
            ],
            run: ({ input, options }) => {
                let out = input.replace(/'/g, "''");
                if (options.backslash) out = out.replace(/\\/g, '\\\\');
                return options.quotes ? `'${out}'` : out;
            },
            footnote: '<strong>Escaping is not a substitute for parameterised queries.</strong> Use bound parameters (<code>?</code> / <code>$1</code> / <code>@name</code>) for anything that came from a user — that is the only reliable defence against SQL injection. Use this tool for hand-written literals, migrations and seed data.',
        },
    },
];

export { parseJson, formatXml, xmlDocument, flatten, toPhpArray, parsePhpArray };
