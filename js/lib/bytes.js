// Byte / string / encoding primitives shared across tools.
// Everything funnels through Uint8Array so encoders compose cleanly.

const HEX = '0123456789abcdef';

export function utf8ToBytes(str) {
    return new TextEncoder().encode(str);
}

export function bytesToUtf8(bytes) {
    return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
}

export function bytesToHex(bytes, { upper = false, separator = '' } = {}) {
    let out = '';
    for (let i = 0; i < bytes.length; i++) {
        if (separator && i) out += separator;
        out += HEX[bytes[i] >> 4] + HEX[bytes[i] & 15];
    }
    return upper ? out.toUpperCase() : out;
}

export function hexToBytes(hex) {
    const clean = hex.replace(/(0x)|[\s,:;_-]/gi, '');
    if (!clean) return new Uint8Array(0);
    if (!/^[0-9a-f]+$/i.test(clean)) throw new Error('Not valid hexadecimal — expected only 0-9 and a-f');
    if (clean.length % 2 !== 0) throw new Error(`Hex needs an even number of digits (got ${clean.length})`);
    const out = new Uint8Array(clean.length / 2);
    for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.substr(i * 2, 2), 16);
    return out;
}

// ---- Base64 ---------------------------------------------------------------

export function bytesToBase64(bytes, { urlSafe = false, pad = true } = {}) {
    let bin = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
        bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    let b64 = btoa(bin);
    if (urlSafe) b64 = b64.replace(/\+/g, '-').replace(/\//g, '_');
    if (!pad) b64 = b64.replace(/=+$/, '');
    return b64;
}

export function base64ToBytes(b64) {
    let clean = b64.trim().replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/');
    // tolerate missing padding
    if (clean.length % 4 !== 0) clean += '='.repeat(4 - (clean.length % 4));
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(clean)) throw new Error('Not valid base64 — unexpected characters');
    let bin;
    try {
        bin = atob(clean);
    } catch {
        throw new Error('Not valid base64 — could not decode');
    }
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
}

// ---- Base32 (RFC 4648) ----------------------------------------------------

const B32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function bytesToBase32(bytes, { pad = true } = {}) {
    let out = '';
    let buffer = 0;
    let bits = 0;
    for (const byte of bytes) {
        buffer = (buffer << 8) | byte;
        bits += 8;
        while (bits >= 5) {
            out += B32_ALPHABET[(buffer >>> (bits - 5)) & 31];
            bits -= 5;
        }
    }
    if (bits > 0) out += B32_ALPHABET[(buffer << (5 - bits)) & 31];
    if (pad) while (out.length % 8 !== 0) out += '=';
    return out;
}

export function base32ToBytes(str) {
    const clean = str.toUpperCase().replace(/=+$/, '').replace(/\s+/g, '');
    if (!clean) return new Uint8Array(0);
    const bad = [...clean].find((c) => B32_ALPHABET.indexOf(c) === -1);
    if (bad) throw new Error(`Not valid base32 — "${bad}" is not in the RFC 4648 alphabet`);
    const out = [];
    let buffer = 0;
    let bits = 0;
    for (const char of clean) {
        buffer = (buffer << 5) | B32_ALPHABET.indexOf(char);
        bits += 5;
        if (bits >= 8) {
            out.push((buffer >>> (bits - 8)) & 0xff);
            bits -= 8;
        }
    }
    return new Uint8Array(out);
}

// ---- Base58 (Bitcoin alphabet) -------------------------------------------

const B58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

export function bytesToBase58(bytes) {
    if (bytes.length === 0) return '';
    // count leading zero bytes -> leading '1's
    let zeros = 0;
    while (zeros < bytes.length && bytes[zeros] === 0) zeros++;

    const digits = [0];
    for (let i = zeros; i < bytes.length; i++) {
        let carry = bytes[i];
        for (let j = 0; j < digits.length; j++) {
            carry += digits[j] << 8;
            digits[j] = carry % 58;
            carry = (carry / 58) | 0;
        }
        while (carry > 0) {
            digits.push(carry % 58);
            carry = (carry / 58) | 0;
        }
    }

    let out = '1'.repeat(zeros);
    for (let i = digits.length - 1; i >= 0; i--) out += B58_ALPHABET[digits[i]];
    return out;
}

export function base58ToBytes(str) {
    const clean = str.trim();
    if (!clean) return new Uint8Array(0);
    let zeros = 0;
    while (zeros < clean.length && clean[zeros] === '1') zeros++;

    const bytes = [0];
    for (let i = zeros; i < clean.length; i++) {
        const value = B58_ALPHABET.indexOf(clean[i]);
        if (value === -1) throw new Error(`Not valid base58 — "${clean[i]}" is not in the alphabet (0, O, I and l are excluded by design)`);
        let carry = value;
        for (let j = 0; j < bytes.length; j++) {
            carry += bytes[j] * 58;
            bytes[j] = carry & 0xff;
            carry >>= 8;
        }
        while (carry > 0) {
            bytes.push(carry & 0xff);
            carry >>= 8;
        }
    }

    const out = new Uint8Array(zeros + bytes.length);
    for (let i = 0; i < bytes.length; i++) out[zeros + i] = bytes[bytes.length - 1 - i];
    return out;
}

// ---- Misc ----------------------------------------------------------------

export function randomBytes(n) {
    const out = new Uint8Array(n);
    crypto.getRandomValues(out);
    return out;
}

/** Uniform random integer in [0, max) without modulo bias. */
export function randomInt(max) {
    if (max <= 0) throw new Error('max must be positive');
    const limit = Math.floor(0xffffffff / max) * max;
    const buf = new Uint32Array(1);
    let value;
    do {
        crypto.getRandomValues(buf);
        value = buf[0];
    } while (value >= limit);
    return value % max;
}

export function formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    if (bytes < 1024) return `${bytes} B`;
    const units = ['KB', 'MB', 'GB', 'TB'];
    let value = bytes / 1024;
    let unit = 0;
    while (value >= 1024 && unit < units.length - 1) {
        value /= 1024;
        unit++;
    }
    return `${value.toFixed(value < 10 ? 2 : 1)} ${units[unit]}`;
}
