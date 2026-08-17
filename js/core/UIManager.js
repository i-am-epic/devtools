// Renders the tool grid and drives the full-page tool view.

import { copyText } from '../ui/toast.js';

const escapeHtml = (value) => String(value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

export class UIManager {
    constructor(toolFactory, categories = {}) {
        this.toolFactory = toolFactory;
        this.categories = categories;
        this.currentTool = null;
        this.currentConfig = null;
        this.scrollBeforeOpen = 0;
    }

    setCategories(categories) {
        this.categories = categories;
    }

    toolCard(tool) {
        return `
            <button class="tool-card" data-cat="${escapeHtml(tool.category)}" data-tool-id="${escapeHtml(tool.id)}"
                    type="button" aria-label="Open ${escapeHtml(tool.name)}">
                <span class="tool-icon" aria-hidden="true">${tool.icon}</span>
                <span class="tool-name">${escapeHtml(tool.name)}</span>
                <span class="tool-description">${escapeHtml(tool.description)}</span>
                <span class="tool-badge">${escapeHtml(this.categories[tool.category]?.name || tool.category)}</span>
            </button>`;
    }

    /**
     * @param {Array} tools
     * @param {boolean} grouped insert category headings (off while searching,
     *   because search results are ranked rather than grouped)
     */
    renderToolsGrid(tools, grouped = true) {
        const grid = document.getElementById('toolsGrid');
        if (!grid) return;

        if (!tools.length) {
            grid.innerHTML = `
                <div class="empty-state">
                    <strong>Nothing matched</strong>
                    Try a different word — searching covers tool names, descriptions and keywords.
                </div>`;
            return;
        }

        if (!grouped) {
            grid.innerHTML = tools.map((tool) => this.toolCard(tool)).join('');
            this.bindCards(tools);
            return;
        }

        const byCategory = new Map();
        for (const tool of tools) {
            if (!byCategory.has(tool.category)) byCategory.set(tool.category, []);
            byCategory.get(tool.category).push(tool);
        }

        const ordered = [...byCategory.entries()].sort(
            ([a], [b]) => (this.categories[a]?.order ?? 99) - (this.categories[b]?.order ?? 99),
        );

        grid.innerHTML = ordered.map(([id, items]) => `
            <div class="section-heading" data-cat="${escapeHtml(id)}">
                <h2>${escapeHtml(this.categories[id]?.name || id)}</h2>
                <span class="rule"></span>
                <span class="n">${items.length}</span>
            </div>
            ${items.map((tool) => this.toolCard(tool)).join('')}
        `).join('');

        this.bindCards(tools);
    }

    bindCards(tools) {
        const lookup = new Map(tools.map((tool) => [tool.id, tool]));
        document.querySelectorAll('.tool-card').forEach((card) => {
            card.addEventListener('click', () => {
                const tool = lookup.get(card.dataset.toolId);
                if (tool) this.openTool(tool);
            });
        });
    }

    // --------------------------------------------------------- tool view --

    openTool(toolConfig) {
        let tool;
        try {
            tool = this.toolFactory.create(toolConfig);
        } catch (err) {
            console.error(err);
            return;
        }

        const wasOpen = document.body.classList.contains('tool-open');
        if (!wasOpen) this.scrollBeforeOpen = window.scrollY;

        this.closeCurrent();
        this.currentTool = tool;
        this.currentConfig = toolConfig;

        const title = document.getElementById('toolViewTitle');
        if (title) {
            title.innerHTML = `
                <span class="tool-icon" aria-hidden="true">${toolConfig.icon}</span>
                <span>${escapeHtml(toolConfig.name)}</span>`;
            title.parentElement.setAttribute('data-cat', toolConfig.category);
        }

        const body = document.getElementById('modalBody');
        body.innerHTML = tool.render();

        document.body.classList.add('tool-open');
        window.scrollTo({ top: 0, behavior: 'instant' });

        if (location.hash.slice(1) !== toolConfig.id) {
            history.replaceState(null, '', `#${toolConfig.id}`);
        }

        tool.onOpen();
    }

    /** Environment settings reuse the same full-page surface. */
    openPanel(html, { title = 'Settings', icon = '⚙', category = 'utility' } = {}) {
        this.closeCurrent();
        this.currentConfig = null;

        const titleNode = document.getElementById('toolViewTitle');
        if (titleNode) {
            titleNode.innerHTML = `
                <span class="tool-icon" aria-hidden="true">${icon}</span>
                <span>${escapeHtml(title)}</span>`;
            titleNode.parentElement.setAttribute('data-cat', category);
        }

        document.getElementById('modalBody').innerHTML = html;
        document.body.classList.add('tool-open');
        window.scrollTo({ top: 0, behavior: 'instant' });
    }

    closeCurrent() {
        if (this.currentTool) {
            try {
                this.currentTool.onClose();
            } catch (err) {
                console.error('Error closing tool:', err);
            }
            this.currentTool = null;
        }
    }

    closeModal() {
        if (!document.body.classList.contains('tool-open')) return;

        document.body.classList.remove('tool-open');
        this.closeCurrent();
        this.currentConfig = null;
        document.getElementById('modalBody').innerHTML = '';

        if (location.hash) history.replaceState(null, '', location.pathname + location.search);

        // Put the user back where they were in the grid.
        window.scrollTo({ top: this.scrollBeforeOpen, behavior: 'instant' });
    }

    isOpen() {
        return document.body.classList.contains('tool-open');
    }

    shareLink() {
        if (!this.currentConfig) return;
        copyText(`${location.origin}${location.pathname}#${this.currentConfig.id}`, 'Link copied');
    }
}
