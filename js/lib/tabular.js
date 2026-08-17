// CSV parsing / serialisation and column statistics, shared by the CSV, Excel
// and Parquet tools.

/**
 * RFC 4180 CSV parser. Handles quoted fields, embedded delimiters and
 * newlines, and doubled quotes as escapes.
 * @returns {string[][]} rows of raw string cells
 */
export function parseCsv(text, delimiter = ',') {
    const rows = [];
    let row = [];
    let field = '';
    let inQuotes = false;
    let i = 0;

    // strip a UTF-8 BOM
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);

    while (i < text.length) {
        const char = text[i];

        if (inQuotes) {
            if (char === '"') {
                if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
                inQuotes = false;
                i++;
                continue;
            }
            field += char;
            i++;
            continue;
        }

        if (char === '"' && field === '') { inQuotes = true; i++; continue; }
        if (char === delimiter) { row.push(field); field = ''; i++; continue; }
        if (char === '\r') { i++; continue; }
        if (char === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; continue; }

        field += char;
        i++;
    }

    if (inQuotes) throw new Error('Unterminated quoted field — a " was opened but never closed');
    if (field !== '' || row.length) { row.push(field); rows.push(row); }

    return rows;
}

/** Guess the delimiter by seeing which one yields the most consistent columns. */
export function sniffDelimiter(text) {
    const sample = text.split('\n').slice(0, 20).join('\n');
    const candidates = [',', ';', '\t', '|'];
    let best = ',';
    let bestScore = -1;

    for (const delimiter of candidates) {
        try {
            const rows = parseCsv(sample, delimiter).filter((r) => r.length > 0);
            if (rows.length < 1) continue;
            const widths = rows.map((r) => r.length);
            const first = widths[0];
            if (first < 2) continue;
            const consistent = widths.filter((w) => w === first).length / widths.length;
            const score = consistent * 100 + first;
            if (score > bestScore) { bestScore = score; best = delimiter; }
        } catch {
            /* delimiter produced unparseable text — skip it */
        }
    }
    return best;
}

export function toCsv(rows, delimiter = ',') {
    const cell = (value) => {
        if (value === null || value === undefined) return '';
        const text = typeof value === 'object' ? JSON.stringify(value) : String(value);
        return /["\n\r]|^\s|\s$/.test(text) || text.includes(delimiter)
            ? `"${text.replace(/"/g, '""')}"`
            : text;
    };
    return rows.map((row) => row.map(cell).join(delimiter)).join('\n');
}

/** Convert an array of objects into header + rows. */
export function objectsToRows(objects, columns) {
    const keys = columns || [...objects.reduce((set, obj) => {
        Object.keys(obj || {}).forEach((k) => set.add(k));
        return set;
    }, new Set())];
    return { keys, rows: objects.map((obj) => keys.map((key) => obj?.[key])) };
}

/** Best-effort scalar coercion for CSV cells. */
export function coerce(value) {
    if (typeof value !== 'string') return value;
    const trimmed = value.trim();
    if (trimmed === '') return null;
    if (trimmed === 'null' || trimmed === 'NULL') return null;
    if (trimmed === 'true' || trimmed === 'TRUE') return true;
    if (trimmed === 'false' || trimmed === 'FALSE') return false;
    if (/^-?\d+$/.test(trimmed)) {
        const asNumber = Number(trimmed);
        return Number.isSafeInteger(asNumber) ? asNumber : trimmed;
    }
    if (/^-?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(trimmed)) return Number(trimmed);
    return value;
}

const isNullish = (value) => value === null || value === undefined || value === '';

/**
 * Per-column statistics: type mix, null count, distinct count, numeric
 * min/max/mean, and the most frequent values.
 */
export function columnStats(values, declaredType = null) {
    const total = values.length;
    let nulls = 0;
    const types = new Map();
    const distinct = new Map();
    const numbers = [];
    let minLength = Infinity;
    let maxLength = 0;

    for (const value of values) {
        if (isNullish(value)) { nulls++; continue; }

        let type;
        if (typeof value === 'bigint') type = 'bigint';
        else if (typeof value === 'number') type = Number.isInteger(value) ? 'integer' : 'float';
        else if (typeof value === 'boolean') type = 'boolean';
        else if (value instanceof Date) type = 'date';
        else if (typeof value === 'object') type = 'object';
        else type = 'string';
        types.set(type, (types.get(type) || 0) + 1);

        if (type === 'integer' || type === 'float') numbers.push(value);
        else if (type === 'bigint') numbers.push(Number(value));

        const key = typeof value === 'object' && !(value instanceof Date)
            ? JSON.stringify(value)
            : String(value);
        if (distinct.size <= 10000) distinct.set(key, (distinct.get(key) || 0) + 1);
        minLength = Math.min(minLength, key.length);
        maxLength = Math.max(maxLength, key.length);
    }

    const stats = {
        count: total,
        nulls,
        nullPercent: total ? (nulls / total) * 100 : 0,
        nonNull: total - nulls,
        distinct: distinct.size,
        distinctCapped: distinct.size > 10000,
        type: declaredType || [...types.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || 'empty',
        typeMix: [...types.entries()].sort((a, b) => b[1] - a[1]),
        minLength: minLength === Infinity ? 0 : minLength,
        maxLength,
        top: [...distinct.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5),
    };

    if (numbers.length) {
        const sorted = [...numbers].sort((a, b) => a - b);
        const sum = numbers.reduce((acc, n) => acc + n, 0);
        const mean = sum / numbers.length;
        const variance = numbers.reduce((acc, n) => acc + (n - mean) ** 2, 0) / numbers.length;
        stats.numeric = {
            min: sorted[0],
            max: sorted[sorted.length - 1],
            mean,
            median: sorted[Math.floor(sorted.length / 2)],
            sum,
            stdDev: Math.sqrt(variance),
        };
    }

    return stats;
}

/** Compact number formatting for stat tiles. */
export function formatNumber(value) {
    if (value === null || value === undefined) return '—';
    if (typeof value === 'bigint') return value.toLocaleString();
    if (!Number.isFinite(value)) return String(value);
    if (Number.isInteger(value)) return value.toLocaleString();
    if (Math.abs(value) >= 1e6 || (Math.abs(value) < 1e-4 && value !== 0)) return value.toExponential(3);
    return Number(value.toFixed(4)).toLocaleString();
}
