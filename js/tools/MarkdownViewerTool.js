// Markdown reader.
//
// Opens a .md file (or pasted text) and renders it the way a repository would:
// GFM tables, task lists, fenced code, footnotes, autolinks, heading anchors,
// a generated table of contents, and Mermaid diagrams rendered in place.
//
// Rendered HTML is sanitised before it goes into the page, because Markdown
// permits raw HTML and the input is arbitrary.

import { BaseTool } from '../core/BaseTool.js';
import { libs } from '../lib/loader.js';
import { sanitizeHtml, slugify } from '../lib/sanitize.js';
import { formatBytes } from '../lib/bytes.js';
import { toast, copyText, downloadText } from '../ui/toast.js';

const escapeHtml = (value) => String(value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const SAMPLE = `# Release notes

> Everything below renders the way GitHub would.

## Checklist

- [x] Tables
- [x] Fenced code
- [ ] Something still to do

## A table

| Tool | Status | Notes |
| ---- | :----: | ----- |
| Parquet viewer | done | reads real files |
| Service Bus | done | needs the relay |

## Some code

\`\`\`js
const answer = 42;
console.log(\`the answer is \${answer}\`);
\`\`\`

## A diagram

\`\`\`mermaid
flowchart LR
    A[Markdown] --> B{Fenced block?}
    B -->|mermaid| C[Render diagram]
    B -->|other| D[Highlight code]
    C --> E[Done]
    D --> E
\`\`\`

## A sequence diagram

\`\`\`mermaid
sequenceDiagram
    Browser->>Relay: POST /api/servicebus
    Relay->>Azure: signed REST call
    Azure-->>Relay: 201 Created
    Relay-->>Browser: { ok: true }
\`\`\`

---

Ordinary text with **bold**, *italic*, \`inline code\`, a [link](https://example.com)
and a footnote reference.[^1]

[^1]: Footnotes are supported too.
`;

export class MarkdownViewerTool extends BaseTool {
    constructor(config) {
        super(config);
        this.source = '';
        this.fileName = '';
        this.diagramCount = 0;
    }

    render() {
        return `
            <div class="tool-interface" data-cat="web">
                <h2><span class="tool-icon">${this.icon}</span>${escapeHtml(this.name)}</h2>
                <p class="tool-lede">
                    Open a Markdown file or paste it in. Tables, task lists, footnotes, heading anchors
                    and Mermaid diagrams all render. Everything happens in your browser.
                </p>

                <div class="tool-section">
                    <input type="file" id="mdFile" accept=".md,.markdown,.mdown,.mkd,.txt" class="file-input">
                    <div class="helper-text">Or paste below. Drag a file onto the box works too.</div>
                </div>

                <div class="tool-section">
                    <div class="io-pane-head">
                        <h3>Markdown</h3>
                        <div class="io-pane-actions">
                            <button class="mini-btn" id="mdSample">Sample</button>
                            <button class="mini-btn" id="mdClear">Clear</button>
                        </div>
                    </div>
                    <textarea id="mdSource" class="short" spellcheck="false"
                        placeholder="# Paste your Markdown here"></textarea>
                    <div class="helper-text" id="mdMeta"></div>
                </div>

                <div class="tool-section">
                    <div class="opt-row">
                        <label class="check"><input type="checkbox" id="mdToc" checked> Table of contents</label>
                        <label class="check"><input type="checkbox" id="mdMermaid" checked> Render Mermaid diagrams</label>
                        <label class="check"><input type="checkbox" id="mdBreaks"> Single newline = line break</label>
                        <label class="check"><input type="checkbox" id="mdNumbers"> Number the headings</label>
                    </div>
                    <div class="btn-row">
                        <button class="action-btn" id="mdRender">Render</button>
                        <button class="action-btn secondary" id="mdCopyHtml">Copy HTML</button>
                        <button class="action-btn secondary" id="mdSaveHtml">Save as HTML</button>
                        <button class="action-btn secondary" id="mdPrint">Print / PDF</button>
                    </div>
                </div>

                <div id="mdStatus"></div>

                <div class="tool-section" id="mdDocWrap" style="display:none;">
                    <h3>Document</h3>
                    <div class="md-layout">
                        <nav class="md-toc" id="mdTocPanel" aria-label="Table of contents"></nav>
                        <article class="agent-body md-doc" id="mdDoc"></article>
                    </div>
                </div>
            </div>
        `;
    }

    onOpen() {
        setTimeout(() => {
            const source = document.getElementById('mdSource');

            document.getElementById('mdFile')?.addEventListener('change', (event) => {
                this.loadFile(event.target.files?.[0]);
            });

            document.getElementById('mdSample')?.addEventListener('click', () => {
                source.value = SAMPLE;
                this.fileName = 'sample.md';
                this.updateMeta();
                this.renderDocument();
            });

            document.getElementById('mdClear')?.addEventListener('click', () => {
                source.value = '';
                this.fileName = '';
                this.updateMeta();
                document.getElementById('mdDocWrap').style.display = 'none';
                this.setStatus('');
            });

            document.getElementById('mdRender')?.addEventListener('click', () => this.renderDocument());
            document.getElementById('mdCopyHtml')?.addEventListener('click', () => this.copyHtml());
            document.getElementById('mdSaveHtml')?.addEventListener('click', () => this.saveHtml());
            document.getElementById('mdPrint')?.addEventListener('click', () => this.printDocument());

            ['mdToc', 'mdMermaid', 'mdBreaks', 'mdNumbers'].forEach((id) => {
                document.getElementById(id)?.addEventListener('change', () => {
                    if (document.getElementById('mdSource').value.trim()) this.renderDocument();
                });
            });

            let debounce;
            source?.addEventListener('input', () => {
                this.updateMeta();
                clearTimeout(debounce);
                debounce = setTimeout(() => this.renderDocument(), 600);
            });

            // Drag and drop
            source?.addEventListener('dragover', (event) => {
                event.preventDefault();
                source.style.borderColor = 'var(--accent)';
            });
            source?.addEventListener('dragleave', () => { source.style.borderColor = ''; });
            source?.addEventListener('drop', (event) => {
                event.preventDefault();
                source.style.borderColor = '';
                const file = event.dataTransfer?.files?.[0];
                if (file) this.loadFile(file);
            });
        }, 0);
    }

    onClose() {
        this.source = '';
    }

    setStatus(message, kind = 'info') {
        const node = document.getElementById('mdStatus');
        if (!node) return;
        node.innerHTML = message
            ? `<div class="alert ${kind}"><span>${kind === 'err' ? '✕' : kind === 'ok' ? '✓' : 'ℹ'}</span><span>${message}</span></div>`
            : '';
    }

    updateMeta() {
        const node = document.getElementById('mdMeta');
        const text = document.getElementById('mdSource')?.value || '';
        if (!node) return;
        if (!text) { node.textContent = ''; return; }

        const words = text.trim() ? text.trim().split(/\s+/).length : 0;
        const minutes = Math.max(1, Math.round(words / 220));
        node.textContent = [
            this.fileName || 'pasted',
            `${text.length.toLocaleString()} chars`,
            `${text.split('\n').length.toLocaleString()} lines`,
            `${words.toLocaleString()} words`,
            `~${minutes} min read`,
        ].join(' · ');
    }

    async loadFile(file) {
        if (!file) return;
        try {
            const text = await file.text();
            document.getElementById('mdSource').value = text;
            this.fileName = file.name;
            this.updateMeta();
            this.setStatus(`Loaded ${escapeHtml(file.name)} (${formatBytes(file.size)}).`, 'ok');
            await this.renderDocument();
        } catch (err) {
            this.setStatus(`Could not read that file: ${escapeHtml(err.message)}`, 'err');
        }
    }

    options() {
        return {
            toc: document.getElementById('mdToc')?.checked,
            mermaid: document.getElementById('mdMermaid')?.checked,
            breaks: document.getElementById('mdBreaks')?.checked,
            numbers: document.getElementById('mdNumbers')?.checked,
        };
    }

    async renderDocument() {
        const text = document.getElementById('mdSource')?.value || '';
        const wrap = document.getElementById('mdDocWrap');
        const doc = document.getElementById('mdDoc');
        if (!doc) return;

        if (!text.trim()) {
            wrap.style.display = 'none';
            return;
        }

        const options = this.options();
        let marked;
        try {
            marked = await libs.marked();
        } catch (err) {
            this.setStatus(`Could not load the Markdown renderer: ${escapeHtml(err.message)}`, 'err');
            return;
        }

        // Pull Mermaid blocks out before parsing so the renderer cannot mangle
        // them, and so their content is never treated as HTML.
        const diagrams = [];
        const guarded = options.mermaid
            ? text.replace(/^[ \t]*```+[ \t]*mermaid[ \t]*\n([\s\S]*?)^[ \t]*```+[ \t]*$/gim, (_, code) => {
                diagrams.push(code.replace(/\s+$/, ''));
                return `\n<div class="mermaid-slot" id="mermaid-slot-${diagrams.length - 1}"></div>\n`;
            })
            : text;

        let html;
        try {
            html = marked.parse(guarded, { gfm: true, breaks: options.breaks });
        } catch (err) {
            this.setStatus(`Markdown could not be parsed: ${escapeHtml(err.message)}`, 'err');
            return;
        }

        doc.innerHTML = sanitizeHtml(html);

        // Heading anchors + table of contents
        const taken = new Set();
        const headings = [...doc.querySelectorAll('h1, h2, h3, h4, h5, h6')];
        const counters = [0, 0, 0, 0, 0, 0];

        for (const heading of headings) {
            const level = Number(heading.tagName[1]);
            const slug = slugify(heading.textContent, taken);
            heading.id = slug;

            if (options.numbers) {
                counters[level - 1]++;
                for (let i = level; i < 6; i++) counters[i] = 0;
                const number = counters.slice(0, level).filter((n, i) => i === 0 || counters[i - 1] > 0).join('.');
                heading.prepend(document.createTextNode(`${number} `));
            }

            const anchor = document.createElement('a');
            anchor.className = 'md-anchor';
            anchor.href = `#${slug}`;
            anchor.textContent = '#';
            anchor.title = 'Link to this section';
            anchor.addEventListener('click', (event) => {
                event.preventDefault();
                heading.scrollIntoView({ behavior: 'smooth', block: 'start' });
                copyText(`${location.href.split('#')[0]}#${slug}`, 'Section link copied');
            });
            heading.append(anchor);
        }

        const tocPanel = document.getElementById('mdTocPanel');
        if (options.toc && headings.length > 1) {
            tocPanel.innerHTML = `
                <div class="md-toc-title">On this page</div>
                <ul>
                    ${headings.map((heading) => `
                        <li class="md-toc-l${heading.tagName[1]}">
                            <a href="#${heading.id}">${escapeHtml(heading.textContent.replace(/#$/, '').trim())}</a>
                        </li>`).join('')}
                </ul>`;
            tocPanel.style.display = '';
            tocPanel.querySelectorAll('a').forEach((link) => {
                link.addEventListener('click', (event) => {
                    event.preventDefault();
                    document.getElementById(link.getAttribute('href').slice(1))
                        ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                });
            });
        } else {
            tocPanel.innerHTML = '';
            tocPanel.style.display = 'none';
        }

        // Add copy buttons to code blocks.
        doc.querySelectorAll('pre > code').forEach((code) => {
            const pre = code.parentElement;
            if (pre.querySelector('.copy-chip')) return;
            pre.style.position = 'relative';
            const button = document.createElement('button');
            button.className = 'copy-chip md-code-copy';
            button.textContent = 'Copy';
            button.dataset.copy = code.textContent;
            pre.appendChild(button);
        });

        // External links open in a new tab, safely.
        doc.querySelectorAll('a[href^="http"]').forEach((link) => {
            link.target = '_blank';
            link.rel = 'noopener noreferrer';
        });

        wrap.style.display = 'block';
        this.diagramCount = diagrams.length;

        if (diagrams.length) await this.renderDiagrams(diagrams, doc);

        const stats = [
            `${headings.length} heading${headings.length === 1 ? '' : 's'}`,
            `${doc.querySelectorAll('pre').length} code block${doc.querySelectorAll('pre').length === 1 ? '' : 's'}`,
            `${doc.querySelectorAll('table').length} table${doc.querySelectorAll('table').length === 1 ? '' : 's'}`,
            diagrams.length ? `${diagrams.length} diagram${diagrams.length === 1 ? '' : 's'}` : null,
            `${doc.querySelectorAll('a').length} link${doc.querySelectorAll('a').length === 1 ? '' : 's'}`,
        ].filter(Boolean).join(' · ');
        this.setStatus(`Rendered — ${stats}.`, 'ok');
    }

    async renderDiagrams(diagrams, doc) {
        let mermaid;
        try {
            mermaid = await libs.mermaid();
        } catch (err) {
            for (const [index, code] of diagrams.entries()) {
                const slot = doc.querySelector(`#mermaid-slot-${index}`);
                if (slot) {
                    slot.innerHTML = `<div class="alert warn"><span>!</span><span>Mermaid could not be
                        loaded (${escapeHtml(err.message)}). Showing the source instead.</span></div>
                        <pre>${escapeHtml(code)}</pre>`;
                }
            }
            return;
        }

        const dark = (document.documentElement.getAttribute('data-theme')
            || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')) === 'dark';

        mermaid.initialize({
            startOnLoad: false,
            theme: dark ? 'dark' : 'default',
            securityLevel: 'strict',
            fontFamily: 'Helvetica, Arial, sans-serif',
        });

        for (const [index, code] of diagrams.entries()) {
            const slot = doc.querySelector(`#mermaid-slot-${index}`);
            if (!slot) continue;
            try {
                // eslint-disable-next-line no-await-in-loop
                const { svg } = await mermaid.render(`md-diagram-${Date.now()}-${index}`, code);
                slot.innerHTML = `<div class="md-diagram">${svg}</div>`;
                slot.querySelector('svg')?.removeAttribute('height');
            } catch (err) {
                slot.innerHTML = `
                    <div class="alert err"><span>✕</span><span>Diagram ${index + 1} did not parse:
                    ${escapeHtml((err?.message || String(err)).split('\n')[0])}</span></div>
                    <pre>${escapeHtml(code)}</pre>`;
            }
        }
    }

    /** Self-contained HTML with the styles baked in, so the file opens anywhere. */
    exportHtml() {
        const doc = document.getElementById('mdDoc');
        if (!doc) return '';

        const clone = doc.cloneNode(true);
        clone.querySelectorAll('.copy-chip, .md-anchor').forEach((node) => node.remove());

        const title = this.fileName?.replace(/\.(md|markdown|mdown|mkd|txt)$/i, '') || 'Document';

        return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
  :root { color-scheme: light dark; }
  body { font-family: Helvetica, Arial, sans-serif; line-height: 1.7; max-width: 860px;
         margin: 0 auto; padding: 3rem 1.5rem; color: #1a1f2b; background: #fffbf3; }
  @media (prefers-color-scheme: dark) { body { color: #ede9e0; background: #191817; } }
  h1, h2, h3, h4 { line-height: 1.25; margin: 2rem 0 0.75rem; }
  h1 { font-size: 2rem; } h2 { font-size: 1.5rem; border-bottom: 2px solid #8883; padding-bottom: 0.3rem; }
  code { background: #8882; padding: 0.15em 0.4em; border-radius: 4px; font-size: 0.9em; }
  pre { background: #8882; padding: 1rem; border-radius: 8px; overflow-x: auto; }
  pre code { background: none; padding: 0; }
  table { border-collapse: collapse; width: 100%; margin: 1rem 0; }
  th, td { border: 1px solid #8884; padding: 0.5rem 0.75rem; text-align: left; }
  th { background: #8882; }
  blockquote { border-left: 4px solid #ff5e3a; margin: 1rem 0; padding: 0.25rem 1rem; color: #8886; }
  img, svg { max-width: 100%; height: auto; }
  a { color: #d9451f; }
  hr { border: none; border-top: 2px solid #8883; margin: 2rem 0; }
</style>
</head>
<body>
${clone.innerHTML}
</body>
</html>`;
    }

    copyHtml() {
        const html = this.exportHtml();
        if (!html) { toast('Render something first', 'err'); return; }
        copyText(html, 'HTML copied');
    }

    saveHtml() {
        const html = this.exportHtml();
        if (!html) { toast('Render something first', 'err'); return; }
        const name = (this.fileName?.replace(/\.[^.]+$/, '') || 'document') + '.html';
        downloadText(html, name, 'text/html');
        toast(`Saved ${name}`);
    }

    /** Print just the document, using a hidden iframe so the page is untouched. */
    printDocument() {
        const html = this.exportHtml();
        if (!html) { toast('Render something first', 'err'); return; }

        const frame = document.createElement('iframe');
        frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
        document.body.appendChild(frame);
        frame.srcdoc = html;
        frame.onload = () => {
            try {
                frame.contentWindow.focus();
                frame.contentWindow.print();
            } finally {
                setTimeout(() => frame.remove(), 1000);
            }
        };
    }
}
