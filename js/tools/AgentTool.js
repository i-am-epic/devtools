// Renders one agent definition: its description, the full instruction text,
// and buttons to copy or download it for use with Claude Code / Copilot.

import { BaseTool } from '../core/BaseTool.js';
import { libs } from '../lib/loader.js';
import { toast, copyText, downloadText } from '../ui/toast.js';

const escapeHtml = (value) => String(value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const cache = new Map();

// Resolve against this module's own URL rather than the page's, so the agents
// load correctly from /, from /scripts/, and from the /t/<tool> landing pages.
const agentUrl = (file) => new URL(`../../agents/${file}`, import.meta.url).href;

export class AgentTool extends BaseTool {
    constructor(config) {
        super(config);
        this.agent = config.agent;
        this.file = config.file;
        this.raw = '';
    }

    render() {
        return `
            <div class="tool-interface" data-cat="agents">
                <h2><span class="tool-icon">${this.icon}</span>${escapeHtml(this.name)}</h2>
                <p class="tool-lede">${escapeHtml(this.description)}</p>

                <div class="agent-meta">
                    <span class="chip">${escapeHtml(this.agent)}</span>
                    <span class="chip">subagent definition</span>
                    <span class="chip">markdown + YAML frontmatter</span>
                </div>

                <div class="btn-row" style="margin-bottom:1.25rem;">
                    <button class="action-btn" id="agentCopy">Copy definition</button>
                    <button class="action-btn secondary" id="agentDownload">Download .md</button>
                    <button class="action-btn secondary" id="agentToggle">View raw</button>
                </div>

                <div id="agentContent">
                    <div class="info-box">Loading…</div>
                </div>

                <details style="margin-top:1.5rem;">
                    <summary>How to use this</summary>
                    <div style="margin-top:0.75rem;color:var(--ink-2);font-size:0.88rem;line-height:1.7;">
                        <p>Save the file as <code>.claude/agents/${escapeHtml(this.agent)}.md</code> in a repository
                        (or <code>~/.claude/agents/</code> to have it everywhere), then ask for it by name — Claude Code
                        picks agents up from the frontmatter <code>name</code> and <code>description</code>.</p>
                        <p style="margin-top:0.5rem;">For GitHub Copilot, the same file goes in
                        <code>.github/agents/${escapeHtml(this.agent)}.agent.md</code>.</p>
                    </div>
                </details>
            </div>
        `;
    }

    async onOpen() {
        this.showRaw = false;

        setTimeout(() => {
            document.getElementById('agentCopy')?.addEventListener('click', () => {
                if (!this.raw) { toast('Still loading', 'err'); return; }
                copyText(this.raw, 'Agent definition copied');
            });

            document.getElementById('agentDownload')?.addEventListener('click', () => {
                if (!this.raw) { toast('Still loading', 'err'); return; }
                downloadText(this.raw, `${this.agent}.md`, 'text/markdown');
                toast(`Saved ${this.agent}.md`);
            });

            document.getElementById('agentToggle')?.addEventListener('click', (event) => {
                this.showRaw = !this.showRaw;
                event.target.textContent = this.showRaw ? 'View formatted' : 'View raw';
                this.paint();
            });
        }, 0);

        await this.load();
    }

    async load() {
        try {
            if (cache.has(this.file)) {
                this.raw = cache.get(this.file);
            } else {
                const response = await fetch(agentUrl(this.file));
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                this.raw = await response.text();
                cache.set(this.file, this.raw);
            }
            await this.paint();
        } catch (err) {
            const node = document.getElementById('agentContent');
            if (node) {
                node.innerHTML = `<div class="alert err"><span>✕</span><span>Could not load
                    <code>agents/${escapeHtml(this.file)}</code>: ${escapeHtml(err.message)}</span></div>`;
            }
        }
    }

    /** Strip the YAML frontmatter — it is shown as metadata rather than body text. */
    body() {
        const match = /^---\s*\n[\s\S]*?\n---\s*\n([\s\S]*)$/.exec(this.raw);
        return match ? match[1] : this.raw;
    }

    async paint() {
        const node = document.getElementById('agentContent');
        if (!node) return;

        if (this.showRaw) {
            node.innerHTML = `<div class="output-section"><pre>${escapeHtml(this.raw)}</pre></div>`;
            return;
        }

        try {
            const marked = await libs.marked();
            node.innerHTML = `<div class="agent-body">${marked.parse(this.body(), { gfm: true })}</div>`;
        } catch {
            // Markdown renderer unavailable — the text is still perfectly readable.
            node.innerHTML = `<div class="output-section"><pre>${escapeHtml(this.body())}</pre></div>`;
        }
    }
}

/**
 * Build registry entries from agents/index.json.
 * Returns [] when the manifest is missing so the site still works without it.
 */
export async function loadAgentTools() {
    try {
        const response = await fetch(agentUrl('index.json'));
        if (!response.ok) return [];
        const manifest = await response.json();

        return (manifest.agents || []).map((entry) => ({
            id: entry.id,
            name: entry.title,
            description: entry.description || `The ${entry.title} agent.`,
            category: 'agents',
            icon: entry.icon || '🤖',
            keywords: [
                'agent', 'subagent', 'claude', 'claude code', 'copilot', 'prompt', 'nikbot',
                entry.agent, entry.title.toLowerCase(),
                ...entry.title.toLowerCase().split(/\s+/),
            ],
            enabled: true,
            agent: entry.agent,
            file: entry.file,
            toolClass: AgentTool,
        }));
    } catch {
        return [];
    }
}
