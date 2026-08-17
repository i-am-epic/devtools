// Text tools: counting, case conversion, line manipulation, whitespace, lorem.
import { utf8ToBytes, bytesToHex, hexToBytes, bytesToUtf8, randomInt } from '../../lib/bytes.js';

const escape = (value) => String(value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Split an identifier or sentence into its constituent words. */
function toWords(text) {
    return text
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
        .split(/[^a-zA-Z0-9]+/)
        .filter(Boolean);
}

const statTile = (label, value, sub = '') => `
    <div class="stat-tile">
        <div class="stat-label">${label}</div>
        <div class="stat-value">${value}</div>
        ${sub ? `<div class="stat-sub">${sub}</div>` : ''}
    </div>`;

// --------------------------------------------------------------------------

const LOREM_WORDS = ('lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor '
    + 'incididunt ut labore et dolore magna aliqua enim ad minim veniam quis nostrud exercitation '
    + 'ullamco laboris nisi aliquip ex ea commodo consequat duis aute irure in reprehenderit '
    + 'voluptate velit esse cillum eu fugiat nulla pariatur excepteur sint occaecat cupidatat non '
    + 'proident sunt culpa qui officia deserunt mollit anim id est laborum').split(' ');

function loremSentence() {
    const length = 8 + randomInt(9);
    const words = [];
    for (let i = 0; i < length; i++) words.push(LOREM_WORDS[randomInt(LOREM_WORDS.length)]);
    const sentence = words.join(' ');
    return sentence.charAt(0).toUpperCase() + sentence.slice(1) + '.';
}

function loremParagraph() {
    const count = 3 + randomInt(4);
    return Array.from({ length: count }, loremSentence).join(' ');
}

// --------------------------------------------------------------------------

export const textTools = [
    {
        id: 'word-counter',
        name: 'Word Counter',
        description: 'Count words, characters, sentences, paragraphs and reading time as you type.',
        category: 'text',
        icon: '¶',
        keywords: ['word', 'count', 'character', 'letter', 'line', 'reading time'],
        spec: {
            lede: 'Live counts for words, characters, lines, sentences and paragraphs, plus an estimated reading time.',
            input: { label: 'Text', placeholder: 'Start typing or paste text…', sample: 'The quick brown fox jumps over the lazy dog.\n\nPack my box with five dozen liquor jugs. How vexingly quick daft zebras jump!' },
            output: { label: 'Breakdown', filename: 'word-count.txt' },
            options: [
                { id: 'wpm', type: 'number', label: 'Reading speed (wpm)', default: 220, min: 50, max: 1000 },
            ],
            run: ({ input, options }) => {
                const words = input.trim() ? input.trim().split(/\s+/).filter(Boolean) : [];
                const chars = [...input].length;
                const charsNoSpaces = [...input.replace(/\s/g, '')].length;
                const lines = input === '' ? 0 : input.split('\n').length;
                const sentences = (input.match(/[^.!?…]+[.!?…]+(\s|$)/g) || []).length
                    || (input.trim() ? 1 : 0);
                const paragraphs = input.split(/\n\s*\n/).filter((p) => p.trim()).length;
                const bytes = utf8ToBytes(input).length;
                const minutes = words.length / Math.max(1, options.wpm);
                const readTime = minutes < 1
                    ? `${Math.ceil(minutes * 60)} sec`
                    : `${Math.floor(minutes)}m ${Math.round((minutes % 1) * 60)}s`;

                // longest words + frequency
                const freq = new Map();
                for (const word of words) {
                    const key = word.toLowerCase().replace(/[^a-z0-9''-]/gi, '');
                    if (key) freq.set(key, (freq.get(key) || 0) + 1);
                }
                const top = [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);

                const summary = [
                    `Words:              ${words.length.toLocaleString()}`,
                    `Characters:         ${chars.toLocaleString()}`,
                    `Characters (no ws): ${charsNoSpaces.toLocaleString()}`,
                    `Lines:              ${lines.toLocaleString()}`,
                    `Sentences:          ${sentences.toLocaleString()}`,
                    `Paragraphs:         ${paragraphs.toLocaleString()}`,
                    `Bytes (UTF-8):      ${bytes.toLocaleString()}`,
                    `Unique words:       ${freq.size.toLocaleString()}`,
                    `Reading time:       ${readTime} at ${options.wpm} wpm`,
                    '',
                    'Most frequent words',
                    ...top.map(([word, count]) => `  ${String(count).padStart(4)} × ${word}`),
                ].join('\n');

                const extraHtml = `
                    <div class="stat-grid" style="margin-top:1.5rem;">
                        ${statTile('Words', words.length.toLocaleString())}
                        ${statTile('Characters', chars.toLocaleString(), `${charsNoSpaces.toLocaleString()} without spaces`)}
                        ${statTile('Lines', lines.toLocaleString())}
                        ${statTile('Sentences', sentences.toLocaleString())}
                        ${statTile('Paragraphs', paragraphs.toLocaleString())}
                        ${statTile('Read time', readTime, `${options.wpm} wpm`)}
                    </div>`;

                return { output: summary, extraHtml, note: `${words.length.toLocaleString()} words` };
            },
        },
    },

    {
        id: 'case-converter',
        name: 'Case Converter',
        description: 'Convert between camelCase, snake_case, kebab-case, Title Case, CONSTANT_CASE and more.',
        category: 'text',
        icon: 'Aa',
        keywords: ['case', 'camel', 'snake', 'kebab', 'pascal', 'upper', 'lower', 'title', 'constant'],
        spec: {
            lede: 'Pick a target case — the conversion understands existing camelCase and snake_case boundaries.',
            input: { label: 'Text', placeholder: 'helloWorldExample', sample: 'hello world example text' },
            output: { label: 'Converted', filename: 'converted.txt' },
            options: [{
                id: 'target',
                type: 'select',
                label: 'Convert to',
                default: 'camel',
                choices: [
                    { value: 'lower', label: 'lowercase' },
                    { value: 'upper', label: 'UPPERCASE' },
                    { value: 'title', label: 'Title Case' },
                    { value: 'sentence', label: 'Sentence case' },
                    { value: 'camel', label: 'camelCase' },
                    { value: 'pascal', label: 'PascalCase' },
                    { value: 'snake', label: 'snake_case' },
                    { value: 'constant', label: 'CONSTANT_CASE' },
                    { value: 'kebab', label: 'kebab-case' },
                    { value: 'dot', label: 'dot.case' },
                    { value: 'path', label: 'path/case' },
                    { value: 'alternating', label: 'aLtErNaTiNg' },
                    { value: 'inverse', label: 'iNVERSE cASE' },
                ],
            }],
            run: ({ input, options }) => {
                const perLine = (line) => {
                    if (!line.trim()) return line;
                    const words = toWords(line);
                    switch (options.target) {
                        case 'lower': return line.toLowerCase();
                        case 'upper': return line.toUpperCase();
                        case 'title': return line.replace(/\w\S*/g, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase());
                        case 'sentence': {
                            const lowered = line.toLowerCase();
                            return lowered.replace(/(^\s*\w)|([.!?]\s+\w)/g, (m) => m.toUpperCase());
                        }
                        case 'camel': return words.map((w, i) => (i === 0
                            ? w.toLowerCase()
                            : w[0].toUpperCase() + w.slice(1).toLowerCase())).join('');
                        case 'pascal': return words.map((w) => w[0].toUpperCase() + w.slice(1).toLowerCase()).join('');
                        case 'snake': return words.map((w) => w.toLowerCase()).join('_');
                        case 'constant': return words.map((w) => w.toUpperCase()).join('_');
                        case 'kebab': return words.map((w) => w.toLowerCase()).join('-');
                        case 'dot': return words.map((w) => w.toLowerCase()).join('.');
                        case 'path': return words.map((w) => w.toLowerCase()).join('/');
                        case 'alternating': return [...line].map((c, i) => (i % 2 ? c.toUpperCase() : c.toLowerCase())).join('');
                        case 'inverse': return [...line].map((c) => (c === c.toUpperCase() ? c.toLowerCase() : c.toUpperCase())).join('');
                        default: return line;
                    }
                };
                return input.split('\n').map(perLine).join('\n');
            },
        },
    },

    {
        id: 'line-sorter',
        name: 'Line Sorter',
        description: 'Sort, reverse, shuffle, de-duplicate and number lines of text.',
        category: 'text',
        icon: '↓≡',
        keywords: ['sort', 'line', 'alphabetical', 'reverse', 'shuffle', 'unique', 'dedupe', 'natural'],
        spec: {
            lede: 'Reorder lines however you need. Natural sort keeps file2 before file10.',
            input: { label: 'Lines', placeholder: 'one line per entry…', sample: 'banana\napple\nfile10\nfile2\nCherry\napple' },
            output: { label: 'Result', filename: 'sorted.txt' },
            options: [
                {
                    id: 'mode',
                    type: 'select',
                    label: 'Operation',
                    default: 'asc',
                    choices: [
                        { value: 'asc', label: 'Sort A → Z' },
                        { value: 'desc', label: 'Sort Z → A' },
                        { value: 'natural', label: 'Natural sort (file2 < file10)' },
                        { value: 'length', label: 'Sort by length' },
                        { value: 'reverse', label: 'Reverse order' },
                        { value: 'shuffle', label: 'Shuffle' },
                        { value: 'none', label: 'Keep order' },
                    ],
                },
                { id: 'ignoreCase', type: 'checkbox', label: 'Ignore case', default: true },
                { id: 'unique', type: 'checkbox', label: 'Remove duplicates', default: false },
                { id: 'trim', type: 'checkbox', label: 'Trim each line', default: false },
                { id: 'dropBlank', type: 'checkbox', label: 'Drop blank lines', default: false },
                { id: 'number', type: 'checkbox', label: 'Add line numbers', default: false },
            ],
            run: ({ input, options }) => {
                let lines = input.split('\n');
                if (options.trim) lines = lines.map((l) => l.trim());
                if (options.dropBlank) lines = lines.filter((l) => l.trim() !== '');

                if (options.unique) {
                    const seen = new Set();
                    lines = lines.filter((line) => {
                        const key = options.ignoreCase ? line.toLowerCase() : line;
                        if (seen.has(key)) return false;
                        seen.add(key);
                        return true;
                    });
                }

                const key = (line) => (options.ignoreCase ? line.toLowerCase() : line);
                const collator = new Intl.Collator(undefined, {
                    numeric: options.mode === 'natural',
                    sensitivity: options.ignoreCase ? 'base' : 'variant',
                });

                switch (options.mode) {
                    case 'asc':
                    case 'natural':
                        lines.sort((a, b) => collator.compare(a, b));
                        break;
                    case 'desc':
                        lines.sort((a, b) => collator.compare(b, a));
                        break;
                    case 'length':
                        lines.sort((a, b) => a.length - b.length || collator.compare(a, b));
                        break;
                    case 'reverse':
                        lines.reverse();
                        break;
                    case 'shuffle':
                        for (let i = lines.length - 1; i > 0; i--) {
                            const j = randomInt(i + 1);
                            [lines[i], lines[j]] = [lines[j], lines[i]];
                        }
                        break;
                    default:
                        break;
                }
                void key;

                if (options.number) {
                    const width = String(lines.length).length;
                    lines = lines.map((line, i) => `${String(i + 1).padStart(width)}. ${line}`);
                }

                return { output: lines.join('\n'), note: `${lines.length.toLocaleString()} lines` };
            },
        },
    },

    {
        id: 'whitespace-remover',
        name: 'Whitespace Remover',
        description: 'Trim trailing spaces, collapse runs of whitespace, strip blank lines and convert tabs.',
        category: 'text',
        icon: '⎵',
        keywords: ['whitespace', 'trim', 'space', 'tab', 'blank', 'indent', 'strip'],
        spec: {
            lede: 'Clean up messy indentation and stray spaces without touching the content itself.',
            input: {
                label: 'Text',
                placeholder: 'Paste text with messy whitespace…',
                sample: '   leading and trailing   \n\n\n\ttabbed    line   here\n   \nlast line\t\t',
            },
            output: { label: 'Cleaned', filename: 'cleaned.txt' },
            options: [
                { id: 'trimEnd', type: 'checkbox', label: 'Trim line ends', default: true },
                { id: 'trimStart', type: 'checkbox', label: 'Trim line starts', default: false },
                { id: 'collapse', type: 'checkbox', label: 'Collapse repeated spaces', default: false },
                { id: 'blank', type: 'checkbox', label: 'Remove blank lines', default: false },
                { id: 'squeezeBlank', type: 'checkbox', label: 'Max one blank line', default: false },
                { id: 'tabs', type: 'select', label: 'Tabs', default: 'keep',
                  choices: [
                      { value: 'keep', label: 'Leave tabs alone' },
                      { value: 'toSpace2', label: 'Tab → 2 spaces' },
                      { value: 'toSpace4', label: 'Tab → 4 spaces' },
                      { value: 'fromSpace', label: 'Leading spaces → tabs' },
                  ] },
            ],
            run: ({ input, options }) => {
                let lines = input.split('\n');

                if (options.tabs === 'toSpace2') lines = lines.map((l) => l.replace(/\t/g, '  '));
                if (options.tabs === 'toSpace4') lines = lines.map((l) => l.replace(/\t/g, '    '));
                if (options.tabs === 'fromSpace') {
                    lines = lines.map((l) => l.replace(/^ +/, (m) => '\t'.repeat(Math.floor(m.length / 4)) + ' '.repeat(m.length % 4)));
                }

                if (options.collapse) lines = lines.map((l) => l.replace(/[^\S\n]{2,}/g, ' '));
                if (options.trimStart) lines = lines.map((l) => l.replace(/^\s+/, ''));
                if (options.trimEnd) lines = lines.map((l) => l.replace(/\s+$/, ''));
                if (options.blank) lines = lines.filter((l) => l.trim() !== '');
                else if (options.squeezeBlank) {
                    lines = lines.filter((line, i) => !(line.trim() === '' && lines[i - 1]?.trim() === ''));
                }

                const output = lines.join('\n');
                const saved = input.length - output.length;
                return { output, note: `${saved >= 0 ? 'Removed' : 'Added'} ${Math.abs(saved).toLocaleString()} characters` };
            },
        },
    },

    {
        id: 'lorem-ipsum',
        name: 'Lorem Ipsum Generator',
        description: 'Generate placeholder paragraphs, sentences, words or list items.',
        category: 'text',
        icon: '¶+',
        keywords: ['lorem', 'ipsum', 'placeholder', 'dummy', 'filler', 'text'],
        spec: {
            lede: 'Classic filler text for mockups.',
            layout: 'output',
            actionLabel: 'Generate',
            output: { label: 'Lorem ipsum', filename: 'lorem.txt' },
            options: [
                { id: 'unit', type: 'select', label: 'Generate', default: 'paragraphs',
                  choices: [
                      { value: 'paragraphs', label: 'Paragraphs' },
                      { value: 'sentences', label: 'Sentences' },
                      { value: 'words', label: 'Words' },
                      { value: 'list', label: 'List items' },
                  ] },
                { id: 'count', type: 'number', label: 'How many', default: 3, min: 1, max: 200 },
                { id: 'classic', type: 'checkbox', label: 'Start with "Lorem ipsum dolor sit amet"', default: true },
                { id: 'html', type: 'checkbox', label: 'Wrap in HTML tags', default: false },
            ],
            run: ({ options }) => {
                const count = Math.max(1, Math.min(200, options.count || 1));
                let parts;

                if (options.unit === 'words') {
                    const words = Array.from({ length: count }, () => LOREM_WORDS[randomInt(LOREM_WORDS.length)]);
                    if (options.classic) words.splice(0, Math.min(5, words.length), 'lorem', 'ipsum', 'dolor', 'sit', 'amet');
                    parts = [words.join(' ')];
                } else if (options.unit === 'sentences') {
                    parts = [Array.from({ length: count }, loremSentence).join(' ')];
                } else {
                    parts = Array.from({ length: count }, loremParagraph);
                }

                if (options.classic && options.unit !== 'words') {
                    parts[0] = `Lorem ipsum dolor sit amet, consectetur adipiscing elit. ${parts[0]}`;
                }

                if (options.html) {
                    const tag = options.unit === 'list' ? 'li' : 'p';
                    const body = parts.map((p) => `  <${tag}>${p}</${tag}>`).join('\n');
                    return options.unit === 'list' ? `<ul>\n${body}\n</ul>` : body;
                }

                return parts.join(options.unit === 'list' ? '\n' : '\n\n');
            },
        },
    },

    {
        id: 'text-to-hex',
        name: 'Text to HEX',
        description: 'Convert text into its hexadecimal byte representation.',
        category: 'text',
        icon: '0x',
        keywords: ['hex', 'hexadecimal', 'text', 'encode', 'bytes'],
        spec: {
            lede: 'UTF-8 encodes the text, then renders each byte as hex.',
            input: { label: 'Text', placeholder: 'Hello, world', sample: 'Hello, world' },
            output: { label: 'Hexadecimal', filename: 'text.hex' },
            swap: true,
            options: [
                { id: 'separator', type: 'select', label: 'Separator', default: ' ',
                  choices: [
                      { value: ' ', label: 'Space (48 65 6c)' },
                      { value: '', label: 'None (48656c)' },
                      { value: ':', label: 'Colon (48:65:6c)' },
                      { value: '-', label: 'Dash (48-65-6c)' },
                      { value: '\\x', label: 'Escaped (\\x48\\x65)' },
                      { value: '0x, ', label: 'C array (0x48, 0x65)' },
                  ] },
                { id: 'upper', type: 'checkbox', label: 'Uppercase', default: false },
            ],
            run: ({ input, options }) => {
                const bytes = utf8ToBytes(input);
                if (options.separator === '\\x') {
                    return [...bytes].map((b) => `\\x${b.toString(16).padStart(2, '0')}`).join('');
                }
                if (options.separator === '0x, ') {
                    return [...bytes].map((b) => `0x${b.toString(16).padStart(2, '0')}`).join(', ');
                }
                return bytesToHex(bytes, { upper: options.upper, separator: options.separator });
            },
        },
    },

    {
        id: 'hex-to-text',
        name: 'HEX to Text',
        description: 'Decode hexadecimal bytes back into readable text.',
        category: 'text',
        icon: 'x0',
        keywords: ['hex', 'hexadecimal', 'decode', 'text', 'bytes'],
        spec: {
            lede: 'Separators, 0x prefixes and \\x escapes are all handled — just paste whatever you have.',
            input: { label: 'Hexadecimal', placeholder: '48 65 6c 6c 6f', sample: '48 65 6c 6c 6f 2c 20 77 6f 72 6c 64' },
            output: { label: 'Text', filename: 'decoded.txt' },
            swap: true,
            run: ({ input }) => {
                const normalised = input.replace(/\\x/gi, '');
                return bytesToUtf8(hexToBytes(normalised));
            },
        },
    },

    {
        id: 'string-escaper',
        name: 'String Escaper',
        description: 'Escape and unescape strings for JavaScript, JSON, SQL, XML, HTML and shell.',
        category: 'text',
        icon: '\\n',
        keywords: ['escape', 'unescape', 'string', 'quote', 'javascript', 'json', 'sql', 'shell'],
        spec: {
            lede: 'One place for every "how do I quote this" question.',
            input: { label: 'Input', placeholder: 'He said "hello"\tand left.', sample: 'He said "hello"\\nand left.' },
            output: { label: 'Result', filename: 'escaped.txt' },
            options: [
                { id: 'target', type: 'select', label: 'Format', default: 'javascript',
                  choices: [
                      { value: 'javascript', label: 'JavaScript / TypeScript' },
                      { value: 'json', label: 'JSON string' },
                      { value: 'sql', label: 'SQL single-quoted literal' },
                      { value: 'shell', label: 'POSIX shell single quotes' },
                      { value: 'csv', label: 'CSV field' },
                      { value: 'regex', label: 'Regular expression literal' },
                  ] },
                { id: 'direction', type: 'select', label: 'Direction', default: 'escape',
                  choices: [
                      { value: 'escape', label: 'Escape' },
                      { value: 'unescape', label: 'Unescape' },
                  ] },
                { id: 'quotes', type: 'checkbox', label: 'Include surrounding quotes', default: false },
            ],
            run: ({ input, options }) => {
                const { target, direction, quotes } = options;

                if (direction === 'unescape') {
                    let text = input.trim();
                    if (target === 'json' || target === 'javascript') {
                        // Strip wrapping quotes if present, then let JSON do the work.
                        if (/^".*"$/s.test(text) || /^'.*'$/s.test(text)) text = text.slice(1, -1);
                        try {
                            return JSON.parse(`"${text.replace(/"/g, '\\"').replace(/\\\\"/g, '\\"')}"`);
                        } catch {
                            return text
                                .replace(/\\n/g, '\n').replace(/\\r/g, '\r').replace(/\\t/g, '\t')
                                .replace(/\\'/g, "'").replace(/\\"/g, '"').replace(/\\\\/g, '\\');
                        }
                    }
                    if (target === 'sql') return text.replace(/^'|'$/g, '').replace(/''/g, "'");
                    if (target === 'shell') return text.replace(/^'|'$/g, '').replace(/'\\''/g, "'");
                    if (target === 'csv') return text.replace(/^"|"$/g, '').replace(/""/g, '"');
                    if (target === 'regex') return text.replace(/\\([.*+?^${}()|[\]\\/])/g, '$1');
                    return text;
                }

                let out;
                switch (target) {
                    case 'json':
                    case 'javascript': {
                        out = JSON.stringify(input).slice(1, -1);
                        if (target === 'javascript') out = out.replace(/\\"/g, '"').replace(/'/g, "\\'");
                        return quotes ? (target === 'javascript' ? `'${out}'` : `"${out}"`) : out;
                    }
                    case 'sql':
                        out = input.replace(/'/g, "''");
                        return quotes ? `'${out}'` : out;
                    case 'shell':
                        out = input.replace(/'/g, `'\\''`);
                        return quotes ? `'${out}'` : out;
                    case 'csv':
                        out = input.replace(/"/g, '""');
                        return quotes || /[",\n]/.test(input) ? `"${out}"` : out;
                    case 'regex':
                        return input.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
                    default:
                        return input;
                }
            },
            footnote: 'SQL escaping here doubles single quotes, which is the standard literal form. It is <strong>not</strong> a substitute for parameterised queries — always bind user input as a parameter.',
        },
    },
];

export { escape, toWords, statTile };
