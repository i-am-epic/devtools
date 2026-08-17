// Hash primitives.
//
// SHA-1 / SHA-256 / SHA-384 / SHA-512 come from WebCrypto (native, fast).
// MD5, SHA-224, RIPEMD-160 and the SHA-3 family are implemented here because
// WebCrypto does not provide them. HMAC uses the generic RFC 2104 construction
// over whichever digest is selected, so it works for every algorithm uniformly.
//
// Every algorithm in this file is verified against Node's crypto module by
// scripts/verify-hashes.mjs.

// ---------------------------------------------------------------- MD5 -----

function md5(bytes) {
    const S = [
        7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
        5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
        4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
        6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
    ];
    const K = new Uint32Array(64);
    for (let i = 0; i < 64; i++) K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296);

    const msgLen = bytes.length;
    const bitLenLo = (msgLen << 3) >>> 0;
    const bitLenHi = Math.floor(msgLen / 536870912) >>> 0;

    // pad: 0x80, zeros, then 64-bit little-endian bit length
    const padded = new Uint8Array((((msgLen + 8) >> 6) + 1) << 6);
    padded.set(bytes);
    padded[msgLen] = 0x80;
    const view = new DataView(padded.buffer);
    view.setUint32(padded.length - 8, bitLenLo, true);
    view.setUint32(padded.length - 4, bitLenHi, true);

    let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;
    const M = new Uint32Array(16);

    for (let offset = 0; offset < padded.length; offset += 64) {
        for (let i = 0; i < 16; i++) M[i] = view.getUint32(offset + i * 4, true);

        let A = a0, B = b0, C = c0, D = d0;
        for (let i = 0; i < 64; i++) {
            let F, g;
            if (i < 16) { F = (B & C) | (~B & D); g = i; }
            else if (i < 32) { F = (D & B) | (~D & C); g = (5 * i + 1) % 16; }
            else if (i < 48) { F = B ^ C ^ D; g = (3 * i + 5) % 16; }
            else { F = C ^ (B | ~D); g = (7 * i) % 16; }

            F = (F + A + K[i] + M[g]) >>> 0;
            A = D;
            D = C;
            C = B;
            B = (B + ((F << S[i]) | (F >>> (32 - S[i])))) >>> 0;
        }
        a0 = (a0 + A) >>> 0;
        b0 = (b0 + B) >>> 0;
        c0 = (c0 + C) >>> 0;
        d0 = (d0 + D) >>> 0;
    }

    const out = new Uint8Array(16);
    const ov = new DataView(out.buffer);
    ov.setUint32(0, a0, true);
    ov.setUint32(4, b0, true);
    ov.setUint32(8, c0, true);
    ov.setUint32(12, d0, true);
    return out;
}

// --------------------------------------------------- SHA-256 / SHA-224 ----

const SHA256_K = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function sha256Core(bytes, initial, outputBytes) {
    const msgLen = bytes.length;
    const padded = new Uint8Array((((msgLen + 8) >> 6) + 1) << 6);
    padded.set(bytes);
    padded[msgLen] = 0x80;
    const view = new DataView(padded.buffer);
    // 64-bit big-endian bit length
    view.setUint32(padded.length - 8, Math.floor(msgLen / 536870912) >>> 0, false);
    view.setUint32(padded.length - 4, (msgLen << 3) >>> 0, false);

    const H = Uint32Array.from(initial);
    const W = new Uint32Array(64);

    for (let offset = 0; offset < padded.length; offset += 64) {
        for (let i = 0; i < 16; i++) W[i] = view.getUint32(offset + i * 4, false);
        for (let i = 16; i < 64; i++) {
            const w15 = W[i - 15];
            const w2 = W[i - 2];
            const s0 = ((w15 >>> 7) | (w15 << 25)) ^ ((w15 >>> 18) | (w15 << 14)) ^ (w15 >>> 3);
            const s1 = ((w2 >>> 17) | (w2 << 15)) ^ ((w2 >>> 19) | (w2 << 13)) ^ (w2 >>> 10);
            W[i] = (W[i - 16] + s0 + W[i - 7] + s1) >>> 0;
        }

        let [a, b, c, d, e, f, g, h] = H;
        for (let i = 0; i < 64; i++) {
            const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
            const ch = (e & f) ^ (~e & g);
            const temp1 = (h + S1 + ch + SHA256_K[i] + W[i]) >>> 0;
            const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
            const maj = (a & b) ^ (a & c) ^ (b & c);
            const temp2 = (S0 + maj) >>> 0;

            h = g; g = f; f = e;
            e = (d + temp1) >>> 0;
            d = c; c = b; b = a;
            a = (temp1 + temp2) >>> 0;
        }

        H[0] = (H[0] + a) >>> 0; H[1] = (H[1] + b) >>> 0;
        H[2] = (H[2] + c) >>> 0; H[3] = (H[3] + d) >>> 0;
        H[4] = (H[4] + e) >>> 0; H[5] = (H[5] + f) >>> 0;
        H[6] = (H[6] + g) >>> 0; H[7] = (H[7] + h) >>> 0;
    }

    const out = new Uint8Array(outputBytes);
    const ov = new DataView(out.buffer);
    for (let i = 0; i < outputBytes / 4; i++) ov.setUint32(i * 4, H[i], false);
    return out;
}

const SHA256_IV = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
const SHA224_IV = [0xc1059ed8, 0x367cd507, 0x3070dd17, 0xf70e5939, 0xffc00b31, 0x68581511, 0x64f98fa7, 0xbefa4fa4];

const sha224 = (bytes) => sha256Core(bytes, SHA224_IV, 28);

/**
 * Synchronous SHA-256. The registry uses WebCrypto (async) for this algorithm;
 * this pure-JS path exists for the few callers that cannot await, and is
 * checked against WebCrypto by the test suite.
 */
export const sha256Sync = (bytes) => sha256Core(bytes, SHA256_IV, 32);

/** Synchronous HMAC-SHA256, built on sha256Sync. */
export function hmacSha256Sync(keyBytes, messageBytes) {
    const blockSize = 64;
    let key = keyBytes;
    if (key.length > blockSize) key = sha256Sync(key);

    const padded = new Uint8Array(blockSize);
    padded.set(key);

    const inner = new Uint8Array(blockSize + messageBytes.length);
    const outer = new Uint8Array(blockSize + 32);
    for (let i = 0; i < blockSize; i++) {
        inner[i] = padded[i] ^ 0x36;
        outer[i] = padded[i] ^ 0x5c;
    }
    inner.set(messageBytes, blockSize);
    outer.set(sha256Sync(inner), blockSize);
    return sha256Sync(outer);
}

// ------------------------------------------------------------ RIPEMD-160 --

function ripemd160(bytes) {
    const ZL = [
        0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15,
        7, 4, 13, 1, 10, 6, 15, 3, 12, 0, 9, 5, 2, 14, 11, 8,
        3, 10, 14, 4, 9, 15, 8, 1, 2, 7, 0, 6, 13, 11, 5, 12,
        1, 9, 11, 10, 0, 8, 12, 4, 13, 3, 7, 15, 14, 5, 6, 2,
        4, 0, 5, 9, 7, 12, 2, 10, 14, 1, 3, 8, 11, 6, 15, 13,
    ];
    const ZR = [
        5, 14, 7, 0, 9, 2, 11, 4, 13, 6, 15, 8, 1, 10, 3, 12,
        6, 11, 3, 7, 0, 13, 5, 10, 14, 15, 8, 12, 4, 9, 1, 2,
        15, 5, 1, 3, 7, 14, 6, 9, 11, 8, 12, 2, 10, 0, 4, 13,
        8, 6, 4, 1, 3, 11, 15, 0, 5, 12, 2, 13, 9, 7, 10, 14,
        12, 15, 10, 4, 1, 5, 8, 7, 6, 2, 13, 14, 0, 3, 9, 11,
    ];
    const SL = [
        11, 14, 15, 12, 5, 8, 7, 9, 11, 13, 14, 15, 6, 7, 9, 8,
        7, 6, 8, 13, 11, 9, 7, 15, 7, 12, 15, 9, 11, 7, 13, 12,
        11, 13, 6, 7, 14, 9, 13, 15, 14, 8, 13, 6, 5, 12, 7, 5,
        11, 12, 14, 15, 14, 15, 9, 8, 9, 14, 5, 6, 8, 6, 5, 12,
        9, 15, 5, 11, 6, 8, 13, 12, 5, 12, 13, 14, 11, 8, 5, 6,
    ];
    const SR = [
        8, 9, 9, 11, 13, 15, 15, 5, 7, 7, 8, 11, 14, 14, 12, 6,
        9, 13, 15, 7, 12, 8, 9, 11, 7, 7, 12, 7, 6, 15, 13, 11,
        9, 7, 15, 11, 8, 6, 6, 14, 12, 13, 5, 14, 13, 13, 7, 5,
        15, 5, 8, 11, 14, 14, 6, 14, 6, 9, 12, 9, 12, 5, 15, 8,
        8, 5, 12, 9, 12, 5, 14, 6, 8, 13, 6, 5, 15, 13, 11, 11,
    ];
    const KL = [0x00000000, 0x5a827999, 0x6ed9eba1, 0x8f1bbcdc, 0xa953fd4e];
    const KR = [0x50a28be6, 0x5c4dd124, 0x6d703ef3, 0x7a6d76e9, 0x00000000];

    const rol = (x, n) => ((x << n) | (x >>> (32 - n))) >>> 0;
    const f = (j, x, y, z) => {
        if (j < 16) return x ^ y ^ z;
        if (j < 32) return (x & y) | (~x & z);
        if (j < 48) return (x | ~y) ^ z;
        if (j < 64) return (x & z) | (y & ~z);
        return x ^ (y | ~z);
    };

    const msgLen = bytes.length;
    const padded = new Uint8Array((((msgLen + 8) >> 6) + 1) << 6);
    padded.set(bytes);
    padded[msgLen] = 0x80;
    const view = new DataView(padded.buffer);
    view.setUint32(padded.length - 8, (msgLen << 3) >>> 0, true);
    view.setUint32(padded.length - 4, Math.floor(msgLen / 536870912) >>> 0, true);

    let h0 = 0x67452301, h1 = 0xefcdab89, h2 = 0x98badcfe, h3 = 0x10325476, h4 = 0xc3d2e1f0;
    const X = new Uint32Array(16);

    for (let offset = 0; offset < padded.length; offset += 64) {
        for (let i = 0; i < 16; i++) X[i] = view.getUint32(offset + i * 4, true);

        let al = h0, bl = h1, cl = h2, dl = h3, el = h4;
        let ar = h0, br = h1, cr = h2, dr = h3, er = h4;

        for (let j = 0; j < 80; j++) {
            const round = Math.floor(j / 16);

            let t = (al + f(j, bl, cl, dl) + X[ZL[j]] + KL[round]) >>> 0;
            t = (rol(t, SL[j]) + el) >>> 0;
            al = el; el = dl; dl = rol(cl, 10); cl = bl; bl = t;

            t = (ar + f(79 - j, br, cr, dr) + X[ZR[j]] + KR[round]) >>> 0;
            t = (rol(t, SR[j]) + er) >>> 0;
            ar = er; er = dr; dr = rol(cr, 10); cr = br; br = t;
        }

        const t = (h1 + cl + dr) >>> 0;
        h1 = (h2 + dl + er) >>> 0;
        h2 = (h3 + el + ar) >>> 0;
        h3 = (h4 + al + br) >>> 0;
        h4 = (h0 + bl + cr) >>> 0;
        h0 = t;
    }

    const out = new Uint8Array(20);
    const ov = new DataView(out.buffer);
    [h0, h1, h2, h3, h4].forEach((h, i) => ov.setUint32(i * 4, h, true));
    return out;
}

// ------------------------------------------------------- SHA-3 / Keccak ---

const KECCAK_RC = [
    0x0000000000000001n, 0x0000000000008082n, 0x800000000000808an, 0x8000000080008000n,
    0x000000000000808bn, 0x0000000080000001n, 0x8000000080008081n, 0x8000000000008009n,
    0x000000000000008an, 0x0000000000000088n, 0x0000000080008009n, 0x000000008000000an,
    0x000000008000808bn, 0x800000000000008bn, 0x8000000000008089n, 0x8000000000008003n,
    0x8000000000008002n, 0x8000000000000080n, 0x000000000000800an, 0x800000008000000an,
    0x8000000080008081n, 0x8000000000008080n, 0x0000000080000001n, 0x8000000080008008n,
];

const KECCAK_ROT = [
    0, 1, 62, 28, 27, 36, 44, 6, 55, 20, 3, 10, 43, 25, 39,
    41, 45, 15, 21, 8, 18, 2, 61, 56, 14,
];

const MASK64 = 0xffffffffffffffffn;

function rotl64(x, n) {
    if (n === 0) return x;
    const s = BigInt(n);
    return ((x << s) | (x >> (64n - s))) & MASK64;
}

function keccakF1600(state) {
    for (let round = 0; round < 24; round++) {
        // theta
        const C = new Array(5);
        for (let x = 0; x < 5; x++) {
            C[x] = state[x] ^ state[x + 5] ^ state[x + 10] ^ state[x + 15] ^ state[x + 20];
        }
        for (let x = 0; x < 5; x++) {
            const D = C[(x + 4) % 5] ^ rotl64(C[(x + 1) % 5], 1);
            for (let y = 0; y < 5; y++) state[x + 5 * y] ^= D;
        }

        // rho + pi
        const B = new Array(25).fill(0n);
        for (let x = 0; x < 5; x++) {
            for (let y = 0; y < 5; y++) {
                B[y + 5 * ((2 * x + 3 * y) % 5)] = rotl64(state[x + 5 * y], KECCAK_ROT[x + 5 * y]);
            }
        }

        // chi
        for (let x = 0; x < 5; x++) {
            for (let y = 0; y < 5; y++) {
                state[x + 5 * y] = B[x + 5 * y] ^ ((~B[((x + 1) % 5) + 5 * y] & MASK64) & B[((x + 2) % 5) + 5 * y]);
            }
        }

        // iota
        state[0] ^= KECCAK_RC[round];
    }
}

/**
 * @param {Uint8Array} bytes
 * @param {number} outputBytes digest length
 * @param {number} suffix domain-separation byte (0x06 SHA-3, 0x01 legacy Keccak)
 */
function keccak(bytes, outputBytes, suffix) {
    const rate = 200 - 2 * outputBytes;
    const state = new Array(25).fill(0n);

    // pad10*1
    const padLen = rate - (bytes.length % rate);
    const padded = new Uint8Array(bytes.length + padLen);
    padded.set(bytes);
    padded[bytes.length] = suffix;
    padded[padded.length - 1] |= 0x80;

    for (let offset = 0; offset < padded.length; offset += rate) {
        for (let i = 0; i < rate / 8; i++) {
            let lane = 0n;
            for (let b = 7; b >= 0; b--) lane = (lane << 8n) | BigInt(padded[offset + i * 8 + b]);
            state[i] ^= lane;
        }
        keccakF1600(state);
    }

    const out = new Uint8Array(outputBytes);
    for (let i = 0; i < outputBytes; i++) {
        const lane = state[Math.floor(i / 8)];
        out[i] = Number((lane >> BigInt(8 * (i % 8))) & 0xffn);
    }
    return out;
}

// ------------------------------------------------------------- Registry ---

const webcrypto = (name) => async (bytes) =>
    new Uint8Array(await crypto.subtle.digest(name, bytes));

/**
 * Every entry: { label, blockSize, digest(Uint8Array) -> Promise<Uint8Array> }
 * blockSize is the compression-function block size, needed for HMAC.
 */
export const ALGORITHMS = {
    'md5':         { label: 'MD5',         blockSize: 64,  digest: async (b) => md5(b) },
    'sha1':        { label: 'SHA-1',       blockSize: 64,  digest: webcrypto('SHA-1') },
    'sha224':      { label: 'SHA-224',     blockSize: 64,  digest: async (b) => sha224(b) },
    'sha256':      { label: 'SHA-256',     blockSize: 64,  digest: webcrypto('SHA-256') },
    'sha384':      { label: 'SHA-384',     blockSize: 128, digest: webcrypto('SHA-384') },
    'sha512':      { label: 'SHA-512',     blockSize: 128, digest: webcrypto('SHA-512') },
    'sha3-224':    { label: 'SHA3-224',    blockSize: 144, digest: async (b) => keccak(b, 28, 0x06) },
    'sha3-256':    { label: 'SHA3-256',    blockSize: 136, digest: async (b) => keccak(b, 32, 0x06) },
    'sha3-384':    { label: 'SHA3-384',    blockSize: 104, digest: async (b) => keccak(b, 48, 0x06) },
    'sha3-512':    { label: 'SHA3-512',    blockSize: 72,  digest: async (b) => keccak(b, 64, 0x06) },
    'keccak-256':  { label: 'Keccak-256',  blockSize: 136, digest: async (b) => keccak(b, 32, 0x01) },
    'ripemd160':   { label: 'RIPEMD-160',  blockSize: 64,  digest: async (b) => ripemd160(b) },
};

/** Digest arbitrary bytes with the named algorithm. */
export async function digest(algorithm, bytes) {
    const algo = ALGORITHMS[algorithm];
    if (!algo) throw new Error(`Unknown hash algorithm "${algorithm}"`);
    return algo.digest(bytes);
}

/** HMAC (RFC 2104) over any algorithm in the registry. */
export async function hmac(algorithm, keyBytes, messageBytes) {
    const algo = ALGORITHMS[algorithm];
    if (!algo) throw new Error(`Unknown hash algorithm "${algorithm}"`);
    const { blockSize } = algo;

    let key = keyBytes;
    if (key.length > blockSize) key = await algo.digest(key);

    const padded = new Uint8Array(blockSize);
    padded.set(key);

    const inner = new Uint8Array(blockSize + messageBytes.length);
    const outer = new Uint8Array(blockSize + (await algo.digest(new Uint8Array(0))).length);

    for (let i = 0; i < blockSize; i++) {
        inner[i] = padded[i] ^ 0x36;
        outer[i] = padded[i] ^ 0x5c;
    }
    inner.set(messageBytes, blockSize);

    const innerHash = await algo.digest(inner);
    outer.set(innerHash, blockSize);
    return algo.digest(outer);
}
