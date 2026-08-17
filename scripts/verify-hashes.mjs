// Verifies js/lib/hashes.js against Node's crypto module.
//   node scripts/verify-hashes.mjs
import crypto from 'node:crypto';
import { ALGORITHMS, digest, hmac } from '../js/lib/hashes.js';

const nodeName = {
    'md5': 'md5', 'sha1': 'sha1', 'sha224': 'sha224', 'sha256': 'sha256',
    'sha384': 'sha384', 'sha512': 'sha512', 'sha3-224': 'sha3-224',
    'sha3-256': 'sha3-256', 'sha3-384': 'sha3-384', 'sha3-512': 'sha3-512',
    'ripemd160': 'ripemd160',
};

// Algorithms Node may not expose (OpenSSL 3 moves RIPEMD-160 to the legacy
// provider) plus Keccak, which Node never had. Checked against published vectors.
const KNOWN_VECTORS = {
    'keccak-256': {
        '': 'c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470',
        'abc': '4e03657aea45a94fc7d47ba826c8d667c0d1e6e33a64a036ec44f58fa12d6c45',
        'The quick brown fox jumps over the lazy dog':
            '4d741b6f1eb29cb2a9b9911c82f56fa8d73b04959d3d9d222895df6c0b28aa15',
    },
    'ripemd160': {
        '': '9c1185a5c5e9fc54612808977ee8f548b2258d31',
        'abc': '8eb208f7e05d987a9b044a8e98c6b087f15a0bfc',
        'message digest': '5d0689ef49d2fae572b881b123a85ffa21595f36',
        'The quick brown fox jumps over the lazy dog':
            '37f332f68db77bd9d7edd4969571ad671cf9dd3b',
    },
};

const hex = (u8) => Buffer.from(u8).toString('hex');
const enc = (s) => new TextEncoder().encode(s);

const SAMPLES = [
    '',
    'abc',
    'The quick brown fox jumps over the lazy dog',
    'a'.repeat(1000),
    '🔥 unicode — ünïcödé tëst 日本語',
    'x'.repeat(64),   // exactly one 64-byte block
    'y'.repeat(128),  // exactly one 128-byte block
    'z'.repeat(136),  // exactly the SHA3-256 rate
];

let pass = 0;
let fail = 0;
const skipped = [];

function check(name, actual, expected) {
    if (actual === expected) {
        pass++;
    } else {
        fail++;
        console.error(`  FAIL ${name}\n    expected ${expected}\n    actual   ${actual}`);
    }
}

console.log('--- digests ---');
for (const algo of Object.keys(ALGORITHMS)) {
    let nodeSupported = false;
    if (nodeName[algo]) {
        try {
            crypto.createHash(nodeName[algo]).update('').digest();
            nodeSupported = true;
        } catch {
            nodeSupported = false;
        }
    }

    for (const sample of SAMPLES) {
        const actual = hex(await digest(algo, enc(sample)));
        const label = `${algo} "${sample.slice(0, 24)}${sample.length > 24 ? '…' : ''}"`;

        if (nodeSupported) {
            check(label, actual, crypto.createHash(nodeName[algo]).update(sample, 'utf8').digest('hex'));
        } else if (KNOWN_VECTORS[algo]?.[sample] !== undefined) {
            check(`${label} (vector)`, actual, KNOWN_VECTORS[algo][sample]);
        } else {
            skipped.push(label);
        }
    }
}

console.log('--- hmac ---');
const HMAC_CASES = [
    { key: 'key', msg: 'The quick brown fox jumps over the lazy dog' },
    { key: '', msg: '' },
    { key: 'k'.repeat(200), msg: 'long key gets hashed down first' },
    { key: 'short', msg: 'm'.repeat(500) },
];

for (const algo of Object.keys(ALGORITHMS)) {
    if (!nodeName[algo]) continue;
    let supported = true;
    try {
        crypto.createHmac(nodeName[algo], 'k').update('').digest();
    } catch {
        supported = false;
    }
    if (!supported) {
        skipped.push(`hmac-${algo}`);
        continue;
    }

    for (const { key, msg } of HMAC_CASES) {
        const actual = hex(await hmac(algo, enc(key), enc(msg)));
        const expected = crypto.createHmac(nodeName[algo], Buffer.from(enc(key))).update(msg, 'utf8').digest('hex');
        check(`hmac-${algo} key="${key.slice(0, 12)}"`, actual, expected);
    }
}

console.log(`\n${pass} passed, ${fail} failed${skipped.length ? `, ${skipped.length} skipped (not available in this Node build)` : ''}`);
if (skipped.length) console.log('  skipped:', [...new Set(skipped.map((s) => s.split(' ')[0]))].join(', '));
process.exit(fail === 0 ? 0 : 1);
