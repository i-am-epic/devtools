// Everyday security tools: password analysis, TOTP codes, HTTP security
// headers, Content-Security-Policy, Basic auth and secret scanning.
//
// Everything here runs locally. Nothing typed into these tools is transmitted.

import { hmac } from '../../lib/hashes.js';
import {
    utf8ToBytes, bytesToUtf8, bytesToBase64, base64ToBytes,
    base32ToBytes, bytesToBase32, randomBytes,
} from '../../lib/bytes.js';

const escapeHtml = (value) => String(value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const statTile = (label, value, sub = '', colour = '') => `
    <div class="stat-tile">
        <div class="stat-label">${label}</div>
        <div class="stat-value"${colour ? ` style="color:${colour}"` : ''}>${value}</div>
        ${sub ? `<div class="stat-sub">${sub}</div>` : ''}
    </div>`;

const rowsToText = (rows) => {
    const width = Math.max(...rows.map(([label]) => String(label).length));
    return rows.map(([label, value]) => (label ? `${(`${label}:`).padEnd(width + 2)}${value}` : '')).join('\n');
};

const findingsTable = (findings) => {
    const colour = { error: 'var(--red)', warn: '#c9a800', info: 'var(--blue)', ok: 'var(--green)' };
    return `
        <div class="table-wrap" style="max-height:460px;">
            <table class="data">
                <thead><tr><th style="width:90px">Level</th><th style="width:230px">Item</th><th>Finding</th></tr></thead>
                <tbody>
                    ${findings.map((f) => `
                        <tr>
                            <td style="color:${colour[f.level]};font-weight:800">${f.level}</td>
                            <td><strong>${escapeHtml(f.name)}</strong></td>
                            <td style="white-space:normal;max-width:none">${f.message}</td>
                        </tr>`).join('')}
                </tbody>
            </table>
        </div>`;
};

// -------------------------------------------------------------- passwords --

/** The passwords that top every breach corpus. Not a full list — a smell test. */
const COMMON_PASSWORDS = new Set(('123456 password 123456789 12345678 12345 qwerty abc123 111111 123123 '
    + 'admin letmein welcome monkey 1234567890 password1 qwerty123 iloveyou 000000 dragon sunshine '
    + 'princess football charlie aa123456 donald qwertyuiop starwars passw0rd P@ssw0rd trustno1 '
    + 'master hello freedom whatever qazwsx zaq12wsx michael superman batman 123qwe 1q2w3e4r').split(' '));

const KEYBOARD_RUNS = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm', '1234567890', 'qazwsx', 'wsxedc'];

function analysePassword(password) {
    const findings = [];
    const lower = password.toLowerCase();

    let poolSize = 0;
    if (/[a-z]/.test(password)) poolSize += 26;
    if (/[A-Z]/.test(password)) poolSize += 26;
    if (/[0-9]/.test(password)) poolSize += 10;
    if (/[^a-zA-Z0-9]/.test(password)) poolSize += 33;

    let bits = password.length * Math.log2(poolSize || 1);

    if (COMMON_PASSWORDS.has(lower)) {
        findings.push({ level: 'error', name: 'Known password', message: 'This is one of the most common passwords in existence — it is tried within the first few seconds of any attack.' });
        bits = Math.min(bits, 8);
    }

    const stripped = lower.replace(/[0-9!@#$%^&*._-]+$/, '');
    if (stripped !== lower && COMMON_PASSWORDS.has(stripped)) {
        findings.push({ level: 'error', name: 'Common word plus suffix', message: `<code>${escapeHtml(stripped)}</code> with digits or punctuation appended is a pattern every cracking tool generates automatically.` });
        bits = Math.min(bits, 20);
    }

    for (const run of KEYBOARD_RUNS) {
        for (let i = 0; i + 4 <= run.length; i++) {
            if (lower.includes(run.slice(i, i + 4))) {
                findings.push({ level: 'warn', name: 'Keyboard pattern', message: `Contains <code>${escapeHtml(run.slice(i, i + 4))}</code>, a straight run across the keyboard.` });
                bits -= 10;
                i = run.length;
                break;
            }
        }
    }

    if (/(.)\1{2,}/.test(password)) {
        findings.push({ level: 'warn', name: 'Repeated characters', message: 'Three or more of the same character in a row adds far less than its length suggests.' });
        bits -= 6;
    }

    if (/(19|20)\d{2}/.test(password)) {
        findings.push({ level: 'warn', name: 'Looks like a year', message: 'A four-digit year is roughly 7 bits, not 13 — and is usually guessable from context.' });
        bits -= 6;
    }

    // l33t substitution rarely helps
    const deleeted = lower.replace(/[04]/g, 'a').replace(/[13]/g, 'e').replace(/0/g, 'o').replace(/[$5]/g, 's').replace(/1/g, 'i');
    if (deleeted !== lower && COMMON_PASSWORDS.has(deleeted)) {
        findings.push({ level: 'error', name: 'Leetspeak of a common word', message: `Reverses to <code>${escapeHtml(deleeted)}</code>. Character substitution is the first transformation any cracker applies.` });
        bits = Math.min(bits, 18);
    }

    if (password.length < 12) {
        findings.push({ level: 'warn', name: 'Short', message: 'Under 12 characters. Length beats complexity — a longer passphrase is stronger and easier to type.' });
    }
    if (poolSize <= 26 && password.length >= 12) {
        findings.push({ level: 'info', name: 'Single character set', message: 'All one case with no digits or symbols. Fine if it is long enough, but mixing adds cheap entropy.' });
    }
    if (!findings.length) {
        findings.push({ level: 'ok', name: 'No obvious weaknesses', message: 'No common password, keyboard run, repeat or date pattern found.' });
    }

    return { bits: Math.max(0, bits), poolSize, findings };
}

// ------------------------------------------------------------------ TOTP --

/** RFC 6238 TOTP over RFC 4226 HOTP. */
async function totpAt(secretBytes, timestampSeconds, { digits = 6, period = 30, algorithm = 'sha1' } = {}) {
    const counter = Math.floor(timestampSeconds / period);

    const message = new Uint8Array(8);
    let remaining = BigInt(counter);
    for (let i = 7; i >= 0; i--) {
        message[i] = Number(remaining & 0xffn);
        remaining >>= 8n;
    }

    const mac = await hmac(algorithm, secretBytes, message);
    const offset = mac[mac.length - 1] & 0x0f;
    const truncated = ((mac[offset] & 0x7f) << 24)
        | ((mac[offset + 1] & 0xff) << 16)
        | ((mac[offset + 2] & 0xff) << 8)
        | (mac[offset + 3] & 0xff);

    return String(truncated % 10 ** digits).padStart(digits, '0');
}

// --------------------------------------------------------------- headers --

function parseHeaders(text) {
    const headers = {};
    for (const line of text.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || /^HTTP\/\d/.test(trimmed)) continue;
        const colon = trimmed.indexOf(':');
        if (colon < 1) continue;
        headers[trimmed.slice(0, colon).trim().toLowerCase()] = trimmed.slice(colon + 1).trim();
    }
    return headers;
}

// --------------------------------------------------------------------------

export const securityTools = [
    {
        id: 'password-strength',
        name: 'Password Strength Checker',
        description: 'Measure real entropy and spot the patterns crackers try first.',
        category: 'security',
        icon: '🛡',
        keywords: ['password', 'strength', 'entropy', 'crack', 'secure', 'check', 'weak', 'audit',
            'brute force', 'dictionary', 'security'],
        spec: {
            lede: 'Scores by actual entropy rather than the usual "one uppercase, one digit" theatre — and names the specific pattern that weakens it.',
            input: { label: 'Password', placeholder: 'Type a password to analyse…', sample: 'P@ssw0rd2024' },
            output: { label: 'Analysis', filename: 'password-analysis.txt' },
            options: [
                { id: 'rate', type: 'select', label: 'Attacker capability', default: '1e11',
                  choices: [
                      { value: '1e4', label: 'Online, rate-limited — 10⁴/sec' },
                      { value: '1e9', label: 'Offline, slow hash (bcrypt) — 10⁹/sec' },
                      { value: '1e11', label: 'Offline, fast hash (SHA-256) — 10¹¹/sec' },
                      { value: '1e13', label: 'Nation-state, fast hash — 10¹³/sec' },
                  ] },
            ],
            run: ({ input, options }) => {
                const password = input.replace(/\n$/, '');
                if (!password) return '';

                const { bits, poolSize, findings } = analysePassword(password);
                const rate = Number(options.rate);
                const seconds = (2 ** (bits - 1)) / rate;

                const human = seconds < 1 ? 'instantly'
                    : seconds < 60 ? `${seconds.toFixed(1)} seconds`
                    : seconds < 3600 ? `${(seconds / 60).toFixed(1)} minutes`
                    : seconds < 86400 ? `${(seconds / 3600).toFixed(1)} hours`
                    : seconds < 31557600 ? `${(seconds / 86400).toFixed(1)} days`
                    : seconds < 31557600e6 ? `${(seconds / 31557600).toFixed(1)} years`
                    : `${(seconds / 31557600).toExponential(2)} years`;

                const verdict = bits >= 100 ? ['Excellent', 'var(--green)']
                    : bits >= 75 ? ['Strong', 'var(--green)']
                    : bits >= 55 ? ['Reasonable', '#c9a800']
                    : bits >= 35 ? ['Weak', 'var(--coral)']
                    : ['Very weak', 'var(--red)'];

                const composition = [
                    /[a-z]/.test(password) && 'lowercase',
                    /[A-Z]/.test(password) && 'uppercase',
                    /[0-9]/.test(password) && 'digits',
                    /[^a-zA-Z0-9]/.test(password) && 'symbols',
                ].filter(Boolean).join(', ');

                const rows = [
                    ['Length', password.length],
                    ['Character sets', composition || 'none'],
                    ['Alphabet size', poolSize],
                    ['Entropy', `${bits.toFixed(1)} bits`],
                    ['Rating', verdict[0]],
                    ['Time to crack', human],
                    ['', ''],
                    ['Findings', ''],
                    ...findings.map((f) => [`  ${f.level}`, f.message.replace(/<[^>]+>/g, '')]),
                ];

                return {
                    output: rowsToText(rows),
                    note: `${bits.toFixed(0)} bits — ${verdict[0]}`,
                    extraHtml: `
                        <div class="tool-section" style="margin-top:1.5rem;">
                            <div class="stat-grid">
                                ${statTile('Entropy', `${bits.toFixed(0)}<span style="font-size:.9rem;font-weight:600;color:var(--ink-3)"> bits</span>`)}
                                ${statTile('Rating', verdict[0], '', verdict[1])}
                                ${statTile('Time to crack', human, 'at the selected rate')}
                                ${statTile('Length', String(password.length), composition)}
                            </div>
                            ${findingsTable(findings)}
                        </div>`,
                };
            },
            footnote: 'Typed here, this never leaves your browser — but as a rule, do not paste a password you actually use into any website. Test the <em>pattern</em>, not the real thing. The strongest practical advice remains: a long passphrase from a password manager, unique per site, with 2FA on top.',
        },
    },

    {
        id: 'totp-generator',
        name: 'TOTP / 2FA Code Generator',
        description: 'Generate the current authenticator code from a base32 secret.',
        category: 'security',
        icon: '🔐',
        keywords: ['totp', '2fa', 'mfa', 'otp', 'authenticator', 'google authenticator', 'two factor',
            'rfc 6238', 'hotp', 'code', 'security', 'otpauth'],
        spec: {
            lede: 'RFC 6238 TOTP computed locally. Useful for testing an enrolment flow, or checking that your server and a device agree.',
            input: {
                label: 'Base32 secret (or an otpauth:// URI)',
                placeholder: 'JBSWY3DPEHPK3PXP',
                sample: 'JBSWY3DPEHPK3PXP',
            },
            output: { label: 'Codes', filename: 'totp.txt' },
            options: [
                { id: 'digits', type: 'number', label: 'Digits', default: 6, min: 6, max: 8 },
                { id: 'period', type: 'number', label: 'Period (seconds)', default: 30, min: 10, max: 120 },
                { id: 'algorithm', type: 'select', label: 'Algorithm', default: 'sha1',
                  choices: [
                      { value: 'sha1', label: 'SHA-1 (the default everywhere)' },
                      { value: 'sha256', label: 'SHA-256' },
                      { value: 'sha512', label: 'SHA-512' },
                  ] },
                { id: 'issuer', type: 'text', label: 'Issuer (for the otpauth URI)', default: 'Example', placeholder: 'Example' },
                { id: 'account', type: 'text', label: 'Account', default: 'user@example.com' },
            ],
            run: async ({ input, options }) => {
                let secret = input.trim();
                let { digits, period, algorithm } = options;

                // Accept a full otpauth:// URI and read its parameters.
                if (/^otpauth:\/\//i.test(secret)) {
                    const url = new URL(secret);
                    secret = url.searchParams.get('secret') || '';
                    digits = Number(url.searchParams.get('digits')) || digits;
                    period = Number(url.searchParams.get('period')) || period;
                    algorithm = (url.searchParams.get('algorithm') || algorithm).toLowerCase();
                }

                secret = secret.replace(/\s+/g, '').toUpperCase();
                if (!secret) return '';

                let secretBytes;
                try {
                    secretBytes = base32ToBytes(secret);
                } catch (err) {
                    throw new Error(`That is not a valid base32 secret: ${err.message}`);
                }
                if (!secretBytes.length) throw new Error('The secret is empty.');

                const now = Math.floor(Date.now() / 1000);
                const remaining = period - (now % period);

                const previous = await totpAt(secretBytes, now - period, { digits, period, algorithm });
                const current = await totpAt(secretBytes, now, { digits, period, algorithm });
                const next = await totpAt(secretBytes, now + period, { digits, period, algorithm });

                const uri = `otpauth://totp/${encodeURIComponent(options.issuer || 'Example')}:`
                    + `${encodeURIComponent(options.account || 'user')}?secret=${secret}`
                    + `&issuer=${encodeURIComponent(options.issuer || 'Example')}`
                    + `&algorithm=${algorithm.toUpperCase()}&digits=${digits}&period=${period}`;

                return {
                    output: [
                        `Current code:  ${current}`,
                        `Valid for:     ${remaining} more second${remaining === 1 ? '' : 's'}`,
                        '',
                        `Previous:      ${previous}`,
                        `Next:          ${next}`,
                        '',
                        `otpauth URI:   ${uri}`,
                    ].join('\n'),
                    note: `${current} · ${remaining}s left`,
                    extraHtml: `
                        <div class="tool-section" style="margin-top:1.5rem;">
                            <div class="stat-grid">
                                ${statTile('Current code', `<span style="letter-spacing:.15em">${current}</span>`,
                                    `${remaining}s remaining`, 'var(--green)')}
                                ${statTile('Previous', previous, 'still accepted by most servers')}
                                ${statTile('Next', next, 'clock-skew window')}
                            </div>
                            <div class="btn-row">
                                <button class="action-btn secondary" data-copy="${current}" data-copy-label="Code copied">Copy code</button>
                                <button class="action-btn secondary" data-copy="${escapeHtml(uri)}" data-copy-label="URI copied">Copy otpauth URI</button>
                            </div>
                            <div class="info-box">
                                Paste that <code>otpauth://</code> URI into the <strong>QR Code Generator</strong> to get a
                                scannable enrolment code. Servers normally accept the previous and next codes too, to
                                tolerate clock skew.
                            </div>
                        </div>`,
                };
            },
            footnote: 'A TOTP secret is a second factor — putting it in a browser tool alongside the password defeats the point of having two factors. Use this for <strong>test</strong> secrets and integration work, not for your real accounts.',
        },
    },

    {
        id: 'security-headers',
        name: 'Security Headers Analyser',
        description: 'Grade a set of HTTP response headers and see what is missing.',
        category: 'security',
        icon: '🔒',
        keywords: ['security headers', 'http', 'hsts', 'csp', 'x-frame-options', 'headers', 'scan',
            'grade', 'owasp', 'clickjacking', 'mime sniffing', 'referrer policy', 'security'],
        spec: {
            lede: 'Paste the response headers (curl -I, or the Network tab) — this grades them offline, so it works for localhost and internal sites a hosted scanner cannot reach.',
            input: {
                label: 'HTTP response headers',
                placeholder: 'content-type: text/html\nstrict-transport-security: max-age=31536000',
                sample: `HTTP/2 200
content-type: text/html; charset=utf-8
server: nginx/1.24.0
x-powered-by: Express
set-cookie: session=abc123; Path=/
access-control-allow-origin: *`,
            },
            output: { label: 'Report', filename: 'security-headers.txt' },
            run: ({ input }) => {
                const headers = parseHeaders(input);
                if (!Object.keys(headers).length) {
                    throw new Error('No headers found. Paste lines in the form "header-name: value".');
                }

                const findings = [];
                const add = (level, name, message, points = 0) => {
                    findings.push({ level, name, message });
                    return points;
                };

                let score = 0;
                const max = 100;

                const hsts = headers['strict-transport-security'];
                if (!hsts) {
                    add('error', 'Strict-Transport-Security', 'Missing. Without HSTS a first request over http can be intercepted and downgraded. Suggested: <code>max-age=31536000; includeSubDomains</code>.');
                } else {
                    const maxAge = Number(/max-age=(\d+)/.exec(hsts)?.[1] || 0);
                    if (maxAge < 15552000) {
                        score += add('warn', 'Strict-Transport-Security', `max-age is ${maxAge}s — under the 6 months (15552000) that preload lists require.`, 10);
                    } else {
                        score += add('ok', 'Strict-Transport-Security', `Present with max-age=${maxAge}.`, 20);
                    }
                }

                const csp = headers['content-security-policy'];
                if (!csp) {
                    add('error', 'Content-Security-Policy', 'Missing. CSP is the main defence against cross-site scripting. Start in report-only mode with <code>default-src \'self\'</code>.');
                } else if (/unsafe-inline|unsafe-eval/.test(csp)) {
                    score += add('warn', 'Content-Security-Policy', 'Present, but allows <code>unsafe-inline</code> or <code>unsafe-eval</code>, which removes most of its protection against XSS.', 10);
                } else {
                    score += add('ok', 'Content-Security-Policy', 'Present with no unsafe- directives.', 25);
                }

                const frame = headers['x-frame-options'];
                const frameAncestors = csp && /frame-ancestors/.test(csp);
                if (!frame && !frameAncestors) {
                    add('error', 'X-Frame-Options / frame-ancestors', 'Missing. The page can be framed by any site, which enables clickjacking. Use CSP <code>frame-ancestors \'none\'</code>.');
                } else {
                    score += add('ok', 'Clickjacking protection', frameAncestors ? 'CSP frame-ancestors is set.' : `X-Frame-Options: ${escapeHtml(frame)}.`, 15);
                }

                if (headers['x-content-type-options'] === 'nosniff') {
                    score += add('ok', 'X-Content-Type-Options', 'nosniff is set.', 10);
                } else {
                    add('error', 'X-Content-Type-Options', 'Missing <code>nosniff</code>. Browsers may guess a content type and execute a response you did not intend to be script.');
                }

                const referrer = headers['referrer-policy'];
                if (referrer) score += add('ok', 'Referrer-Policy', `Set to ${escapeHtml(referrer)}.`, 10);
                else add('warn', 'Referrer-Policy', 'Missing. Full URLs — including any tokens in the path or query — leak to third parties. Suggested: <code>strict-origin-when-cross-origin</code>.');

                if (headers['permissions-policy']) score += add('ok', 'Permissions-Policy', 'Present.', 10);
                else add('info', 'Permissions-Policy', 'Missing. Lets you switch off camera, microphone, geolocation and similar for the whole document.');

                const cors = headers['access-control-allow-origin'];
                if (cors === '*') {
                    if (headers['access-control-allow-credentials'] === 'true') {
                        add('error', 'CORS', '<code>Access-Control-Allow-Origin: *</code> together with credentials is invalid and browsers reject it — but the intent suggests a misconfiguration worth reviewing.');
                    } else {
                        add('warn', 'CORS', '<code>Access-Control-Allow-Origin: *</code> lets any site read this response. Fine for a public API, wrong for anything authenticated.');
                    }
                }

                const cookies = input.split('\n').filter((l) => /^set-cookie:/i.test(l.trim()));
                for (const cookie of cookies) {
                    const name = /set-cookie:\s*([^=]+)=/i.exec(cookie)?.[1]?.trim() || 'cookie';
                    const missing = [];
                    if (!/;\s*Secure/i.test(cookie)) missing.push('Secure');
                    if (!/;\s*HttpOnly/i.test(cookie)) missing.push('HttpOnly');
                    if (!/;\s*SameSite/i.test(cookie)) missing.push('SameSite');
                    if (missing.length) {
                        add('error', `Cookie "${name}"`, `Missing ${missing.map((m) => `<code>${m}</code>`).join(', ')}. Without HttpOnly a cookie is readable by any script that gets injected; without SameSite it rides along on cross-site requests.`);
                    } else {
                        score += add('ok', `Cookie "${name}"`, 'Secure, HttpOnly and SameSite all set.', 5);
                    }
                }

                for (const leaky of ['server', 'x-powered-by', 'x-aspnet-version', 'x-aspnetmvc-version']) {
                    if (headers[leaky]) {
                        add('warn', leaky, `Reveals <code>${escapeHtml(headers[leaky])}</code>. Version banners tell an attacker exactly which exploits to try — remove or blank it.`);
                    }
                }

                const percent = Math.min(100, Math.round((score / max) * 100));
                const grade = percent >= 90 ? 'A' : percent >= 75 ? 'B' : percent >= 60 ? 'C'
                    : percent >= 40 ? 'D' : percent >= 20 ? 'E' : 'F';
                const gradeColour = percent >= 75 ? 'var(--green)' : percent >= 40 ? '#c9a800' : 'var(--red)';

                const errors = findings.filter((f) => f.level === 'error').length;
                const warnings = findings.filter((f) => f.level === 'warn').length;

                return {
                    output: findings.map((f) => `${f.level.toUpperCase().padEnd(6)} ${f.name.padEnd(34)} ${f.message.replace(/<[^>]+>/g, '')}`).join('\n'),
                    note: `Grade ${grade} · ${errors} missing, ${warnings} warnings`,
                    extraHtml: `
                        <div class="tool-section" style="margin-top:1.5rem;">
                            <div class="stat-grid">
                                ${statTile('Grade', grade, `${percent}%`, gradeColour)}
                                ${statTile('Headers seen', String(Object.keys(headers).length))}
                                ${statTile('Missing', String(errors), '', errors ? 'var(--red)' : 'var(--green)')}
                                ${statTile('Warnings', String(warnings))}
                            </div>
                            ${findingsTable(findings)}
                        </div>`,
                };
            },
            footnote: 'Scoring is a rule of thumb for comparing before and after, not an industry standard. A header being present does not mean it is correct for your app — a CSP that allows <code>unsafe-inline</code> looks compliant and blocks very little.',
        },
    },

    {
        id: 'basic-auth',
        name: 'Basic Auth Encoder / Decoder',
        description: 'Build or read an HTTP Basic Authorization header.',
        category: 'security',
        icon: 'B64',
        keywords: ['basic auth', 'authorization', 'header', 'base64', 'credentials', 'http',
            'curl', 'encode', 'decode', 'username', 'password', 'security'],
        spec: {
            lede: 'Basic auth is username:password base64-encoded — encoding, not encryption. Anyone who sees the header sees the password.',
            input: {
                label: 'user:password, or an Authorization header',
                placeholder: 'admin:hunter2   ·   Basic YWRtaW46aHVudGVyMg==',
                sample: 'admin:hunter2',
            },
            output: { label: 'Result', filename: 'basic-auth.txt' },
            run: ({ input }) => {
                const value = input.trim();
                if (!value) return '';

                const headerMatch = /^(?:authorization:\s*)?basic\s+(\S+)$/i.exec(value);

                if (headerMatch || /^[A-Za-z0-9+/]+={0,2}$/.test(value) && value.includes(':') === false && value.length > 7) {
                    const encoded = headerMatch ? headerMatch[1] : value;
                    let decoded;
                    try {
                        decoded = bytesToUtf8(base64ToBytes(encoded));
                    } catch {
                        throw new Error('That is not valid base64.');
                    }
                    const separator = decoded.indexOf(':');
                    if (separator < 0) throw new Error('Decoded value has no colon — it is not a user:password pair.');

                    return {
                        output: rowsToText([
                            ['Username', decoded.slice(0, separator)],
                            ['Password', decoded.slice(separator + 1)],
                            ['Encoded', encoded],
                        ]),
                        note: 'decoded',
                        extraHtml: `
                            <div class="tool-section" style="margin-top:1.5rem;">
                                <div class="alert warn"><span>!</span><span>Base64 is <strong>not</strong> encryption.
                                    Anyone who can see this header can read the password — which is why Basic auth is only
                                    acceptable over HTTPS, and preferably not at all.</span></div>
                            </div>`,
                    };
                }

                const separator = value.indexOf(':');
                if (separator < 1) throw new Error('Enter credentials as user:password, or paste a Basic header to decode.');

                const encoded = bytesToBase64(utf8ToBytes(value));
                const header = `Authorization: Basic ${encoded}`;
                const curl = `curl -H "${header}" https://example.com`;

                return {
                    output: rowsToText([
                        ['Encoded', encoded],
                        ['Header', header],
                        ['curl', curl],
                        ['curl (safer)', `curl -u '${value.replace(/'/g, `'\\''`)}' https://example.com`],
                    ]),
                    note: 'encoded',
                    extraHtml: `
                        <div class="tool-section" style="margin-top:1.5rem;">
                            <div class="btn-row">
                                <button class="action-btn secondary" data-copy="${escapeHtml(encoded)}" data-copy-label="Copied">Copy base64</button>
                                <button class="action-btn secondary" data-copy="${escapeHtml(header)}" data-copy-label="Header copied">Copy header</button>
                            </div>
                            <div class="alert warn"><span>!</span><span>Base64 is <strong>not</strong> encryption — this is
                                the password in a trivially reversible wrapper. Only over HTTPS, never in a URL, and never
                                committed to a repository.</span></div>
                        </div>`,
                };
            },
        },
    },

    {
        id: 'secret-scanner',
        name: 'Secret Scanner',
        description: 'Find API keys, tokens and private keys hiding in code, logs or a diff.',
        category: 'security',
        icon: '🔎',
        keywords: ['secret', 'scanner', 'leak', 'api key', 'token', 'credential', 'private key',
            'detect', 'git', 'commit', 'gitleaks', 'trufflehog', 'security', 'audit', 'aws', 'password'],
        spec: {
            lede: 'Paste a diff, a config file or a log before you commit or share it. Detection runs locally — nothing is uploaded, which is rather the point for a tool like this.',
            input: {
                label: 'Text to scan',
                accept: '*/*',
                placeholder: 'Paste code, config, a diff or a log…',
                sample: `DATABASE_URL=postgres://admin:s3cr3tp4ss@db.example.com:5432/app
AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE
github_token: ghp_1234567890abcdefghijklmnopqrstuvwx
STRIPE_KEY=sk_live_EXAMPLEONLYnotreal
-----BEGIN RSA PRIVATE KEY-----
MIIEowIBAAKCAQEA1234
-----END RSA PRIVATE KEY-----
normal_config = "nothing to see here"
email: someone@example.com`,
            },
            output: { label: 'Findings', filename: 'secret-scan.txt' },
            options: [
                { id: 'redact', type: 'checkbox', label: 'Output a redacted copy instead', default: false },
            ],
            run: ({ input, options }) => {
                if (!input.trim()) return '';

                const PATTERNS = [
                    ['AWS access key ID', /\bAKIA[0-9A-Z]{16}\b/g, 'error'],
                    ['AWS secret access key', /\baws_secret_access_key\s*[=:]\s*['"]?([A-Za-z0-9/+=]{40})\b/gi, 'error'],
                    ['GitHub token', /\bgh[pousr]_[A-Za-z0-9]{16,}\b/g, 'error'],
                    ['GitHub fine-grained token', /\bgithub_pat_[A-Za-z0-9_]{22,}\b/g, 'error'],
                    ['Slack token', /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g, 'error'],
                    ['Stripe secret key', /\bsk_(live|test)_[A-Za-z0-9]{16,}\b/g, 'error'],
                    ['OpenAI API key', /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/g, 'error'],
                    ['Anthropic API key', /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g, 'error'],
                    ['Google API key', /\bAIza[0-9A-Za-z_-]{35}\b/g, 'error'],
                    ['Private key block', /-----BEGIN (RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/g, 'error'],
                    ['JSON Web Token', /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, 'warn'],
                    ['Password in a URL', /\b[a-z][a-z0-9+.-]*:\/\/[^\s:@/]+:([^\s@/]{3,})@/gi, 'error'],
                    ['Azure connection string', /\bSharedAccessKey=[A-Za-z0-9+/=]{20,}/g, 'error'],
                    ['Azure storage key', /\bAccountKey=[A-Za-z0-9+/=]{40,}/g, 'error'],
                    ['Generic assigned secret', /\b(?:api[_-]?key|secret|passwd|password|token|credential)\s*[=:]\s*['"]?([^\s'"#,;]{8,})/gi, 'warn'],
                    ['Slack webhook', /https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9/]{20,}/g, 'error'],
                    ['Basic auth header', /\bBasic\s+[A-Za-z0-9+/]{16,}={0,2}/g, 'warn'],
                    ['Email address', /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, 'info'],
                    ['Possible credit card', /\b(?:4[0-9]{12}(?:[0-9]{3})?|5[1-5][0-9]{14}|3[47][0-9]{13})\b/g, 'warn'],
                    ['Private IP address', /\b(?:10\.\d{1,3}|192\.168|172\.(?:1[6-9]|2\d|3[01]))\.\d{1,3}\.\d{1,3}\b/g, 'info'],
                ];

                const lines = input.split('\n');
                const findings = [];
                let redacted = input;

                for (const [name, pattern, level] of PATTERNS) {
                    pattern.lastIndex = 0;
                    let match;
                    while ((match = pattern.exec(input)) !== null) {
                        const value = match[0];
                        // Placeholders are noise, not findings.
                        if (/EXAMPLE|xxx+|\byour[_-]|<[^>]+>|\bREPLACE|\bCHANGEME|\bdummy\b/i.test(value)
                            && !/AKIAIOSFODNN7EXAMPLE/.test(value)) {
                            continue;
                        }
                        const before = input.slice(0, match.index);
                        const line = before.split('\n').length;
                        findings.push({
                            name,
                            level,
                            line,
                            preview: lines[line - 1]?.trim().slice(0, 100) || '',
                            masked: value.length > 12
                                ? `${value.slice(0, 6)}${'•'.repeat(8)}${value.slice(-4)}`
                                : '•'.repeat(value.length),
                        });
                        if (options.redact) {
                            redacted = redacted.split(value).join(`[REDACTED ${name.toUpperCase().replace(/\s+/g, '_')}]`);
                        }
                        if (!pattern.global) break;
                    }
                }

                // De-duplicate: the same string caught by two patterns is one leak.
                const seen = new Set();
                const unique = findings.filter((f) => {
                    const key = `${f.line}:${f.masked}`;
                    if (seen.has(key)) return false;
                    seen.add(key);
                    return true;
                }).sort((a, b) => a.line - b.line);

                const critical = unique.filter((f) => f.level === 'error').length;
                const warnings = unique.filter((f) => f.level === 'warn').length;
                const notes = unique.filter((f) => f.level === 'info').length;

                if (options.redact) {
                    return {
                        output: redacted,
                        filename: 'redacted.txt',
                        note: `${unique.length} values redacted`,
                    };
                }

                const text = unique.length
                    ? unique.map((f) => `line ${String(f.line).padStart(4)}  ${f.level.toUpperCase().padEnd(5)}  ${f.name.padEnd(28)}  ${f.masked}`).join('\n')
                    : 'No credentials detected.';

                return {
                    output: text,
                    note: unique.length ? `${critical} critical, ${warnings} warnings` : 'clean',
                    extraHtml: `
                        <div class="tool-section" style="margin-top:1.5rem;">
                            ${critical
                                ? `<div class="alert err"><span>✕</span><span><strong>${critical} likely credential${critical === 1 ? '' : 's'} found.</strong>
                                    If any of these have ever been committed or shared, rotate them — removing the line does
                                    not remove it from git history, and scrapers find public repositories within minutes.</span></div>`
                                : unique.length
                                    ? `<div class="alert warn"><span>!</span><span>${unique.length} item${unique.length === 1 ? '' : 's'} worth a look, nothing conclusive.</span></div>`
                                    : '<div class="alert ok"><span>✓</span><span>No credentials detected in this text.</span></div>'}
                            <div class="stat-grid">
                                ${statTile('Critical', String(critical), '', critical ? 'var(--red)' : 'var(--green)')}
                                ${statTile('Warnings', String(warnings))}
                                ${statTile('Notes', String(notes))}
                                ${statTile('Lines scanned', lines.length.toLocaleString())}
                            </div>
                            ${unique.length ? `
                                <div class="table-wrap" style="max-height:400px;">
                                    <table class="data">
                                        <thead><tr><th style="width:70px">Line</th><th style="width:80px">Level</th><th style="width:210px">Type</th><th>Matched (masked)</th></tr></thead>
                                        <tbody>
                                            ${unique.map((f) => `
                                                <tr>
                                                    <td class="num">${f.line}</td>
                                                    <td style="color:${f.level === 'error' ? 'var(--red)' : f.level === 'warn' ? '#c9a800' : 'var(--blue)'};font-weight:800">${f.level}</td>
                                                    <td><strong>${escapeHtml(f.name)}</strong></td>
                                                    <td style="font-family:var(--mono);font-size:.76rem">${escapeHtml(f.masked)}</td>
                                                </tr>`).join('')}
                                        </tbody>
                                    </table>
                                </div>` : ''}
                        </div>`,
                };
            },
            footnote: 'Pattern matching finds known key shapes; it will miss a secret that looks like ordinary text, and it will occasionally flag something harmless. Values are shown masked and never leave your browser. For repository-wide and history scanning use <code>gitleaks</code> or <code>trufflehog</code> in CI.',
        },
    },

    {
        id: 'csp-builder',
        name: 'CSP Builder & Analyser',
        description: 'Build a Content-Security-Policy, or find the holes in an existing one.',
        category: 'security',
        icon: 'CSP',
        keywords: ['csp', 'content security policy', 'xss', 'header', 'nonce', 'unsafe-inline',
            'directive', 'build', 'analyse', 'analyzer', 'security'],
        spec: {
            lede: 'Paste a policy to have it broken down and checked, or start from a preset.',
            input: {
                label: 'Content-Security-Policy',
                placeholder: "default-src 'self'; script-src 'self' 'unsafe-inline'",
                sample: "default-src *; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.example.com; style-src 'self' 'unsafe-inline'; img-src *",
            },
            output: { label: 'Analysis', filename: 'csp.txt' },
            options: [
                { id: 'preset', type: 'select', label: 'Or start from a preset', default: 'none',
                  choices: [
                      { value: 'none', label: 'Analyse what I pasted' },
                      { value: 'strict', label: 'Strict — nonce based' },
                      { value: 'moderate', label: 'Moderate — self plus a CDN' },
                      { value: 'api', label: 'API / JSON only' },
                  ] },
            ],
            run: ({ input, options }) => {
                const PRESETS = {
                    strict: "default-src 'none'; script-src 'nonce-{RANDOM}' 'strict-dynamic'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; object-src 'none'",
                    moderate: "default-src 'self'; script-src 'self' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; object-src 'none'",
                    api: "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; sandbox",
                };

                let policy = input.trim().replace(/^content-security-policy:\s*/i, '');
                let fromPreset = false;

                if (options.preset !== 'none') {
                    policy = PRESETS[options.preset].replace('{RANDOM}', bytesToBase64(randomBytes(16)));
                    fromPreset = true;
                }
                if (!policy) return '';

                const directives = new Map();
                for (const part of policy.split(';')) {
                    const tokens = part.trim().split(/\s+/).filter(Boolean);
                    if (!tokens.length) continue;
                    directives.set(tokens[0].toLowerCase(), tokens.slice(1));
                }

                const findings = [];
                const add = (level, name, message) => findings.push({ level, name, message });

                const scriptSrc = directives.get('script-src') || directives.get('default-src') || [];
                const styleSrc = directives.get('style-src') || directives.get('default-src') || [];

                if (!directives.has('default-src')) {
                    add('warn', 'default-src', 'Not set. Any directive you have not listed falls back to allowing everything.');
                }
                if (scriptSrc.includes("'unsafe-inline'") && !scriptSrc.some((s) => s.startsWith("'nonce-") || s.startsWith("'sha"))) {
                    add('error', 'script-src', "<code>'unsafe-inline'</code> allows any injected <code>&lt;script&gt;</code> to run — this is the single setting that most undermines a CSP. Use a nonce or a hash instead.");
                }
                if (scriptSrc.includes("'unsafe-eval'")) {
                    add('error', 'script-src', "<code>'unsafe-eval'</code> permits <code>eval()</code> and <code>new Function()</code>, reopening a common XSS path.");
                }
                if (scriptSrc.includes('*') || (directives.get('default-src') || []).includes('*')) {
                    add('error', 'wildcard', 'A bare <code>*</code> allows scripts from anywhere, which makes the policy decorative.');
                }
                if (scriptSrc.some((s) => /^https?:$/.test(s))) {
                    add('error', 'script-src', 'A bare <code>https:</code> scheme allows any HTTPS host — barely narrower than <code>*</code>.');
                }
                if (styleSrc.includes("'unsafe-inline'")) {
                    add('warn', 'style-src', "<code>'unsafe-inline'</code> for styles is common and much lower risk than for scripts, but it does enable CSS-based data exfiltration.");
                }
                if (!directives.has('object-src') && !(directives.get('default-src') || []).includes("'none'")) {
                    add('warn', 'object-src', "Not restricted. Set <code>object-src 'none'</code> — legacy plugin content is a bypass vector.");
                }
                if (!directives.has('base-uri')) {
                    add('warn', 'base-uri', "Not set. An injected <code>&lt;base&gt;</code> tag can redirect every relative URL on the page. Set <code>base-uri 'none'</code>.");
                }
                if (!directives.has('frame-ancestors')) {
                    add('warn', 'frame-ancestors', "Not set, so the page can be framed anywhere. <code>frame-ancestors 'none'</code> replaces X-Frame-Options.");
                }
                if (!directives.has('form-action')) {
                    add('info', 'form-action', 'Not set. An injected form could post to an attacker-controlled endpoint.');
                }
                if (scriptSrc.some((s) => s.startsWith("'nonce-"))) {
                    add('ok', 'script-src', 'Uses a nonce — the strong pattern. The nonce must be regenerated per response and never reused.');
                }
                if (!findings.some((f) => f.level === 'error')) {
                    add('ok', 'Overall', 'No critical weaknesses found in the directives present.');
                }

                const rows = [...directives.entries()].map(([name, values]) =>
                    `${name.padEnd(24)} ${values.join(' ') || "(empty — treated as 'none')"}`);

                const errors = findings.filter((f) => f.level === 'error').length;

                return {
                    output: [
                        fromPreset ? `Generated from the "${options.preset}" preset:\n\n${policy}\n` : '',
                        'Directives',
                        ...rows,
                        '',
                        'Findings',
                        ...findings.map((f) => `${f.level.toUpperCase().padEnd(5)} ${f.name.padEnd(18)} ${f.message.replace(/<[^>]+>/g, '')}`),
                    ].filter(Boolean).join('\n'),
                    note: `${directives.size} directives · ${errors} critical`,
                    extraHtml: `
                        <div class="tool-section" style="margin-top:1.5rem;">
                            ${fromPreset ? `
                                <div class="io-pane-head"><h3>Generated policy</h3>
                                    <div class="io-pane-actions">
                                        <button class="copy-chip" data-copy="${escapeHtml(policy)}" data-copy-label="Policy copied">Copy</button>
                                    </div></div>
                                <div class="output-section" style="margin-bottom:1rem;"><pre>${escapeHtml(policy)}</pre></div>` : ''}
                            ${findingsTable(findings)}
                            <div class="info-box" style="margin-top:1rem;">
                                Roll a new policy out with <code>Content-Security-Policy-Report-Only</code> first and watch
                                the reports — a strict CSP applied straight to production usually breaks something.
                            </div>
                        </div>`,
                };
            },
        },
    },
];

export { analysePassword, totpAt, parseHeaders };
