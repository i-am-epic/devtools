// QR code generation and reading. Both run entirely in the browser.
import { libs } from '../../lib/loader.js';

const escapeHtml = (value) => String(value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

export const qrTools = [
    {
        id: 'qr-generator',
        name: 'QR Code Generator',
        description: 'Turn text, a URL, wifi credentials or a vCard into a downloadable QR code.',
        category: 'image',
        icon: '▦',
        keywords: ['qr', 'qrcode', 'barcode', 'generate', 'url', 'wifi', 'vcard', 'png', 'svg'],
        spec: {
            lede: 'Generated locally — the content never leaves your browser. Download as PNG or SVG.',
            input: {
                label: 'Content',
                placeholder: 'https://example.com',
                sample: 'https://github.com/i-am-epic/devtools',
            },
            output: { label: 'SVG source', filename: 'qrcode.svg' },
            options: [
                { id: 'level', type: 'select', label: 'Error correction', default: 'M',
                  choices: [
                      { value: 'L', label: 'L — recovers ~7%' },
                      { value: 'M', label: 'M — recovers ~15%' },
                      { value: 'Q', label: 'Q — recovers ~25%' },
                      { value: 'H', label: 'H — recovers ~30%' },
                  ],
                  hint: 'Higher correction survives damage but needs a denser code.' },
                { id: 'size', type: 'number', label: 'Module size (px)', default: 8, min: 2, max: 24 },
                { id: 'margin', type: 'number', label: 'Quiet zone (modules)', default: 4, min: 0, max: 10 },
                { id: 'dark', type: 'text', label: 'Foreground', default: '#1a1f2b' },
                { id: 'light', type: 'text', label: 'Background', default: '#ffffff' },
            ],
            run: async ({ input, options, tool }) => {
                const qrcode = await libs.qrcode();

                let qr;
                try {
                    qr = qrcode(0, options.level);   // 0 = pick the smallest version that fits
                    qr.addData(input);
                    qr.make();
                } catch (err) {
                    throw new Error(
                        /code length overflow/i.test(err.message)
                            ? `That is too much data for a QR code at error-correction level ${options.level}. Shorten it, or drop to level L.`
                            : err.message,
                    );
                }

                const count = qr.getModuleCount();
                const cell = options.size;
                const margin = options.margin;
                const dimension = (count + margin * 2) * cell;

                // Build an SVG by hand so it stays crisp at any size.
                let path = '';
                for (let row = 0; row < count; row++) {
                    for (let col = 0; col < count; col++) {
                        if (qr.isDark(row, col)) {
                            path += `M${(col + margin) * cell},${(row + margin) * cell}h${cell}v${cell}h-${cell}z`;
                        }
                    }
                }

                const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${dimension}" height="${dimension}" viewBox="0 0 ${dimension} ${dimension}" shape-rendering="crispEdges">`
                    + `<rect width="${dimension}" height="${dimension}" fill="${escapeHtml(options.light)}"/>`
                    + `<path d="${path}" fill="${escapeHtml(options.dark)}"/></svg>`;

                // Wire the PNG download once the extra HTML is in the DOM.
                setTimeout(() => {
                    document.getElementById(tool.id_('qrPng'))?.addEventListener('click', () => {
                        const canvas = document.createElement('canvas');
                        canvas.width = dimension;
                        canvas.height = dimension;
                        const context = canvas.getContext('2d');
                        const image = new Image();
                        image.onload = () => {
                            context.drawImage(image, 0, 0);
                            canvas.toBlob((blob) => {
                                const link = document.createElement('a');
                                link.href = URL.createObjectURL(blob);
                                link.download = 'qrcode.png';
                                link.click();
                                setTimeout(() => URL.revokeObjectURL(link.href), 1000);
                            }, 'image/png');
                        };
                        image.src = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg)))}`;
                    });
                }, 0);

                const capacity = { L: 2953, M: 2331, Q: 1663, H: 1273 }[options.level];

                return {
                    output: svg,
                    note: `version ${(count - 17) / 4} · ${count}×${count} modules · ${input.length} of ~${capacity} bytes used`,
                    extraHtml: `
                        <div class="tool-section" style="margin-top:1.5rem;">
                            <h3>Preview</h3>
                            <div class="output-section" style="display:flex;flex-direction:column;align-items:center;gap:1rem;">
                                <div style="max-width:280px;width:100%;">${svg.replace('width="' + dimension + '" height="' + dimension + '"', 'width="100%" height="auto"')}</div>
                                <button class="action-btn" id="${tool.id_('qrPng')}">Download PNG</button>
                            </div>
                        </div>`,
                };
            },
            footnote: 'Useful content formats — wifi: <code>WIFI:T:WPA;S:NetworkName;P:password;;</code> · phone: <code>tel:+441234567890</code> · email: <code>mailto:me@example.com?subject=Hi</code> · SMS: <code>SMSTO:+44123:message</code>',
        },
    },

    {
        id: 'qr-reader',
        name: 'QR Code Reader',
        description: 'Extract the text from a QR code image without uploading it anywhere.',
        category: 'image',
        icon: '▤',
        keywords: ['qr', 'qrcode', 'scan', 'read', 'decode', 'barcode', 'image'],
        spec: {
            lede: 'Choose a PNG, JPEG or WebP containing a QR code. Decoding happens locally in your browser.',
            input: {
                label: 'QR code image',
                accept: 'image/*',
                binary: true,
                placeholder: 'Use the File button above to choose an image…',
            },
            output: { label: 'Decoded content', filename: 'qr-content.txt' },
            live: false,
            actionLabel: 'Decode',
            run: async ({ bytes, fileName }) => {
                if (!bytes) throw new Error('Choose an image first using the File button');

                const jsQR = await libs.jsqr();
                const blob = new Blob([bytes]);
                const url = URL.createObjectURL(blob);

                try {
                    const image = await new Promise((resolve, reject) => {
                        const element = new Image();
                        element.onload = () => resolve(element);
                        element.onerror = () => reject(new Error('That file could not be read as an image'));
                        element.src = url;
                    });

                    const canvas = document.createElement('canvas');
                    canvas.width = image.naturalWidth;
                    canvas.height = image.naturalHeight;
                    const context = canvas.getContext('2d', { willReadFrequently: true });
                    context.drawImage(image, 0, 0);

                    const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
                    const result = jsQR(pixels.data, pixels.width, pixels.height, { inversionAttempts: 'attemptBoth' });

                    if (!result) {
                        throw new Error(
                            'No QR code found. Try a sharper or less cropped image — the code needs its full quiet-zone border and all three corner squares visible.',
                        );
                    }

                    // Recognise a few common content conventions.
                    const data = result.data;
                    let kind = 'Plain text';
                    if (/^https?:\/\//i.test(data)) kind = 'URL';
                    else if (/^WIFI:/i.test(data)) kind = 'Wifi credentials';
                    else if (/^BEGIN:VCARD/i.test(data)) kind = 'vCard contact';
                    else if (/^mailto:/i.test(data)) kind = 'Email address';
                    else if (/^tel:/i.test(data)) kind = 'Phone number';
                    else if (/^(SMSTO|smsto):/i.test(data)) kind = 'SMS';
                    else if (/^BEGIN:VEVENT/i.test(data)) kind = 'Calendar event';
                    else if (/^otpauth:/i.test(data)) kind = 'TOTP authenticator secret';

                    return {
                        output: data,
                        note: `${kind} · ${data.length} characters · from ${fileName}`,
                        extraHtml: `
                            <div class="tool-section" style="margin-top:1.5rem;">
                                <div class="alert ok"><span>✓</span><span>Decoded a QR code — detected content type: <strong>${kind}</strong></span></div>
                                ${kind === 'URL' ? `<div class="info-box">This code points at <code>${escapeHtml(data.slice(0, 200))}</code>. Check the domain before opening it — QR codes are a common phishing vector precisely because you cannot see where they lead.</div>` : ''}
                            </div>`,
                    };
                } finally {
                    URL.revokeObjectURL(url);
                }
            },
        },
    },
];
