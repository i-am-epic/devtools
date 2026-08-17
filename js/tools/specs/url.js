// URL tools: parsing, encoding, decoding, slugs.

const escapeHtml = (value) => String(value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

export const urlTools = [
    {
        id: 'url-parser',
        name: 'URL Parser',
        description: 'Break a URL into protocol, host, port, path, query parameters and fragment.',
        category: 'url',
        icon: '🔗',
        keywords: ['url', 'parse', 'query', 'string', 'parameter', 'host', 'origin'],
        spec: {
            lede: 'Splits a URL into every component and expands the query string into a readable table.',
            input: {
                label: 'URL',
                placeholder: 'https://example.com/path?a=1&b=2#section',
                sample: 'https://user:pw@shop.example.com:8443/catalog/items?q=blue+shoes&size=42&tags=a&tags=b#reviews',
            },
            output: { label: 'Components', filename: 'url-parts.txt' },
            run: ({ input }) => {
                const raw = input.trim();
                if (!raw) return '';

                let url;
                try {
                    url = new URL(raw);
                } catch {
                    try {
                        url = new URL(`https://${raw}`);
                    } catch {
                        throw new Error('Not a parseable URL. Include a scheme, e.g. https://example.com/path');
                    }
                }

                const params = [...url.searchParams.entries()];
                const rows = [
                    ['Protocol', url.protocol.replace(':', '')],
                    ['Username', url.username],
                    ['Password', url.password ? '•'.repeat(url.password.length) : ''],
                    ['Hostname', url.hostname],
                    ['Port', url.port || `(default${url.protocol === 'https:' ? ' 443' : url.protocol === 'http:' ? ' 80' : ''})`],
                    ['Origin', url.origin],
                    ['Path', url.pathname],
                    ['Query', url.search],
                    ['Fragment', url.hash.replace('#', '')],
                ].filter(([, value]) => value !== '');

                const text = [
                    ...rows.map(([label, value]) => `${(label + ':').padEnd(11)} ${value}`),
                    '',
                    `Query parameters (${params.length})`,
                    ...params.map(([key, value]) => `  ${key} = ${value}`),
                    '',
                    'Path segments',
                    ...url.pathname.split('/').filter(Boolean).map((seg, i) => `  [${i}] ${decodeURIComponent(seg)}`),
                ].join('\n');

                const extraHtml = params.length ? `
                    <div class="tool-section" style="margin-top:1.5rem;">
                        <h3>Query parameters</h3>
                        <div class="table-wrap">
                            <table class="data">
                                <thead><tr><th>Key</th><th>Raw value</th><th>Decoded</th></tr></thead>
                                <tbody>
                                    ${params.map(([key, value]) => `
                                        <tr>
                                            <td>${escapeHtml(key)}</td>
                                            <td>${escapeHtml(new URLSearchParams(url.search).get(key) === value ? value : value)}</td>
                                            <td>${escapeHtml(decodeURIComponent(value))}</td>
                                        </tr>`).join('')}
                                </tbody>
                            </table>
                        </div>
                    </div>` : '';

                return { output: text, extraHtml, note: `${params.length} query parameter${params.length === 1 ? '' : 's'}` };
            },
        },
    },

    {
        id: 'url-encoder',
        name: 'URL Encoder',
        description: 'Percent-encode text so it is safe inside a URL or query string.',
        category: 'url',
        icon: '%',
        keywords: ['url', 'encode', 'percent', 'escape', 'querystring', 'uri'],
        spec: {
            lede: 'Component encoding escapes &, =, ? and / — use it for query values. Full-URI encoding leaves URL structure intact.',
            input: { label: 'Text', placeholder: 'hello world & friends', sample: 'blue shoes & socks?size=42' },
            output: { label: 'Encoded', filename: 'encoded.txt' },
            swap: true,
            options: [
                { id: 'mode', type: 'select', label: 'Encoding', default: 'component',
                  choices: [
                      { value: 'component', label: 'Component (encodeURIComponent)' },
                      { value: 'uri', label: 'Full URI (encodeURI)' },
                      { value: 'form', label: 'Form / query (spaces as +)' },
                      { value: 'all', label: 'Every non-alphanumeric byte' },
                  ] },
            ],
            run: ({ input, options }) => {
                switch (options.mode) {
                    case 'uri': return encodeURI(input);
                    case 'form': return encodeURIComponent(input).replace(/%20/g, '+');
                    case 'all': return [...new TextEncoder().encode(input)]
                        .map((b) => (/[a-zA-Z0-9]/.test(String.fromCharCode(b))
                            ? String.fromCharCode(b)
                            : `%${b.toString(16).toUpperCase().padStart(2, '0')}`)).join('');
                    default: return encodeURIComponent(input);
                }
            },
        },
    },

    {
        id: 'url-decoder',
        name: 'URL Decoder',
        description: 'Decode percent-encoded URLs and query strings back to readable text.',
        category: 'url',
        icon: '%→',
        keywords: ['url', 'decode', 'percent', 'unescape', 'querystring', 'uri'],
        spec: {
            lede: 'Handles + as space and can decode repeatedly for double-encoded values.',
            input: { label: 'Encoded text', placeholder: 'hello%20world', sample: 'blue%20shoes%20%26%20socks%3Fsize%3D42' },
            output: { label: 'Decoded', filename: 'decoded.txt' },
            swap: true,
            options: [
                { id: 'plus', type: 'checkbox', label: 'Treat + as space', default: true },
                { id: 'repeat', type: 'checkbox', label: 'Decode repeatedly (double-encoded)', default: false },
            ],
            run: ({ input, options }) => {
                let text = input;
                const once = (value) => {
                    const prepared = options.plus ? value.replace(/\+/g, ' ') : value;
                    try {
                        return decodeURIComponent(prepared);
                    } catch {
                        throw new Error('Contains an invalid percent-escape (e.g. a lone % or %ZZ)');
                    }
                };

                text = once(text);
                if (options.repeat) {
                    for (let i = 0; i < 5 && /%[0-9a-f]{2}/i.test(text); i++) text = once(text);
                }
                return text;
            },
        },
    },

    {
        id: 'slug-generator',
        name: 'Slug Generator',
        description: 'Turn any text into a clean, SEO-friendly URL slug.',
        category: 'url',
        icon: '/-/',
        keywords: ['slug', 'slugify', 'url', 'seo', 'permalink', 'kebab'],
        spec: {
            lede: 'Accents are folded to ASCII, punctuation is dropped and words are joined by a separator.',
            input: { label: 'Text', placeholder: 'My Great Blog Post!', sample: '  Crème Brûlée & Café — 10 Best Recipes (2026)!  ' },
            output: { label: 'Slug', filename: 'slug.txt' },
            options: [
                { id: 'separator', type: 'select', label: 'Separator', default: '-',
                  choices: [{ value: '-', label: 'Hyphen (-)' }, { value: '_', label: 'Underscore (_)' }, { value: '.', label: 'Dot (.)' }] },
                { id: 'lower', type: 'checkbox', label: 'Lowercase', default: true },
                { id: 'perLine', type: 'checkbox', label: 'Slug each line separately', default: false },
                { id: 'maxLength', type: 'number', label: 'Max length (0 = no limit)', default: 0, min: 0, max: 300 },
            ],
            run: ({ input, options }) => {
                const slugify = (text) => {
                    let out = text
                        .normalize('NFKD')
                        .replace(/[̀-ͯ]/g, '')   // strip combining accents
                        .replace(/[ß]/g, 'ss')
                        .replace(/[øØ]/g, 'o')
                        .replace(/[æÆ]/g, 'ae')
                        .replace(/[đĐ]/g, 'd')
                        .replace(/['']/g, '')
                        .replace(/[^a-zA-Z0-9]+/g, options.separator)
                        .replace(new RegExp(`\\${options.separator}{2,}`, 'g'), options.separator)
                        .replace(new RegExp(`^\\${options.separator}|\\${options.separator}$`, 'g'), '');

                    if (options.lower) out = out.toLowerCase();
                    if (options.maxLength > 0 && out.length > options.maxLength) {
                        out = out.slice(0, options.maxLength);
                        const lastSep = out.lastIndexOf(options.separator);
                        if (lastSep > options.maxLength * 0.6) out = out.slice(0, lastSep);
                    }
                    return out;
                };

                return options.perLine
                    ? input.split('\n').map((line) => (line.trim() ? slugify(line) : '')).join('\n')
                    : slugify(input);
            },
        },
    },

    {
        id: 'query-builder',
        name: 'Query String Builder',
        description: 'Convert between a query string and a readable key/value list or JSON.',
        category: 'url',
        icon: '?=',
        keywords: ['query', 'string', 'params', 'json', 'build', 'convert'],
        spec: {
            lede: 'Paste a query string to expand it, or paste JSON / key=value lines to build one.',
            input: {
                label: 'Query string, JSON or key=value lines',
                placeholder: 'a=1&b=2   ·   {"a":1}   ·   a: 1',
                sample: 'utm_source=newsletter&utm_medium=email&page=2&q=blue shoes',
            },
            output: { label: 'Result', filename: 'query.txt' },
            options: [
                { id: 'direction', type: 'select', label: 'Convert', default: 'toJson',
                  choices: [
                      { value: 'toJson', label: 'Query string → JSON' },
                      { value: 'toQuery', label: 'JSON / lines → query string' },
                  ] },
                { id: 'encode', type: 'checkbox', label: 'Percent-encode values when building', default: true },
            ],
            run: ({ input, options }) => {
                const text = input.trim();
                if (!text) return '';

                if (options.direction === 'toJson') {
                    const queryPart = text.includes('?') ? text.slice(text.indexOf('?') + 1) : text;
                    const params = new URLSearchParams(queryPart.replace(/^[?&]/, ''));
                    const out = {};
                    for (const [key, value] of params.entries()) {
                        if (key in out) out[key] = [].concat(out[key], value);
                        else out[key] = value;
                    }
                    return JSON.stringify(out, null, 2);
                }

                let pairs = [];
                try {
                    const parsed = JSON.parse(text);
                    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
                        throw new Error('need object');
                    }
                    for (const [key, value] of Object.entries(parsed)) {
                        if (Array.isArray(value)) value.forEach((v) => pairs.push([key, v]));
                        else pairs.push([key, value]);
                    }
                } catch {
                    // fall back to key=value / key: value lines
                    pairs = text.split('\n').map((line) => line.trim()).filter(Boolean).map((line) => {
                        const match = line.match(/^([^=:]+)[=:]\s*(.*)$/);
                        if (!match) throw new Error(`Could not read "${line}" — expected key=value, key: value, or JSON`);
                        return [match[1].trim(), match[2].trim()];
                    });
                }

                const enc = (value) => (options.encode ? encodeURIComponent(value) : String(value));
                return pairs.map(([key, value]) => `${enc(key)}=${enc(value ?? '')}`).join('&');
            },
        },
    },
];
