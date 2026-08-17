// Mermaid generation and validation.
//
// The Mermaid Viewer (its own class) handles editing and export. These two
// cover the other halves: turning structured data into a diagram, and checking
// that a diagram parses before you commit it.

import { libs } from '../../lib/loader.js';
import { parseCsv, sniffDelimiter } from '../../lib/tabular.js';

const escapeHtml = (value) => String(value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/** Mermaid node ids must be simple; keep a stable map from label to id. */
function idFactory() {
    const seen = new Map();
    let counter = 0;
    return (label) => {
        const key = String(label).trim();
        if (seen.has(key)) return seen.get(key);
        const base = key.replace(/[^A-Za-z0-9]/g, '') || 'n';
        let id = /^[A-Za-z]/.test(base) ? base.slice(0, 20) : `n${base.slice(0, 19)}`;
        if ([...seen.values()].includes(id)) id = `${id}${++counter}`;
        seen.set(key, id);
        return id;
    };
}

const quote = (label) => `"${String(label).replace(/"/g, '#quot;')}"`;

// A literal triple backtick cannot appear inside a template literal, so build
// it once here and interpolate it where a fenced block is needed.
const FENCE = '`'.repeat(3);

const SHAPES = {
    box: (id, label) => `${id}[${quote(label)}]`,
    round: (id, label) => `${id}(${quote(label)})`,
    stadium: (id, label) => `${id}([${quote(label)}])`,
    circle: (id, label) => `${id}((${quote(label)}))`,
    diamond: (id, label) => `${id}{${quote(label)}}`,
    hex: (id, label) => `${id}{{${quote(label)}}}`,
};

// --------------------------------------------------------------------------

export const diagramTools = [
    {
        id: 'mermaid-generator',
        name: 'Mermaid Generator',
        description: 'Build flowcharts, sequence diagrams, ERDs and mind maps from plain lists or CSV.',
        category: 'image',
        icon: '◈+',
        keywords: ['mermaid', 'generate', 'flowchart', 'sequence', 'diagram', 'erd', 'mindmap',
            'gantt', 'class', 'state', 'csv', 'build', 'create', 'chart', 'graph'],
        spec: {
            lede: 'Write the structure as indented lines, arrows or CSV — get valid Mermaid you can paste into a README.',
            input: {
                label: 'Structure',
                placeholder: 'Start -> Check -> Done',
                sample: `Request received -> Validate payload
Validate payload -> Enrich from cache
Validate payload -> Reject
Enrich from cache -> Publish to Service Bus
Publish to Service Bus -> Acknowledge`,
            },
            output: { label: 'Mermaid', filename: 'diagram.mmd' },
            options: [
                { id: 'kind', type: 'select', label: 'Diagram type', default: 'flowchart',
                  choices: [
                      { value: 'flowchart', label: 'Flowchart — from "A -> B" lines' },
                      { value: 'sequence', label: 'Sequence — from "A -> B: message" lines' },
                      { value: 'mindmap', label: 'Mind map — from indented lines' },
                      { value: 'tree', label: 'Tree flowchart — from indented lines' },
                      { value: 'er', label: 'ER diagram — from CSV columns' },
                      { value: 'pie', label: 'Pie chart — from "label, value" lines' },
                      { value: 'journey', label: 'User journey — from "step: score: actor"' },
                  ] },
                { id: 'direction', type: 'select', label: 'Direction (flowchart)', default: 'TD',
                  choices: [
                      { value: 'TD', label: 'Top to bottom' }, { value: 'LR', label: 'Left to right' },
                      { value: 'BT', label: 'Bottom to top' }, { value: 'RL', label: 'Right to left' },
                  ] },
                { id: 'shape', type: 'select', label: 'Node shape (flowchart)', default: 'box',
                  choices: Object.keys(SHAPES).map((value) => ({ value, label: value })) },
                { id: 'title', type: 'text', label: 'Title (optional)', placeholder: 'Order pipeline' },
            ],
            run: ({ input, options }) => {
                const lines = input.split('\n').map((l) => l.replace(/\s+$/, '')).filter((l) => l.trim());
                if (!lines.length) return '';

                const shape = SHAPES[options.shape] || SHAPES.box;
                const nextId = idFactory();
                const title = options.title?.trim();
                const frontmatter = title ? `---\ntitle: ${title}\n---\n` : '';
                let body;

                switch (options.kind) {
                    case 'sequence': {
                        const out = ['sequenceDiagram', '    autonumber'];
                        const actors = new Set();
                        for (const line of lines) {
                            const match = /^(.+?)\s*(->>|-->>|->|-->)\s*(.+?)\s*:\s*(.*)$/.exec(line.trim())
                                || /^(.+?)\s*(->>|-->>|->|-->)\s*(.+)$/.exec(line.trim());
                            if (!match) continue;
                            const [, from, arrow, to, message = ''] = match;
                            actors.add(from.trim());
                            actors.add(to.trim());
                            const connector = arrow.includes('--') ? '-->>' : '->>';
                            out.push(`    ${nextId(from.trim())}${connector}${nextId(to.trim())}: ${message.trim() || 'call'}`);
                        }
                        if (out.length === 2) throw new Error('Write lines like "Browser -> Server: request".');
                        const declarations = [...actors].map((a) => `    participant ${nextId(a)} as ${a}`);
                        out.splice(1, 0, ...declarations);
                        body = out.join('\n');
                        break;
                    }

                    case 'mindmap':
                    case 'tree': {
                        const parsed = lines.map((line) => {
                            const indent = line.match(/^[ \t]*/)[0].replace(/\t/g, '    ').length;
                            return { depth: Math.floor(indent / 2), text: line.trim().replace(/^[-*]\s*/, '') };
                        });
                        if (options.kind === 'mindmap') {
                            body = ['mindmap', ...parsed.map((n) => `${'  '.repeat(n.depth + 1)}${n.text}`)].join('\n');
                        } else {
                            const out = [`flowchart ${options.direction}`];
                            const stack = [];
                            for (const node of parsed) {
                                const id = nextId(node.text);
                                out.push(`    ${shape(id, node.text)}`);
                                stack[node.depth] = id;
                                if (node.depth > 0 && stack[node.depth - 1]) {
                                    out.push(`    ${stack[node.depth - 1]} --> ${id}`);
                                }
                            }
                            body = out.join('\n');
                        }
                        break;
                    }

                    case 'er': {
                        const delimiter = sniffDelimiter(input);
                        const rows = parseCsv(input, delimiter).filter((r) => r.some((c) => c.trim()));
                        if (rows.length < 2) throw new Error('Provide CSV with a header row: entity,attribute,type,key');
                        const header = rows[0].map((h) => h.trim().toLowerCase());
                        const col = (name) => header.indexOf(name);
                        const entityCol = col('entity') === -1 ? 0 : col('entity');
                        const attrCol = col('attribute') === -1 ? 1 : col('attribute');
                        const typeCol = col('type');
                        const keyCol = col('key');

                        const entities = new Map();
                        for (const row of rows.slice(1)) {
                            const entity = (row[entityCol] || '').trim();
                            if (!entity) continue;
                            if (!entities.has(entity)) entities.set(entity, []);
                            entities.get(entity).push({
                                name: (row[attrCol] || '').trim() || 'field',
                                type: typeCol >= 0 ? (row[typeCol] || 'string').trim() : 'string',
                                key: keyCol >= 0 ? (row[keyCol] || '').trim().toUpperCase() : '',
                            });
                        }
                        if (!entities.size) throw new Error('No entities found in that CSV.');

                        const out = ['erDiagram'];
                        for (const [entity, fields] of entities) {
                            out.push(`    ${entity.replace(/\W/g, '_')} {`);
                            for (const field of fields) {
                                out.push(`        ${field.type.replace(/\W/g, '_')} ${field.name.replace(/\W/g, '_')}${field.key ? ` ${field.key}` : ''}`);
                            }
                            out.push('    }');
                        }
                        const names = [...entities.keys()].map((e) => e.replace(/\W/g, '_'));
                        for (let i = 0; i < names.length - 1; i++) {
                            out.push(`    ${names[i]} ||--o{ ${names[i + 1]} : has`);
                        }
                        body = out.join('\n');
                        break;
                    }

                    case 'pie': {
                        const out = [`pie${title ? ` title ${title}` : ' showData'}`];
                        for (const line of lines) {
                            const match = /^(.+?)[,:]\s*([\d.]+)\s*$/.exec(line.trim());
                            if (!match) continue;
                            out.push(`    "${match[1].trim().replace(/"/g, '')}" : ${match[2]}`);
                        }
                        if (out.length === 1) throw new Error('Write lines like "Chrome, 62.4".');
                        return { output: out.join('\n'), note: `${out.length - 1} slices` };
                    }

                    case 'journey': {
                        const out = ['journey', ...(title ? [`    title ${title}`] : []), '    section Journey'];
                        for (const line of lines) {
                            const parts = line.split(':').map((p) => p.trim());
                            if (parts.length < 2) continue;
                            out.push(`      ${parts[0]}: ${parts[1] || 3}: ${parts[2] || 'User'}`);
                        }
                        if (out.length <= 2) throw new Error('Write lines like "Find product: 5: Customer".');
                        body = out.join('\n');
                        break;
                    }

                    default: {
                        const out = [`flowchart ${options.direction}`];
                        const declared = new Set();
                        let edges = 0;

                        for (const line of lines) {
                            const match = /^(.+?)\s*(-->|->|=>|→)\s*(?:\|(.+?)\|\s*)?(.+)$/.exec(line.trim());
                            if (!match) {
                                const id = nextId(line.trim());
                                if (!declared.has(id)) { out.push(`    ${shape(id, line.trim())}`); declared.add(id); }
                                continue;
                            }
                            const [, from, , label, to] = match;
                            const fromId = nextId(from.trim());
                            const toId = nextId(to.trim());
                            if (!declared.has(fromId)) { out.push(`    ${shape(fromId, from.trim())}`); declared.add(fromId); }
                            if (!declared.has(toId)) { out.push(`    ${shape(toId, to.trim())}`); declared.add(toId); }
                            out.push(`    ${fromId} -->${label ? `|${label.trim()}|` : ''} ${toId}`);
                            edges++;
                        }
                        if (!edges && declared.size < 2) {
                            throw new Error('Write lines like "Start -> Finish", optionally "A ->|yes| B".');
                        }
                        body = out.join('\n');
                    }
                }

                const diagram = frontmatter + body;
                return {
                    output: diagram,
                    note: `${diagram.split('\n').length} lines`,
                    extraHtml: `
                        <div class="tool-section">
                            <div class="btn-row">
                                <button class="action-btn secondary" data-copy="${escapeHtml(diagram)}" data-copy-label="Diagram copied">Copy Mermaid</button>
                                <button class="action-btn secondary" data-copy="${escapeHtml(`${FENCE}mermaid\n${diagram}\n${FENCE}`)}" data-copy-label="Fenced block copied">Copy as fenced block</button>
                            </div>
                            <div class="info-box">Paste this into the <strong>Mermaid Viewer</strong> to render it, or into a
                            README inside a <code>${FENCE}mermaid</code> block — GitHub renders those natively.</div>
                        </div>`,
                };
            },
        },
    },

    {
        id: 'mermaid-validator',
        name: 'Mermaid Validator',
        description: 'Check a Mermaid diagram parses, and get the error line when it does not.',
        category: 'image',
        icon: '◈✓',
        keywords: ['mermaid', 'validate', 'check', 'syntax', 'error', 'parse', 'lint', 'diagram', 'ci'],
        spec: {
            lede: 'Runs the real Mermaid parser. Useful before committing a diagram to a README, where a syntax error just renders as a grey box.',
            input: {
                label: 'Mermaid source',
                placeholder: 'flowchart TD\n    A --> B',
                sample: `flowchart TD
    A[Start] --> B{Valid?}
    B -->|yes| C[Process]
    B -->|no| D[Reject]
    C --> E[End
    D --> E`,
            },
            output: { label: 'Result', filename: 'mermaid-validation.txt' },
            live: false,
            actionLabel: 'Validate',
            run: async ({ input, tool }) => {
                const source = input.trim();
                if (!source) return '';

                const mermaid = await libs.mermaid();
                const dark = (document.documentElement.getAttribute('data-theme')
                    || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')) === 'dark';
                mermaid.initialize({ startOnLoad: false, theme: dark ? 'dark' : 'default', securityLevel: 'strict' });

                const firstWord = source.split(/\s|\n/)[0].replace(/^---[\s\S]*?---\s*/, '');
                const known = ['flowchart', 'graph', 'sequenceDiagram', 'classDiagram', 'stateDiagram',
                    'stateDiagram-v2', 'erDiagram', 'journey', 'gantt', 'pie', 'mindmap', 'timeline',
                    'gitGraph', 'quadrantChart', 'requirementDiagram', 'C4Context', 'sankey-beta',
                    'xychart-beta', 'block-beta', 'packet-beta', 'architecture-beta'];

                try {
                    await mermaid.parse(source);
                } catch (err) {
                    const message = (err?.message || String(err));
                    const lineMatch = /line\s+(\d+)/i.exec(message);
                    const line = lineMatch ? Number(lineMatch[1]) : null;
                    const sourceLines = source.split('\n');

                    const context = line
                        ? sourceLines
                            .map((text, i) => `${String(i + 1).padStart(4)}${i + 1 === line ? ' >' : '  '} ${text}`)
                            .slice(Math.max(0, line - 4), line + 3)
                            .join('\n')
                        : '';

                    return {
                        output: `✕ Invalid\n\n${message}${context ? `\n\n${context}` : ''}`,
                        note: 'Invalid',
                        extraHtml: `
                            <div class="tool-section">
                                <div class="alert err"><span>✕</span><span>${escapeHtml(message.split('\n')[0])}</span></div>
                                ${!known.includes(firstWord) ? `<div class="alert warn"><span>!</span>
                                    <span><code>${escapeHtml(firstWord)}</code> is not a diagram type Mermaid recognises.
                                    Expected one of: ${known.slice(0, 12).join(', ')}…</span></div>` : ''}
                                ${context ? `<div class="output-section"><pre>${escapeHtml(context)}</pre></div>` : ''}
                            </div>`,
                    };
                }

                // It parses — render it so you can see what you actually get.
                const previewId = tool.id_('mvPreview');
                let svg = '';
                try {
                    ({ svg } = await mermaid.render(`validate-${Date.now()}`, source));
                } catch { /* parse succeeded but render failed; still a pass */ }

                const nodes = (source.match(/-->|---|->>|-->>/g) || []).length;

                return {
                    output: `✓ Valid ${firstWord} diagram\n\n${source.split('\n').length} lines, ${nodes} connections`,
                    note: 'Valid',
                    extraHtml: `
                        <div class="tool-section">
                            <div class="alert ok"><span>✓</span><span>Parses cleanly as a
                                <strong>${escapeHtml(firstWord)}</strong> diagram.</span></div>
                            ${svg ? `<h3>Preview</h3>
                                <div class="output-section" id="${previewId}" style="text-align:center;overflow-x:auto">${svg}</div>` : ''}
                        </div>`,
                };
            },
        },
    },
];
