// Application entry point.

import { ConfigManager } from './core/ConfigManager.js';
import { ToolFactory } from './core/ToolFactory.js';
import { SearchService } from './core/SearchService.js';
import { UIManager } from './core/UIManager.js';
import { EnvironmentManager } from './core/EnvironmentManager.js';
import { EnvironmentUI } from './ui/EnvironmentUI.js';
import { CommandPalette } from './ui/palette.js';
import { copyText } from './ui/toast.js';

const THEME_KEY = 'devtools_theme';
const CATEGORY_KEY = 'devtools_category';

const isMac = /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent);

class Application {
    constructor() {
        this.configManager = new ConfigManager();
        this.toolFactory = new ToolFactory();
        this.searchService = new SearchService();
        this.uiManager = new UIManager(this.toolFactory);
        this.envManager = new EnvironmentManager();
        this.envUI = new EnvironmentUI();
        this.allTools = [];
        this.currentCategory = 'all';
        // How many history entries we have pushed within the site, so goBack()
        // knows whether history.back() would leave it.
        this.depth = 0;
    }

    async init() {
        try {
            await this.configManager.load();
            this.allTools = this.configManager.getAllTools();
            this.categories = this.configManager.getCategories();

            this.uiManager.setCategories(this.categories);
            this.searchService.setTools(this.allTools);

            this.palette = new CommandPalette({
                searchService: this.searchService,
                onSelect: (tool) => this.navigateToTool(tool),
            });
            this.palette.mount();

            this.applyStoredTheme();
            this.renderCategoryFilters();
            this.updateShortcutHint();

            this.currentCategory = localStorage.getItem(CATEGORY_KEY) || 'all';
            if (this.currentCategory !== 'all' && !this.categories[this.currentCategory]) {
                this.currentCategory = 'all';
            }
            this.filterByCategory(this.currentCategory, { save: false });

            this.setupEventListeners();
            this.updateEnvironmentIndicator();
            // A deep link is the entry in history, so it must not be pushed again.
            this.syncFromLocation();
        } catch (error) {
            console.error('Failed to initialise:', error);
            const grid = document.getElementById('toolsGrid');
            if (grid) {
                grid.innerHTML = `
                    <div class="empty-state">
                        <strong>Something went wrong while loading</strong>
                        ${error.message}
                    </div>`;
            }
        }
    }

    // ------------------------------------------------------------- theme --

    applyStoredTheme() {
        const stored = localStorage.getItem(THEME_KEY);
        if (stored === 'light' || stored === 'dark') {
            document.documentElement.setAttribute('data-theme', stored);
        }
        this.updateThemeButton();
    }

    toggleTheme() {
        const current = document.documentElement.getAttribute('data-theme')
            || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
        const next = current === 'dark' ? 'light' : 'dark';
        document.documentElement.setAttribute('data-theme', next);
        localStorage.setItem(THEME_KEY, next);
        this.updateThemeButton();
    }

    updateThemeButton() {
        const button = document.getElementById('themeToggle');
        if (!button) return;
        const isDark = (document.documentElement.getAttribute('data-theme')
            || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')) === 'dark';
        button.innerHTML = isDark ? '<span>☀</span><span>Light</span>' : '<span>☾</span><span>Dark</span>';
        button.setAttribute('aria-label', isDark ? 'Switch to light theme' : 'Switch to dark theme');
    }

    updateShortcutHint() {
        const hint = document.getElementById('searchHint');
        if (hint) hint.textContent = isMac ? '⌘ K' : 'Ctrl + Space';
    }

    // -------------------------------------------------------- categories --

    renderCategoryFilters() {
        const container = document.getElementById('categoryFilter');
        if (!container) return;

        const counts = {};
        for (const tool of this.allTools) counts[tool.category] = (counts[tool.category] || 0) + 1;

        const buttons = [
            { id: 'all', name: 'All tools', icon: '✦', count: this.allTools.length },
            ...Object.entries(this.categories)
                .sort(([, a], [, b]) => (a.order || 0) - (b.order || 0))
                .filter(([id]) => counts[id])
                .map(([id, category]) => ({ id, name: category.name, icon: category.icon, count: counts[id] })),
        ];

        container.innerHTML = buttons.map((button) => `
            <button class="category-btn" data-category="${button.id}" type="button">
                <span aria-hidden="true">${button.icon}</span>
                <span>${button.name}</span>
                <span class="count">${button.count}</span>
            </button>`).join('');

        container.querySelectorAll('.category-btn').forEach((button) => {
            button.addEventListener('click', () => this.filterByCategory(button.dataset.category));
        });
    }

    filterByCategory(categoryId, { save = true } = {}) {
        this.currentCategory = categoryId;

        document.querySelectorAll('.category-btn').forEach((button) => {
            button.classList.toggle('active', button.dataset.category === categoryId);
        });

        const search = document.getElementById('globalSearch');
        if (search) search.value = '';

        const tools = categoryId === 'all'
            ? this.allTools
            : this.allTools.filter((tool) => tool.category === categoryId);

        this.uiManager.renderToolsGrid(tools, categoryId === 'all');
        this.updateToolCount(tools.length);

        if (save) localStorage.setItem(CATEGORY_KEY, categoryId);
    }

    handleSearch(query) {
        if (!query.trim()) {
            this.filterByCategory(this.currentCategory, { save: false });
            return;
        }
        const results = this.searchService.search(query);
        this.uiManager.renderToolsGrid(results, false);
        this.updateToolCount(results.length, query);
    }

    updateToolCount(count = this.allTools.length, query = '') {
        const node = document.getElementById('toolCount');
        if (!node) return;
        node.textContent = query
            ? `${count} result${count === 1 ? '' : 's'} for “${query}”`
            : `${count} tool${count === 1 ? '' : 's'}`;
    }

    // ------------------------------------------------------------ routing --
    //
    // Opening a tool pushes a history entry, so Back returns to the grid
    // instead of leaving the site. The URL is the single source of truth:
    // popstate and hashchange both just re-sync the view to it.

    /** Open a tool because the user asked for it. Adds a history entry. */
    navigateToTool(tool) {
        if (decodeURIComponent(location.hash.slice(1)) !== tool.id) {
            history.pushState({ tool: tool.id }, '', `#${tool.id}`);
            this.depth++;
        }
        this.uiManager.openTool(tool);
    }

    /** Make the view match the current URL. Safe to call repeatedly. */
    syncFromLocation() {
        const id = decodeURIComponent(location.hash.slice(1));

        if (!id) {
            this.uiManager.closeModal();
            this.updateEnvironmentIndicator();
            return;
        }
        if (this.uiManager.currentId === id) return;

        const tool = this.configManager.getTool(id);
        if (tool) this.uiManager.openTool(tool);
        else this.uiManager.closeModal();
    }

    /**
     * The back arrow and Escape. Rewinds history when we have somewhere to
     * rewind to, so forward still works; otherwise (a deep link straight into
     * a tool) it rewrites the URL rather than throwing the user off the site.
     */
    goBack() {
        if (this.depth > 0) {
            history.back();
            return;
        }
        if (location.hash) history.replaceState(null, '', location.pathname + location.search);
        this.uiManager.closeModal();
        this.updateEnvironmentIndicator();
    }

    // ------------------------------------------------------ environments --

    updateEnvironmentIndicator() {
        const indicator = document.getElementById('activeEnvIndicator');
        if (!indicator) return;
        const active = this.envManager.getActiveEnvironment();
        indicator.textContent = active ? active.name : '';
    }

    openEnvironmentSettings() {
        this.uiManager.openPanel(this.envUI.render(), {
            title: 'Environments',
            icon: '⚙',
            category: 'utility',
        });
        setTimeout(() => this.envUI.attachEventListeners(), 0);
    }

    // ------------------------------------------------------------ events --

    setupEventListeners() {
        const search = document.getElementById('globalSearch');
        let debounce;
        search?.addEventListener('input', (event) => {
            clearTimeout(debounce);
            const { value } = event.target;
            debounce = setTimeout(() => this.handleSearch(value), 120);
        });

        document.getElementById('themeToggle')?.addEventListener('click', () => this.toggleTheme());
        document.getElementById('openEnvSettings')?.addEventListener('click', () => this.openEnvironmentSettings());
        document.getElementById('closeModal')?.addEventListener('click', () => this.goBack());
        document.getElementById('modalShare')?.addEventListener('click', () => this.uiManager.shareLink());
        document.getElementById('modalSettings')?.addEventListener('click', () => this.openEnvironmentSettings());

        // Back / forward.
        window.addEventListener('popstate', () => {
            this.depth = Math.max(0, this.depth - 1);
            this.syncFromLocation();
        });

        // Someone editing the hash in the address bar.
        window.addEventListener('hashchange', () => this.syncFromLocation());

        // One delegated handler serves every click-to-copy affordance on the
        // site, so individual tools only need to add data-copy.
        document.addEventListener('click', (event) => {
            const trigger = event.target.closest('[data-copy]');
            if (!trigger) return;
            event.preventDefault();
            event.stopPropagation();

            const value = trigger.dataset.copy === ''
                ? (trigger.closest('[data-copy-source]')?.dataset.copySource ?? trigger.textContent.trim())
                : trigger.dataset.copy;

            copyText(value, trigger.dataset.copyLabel || 'Copied');

            const chip = trigger.matches('.copy-chip') ? trigger : trigger.querySelector('.copy-chip');
            if (chip) {
                const original = chip.textContent;
                chip.textContent = '✓';
                chip.classList.add('is-ok');
                setTimeout(() => {
                    chip.textContent = original;
                    chip.classList.remove('is-ok');
                }, 1200);
            }
        });

        document.addEventListener('keydown', (event) => {
            // The palette owns its own keys while it is open.
            if (this.palette?.open) {
                if (event.key === 'Escape') this.palette.close();
                return;
            }

            if (this.palette?.handleShortcut(event)) return;

            if (event.key === 'Escape' && this.uiManager.isOpen()) {
                this.goBack();
            }
        });
    }
}

document.addEventListener('DOMContentLoaded', () => {
    window.app = new Application();
    window.app.init();
});
