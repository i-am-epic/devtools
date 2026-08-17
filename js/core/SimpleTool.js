// Declarative tool engine.
//
// Most tools on this site are "text in, text out, with a few options". Rather
// than hand-writing a class per tool, those are described as a spec object and
// this class renders + wires the whole interface. Tools that need a bespoke UI
// (Parquet, Service Bus, diff, QR, ...) still get their own class.
//
// Spec shape:
//   {
//     lede:        string shown under the title
//     layout:      'io' (input + output panes, default) | 'output' (generators)
//     input:       { label, placeholder, sample, accept, binary, rows }
//     output:      { label, mono, filename, language }
//     options:     [ { id, type, label, choices, default, min, max, step, hint } ]
//     live:        recompute as you type (default true)
//     actionLabel: label of the primary button (default 'Run')
//     run:         ({ input, options, bytes, tool }) => string | ResultObject | Promise<...>
//   }
//
// `run` may return a plain string, or:
//   { output, extraHtml, note, filename, outputIsHtml }
// and may throw — the message is shown in a friendly error banner.

import { BaseTool } from './BaseTool.js';
import { toast, copyText, downloadText } from '../ui/toast.js';

const escapeHtml = (value) => String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

let uid = 0;

export class SimpleTool extends BaseTool {
    constructor(config, spec) {
        super(config);
        this.spec = spec;
        this.ns = `st${++uid}`;
        this.lastResult = '';
        this.fileBytes = null;
        this.fileName = '';
    }

    // ---- ids scoped to this instance so nothing collides in the modal ----
    id_(name) { return `${this.ns}_${name}`; }
    el(name) { return document.getElementById(this.id_(name)); }

    // ------------------------------------------------------------ render --

    render() {
        const spec = this.spec;
        const layout = spec.layout || 'io';

        return `
            <div class="tool-interface" data-cat="${escapeHtml(this.category)}">
                <h2><span class="tool-icon">${this.icon}</span>${escapeHtml(this.name)}</h2>
                <p class="tool-lede">${escapeHtml(spec.lede || this.description)}</p>

                ${this.renderOptions()}

                ${layout === 'io' ? this.renderIoPanes() : this.renderOutputOnly()}

                <div id="${this.id_('error')}"></div>

                <div class="btn-row" style="margin-top:1rem;">
                    ${spec.live === false || layout !== 'io'
                        ? `<button class="action-btn" id="${this.id_('run')}">${escapeHtml(spec.actionLabel || 'Run')}</button>`
                        : ''}
                    ${spec.swap ? `<button class="action-btn secondary" id="${this.id_('swap')}">⇄ Swap panes</button>` : ''}
                </div>

                <div id="${this.id_('extra')}"></div>

                ${spec.footnote ? `<div class="info-box" style="margin-top:1.5rem;">${spec.footnote}</div>` : ''}
            </div>
        `;
    }

    renderOptions() {
        const options = this.spec.options || [];
        if (!options.length) return '';

        const checkboxes = options.filter((o) => o.type === 'checkbox');
        const others = options.filter((o) => o.type !== 'checkbox');

        return `
            <div class="tool-section">
                <h3>Options</h3>
                ${others.length ? `<div class="field-group">${others.map((o) => this.renderOption(o)).join('')}</div>` : ''}
                ${checkboxes.length ? `<div class="opt-row">${checkboxes.map((o) => this.renderOption(o)).join('')}</div>` : ''}
            </div>
        `;
    }

    renderOption(option) {
        const id = this.id_(`opt_${option.id}`);
        switch (option.type) {
            case 'select':
                return `
                    <div>
                        <label for="${id}">${escapeHtml(option.label)}</label>
                        <select id="${id}" data-opt="${option.id}">
                            ${option.choices.map((choice) => {
                                const value = typeof choice === 'string' ? choice : choice.value;
                                const text = typeof choice === 'string' ? choice : choice.label;
                                return `<option value="${escapeHtml(value)}"${value === option.default ? ' selected' : ''}>${escapeHtml(text)}</option>`;
                            }).join('')}
                        </select>
                        ${option.hint ? `<div class="helper-text">${escapeHtml(option.hint)}</div>` : ''}
                    </div>`;
            case 'checkbox':
                return `
                    <label class="check">
                        <input type="checkbox" id="${id}" data-opt="${option.id}"${option.default ? ' checked' : ''}>
                        ${escapeHtml(option.label)}
                    </label>`;
            case 'number':
                return `
                    <div>
                        <label for="${id}">${escapeHtml(option.label)}</label>
                        <input type="number" id="${id}" data-opt="${option.id}"
                               value="${option.default ?? ''}"
                               ${option.min !== undefined ? `min="${option.min}"` : ''}
                               ${option.max !== undefined ? `max="${option.max}"` : ''}
                               ${option.step !== undefined ? `step="${option.step}"` : ''}>
                        ${option.hint ? `<div class="helper-text">${escapeHtml(option.hint)}</div>` : ''}
                    </div>`;
            case 'text':
            default:
                return `
                    <div>
                        <label for="${id}">${escapeHtml(option.label)}</label>
                        <input type="text" id="${id}" data-opt="${option.id}"
                               value="${escapeHtml(option.default ?? '')}"
                               placeholder="${escapeHtml(option.placeholder || '')}">
                        ${option.hint ? `<div class="helper-text">${escapeHtml(option.hint)}</div>` : ''}
                    </div>`;
        }
    }

    renderIoPanes() {
        const input = this.spec.input || {};
        const output = this.spec.output || {};

        return `
            <div class="io-grid">
                <div class="io-pane">
                    <div class="io-pane-head">
                        <h3>${escapeHtml(input.label || 'Input')}</h3>
                        <div class="io-pane-actions">
                            ${input.sample !== undefined ? `<button class="mini-btn" id="${this.id_('sample')}">Sample</button>` : ''}
                            ${input.accept ? `<button class="mini-btn" id="${this.id_('pick')}">File</button>` : ''}
                            <button class="mini-btn" id="${this.id_('clear')}">Clear</button>
                        </div>
                    </div>
                    <textarea id="${this.id_('input')}" spellcheck="false"
                        placeholder="${escapeHtml(input.placeholder || 'Paste your input here…')}"></textarea>
                    ${input.accept ? `<input type="file" id="${this.id_('file')}" accept="${escapeHtml(input.accept)}" style="display:none">` : ''}
                    <div class="helper-text" id="${this.id_('inMeta')}"></div>
                </div>

                <div class="io-pane">
                    <div class="io-pane-head">
                        <h3>${escapeHtml(output.label || 'Output')}</h3>
                        <div class="io-pane-actions">
                            <button class="mini-btn" id="${this.id_('copy')}">Copy</button>
                            <button class="mini-btn" id="${this.id_('download')}">Save</button>
                        </div>
                    </div>
                    <textarea id="${this.id_('output')}" spellcheck="false" readonly
                        placeholder="Result appears here…"></textarea>
                    <div class="helper-text" id="${this.id_('outMeta')}"></div>
                </div>
            </div>
        `;
    }

    renderOutputOnly() {
        const output = this.spec.output || {};
        return `
            <div class="io-pane">
                <div class="io-pane-head">
                    <h3>${escapeHtml(output.label || 'Output')}</h3>
                    <div class="io-pane-actions">
                        <button class="mini-btn" id="${this.id_('copy')}">Copy</button>
                        <button class="mini-btn" id="${this.id_('download')}">Save</button>
                    </div>
                </div>
                <textarea id="${this.id_('output')}" spellcheck="false" readonly
                    placeholder="Press ${escapeHtml(this.spec.actionLabel || 'Run')}…"></textarea>
                <div class="helper-text" id="${this.id_('outMeta')}"></div>
            </div>
        `;
    }

    // -------------------------------------------------------------- wire --

    onOpen() {
        // The modal writes innerHTML synchronously before calling onOpen, but a
        // microtask keeps this robust if that ever changes.
        setTimeout(() => this.bind(), 0);
    }

    bind() {
        const input = this.el('input');
        const live = this.spec.live !== false && (this.spec.layout || 'io') === 'io';

        if (input) {
            const debounced = this.debounce(() => this.execute('input'), 140);
            input.addEventListener('input', () => {
                this.updateInputMeta();
                if (live) debounced();
            });
        }

        // Options re-run immediately
        document.querySelectorAll(`[id^="${this.ns}_opt_"]`).forEach((node) => {
            node.addEventListener('change', () => this.execute('user'));
            if (node.type === 'text' || node.type === 'number') {
                node.addEventListener('input', this.debounce(() => this.execute('input'), 200));
            }
        });

        this.el('run')?.addEventListener('click', () => this.execute('user'));
        this.el('copy')?.addEventListener('click', () => copyText(this.el('output')?.value || ''));
        this.el('download')?.addEventListener('click', () => this.save());
        this.el('clear')?.addEventListener('click', () => {
            if (input) input.value = '';
            this.fileBytes = null;
            this.fileName = '';
            this.setOutput('');
            this.setError(null);
            this.setExtra('');
            this.updateInputMeta();
            input?.focus();
        });

        this.el('sample')?.addEventListener('click', () => {
            if (input) input.value = this.spec.input.sample;
            this.updateInputMeta();
            this.execute('user');
        });

        this.el('pick')?.addEventListener('click', () => this.el('file')?.click());
        this.el('file')?.addEventListener('change', (event) => this.loadFile(event.target.files[0]));

        this.el('swap')?.addEventListener('click', () => {
            const output = this.el('output');
            if (!input || !output || !output.value) return;
            input.value = output.value;
            this.updateInputMeta();
            this.execute();
        });

        this.updateInputMeta();

        // Generators produce something useful immediately.
        if ((this.spec.layout || 'io') !== 'io' && this.spec.autoRun !== false) this.execute();
        else if (input?.value) this.execute();
    }

    debounce(fn, ms) {
        let handle;
        return (...args) => {
            clearTimeout(handle);
            handle = setTimeout(() => fn(...args), ms);
        };
    }

    async loadFile(file) {
        if (!file) return;
        this.fileName = file.name;
        try {
            if (this.spec.input.binary) {
                this.fileBytes = new Uint8Array(await file.arrayBuffer());
                const input = this.el('input');
                if (input) input.value = `[${file.name} — ${this.fileBytes.length} bytes loaded]`;
            } else {
                const text = await file.text();
                const input = this.el('input');
                if (input) input.value = text;
            }
            this.updateInputMeta();
            this.execute();
            toast(`Loaded ${file.name}`);
        } catch (err) {
            this.setError(`Could not read ${file.name}: ${err.message}`);
        }
    }

    // ------------------------------------------------------------- execute --

    /**
     * @param {'auto'|'user'|'input'} trigger why this ran. Tools that copy to
     *   the clipboard need to know: a write without a user gesture is blocked
     *   by the browser, and silently copying while someone types is hostile.
     */
    async execute(trigger = 'auto') {
        const inputNode = this.el('input');
        const value = inputNode ? inputNode.value : '';
        const options = this.readOptions();

        // Don't shout at the user about empty input before they've typed.
        if (inputNode && value.trim() === '' && !this.fileBytes) {
            this.setOutput('');
            this.setError(null);
            this.setExtra('');
            this.updateOutputMeta(0);
            return;
        }

        try {
            const result = await this.spec.run({
                input: value,
                options,
                bytes: this.fileBytes,
                fileName: this.fileName,
                trigger,
                tool: this,
            });

            const payload = typeof result === 'string' || result == null
                ? { output: result ?? '' }
                : result;

            this.setOutput(payload.output ?? '');
            this.setExtra(payload.extraHtml || '');
            this.setError(null);
            this.updateOutputMeta(payload.output?.length ?? 0, payload.note);
            if (payload.filename) this.downloadName = payload.filename;
        } catch (err) {
            this.setOutput('');
            this.setExtra('');
            this.setError(err.message || String(err));
            this.updateOutputMeta(0);
        }
    }

    readOptions() {
        const values = {};
        for (const option of this.spec.options || []) {
            const node = this.el(`opt_${option.id}`);
            if (!node) {
                values[option.id] = option.default;
                continue;
            }
            if (option.type === 'checkbox') values[option.id] = node.checked;
            else if (option.type === 'number') values[option.id] = node.value === '' ? option.default : Number(node.value);
            else values[option.id] = node.value;
        }
        return values;
    }

    // --------------------------------------------------------------- view --

    setOutput(text) {
        const node = this.el('output');
        if (node) node.value = text;
        this.lastResult = text;
    }

    setExtra(html) {
        const node = this.el('extra');
        if (!node) return;
        node.innerHTML = html;
        // Stop the editor stretching once there is real content below it.
        node.closest('.tool-interface')?.classList.toggle('has-extra', Boolean(html));
    }

    setError(message) {
        const node = this.el('error');
        if (!node) return;
        node.innerHTML = message
            ? `<div class="alert err"><span>✕</span><span>${escapeHtml(message)}</span></div>`
            : '';
    }

    setNotice(message, kind = 'info') {
        const node = this.el('error');
        if (!node) return;
        node.innerHTML = message
            ? `<div class="alert ${kind}"><span>${kind === 'ok' ? '✓' : 'ℹ'}</span><span>${escapeHtml(message)}</span></div>`
            : '';
    }

    updateInputMeta() {
        const node = this.el('inMeta');
        const input = this.el('input');
        if (!node || !input) return;
        const text = input.value;
        if (!text) { node.textContent = ''; return; }
        const bytes = new TextEncoder().encode(text).length;
        node.textContent = `${text.length.toLocaleString()} chars · ${bytes.toLocaleString()} bytes · ${text.split('\n').length.toLocaleString()} lines`;
    }

    updateOutputMeta(length, note) {
        const node = this.el('outMeta');
        if (!node) return;
        if (note) { node.textContent = note; return; }
        node.textContent = length ? `${length.toLocaleString()} chars` : '';
    }

    save() {
        const text = this.el('output')?.value || '';
        if (!text) { toast('Nothing to save', 'err'); return; }
        const name = this.downloadName || this.spec.output?.filename || `${this.id}.txt`;
        downloadText(text, name);
        toast(`Saved ${name}`);
    }

    onClose() {
        this.fileBytes = null;
        this.fileName = '';
    }
}

export { escapeHtml };
