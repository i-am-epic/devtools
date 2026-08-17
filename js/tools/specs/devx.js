// Developer utilities that come up constantly but are rarely all in one place:
// decoding ids, subnet maths, Kubernetes quantities, durations, semver,
// curl translation, .env conversion and so on.

import { hmac } from '../../lib/hashes.js';
import { utf8ToBytes, bytesToBase64, base64ToBytes, randomInt } from '../../lib/bytes.js';
import { parseCsv, toCsv, sniffDelimiter } from '../../lib/tabular.js';

const escapeHtml = (value) => String(value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const statTile = (label, value, sub = '') => `
    <div class="stat-tile">
        <div class="stat-label">${label}</div>
        <div class="stat-value">${value}</div>
        ${sub ? `<div class="stat-sub">${sub}</div>` : ''}
    </div>`;

const rowsToText = (rows) => {
    const width = Math.max(...rows.map(([label]) => String(label).length));
    return rows.map(([label, value]) => (label ? `${(`${label}:`).padEnd(width + 2)}${value}` : '')).join('\n');
};

// ------------------------------------------------------------ id decoding --

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

function decodeUlid(text) {
    const value = text.trim().toUpperCase();
    if (!/^[0-9A-HJKMNP-TV-Z]{26}$/.test(value)) return null;
    let timestamp = 0n;
    for (const char of value.slice(0, 10)) {
        const index = CROCKFORD.indexOf(char);
        if (index === -1) return null;
        timestamp = timestamp * 32n + BigInt(index);
    }
    return { kind: 'ULID', date: new Date(Number(timestamp)), detail: 'first 48 bits are a millisecond timestamp' };
}

function decodeUuid(text) {
    const value = text.trim().replace(/^urn:uuid:/i, '').replace(/[{}]/g, '');
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) return null;

    const hex = value.replace(/-/g, '').toLowerCase();
    const version = parseInt(hex[12], 16);
    const variantNibble = parseInt(hex[16], 16);
    const variant = variantNibble >= 0b1000 && variantNibble <= 0b1011 ? 'RFC 4122'
        : variantNibble >= 0b1100 && variantNibble <= 0b1101 ? 'Microsoft'
        : 'reserved / NCS';

    const result = { kind: `UUID v${version}`, version, variant, hex };

    if (version === 1 || version === 6) {
        // 60-bit count of 100ns intervals since 1582-10-15.
        const timeHex = version === 1
            ? hex.slice(13, 16) + hex.slice(8, 12) + hex.slice(0, 8)
            : hex.slice(0, 12) + hex.slice(13, 16);
        const intervals = BigInt(`0x${timeHex}`);
        const ms = Number(intervals / 10000n) - 12219292800000;
        result.date = new Date(ms);
        result.detail = 'Gregorian timestamp in 100-nanosecond intervals';
        result.node = `${hex.slice(20)} (MAC address or random node id)`;
    } else if (version === 7) {
        result.date = new Date(Number(BigInt(`0x${hex.slice(0, 12)}`)));
        result.detail = 'first 48 bits are a millisecond timestamp — sorts chronologically';
    } else if (version === 4) {
        result.detail = '122 bits of randomness — carries no timestamp';
    }

    return result;
}

function decodeObjectId(text) {
    const value = text.trim();
    if (!/^[0-9a-f]{24}$/i.test(value)) return null;
    const seconds = parseInt(value.slice(0, 8), 16);
    return {
        kind: 'MongoDB ObjectId',
        date: new Date(seconds * 1000),
        detail: 'first 4 bytes are a second-resolution timestamp',
        node: `machine/process ${value.slice(8, 18)}, counter ${parseInt(value.slice(18), 16)}`,
    };
}

const SNOWFLAKE_EPOCHS = {
    discord: { label: 'Discord', epoch: 1420070400000 },
    twitter: { label: 'Twitter / X', epoch: 1288834974657 },
    instagram: { label: 'Instagram', epoch: 1314220021721 },
    unix: { label: 'Unix epoch (0)', epoch: 0 },
};

function decodeSnowflake(text, which) {
    const value = text.trim();
    if (!/^\d{7,25}$/.test(value)) return null;
    const id = BigInt(value);
    const { epoch, label } = SNOWFLAKE_EPOCHS[which] || SNOWFLAKE_EPOCHS.discord;
    const ms = Number(id >> 22n) + epoch;
    const date = new Date(ms);
    if (Number.isNaN(date.getTime()) || ms < 0 || ms > Date.now() + 3.156e11) return null;
    return {
        kind: `Snowflake (${label})`,
        date,
        detail: `id >> 22 plus the ${label} epoch`,
        node: `worker ${(id >> 17n) & 0x1fn}, process ${(id >> 12n) & 0x1fn}, sequence ${id & 0xfffn}`,
    };
}

// ------------------------------------------------------------ networking --

function parseIpv4(text) {
    const parts = text.trim().split('.');
    if (parts.length !== 4) return null;
    const octets = parts.map((p) => {
        if (!/^\d{1,3}$/.test(p)) return NaN;
        const n = Number(p);
        return n >= 0 && n <= 255 ? n : NaN;
    });
    if (octets.some(Number.isNaN)) return null;
    return ((octets[0] << 24) >>> 0) + (octets[1] << 16) + (octets[2] << 8) + octets[3];
}

const toIpv4 = (n) => [24, 16, 8, 0].map((shift) => (n >>> shift) & 255).join('.');

// ------------------------------------------------------- k8s quantities --

const K8S_SUFFIXES = {
    '': 1, k: 1e3, M: 1e6, G: 1e9, T: 1e12, P: 1e15, E: 1e18,
    Ki: 1024, Mi: 1024 ** 2, Gi: 1024 ** 3, Ti: 1024 ** 4, Pi: 1024 ** 5, Ei: 1024 ** 6,
};

// ---------------------------------------------------------------- semver --

function parseSemver(text) {
    const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z-.]+))?(?:\+([0-9A-Za-z-.]+))?$/.exec(text.trim());
    if (!match) return null;
    return {
        major: Number(match[1]),
        minor: Number(match[2]),
        patch: Number(match[3]),
        prerelease: match[4] || null,
        build: match[5] || null,
        raw: text.trim(),
    };
}

function compareSemver(a, b) {
    for (const key of ['major', 'minor', 'patch']) {
        if (a[key] !== b[key]) return a[key] < b[key] ? -1 : 1;
    }
    // A version with a prerelease is lower than the same version without one.
    if (a.prerelease && !b.prerelease) return -1;
    if (!a.prerelease && b.prerelease) return 1;
    if (!a.prerelease && !b.prerelease) return 0;

    const left = a.prerelease.split('.');
    const right = b.prerelease.split('.');
    for (let i = 0; i < Math.max(left.length, right.length); i++) {
        const l = left[i];
        const r = right[i];
        if (l === undefined) return -1;
        if (r === undefined) return 1;
        const lNum = /^\d+$/.test(l);
        const rNum = /^\d+$/.test(r);
        if (lNum && rNum) {
            if (Number(l) !== Number(r)) return Number(l) < Number(r) ? -1 : 1;
        } else if (lNum !== rNum) return lNum ? -1 : 1;
        else if (l !== r) return l < r ? -1 : 1;
    }
    return 0;
}

function satisfiesRange(version, range) {
    const trimmed = range.trim();
    if (!trimmed || trimmed === '*' || trimmed === 'latest') return true;

    // Comma or space separated comparators are ANDed; || is OR.
    return trimmed.split('||').some((group) => group.trim().split(/\s+(?![\d.])|,/).filter(Boolean).every((part) => {
        const clause = part.trim();

        const caret = /^\^v?(\d+)\.(\d+)\.(\d+)/.exec(clause);
        if (caret) {
            const base = parseSemver(clause.slice(1));
            if (!base) return false;
            if (compareSemver(version, base) < 0) return false;
            if (base.major > 0) return version.major === base.major;
            if (base.minor > 0) return version.major === 0 && version.minor === base.minor;
            return version.major === 0 && version.minor === 0 && version.patch === base.patch;
        }

        const tilde = /^~v?(\d+)\.(\d+)\.(\d+)/.exec(clause);
        if (tilde) {
            const base = parseSemver(clause.slice(1));
            if (!base) return false;
            return compareSemver(version, base) >= 0
                && version.major === base.major && version.minor === base.minor;
        }

        const comparator = /^(>=|<=|>|<|=)?\s*v?(.+)$/.exec(clause);
        if (!comparator) return false;
        const target = parseSemver(comparator[2]);
        if (!target) return false;
        const result = compareSemver(version, target);
        switch (comparator[1]) {
            case '>=': return result >= 0;
            case '<=': return result <= 0;
            case '>': return result > 0;
            case '<': return result < 0;
            default: return result === 0;
        }
    }));
}

// ------------------------------------------------------------------ curl --

function parseCurl(command) {
    const text = command.replace(/\\\r?\n/g, ' ').trim();
    if (!/^\s*curl\b/.test(text)) throw new Error('That does not start with "curl".');

    // Tokenise respecting quotes.
    const tokens = [];
    let current = '';
    let quote = null;
    for (let i = 0; i < text.length; i++) {
        const char = text[i];
        if (quote) {
            if (char === quote) { quote = null; continue; }
            if (char === '\\' && quote === '"' && text[i + 1]) { current += text[++i]; continue; }
            current += char;
        } else if (char === '"' || char === "'") quote = char;
        else if (/\s/.test(char)) { if (current) { tokens.push(current); current = ''; } }
        else current += char;
    }
    if (current) tokens.push(current);

    const request = { method: null, url: '', headers: {}, body: null, auth: null, insecure: false };

    for (let i = 1; i < tokens.length; i++) {
        const token = tokens[i];
        switch (token) {
            case '-X': case '--request':
                request.method = tokens[++i]?.toUpperCase();
                break;
            case '-H': case '--header': {
                const header = tokens[++i] || '';
                const colon = header.indexOf(':');
                if (colon > 0) request.headers[header.slice(0, colon).trim()] = header.slice(colon + 1).trim();
                break;
            }
            case '-d': case '--data': case '--data-raw': case '--data-binary': case '--data-ascii':
                request.body = tokens[++i];
                break;
            case '--json':
                request.body = tokens[++i];
                request.headers['Content-Type'] = 'application/json';
                break;
            case '-u': case '--user':
                request.auth = tokens[++i];
                break;
            case '-k': case '--insecure':
                request.insecure = true;
                break;
            case '-L': case '--location': case '-s': case '--silent':
            case '-i': case '--include': case '-v': case '--verbose': case '--compressed':
                break;
            default:
                if (!token.startsWith('-')) request.url = token;
                else if (!token.startsWith('--')) break;
                break;
        }
    }

    if (!request.url) throw new Error('No URL found in that command.');
    if (!request.method) request.method = request.body ? 'POST' : 'GET';
    return request;
}

function emitRequest(request, target) {
    const headers = { ...request.headers };
    if (request.auth) headers.Authorization = `Basic ${btoa(request.auth)}`;

    const headerEntries = Object.entries(headers);
    const bodyIsJson = request.body && /^\s*[[{]/.test(request.body);

    switch (target) {
        case 'fetch': {
            const options = [`method: '${request.method}'`];
            if (headerEntries.length) {
                options.push(`headers: {\n${headerEntries.map(([k, v]) => `    ${JSON.stringify(k)}: ${JSON.stringify(v)},`).join('\n')}\n  }`);
            }
            if (request.body) {
                options.push(bodyIsJson
                    ? `body: JSON.stringify(${request.body})`
                    : `body: ${JSON.stringify(request.body)}`);
            }
            return `const response = await fetch(${JSON.stringify(request.url)}, {\n  ${options.join(',\n  ')},\n});\n\nif (!response.ok) throw new Error(\`HTTP \${response.status}\`);\nconst data = await response.json();`;
        }
        case 'python': {
            const lines = ['import requests', ''];
            if (headerEntries.length) {
                lines.push('headers = {');
                headerEntries.forEach(([k, v]) => lines.push(`    ${JSON.stringify(k)}: ${JSON.stringify(v)},`));
                lines.push('}', '');
            }
            if (request.body) {
                lines.push(bodyIsJson ? `payload = ${request.body}` : `payload = ${JSON.stringify(request.body)}`, '');
            }
            const args = [JSON.stringify(request.url)];
            if (headerEntries.length) args.push('headers=headers');
            if (request.body) args.push(bodyIsJson ? 'json=payload' : 'data=payload');
            if (request.insecure) args.push('verify=False');
            lines.push(`response = requests.${request.method.toLowerCase()}(${args.join(', ')}, timeout=30)`);
            lines.push('response.raise_for_status()', 'data = response.json()');
            return lines.join('\n');
        }
        case 'go': {
            const lines = ['package main', '', 'import (', '\t"fmt"', '\t"io"', '\t"net/http"'];
            if (request.body) lines.push('\t"strings"');
            lines.push(')', '', 'func main() {');
            if (request.body) {
                lines.push(`\tbody := strings.NewReader(\`${request.body}\`)`);
                lines.push(`\treq, err := http.NewRequest("${request.method}", ${JSON.stringify(request.url)}, body)`);
            } else {
                lines.push(`\treq, err := http.NewRequest("${request.method}", ${JSON.stringify(request.url)}, nil)`);
            }
            lines.push('\tif err != nil {', '\t\tpanic(err)', '\t}');
            headerEntries.forEach(([k, v]) => lines.push(`\treq.Header.Set(${JSON.stringify(k)}, ${JSON.stringify(v)})`));
            lines.push('', '\tresp, err := http.DefaultClient.Do(req)', '\tif err != nil {', '\t\tpanic(err)', '\t}',
                '\tdefer resp.Body.Close()', '', '\tout, _ := io.ReadAll(resp.Body)', '\tfmt.Println(string(out))', '}');
            return lines.join('\n');
        }
        case 'powershell': {
            const lines = [];
            if (headerEntries.length) {
                lines.push('$headers = @{');
                headerEntries.forEach(([k, v]) => lines.push(`    "${k}" = "${String(v).replace(/"/g, '`"')}"`));
                lines.push('}', '');
            }
            if (request.body) lines.push(`$body = @'\n${request.body}\n'@`, '');
            const args = [`-Uri "${request.url}"`, `-Method ${request.method}`];
            if (headerEntries.length) args.push('-Headers $headers');
            if (request.body) args.push('-Body $body');
            lines.push(`$response = Invoke-RestMethod ${args.join(' ')}`);
            return lines.join('\n');
        }
        case 'httpie': {
            const parts = ['http', request.method, request.url];
            headerEntries.forEach(([k, v]) => parts.push(`${k}:'${v}'`));
            if (request.body) return `echo '${request.body}' | ${parts.join(' ')}`;
            return parts.join(' ');
        }
        default:
            return '';
    }
}

// ------------------------------------------------------------------- env --

function parseEnvFile(text) {
    const result = {};
    for (const rawLine of text.split('\n')) {
        const line = rawLine.trim();
        if (!line || line.startsWith('#')) continue;
        const withoutExport = line.replace(/^export\s+/, '');
        const eq = withoutExport.indexOf('=');
        if (eq < 1) continue;
        const key = withoutExport.slice(0, eq).trim();
        let value = withoutExport.slice(eq + 1).trim();
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
            if (rawLine.includes('"')) value = value.replace(/\\n/g, '\n').replace(/\\t/g, '\t');
        } else {
            // Strip a trailing inline comment on unquoted values.
            value = value.replace(/\s+#.*$/, '');
        }
        result[key] = value;
    }
    return result;
}

const envQuote = (value) => (/[\s"'#$&|<>(){}[\]*?;`\\]|^$/.test(value)
    ? `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`
    : value);

// -------------------------------------------------------------- HTTP ref --

const STATUS_CODES = [
    [100, 'Continue', 'Carry on sending the request body.'],
    [101, 'Switching Protocols', 'Upgrading, typically to WebSocket.'],
    [103, 'Early Hints', 'Preload hints before the real response.'],
    [200, 'OK', 'Standard success.'],
    [201, 'Created', 'A new resource exists; return its Location.'],
    [202, 'Accepted', 'Queued for processing; not done yet.'],
    [204, 'No Content', 'Success with nothing to return.'],
    [206, 'Partial Content', 'Range request satisfied.'],
    [301, 'Moved Permanently', 'Update your links; may change method to GET.'],
    [302, 'Found', 'Temporary redirect; may change method to GET.'],
    [303, 'See Other', 'Follow with GET — the POST-redirect-GET pattern.'],
    [304, 'Not Modified', 'Your cached copy is still good.'],
    [307, 'Temporary Redirect', 'Like 302 but the method is preserved.'],
    [308, 'Permanent Redirect', 'Like 301 but the method is preserved.'],
    [400, 'Bad Request', 'Malformed syntax; do not retry unchanged.'],
    [401, 'Unauthorized', 'Not authenticated — you need credentials.'],
    [402, 'Payment Required', 'Increasingly used for quota and billing limits.'],
    [403, 'Forbidden', 'Authenticated but not allowed.'],
    [404, 'Not Found', 'No such resource — or you are hiding it.'],
    [405, 'Method Not Allowed', 'Wrong verb; send Allow.'],
    [409, 'Conflict', 'State clash, e.g. a concurrent edit.'],
    [410, 'Gone', 'Deliberately removed and not coming back.'],
    [412, 'Precondition Failed', 'An If-Match style condition did not hold.'],
    [413, 'Content Too Large', 'The body exceeds what the server accepts.'],
    [415, 'Unsupported Media Type', 'Wrong Content-Type.'],
    [418, "I'm a teapot", 'A joke from RFC 2324 that refuses to die.'],
    [422, 'Unprocessable Content', 'Syntax fine, semantics wrong — validation errors.'],
    [425, 'Too Early', 'Replay risk; retry after the handshake completes.'],
    [428, 'Precondition Required', 'Send If-Match to avoid lost updates.'],
    [429, 'Too Many Requests', 'Rate limited — honour Retry-After.'],
    [431, 'Request Header Fields Too Large', 'Usually an oversized cookie.'],
    [451, 'Unavailable For Legal Reasons', 'Blocked by law.'],
    [500, 'Internal Server Error', 'Unhandled failure; check the logs.'],
    [501, 'Not Implemented', 'The server does not support the method at all.'],
    [502, 'Bad Gateway', 'An upstream returned something invalid.'],
    [503, 'Service Unavailable', 'Overloaded or down for maintenance; send Retry-After.'],
    [504, 'Gateway Timeout', 'An upstream did not answer in time.'],
    [507, 'Insufficient Storage', 'The server is out of room.'],
];

const MIME_TYPES = [
    ['.json', 'application/json'], ['.jsonl', 'application/x-ndjson'], ['.xml', 'application/xml'],
    ['.yaml', 'application/yaml'], ['.csv', 'text/csv'], ['.html', 'text/html'], ['.css', 'text/css'],
    ['.js', 'text/javascript'], ['.mjs', 'text/javascript'], ['.ts', 'video/mp2t (not TypeScript!)'],
    ['.txt', 'text/plain'], ['.md', 'text/markdown'], ['.pdf', 'application/pdf'],
    ['.zip', 'application/zip'], ['.gz', 'application/gzip'], ['.tar', 'application/x-tar'],
    ['.png', 'image/png'], ['.jpg', 'image/jpeg'], ['.gif', 'image/gif'], ['.webp', 'image/webp'],
    ['.svg', 'image/svg+xml'], ['.avif', 'image/avif'], ['.ico', 'image/x-icon'],
    ['.mp3', 'audio/mpeg'], ['.wav', 'audio/wav'], ['.mp4', 'video/mp4'], ['.webm', 'video/webm'],
    ['.woff', 'font/woff'], ['.woff2', 'font/woff2'], ['.ttf', 'font/ttf'],
    ['.wasm', 'application/wasm'], ['.parquet', 'application/vnd.apache.parquet'],
    ['.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
    ['.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
    ['form', 'application/x-www-form-urlencoded'], ['upload', 'multipart/form-data'],
    ['stream', 'text/event-stream'], ['binary', 'application/octet-stream'],
];

// ------------------------------------------------------------- mock data --

const FIRST_NAMES = 'Ada Grace Alan Katherine Linus Barbara Edsger Margaret Ken Radia Tim Anita Dennis Frances Bjarne Jean Guido Hedy James Karen Rasmus Sophie Yukihiro Joan'.split(' ');
const LAST_NAMES = 'Lovelace Hopper Turing Johnson Torvalds Liskov Dijkstra Hamilton Thompson Perlman Berners-Lee Borg Ritchie Allen Stroustrup Bartik Rossum Lamarr Gosling Sparck Lerdorf Wilson Matsumoto Clarke'.split(' ');
const DOMAINS = 'example.com example.org test.dev mail.example acme.co'.split(' ');
const CITIES = 'London Berlin Tokyo Sydney Toronto Lisbon Dublin Austin Bengaluru Nairobi'.split(' ');
const STREETS = 'High Station Church Mill Park Victoria King Queen Bridge Market'.split(' ');
const COMPANIES = 'Acme Globex Initech Umbrella Hooli Soylent Stark Wayne Cyberdyne Tyrell'.split(' ');
const WORDS = 'alpha beta gamma delta epsilon zeta eta theta iota kappa lambda sigma'.split(' ');

const pick = (list) => list[randomInt(list.length)];

const MOCK_FIELDS = {
    id: (i) => i + 1,
    uuid: () => crypto.randomUUID(),
    firstName: () => pick(FIRST_NAMES),
    lastName: () => pick(LAST_NAMES),
    fullName: () => `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}`,
    email: () => `${pick(FIRST_NAMES).toLowerCase()}.${pick(LAST_NAMES).toLowerCase().replace(/[^a-z]/g, '')}@${pick(DOMAINS)}`,
    username: () => `${pick(FIRST_NAMES).toLowerCase()}${randomInt(1000)}`,
    phone: () => `+44 7${randomInt(900) + 100} ${String(randomInt(1000000)).padStart(6, '0')}`,
    company: () => pick(COMPANIES),
    jobTitle: () => `${pick(['Senior', 'Lead', 'Staff', 'Principal', 'Junior'])} ${pick(['Engineer', 'Analyst', 'Designer', 'Manager'])}`,
    city: () => pick(CITIES),
    address: () => `${randomInt(200) + 1} ${pick(STREETS)} Street`,
    postcode: () => `${String.fromCharCode(65 + randomInt(26))}${String.fromCharCode(65 + randomInt(26))}${randomInt(9) + 1} ${randomInt(9)}${String.fromCharCode(65 + randomInt(26))}${String.fromCharCode(65 + randomInt(26))}`,
    country: () => pick(['United Kingdom', 'Germany', 'Japan', 'Australia', 'Canada', 'Portugal']),
    boolean: () => randomInt(2) === 1,
    integer: () => randomInt(1000),
    price: () => Number((randomInt(100000) / 100).toFixed(2)),
    percentage: () => Number((randomInt(10001) / 100).toFixed(2)),
    date: () => new Date(Date.now() - randomInt(365 * 3) * 86400000).toISOString().slice(0, 10),
    datetime: () => new Date(Date.now() - randomInt(365 * 86400000)).toISOString(),
    status: () => pick(['active', 'pending', 'suspended', 'archived']),
    ipv4: () => `${randomInt(224) + 1}.${randomInt(256)}.${randomInt(256)}.${randomInt(254) + 1}`,
    url: () => `https://${pick(DOMAINS)}/${pick(WORDS)}/${randomInt(1000)}`,
    sentence: () => {
        const n = 5 + randomInt(8);
        const words = Array.from({ length: n }, () => pick(WORDS));
        return `${words.join(' ').replace(/^./, (c) => c.toUpperCase())}.`;
    },
};

// --------------------------------------------------------------------------

export const devxTools = [
    {
        id: 'id-decoder',
        name: 'ID Decoder',
        description: 'Pull the timestamp out of a UUID, ULID, ObjectId or Snowflake ID.',
        category: 'devx',
        icon: '🆔',
        keywords: ['uuid', 'ulid', 'snowflake', 'objectid', 'mongodb', 'discord', 'twitter', 'id',
            'decode', 'timestamp', 'when', 'created', 'guid'],
        spec: {
            lede: 'Most identifiers you meet in a database or a log carry a creation time. Paste one and this works out which format it is and when it was made.',
            input: {
                label: 'Identifier',
                placeholder: '018f3a4b-... · 01HQ... · 507f1f77bcf86cd799439011 · 175928847299117063',
                sample: '01912d7c-8f00-7c1e-9d4b-2f3a5b6c7d8e',
            },
            output: { label: 'Details', filename: 'id.txt' },
            options: [
                { id: 'snowflakeEpoch', type: 'select', label: 'Snowflake epoch', default: 'discord',
                  choices: Object.entries(SNOWFLAKE_EPOCHS).map(([value, e]) => ({ value, label: e.label })) },
            ],
            run: ({ input, options }) => {
                const value = input.trim();
                if (!value) return '';

                const decoded = decodeUuid(value)
                    || decodeUlid(value)
                    || decodeObjectId(value)
                    || decodeSnowflake(value, options.snowflakeEpoch);

                if (!decoded) {
                    throw new Error(
                        'Not a recognised identifier. Expected a UUID, a 26-character ULID, '
                        + 'a 24-character MongoDB ObjectId, or a numeric Snowflake ID.',
                    );
                }

                const rows = [['Format', decoded.kind]];
                if (decoded.variant) rows.push(['Variant', decoded.variant]);
                if (decoded.date && !Number.isNaN(decoded.date.getTime())) {
                    const delta = Date.now() - decoded.date.getTime();
                    const ago = Math.abs(delta) < 60000 ? `${Math.round(Math.abs(delta) / 1000)} seconds`
                        : Math.abs(delta) < 3600000 ? `${Math.round(Math.abs(delta) / 60000)} minutes`
                        : Math.abs(delta) < 86400000 ? `${Math.round(Math.abs(delta) / 3600000)} hours`
                        : `${Math.round(Math.abs(delta) / 86400000)} days`;
                    rows.push(
                        ['Created (UTC)', decoded.date.toISOString()],
                        ['Created (local)', decoded.date.toLocaleString()],
                        ['Unix millis', decoded.date.getTime()],
                        ['Relative', delta >= 0 ? `${ago} ago` : `${ago} from now`],
                    );
                } else {
                    rows.push(['Timestamp', 'none — this format carries no time']);
                }
                if (decoded.node) rows.push(['Other fields', decoded.node]);
                if (decoded.detail) rows.push(['How', decoded.detail]);

                const sortable = /v7|ULID|ObjectId|Snowflake|v1|v6/.test(decoded.kind);

                return {
                    output: rowsToText(rows),
                    note: decoded.kind,
                    extraHtml: `
                        <div class="stat-grid" style="margin-top:1.5rem;">
                            ${statTile('Format', decoded.kind)}
                            ${decoded.date && !Number.isNaN(decoded.date.getTime())
                                ? statTile('Created', decoded.date.toISOString().replace('T', ' ').slice(0, 19), 'UTC')
                                : statTile('Created', '—', 'no timestamp in this format')}
                            ${statTile('Sorts by time', sortable ? 'Yes' : 'No',
                                sortable ? 'safe as a clustered key' : 'random — poor index locality')}
                        </div>`,
                };
            },
        },
    },

    {
        id: 'unicode-inspector',
        name: 'Unicode Inspector',
        description: 'Reveal invisible characters, smart quotes and homoglyphs hiding in text.',
        category: 'devx',
        icon: 'U+',
        keywords: ['unicode', 'codepoint', 'invisible', 'zero width', 'zwsp', 'homoglyph', 'bom',
            'nbsp', 'whitespace', 'escape', 'character', 'utf8', 'emoji', 'debug'],
        spec: {
            lede: 'When a string comparison fails for no visible reason, the answer is usually in here — a non-breaking space, a smart quote, a zero-width joiner or a Cyrillic lookalike.',
            input: {
                label: 'Text',
                placeholder: 'Paste the text that is behaving oddly…',
                sample: 'Hello​world — "smart quotes" and a non-breaking space, plus Cyrillic а',
            },
            output: { label: 'Character breakdown', filename: 'unicode.txt' },
            options: [
                { id: 'onlySuspicious', type: 'checkbox', label: 'Only show suspicious characters', default: false },
                { id: 'limit', type: 'number', label: 'Max characters to list', default: 400, min: 10, max: 5000 },
            ],
            run: ({ input, options }) => {
                if (!input) return '';

                const SUSPICIOUS = {
                    0x00a0: 'non-breaking space — looks like a space but is not',
                    0x200b: 'zero-width space — invisible',
                    0x200c: 'zero-width non-joiner — invisible',
                    0x200d: 'zero-width joiner — invisible, joins emoji',
                    0x200e: 'left-to-right mark — invisible',
                    0x200f: 'right-to-left mark — invisible',
                    0xfeff: 'byte order mark — invisible, often a file-encoding artefact',
                    0x2018: 'left single smart quote',
                    0x2019: 'right single smart quote — often mistaken for an apostrophe',
                    0x201c: 'left double smart quote',
                    0x201d: 'right double smart quote',
                    0x2013: 'en dash — not a hyphen',
                    0x2014: 'em dash — not a hyphen',
                    0x2026: 'horizontal ellipsis — one character, not three dots',
                    0x00ad: 'soft hyphen — invisible',
                    0x2028: 'line separator — breaks JSON in some parsers',
                    0x2029: 'paragraph separator',
                    0x0009: 'tab',
                    0x001b: 'escape — start of an ANSI control sequence',
                };

                const CYRILLIC_LOOKALIKES = new Set([0x0430, 0x0435, 0x043e, 0x0440, 0x0441, 0x0445, 0x0443, 0x0456, 0x0458]);
                const GREEK_LOOKALIKES = new Set([0x03bf, 0x03b1, 0x03b5, 0x03c1, 0x03bd]);

                const characters = [...input];
                const rows = [];
                let suspiciousCount = 0;

                for (const [index, char] of characters.entries()) {
                    const code = char.codePointAt(0);
                    let note = '';
                    let flagged = false;

                    if (SUSPICIOUS[code]) { note = SUSPICIOUS[code]; flagged = true; }
                    else if (CYRILLIC_LOOKALIKES.has(code)) { note = 'Cyrillic letter that looks Latin'; flagged = true; }
                    else if (GREEK_LOOKALIKES.has(code)) { note = 'Greek letter that looks Latin'; flagged = true; }
                    else if (code < 32 && code !== 10 && code !== 13) { note = 'control character'; flagged = true; }
                    else if (code >= 0xe000 && code <= 0xf8ff) { note = 'private use area'; flagged = true; }
                    else if (code > 0xffff) note = 'astral plane — 2 UTF-16 code units';

                    if (flagged) suspiciousCount++;
                    if (options.onlySuspicious && !flagged) continue;
                    if (rows.length >= options.limit) break;

                    const display = code === 10 ? '⏎' : code === 9 ? '⇥' : code === 32 ? '␣'
                        : (code < 32 || SUSPICIOUS[code] && /invisible|mark|order/.test(SUSPICIOUS[code])) ? '□' : char;

                    rows.push({
                        index,
                        display,
                        code: `U+${code.toString(16).toUpperCase().padStart(4, '0')}`,
                        escape: code > 0xffff ? `\\u{${code.toString(16)}}` : `\\u${code.toString(16).padStart(4, '0')}`,
                        utf8: [...utf8ToBytes(char)].map((b) => b.toString(16).padStart(2, '0')).join(' '),
                        note,
                        flagged,
                    });
                }

                const bytes = utf8ToBytes(input).length;
                const text = rows.map((r) => `${String(r.index).padStart(4)}  ${r.code.padEnd(9)} ${r.escape.padEnd(12)} ${r.display}  ${r.note}`).join('\n');

                return {
                    output: text || 'No characters matched the filter.',
                    note: `${characters.length} characters, ${suspiciousCount} suspicious`,
                    extraHtml: `
                        <div class="tool-section" style="margin-top:1.5rem;">
                            ${suspiciousCount
                                ? `<div class="alert warn"><span>!</span><span><strong>${suspiciousCount}</strong> character${suspiciousCount === 1 ? '' : 's'} that could cause trouble — invisible, lookalike or control characters.</span></div>`
                                : '<div class="alert ok"><span>✓</span><span>Nothing suspicious — no invisible, control or lookalike characters.</span></div>'}
                            <div class="stat-grid">
                                ${statTile('Characters', characters.length.toLocaleString(), 'code points')}
                                ${statTile('UTF-16 units', input.length.toLocaleString(), 'JavaScript .length')}
                                ${statTile('UTF-8 bytes', bytes.toLocaleString())}
                                ${statTile('Suspicious', suspiciousCount.toLocaleString())}
                            </div>
                            <div class="table-wrap">
                                <table class="data">
                                    <thead><tr><th style="width:60px">#</th><th style="width:50px">Char</th><th>Code point</th><th>Escape</th><th>UTF-8</th><th>Note</th></tr></thead>
                                    <tbody>
                                        ${rows.map((r) => `
                                            <tr${r.flagged ? ' style="background:color-mix(in srgb, var(--yellow) 16%, transparent)"' : ''}>
                                                <td class="num">${r.index}</td>
                                                <td style="font-size:1rem">${escapeHtml(r.display)}</td>
                                                <td><span class="copy-cell"><span>${r.code}</span><button class="copy-chip" data-copy="${r.code}">Copy</button></span></td>
                                                <td>${escapeHtml(r.escape)}</td>
                                                <td>${r.utf8}</td>
                                                <td style="white-space:normal">${escapeHtml(r.note)}</td>
                                            </tr>`).join('')}
                                    </tbody>
                                </table>
                            </div>
                        </div>`,
                };
            },
        },
    },

    {
        id: 'cidr-calculator',
        name: 'CIDR / Subnet Calculator',
        description: 'Work out network, broadcast, host range and size from a CIDR block.',
        category: 'devx',
        icon: '/24',
        keywords: ['cidr', 'subnet', 'netmask', 'network', 'ip', 'ipv4', 'range', 'vpc', 'vnet',
            'broadcast', 'wildcard', 'calculator', 'firewall'],
        spec: {
            lede: 'Also tells you whether an address falls inside the block — the question you actually have when debugging a security group.',
            input: { label: 'CIDR block', placeholder: '10.0.0.0/16', sample: '10.42.0.0/20' },
            output: { label: 'Details', filename: 'subnet.txt' },
            options: [
                { id: 'contains', type: 'text', label: 'Does this address fall inside?', placeholder: '10.42.5.17' },
                { id: 'split', type: 'number', label: 'Split into /n subnets (0 = no)', default: 0, min: 0, max: 32 },
            ],
            run: ({ input, options }) => {
                const match = /^([\d.]+)(?:\/(\d{1,2}))?$/.exec(input.trim());
                if (!match) throw new Error('Expected something like 10.0.0.0/16');

                const base = parseIpv4(match[1]);
                if (base === null) throw new Error(`"${match[1]}" is not a valid IPv4 address`);

                const prefix = match[2] === undefined ? 32 : Number(match[2]);
                if (prefix < 0 || prefix > 32) throw new Error('The prefix must be between 0 and 32');

                const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
                const network = (base & mask) >>> 0;
                const broadcast = (network | (~mask >>> 0)) >>> 0;
                const total = 2 ** (32 - prefix);
                const usable = prefix >= 31 ? total : total - 2;

                const isPrivate = (ip) => {
                    const a = (ip >>> 24) & 255;
                    const b = (ip >>> 16) & 255;
                    return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
                };

                const rows = [
                    ['CIDR', `${toIpv4(network)}/${prefix}`],
                    ['Netmask', toIpv4(mask)],
                    ['Wildcard', toIpv4(~mask >>> 0)],
                    ['Network', toIpv4(network)],
                    ['Broadcast', prefix >= 31 ? 'n/a' : toIpv4(broadcast)],
                    ['First host', prefix >= 31 ? toIpv4(network) : toIpv4(network + 1)],
                    ['Last host', prefix >= 31 ? toIpv4(broadcast) : toIpv4(broadcast - 1)],
                    ['Total addresses', total.toLocaleString()],
                    ['Usable hosts', usable.toLocaleString()],
                    ['Range', `${toIpv4(network)} – ${toIpv4(broadcast)}`],
                    ['Type', isPrivate(network) ? 'private (RFC 1918)' : 'public'],
                ];

                let containsBanner = '';
                if (options.contains?.trim()) {
                    const target = parseIpv4(options.contains);
                    if (target === null) throw new Error(`"${options.contains}" is not a valid IPv4 address`);
                    const inside = (target & mask) >>> 0 === network;
                    rows.push(['', ''], [`Is ${options.contains.trim()} inside?`, inside ? 'YES' : 'NO']);
                    containsBanner = `<div class="alert ${inside ? 'ok' : 'err'}">
                        <span>${inside ? '✓' : '✕'}</span>
                        <span><code>${escapeHtml(options.contains.trim())}</code> is ${inside ? '' : '<strong>not</strong> '}inside <code>${toIpv4(network)}/${prefix}</code></span>
                    </div>`;
                }

                let splitTable = '';
                if (options.split > prefix && options.split <= 32) {
                    const count = 2 ** (options.split - prefix);
                    if (count > 1024) {
                        splitTable = `<div class="alert warn"><span>!</span><span>That split would produce ${count.toLocaleString()} subnets — showing the first 1,024 only.</span></div>`;
                    }
                    const size = 2 ** (32 - options.split);
                    const subnets = [];
                    for (let i = 0; i < Math.min(count, 1024); i++) {
                        const start = (network + i * size) >>> 0;
                        subnets.push([`${toIpv4(start)}/${options.split}`, toIpv4(start), toIpv4((start + size - 1) >>> 0)]);
                    }
                    splitTable += `
                        <h3 style="margin-top:1.25rem;">Split into /${options.split} — ${count.toLocaleString()} subnets</h3>
                        <div class="table-wrap" style="max-height:320px;">
                            <table class="data">
                                <thead><tr><th>Subnet</th><th>First</th><th>Last</th></tr></thead>
                                <tbody>${subnets.map(([cidr, first, last]) => `
                                    <tr>
                                        <td><span class="copy-cell"><span>${cidr}</span><button class="copy-chip" data-copy="${cidr}">Copy</button></span></td>
                                        <td>${first}</td><td>${last}</td>
                                    </tr>`).join('')}</tbody>
                            </table>
                        </div>`;
                }

                return {
                    output: rowsToText(rows),
                    note: `${usable.toLocaleString()} usable hosts`,
                    extraHtml: `
                        <div class="tool-section" style="margin-top:1.5rem;">
                            ${containsBanner}
                            <div class="stat-grid">
                                ${statTile('Usable hosts', usable.toLocaleString())}
                                ${statTile('Network', toIpv4(network))}
                                ${statTile('Netmask', toIpv4(mask))}
                                ${statTile('Range', `${toIpv4(network)} – ${toIpv4(broadcast)}`)}
                            </div>
                            ${splitTable}
                        </div>`,
                };
            },
        },
    },

    {
        id: 'k8s-quantity',
        name: 'Kubernetes Quantity Converter',
        description: 'Translate 512Mi, 1.5Gi, 250m and friends into numbers you can reason about.',
        category: 'devx',
        icon: '☸',
        keywords: ['kubernetes', 'k8s', 'quantity', 'memory', 'cpu', 'millicores', 'mi', 'gi',
            'limits', 'requests', 'resources', 'convert', 'container'],
        spec: {
            lede: 'Mi is 1024-based, M is 1000-based, and mixing them up is how you end up with a pod that OOMs. One line per quantity.',
            input: {
                label: 'Quantities — one per line',
                placeholder: '512Mi\n1.5Gi\n250m\n2',
                sample: '512Mi\n1.5Gi\n2G\n250m\n1500m\n4',
            },
            output: { label: 'Conversions', filename: 'quantities.txt' },
            run: ({ input }) => {
                const lines = input.split('\n').map((l) => l.trim()).filter(Boolean);
                const results = [];

                for (const line of lines) {
                    const match = /^(-?[\d.]+)\s*([a-zA-Z]*)$/.exec(line);
                    if (!match) {
                        results.push({ raw: line, error: 'not a quantity' });
                        continue;
                    }
                    const number = Number(match[1]);
                    const suffix = match[2];

                    if (Number.isNaN(number)) {
                        results.push({ raw: line, error: 'not a number' });
                        continue;
                    }

                    if (suffix === 'm') {
                        // millis: CPU cores, or a thousandth of any unit
                        results.push({
                            raw: line, kind: 'CPU (millicores)',
                            cores: number / 1000,
                            display: `${number / 1000} core${number === 1000 ? '' : 's'}`,
                            bytes: null,
                        });
                        continue;
                    }

                    const multiplier = K8S_SUFFIXES[suffix];
                    if (multiplier === undefined) {
                        results.push({ raw: line, error: `unknown suffix "${suffix}"` });
                        continue;
                    }

                    const bytes = number * multiplier;
                    results.push({
                        raw: line,
                        kind: suffix === '' ? 'plain number (CPU cores, or bytes)' : `memory (${suffix})`,
                        bytes,
                        cores: suffix === '' ? number : null,
                        display: suffix === '' ? `${number} core${number === 1 ? '' : 's'} or ${number} bytes` : null,
                    });
                }

                const fmt = (bytes) => {
                    if (bytes === null || bytes === undefined) return '—';
                    const gi = bytes / 1024 ** 3;
                    const mi = bytes / 1024 ** 2;
                    const g = bytes / 1e9;
                    const m = bytes / 1e6;
                    return { gi, mi, g, m };
                };

                const text = results.map((r) => {
                    if (r.error) return `${r.raw.padEnd(10)} ✕ ${r.error}`;
                    if (r.bytes === null) return `${r.raw.padEnd(10)} ${r.display}`;
                    const f = fmt(r.bytes);
                    return `${r.raw.padEnd(10)} ${r.bytes.toLocaleString()} bytes  =  ${f.mi.toFixed(2)} Mi  =  ${f.gi.toFixed(4)} Gi  =  ${f.m.toFixed(2)} M  =  ${f.g.toFixed(4)} G`;
                }).join('\n');

                return {
                    output: text,
                    note: `${results.length} quantit${results.length === 1 ? 'y' : 'ies'}`,
                    extraHtml: `
                        <div class="tool-section" style="margin-top:1.5rem;">
                            <div class="table-wrap">
                                <table class="data">
                                    <thead><tr><th>Input</th><th>Meaning</th><th>Bytes</th><th>Mi</th><th>Gi</th><th>M</th><th>G</th></tr></thead>
                                    <tbody>
                                        ${results.map((r) => {
                                            if (r.error) return `<tr><td><strong>${escapeHtml(r.raw)}</strong></td><td colspan="6" style="color:var(--red)">${escapeHtml(r.error)}</td></tr>`;
                                            if (r.bytes === null) return `<tr><td><strong>${escapeHtml(r.raw)}</strong></td><td>${escapeHtml(r.kind)}</td><td colspan="5">${escapeHtml(r.display)}</td></tr>`;
                                            const f = fmt(r.bytes);
                                            return `<tr>
                                                <td><strong>${escapeHtml(r.raw)}</strong></td>
                                                <td>${escapeHtml(r.kind)}</td>
                                                <td class="num">${r.bytes.toLocaleString()}</td>
                                                <td class="num">${f.mi.toFixed(2)}</td>
                                                <td class="num">${f.gi.toFixed(4)}</td>
                                                <td class="num">${f.m.toFixed(2)}</td>
                                                <td class="num">${f.g.toFixed(4)}</td>
                                            </tr>`;
                                        }).join('')}
                                    </tbody>
                                </table>
                            </div>
                            <div class="info-box" style="margin-top:1rem;">
                                <strong>Mi vs M:</strong> 1 Mi = 1,048,576 bytes, 1 M = 1,000,000 bytes — a 4.9% difference
                                that compounds. Kubernetes accepts both; requests and limits should use the same one.
                                <strong>1000m = 1 core</strong>, and a CPU value without a suffix is whole cores.
                            </div>
                        </div>`,
                };
            },
        },
    },

    {
        id: 'duration-converter',
        name: 'Duration Converter',
        description: 'Convert between 1h30m, 5400s, ISO 8601 durations and milliseconds.',
        category: 'devx',
        icon: '⏳',
        keywords: ['duration', 'time', 'seconds', 'milliseconds', 'iso 8601', 'timeout', 'ttl',
            'convert', 'human', 'go duration', 'cache-control'],
        spec: {
            lede: 'Accepts Go-style (1h30m), plain seconds, ISO 8601 (PT1H30M) and colon notation (01:30:00).',
            input: {
                label: 'Durations — one per line',
                placeholder: '1h30m\n5400\nPT2H\n00:45:30',
                sample: '1h30m\n5400\nPT2H15M\n00:45:30\n90000ms\n7d',
            },
            output: { label: 'Conversions', filename: 'durations.txt' },
            run: ({ input }) => {
                const parse = (text) => {
                    const value = text.trim();

                    // ISO 8601: PnDTnHnMnS
                    const iso = /^P(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/i.exec(value);
                    if (iso && value.toUpperCase().startsWith('P') && iso.slice(1).some(Boolean)) {
                        return ((Number(iso[1]) || 0) * 86400 + (Number(iso[2]) || 0) * 3600
                            + (Number(iso[3]) || 0) * 60 + (Number(iso[4]) || 0)) * 1000;
                    }

                    // hh:mm:ss or mm:ss
                    if (/^\d{1,3}:\d{1,2}(:\d{1,2}(\.\d+)?)?$/.test(value)) {
                        const parts = value.split(':').map(Number);
                        return (parts.length === 3
                            ? parts[0] * 3600 + parts[1] * 60 + parts[2]
                            : parts[0] * 60 + parts[1]) * 1000;
                    }

                    // Go style: 1h30m10s, with ms/us/ns
                    const unitPattern = /(\d+(?:\.\d+)?)\s*(ns|us|µs|ms|s|m|h|d|w|y)/gi;
                    const units = { ns: 1e-6, us: 1e-3, 'µs': 1e-3, ms: 1, s: 1000, m: 60000, h: 3600000, d: 86400000, w: 604800000, y: 31557600000 };
                    let total = 0;
                    let matched = false;
                    let match;
                    while ((match = unitPattern.exec(value)) !== null) {
                        matched = true;
                        total += Number(match[1]) * units[match[2].toLowerCase()];
                    }
                    if (matched) return total;

                    // bare number = seconds
                    if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value) * 1000;

                    return null;
                };

                const humanise = (ms) => {
                    const units = [
                        ['y', 31557600000], ['d', 86400000], ['h', 3600000],
                        ['m', 60000], ['s', 1000], ['ms', 1],
                    ];
                    let remaining = Math.abs(ms);
                    const parts = [];
                    for (const [label, size] of units) {
                        if (remaining >= size) {
                            const count = Math.floor(remaining / size);
                            remaining -= count * size;
                            parts.push(`${count}${label}`);
                        }
                    }
                    return (ms < 0 ? '-' : '') + (parts.join(' ') || '0ms');
                };

                const toIso = (ms) => {
                    const totalSeconds = ms / 1000;
                    const days = Math.floor(totalSeconds / 86400);
                    const hours = Math.floor((totalSeconds % 86400) / 3600);
                    const minutes = Math.floor((totalSeconds % 3600) / 60);
                    const seconds = Number((totalSeconds % 60).toFixed(3));
                    let out = 'P';
                    if (days) out += `${days}D`;
                    if (hours || minutes || seconds) {
                        out += 'T';
                        if (hours) out += `${hours}H`;
                        if (minutes) out += `${minutes}M`;
                        if (seconds) out += `${seconds}S`;
                    }
                    return out === 'P' ? 'PT0S' : out;
                };

                const clock = (ms) => {
                    const total = Math.floor(ms / 1000);
                    const h = Math.floor(total / 3600);
                    const m = Math.floor((total % 3600) / 60);
                    const s = total % 60;
                    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
                };

                const lines = input.split('\n').map((l) => l.trim()).filter(Boolean);
                const results = lines.map((line) => ({ raw: line, ms: parse(line) }));

                const text = results.map((r) => (r.ms === null
                    ? `${r.raw.padEnd(14)} ✕ could not parse`
                    : `${r.raw.padEnd(14)} ${humanise(r.ms).padEnd(22)} ${(r.ms / 1000).toLocaleString()}s  ${r.ms.toLocaleString()}ms  ${toIso(r.ms)}`)).join('\n');

                return {
                    output: text,
                    note: `${results.filter((r) => r.ms !== null).length} of ${results.length} parsed`,
                    extraHtml: `
                        <div class="tool-section" style="margin-top:1.5rem;">
                            <div class="table-wrap">
                                <table class="data">
                                    <thead><tr><th>Input</th><th>Human</th><th>Seconds</th><th>Milliseconds</th><th>ISO 8601</th><th>hh:mm:ss</th></tr></thead>
                                    <tbody>
                                        ${results.map((r) => (r.ms === null
                                            ? `<tr><td><strong>${escapeHtml(r.raw)}</strong></td><td colspan="5" style="color:var(--red)">could not parse</td></tr>`
                                            : `<tr>
                                                <td><strong>${escapeHtml(r.raw)}</strong></td>
                                                <td>${humanise(r.ms)}</td>
                                                <td class="num">${(r.ms / 1000).toLocaleString()}</td>
                                                <td class="num">${r.ms.toLocaleString()}</td>
                                                <td><span class="copy-cell"><span>${toIso(r.ms)}</span><button class="copy-chip" data-copy="${toIso(r.ms)}">Copy</button></span></td>
                                                <td>${clock(r.ms)}</td>
                                            </tr>`)).join('')}
                                    </tbody>
                                </table>
                            </div>
                        </div>`,
                };
            },
        },
    },

    {
        id: 'semver-checker',
        name: 'Semver Checker',
        description: 'Compare versions and test them against ranges like ^1.2.0 or >=2 <3.',
        category: 'devx',
        icon: '1.2',
        keywords: ['semver', 'version', 'compare', 'range', 'caret', 'tilde', 'npm', 'dependency',
            'satisfies', 'prerelease', 'upgrade'],
        spec: {
            lede: 'Answers "does this version match that range" without installing anything — including the prerelease rules people get wrong.',
            input: {
                label: 'Versions — one per line',
                placeholder: '1.2.3\n2.0.0-beta.1',
                sample: '1.2.3\n1.9.0\n2.0.0\n2.0.0-beta.1\n0.5.2\n1.2.3+build.7',
            },
            output: { label: 'Result', filename: 'semver.txt' },
            options: [
                { id: 'range', type: 'text', label: 'Range to test against', default: '^1.2.0',
                  placeholder: '^1.2.0  ~1.2  >=1.0.0 <2.0.0  1.x' },
                { id: 'sort', type: 'checkbox', label: 'Sort by precedence', default: true },
            ],
            run: ({ input, options }) => {
                const lines = input.split('\n').map((l) => l.trim()).filter(Boolean);
                const parsed = lines.map((line) => ({ raw: line, version: parseSemver(line) }));

                const invalid = parsed.filter((p) => !p.version);
                let valid = parsed.filter((p) => p.version);

                if (options.sort) {
                    valid = [...valid].sort((a, b) => compareSemver(a.version, b.version));
                }

                const range = options.range?.trim();
                const rows = valid.map((p) => {
                    let matches = null;
                    if (range) {
                        try {
                            matches = satisfiesRange(p.version, range);
                        } catch {
                            matches = null;
                        }
                    }
                    return { ...p, matches };
                });

                const text = [
                    range ? `Range: ${range}` : 'No range given',
                    '',
                    ...rows.map((r) => {
                        const mark = r.matches === null ? ' ' : r.matches ? '✓' : '✗';
                        const pre = r.version.prerelease ? ` (prerelease: ${r.version.prerelease})` : '';
                        return `${mark} ${r.raw.padEnd(20)} major ${r.version.major}, minor ${r.version.minor}, patch ${r.version.patch}${pre}`;
                    }),
                    ...(invalid.length ? ['', 'Not valid semver:', ...invalid.map((p) => `  ${p.raw}`)] : []),
                ].join('\n');

                const matching = rows.filter((r) => r.matches === true).length;

                return {
                    output: text,
                    note: range ? `${matching} of ${rows.length} satisfy ${range}` : `${rows.length} versions`,
                    extraHtml: `
                        <div class="tool-section" style="margin-top:1.5rem;">
                            <div class="table-wrap">
                                <table class="data">
                                    <thead><tr><th>Version</th><th>Major</th><th>Minor</th><th>Patch</th><th>Prerelease</th><th>Build</th>${range ? `<th>Matches ${escapeHtml(range)}</th>` : ''}</tr></thead>
                                    <tbody>
                                        ${rows.map((r) => `
                                            <tr>
                                                <td><strong>${escapeHtml(r.raw)}</strong></td>
                                                <td class="num">${r.version.major}</td>
                                                <td class="num">${r.version.minor}</td>
                                                <td class="num">${r.version.patch}</td>
                                                <td>${r.version.prerelease ? escapeHtml(r.version.prerelease) : '<span class="nul">—</span>'}</td>
                                                <td>${r.version.build ? escapeHtml(r.version.build) : '<span class="nul">—</span>'}</td>
                                                ${range ? `<td style="color:${r.matches ? 'var(--green)' : 'var(--red)'};font-weight:800">${r.matches ? 'yes' : 'no'}</td>` : ''}
                                            </tr>`).join('')}
                                    </tbody>
                                </table>
                            </div>
                            <div class="info-box" style="margin-top:1rem;">
                                <strong>^1.2.3</strong> allows 1.x.x at or above 1.2.3 — but for 0.x, <strong>^0.2.3</strong>
                                only allows 0.2.x, because pre-1.0 minor bumps are treated as breaking.
                                <strong>~1.2.3</strong> allows 1.2.x only. A prerelease sorts <em>below</em> its release
                                (1.0.0-beta &lt; 1.0.0) and is normally excluded from ranges unless you ask for it.
                                Build metadata (+build.7) is ignored for precedence entirely.
                            </div>
                        </div>`,
                };
            },
        },
    },

    {
        id: 'curl-converter',
        name: 'cURL Converter',
        description: 'Turn a curl command into fetch, Python, Go, PowerShell or HTTPie.',
        category: 'devx',
        icon: '⤵',
        keywords: ['curl', 'convert', 'fetch', 'python', 'requests', 'go', 'powershell', 'httpie',
            'http', 'request', 'api', 'devtools', 'copy as curl'],
        spec: {
            lede: 'Paste what you copied from the browser network tab ("Copy as cURL") and get working code in another language.',
            input: {
                label: 'curl command',
                placeholder: "curl https://api.example.com/items -H 'accept: application/json'",
                sample: `curl -X POST 'https://api.example.com/v1/orders' \\
  -H 'content-type: application/json' \\
  -H 'authorization: Bearer TOKEN' \\
  -d '{"item":"widget","qty":3}'`,
            },
            output: { label: 'Code', filename: 'request.txt' },
            options: [
                { id: 'target', type: 'select', label: 'Convert to', default: 'fetch',
                  choices: [
                      { value: 'fetch', label: 'JavaScript — fetch' },
                      { value: 'python', label: 'Python — requests' },
                      { value: 'go', label: 'Go — net/http' },
                      { value: 'powershell', label: 'PowerShell — Invoke-RestMethod' },
                      { value: 'httpie', label: 'HTTPie' },
                  ] },
            ],
            run: ({ input, options }) => {
                const request = parseCurl(input);
                const code = emitRequest(request, options.target);

                const extensions = { fetch: 'js', python: 'py', go: 'go', powershell: 'ps1', httpie: 'sh' };
                const headerCount = Object.keys(request.headers).length;

                const hasSecret = Object.entries(request.headers).some(([k, v]) =>
                    /authorization|api[-_]?key|token|secret|cookie/i.test(k) && v.length > 8);

                return {
                    output: code,
                    filename: `request.${extensions[options.target]}`,
                    note: `${request.method} ${request.url}`,
                    extraHtml: `
                        <div class="tool-section" style="margin-top:1.5rem;">
                            ${hasSecret ? `<div class="alert warn"><span>!</span><span>This command carries what looks like a
                                credential in a header. It has been copied into the generated code as-is — move it to an
                                environment variable before committing anything.</span></div>` : ''}
                            <div class="stat-grid">
                                ${statTile('Method', request.method)}
                                ${statTile('Headers', String(headerCount))}
                                ${statTile('Body', request.body ? `${request.body.length} chars` : 'none')}
                            </div>
                            <div class="table-wrap">
                                <table class="data">
                                    <tbody>
                                        <tr><td style="width:140px"><strong>URL</strong></td>
                                            <td style="max-width:none"><span class="copy-cell"><span>${escapeHtml(request.url)}</span>
                                            <button class="copy-chip" data-copy="${escapeHtml(request.url)}">Copy</button></span></td></tr>
                                        ${Object.entries(request.headers).map(([k, v]) => `
                                            <tr><td><strong>${escapeHtml(k)}</strong></td><td style="max-width:none">${escapeHtml(v)}</td></tr>`).join('')}
                                    </tbody>
                                </table>
                            </div>
                        </div>`,
                };
            },
        },
    },

    {
        id: 'env-converter',
        name: '.env Converter',
        description: 'Convert between .env, JSON, YAML, docker-compose and shell exports.',
        category: 'devx',
        icon: '$ENV',
        keywords: ['env', 'dotenv', 'environment', 'variable', 'docker', 'compose', 'kubernetes',
            'configmap', 'yaml', 'json', 'export', 'shell', 'convert', 'secrets'],
        spec: {
            lede: 'The conversion you do by hand every time you move config between a .env file, a compose file and a Kubernetes manifest.',
            input: {
                label: '.env (or JSON — it detects which)',
                accept: '.env,.txt,.json,.yaml,.yml',
                placeholder: 'DATABASE_URL=postgres://localhost/app\nLOG_LEVEL=debug',
                sample: `# application
NODE_ENV=production
PORT=8080
LOG_LEVEL=debug

# database
DATABASE_URL="postgres://user:pass@db:5432/app"
DB_POOL_SIZE=10
FEATURE_FLAGS=a,b,c`,
            },
            output: { label: 'Converted', filename: 'config.txt' },
            options: [
                { id: 'target', type: 'select', label: 'Convert to', default: 'json',
                  choices: [
                      { value: 'json', label: 'JSON' },
                      { value: 'yaml', label: 'YAML' },
                      { value: 'compose', label: 'docker-compose environment' },
                      { value: 'k8s', label: 'Kubernetes ConfigMap' },
                      { value: 'k8sEnv', label: 'Kubernetes container env[]' },
                      { value: 'export', label: 'Shell exports' },
                      { value: 'dockerfile', label: 'Dockerfile ENV' },
                      { value: 'env', label: '.env (normalise)' },
                      { value: 'tfvars', label: 'Terraform tfvars' },
                  ] },
                { id: 'sortKeys', type: 'checkbox', label: 'Sort keys', default: false },
                { id: 'maskSecrets', type: 'checkbox', label: 'Mask values that look secret', default: false },
            ],
            run: ({ input, options }) => {
                const trimmed = input.trim();
                if (!trimmed) return '';

                let variables;
                if (trimmed.startsWith('{')) {
                    try {
                        const parsed = JSON.parse(trimmed);
                        variables = {};
                        for (const [k, v] of Object.entries(parsed)) {
                            variables[k] = v === null || v === undefined ? '' : String(v);
                        }
                    } catch (err) {
                        throw new Error(`Looks like JSON but will not parse: ${err.message}`);
                    }
                } else {
                    variables = parseEnvFile(trimmed);
                }

                let entries = Object.entries(variables);
                if (!entries.length) throw new Error('No variables found. Expected KEY=value lines or a JSON object.');
                if (options.sortKeys) entries = entries.sort(([a], [b]) => a.localeCompare(b));

                if (options.maskSecrets) {
                    entries = entries.map(([k, v]) => [
                        k,
                        /pass|secret|token|key|credential|auth|dsn|url/i.test(k) && v
                            ? `${v.slice(0, 2)}${'*'.repeat(Math.max(4, Math.min(12, v.length - 2)))}`
                            : v,
                    ]);
                }

                const yamlValue = (value) => (/^(true|false|null|~|-?\d+\.?\d*)$/i.test(value) || /[:#{}[\],&*?|<>=!%@`"']|^\s|\s$|^$/.test(value)
                    ? JSON.stringify(value)
                    : value);

                switch (options.target) {
                    case 'json':
                        return JSON.stringify(Object.fromEntries(entries), null, 2);
                    case 'yaml':
                        return entries.map(([k, v]) => `${k}: ${yamlValue(v)}`).join('\n');
                    case 'compose':
                        return `services:\n  app:\n    environment:\n${entries.map(([k, v]) => `      ${k}: ${yamlValue(v)}`).join('\n')}`;
                    case 'k8s':
                        return `apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: app-config\ndata:\n${entries.map(([k, v]) => `  ${k}: ${yamlValue(v)}`).join('\n')}`;
                    case 'k8sEnv':
                        return `env:\n${entries.map(([k, v]) => `  - name: ${k}\n    value: ${yamlValue(v)}`).join('\n')}`;
                    case 'export':
                        return entries.map(([k, v]) => `export ${k}=${envQuote(v)}`).join('\n');
                    case 'dockerfile':
                        return entries.map(([k, v]) => `ENV ${k}=${envQuote(v)}`).join('\n');
                    case 'tfvars':
                        return entries.map(([k, v]) => `${k.toLowerCase()} = ${JSON.stringify(v)}`).join('\n');
                    case 'env':
                    default:
                        return entries.map(([k, v]) => `${k}=${envQuote(v)}`).join('\n');
                }
            },
            footnote: 'A ConfigMap is <strong>not</strong> a secret — its values are stored unencrypted and are visible to anyone who can read the namespace. Put credentials in a Secret (or an external secret store) instead.',
        },
    },

    {
        id: 'jwt-signer',
        name: 'JWT Signer',
        description: 'Build and sign a JSON Web Token with HS256, HS384 or HS512.',
        category: 'devx',
        icon: 'JWT+',
        keywords: ['jwt', 'sign', 'create', 'generate', 'token', 'hs256', 'hmac', 'bearer',
            'auth', 'test', 'fixture'],
        spec: {
            lede: 'For creating test tokens against a service you control. Pairs with the JWT Decoder.',
            input: {
                label: 'Payload (claims) as JSON',
                placeholder: '{"sub":"1234","name":"Test User"}',
                sample: '{\n  "sub": "1234567890",\n  "name": "Test User",\n  "role": "admin"\n}',
            },
            output: { label: 'Signed token', filename: 'token.jwt' },
            live: false,
            actionLabel: 'Sign',
            options: [
                { id: 'algorithm', type: 'select', label: 'Algorithm', default: 'sha256',
                  choices: [
                      { value: 'sha256', label: 'HS256' },
                      { value: 'sha384', label: 'HS384' },
                      { value: 'sha512', label: 'HS512' },
                  ] },
                { id: 'secret', type: 'text', label: 'Secret', default: 'your-256-bit-secret' },
                { id: 'expiresIn', type: 'number', label: 'Expires in (seconds, 0 = no exp)', default: 3600, min: 0 },
                { id: 'addIat', type: 'checkbox', label: 'Add iat (issued at)', default: true },
                { id: 'issuer', type: 'text', label: 'Issuer (iss), optional', placeholder: 'https://auth.example.com' },
                { id: 'audience', type: 'text', label: 'Audience (aud), optional', placeholder: 'my-api' },
            ],
            run: async ({ input, options }) => {
                let claims;
                try {
                    claims = JSON.parse(input);
                } catch (err) {
                    throw new Error(`The payload is not valid JSON: ${err.message}`);
                }
                if (claims === null || typeof claims !== 'object' || Array.isArray(claims)) {
                    throw new Error('The payload must be a JSON object.');
                }
                if (!options.secret) throw new Error('A secret is required to sign the token.');

                const now = Math.floor(Date.now() / 1000);
                const payload = { ...claims };
                if (options.addIat && payload.iat === undefined) payload.iat = now;
                if (options.expiresIn > 0 && payload.exp === undefined) payload.exp = now + options.expiresIn;
                if (options.issuer?.trim() && payload.iss === undefined) payload.iss = options.issuer.trim();
                if (options.audience?.trim() && payload.aud === undefined) payload.aud = options.audience.trim();

                const algNames = { sha256: 'HS256', sha384: 'HS384', sha512: 'HS512' };
                const header = { alg: algNames[options.algorithm], typ: 'JWT' };

                const b64 = (object) => bytesToBase64(utf8ToBytes(JSON.stringify(object)), { urlSafe: true, pad: false });
                const signingInput = `${b64(header)}.${b64(payload)}`;
                const signature = await hmac(options.algorithm, utf8ToBytes(options.secret), utf8ToBytes(signingInput));
                const token = `${signingInput}.${bytesToBase64(signature, { urlSafe: true, pad: false })}`;

                return {
                    output: token,
                    note: `${header.alg} · ${token.length} characters`,
                    extraHtml: `
                        <div class="tool-section" style="margin-top:1.5rem;">
                            <div class="btn-row">
                                <button class="action-btn secondary" data-copy="${escapeHtml(token)}" data-copy-label="Token copied">Copy token</button>
                                <button class="action-btn secondary" data-copy="Authorization: Bearer ${escapeHtml(token)}" data-copy-label="Header copied">Copy as Authorization header</button>
                            </div>
                            <div class="table-wrap">
                                <table class="data">
                                    <tbody>
                                        <tr><td style="width:120px"><strong>Header</strong></td><td style="max-width:none"><pre style="margin:0">${escapeHtml(JSON.stringify(header, null, 2))}</pre></td></tr>
                                        <tr><td><strong>Payload</strong></td><td style="max-width:none"><pre style="margin:0">${escapeHtml(JSON.stringify(payload, null, 2))}</pre></td></tr>
                                    </tbody>
                                </table>
                            </div>
                        </div>`,
                };
            },
            footnote: 'HS256 secrets should be at least 256 bits of real entropy — a short passphrase is brute-forceable offline from a single captured token. Tokens minted here are for testing; do not use this to issue anything a real user relies on, and never paste a production signing secret into a web page.',
        },
    },

    {
        id: 'http-reference',
        name: 'HTTP Reference',
        description: 'Searchable status codes and MIME types, with what they actually mean.',
        category: 'devx',
        icon: '404',
        keywords: ['http', 'status', 'code', 'mime', 'content-type', 'reference', '404', '500',
            '429', '422', 'media type', 'header'],
        spec: {
            lede: 'Type a code, a word or a file extension.',
            layout: 'output',
            actionLabel: 'Search',
            output: { label: 'Matches', filename: 'http-reference.txt' },
            options: [
                { id: 'query', type: 'text', label: 'Search', default: '', placeholder: '404, redirect, .json, rate limit' },
                { id: 'what', type: 'select', label: 'Show', default: 'both',
                  choices: [
                      { value: 'both', label: 'Status codes and MIME types' },
                      { value: 'status', label: 'Status codes only' },
                      { value: 'mime', label: 'MIME types only' },
                  ] },
            ],
            run: ({ options }) => {
                const query = (options.query || '').trim().toLowerCase();

                const statuses = options.what === 'mime' ? [] : STATUS_CODES.filter(([code, name, note]) =>
                    !query || String(code).includes(query) || name.toLowerCase().includes(query) || note.toLowerCase().includes(query));

                const mimes = options.what === 'status' ? [] : MIME_TYPES.filter(([ext, type]) =>
                    !query || ext.toLowerCase().includes(query) || type.toLowerCase().includes(query));

                const classOf = (code) => (code < 200 ? 'informational' : code < 300 ? 'success'
                    : code < 400 ? 'redirect' : code < 500 ? 'client error' : 'server error');
                const colourOf = (code) => (code < 300 ? 'var(--green)' : code < 400 ? 'var(--blue)'
                    : code < 500 ? '#c9a800' : 'var(--red)');

                const text = [
                    ...(statuses.length ? ['STATUS CODES', ...statuses.map(([c, n, d]) => `  ${c}  ${n.padEnd(32)} ${d}`)] : []),
                    ...(mimes.length ? ['', 'MIME TYPES', ...mimes.map(([e, t]) => `  ${e.padEnd(12)} ${t}`)] : []),
                ].join('\n') || 'Nothing matched.';

                return {
                    output: text,
                    note: `${statuses.length} status codes, ${mimes.length} MIME types`,
                    extraHtml: `
                        <div class="tool-section" style="margin-top:1.5rem;">
                            ${statuses.length ? `
                                <h3>Status codes (${statuses.length})</h3>
                                <div class="table-wrap" style="max-height:400px;">
                                    <table class="data">
                                        <thead><tr><th style="width:70px">Code</th><th style="width:200px">Name</th><th style="width:120px">Class</th><th>Meaning</th></tr></thead>
                                        <tbody>
                                            ${statuses.map(([code, name, note]) => `
                                                <tr>
                                                    <td class="num" style="color:${colourOf(code)};font-weight:800">${code}</td>
                                                    <td><strong>${escapeHtml(name)}</strong></td>
                                                    <td>${classOf(code)}</td>
                                                    <td style="white-space:normal;max-width:none">${escapeHtml(note)}</td>
                                                </tr>`).join('')}
                                        </tbody>
                                    </table>
                                </div>` : ''}
                            ${mimes.length ? `
                                <h3 style="margin-top:1.25rem;">MIME types (${mimes.length})</h3>
                                <div class="table-wrap" style="max-height:360px;">
                                    <table class="data">
                                        <thead><tr><th style="width:120px">Extension</th><th>Content-Type</th></tr></thead>
                                        <tbody>
                                            ${mimes.map(([ext, type]) => `
                                                <tr>
                                                    <td><strong>${escapeHtml(ext)}</strong></td>
                                                    <td style="max-width:none"><span class="copy-cell"><span>${escapeHtml(type)}</span>
                                                        <button class="copy-chip" data-copy="${escapeHtml(type.replace(/ \(.*\)$/, ''))}">Copy</button></span></td>
                                                </tr>`).join('')}
                                        </tbody>
                                    </table>
                                </div>` : ''}
                        </div>`,
                };
            },
        },
    },

    {
        id: 'mock-data',
        name: 'Mock Data Generator',
        description: 'Generate realistic test rows as JSON, CSV or SQL inserts.',
        category: 'devx',
        icon: '🎭',
        keywords: ['mock', 'fake', 'test data', 'seed', 'sample', 'faker', 'dummy', 'generate',
            'fixture', 'csv', 'sql', 'insert', 'json'],
        spec: {
            lede: 'Pick the fields you need and get however many rows, ready to paste into a seed script or a test.',
            layout: 'output',
            actionLabel: 'Generate',
            output: { label: 'Data', filename: 'mock-data.json' },
            options: [
                { id: 'fields', type: 'text', label: 'Fields (comma separated)',
                  default: 'id,fullName,email,city,status,price,date' },
                { id: 'rows', type: 'number', label: 'Rows', default: 10, min: 1, max: 5000 },
                { id: 'format', type: 'select', label: 'Format', default: 'json',
                  choices: [
                      { value: 'json', label: 'JSON' },
                      { value: 'jsonl', label: 'JSON Lines' },
                      { value: 'csv', label: 'CSV' },
                      { value: 'sql', label: 'SQL INSERT' },
                  ] },
                { id: 'table', type: 'text', label: 'Table name (SQL)', default: 'users' },
            ],
            run: ({ options }) => {
                const requested = (options.fields || '').split(',').map((f) => f.trim()).filter(Boolean);
                if (!requested.length) throw new Error('Name at least one field.');

                const unknown = requested.filter((f) => !MOCK_FIELDS[f]);
                if (unknown.length) {
                    throw new Error(
                        `Unknown field${unknown.length === 1 ? '' : 's'}: ${unknown.join(', ')}. `
                        + `Available: ${Object.keys(MOCK_FIELDS).join(', ')}`,
                    );
                }

                const count = Math.max(1, Math.min(5000, options.rows));
                const rows = Array.from({ length: count }, (_, i) =>
                    Object.fromEntries(requested.map((field) => [field, MOCK_FIELDS[field](i)])));

                let output;
                switch (options.format) {
                    case 'jsonl':
                        output = rows.map((r) => JSON.stringify(r)).join('\n');
                        break;
                    case 'csv':
                        output = toCsv([requested, ...rows.map((r) => requested.map((f) => r[f]))]);
                        break;
                    case 'sql': {
                        const table = (options.table || 'data').replace(/[^\w.]/g, '');
                        const literal = (v) => (typeof v === 'number' ? String(v)
                            : typeof v === 'boolean' ? (v ? 'TRUE' : 'FALSE')
                            : `'${String(v).replace(/'/g, "''")}'`);
                        output = `INSERT INTO ${table} (${requested.join(', ')}) VALUES\n`
                            + rows.map((r) => `  (${requested.map((f) => literal(r[f])).join(', ')})`).join(',\n') + ';';
                        break;
                    }
                    default:
                        output = JSON.stringify(rows, null, 2);
                }

                const extensions = { json: 'json', jsonl: 'jsonl', csv: 'csv', sql: 'sql' };

                return {
                    output,
                    filename: `mock-data.${extensions[options.format]}`,
                    note: `${count.toLocaleString()} rows × ${requested.length} fields`,
                    extraHtml: `
                        <div class="tool-section" style="margin-top:1.5rem;">
                            <h3>Available fields</h3>
                            <div style="display:flex;flex-wrap:wrap;gap:0.35rem;">
                                ${Object.keys(MOCK_FIELDS).map((f) => `
                                    <button class="copy-chip" data-copy="${f}" data-copy-label="${f} copied"
                                        style="font-size:0.68rem;padding:0.25rem 0.55rem">${f}</button>`).join('')}
                            </div>
                        </div>`,
                };
            },
            footnote: 'The names are borrowed from computing pioneers, and the addresses and phone numbers are structurally valid but fictional. Do not use generated emails to send anything.',
        },
    },

    {
        id: 'markdown-table',
        name: 'Markdown Table Formatter',
        description: 'Align a Markdown table, or build one from CSV, TSV or JSON.',
        category: 'devx',
        icon: '▤',
        keywords: ['markdown', 'table', 'format', 'align', 'csv', 'tsv', 'json', 'readme',
            'pretty', 'pipe', 'github'],
        spec: {
            lede: 'Paste a ragged Markdown table to line it up, or paste CSV/TSV/JSON to turn it into one.',
            input: {
                label: 'Markdown table, CSV, TSV or JSON array',
                placeholder: '| a | b |\n|---|---|\n| 1 | 2 |',
                sample: '| Tool | Language | Notes |\n|---|---|---|\n| Parquet viewer | JS | reads real files |\n| Service Bus | Python + Node | needs the relay |\n| Hashes | JS | verified against hashlib |',
            },
            output: { label: 'Markdown', filename: 'table.md' },
            options: [
                { id: 'align', type: 'select', label: 'Column alignment', default: 'keep',
                  choices: [
                      { value: 'keep', label: 'Keep existing' },
                      { value: 'left', label: 'All left' },
                      { value: 'center', label: 'All centre' },
                      { value: 'right', label: 'All right' },
                      { value: 'auto', label: 'Auto — numbers right' },
                  ] },
                { id: 'compact', type: 'checkbox', label: 'Compact (no padding)', default: false },
            ],
            run: ({ input, options }) => {
                const trimmed = input.trim();
                if (!trimmed) return '';

                let header = [];
                let body = [];
                let alignments = [];

                const isMarkdown = /^\s*\|/.test(trimmed) && /\|\s*:?-+:?\s*\|/.test(trimmed);

                if (isMarkdown) {
                    const lines = trimmed.split('\n').map((l) => l.trim()).filter(Boolean);
                    const cells = (line) => line.replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
                    header = cells(lines[0]);
                    alignments = cells(lines[1]).map((spec) => {
                        const left = spec.startsWith(':');
                        const right = spec.endsWith(':');
                        return left && right ? 'center' : right ? 'right' : left ? 'left' : 'default';
                    });
                    body = lines.slice(2).map(cells);
                } else if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
                    let parsed;
                    try {
                        parsed = JSON.parse(trimmed);
                    } catch (err) {
                        throw new Error(`Looks like JSON but will not parse: ${err.message}`);
                    }
                    const items = Array.isArray(parsed) ? parsed : [parsed];
                    const keys = [...items.reduce((set, item) => {
                        Object.keys(item || {}).forEach((k) => set.add(k));
                        return set;
                    }, new Set())];
                    header = keys;
                    body = items.map((item) => keys.map((k) => {
                        const v = item?.[k];
                        return v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
                    }));
                    alignments = keys.map(() => 'default');
                } else {
                    const delimiter = sniffDelimiter(trimmed);
                    const rows = parseCsv(trimmed, delimiter).filter((r) => r.some((c) => c.trim()));
                    if (!rows.length) throw new Error('Nothing to build a table from.');
                    header = rows[0];
                    body = rows.slice(1);
                    alignments = header.map(() => 'default');
                }

                const columns = Math.max(header.length, ...body.map((r) => r.length));
                while (header.length < columns) header.push('');
                body = body.map((row) => {
                    const copy = [...row];
                    while (copy.length < columns) copy.push('');
                    return copy.slice(0, columns);
                });
                while (alignments.length < columns) alignments.push('default');

                if (options.align === 'auto') {
                    alignments = Array.from({ length: columns }, (_, c) => {
                        const values = body.map((r) => r[c]).filter((v) => v !== '');
                        const numeric = values.length && values.every((v) => /^-?[\d,.]+%?$/.test(v.trim()));
                        return numeric ? 'right' : 'left';
                    });
                } else if (options.align !== 'keep') {
                    alignments = alignments.map(() => options.align);
                }

                // Escape pipes so cell content cannot break the table.
                const clean = (value) => String(value).replace(/\|/g, '\\|').replace(/\n/g, ' ');
                header = header.map(clean);
                body = body.map((row) => row.map(clean));

                if (options.compact) {
                    const separator = alignments.map((a) => (a === 'center' ? ':-:' : a === 'right' ? '-:' : a === 'left' ? ':-' : '-'));
                    return [
                        `|${header.join('|')}|`,
                        `|${separator.join('|')}|`,
                        ...body.map((row) => `|${row.join('|')}|`),
                    ].join('\n');
                }

                const widths = Array.from({ length: columns }, (_, c) => Math.max(
                    3,
                    [...header[c]].length,
                    ...body.map((r) => [...(r[c] ?? '')].length),
                ));

                const pad = (value, width, alignment) => {
                    const length = [...value].length;
                    const gap = width - length;
                    if (alignment === 'right') return ' '.repeat(gap) + value;
                    if (alignment === 'center') {
                        const left = Math.floor(gap / 2);
                        return ' '.repeat(left) + value + ' '.repeat(gap - left);
                    }
                    return value + ' '.repeat(gap);
                };

                const separator = alignments.map((alignment, c) => {
                    const width = widths[c];
                    if (alignment === 'center') return `:${'-'.repeat(width - 2)}:`;
                    if (alignment === 'right') return `${'-'.repeat(width - 1)}:`;
                    if (alignment === 'left') return `:${'-'.repeat(width - 1)}`;
                    return '-'.repeat(width);
                });

                return {
                    output: [
                        `| ${header.map((h, c) => pad(h, widths[c], alignments[c])).join(' | ')} |`,
                        `| ${separator.join(' | ')} |`,
                        ...body.map((row) => `| ${row.map((cell, c) => pad(cell ?? '', widths[c], alignments[c])).join(' | ')} |`),
                    ].join('\n'),
                    note: `${body.length} rows × ${columns} columns`,
                };
            },
        },
    },

    {
        id: 'line-ending-inspector',
        name: 'Line Ending & Whitespace Inspector',
        description: 'Find CRLF/LF mixes, BOMs, trailing spaces and tab/space inconsistency.',
        category: 'devx',
        icon: '¶⏎',
        keywords: ['crlf', 'lf', 'line ending', 'newline', 'bom', 'whitespace', 'trailing', 'tabs',
            'spaces', 'indent', 'git', 'diff', 'encoding', 'windows', 'unix'],
        spec: {
            lede: 'The reason a diff shows every line as changed, or a shell script fails with a mysterious \\r. Paste the file to see what is really in it.',
            input: {
                label: 'File content',
                accept: '*/*',
                placeholder: 'Paste or load a file…',
                sample: 'first line\r\nsecond line\nthird line with trailing space   \n\tfourth line indented with a tab\n    fifth line indented with spaces\n',
            },
            output: { label: 'Report', filename: 'whitespace-report.txt' },
            options: [
                { id: 'convert', type: 'select', label: 'Also convert to', default: 'none',
                  choices: [
                      { value: 'none', label: 'Report only' },
                      { value: 'lf', label: 'LF (Unix)' },
                      { value: 'crlf', label: 'CRLF (Windows)' },
                      { value: 'clean', label: 'LF + strip trailing whitespace' },
                  ] },
            ],
            run: ({ input, options }) => {
                if (!input) return '';

                const crlf = (input.match(/\r\n/g) || []).length;
                const loneCr = (input.match(/\r(?!\n)/g) || []).length;
                const loneLf = (input.match(/(?<!\r)\n/g) || []).length;
                const hasBom = input.charCodeAt(0) === 0xfeff;

                const lines = input.split(/\r\n|\r|\n/);
                const trailing = lines.filter((l) => /\s$/.test(l)).length;
                const tabIndented = lines.filter((l) => /^\t/.test(l)).length;
                const spaceIndented = lines.filter((l) => /^ {1,}/.test(l)).length;
                const endsWithNewline = /[\r\n]$/.test(input);
                const nonAscii = [...input].filter((c) => c.codePointAt(0) > 127).length;

                const dominant = crlf > loneLf ? 'CRLF' : loneLf > 0 ? 'LF' : loneCr > 0 ? 'CR' : 'none';
                const mixed = [crlf > 0, loneLf > 0, loneCr > 0].filter(Boolean).length > 1;

                const problems = [];
                if (mixed) problems.push('Mixed line endings — git will often show the whole file as changed.');
                if (hasBom) problems.push('Starts with a UTF-8 BOM — breaks shell shebangs and some JSON parsers.');
                if (trailing) problems.push(`${trailing} line${trailing === 1 ? '' : 's'} with trailing whitespace.`);
                if (tabIndented && spaceIndented) problems.push('Both tab and space indentation are used.');
                if (!endsWithNewline && input.length) problems.push('No newline at end of file.');

                const rows = [
                    ['Dominant ending', dominant],
                    ['CRLF (\\r\\n)', crlf.toLocaleString()],
                    ['LF (\\n) alone', loneLf.toLocaleString()],
                    ['CR (\\r) alone', loneCr.toLocaleString()],
                    ['Byte order mark', hasBom ? 'yes' : 'no'],
                    ['Lines', lines.length.toLocaleString()],
                    ['Trailing whitespace', trailing.toLocaleString()],
                    ['Tab-indented lines', tabIndented.toLocaleString()],
                    ['Space-indented lines', spaceIndented.toLocaleString()],
                    ['Ends with newline', endsWithNewline ? 'yes' : 'no'],
                    ['Non-ASCII characters', nonAscii.toLocaleString()],
                ];

                let output = rowsToText(rows);
                let filename = 'whitespace-report.txt';

                if (options.convert !== 'none') {
                    let converted = input.replace(/^﻿/, '').replace(/\r\n|\r|\n/g, '\n');
                    if (options.convert === 'clean') {
                        converted = converted.split('\n').map((l) => l.replace(/\s+$/, '')).join('\n');
                        if (!converted.endsWith('\n')) converted += '\n';
                    }
                    if (options.convert === 'crlf') converted = converted.replace(/\n/g, '\r\n');
                    output = converted;
                    filename = 'converted.txt';
                }

                return {
                    output,
                    filename,
                    note: `${dominant} line endings${mixed ? ' (mixed!)' : ''}`,
                    extraHtml: `
                        <div class="tool-section" style="margin-top:1.5rem;">
                            ${problems.length
                                ? `<div class="alert warn"><span>!</span><span><strong>${problems.length} thing${problems.length === 1 ? '' : 's'} worth fixing:</strong><br>${problems.map(escapeHtml).join('<br>')}</span></div>`
                                : '<div class="alert ok"><span>✓</span><span>Consistent line endings, no BOM, no trailing whitespace.</span></div>'}
                            <div class="stat-grid">
                                ${statTile('Line endings', dominant, mixed ? 'MIXED' : 'consistent')}
                                ${statTile('CRLF', crlf.toLocaleString())}
                                ${statTile('LF', loneLf.toLocaleString())}
                                ${statTile('Trailing ws', trailing.toLocaleString())}
                                ${statTile('BOM', hasBom ? 'yes' : 'no')}
                            </div>
                        </div>`,
                };
            },
        },
    },
];

export { parseSemver, compareSemver, satisfiesRange, parseCurl, parseEnvFile, decodeUuid, decodeUlid, parseIpv4, toIpv4 };
