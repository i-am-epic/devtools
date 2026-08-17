// Base32 / Base58 / Base64 encoders, decoders and cross-conversions.
//
// These are all the same shape — bytes in the middle, a different alphabet on
// each side — so they are generated from a codec table instead of being
// written out fourteen times.

import {
    utf8ToBytes, bytesToUtf8,
    bytesToHex, hexToBytes,
    bytesToBase64, base64ToBytes,
    bytesToBase32, base32ToBytes,
    bytesToBase58, base58ToBytes,
} from '../../lib/bytes.js';

const CODECS = {
    base64: {
        label: 'Base64',
        slug: 'base64',
        icon: 'b64',
        encode: (bytes, options) => bytesToBase64(bytes, { urlSafe: options.urlSafe, pad: options.pad !== false }),
        decode: base64ToBytes,
        options: [
            { id: 'urlSafe', type: 'checkbox', label: 'URL-safe alphabet (- and _)', default: false },
            { id: 'pad', type: 'checkbox', label: 'Include = padding', default: true },
        ],
        note: 'Base64 packs 3 bytes into 4 characters, so output is about 33% larger than the input.',
    },
    base32: {
        label: 'Base32',
        slug: 'base32',
        icon: 'b32',
        encode: (bytes, options) => bytesToBase32(bytes, { pad: options.pad !== false }),
        decode: base32ToBytes,
        options: [{ id: 'pad', type: 'checkbox', label: 'Include = padding', default: true }],
        note: 'RFC 4648 Base32 uses A–Z and 2–7 only, so it survives case-insensitive systems like DNS and TOTP secrets.',
    },
    base58: {
        label: 'Base58',
        slug: 'base58',
        icon: 'b58',
        encode: (bytes) => bytesToBase58(bytes),
        decode: base58ToBytes,
        options: [],
        note: 'Bitcoin-style Base58 omits 0, O, I and l to avoid visual ambiguity. There is no padding.',
    },
};

const SAMPLE_TEXT = 'Hello, world!';

function encoderTool(codec) {
    return {
        id: `${codec.slug}-encoder`,
        name: `${codec.label} Encoder`,
        description: `Encode text or a file into ${codec.label}.`,
        category: 'encoding',
        icon: codec.icon,
        keywords: [codec.slug, 'encode', 'encoder', 'text', 'convert'],
        spec: {
            lede: `UTF-8 encodes the text, then renders the bytes as ${codec.label}. ${codec.note}`,
            input: { label: 'Text', placeholder: SAMPLE_TEXT, sample: SAMPLE_TEXT, accept: '*/*', binary: false },
            output: { label: codec.label, filename: `encoded.${codec.slug}.txt` },
            swap: true,
            options: codec.options,
            run: ({ input, options }) => codec.encode(utf8ToBytes(input), options),
        },
    };
}

function decoderTool(codec) {
    return {
        id: `${codec.slug}-decoder`,
        name: `${codec.label} Decoder`,
        description: `Decode ${codec.label} back into readable text.`,
        category: 'encoding',
        icon: `${codec.icon}→`,
        keywords: [codec.slug, 'decode', 'decoder', 'text', 'convert'],
        spec: {
            lede: `Decodes ${codec.label} to bytes, then interprets those bytes as UTF-8 text.`,
            input: {
                label: codec.label,
                placeholder: codec.encode(utf8ToBytes(SAMPLE_TEXT), { pad: true }),
                sample: codec.encode(utf8ToBytes(SAMPLE_TEXT), { pad: true }),
            },
            output: { label: 'Text', filename: 'decoded.txt' },
            swap: true,
            run: ({ input }) => {
                const bytes = codec.decode(input.trim());
                const text = bytesToUtf8(bytes);
                // U+FFFD means the bytes were not valid UTF-8 — show hex instead of mojibake.
                if (text.includes('�')) {
                    return {
                        output: bytesToHex(bytes, { separator: ' ' }),
                        note: `${bytes.length} bytes — not valid UTF-8 text, showing hex instead`,
                    };
                }
                return { output: text, note: `${bytes.length} bytes decoded` };
            },
        },
    };
}

function toHexTool(codec) {
    return {
        id: `${codec.slug}-to-hex`,
        name: `${codec.label} to HEX`,
        description: `Convert ${codec.label} directly into hexadecimal.`,
        category: 'encoding',
        icon: `${codec.icon}x`,
        keywords: [codec.slug, 'hex', 'hexadecimal', 'convert'],
        spec: {
            lede: `Decodes ${codec.label} to raw bytes and re-renders them as hex — no text interpretation in between.`,
            input: {
                label: codec.label,
                placeholder: codec.encode(utf8ToBytes(SAMPLE_TEXT), { pad: true }),
                sample: codec.encode(utf8ToBytes(SAMPLE_TEXT), { pad: true }),
            },
            output: { label: 'Hexadecimal', filename: 'converted.hex' },
            options: [
                { id: 'separator', type: 'select', label: 'Separator', default: '',
                  choices: [{ value: '', label: 'None' }, { value: ' ', label: 'Space' }, { value: ':', label: 'Colon' }] },
                { id: 'upper', type: 'checkbox', label: 'Uppercase', default: false },
            ],
            run: ({ input, options }) => bytesToHex(codec.decode(input.trim()), {
                separator: options.separator, upper: options.upper,
            }),
        },
    };
}

function fromHexTool(codec) {
    return {
        id: `hex-to-${codec.slug}`,
        name: `HEX to ${codec.label}`,
        description: `Convert hexadecimal bytes into ${codec.label}.`,
        category: 'encoding',
        icon: `x${codec.icon}`,
        keywords: ['hex', 'hexadecimal', codec.slug, 'convert'],
        spec: {
            lede: `Parses hex into raw bytes and encodes them as ${codec.label}. Separators and 0x prefixes are tolerated.`,
            input: {
                label: 'Hexadecimal',
                placeholder: bytesToHex(utf8ToBytes(SAMPLE_TEXT)),
                sample: bytesToHex(utf8ToBytes(SAMPLE_TEXT), { separator: ' ' }),
            },
            output: { label: codec.label, filename: `converted.${codec.slug}.txt` },
            options: codec.options,
            run: ({ input, options }) => codec.encode(hexToBytes(input), options),
        },
    };
}

export const encodingTools = [
    ...Object.values(CODECS).flatMap((codec) => [
        encoderTool(codec),
        decoderTool(codec),
        toHexTool(codec),
        fromHexTool(codec),
    ]),

    {
        id: 'base64-file',
        name: 'File to Base64',
        description: 'Encode any file as a Base64 string or a ready-to-use data URI.',
        category: 'encoding',
        icon: '📄',
        keywords: ['base64', 'file', 'data uri', 'encode', 'upload', 'binary', 'image'],
        spec: {
            lede: 'Pick a file with the File button. Everything stays in your browser — nothing is uploaded.',
            input: {
                label: 'File',
                accept: '*/*',
                binary: true,
                placeholder: 'Use the File button above to choose a file…',
            },
            output: { label: 'Base64', filename: 'encoded.txt' },
            live: false,
            actionLabel: 'Encode',
            options: [
                { id: 'dataUri', type: 'checkbox', label: 'Wrap as data: URI', default: true },
                { id: 'wrap', type: 'number', label: 'Wrap at column (0 = one line)', default: 0, min: 0, max: 200 },
            ],
            run: ({ bytes, fileName, options }) => {
                if (!bytes) throw new Error('Choose a file first using the File button');

                let base64 = bytesToBase64(bytes);
                const extension = (fileName.split('.').pop() || '').toLowerCase();
                const mimeTypes = {
                    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
                    webp: 'image/webp', svg: 'image/svg+xml', ico: 'image/x-icon', avif: 'image/avif',
                    pdf: 'application/pdf', json: 'application/json', txt: 'text/plain',
                    csv: 'text/csv', woff: 'font/woff', woff2: 'font/woff2', mp3: 'audio/mpeg', mp4: 'video/mp4',
                };
                const mime = mimeTypes[extension] || 'application/octet-stream';

                if (options.dataUri) base64 = `data:${mime};base64,${base64}`;
                if (options.wrap > 0) base64 = base64.replace(new RegExp(`(.{${options.wrap}})`, 'g'), '$1\n');

                const isImage = mime.startsWith('image/');
                return {
                    output: base64,
                    note: `${fileName} · ${bytes.length.toLocaleString()} bytes · ${mime}`,
                    filename: `${fileName}.base64.txt`,
                    extraHtml: isImage && options.dataUri ? `
                        <div class="tool-section" style="margin-top:1.5rem;">
                            <h3>Preview</h3>
                            <div class="output-section" style="text-align:center;">
                                <img src="${base64.replace(/\n/g, '')}" alt="Preview of the encoded file"
                                     style="max-width:100%;max-height:320px;border-radius:12px;">
                            </div>
                        </div>` : '',
                };
            },
        },
    },

    {
        id: 'base64-to-file',
        name: 'Base64 to File',
        description: 'Decode a Base64 string or data URI back into a downloadable file.',
        category: 'encoding',
        icon: '📥',
        keywords: ['base64', 'decode', 'file', 'download', 'data uri', 'image'],
        spec: {
            lede: 'Paste Base64 or a full data: URI. Images are previewed; anything else can be saved straight to disk.',
            input: {
                label: 'Base64 or data URI',
                placeholder: 'data:image/png;base64,iVBORw0…',
                // A real 1x1 transparent PNG, so Sample produces a working decode.
                sample: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
            },
            output: { label: 'Details', filename: 'decoded.txt' },
            live: false,
            actionLabel: 'Decode',
            run: ({ input, tool }) => {
                const trimmed = input.trim().replace(/\s+/g, '');
                if (!trimmed) return '';

                const dataUri = /^data:([^;,]*)(;base64)?,(.*)$/s.exec(trimmed);
                const mime = dataUri?.[1] || 'application/octet-stream';
                const payload = dataUri ? dataUri[3] : trimmed;

                const bytes = base64ToBytes(payload);
                const blob = new Blob([bytes], { type: mime });
                const url = URL.createObjectURL(blob);

                const extensions = {
                    'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp',
                    'image/svg+xml': 'svg', 'application/pdf': 'pdf', 'application/json': 'json',
                    'text/plain': 'txt', 'text/csv': 'csv',
                };
                const filename = `decoded.${extensions[mime] || 'bin'}`;

                // Sniff the real type from magic bytes when no data URI told us.
                const signature = [...bytes.slice(0, 8)].map((b) => b.toString(16).padStart(2, '0')).join('');
                const sniffed = signature.startsWith('89504e47') ? 'PNG image'
                    : signature.startsWith('ffd8ff') ? 'JPEG image'
                    : signature.startsWith('47494638') ? 'GIF image'
                    : signature.startsWith('25504446') ? 'PDF document'
                    : signature.startsWith('504b0304') ? 'ZIP archive (or xlsx/docx)'
                    : signature.startsWith('1f8b') ? 'GZIP archive'
                    : null;

                const details = [
                    `Size:          ${bytes.length.toLocaleString()} bytes`,
                    `Declared type: ${dataUri ? mime : '(none — plain base64)'}`,
                    sniffed ? `Detected type: ${sniffed}` : null,
                    `First bytes:   ${signature.replace(/(..)/g, '$1 ').trim()}`,
                ].filter(Boolean).join('\n');

                const isImage = mime.startsWith('image/') || (sniffed || '').includes('image');

                setTimeout(() => {
                    document.getElementById(tool.id_('sbDownload'))?.addEventListener('click', () => {
                        const link = document.createElement('a');
                        link.href = url;
                        link.download = filename;
                        link.click();
                    });
                }, 0);

                return {
                    output: details,
                    note: `${bytes.length.toLocaleString()} bytes`,
                    extraHtml: `
                        <div class="tool-section" style="margin-top:1.5rem;">
                            ${isImage ? `
                                <h3>Preview</h3>
                                <div class="output-section" style="text-align:center;margin-bottom:1rem;">
                                    <img src="${url}" alt="Decoded image"
                                         style="max-width:100%;max-height:340px;border-radius:12px;">
                                </div>` : ''}
                            <button class="action-btn" id="${tool.id_('sbDownload')}">Download ${filename}</button>
                        </div>`,
                };
            },
        },
    },
];
