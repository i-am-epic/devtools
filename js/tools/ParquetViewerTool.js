// Parquet viewer — reads real Parquet files in the browser via hyparquet.
//
// Handles multiple files at once, surfaces the footer metadata (row groups,
// codecs, encodings, compressed vs uncompressed sizes, column statistics),
// computes per-column statistics from the actual values, and lets you filter,
// sort and export the data.

import { BaseTool } from '../core/BaseTool.js';
import { libs } from '../lib/loader.js';
import { formatBytes } from '../lib/bytes.js';
import { columnStats, formatNumber, toCsv } from '../lib/tabular.js';
import { toast, copyText, downloadText, downloadBlob } from '../ui/toast.js';

const escapeHtml = (value) => String(value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const PAGE_SIZE = 100;

/** JSON.stringify cannot serialise BigInt; render values for display instead. */
function displayValue(value) {
    if (value === null || value === undefined) return null;
    if (typeof value === 'bigint') return value.toString();
    if (value instanceof Date) return value.toISOString();
    if (value instanceof Uint8Array) {
        const text = new TextDecoder('utf-8', { fatal: false }).decode(value);
        return text.includes('\uFFFD') ? `0x${[...value].map((b) => b.toString(16).padStart(2, '0')).join('')}` : text;
    }
    if (typeof value === 'object') {
        try {
            return JSON.stringify(value, (_, v) => (typeof v === 'bigint' ? v.toString() : v));
        } catch {
            return String(value);
        }
    }
    return value;
}

const isNumeric = (value) => typeof value === 'number' || typeof value === 'bigint';

// ---------------------------------------------------------------- filter --

/**
 * Tiny, safe filter language: `col op value` joined by AND / OR.
 * Deliberately not eval() — the grammar is closed and predictable.
 */
function parseFilter(expression) {
    const tokens = expression.match(
        /("[^"]*"|'[^']*'|\(|\)|>=|<=|!=|<>|=|>|<|\bAND\b|\bOR\b|\bNOT\s+LIKE\b|\bLIKE\b|\bIN\b|\bIS\s+NOT\s+NULL\b|\bIS\s+NULL\b|[^\s()]+)/gi,
    );
    if (!tokens) throw new Error('Could not read that filter');

    let position = 0;
    const peek = () => tokens[position];
    const next = () => tokens[position++];

    const literal = (token) => {
        if (token === undefined) throw new Error('Filter ended unexpectedly');
        if (/^["']/.test(token)) return token.slice(1, -1);
        if (/^-?\d+\.?\d*$/.test(token)) return Number(token);
        if (/^true$/i.test(token)) return true;
        if (/^false$/i.test(token)) return false;
        if (/^null$/i.test(token)) return null;
        return token;
    };

    const compare = () => {
        if (peek() === '(') {
            next();
            const inner = orExpression();
            if (next() !== ')') throw new Error('Missing closing parenthesis');
            return inner;
        }

        const column = next();
        const operator = next();
        if (operator === undefined) throw new Error(`Expected a comparison after "${column}"`);

        const op = operator.toUpperCase().replace(/\s+/g, ' ');

        if (op === 'IS NULL') return (row) => row[column] === null || row[column] === undefined;
        if (op === 'IS NOT NULL') return (row) => row[column] !== null && row[column] !== undefined;

        if (op === 'IN') {
            if (next() !== '(') throw new Error('IN must be followed by a parenthesised list');
            const values = [];
            for (;;) {
                const token = next();
                if (token === ')') break;
                if (token === ',') continue;
                if (token === undefined) throw new Error('Unterminated IN list');
                values.push(literal(token.replace(/,$/, '')));
            }
            return (row) => values.some((v) => String(row[column]) === String(v));
        }

        const value = literal(next());

        if (op === 'LIKE' || op === 'NOT LIKE') {
            const pattern = new RegExp(
                `^${String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*').replace(/_/g, '.')}$`,
                'i',
            );
            return op === 'LIKE'
                ? (row) => pattern.test(String(row[column] ?? ''))
                : (row) => !pattern.test(String(row[column] ?? ''));
        }

        const compareValues = (cell) => {
            if (cell === null || cell === undefined) return null;
            if (isNumeric(cell) && typeof value !== 'boolean') {
                const left = typeof cell === 'bigint' ? Number(cell) : cell;
                const right = typeof value === 'string' ? Number(value) : value;
                if (!Number.isNaN(right)) return [left, right];
            }
            return [String(cell), String(value)];
        };

        return (row) => {
            const pair = compareValues(row[column]);
            if (pair === null) return op === '!=' || op === '<>';
            const [left, right] = pair;
            switch (op) {
                case '=': return left === right;
                case '!=': case '<>': return left !== right;
                case '>': return left > right;
                case '>=': return left >= right;
                case '<': return left < right;
                case '<=': return left <= right;
                default: throw new Error(`Unknown operator "${operator}"`);
            }
        };
    };

    const andExpression = () => {
        let left = compare();
        while (peek() && peek().toUpperCase() === 'AND') {
            next();
            const right = compare();
            const previous = left;
            left = (row) => previous(row) && right(row);
        }
        return left;
    };

    const orExpression = () => {
        let left = andExpression();
        while (peek() && peek().toUpperCase() === 'OR') {
            next();
            const right = andExpression();
            const previous = left;
            left = (row) => previous(row) || right(row);
        }
        return left;
    };

    const predicate = orExpression();
    if (position < tokens.length) throw new Error(`Unexpected "${tokens[position]}" at the end of the filter`);
    return predicate;
}

// --------------------------------------------------------------------------

export class ParquetViewerTool extends BaseTool {
    constructor(config) {
        super(config);
        this.files = [];          // { name, size, buffer, metadata, schema, rows, error }
        this.activeIndex = 0;
        this.combined = false;
        this.page = 0;
        this.sortColumn = null;
        this.sortDirection = 'asc';
        this.filterText = '';
        this.view = 'data';
    }

    render() {
        return `
            <div class="tool-interface" data-cat="data">
                <h2><span class="tool-icon">${this.icon}</span>${escapeHtml(this.name)}</h2>
                <p class="tool-lede">
                    Open one or more Parquet files, inspect their schema and footer metadata, filter and sort
                    the rows, and export the result. Files are parsed entirely in your browser — nothing is uploaded.
                </p>

                <div class="tool-section">
                    <input type="file" id="pqFiles" accept=".parquet,.parq,.pq" multiple class="file-input">
                    <div class="helper-text">Select several files at once to compare them or stack them into one table.</div>
                </div>

                <div id="pqStatus"></div>
                <div id="pqFileList" class="tool-section" style="display:none;"></div>
                <div id="pqBody"></div>
            </div>
        `;
    }

    onOpen() {
        setTimeout(() => {
            document.getElementById('pqFiles')?.addEventListener('change', (event) => {
                this.loadFiles([...event.target.files]);
            });
        }, 0);
    }

    onClose() {
        this.files = [];
    }

    // ------------------------------------------------------------ loading --

    setStatus(message, kind = 'info') {
        const node = document.getElementById('pqStatus');
        if (!node) return;
        node.innerHTML = message
            ? `<div class="alert ${kind}"><span>${kind === 'err' ? '✕' : kind === 'ok' ? '✓' : 'ℹ'}</span><span>${escapeHtml(message)}</span></div>`
            : '';
    }

    async loadFiles(fileList) {
        if (!fileList.length) return;
        this.setStatus(`Reading ${fileList.length} file${fileList.length === 1 ? '' : 's'}…`);

        let hyparquet;
        let compressors;
        try {
            hyparquet = await libs.hyparquet();
        } catch (err) {
            this.setStatus(`Could not load the Parquet parser: ${err.message}`, 'err');
            return;
        }
        try {
            ({ compressors } = await libs.hyparquetCompressors());
        } catch {
            compressors = undefined;   // snappy + uncompressed still work without it
        }

        for (const file of fileList) {
            const entry = { name: file.name, size: file.size };
            try {
                const buffer = await file.arrayBuffer();
                entry.buffer = buffer;
                entry.metadata = hyparquet.parquetMetadata(buffer);
                entry.schema = hyparquet.parquetSchema(entry.metadata);

                const rows = await new Promise((resolve, reject) => {
                    hyparquet.parquetRead({
                        file: buffer,
                        metadata: entry.metadata,
                        compressors,
                        rowFormat: 'object',
                        onComplete: resolve,
                    }).catch(reject);
                });
                entry.rows = rows;
                entry.columns = this.topLevelColumns(entry.schema);
            } catch (err) {
                entry.error = err.message || String(err);
            }
            this.files.push(entry);
        }

        this.activeIndex = this.files.findIndex((f) => !f.error);
        if (this.activeIndex === -1) this.activeIndex = 0;

        const failed = this.files.filter((f) => f.error).length;
        this.setStatus(
            failed
                ? `${this.files.length - failed} file(s) loaded, ${failed} failed — see the list below.`
                : `${this.files.length} file${this.files.length === 1 ? '' : 's'} loaded.`,
            failed ? 'warn' : 'ok',
        );

        this.renderFileList();
        this.renderBody();
    }

    /**
     * The columns to show are the schema root's direct children — those are the
     * keys parquetRead puts on each row. Nested groups (LIST, MAP, STRUCT) stay
     * as one column and are summarised rather than split into their leaves.
     *
     * @param {object} schemaTree result of hyparquet's parquetSchema()
     */
    topLevelColumns(schemaTree) {
        const describeGroup = (node) => {
            const kind = node.element.logical_type?.type || node.element.converted_type;

            if (kind === 'LIST') {
                // LIST wraps its item in a repeated group: list -> element
                const item = node.children?.[0]?.children?.[0];
                const inner = item
                    ? (this.describeLogicalType(item.element) || item.element.type || 'group')
                    : '?';
                return `LIST<${inner}>`;
            }
            if (kind === 'MAP') return 'MAP';

            const fields = (node.children || [])
                .map((child) => child.element.name)
                .slice(0, 4)
                .join(', ');
            const more = (node.children || []).length > 4 ? ', …' : '';
            return `STRUCT{${fields}${more}}`;
        };

        return (schemaTree.children || []).map((node) => {
            const isGroup = (node.children || []).length > 0;
            return {
                name: node.element.name,
                physical: isGroup ? 'GROUP' : (node.element.type || 'GROUP'),
                logical: isGroup ? describeGroup(node) : this.describeLogicalType(node.element),
                repetition: node.element.repetition_type,
            };
        });
    }

    /**
     * hyparquet exposes logical types as a flat object whose `type` field names
     * the kind, e.g. { type: 'DECIMAL', precision: 12, scale: 2 } or
     * { type: 'TIMESTAMP', unit: 'MILLIS', isAdjustedToUTC: false }.
     */
    describeLogicalType(element) {
        const logical = element.logical_type || element.logicalType;
        const kind = logical?.type;

        if (kind) {
            switch (kind) {
                case 'TIMESTAMP':
                    return `TIMESTAMP(${logical.unit || ''}${logical.isAdjustedToUTC ? ', UTC' : ''})`;
                case 'TIME':
                    return `TIME(${logical.unit || ''})`;
                case 'DECIMAL':
                    return `DECIMAL(${logical.precision},${logical.scale})`;
                case 'INTEGER':
                    return `${logical.isSigned === false ? 'U' : ''}INT${logical.bitWidth || ''}`;
                default:
                    return kind;
            }
        }

        if (element.converted_type) return element.converted_type;
        return '';
    }

    // ------------------------------------------------------------- files ---

    renderFileList() {
        const node = document.getElementById('pqFileList');
        if (!node) return;
        node.style.display = 'block';

        const usable = this.files.filter((f) => !f.error).length;

        node.innerHTML = `
            <h3>Files (${this.files.length})</h3>
            ${this.files.map((file, index) => {
                if (file.error) {
                    return `
                        <div class="file-row" style="border-color:var(--red)">
                            <div>
                                <div class="fname">${escapeHtml(file.name)}</div>
                                <div class="fmeta" style="color:var(--red)">${escapeHtml(file.error.slice(0, 160))}</div>
                            </div>
                            <button class="mini-btn" data-remove="${index}">Remove</button>
                        </div>`;
                }
                const rows = Number(file.metadata.num_rows);
                const compressed = file.metadata.row_groups.reduce(
                    (sum, group) => sum + group.columns.reduce((s, c) => s + Number(c.meta_data?.total_compressed_size || 0), 0), 0,
                );
                return `
                    <div class="file-row ${index === this.activeIndex && !this.combined ? 'active' : ''}" data-select="${index}" style="cursor:pointer">
                        <div>
                            <div class="fname">${escapeHtml(file.name)}</div>
                            <div class="fmeta">${rows.toLocaleString()} rows · ${file.columns.length} cols · ${formatBytes(file.size)}${compressed ? ` · ${formatBytes(compressed)} of column data` : ''}</div>
                        </div>
                        <button class="mini-btn" data-remove="${index}">Remove</button>
                    </div>`;
            }).join('')}

            ${usable > 1 ? `
                <div class="btn-row" style="margin-top:0.75rem;">
                    <button class="action-btn ${this.combined ? '' : 'secondary'}" id="pqCombine">
                        ${this.combined ? '✓ Combined view on' : 'Stack all files into one table'}
                    </button>
                    <button class="action-btn secondary" id="pqCompare">Compare schemas</button>
                </div>` : ''}
        `;

        node.querySelectorAll('[data-select]').forEach((row) => {
            row.addEventListener('click', (event) => {
                if (event.target.hasAttribute('data-remove')) return;
                this.activeIndex = Number(row.dataset.select);
                this.combined = false;
                this.page = 0;
                this.sortColumn = null;
                this.renderFileList();
                this.renderBody();
            });
        });

        node.querySelectorAll('[data-remove]').forEach((button) => {
            button.addEventListener('click', (event) => {
                event.stopPropagation();
                this.files.splice(Number(button.dataset.remove), 1);
                this.activeIndex = Math.max(0, Math.min(this.activeIndex, this.files.length - 1));
                if (!this.files.length) {
                    document.getElementById('pqFileList').style.display = 'none';
                    document.getElementById('pqBody').innerHTML = '';
                    this.setStatus('');
                    return;
                }
                this.renderFileList();
                this.renderBody();
            });
        });

        document.getElementById('pqCombine')?.addEventListener('click', () => {
            this.combined = !this.combined;
            this.page = 0;
            this.renderFileList();
            this.renderBody();
        });

        document.getElementById('pqCompare')?.addEventListener('click', () => {
            this.view = 'compare';
            this.renderBody();
        });
    }

    // -------------------------------------------------------------- data ---

    /** Rows currently in scope, with a __file column added in combined mode. */
    baseRows() {
        if (this.combined) {
            return this.files
                .filter((file) => !file.error)
                .flatMap((file) => file.rows.map((row) => ({ __file: file.name, ...row })));
        }
        return this.files[this.activeIndex]?.rows || [];
    }

    activeColumns() {
        if (this.combined) {
            const names = new Set(['__file']);
            for (const file of this.files) {
                if (file.error) continue;
                file.columns.forEach((column) => names.add(column.name));
            }
            const lookup = new Map();
            for (const file of this.files) {
                if (file.error) continue;
                file.columns.forEach((column) => lookup.set(column.name, column));
            }
            return [...names].map((name) => lookup.get(name) || { name, physical: 'STRING', logical: 'source file' });
        }
        return this.files[this.activeIndex]?.columns || [];
    }

    /** Apply the filter, then the sort. */
    visibleRows() {
        let rows = this.baseRows();

        if (this.filterText.trim()) {
            try {
                const predicate = parseFilter(this.filterText.trim());
                rows = rows.filter(predicate);
                this.filterError = null;
            } catch (err) {
                this.filterError = err.message;
            }
        } else {
            this.filterError = null;
        }

        if (this.sortColumn) {
            const column = this.sortColumn;
            const direction = this.sortDirection === 'asc' ? 1 : -1;
            rows = [...rows].sort((a, b) => {
                const left = a[column];
                const right = b[column];
                if (left === null || left === undefined) return 1;
                if (right === null || right === undefined) return -1;
                if (isNumeric(left) && isNumeric(right)) return (Number(left) - Number(right)) * direction;
                return String(left).localeCompare(String(right)) * direction;
            });
        }

        return rows;
    }

    // ------------------------------------------------------------- render --

    renderBody() {
        const node = document.getElementById('pqBody');
        if (!node) return;

        const file = this.files[this.activeIndex];
        if (!this.files.length || (!this.combined && (!file || file.error))) {
            node.innerHTML = '';
            return;
        }

        const tabs = [
            ['data', 'Data'],
            ['stats', 'Column stats'],
            ['schema', 'Schema'],
            ['file', 'File metadata'],
            ...(this.files.filter((f) => !f.error).length > 1 ? [['compare', 'Compare']] : []),
        ];

        node.innerHTML = `
            <div class="tool-section">
                <div class="btn-row" style="margin-bottom:1rem;">
                    ${tabs.map(([id, label]) => `
                        <button class="action-btn ${this.view === id ? '' : 'secondary'}" data-view="${id}">${label}</button>
                    `).join('')}
                </div>
                <div id="pqView"></div>
            </div>
        `;

        node.querySelectorAll('[data-view]').forEach((button) => {
            button.addEventListener('click', () => {
                this.view = button.dataset.view;
                this.renderBody();
            });
        });

        const view = document.getElementById('pqView');
        switch (this.view) {
            case 'stats': view.innerHTML = this.renderColumnStats(); break;
            case 'schema': view.innerHTML = this.renderSchema(); this.bindSchemaActions(); break;
            case 'file': view.innerHTML = this.renderFileMetadata(); break;
            case 'compare': view.innerHTML = this.renderCompare(); break;
            default: this.renderData(view); break;
        }
    }

    renderData(container) {
        const columns = this.activeColumns();
        const rows = this.visibleRows();
        const total = this.baseRows().length;
        const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
        this.page = Math.min(this.page, pages - 1);
        const slice = rows.slice(this.page * PAGE_SIZE, (this.page + 1) * PAGE_SIZE);

        container.innerHTML = `
            <div class="field-group" style="margin-bottom:1rem;">
                <div>
                    <label for="pqFilter">Filter</label>
                    <input type="text" id="pqFilter" value="${escapeHtml(this.filterText)}"
                           placeholder="age &gt; 30 AND city = 'London'">
                    <div class="helper-text">
                        Operators: = != &gt; &gt;= &lt; &lt;= LIKE IN IS NULL, combined with AND / OR and parentheses.
                    </div>
                </div>
            </div>

            ${this.filterError ? `<div class="alert err"><span>✕</span><span>${escapeHtml(this.filterError)}</span></div>` : ''}

            <div class="btn-row" style="margin-bottom:1rem;">
                <button class="action-btn secondary" id="pqExportCsv">Export CSV</button>
                <button class="action-btn secondary" id="pqExportJson">Export JSON</button>
                <button class="action-btn secondary" id="pqExportNdjson">Export NDJSON</button>
                <span class="chip">${rows.length.toLocaleString()} of ${total.toLocaleString()} rows</span>
                ${this.sortColumn ? `<span class="chip on">sorted by ${escapeHtml(this.sortColumn)} ${this.sortDirection}</span>` : ''}
            </div>

            <div class="table-wrap">
                <table class="data">
                    <thead>
                        <tr>
                            <th class="row-index">#</th>
                            ${columns.map((column) => `
                                <th data-sort="${escapeHtml(column.name)}" style="cursor:pointer" title="Click to sort">
                                    ${escapeHtml(column.name)}${this.sortColumn === column.name ? (this.sortDirection === 'asc' ? ' ▲' : ' ▼') : ''}
                                    <span class="th-type">${escapeHtml(column.logical || column.physical)}</span>
                                </th>`).join('')}
                        </tr>
                    </thead>
                    <tbody>
                        ${slice.map((row, index) => `
                            <tr>
                                <td class="row-index">${(this.page * PAGE_SIZE + index + 1).toLocaleString()}</td>
                                ${columns.map((column) => {
                                    const value = displayValue(row[column.name]);
                                    if (value === null) return '<td class="nul">null</td>';
                                    const numeric = isNumeric(row[column.name]);
                                    const text = String(value);
                                    return `<td class="${numeric ? 'num' : ''}" title="${escapeHtml(text.slice(0, 400))}">${escapeHtml(text.slice(0, 200))}</td>`;
                                }).join('')}
                            </tr>`).join('')}
                    </tbody>
                </table>
            </div>

            ${pages > 1 ? `
                <div class="btn-row" style="margin-top:1rem;align-items:center;">
                    <button class="action-btn secondary" id="pqPrev" ${this.page === 0 ? 'disabled' : ''}>← Previous</button>
                    <span class="chip">Page ${this.page + 1} of ${pages.toLocaleString()}</span>
                    <button class="action-btn secondary" id="pqNext" ${this.page >= pages - 1 ? 'disabled' : ''}>Next →</button>
                </div>` : ''}
        `;

        const filterInput = document.getElementById('pqFilter');
        let debounce;
        filterInput?.addEventListener('input', (event) => {
            clearTimeout(debounce);
            debounce = setTimeout(() => {
                this.filterText = event.target.value;
                this.page = 0;
                const caret = event.target.selectionStart;
                this.renderData(container);
                const refreshed = document.getElementById('pqFilter');
                refreshed?.focus();
                refreshed?.setSelectionRange(caret, caret);
            }, 260);
        });

        container.querySelectorAll('[data-sort]').forEach((header) => {
            header.addEventListener('click', () => {
                const column = header.dataset.sort;
                if (this.sortColumn === column) {
                    if (this.sortDirection === 'asc') this.sortDirection = 'desc';
                    else { this.sortColumn = null; this.sortDirection = 'asc'; }
                } else {
                    this.sortColumn = column;
                    this.sortDirection = 'asc';
                }
                this.renderData(container);
            });
        });

        document.getElementById('pqPrev')?.addEventListener('click', () => { this.page--; this.renderData(container); });
        document.getElementById('pqNext')?.addEventListener('click', () => { this.page++; this.renderData(container); });

        const baseName = (this.combined ? 'combined' : this.files[this.activeIndex].name).replace(/\.(parquet|parq|pq)$/i, '');
        document.getElementById('pqExportCsv')?.addEventListener('click', () => {
            const names = columns.map((c) => c.name);
            const body = rows.map((row) => names.map((name) => displayValue(row[name])));
            downloadText(toCsv([names, ...body]), `${baseName}.csv`, 'text/csv');
            toast(`Exported ${rows.length.toLocaleString()} rows`);
        });
        document.getElementById('pqExportJson')?.addEventListener('click', () => {
            const body = rows.map((row) => Object.fromEntries(columns.map((c) => [c.name, displayValue(row[c.name])])));
            downloadText(JSON.stringify(body, null, 2), `${baseName}.json`, 'application/json');
            toast(`Exported ${rows.length.toLocaleString()} rows`);
        });
        document.getElementById('pqExportNdjson')?.addEventListener('click', () => {
            const body = rows.map((row) => JSON.stringify(
                Object.fromEntries(columns.map((c) => [c.name, displayValue(row[c.name])])),
            )).join('\n');
            downloadText(body, `${baseName}.ndjson`, 'application/x-ndjson');
            toast(`Exported ${rows.length.toLocaleString()} rows`);
        });
    }

    renderColumnStats() {
        const columns = this.activeColumns();
        const rows = this.visibleRows();

        const cards = columns.map((column) => {
            const values = rows.map((row) => row[column.name]);
            const stats = columnStats(values);

            const numericRows = stats.numeric ? `
                <tr><td>Min</td><td class="num">${formatNumber(stats.numeric.min)}</td></tr>
                <tr><td>Max</td><td class="num">${formatNumber(stats.numeric.max)}</td></tr>
                <tr><td>Mean</td><td class="num">${formatNumber(stats.numeric.mean)}</td></tr>
                <tr><td>Median</td><td class="num">${formatNumber(stats.numeric.median)}</td></tr>
                <tr><td>Std dev</td><td class="num">${formatNumber(stats.numeric.stdDev)}</td></tr>
                <tr><td>Sum</td><td class="num">${formatNumber(stats.numeric.sum)}</td></tr>` : '';

            const topRows = stats.top.map(([value, count]) => `
                <tr>
                    <td title="${escapeHtml(value)}">${escapeHtml(value.slice(0, 60)) || '<em>(empty)</em>'}</td>
                    <td class="num">${count.toLocaleString()}</td>
                    <td class="num">${((count / Math.max(1, stats.nonNull)) * 100).toFixed(1)}%</td>
                </tr>`).join('');

            return `
                <div class="stat-tile" style="grid-column:span 2;">
                    <div class="stat-label">${escapeHtml(column.name)}</div>
                    <div class="stat-sub" style="margin-bottom:0.75rem;font-family:var(--mono)">
                        ${escapeHtml(column.physical)}${column.logical ? ` · ${escapeHtml(column.logical)}` : ''}${column.repetition ? ` · ${escapeHtml(column.repetition)}` : ''}
                    </div>
                    <table class="data" style="font-size:0.75rem;">
                        <tbody>
                            <tr><td style="width:45%">Values</td><td class="num">${stats.count.toLocaleString()}</td></tr>
                            <tr><td>Nulls</td><td class="num">${stats.nulls.toLocaleString()} (${stats.nullPercent.toFixed(1)}%)</td></tr>
                            <tr><td>Distinct</td><td class="num">${stats.distinctCapped ? '&gt;10,000' : stats.distinct.toLocaleString()}</td></tr>
                            <tr><td>Length range</td><td class="num">${stats.minLength}–${stats.maxLength}</td></tr>
                            ${numericRows}
                        </tbody>
                    </table>
                    ${topRows ? `
                        <div class="stat-label" style="margin-top:0.75rem;">Most frequent</div>
                        <table class="data" style="font-size:0.72rem;">
                            <tbody>${topRows}</tbody>
                        </table>` : ''}
                </div>`;
        }).join('');

        return `
            <p class="helper-text" style="margin-bottom:1rem;">
                Computed from the ${rows.length.toLocaleString()} rows currently in view${this.filterText.trim() ? ' (filter applied)' : ''}.
            </p>
            <div class="stat-grid" style="grid-template-columns:repeat(auto-fit,minmax(260px,1fr));">${cards}</div>`;
    }

    renderSchema() {
        const columns = this.activeColumns();
        const file = this.combined ? null : this.files[this.activeIndex];

        // Footer statistics, aggregated across row groups
        const footerStats = new Map();
        if (file) {
            for (const group of file.metadata.row_groups) {
                for (const column of group.columns) {
                    // Roll nested leaves (tags.list.element) up into their
                    // top-level column (tags), which is what the table shows.
                    const name = column.meta_data?.path_in_schema?.[0];
                    if (!name) continue;
                    const entry = footerStats.get(name) || {
                        compressed: 0, uncompressed: 0, values: 0, nulls: 0,
                        codec: column.meta_data.codec, encodings: new Set(),
                    };
                    entry.compressed += Number(column.meta_data.total_compressed_size || 0);
                    entry.uncompressed += Number(column.meta_data.total_uncompressed_size || 0);
                    entry.values += Number(column.meta_data.num_values || 0);
                    entry.nulls += Number(column.meta_data.statistics?.null_count || 0);
                    (column.meta_data.encodings || []).forEach((e) => entry.encodings.add(e));
                    footerStats.set(name, entry);
                }
            }
        }

        return `
            <div class="table-wrap">
                <table class="data">
                    <thead>
                        <tr>
                            <th>Column</th><th>Physical type</th><th>Logical type</th><th>Repetition</th>
                            ${file ? '<th>Codec</th><th>Compressed</th><th>Raw</th><th>Ratio</th><th>Nulls</th><th>Encodings</th>' : ''}
                        </tr>
                    </thead>
                    <tbody>
                        ${columns.map((column) => {
                            const stats = footerStats.get(column.name);
                            return `
                                <tr>
                                    <td><strong>${escapeHtml(column.name)}</strong></td>
                                    <td>${escapeHtml(column.physical)}</td>
                                    <td>${escapeHtml(column.logical || '—')}</td>
                                    <td>${escapeHtml(column.repetition || '—')}</td>
                                    ${file ? (stats ? `
                                        <td>${escapeHtml(stats.codec || '—')}</td>
                                        <td class="num">${formatBytes(stats.compressed)}</td>
                                        <td class="num">${formatBytes(stats.uncompressed)}</td>
                                        <td class="num">${stats.compressed ? `${(stats.uncompressed / stats.compressed).toFixed(2)}×` : '—'}</td>
                                        <td class="num">${stats.nulls.toLocaleString()}</td>
                                        <td style="max-width:none;font-size:0.7rem">${escapeHtml([...stats.encodings].join(', '))}</td>
                                    ` : '<td colspan="6">—</td>') : ''}
                                </tr>`;
                        }).join('')}
                    </tbody>
                </table>
            </div>
            <div class="btn-row" style="margin-top:1rem;">
                <button class="action-btn secondary" id="pqCopySchema">Copy schema as JSON</button>
            </div>
        `;
    }

    /** Called after renderSchema()'s markup is in the DOM. */
    bindSchemaActions() {
        document.getElementById('pqCopySchema')?.addEventListener('click', () => {
            copyText(JSON.stringify(this.activeColumns(), null, 2), 'Schema copied');
        });
    }

    renderFileMetadata() {
        if (this.combined) {
            return '<div class="info-box">File metadata is per-file. Select a single file from the list above to see it.</div>';
        }

        const file = this.files[this.activeIndex];
        const metadata = file.metadata;
        const rows = Number(metadata.num_rows);

        let compressed = 0;
        let uncompressed = 0;
        for (const group of metadata.row_groups) {
            for (const column of group.columns) {
                compressed += Number(column.meta_data?.total_compressed_size || 0);
                uncompressed += Number(column.meta_data?.total_uncompressed_size || 0);
            }
        }

        const codecs = new Set();
        const encodings = new Set();
        for (const group of metadata.row_groups) {
            for (const column of group.columns) {
                if (column.meta_data?.codec) codecs.add(column.meta_data.codec);
                (column.meta_data?.encodings || []).forEach((e) => encodings.add(e));
            }
        }

        const keyValues = metadata.key_value_metadata || [];

        return `
            <div class="stat-grid">
                <div class="stat-tile"><div class="stat-label">Rows</div><div class="stat-value">${rows.toLocaleString()}</div></div>
                <div class="stat-tile"><div class="stat-label">Columns</div><div class="stat-value">${file.columns.length}</div></div>
                <div class="stat-tile"><div class="stat-label">Row groups</div><div class="stat-value">${metadata.row_groups.length}</div></div>
                <div class="stat-tile"><div class="stat-label">File size</div><div class="stat-value" style="font-size:1.2rem">${formatBytes(file.size)}</div></div>
                <div class="stat-tile">
                    <div class="stat-label">Column data</div>
                    <div class="stat-value" style="font-size:1.2rem">${formatBytes(compressed)}</div>
                    <div class="stat-sub">${formatBytes(uncompressed)} uncompressed</div>
                </div>
                <div class="stat-tile">
                    <div class="stat-label">Compression</div>
                    <div class="stat-value">${compressed ? `${(uncompressed / compressed).toFixed(2)}×` : '—'}</div>
                    <div class="stat-sub">${[...codecs].join(', ') || 'none'}</div>
                </div>
                <div class="stat-tile">
                    <div class="stat-label">Bytes per row</div>
                    <div class="stat-value" style="font-size:1.2rem">${rows ? (compressed / rows).toFixed(1) : '—'}</div>
                </div>
                <div class="stat-tile">
                    <div class="stat-label">Total values</div>
                    <div class="stat-value">${(rows * file.columns.length).toLocaleString()}</div>
                    <div class="stat-sub">rows × columns</div>
                </div>
            </div>

            <h3 style="margin-top:1.5rem;">Row groups</h3>
            <div class="table-wrap" style="max-height:300px;">
                <table class="data">
                    <thead><tr><th>#</th><th>Rows</th><th>Compressed</th><th>Uncompressed</th><th>Ratio</th></tr></thead>
                    <tbody>
                        ${metadata.row_groups.map((group, index) => {
                            const groupCompressed = group.columns.reduce((s, c) => s + Number(c.meta_data?.total_compressed_size || 0), 0);
                            const groupRaw = group.columns.reduce((s, c) => s + Number(c.meta_data?.total_uncompressed_size || 0), 0);
                            return `<tr>
                                <td class="num">${index}</td>
                                <td class="num">${Number(group.num_rows).toLocaleString()}</td>
                                <td class="num">${formatBytes(groupCompressed)}</td>
                                <td class="num">${formatBytes(groupRaw)}</td>
                                <td class="num">${groupCompressed ? `${(groupRaw / groupCompressed).toFixed(2)}×` : '—'}</td>
                            </tr>`;
                        }).join('')}
                    </tbody>
                </table>
            </div>

            <h3 style="margin-top:1.5rem;">Footer</h3>
            <div class="table-wrap">
                <table class="data">
                    <tbody>
                        <tr><td style="width:200px"><strong>Created by</strong></td><td style="max-width:none">${escapeHtml(metadata.created_by || '(not recorded)')}</td></tr>
                        <tr><td><strong>Format version</strong></td><td>${escapeHtml(String(metadata.version ?? '—'))}</td></tr>
                        <tr><td><strong>Encodings used</strong></td><td style="max-width:none">${escapeHtml([...encodings].join(', ') || '—')}</td></tr>
                        ${keyValues.map((kv) => `
                            <tr>
                                <td><strong>${escapeHtml(kv.key)}</strong></td>
                                <td style="max-width:none;white-space:normal;word-break:break-all;font-size:0.72rem">${escapeHtml(String(kv.value ?? '').slice(0, 1200))}</td>
                            </tr>`).join('')}
                    </tbody>
                </table>
            </div>`;
    }

    renderCompare() {
        const usable = this.files.filter((file) => !file.error);
        if (usable.length < 2) {
            return '<div class="info-box">Load at least two readable files to compare them.</div>';
        }

        const allColumns = [...new Set(usable.flatMap((file) => file.columns.map((c) => c.name)))];

        const typeOf = (file, name) => {
            const column = file.columns.find((c) => c.name === name);
            if (!column) return null;
            return column.logical || column.physical;
        };

        const rows = allColumns.map((name) => {
            const types = usable.map((file) => typeOf(file, name));
            const present = types.filter(Boolean);
            const consistent = present.length === usable.length && new Set(present).size === 1;
            return { name, types, consistent, missing: types.some((t) => t === null) };
        });

        const mismatches = rows.filter((row) => !row.consistent).length;

        return `
            <div class="alert ${mismatches ? 'warn' : 'ok'}">
                <span>${mismatches ? '!' : '✓'}</span>
                <span>${mismatches
                    ? `${mismatches} column${mismatches === 1 ? '' : 's'} differ between files — stacking them may produce mixed types.`
                    : 'All files share an identical schema — safe to stack.'}</span>
            </div>
            <div class="table-wrap">
                <table class="data">
                    <thead>
                        <tr><th>Column</th>${usable.map((file) => `<th title="${escapeHtml(file.name)}">${escapeHtml(file.name.slice(0, 22))}</th>`).join('')}</tr>
                    </thead>
                    <tbody>
                        ${rows.map((row) => `
                            <tr${row.consistent ? '' : ' style="background:color-mix(in srgb, var(--yellow) 14%, transparent)"'}>
                                <td><strong>${escapeHtml(row.name)}</strong></td>
                                ${row.types.map((type) => (type === null
                                    ? '<td class="nul">absent</td>'
                                    : `<td>${escapeHtml(type)}</td>`)).join('')}
                            </tr>`).join('')}
                    </tbody>
                </table>
            </div>
            <div class="stat-grid" style="margin-top:1rem;">
                ${usable.map((file) => `
                    <div class="stat-tile">
                        <div class="stat-label">${escapeHtml(file.name.slice(0, 26))}</div>
                        <div class="stat-value">${Number(file.metadata.num_rows).toLocaleString()}</div>
                        <div class="stat-sub">rows · ${file.columns.length} columns · ${formatBytes(file.size)}</div>
                    </div>`).join('')}
                <div class="stat-tile">
                    <div class="stat-label">Combined</div>
                    <div class="stat-value">${usable.reduce((sum, f) => sum + Number(f.metadata.num_rows), 0).toLocaleString()}</div>
                    <div class="stat-sub">rows across ${usable.length} files</div>
                </div>
            </div>`;
    }
}

export { parseFilter, displayValue };
