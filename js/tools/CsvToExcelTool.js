// CSV to Excel.
//
// Produces a genuine .xlsx workbook via SheetJS. (The previous version wrote an
// HTML table with an .xls extension, which makes Excel warn that the file's
// format and extension do not match.)
//
// Multiple CSV files become multiple sheets in one workbook.

import { BaseTool } from '../core/BaseTool.js';
import { libs } from '../lib/loader.js';
import { parseCsv, sniffDelimiter, coerce } from '../lib/tabular.js';
import { formatBytes } from '../lib/bytes.js';
import { toast, downloadBlob } from '../ui/toast.js';

const escapeHtml = (value) => String(value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const DELIMITER_NAMES = { ',': 'comma', ';': 'semicolon', '\t': 'tab', '|': 'pipe' };

/** Excel serial date, counting from 1899-12-30 to match Excel's epoch quirk. */
function excelSerial(date) {
    return (date.getTime() - Date.UTC(1899, 11, 30)) / 86400000;
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}(:\d{2})?)?Z?$/;

export class CsvToExcelTool extends BaseTool {
    constructor(config) {
        super(config);
        this.sheets = [];   // { name, rows }
    }

    render() {
        return `
            <div class="tool-interface" data-cat="data">
                <h2><span class="tool-icon">${this.icon}</span>${escapeHtml(this.name)}</h2>
                <p class="tool-lede">
                    Convert CSV into a real .xlsx workbook. Numbers and dates are written as native Excel
                    values rather than text, so formulas and sorting work. Everything happens in your browser.
                </p>

                <div class="tool-section">
                    <h3>Input</h3>
                    <input type="file" id="csvFiles" accept=".csv,.tsv,.txt" multiple class="file-input">
                    <div class="helper-text">Select several files to put each one on its own sheet, or paste below.</div>

                    <div style="margin-top:0.85rem;">
                        <label for="csvText">Or paste CSV</label>
                        <textarea id="csvText" class="short" spellcheck="false"
                            placeholder="name,age,city&#10;Ada,36,London&#10;Grace,85,Arlington"></textarea>
                    </div>
                </div>

                <div class="tool-section">
                    <h3>Options</h3>
                    <div class="field-group">
                        <div>
                            <label for="csvDelimiter">Delimiter</label>
                            <select id="csvDelimiter">
                                <option value="auto">Detect automatically</option>
                                <option value=",">Comma</option>
                                <option value=";">Semicolon</option>
                                <option value="&#9;">Tab</option>
                                <option value="|">Pipe</option>
                            </select>
                        </div>
                        <div>
                            <label for="csvSheetName">Sheet name (pasted input)</label>
                            <input type="text" id="csvSheetName" value="Sheet1" placeholder="Sheet1">
                        </div>
                    </div>
                    <div class="opt-row">
                        <label class="check"><input type="checkbox" id="csvHeader" checked> First row is a header</label>
                        <label class="check"><input type="checkbox" id="csvTypes" checked> Convert numbers and dates</label>
                        <label class="check"><input type="checkbox" id="csvTrim" checked> Trim cell whitespace</label>
                        <label class="check"><input type="checkbox" id="csvSkipEmpty" checked> Skip blank rows</label>
                    </div>
                </div>

                <div class="btn-row">
                    <button class="action-btn" id="csvConvert">Convert</button>
                    <button class="action-btn secondary" id="csvDownload" disabled>Download .xlsx</button>
                    <button class="action-btn secondary" id="csvClear">Clear</button>
                </div>

                <div id="csvStatus"></div>
                <div id="csvPreview"></div>
            </div>
        `;
    }

    onOpen() {
        setTimeout(() => {
            document.getElementById('csvFiles')?.addEventListener('change', (event) => {
                this.loadFiles([...event.target.files]);
            });
            document.getElementById('csvConvert')?.addEventListener('click', () => this.convert());
            document.getElementById('csvDownload')?.addEventListener('click', () => this.download());
            document.getElementById('csvClear')?.addEventListener('click', () => {
                this.sheets = [];
                document.getElementById('csvText').value = '';
                document.getElementById('csvFiles').value = '';
                document.getElementById('csvPreview').innerHTML = '';
                this.setStatus('');
                document.getElementById('csvDownload').disabled = true;
            });
        }, 0);
    }

    onClose() {
        this.sheets = [];
    }

    setStatus(message, kind = 'info') {
        const node = document.getElementById('csvStatus');
        if (!node) return;
        node.innerHTML = message
            ? `<div class="alert ${kind}"><span>${kind === 'err' ? '✕' : kind === 'ok' ? '✓' : 'ℹ'}</span><span>${escapeHtml(message)}</span></div>`
            : '';
    }

    async loadFiles(files) {
        if (!files.length) return;
        this.pendingFiles = [];
        for (const file of files) {
            // eslint-disable-next-line no-await-in-loop
            this.pendingFiles.push({ name: file.name, text: await file.text(), size: file.size });
        }
        this.setStatus(`${files.length} file${files.length === 1 ? '' : 's'} read — press Convert.`, 'ok');
        this.convert();
    }

    readOptions() {
        return {
            delimiter: document.getElementById('csvDelimiter').value,
            header: document.getElementById('csvHeader').checked,
            types: document.getElementById('csvTypes').checked,
            trim: document.getElementById('csvTrim').checked,
            skipEmpty: document.getElementById('csvSkipEmpty').checked,
            sheetName: document.getElementById('csvSheetName').value.trim() || 'Sheet1',
        };
    }

    /** Excel sheet names: max 31 chars, and : \ / ? * [ ] are forbidden. */
    safeSheetName(name, taken) {
        let clean = name.replace(/\.(csv|tsv|txt)$/i, '').replace(/[:\\/?*[\]]/g, '_').slice(0, 31) || 'Sheet';
        let candidate = clean;
        let counter = 2;
        while (taken.has(candidate)) {
            const suffix = `_${counter++}`;
            candidate = clean.slice(0, 31 - suffix.length) + suffix;
        }
        taken.add(candidate);
        return candidate;
    }

    convert() {
        const options = this.readOptions();
        const inputs = [];

        const pasted = document.getElementById('csvText').value;
        if (pasted.trim()) inputs.push({ name: options.sheetName, text: pasted });
        for (const file of this.pendingFiles || []) inputs.push({ name: file.name, text: file.text });

        if (!inputs.length) {
            this.setStatus('Paste some CSV or choose a file first.', 'err');
            return;
        }

        const taken = new Set();
        this.sheets = [];

        try {
            for (const input of inputs) {
                const delimiter = options.delimiter === 'auto' ? sniffDelimiter(input.text) : options.delimiter;
                let rows = parseCsv(input.text, delimiter);

                if (options.trim) rows = rows.map((row) => row.map((cell) => cell.trim()));
                if (options.skipEmpty) rows = rows.filter((row) => row.some((cell) => cell !== ''));
                if (!rows.length) continue;

                const converted = rows.map((row, rowIndex) => row.map((cell) => {
                    if (options.header && rowIndex === 0) return cell;
                    if (!options.types) return cell;
                    if (DATE_PATTERN.test(cell.trim())) {
                        const date = new Date(cell.trim().replace(' ', 'T'));
                        if (!Number.isNaN(date.getTime())) return date;
                    }
                    return coerce(cell);
                }));

                this.sheets.push({
                    name: this.safeSheetName(input.name, taken),
                    rows: converted,
                    delimiter,
                });
            }

            if (!this.sheets.length) {
                this.setStatus('Nothing to convert — the input had no usable rows.', 'err');
                return;
            }

            document.getElementById('csvDownload').disabled = false;
            const totalRows = this.sheets.reduce((sum, sheet) => sum + sheet.rows.length, 0);
            this.setStatus(
                `Ready: ${this.sheets.length} sheet${this.sheets.length === 1 ? '' : 's'}, ${totalRows.toLocaleString()} rows.`,
                'ok',
            );
            this.renderPreview(options);
        } catch (err) {
            this.setStatus(err.message, 'err');
            document.getElementById('csvDownload').disabled = true;
        }
    }

    renderPreview(options) {
        const node = document.getElementById('csvPreview');
        if (!node) return;

        node.innerHTML = this.sheets.map((sheet) => {
            const preview = sheet.rows.slice(0, options.header ? 11 : 10);
            const header = options.header ? sheet.rows[0] : null;
            const body = options.header ? preview.slice(1) : preview;
            const width = Math.max(...sheet.rows.map((row) => row.length));

            const cell = (value) => {
                if (value === null || value === undefined || value === '') return '<td class="nul">empty</td>';
                if (value instanceof Date) return `<td class="num" title="date">${escapeHtml(value.toISOString().slice(0, 10))}</td>`;
                if (typeof value === 'number') return `<td class="num" title="number">${escapeHtml(String(value))}</td>`;
                if (typeof value === 'boolean') return `<td class="num" title="boolean">${value}</td>`;
                return `<td title="text">${escapeHtml(String(value).slice(0, 120))}</td>`;
            };

            return `
                <div class="tool-section">
                    <h3>${escapeHtml(sheet.name)} — ${sheet.rows.length.toLocaleString()} rows × ${width} columns
                        <span class="chip" style="margin-left:0.5rem">${DELIMITER_NAMES[sheet.delimiter] || sheet.delimiter}-delimited</span>
                    </h3>
                    <div class="table-wrap" style="max-height:320px;">
                        <table class="data">
                            ${header ? `<thead><tr><th class="row-index">#</th>${header.map((h) => `<th>${escapeHtml(h)}</th>`).join('')}</tr></thead>` : ''}
                            <tbody>
                                ${body.map((row, i) => `
                                    <tr><td class="row-index">${i + 1}</td>${Array.from({ length: width }, (_, c) => cell(row[c])).join('')}</tr>
                                `).join('')}
                            </tbody>
                        </table>
                    </div>
                    ${sheet.rows.length > preview.length
                        ? `<div class="helper-text">Showing the first ${body.length} rows of ${sheet.rows.length.toLocaleString()}.</div>`
                        : ''}
                </div>`;
        }).join('');
    }

    async download() {
        if (!this.sheets.length) {
            toast('Convert something first', 'err');
            return;
        }

        const button = document.getElementById('csvDownload');
        button.disabled = true;
        button.textContent = 'Building…';

        try {
            const XLSX = await libs.xlsx();
            const workbook = XLSX.utils.book_new();

            for (const sheet of this.sheets) {
                const worksheet = XLSX.utils.aoa_to_sheet(sheet.rows, { cellDates: true });

                // Give date cells a sensible display format.
                for (const address of Object.keys(worksheet)) {
                    if (address.startsWith('!')) continue;
                    const cell = worksheet[address];
                    if (cell.t === 'd') cell.z = 'yyyy-mm-dd';
                }

                // Approximate column widths from the content.
                const width = Math.max(...sheet.rows.map((row) => row.length));
                worksheet['!cols'] = Array.from({ length: width }, (_, column) => {
                    const longest = sheet.rows.reduce((max, row) => {
                        const value = row[column];
                        const text = value instanceof Date
                            ? 10
                            : String(value ?? '').length;
                        return Math.max(max, text);
                    }, 8);
                    return { wch: Math.min(60, longest + 2) };
                });

                XLSX.utils.book_append_sheet(workbook, worksheet, sheet.name);
            }

            const buffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
            const blob = new Blob([buffer], {
                type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            });

            const name = this.sheets.length === 1 ? `${this.sheets[0].name}.xlsx` : 'workbook.xlsx';
            downloadBlob(blob, name);
            this.setStatus(`Downloaded ${name} (${formatBytes(blob.size)}).`, 'ok');
            toast(`Saved ${name}`);
        } catch (err) {
            this.setStatus(`Could not build the workbook: ${err.message}`, 'err');
        } finally {
            button.disabled = false;
            button.textContent = 'Download .xlsx';
        }
    }
}
