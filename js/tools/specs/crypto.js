// Hashing, HMAC, bcrypt and JWT tools.
import { ALGORITHMS, digest, hmac } from '../../lib/hashes.js';
import { libs } from '../../lib/loader.js';
import {
    utf8ToBytes, bytesToHex, hexToBytes,
    bytesToBase64, base64ToBytes, formatBytes,
} from '../../lib/bytes.js';

const escapeHtml = (value) => String(value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const ALGO_CHOICES = Object.entries(ALGORITHMS).map(([value, { label }]) => ({ value, label }));

function encodeDigest(bytes, encoding) {
    switch (encoding) {
        case 'hex-upper': return bytesToHex(bytes, { upper: true });
        case 'base64': return bytesToBase64(bytes);
        case 'base64url': return bytesToBase64(bytes, { urlSafe: true, pad: false });
        default: return bytesToHex(bytes);
    }
}

const ENCODING_CHOICES = [
    { value: 'hex', label: 'Hex (lowercase)' },
    { value: 'hex-upper', label: 'HEX (uppercase)' },
    { value: 'base64', label: 'Base64' },
    { value: 'base64url', label: 'Base64 URL-safe' },
];

/** Read the key/secret in whichever encoding the user says it is in. */
function decodeKey(text, encoding) {
    switch (encoding) {
        case 'hex': return hexToBytes(text);
        case 'base64': return base64ToBytes(text);
        default: return utf8ToBytes(text);
    }
}

const KEY_ENCODING_CHOICES = [
    { value: 'utf8', label: 'Plain text (UTF-8)' },
    { value: 'hex', label: 'Hexadecimal' },
    { value: 'base64', label: 'Base64' },
];

// --------------------------------------------------------------------------

export const cryptoTools = [
    {
        id: 'hash-generator',
        name: 'Hash Generator',
        description: 'MD5, SHA-1, SHA-2, SHA-3, Keccak and RIPEMD-160 digests of text or a file.',
        category: 'crypto',
        icon: '#',
        keywords: [
            'hash', 'checksum', 'digest', 'md5', 'sha1', 'sha-1', 'sha224', 'sha-224',
            'sha256', 'sha-256', 'sha384', 'sha-384', 'sha512', 'sha-512', 'sha3', 'sha-3',
            'keccak', 'ripemd', 'ripemd160', 'fingerprint', 'integrity', 'file hash',
        ],
        spec: {
            lede: 'Every algorithm is computed at once so you can compare against whichever checksum you were given. Files are hashed locally — nothing is uploaded.',
            input: {
                label: 'Text (or use the File button)',
                accept: '*/*',
                binary: false,
                placeholder: 'Type or paste anything…',
                sample: 'The quick brown fox jumps over the lazy dog',
            },
            output: { label: 'Digests', filename: 'hashes.txt' },
            options: [
                { id: 'encoding', type: 'select', label: 'Output encoding', default: 'hex', choices: ENCODING_CHOICES },
                { id: 'compare', type: 'text', label: 'Compare against (optional)', placeholder: 'Paste a checksum to check it matches' },
            ],
            run: async ({ input, options, bytes, fileName }) => {
                const data = bytes || utf8ToBytes(input);
                const results = [];

                for (const [id, { label }] of Object.entries(ALGORITHMS)) {
                    const value = encodeDigest(await digest(id, data), options.encoding);
                    results.push({ id, label, value });
                }

                const expected = (options.compare || '').trim().toLowerCase();
                const matched = expected ? results.filter((r) => r.value.toLowerCase() === expected) : [];

                const width = Math.max(...results.map((r) => r.label.length));
                const text = results.map((r) => `${r.label.padEnd(width)}  ${r.value}`).join('\n');

                const source = bytes
                    ? `${fileName} · ${formatBytes(bytes.length)}`
                    : `${data.length.toLocaleString()} bytes of text`;

                let banner = '';
                if (expected) {
                    banner = matched.length
                        ? `<div class="alert ok"><span>✓</span><span>Match — this is a valid <strong>${matched.map((m) => m.label).join(' / ')}</strong> digest of the input.</span></div>`
                        : '<div class="alert err"><span>✕</span><span>No match. The checksum does not correspond to this input under any supported algorithm.</span></div>';
                }

                const extraHtml = `
                    <div class="tool-section" style="margin-top:1.5rem;">
                        ${banner}
                        <h3>All digests — ${escapeHtml(source)}</h3>
                        <div class="table-wrap">
                            <table class="data">
                                <thead><tr><th style="width:140px">Algorithm</th><th style="width:60px">Bits</th><th>Digest</th></tr></thead>
                                <tbody>
                                    ${results.map((r) => {
                                        const isMatch = expected && r.value.toLowerCase() === expected;
                                        return `<tr${isMatch ? ' style="background:color-mix(in srgb, var(--green) 18%, transparent)"' : ''}>
                                            <td><strong>${r.label}</strong></td>
                                            <td class="num">${r.value.length * (options.encoding.startsWith('hex') ? 4 : 6)}</td>
                                            <td style="max-width:none;font-size:0.76rem">
                                                <span class="copy-cell">
                                                    <span>${r.value}</span>
                                                    <button class="copy-chip" data-copy="${r.value}" data-copy-label="${r.label} copied">Copy</button>
                                                </span>
                                            </td>
                                        </tr>`;
                                    }).join('')}
                                </tbody>
                            </table>
                        </div>
                    </div>`;

                return { output: text, extraHtml, note: source };
            },
            footnote: 'MD5 and SHA-1 are <strong>broken for security purposes</strong> — practical collision attacks exist for both. They are still fine for non-adversarial uses like cache keys, ETags and detecting accidental corruption. For signatures, certificates or password storage use SHA-256 or better (and for passwords specifically, bcrypt/argon2 rather than a raw hash).',
        },
    },

    {
        id: 'hmac-generator',
        name: 'HMAC Generator',
        description: 'Keyed-hash message authentication codes over any supported digest.',
        category: 'crypto',
        icon: '#🔑',
        keywords: [
            'hmac', 'mac', 'signature', 'sign', 'key', 'authentication', 'webhook',
            'hmac-md5', 'hmac-sha1', 'hmac-sha256', 'hmac-sha512', 'hmac-sha3',
        ],
        spec: {
            lede: 'RFC 2104 HMAC. Handy for verifying webhook signatures from Stripe, GitHub, Slack and friends.',
            input: {
                label: 'Message',
                placeholder: 'The payload to authenticate…',
                sample: 'The quick brown fox jumps over the lazy dog',
            },
            output: { label: 'HMAC', filename: 'hmac.txt' },
            options: [
                { id: 'algorithm', type: 'select', label: 'Algorithm', default: 'sha256',
                  choices: ALGO_CHOICES.filter((c) => c.value !== 'keccak-256') },
                { id: 'key', type: 'text', label: 'Secret key', default: 'key', placeholder: 'Shared secret' },
                { id: 'keyEncoding', type: 'select', label: 'Key is', default: 'utf8', choices: KEY_ENCODING_CHOICES },
                { id: 'encoding', type: 'select', label: 'Output encoding', default: 'hex', choices: ENCODING_CHOICES },
                { id: 'compare', type: 'text', label: 'Compare against (optional)', placeholder: 'Signature from the webhook header' },
            ],
            run: async ({ input, options }) => {
                if (!options.key) throw new Error('A secret key is required');

                const keyBytes = decodeKey(options.key, options.keyEncoding);
                const mac = await hmac(options.algorithm, keyBytes, utf8ToBytes(input));
                const value = encodeDigest(mac, options.encoding);

                const expected = (options.compare || '').trim();
                let banner = '';
                if (expected) {
                    // Strip a "sha256=" style prefix, which several providers use.
                    const cleaned = expected.replace(/^[a-z0-9-]+=/i, '');
                    const equal = cleaned.toLowerCase() === value.toLowerCase();
                    banner = equal
                        ? '<div class="alert ok"><span>✓</span><span>Signatures match — the payload is authentic.</span></div>'
                        : '<div class="alert err"><span>✕</span><span>Signatures do <strong>not</strong> match. Check the key, the algorithm, and that the message is byte-for-byte what was signed.</span></div>';
                }

                return {
                    output: value,
                    extraHtml: banner ? `<div class="tool-section" style="margin-top:1.5rem;">${banner}</div>` : '',
                    note: `${ALGORITHMS[options.algorithm].label} · ${mac.length} bytes`,
                };
            },
            footnote: 'When you verify a signature in production code, compare with a <strong>constant-time</strong> equality function (<code>crypto.timingSafeEqual</code>, <code>hmac.compare_digest</code>) rather than <code>===</code>, so an attacker cannot learn the correct value from response timing.',
        },
    },

    {
        id: 'bcrypt-generator',
        name: 'Bcrypt Generator',
        description: 'Hash a password with bcrypt at a chosen cost factor.',
        category: 'crypto',
        icon: '🔒',
        keywords: ['bcrypt', 'password', 'hash', 'salt', 'cost', 'rounds', 'blowfish'],
        spec: {
            lede: 'Bcrypt is deliberately slow and salts automatically, which is what makes it suitable for passwords.',
            input: { label: 'Password', placeholder: 'correct horse battery staple', sample: 'correct horse battery staple' },
            output: { label: 'Bcrypt hash', filename: 'bcrypt.txt' },
            live: false,
            actionLabel: 'Generate hash',
            options: [
                { id: 'rounds', type: 'number', label: 'Cost factor (rounds)', default: 10, min: 4, max: 15,
                  hint: 'Each +1 doubles the work. 10–12 is typical; 15 takes several seconds.' },
            ],
            run: async ({ input, options }) => {
                const bcrypt = await libs.bcrypt();
                const started = performance.now();
                const salt = bcrypt.genSaltSync(options.rounds);
                const hash = bcrypt.hashSync(input, salt);
                const elapsed = performance.now() - started;

                return {
                    output: hash,
                    note: `cost ${options.rounds} · took ${elapsed.toFixed(0)} ms`,
                    extraHtml: `
                        <div class="tool-section" style="margin-top:1.5rem;">
                            <h3>Anatomy</h3>
                            <div class="table-wrap">
                                <table class="data">
                                    <tbody>
                                        <tr><td style="width:150px"><strong>Algorithm</strong></td><td>${escapeHtml(hash.slice(0, 4))} — bcrypt, 2b revision</td></tr>
                                        <tr><td><strong>Cost</strong></td><td>${options.rounds} (2<sup>${options.rounds}</sup> = ${(2 ** options.rounds).toLocaleString()} iterations)</td></tr>
                                        <tr><td><strong>Salt</strong></td><td style="max-width:none">${escapeHtml(hash.slice(7, 29))}</td></tr>
                                        <tr><td><strong>Digest</strong></td><td style="max-width:none">${escapeHtml(hash.slice(29))}</td></tr>
                                    </tbody>
                                </table>
                            </div>
                        </div>`,
                };
            },
            footnote: 'Bcrypt silently truncates input at <strong>72 bytes</strong>. If you need to support longer passwords, pre-hash with SHA-256 first, or use argon2id instead. Hashes generated here are computed in your browser and never leave it — but do not paste a real production password into any web page, including this one.',
        },
    },

    {
        id: 'bcrypt-checker',
        name: 'Bcrypt Checker',
        description: 'Verify whether a password matches a bcrypt hash.',
        category: 'crypto',
        icon: '🔓',
        keywords: ['bcrypt', 'verify', 'check', 'compare', 'password', 'match'],
        spec: {
            lede: 'Paste the hash and the candidate password to test them against each other.',
            input: {
                label: 'Bcrypt hash',
                placeholder: '$2b$10$…',
                // A real cost-10 hash of the default password below, so Sample works out of the box.
                sample: '$2a$10$FCNJ8d1MrJeADd4JpAHJYuATO/RpVHKeRFI1kpWux.BGMV4b9IAfK',
            },
            output: { label: 'Result', filename: 'bcrypt-check.txt' },
            live: false,
            actionLabel: 'Check',
            options: [{
                id: 'password',
                type: 'text',
                label: 'Password to test',
                default: 'correct horse battery staple',
                placeholder: 'correct horse battery staple',
            }],
            run: async ({ input, options }) => {
                const hash = input.trim();
                if (!hash) throw new Error('Paste a bcrypt hash first');
                if (!/^\$2[abxy]?\$\d{2}\$[./A-Za-z0-9]{53}$/.test(hash)) {
                    throw new Error('That does not look like a bcrypt hash. Expected the form $2b$10$ followed by 53 characters.');
                }
                if (!options.password) throw new Error('Enter the password you want to test');

                const bcrypt = await libs.bcrypt();
                const started = performance.now();
                const matches = bcrypt.compareSync(options.password, hash);
                const elapsed = performance.now() - started;
                const cost = Number(hash.slice(4, 6));

                return {
                    output: matches ? '✓ MATCH — the password produces this hash' : '✕ NO MATCH',
                    note: `cost ${cost} · verified in ${elapsed.toFixed(0)} ms`,
                    extraHtml: `<div class="tool-section" style="margin-top:1.5rem;">
                        <div class="alert ${matches ? 'ok' : 'err'}">
                            <span>${matches ? '✓' : '✕'}</span>
                            <span>${matches
                                ? 'The password matches this hash.'
                                : 'The password does not match this hash.'}</span>
                        </div>
                    </div>`,
                };
            },
        },
    },

    {
        id: 'jwt-decoder',
        name: 'JWT Decoder',
        description: 'Decode a JSON Web Token and verify its HMAC signature.',
        category: 'crypto',
        icon: 'JWT',
        keywords: ['jwt', 'json web token', 'decode', 'bearer', 'claims', 'oauth', 'oidc', 'verify', 'signature'],
        spec: {
            lede: 'Splits the token, decodes the header and claims, renders the timestamps and — with a secret — checks the signature.',
            input: {
                label: 'JWT',
                placeholder: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.…',
                sample: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c',
            },
            output: { label: 'Decoded', filename: 'jwt.txt' },
            options: [
                { id: 'secret', type: 'text', label: 'Secret (optional — to verify HS256/384/512)', placeholder: 'your-256-bit-secret' },
                { id: 'secretEncoding', type: 'select', label: 'Secret is', default: 'utf8', choices: KEY_ENCODING_CHOICES },
            ],
            run: async ({ input, options }) => {
                const token = input.trim().replace(/^Bearer\s+/i, '');
                const parts = token.split('.');
                if (parts.length !== 3) {
                    throw new Error(`A JWT has three dot-separated parts; this has ${parts.length}. If it is encrypted (JWE) it will have five.`);
                }

                const decodePart = (part, name) => {
                    try {
                        return JSON.parse(new TextDecoder().decode(base64ToBytes(part)));
                    } catch {
                        throw new Error(`The ${name} is not valid base64url-encoded JSON`);
                    }
                };

                const header = decodePart(parts[0], 'header');
                const payload = decodePart(parts[1], 'payload');

                const now = Math.floor(Date.now() / 1000);
                const timeClaims = [];
                const describe = (key, label) => {
                    if (typeof payload[key] !== 'number') return;
                    const date = new Date(payload[key] * 1000);
                    const delta = payload[key] - now;
                    const relative = Math.abs(delta) < 60 ? `${Math.abs(delta)}s`
                        : Math.abs(delta) < 3600 ? `${Math.round(Math.abs(delta) / 60)}m`
                        : Math.abs(delta) < 86400 ? `${Math.round(Math.abs(delta) / 3600)}h`
                        : `${Math.round(Math.abs(delta) / 86400)}d`;
                    timeClaims.push({
                        key, label,
                        iso: date.toISOString(),
                        relative: delta < 0 ? `${relative} ago` : `in ${relative}`,
                        problem: (key === 'exp' && delta < 0) || (key === 'nbf' && delta > 0),
                    });
                };
                describe('iat', 'Issued at');
                describe('nbf', 'Not before');
                describe('exp', 'Expires');

                const expired = typeof payload.exp === 'number' && payload.exp < now;
                const notYetValid = typeof payload.nbf === 'number' && payload.nbf > now;

                // signature verification
                const algorithmMap = { HS256: 'sha256', HS384: 'sha384', HS512: 'sha512' };
                let signatureBanner = '';
                if (header.alg === 'none') {
                    signatureBanner = '<div class="alert err"><span>✕</span><span><strong>alg is "none"</strong> — this token is unsigned. Any server that accepts it is vulnerable to forgery.</span></div>';
                } else if (options.secret && algorithmMap[header.alg]) {
                    const expected = await hmac(
                        algorithmMap[header.alg],
                        decodeKey(options.secret, options.secretEncoding),
                        utf8ToBytes(`${parts[0]}.${parts[1]}`),
                    );
                    const valid = bytesToBase64(expected, { urlSafe: true, pad: false }) === parts[2];
                    signatureBanner = valid
                        ? '<div class="alert ok"><span>✓</span><span>Signature is <strong>valid</strong> for this secret.</span></div>'
                        : '<div class="alert err"><span>✕</span><span>Signature is <strong>invalid</strong> for this secret.</span></div>';
                } else if (options.secret) {
                    signatureBanner = `<div class="alert info"><span>ℹ</span><span>Cannot verify <code>${escapeHtml(header.alg || '?')}</code> here — only HS256, HS384 and HS512 use a shared secret. RS/ES/PS algorithms need the issuer's public key.</span></div>`;
                }

                const statusBanner = expired
                    ? '<div class="alert err"><span>✕</span><span>This token has <strong>expired</strong>.</span></div>'
                    : notYetValid
                        ? '<div class="alert warn"><span>!</span><span>This token is <strong>not valid yet</strong> (nbf is in the future).</span></div>'
                        : typeof payload.exp === 'number'
                            ? '<div class="alert ok"><span>✓</span><span>Token is within its validity window.</span></div>'
                            : '';

                const text = [
                    '── HEADER ──',
                    JSON.stringify(header, null, 2),
                    '',
                    '── PAYLOAD ──',
                    JSON.stringify(payload, null, 2),
                    '',
                    '── SIGNATURE ──',
                    parts[2],
                    '',
                    ...(timeClaims.length ? ['── TIMES ──', ...timeClaims.map((c) => `${c.key}  ${c.iso}  (${c.relative})`)] : []),
                ].join('\n');

                return {
                    output: text,
                    note: `${header.alg || 'unknown alg'} · ${Object.keys(payload).length} claims`,
                    extraHtml: `
                        <div class="tool-section" style="margin-top:1.5rem;">
                            ${statusBanner}${signatureBanner}
                            <div class="btn-row" style="margin-bottom:1rem;">
                                <button class="action-btn secondary" data-copy="${escapeHtml(JSON.stringify(payload, null, 2))}" data-copy-label="Payload copied">Copy payload</button>
                                <button class="action-btn secondary" data-copy="${escapeHtml(JSON.stringify(header, null, 2))}" data-copy-label="Header copied">Copy header</button>
                                <button class="action-btn secondary" data-copy="${escapeHtml(token)}" data-copy-label="Token copied">Copy token</button>
                            </div>
                            ${timeClaims.length ? `
                                <h3>Time claims</h3>
                                <div class="table-wrap" style="margin-bottom:1rem;">
                                    <table class="data">
                                        <thead><tr><th style="width:90px">Claim</th><th>Meaning</th><th>UTC</th><th>Relative</th></tr></thead>
                                        <tbody>
                                            ${timeClaims.map((c) => `
                                                <tr${c.problem ? ' style="color:var(--red)"' : ''}>
                                                    <td><strong>${c.key}</strong></td>
                                                    <td>${c.label}</td>
                                                    <td>${c.iso}</td>
                                                    <td>${c.relative}</td>
                                                </tr>`).join('')}
                                        </tbody>
                                    </table>
                                </div>` : ''}
                        </div>`,
                };
            },
            footnote: 'Decoding a JWT does <strong>not</strong> authenticate it — anyone can read and rewrite the claims. Only a verified signature makes a token trustworthy, and the server must pin the expected algorithm rather than trusting the token\'s own <code>alg</code> field.',
        },
    },
];
