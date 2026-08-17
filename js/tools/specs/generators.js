// Randomisers: passwords, passphrases, PINs and UUIDs.
// All randomness comes from crypto.getRandomValues via randomInt(), which is
// rejection-sampled so there is no modulo bias.

import { randomInt, randomBytes, bytesToHex, hexToBytes, utf8ToBytes } from '../../lib/bytes.js';
import { digest } from '../../lib/hashes.js';
import { WORDS } from '../../lib/wordlist.js';

/** The four namespaces defined in RFC 4122 for name-based UUIDs. */
const UUID_NAMESPACES = {
    dns: '6ba7b810-9dad-11d1-80b4-00c04fd430c8',
    url: '6ba7b811-9dad-11d1-80b4-00c04fd430c8',
    oid: '6ba7b812-9dad-11d1-80b4-00c04fd430c8',
    x500: '6ba7b814-9dad-11d1-80b4-00c04fd430c8',
};

/**
 * Name-based UUID (RFC 4122 §4.3): hash(namespace bytes + name), then stamp
 * the version and variant bits. Same input always gives the same UUID, which
 * is what makes these useful as stable ids you never have to store.
 */
async function nameBasedUuid(namespaceUuid, name, version) {
    const namespaceBytes = hexToBytes(namespaceUuid.replace(/-/g, ''));
    const nameBytes = utf8ToBytes(name);

    const input = new Uint8Array(namespaceBytes.length + nameBytes.length);
    input.set(namespaceBytes);
    input.set(nameBytes, namespaceBytes.length);

    const hashed = await digest(version === 5 ? 'sha1' : 'md5', input);
    const bytes = hashed.slice(0, 16);

    bytes[6] = (bytes[6] & 0x0f) | (version === 5 ? 0x50 : 0x30);
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    return bytesToHex(bytes);
}

const escapeHtml = (value) => String(value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const SETS = {
    lower: 'abcdefghijklmnopqrstuvwxyz',
    upper: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
    digits: '0123456789',
    symbols: '!@#$%^&*()-_=+[]{};:,.<>?/~',
};
const AMBIGUOUS = 'Il1O0o|`\'"{}[]()/\\';

/** Shared entropy read-out so every generator explains its own strength. */
function strengthPanel(bits, { label = 'Entropy', extra = '' } = {}) {
    const verdict = bits >= 128 ? ['Excellent', 'var(--green)']
        : bits >= 80 ? ['Strong', 'var(--green)']
        : bits >= 60 ? ['Reasonable', '#c9a800']
        : bits >= 40 ? ['Weak', 'var(--coral)']
        : ['Very weak', 'var(--red)'];

    // Offline attack estimate at 10^11 guesses/sec (a serious GPU rig against a fast hash).
    const seconds = (2 ** (bits - 1)) / 1e11;
    const human = seconds < 1 ? 'under a second'
        : seconds < 60 ? `${seconds.toFixed(1)} seconds`
        : seconds < 3600 ? `${(seconds / 60).toFixed(1)} minutes`
        : seconds < 86400 ? `${(seconds / 3600).toFixed(1)} hours`
        : seconds < 31557600 ? `${(seconds / 86400).toFixed(1)} days`
        : seconds < 31557600e3 ? `${(seconds / 31557600).toFixed(1)} years`
        : `${(seconds / 31557600).toExponential(2)} years`;

    return `
        <div class="tool-section" style="margin-top:1.5rem;">
            <div class="stat-grid">
                <div class="stat-tile">
                    <div class="stat-label">${label}</div>
                    <div class="stat-value">${bits.toFixed(1)}<span style="font-size:0.9rem;font-weight:600;color:var(--ink-3)"> bits</span></div>
                </div>
                <div class="stat-tile">
                    <div class="stat-label">Rating</div>
                    <div class="stat-value" style="color:${verdict[1]};font-size:1.25rem">${verdict[0]}</div>
                </div>
                <div class="stat-tile">
                    <div class="stat-label">Offline crack time</div>
                    <div class="stat-value" style="font-size:1.05rem">${human}</div>
                    <div class="stat-sub">at 10¹¹ guesses/sec</div>
                </div>
                ${extra}
            </div>
        </div>`;
}

export const generatorTools = [
    {
        id: 'password-generator',
        name: 'Password Generator',
        description: 'Generate strong random passwords with a live entropy read-out.',
        category: 'generators',
        icon: '🔑',
        keywords: ['password', 'random', 'generate', 'secure', 'strong', 'entropy', 'credentials'],
        spec: {
            lede: 'Generated with crypto.getRandomValues in your browser. Nothing is transmitted or stored.',
            layout: 'output',
            actionLabel: 'Generate',
            output: { label: 'Passwords', filename: 'passwords.txt' },
            options: [
                { id: 'length', type: 'number', label: 'Length', default: 20, min: 4, max: 256 },
                { id: 'count', type: 'number', label: 'How many', default: 5, min: 1, max: 100 },
                { id: 'lower', type: 'checkbox', label: 'a-z', default: true },
                { id: 'upper', type: 'checkbox', label: 'A-Z', default: true },
                { id: 'digits', type: 'checkbox', label: '0-9', default: true },
                { id: 'symbols', type: 'checkbox', label: 'Symbols', default: true },
                { id: 'noAmbiguous', type: 'checkbox', label: 'Avoid lookalikes (Il1O0)', default: false },
                { id: 'everySet', type: 'checkbox', label: 'Require one of each set', default: true },
            ],
            run: ({ options }) => {
                let alphabet = '';
                const required = [];
                for (const key of ['lower', 'upper', 'digits', 'symbols']) {
                    if (!options[key]) continue;
                    let set = SETS[key];
                    if (options.noAmbiguous) set = [...set].filter((c) => !AMBIGUOUS.includes(c)).join('');
                    alphabet += set;
                    required.push(set);
                }

                if (!alphabet) throw new Error('Enable at least one character set');
                const length = Math.max(4, Math.min(256, options.length));
                if (options.everySet && length < required.length) {
                    throw new Error(`Length must be at least ${required.length} to include one character from every enabled set`);
                }

                const makeOne = () => {
                    const chars = [];
                    if (options.everySet) {
                        for (const set of required) chars.push(set[randomInt(set.length)]);
                    }
                    while (chars.length < length) chars.push(alphabet[randomInt(alphabet.length)]);
                    // Fisher-Yates so the required characters are not stuck at the front
                    for (let i = chars.length - 1; i > 0; i--) {
                        const j = randomInt(i + 1);
                        [chars[i], chars[j]] = [chars[j], chars[i]];
                    }
                    return chars.join('');
                };

                const passwords = Array.from({ length: Math.min(100, options.count) }, makeOne);
                const bits = length * Math.log2(alphabet.length);

                return {
                    output: passwords.join('\n'),
                    note: `${alphabet.length}-character alphabet · ${bits.toFixed(1)} bits each`,
                    extraHtml: strengthPanel(bits, {
                        extra: `<div class="stat-tile">
                                    <div class="stat-label">Alphabet</div>
                                    <div class="stat-value">${alphabet.length}</div>
                                    <div class="stat-sub">possible characters</div>
                                </div>`,
                    }),
                };
            },
            footnote: 'Entropy assumes an attacker knows your exact generator settings — the honest worst case. Crack times are for a <em>fast</em> hash; a password stored with bcrypt or argon2 takes far longer to attack.',
        },
    },

    {
        id: 'passphrase-generator',
        name: 'Passphrase Generator',
        description: 'Generate memorable multi-word passphrases with real entropy figures.',
        category: 'generators',
        icon: '📝',
        keywords: ['passphrase', 'diceware', 'words', 'memorable', 'random', 'password', 'xkcd'],
        spec: {
            lede: `Diceware-style passphrases drawn from a ${WORDS.length.toLocaleString()}-word list (${Math.log2(WORDS.length).toFixed(2)} bits per word).`,
            layout: 'output',
            actionLabel: 'Generate',
            output: { label: 'Passphrases', filename: 'passphrases.txt' },
            options: [
                { id: 'words', type: 'number', label: 'Words', default: 5, min: 2, max: 20 },
                { id: 'count', type: 'number', label: 'How many', default: 5, min: 1, max: 50 },
                { id: 'separator', type: 'select', label: 'Separator', default: '-',
                  choices: [
                      { value: '-', label: 'Hyphen' }, { value: '.', label: 'Dot' },
                      { value: '_', label: 'Underscore' }, { value: ' ', label: 'Space' }, { value: '', label: 'None' },
                  ] },
                { id: 'capitalise', type: 'checkbox', label: 'Capitalise each word', default: false },
                { id: 'number', type: 'checkbox', label: 'Append a digit', default: false },
            ],
            run: ({ options }) => {
                const wordCount = Math.max(2, Math.min(20, options.words));

                const makeOne = () => {
                    const picked = Array.from({ length: wordCount }, () => WORDS[randomInt(WORDS.length)]);
                    const shaped = options.capitalise
                        ? picked.map((w) => w[0].toUpperCase() + w.slice(1))
                        : picked;
                    let phrase = shaped.join(options.separator);
                    if (options.number) phrase += randomInt(10);
                    return phrase;
                };

                const phrases = Array.from({ length: Math.min(50, options.count) }, makeOne);
                const bits = wordCount * Math.log2(WORDS.length) + (options.number ? Math.log2(10) : 0);

                return {
                    output: phrases.join('\n'),
                    note: `${wordCount} words · ${bits.toFixed(1)} bits each`,
                    extraHtml: strengthPanel(bits, {
                        extra: `<div class="stat-tile">
                                    <div class="stat-label">Wordlist</div>
                                    <div class="stat-value">${WORDS.length.toLocaleString()}</div>
                                    <div class="stat-sub">${Math.log2(WORDS.length).toFixed(2)} bits per word</div>
                                </div>`,
                    }),
                };
            },
            footnote: 'Capitalising words or appending a digit adds far less entropy than one extra word — if you want it stronger, add a word.',
        },
    },

    {
        id: 'pin-generator',
        name: 'PIN Generator',
        description: 'Generate random numeric PINs, optionally with no repeated digits.',
        category: 'generators',
        icon: '#️⃣',
        keywords: ['pin', 'number', 'numeric', 'random', 'code', 'otp'],
        spec: {
            lede: 'Uniform random digits — not the pseudo-random Math.random most generators use.',
            layout: 'output',
            actionLabel: 'Generate',
            output: { label: 'PINs', filename: 'pins.txt' },
            options: [
                { id: 'length', type: 'number', label: 'Digits', default: 6, min: 3, max: 32 },
                { id: 'count', type: 'number', label: 'How many', default: 10, min: 1, max: 200 },
                { id: 'unique', type: 'checkbox', label: 'No repeated digits', default: false },
                { id: 'noSequence', type: 'checkbox', label: 'Reject runs like 1234 and 1111', default: true },
            ],
            run: ({ options }) => {
                const length = Math.max(3, Math.min(32, options.length));
                if (options.unique && length > 10) {
                    throw new Error('A PIN with no repeated digits cannot be longer than 10');
                }

                const isSequential = (pin) => {
                    if (/^(\d)\1+$/.test(pin)) return true;
                    let ascending = true;
                    let descending = true;
                    for (let i = 1; i < pin.length; i++) {
                        if (Number(pin[i]) !== Number(pin[i - 1]) + 1) ascending = false;
                        if (Number(pin[i]) !== Number(pin[i - 1]) - 1) descending = false;
                    }
                    return ascending || descending;
                };

                const makeOne = () => {
                    for (let attempt = 0; attempt < 500; attempt++) {
                        let pin;
                        if (options.unique) {
                            const digits = [...'0123456789'];
                            for (let i = digits.length - 1; i > 0; i--) {
                                const j = randomInt(i + 1);
                                [digits[i], digits[j]] = [digits[j], digits[i]];
                            }
                            pin = digits.slice(0, length).join('');
                        } else {
                            pin = Array.from({ length }, () => randomInt(10)).join('');
                        }
                        if (!options.noSequence || !isSequential(pin)) return pin;
                    }
                    throw new Error('Could not satisfy those constraints — try relaxing them');
                };

                const pins = Array.from({ length: Math.min(200, options.count) }, makeOne);
                const bits = options.unique
                    ? Math.log2(Array.from({ length }, (_, i) => 10 - i).reduce((a, b) => a * b, 1))
                    : length * Math.log2(10);

                return {
                    output: pins.join('\n'),
                    note: `${length} digits · ${bits.toFixed(1)} bits each`,
                    extraHtml: strengthPanel(bits),
                };
            },
            footnote: 'A numeric PIN is inherently low-entropy — a 6-digit PIN has only ~20 bits. PINs are only safe where the number of attempts is strictly rate-limited (a phone, a bank card), never as a standalone password.',
        },
    },

    {
        id: 'uuid-generator',
        name: 'UUID Generator',
        description: 'Generate UUID v4, time-ordered v7, or v1-style identifiers in bulk.',
        category: 'generators',
        icon: 'ID',
        keywords: ['uuid', 'guid', 'unique', 'identifier', 'v4', 'v7', 'random', 'id', 'key'],
        spec: {
            lede: 'v4 is fully random. v7 embeds a millisecond timestamp in the high bits, so IDs sort chronologically — much kinder to database indexes.',
            layout: 'output',
            actionLabel: 'Generate',
            output: { label: 'UUIDs', filename: 'uuids.txt' },
            options: [
                { id: 'version', type: 'select', label: 'Version', default: 'v4',
                  choices: [
                      { value: 'v4', label: 'v4 — random' },
                      { value: 'v7', label: 'v7 — time-ordered (recommended for keys)' },
                      { value: 'v5', label: 'v5 — deterministic from a name (SHA-1)' },
                      { value: 'v3', label: 'v3 — deterministic from a name (MD5)' },
                      { value: 'nil', label: 'Nil UUID' },
                      { value: 'max', label: 'Max UUID' },
                  ] },
                { id: 'count', type: 'number', label: 'How many', default: 10, min: 1, max: 1000 },
                { id: 'names', type: 'text', label: 'Names for v3/v5 (comma separated)',
                  placeholder: 'example.com, api.example.com',
                  hint: 'Same name + namespace always produces the same UUID' },
                { id: 'namespace', type: 'select', label: 'Namespace for v3/v5', default: 'dns',
                  choices: [
                      { value: 'dns', label: 'DNS' }, { value: 'url', label: 'URL' },
                      { value: 'oid', label: 'OID' }, { value: 'x500', label: 'X.500' },
                  ] },
                { id: 'format', type: 'select', label: 'Format', default: 'standard',
                  choices: [
                      { value: 'standard', label: 'Standard (8-4-4-4-12)' },
                      { value: 'nohyphen', label: 'No hyphens' },
                      { value: 'braces', label: 'Braced {…}' },
                      { value: 'urn', label: 'URN (urn:uuid:…)' },
                      { value: 'sql', label: 'SQL INSERT values' },
                      { value: 'jsonArray', label: 'JSON array' },
                      { value: 'csharp', label: 'C# Guid.Parse' },
                      { value: 'ts', label: 'TypeScript array' },
                  ] },
                { id: 'upper', type: 'checkbox', label: 'Uppercase', default: false },
            ],
            run: async ({ options }) => {
                const dashed = (hex) =>
                    `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;

                const format = (hex) => {
                    const standard = dashed(hex);
                    switch (options.format) {
                        case 'nohyphen': return hex;
                        case 'braces': return `{${standard}}`;
                        case 'urn': return `urn:uuid:${standard}`;
                        default: return standard;
                    }
                };

                const v4 = () => {
                    const bytes = randomBytes(16);
                    bytes[6] = (bytes[6] & 0x0f) | 0x40;  // version 4
                    bytes[8] = (bytes[8] & 0x3f) | 0x80;  // RFC 4122 variant
                    return bytesToHex(bytes);
                };

                const v7 = () => {
                    const bytes = randomBytes(16);
                    const now = BigInt(Date.now());
                    for (let i = 0; i < 6; i++) {
                        bytes[5 - i] = Number((now >> BigInt(8 * i)) & 0xffn);
                    }
                    bytes[6] = (bytes[6] & 0x0f) | 0x70;  // version 7
                    bytes[8] = (bytes[8] & 0x3f) | 0x80;
                    return bytesToHex(bytes);
                };

                const count = Math.max(1, Math.min(1000, options.count));
                let list;
                let names = [];

                if (options.version === 'nil') list = Array(count).fill('0'.repeat(32));
                else if (options.version === 'max') list = Array(count).fill('f'.repeat(32));
                else if (options.version === 'v5' || options.version === 'v3') {
                    names = (options.names || '').split(',').map((n) => n.trim()).filter(Boolean);
                    if (!names.length) {
                        throw new Error(
                            `${options.version.toUpperCase()} UUIDs are derived from a name — enter one or more `
                            + 'in the "Names" field, e.g. example.com, api.example.com',
                        );
                    }
                    const namespace = UUID_NAMESPACES[options.namespace];
                    list = [];
                    for (const name of names) {
                        // eslint-disable-next-line no-await-in-loop
                        list.push(await nameBasedUuid(namespace, name, options.version === 'v5' ? 5 : 3));
                    }
                } else list = Array.from({ length: count }, options.version === 'v7' ? v7 : v4);

                const formatted = list.map(format);
                let output;
                switch (options.format) {
                    case 'sql':
                        output = formatted.map((u) => `('${u}')`).join(',\n');
                        break;
                    case 'jsonArray':
                        output = JSON.stringify(formatted, null, 2);
                        break;
                    case 'csharp':
                        output = formatted.map((u) => `Guid.Parse("${u}")`).join(',\n');
                        break;
                    case 'ts':
                        output = `const ids = [\n${formatted.map((u) => `  '${u}',`).join('\n')}\n];`;
                        break;
                    default:
                        output = formatted.join('\n');
                }
                if (options.upper) output = output.toUpperCase();

                let extraHtml = '';
                if (options.version === 'v7') {
                    extraHtml = `
                        <div class="info-box" style="margin-top:1.5rem;">
                            These were generated at <strong>${escapeHtml(new Date().toISOString())}</strong>.
                            The first 48 bits encode that timestamp, so sorting these strings sorts them by creation time —
                            which keeps a B-tree primary key appending at the end instead of writing all over the index.
                        </div>`;
                } else if (options.version === 'v5' || options.version === 'v3') {
                    extraHtml = `
                        <div class="tool-section" style="margin-top:1.5rem;">
                            <div class="alert ok"><span>✓</span><span><strong>Deterministic.</strong>
                                These are derived from the namespace and the name, so the same inputs always
                                produce the same UUID — on any machine, in any language, forever. Useful as a
                                stable id for something that already has a natural key, with no lookup table.</span></div>
                            <div class="table-wrap">
                                <table class="data">
                                    <thead><tr><th style="width:40%">Name</th><th>UUID</th></tr></thead>
                                    <tbody>
                                        ${names.map((name, i) => `
                                            <tr>
                                                <td>${escapeHtml(name)}</td>
                                                <td style="max-width:none"><span class="copy-cell">
                                                    <span>${escapeHtml(dashed(list[i]))}</span>
                                                    <button class="copy-chip" data-copy="${escapeHtml(dashed(list[i]))}">Copy</button>
                                                </span></td>
                                            </tr>`).join('')}
                                    </tbody>
                                </table>
                            </div>
                            <div class="helper-text">Namespace ${escapeHtml(options.namespace.toUpperCase())} —
                                <code>${escapeHtml(UUID_NAMESPACES[options.namespace])}</code></div>
                        </div>`;
                }

                const note = options.version === 'v5' || options.version === 'v3'
                    ? `${list.length} deterministic UUID${list.length === 1 ? '' : 's'} from ${options.namespace.toUpperCase()} namespace`
                    : `${count.toLocaleString()} × ${options.version.toUpperCase()}${options.version === 'v4' ? ' · 122 bits of randomness each' : ''}`;

                return { output, extraHtml, note };
            },
        },
    },

    {
        id: 'random-number',
        name: 'Random Data Generator',
        description: 'Random integers, decimals, hex bytes, colours and picks from a list.',
        category: 'generators',
        icon: '🎲',
        keywords: ['random', 'number', 'integer', 'dice', 'shuffle', 'pick', 'sample', 'bytes', 'hex', 'token'],
        spec: {
            lede: 'Cryptographically secure random values in whatever shape you need.',
            layout: 'output',
            actionLabel: 'Generate',
            output: { label: 'Values', filename: 'random.txt' },
            options: [
                { id: 'kind', type: 'select', label: 'Type', default: 'integer',
                  choices: [
                      { value: 'integer', label: 'Integers' },
                      { value: 'decimal', label: 'Decimals' },
                      { value: 'hex', label: 'Hex token' },
                      { value: 'bytes', label: 'Byte array' },
                      { value: 'color', label: 'Hex colours' },
                      { value: 'boolean', label: 'true / false' },
                  ] },
                { id: 'count', type: 'number', label: 'How many', default: 10, min: 1, max: 1000 },
                { id: 'min', type: 'number', label: 'Minimum (integers/decimals)', default: 1 },
                { id: 'max', type: 'number', label: 'Maximum (integers/decimals)', default: 100 },
                { id: 'size', type: 'number', label: 'Length in bytes (hex/bytes)', default: 16, min: 1, max: 512 },
            ],
            run: ({ options }) => {
                const count = Math.max(1, Math.min(1000, options.count));
                const size = Math.max(1, Math.min(512, options.size));

                switch (options.kind) {
                    case 'integer': {
                        const lo = Math.ceil(Math.min(options.min, options.max));
                        const hi = Math.floor(Math.max(options.min, options.max));
                        const span = hi - lo + 1;
                        if (span < 1) throw new Error('Maximum must be greater than or equal to minimum');
                        return Array.from({ length: count }, () => lo + randomInt(span)).join('\n');
                    }
                    case 'decimal': {
                        const lo = Math.min(options.min, options.max);
                        const hi = Math.max(options.min, options.max);
                        const buf = new Uint32Array(count);
                        crypto.getRandomValues(buf);
                        return [...buf].map((n) => (lo + (n / 4294967296) * (hi - lo)).toFixed(6)).join('\n');
                    }
                    case 'hex':
                        return Array.from({ length: count }, () => bytesToHex(randomBytes(size))).join('\n');
                    case 'bytes':
                        return Array.from({ length: count }, () => `[${[...randomBytes(size)].join(', ')}]`).join('\n');
                    case 'color':
                        return Array.from({ length: count }, () => `#${bytesToHex(randomBytes(3))}`).join('\n');
                    case 'boolean':
                        return Array.from({ length: count }, () => (randomInt(2) ? 'true' : 'false')).join('\n');
                    default:
                        return '';
                }
            },
        },
    },
];
