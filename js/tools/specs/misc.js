// Timestamps, cron, regex, colour and client/network information.

const escapeHtml = (value) => String(value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

// ------------------------------------------------------------------ cron --

const CRON_NAMES = {
    month: { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 },
    dow: { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 },
};
const DOW_LABELS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTH_LABELS = ['', 'January', 'February', 'March', 'April', 'May', 'June', 'July',
    'August', 'September', 'October', 'November', 'December'];

/** Expand one cron field into the set of values it matches. */
function parseCronField(raw, min, max, names, fieldName) {
    const field = raw.trim().toLowerCase();
    if (field === '*' || field === '?') return { values: null, wildcard: true };

    if (/[lw#]/.test(field)) {
        throw new Error(`The ${fieldName} field uses "${raw}" — L, W and # are Quartz extensions that standard cron does not support`);
    }

    const values = new Set();
    for (const part of field.split(',')) {
        const [range, stepText] = part.split('/');
        const step = stepText === undefined ? 1 : Number(stepText);
        if (!Number.isInteger(step) || step < 1) {
            throw new Error(`Invalid step "/${stepText}" in the ${fieldName} field`);
        }

        const resolve = (token) => {
            if (names && names[token] !== undefined) return names[token];
            const number = Number(token);
            if (!Number.isInteger(number)) throw new Error(`"${token}" is not valid in the ${fieldName} field`);
            return number;
        };

        let from;
        let to;
        if (range === '*') { from = min; to = max; }
        else if (range.includes('-')) {
            const [a, b] = range.split('-');
            from = resolve(a);
            to = resolve(b);
        } else {
            from = resolve(range);
            to = stepText === undefined ? from : max;
        }

        if (from < min || to > max || from > to) {
            throw new Error(`"${part}" is out of range for the ${fieldName} field (${min}-${max})`);
        }
        for (let value = from; value <= to; value += step) values.add(value);
    }

    return { values, wildcard: false };
}

function parseCron(expression) {
    const parts = expression.trim().split(/\s+/);
    if (parts.length < 5 || parts.length > 6) {
        throw new Error(`Expected 5 fields (minute hour day-of-month month day-of-week), or 6 with a leading seconds field. Got ${parts.length}.`);
    }

    const hasSeconds = parts.length === 6;
    const [second, minute, hour, dom, month, dow] = hasSeconds
        ? parts
        : ['0', ...parts];

    return {
        hasSeconds,
        second: parseCronField(second, 0, 59, null, 'second'),
        minute: parseCronField(minute, 0, 59, null, 'minute'),
        hour: parseCronField(hour, 0, 23, null, 'hour'),
        dom: parseCronField(dom, 1, 31, null, 'day-of-month'),
        month: parseCronField(month, 1, 12, CRON_NAMES.month, 'month'),
        dow: parseCronField(dow.replace(/\b7\b/, '0'), 0, 6, CRON_NAMES.dow, 'day-of-week'),
    };
}

const matches = (field, value) => field.wildcard || field.values.has(value);

function nextCronRuns(cron, count, useUtc) {
    const runs = [];
    const cursor = new Date();
    cursor.setSeconds(0, 0);
    cursor.setMinutes(cursor.getMinutes() + 1);

    const get = {
        minute: (d) => (useUtc ? d.getUTCMinutes() : d.getMinutes()),
        hour: (d) => (useUtc ? d.getUTCHours() : d.getHours()),
        dom: (d) => (useUtc ? d.getUTCDate() : d.getDate()),
        month: (d) => (useUtc ? d.getUTCMonth() + 1 : d.getMonth() + 1),
        dow: (d) => (useUtc ? d.getUTCDay() : d.getDay()),
    };

    // Four years of minutes is enough to find any schedule that can ever fire.
    const limit = 366 * 4 * 24 * 60;
    for (let i = 0; i < limit && runs.length < count; i++) {
        const dayMatches = cron.dom.wildcard && cron.dow.wildcard
            ? true
            : cron.dom.wildcard ? matches(cron.dow, get.dow(cursor))
            : cron.dow.wildcard ? matches(cron.dom, get.dom(cursor))
            // Vixie cron: when both are restricted, either matching is enough.
            : matches(cron.dom, get.dom(cursor)) || matches(cron.dow, get.dow(cursor));

        if (dayMatches
            && matches(cron.month, get.month(cursor))
            && matches(cron.hour, get.hour(cursor))
            && matches(cron.minute, get.minute(cursor))) {
            runs.push(new Date(cursor));
        }
        cursor.setMinutes(cursor.getMinutes() + 1);
    }

    return runs;
}

function describeCron(cron) {
    const list = (field, labels, singular) => {
        if (field.wildcard) return `every ${singular}`;
        const values = [...field.values].sort((a, b) => a - b);

        // detect a simple step pattern
        if (values.length > 2) {
            const step = values[1] - values[0];
            const isEven = values.every((v, i) => i === 0 || v - values[i - 1] === step);
            if (isEven && step > 1) return `every ${step} ${singular}s`;
        }
        if (values.length > 6) return `${values.length} selected ${singular}s`;
        return values.map((v) => (labels ? labels[v] : v)).join(', ');
    };

    const time = cron.hour.wildcard && cron.minute.wildcard
        ? 'every minute'
        : cron.hour.wildcard
            ? `at minute ${list(cron.minute, null, 'minute')} of every hour`
            : cron.minute.wildcard
                ? `every minute during hour ${list(cron.hour, null, 'hour')}`
                : `at ${[...cron.hour.values].sort((a, b) => a - b).map((h) => [...cron.minute.values].sort((a, b) => a - b)
                    .map((m) => `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`).join(', ')).join(', ')}`;

    const day = cron.dom.wildcard && cron.dow.wildcard
        ? 'every day'
        : !cron.dow.wildcard && cron.dom.wildcard
            ? `on ${list(cron.dow, DOW_LABELS, 'weekday')}`
            : !cron.dom.wildcard && cron.dow.wildcard
                ? `on day ${list(cron.dom, null, 'day')} of the month`
                : `on day ${list(cron.dom, null, 'day')} of the month, or on ${list(cron.dow, DOW_LABELS, 'weekday')}`;

    const month = cron.month.wildcard ? 'every month' : `in ${list(cron.month, MONTH_LABELS, 'month')}`;

    return `Runs ${time}, ${day}, ${month}.`;
}

// ---------------------------------------------------------------- colour --

function parseColor(text) {
    const input = text.trim().toLowerCase();

    let match = /^#?([0-9a-f]{3,8})$/i.exec(input);
    if (match) {
        let hex = match[1];
        if (hex.length === 3) hex = [...hex].map((c) => c + c).join('');
        else if (hex.length === 4) hex = [...hex].map((c) => c + c).join('');
        if (hex.length === 6 || hex.length === 8) {
            return {
                r: parseInt(hex.slice(0, 2), 16),
                g: parseInt(hex.slice(2, 4), 16),
                b: parseInt(hex.slice(4, 6), 16),
                a: hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1,
            };
        }
    }

    match = /^rgba?\(([^)]+)\)$/.exec(input);
    if (match) {
        const parts = match[1].split(/[,\s/]+/).filter(Boolean);
        const channel = (value) => (value.endsWith('%') ? Math.round(parseFloat(value) * 2.55) : Math.round(parseFloat(value)));
        return {
            r: channel(parts[0]), g: channel(parts[1]), b: channel(parts[2]),
            a: parts[3] === undefined ? 1 : (parts[3].endsWith('%') ? parseFloat(parts[3]) / 100 : parseFloat(parts[3])),
        };
    }

    match = /^hsla?\(([^)]+)\)$/.exec(input);
    if (match) {
        const parts = match[1].split(/[,\s/]+/).filter(Boolean);
        const h = ((parseFloat(parts[0]) % 360) + 360) % 360;
        const s = parseFloat(parts[1]) / 100;
        const l = parseFloat(parts[2]) / 100;
        const a = parts[3] === undefined ? 1 : (parts[3].endsWith('%') ? parseFloat(parts[3]) / 100 : parseFloat(parts[3]));

        const c = (1 - Math.abs(2 * l - 1)) * s;
        const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
        const m = l - c / 2;
        const [r1, g1, b1] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x]
            : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
        return { r: Math.round((r1 + m) * 255), g: Math.round((g1 + m) * 255), b: Math.round((b1 + m) * 255), a };
    }

    // named colours — let the browser resolve them
    const probe = document.createElement('span');
    probe.style.color = '';
    probe.style.color = input;
    if (probe.style.color) {
        document.body.appendChild(probe);
        const computed = getComputedStyle(probe).color;
        probe.remove();
        const rgb = /rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/.exec(computed);
        if (rgb) {
            return { r: +rgb[1], g: +rgb[2], b: +rgb[3], a: rgb[4] === undefined ? 1 : +rgb[4] };
        }
    }

    throw new Error(`Could not read "${text}" as a colour. Try #3b82f6, rgb(59 130 246), hsl(217 91% 60%) or a CSS colour name.`);
}

function colorFormats({ r, g, b, a }) {
    const hex = (value) => Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, '0');
    const [rn, gn, bn] = [r / 255, g / 255, b / 255];
    const max = Math.max(rn, gn, bn);
    const min = Math.min(rn, gn, bn);
    const delta = max - min;

    let h = 0;
    if (delta) {
        if (max === rn) h = ((gn - bn) / delta) % 6;
        else if (max === gn) h = (bn - rn) / delta + 2;
        else h = (rn - gn) / delta + 4;
        h = Math.round(h * 60);
        if (h < 0) h += 360;
    }
    const l = (max + min) / 2;
    const s = delta === 0 ? 0 : delta / (1 - Math.abs(2 * l - 1));
    const v = max;
    const sv = max === 0 ? 0 : delta / max;

    const k = 1 - max;
    const cmyk = max === 0 ? [0, 0, 0, 100] : [
        Math.round(((1 - rn - k) / (1 - k)) * 100),
        Math.round(((1 - gn - k) / (1 - k)) * 100),
        Math.round(((1 - bn - k) / (1 - k)) * 100),
        Math.round(k * 100),
    ];

    // WCAG relative luminance
    const channel = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
    const luminance = 0.2126 * channel(rn) + 0.7152 * channel(gn) + 0.0722 * channel(bn);
    const contrastWhite = 1.05 / (luminance + 0.05);
    const contrastBlack = (luminance + 0.05) / 0.05;

    return {
        hex: `#${hex(r)}${hex(g)}${hex(b)}${a < 1 ? hex(a * 255) : ''}`,
        rgb: a < 1 ? `rgba(${r}, ${g}, ${b}, ${+a.toFixed(3)})` : `rgb(${r}, ${g}, ${b})`,
        rgbModern: `rgb(${r} ${g} ${b}${a < 1 ? ` / ${Math.round(a * 100)}%` : ''})`,
        hsl: a < 1
            ? `hsla(${h}, ${Math.round(s * 100)}%, ${Math.round(l * 100)}%, ${+a.toFixed(3)})`
            : `hsl(${h}, ${Math.round(s * 100)}%, ${Math.round(l * 100)}%)`,
        hsv: `hsv(${h}, ${Math.round(sv * 100)}%, ${Math.round(v * 100)}%)`,
        cmyk: `cmyk(${cmyk[0]}%, ${cmyk[1]}%, ${cmyk[2]}%, ${cmyk[3]}%)`,
        luminance,
        contrastWhite,
        contrastBlack,
    };
}

// --------------------------------------------------------------------------

export const miscTools = [
    {
        id: 'timestamp-converter',
        name: 'Timestamp Converter',
        description: 'Convert between Unix timestamps, ISO 8601 and human-readable dates.',
        category: 'time',
        icon: '🕐',
        keywords: ['timestamp', 'unix', 'epoch', 'date', 'time', 'iso', 'utc', 'convert', 'milliseconds'],
        spec: {
            lede: 'Paste a Unix timestamp (seconds, milliseconds, microseconds or nanoseconds) or any date string — the unit is detected automatically. Leave it empty for "now".',
            input: {
                label: 'Timestamp or date',
                placeholder: '1700000000  ·  2026-08-13T10:30:00Z  ·  now',
                sample: '1700000000',
            },
            output: { label: 'Conversions', filename: 'timestamp.txt' },
            options: [
                { id: 'timezone', type: 'select', label: 'Local zone display', default: 'local',
                  choices: [{ value: 'local', label: 'Your local timezone' }, { value: 'utc', label: 'UTC only' }] },
            ],
            run: ({ input, options }) => {
                const raw = input.trim();
                let date;
                let detected = '';

                if (!raw || raw.toLowerCase() === 'now') {
                    date = new Date();
                    detected = 'current time';
                } else if (/^-?\d+(\.\d+)?$/.test(raw)) {
                    const number = Number(raw);
                    const digits = raw.replace(/^-|\..*$/g, '').length;
                    if (digits >= 19) { date = new Date(number / 1e6); detected = 'nanoseconds'; }
                    else if (digits >= 16) { date = new Date(number / 1e3); detected = 'microseconds'; }
                    else if (digits >= 12) { date = new Date(number); detected = 'milliseconds'; }
                    else { date = new Date(number * 1000); detected = 'seconds'; }
                } else {
                    date = new Date(raw);
                    detected = 'date string';
                }

                if (Number.isNaN(date.getTime())) {
                    throw new Error(`Could not interpret "${raw}" as a timestamp or date`);
                }

                const ms = date.getTime();
                const now = Date.now();
                const diff = (ms - now) / 1000;
                const absolute = Math.abs(diff);
                const relative = absolute < 60 ? `${Math.round(absolute)} seconds`
                    : absolute < 3600 ? `${(absolute / 60).toFixed(1)} minutes`
                    : absolute < 86400 ? `${(absolute / 3600).toFixed(1)} hours`
                    : absolute < 31557600 ? `${(absolute / 86400).toFixed(1)} days`
                    : `${(absolute / 31557600).toFixed(2)} years`;

                const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
                const rows = [
                    ['Detected input', detected],
                    ['Unix (seconds)', Math.floor(ms / 1000)],
                    ['Unix (millis)', ms],
                    ['ISO 8601 (UTC)', date.toISOString()],
                    ['RFC 2822', date.toUTCString()],
                    ...(options.timezone === 'local' ? [
                        ['Local time', date.toLocaleString(undefined, { dateStyle: 'full', timeStyle: 'long' })],
                        ['Local zone', zone],
                    ] : []),
                    ['Relative', diff < 0 ? `${relative} ago` : `in ${relative}`],
                    ['Day of week', DOW_LABELS[date.getUTCDay()] + ' (UTC)'],
                    ['Day of year', Math.floor((date - Date.UTC(date.getUTCFullYear(), 0, 0)) / 86400000)],
                    ['Excel serial', (ms / 86400000 + 25569).toFixed(6)],
                ];

                const width = Math.max(...rows.map(([label]) => label.length));
                return {
                    output: rows.map(([label, value]) => `${(`${label}:`).padEnd(width + 2)}${value}`).join('\n'),
                    note: `read as ${detected}`,
                    extraHtml: `
                        <div class="stat-grid" style="margin-top:1.5rem;">
                            <div class="stat-tile"><div class="stat-label">Unix seconds</div><div class="stat-value" style="font-size:1.2rem">${Math.floor(ms / 1000)}</div></div>
                            <div class="stat-tile"><div class="stat-label">UTC</div><div class="stat-value" style="font-size:0.95rem">${date.toISOString().replace('T', ' ').replace('.000Z', 'Z')}</div></div>
                            <div class="stat-tile"><div class="stat-label">Relative</div><div class="stat-value" style="font-size:1.05rem">${diff < 0 ? `${relative} ago` : `in ${relative}`}</div></div>
                        </div>`,
                };
            },
        },
    },

    {
        id: 'cron-parser',
        name: 'Cron Expression Parser',
        description: 'Explain a cron schedule in plain English and list the next run times.',
        category: 'time',
        icon: '⏱',
        keywords: ['cron', 'crontab', 'schedule', 'expression', 'job', 'next run', 'kubernetes', 'quartz'],
        spec: {
            lede: 'Five fields (minute hour day-of-month month day-of-week), or six with a leading seconds field.',
            input: {
                label: 'Cron expression',
                placeholder: '*/15 * * * *',
                sample: '30 9 * * MON-FRI',
            },
            output: { label: 'Explanation', filename: 'cron.txt' },
            options: [
                { id: 'count', type: 'number', label: 'Next runs to show', default: 10, min: 1, max: 50 },
                { id: 'utc', type: 'checkbox', label: 'Evaluate in UTC', default: false },
            ],
            run: ({ input, options }) => {
                const cron = parseCron(input);
                const description = describeCron(cron);
                const runs = nextCronRuns(cron, Math.min(50, options.count), options.utc);

                if (!runs.length) {
                    throw new Error('This expression never fires — check for an impossible combination such as 30 February.');
                }

                const zone = options.utc ? 'UTC' : Intl.DateTimeFormat().resolvedOptions().timeZone;
                const fieldNames = cron.hasSeconds
                    ? ['second', 'minute', 'hour', 'day-of-month', 'month', 'day-of-week']
                    : ['minute', 'hour', 'day-of-month', 'month', 'day-of-week'];
                const rawFields = input.trim().split(/\s+/);

                const text = [
                    description,
                    '',
                    'Fields',
                    ...fieldNames.map((name, i) => `  ${name.padEnd(14)} ${rawFields[i]}`),
                    '',
                    `Next ${runs.length} runs (${zone})`,
                    ...runs.map((run) => `  ${options.utc
                        ? run.toISOString().replace('T', ' ').slice(0, 19)
                        : run.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}`),
                ].join('\n');

                const gaps = runs.slice(1).map((run, i) => run - runs[i]);
                const interval = gaps.length && gaps.every((g) => g === gaps[0])
                    ? `every ${gaps[0] / 60000} minutes`
                    : 'irregular';

                return {
                    output: text,
                    note: description,
                    extraHtml: `
                        <div class="tool-section" style="margin-top:1.5rem;">
                            <div class="alert ok"><span>✓</span><span>${escapeHtml(description)}</span></div>
                            <div class="stat-grid">
                                <div class="stat-tile"><div class="stat-label">Next run</div>
                                    <div class="stat-value" style="font-size:1.05rem">${escapeHtml(options.utc
                                        ? runs[0].toISOString().replace('T', ' ').slice(0, 19)
                                        : runs[0].toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }))}</div>
                                    <div class="stat-sub">${escapeHtml(zone)}</div></div>
                                <div class="stat-tile"><div class="stat-label">Cadence</div>
                                    <div class="stat-value" style="font-size:1.05rem">${interval}</div></div>
                            </div>
                            <div class="table-wrap" style="max-height:300px;">
                                <table class="data">
                                    <thead><tr><th style="width:60px">#</th><th>Run time (${escapeHtml(zone)})</th></tr></thead>
                                    <tbody>${runs.map((run, i) => `<tr><td class="num">${i + 1}</td><td>${escapeHtml(options.utc
                                        ? run.toISOString().replace('T', ' ').slice(0, 19)
                                        : run.toLocaleString(undefined, { dateStyle: 'full', timeStyle: 'short' }))}</td></tr>`).join('')}</tbody>
                                </table>
                            </div>
                        </div>`,
                };
            },
            footnote: 'When both day-of-month and day-of-week are restricted, standard cron fires if <strong>either</strong> matches — a common source of surprise. Quartz extensions (L, W, #) are not supported here.',
        },
    },

    {
        id: 'regex-tester',
        name: 'Regex Tester',
        description: 'Test a regular expression against sample text and inspect every match and group.',
        category: 'text',
        icon: '.*',
        keywords: ['regex', 'regexp', 'regular expression', 'match', 'pattern', 'test', 'capture', 'group'],
        spec: {
            lede: 'Uses the browser\'s own JavaScript regex engine, so what you see here is what your code will do.',
            input: {
                label: 'Test text',
                placeholder: 'The text to search…',
                sample: 'Contact ada@example.com or grace@navy.mil.\nBackup: hopper+test@example.co.uk',
            },
            output: { label: 'Matches', filename: 'regex-matches.txt' },
            options: [
                { id: 'pattern', type: 'text', label: 'Pattern', default: '[\\w.+-]+@[\\w-]+\\.[\\w.]+', placeholder: '\\d+' },
                { id: 'flags', type: 'text', label: 'Flags', default: 'g', placeholder: 'gimsuy' },
                { id: 'replace', type: 'text', label: 'Replacement (optional)', placeholder: '$& or $1' },
            ],
            run: ({ input, options }) => {
                if (!options.pattern) return '';

                let regex;
                try {
                    regex = new RegExp(options.pattern, options.flags.includes('g') ? options.flags : `${options.flags}g`);
                } catch (err) {
                    throw new Error(`Invalid pattern: ${err.message}`);
                }

                const found = [...input.matchAll(regex)];
                const lines = found.map((match, i) => {
                    const groups = match.slice(1).map((g, gi) => `      group ${gi + 1}: ${g === undefined ? '(no match)' : g}`);
                    const named = match.groups
                        ? Object.entries(match.groups).map(([name, value]) => `      <${name}>: ${value ?? '(no match)'}`)
                        : [];
                    return [`  [${i}] at index ${match.index}: ${match[0]}`, ...groups, ...named].join('\n');
                });

                let replaced = null;
                if (options.replace) {
                    try {
                        replaced = input.replace(new RegExp(options.pattern, options.flags), options.replace);
                    } catch (err) {
                        throw new Error(`Replacement failed: ${err.message}`);
                    }
                }

                // Highlighted preview
                let highlighted = '';
                let cursor = 0;
                for (const match of found) {
                    highlighted += escapeHtml(input.slice(cursor, match.index));
                    highlighted += `<mark style="background:var(--marker);color:var(--ink);border-radius:3px;padding:0 2px">${escapeHtml(match[0])}</mark>`;
                    cursor = match.index + match[0].length;
                }
                highlighted += escapeHtml(input.slice(cursor));

                const text = found.length
                    ? [`${found.length} match${found.length === 1 ? '' : 'es'}`, '', ...lines,
                       ...(replaced !== null ? ['', '── AFTER REPLACEMENT ──', replaced] : [])].join('\n')
                    : 'No matches.';

                return {
                    output: text,
                    note: `${found.length} match${found.length === 1 ? '' : 'es'}`,
                    extraHtml: `
                        <div class="tool-section" style="margin-top:1.5rem;">
                            <h3>Highlighted</h3>
                            <div class="output-section"><pre style="white-space:pre-wrap">${highlighted}</pre></div>
                        </div>`,
                };
            },
        },
    },

    {
        id: 'color-converter',
        name: 'Colour Converter',
        description: 'Convert between HEX, RGB, HSL, HSV and CMYK with contrast checking.',
        category: 'image',
        icon: '🎨',
        keywords: ['color', 'colour', 'hex', 'rgb', 'hsl', 'hsv', 'cmyk', 'convert', 'contrast', 'wcag', 'accessibility'],
        spec: {
            lede: 'Accepts hex, rgb(), hsl() and CSS colour names. Also reports WCAG contrast against black and white.',
            input: { label: 'Colour', placeholder: '#3b82f6', sample: '#3b82f6' },
            output: { label: 'Formats', filename: 'color.txt' },
            run: ({ input }) => {
                const rgba = parseColor(input);
                const formats = colorFormats(rgba);

                const grade = (ratio) => (ratio >= 7 ? 'AAA' : ratio >= 4.5 ? 'AA' : ratio >= 3 ? 'AA Large' : 'Fail');

                const rows = [
                    ['HEX', formats.hex],
                    ['RGB', formats.rgb],
                    ['RGB (modern)', formats.rgbModern],
                    ['HSL', formats.hsl],
                    ['HSV', formats.hsv],
                    ['CMYK', formats.cmyk],
                    ['Luminance', formats.luminance.toFixed(4)],
                    ['vs white', `${formats.contrastWhite.toFixed(2)}:1 (${grade(formats.contrastWhite)})`],
                    ['vs black', `${formats.contrastBlack.toFixed(2)}:1 (${grade(formats.contrastBlack)})`],
                ];

                const width = Math.max(...rows.map(([label]) => label.length));
                const swatch = `rgb(${rgba.r} ${rgba.g} ${rgba.b})`;

                const copyRows = [
                    ['HEX', formats.hex], ['RGB', formats.rgb], ['RGB (modern)', formats.rgbModern],
                    ['HSL', formats.hsl], ['HSV', formats.hsv], ['CMYK', formats.cmyk],
                ];

                return {
                    output: rows.map(([label, value]) => `${(`${label}:`).padEnd(width + 2)}${value}`).join('\n'),
                    note: formats.hex,
                    extraHtml: `
                        <div class="tool-section" style="margin-top:1.5rem;">
                            <div class="table-wrap" style="margin-bottom:1rem;">
                                <table class="data">
                                    <tbody>
                                        ${copyRows.map(([label, value]) => `
                                            <tr>
                                                <td style="width:150px"><strong>${label}</strong></td>
                                                <td style="max-width:none">
                                                    <span class="copy-cell">
                                                        <span>${escapeHtml(value)}</span>
                                                        <button class="copy-chip" data-copy="${escapeHtml(value)}" data-copy-label="${label} copied">Copy</button>
                                                    </span>
                                                </td>
                                            </tr>`).join('')}
                                    </tbody>
                                </table>
                            </div>
                            <div style="display:flex;gap:1rem;flex-wrap:wrap;align-items:stretch;">
                                <div style="flex:1 1 200px;min-height:120px;border-radius:var(--r-lg);background:${swatch};border:2px solid var(--line);"></div>
                                <div style="flex:1 1 140px;min-height:120px;border-radius:var(--r-lg);background:${swatch};border:2px solid var(--line);display:flex;align-items:center;justify-content:center;color:#fff;font-weight:800;">
                                    White ${formats.contrastWhite.toFixed(1)}:1
                                </div>
                                <div style="flex:1 1 140px;min-height:120px;border-radius:var(--r-lg);background:${swatch};border:2px solid var(--line);display:flex;align-items:center;justify-content:center;color:#000;font-weight:800;">
                                    Black ${formats.contrastBlack.toFixed(1)}:1
                                </div>
                            </div>
                        </div>`,
                };
            },
            footnote: 'WCAG 2.1 requires 4.5:1 for normal body text and 3:1 for large text (18pt+, or 14pt bold). AAA raises those to 7:1 and 4.5:1.',
        },
    },

    {
        id: 'user-agent-parser',
        name: 'My User Agent',
        description: 'Inspect your browser, platform, screen and locale — all read locally.',
        category: 'network',
        icon: '🖥',
        keywords: ['user agent', 'useragent', 'browser', 'platform', 'device', 'screen', 'client', 'headers'],
        spec: {
            lede: 'Everything here is read from your own browser. No request is made to any server.',
            layout: 'output',
            actionLabel: 'Refresh',
            output: { label: 'Client details', filename: 'user-agent.txt' },
            run: () => {
                const ua = navigator.userAgent;

                const browser = (() => {
                    const tests = [
                        [/Edg\/([\d.]+)/, 'Edge'],
                        [/OPR\/([\d.]+)/, 'Opera'],
                        [/Firefox\/([\d.]+)/, 'Firefox'],
                        [/Chrome\/([\d.]+)/, 'Chrome'],
                        [/Version\/([\d.]+).*Safari/, 'Safari'],
                    ];
                    for (const [pattern, name] of tests) {
                        const match = pattern.exec(ua);
                        if (match) return `${name} ${match[1]}`;
                    }
                    return 'Unknown';
                })();

                const os = (() => {
                    if (/Windows NT 10/.test(ua)) return 'Windows 10 or 11';
                    if (/Windows NT ([\d.]+)/.test(ua)) return `Windows NT ${/Windows NT ([\d.]+)/.exec(ua)[1]}`;
                    if (/Mac OS X ([\d_]+)/.test(ua)) return `macOS ${/Mac OS X ([\d_]+)/.exec(ua)[1].replace(/_/g, '.')}`;
                    if (/Android ([\d.]+)/.test(ua)) return `Android ${/Android ([\d.]+)/.exec(ua)[1]}`;
                    if (/iPhone OS ([\d_]+)/.test(ua)) return `iOS ${/iPhone OS ([\d_]+)/.exec(ua)[1].replace(/_/g, '.')}`;
                    if (/Linux/.test(ua)) return 'Linux';
                    return 'Unknown';
                })();

                const rows = [
                    ['User agent', ua],
                    ['Browser', browser],
                    ['Operating system', os],
                    ['Platform', navigator.platform || '(not exposed)'],
                    ['Languages', (navigator.languages || [navigator.language]).join(', ')],
                    ['Timezone', Intl.DateTimeFormat().resolvedOptions().timeZone],
                    ['Screen', `${screen.width} × ${screen.height} @ ${window.devicePixelRatio}x`],
                    ['Viewport', `${window.innerWidth} × ${window.innerHeight}`],
                    ['Colour depth', `${screen.colorDepth}-bit`],
                    ['CPU cores', navigator.hardwareConcurrency ?? '(not exposed)'],
                    ['Device memory', navigator.deviceMemory ? `${navigator.deviceMemory} GB (approx)` : '(not exposed)'],
                    ['Touch points', navigator.maxTouchPoints ?? 0],
                    ['Cookies enabled', navigator.cookieEnabled ? 'yes' : 'no'],
                    ['Do Not Track', navigator.doNotTrack ?? '(not set)'],
                    ['Online', navigator.onLine ? 'yes' : 'no'],
                    ['Prefers dark', window.matchMedia('(prefers-color-scheme: dark)').matches ? 'yes' : 'no'],
                    ['Reduced motion', window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'yes' : 'no'],
                ];

                const width = Math.max(...rows.map(([label]) => label.length));
                return {
                    output: rows.map(([label, value]) => `${(`${label}:`).padEnd(width + 2)}${value}`).join('\n'),
                    note: browser,
                };
            },
        },
    },

    {
        id: 'my-ip',
        name: 'My IP Address',
        description: 'Look up your public IP address and the network it belongs to.',
        category: 'network',
        icon: '🌐',
        keywords: ['ip', 'address', 'public ip', 'network', 'isp', 'geolocation', 'whois'],
        spec: {
            lede: 'Your public IP is only visible to an outside server, so this one tool has to make a network request. Nothing happens until you press the button.',
            layout: 'output',
            actionLabel: 'Look up my IP',
            autoRun: false,
            output: { label: 'Result', filename: 'my-ip.txt' },
            run: async () => {
                const endpoint = 'https://ipapi.co/json/';
                let data;
                try {
                    const response = await fetch(endpoint, { headers: { Accept: 'application/json' } });
                    if (!response.ok) throw new Error(`HTTP ${response.status}`);
                    data = await response.json();
                } catch (err) {
                    throw new Error(
                        `Could not reach ${new URL(endpoint).hostname} (${err.message}). `
                        + 'A corporate proxy, VPN or ad-blocker will often block this.',
                    );
                }

                if (data.error) throw new Error(data.reason || 'The lookup service returned an error');

                const rows = [
                    ['IP address', data.ip],
                    ['Version', data.version],
                    ['City', data.city],
                    ['Region', data.region],
                    ['Country', `${data.country_name} (${data.country_code})`],
                    ['Postal code', data.postal],
                    ['Timezone', data.timezone],
                    ['Organisation', data.org],
                    ['ASN', data.asn],
                ].filter(([, value]) => value);

                const width = Math.max(...rows.map(([label]) => label.length));
                return {
                    output: rows.map(([label, value]) => `${(`${label}:`).padEnd(width + 2)}${value}`).join('\n'),
                    note: data.ip,
                    extraHtml: `
                        <div class="stat-grid" style="margin-top:1.5rem;">
                            <div class="stat-tile"><div class="stat-label">Public IP</div><div class="stat-value" style="font-size:1.3rem">${escapeHtml(data.ip || '')}</div></div>
                            <div class="stat-tile"><div class="stat-label">Location</div><div class="stat-value" style="font-size:1.05rem">${escapeHtml([data.city, data.country_code].filter(Boolean).join(', '))}</div></div>
                            <div class="stat-tile"><div class="stat-label">Network</div><div class="stat-value" style="font-size:0.95rem">${escapeHtml(data.org || '')}</div></div>
                        </div>`,
                };
            },
            footnote: 'This is the only tool on the site that sends anything off your machine. It queries <code>ipapi.co</code>, which necessarily sees your IP address in order to report it back. Geolocation from an IP is approximate and often wrong by tens of kilometres — it reflects your ISP, not your device.',
        },
    },
];

export { parseCron, describeCron, nextCronRuns, parseColor, colorFormats };
