// Quick-search command palette.
//
// A web page cannot register an OS-level global hotkey — the shortcuts below
// only fire while this tab has focus. Several combinations are bound because
// no single one is free everywhere:
//
//   Ctrl+K / Cmd+K   reliable in every browser on both platforms
//   Ctrl+Space       reliable in browsers; some IME setups claim it on Windows
//   Alt+Space        Windows may open the window menu before the page sees it,
//                    so it is a bonus binding rather than the documented one
//   /                when focus is not already in a field

const escapeHtml = (value) => String(value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

export class CommandPalette {
    constructor({ searchService, onSelect }) {
        this.searchService = searchService;
        this.onSelect = onSelect;
        this.results = [];
        this.index = 0;
        this.open = false;
    }

    mount() {
        this.root = document.getElementById('palette');
        this.input = document.getElementById('paletteInput');
        this.list = document.getElementById('paletteResults');
        if (!this.root) return;

        this.input.addEventListener('input', () => this.search(this.input.value));

        this.input.addEventListener('keydown', (event) => {
            switch (event.key) {
                case 'ArrowDown':
                    event.preventDefault();
                    this.move(1);
                    break;
                case 'ArrowUp':
                    event.preventDefault();
                    this.move(-1);
                    break;
                case 'Enter':
                    event.preventDefault();
                    this.choose(this.index);
                    break;
                case 'Escape':
                    event.preventDefault();
                    this.close();
                    break;
                case 'Tab':
                    // Keep focus inside the palette.
                    event.preventDefault();
                    this.move(event.shiftKey ? -1 : 1);
                    break;
                default:
                    break;
            }
        });

        // Click outside closes.
        this.root.addEventListener('mousedown', (event) => {
            if (event.target === this.root) this.close();
        });

        this.list.addEventListener('click', (event) => {
            const item = event.target.closest('.palette-item');
            if (item) this.choose(Number(item.dataset.index));
        });

        this.list.addEventListener('mousemove', (event) => {
            const item = event.target.closest('.palette-item');
            if (item && Number(item.dataset.index) !== this.index) {
                this.index = Number(item.dataset.index);
                this.paintSelection();
            }
        });
    }

    /** @returns {boolean} whether the event was a palette shortcut */
    handleShortcut(event) {
        const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName)
            || document.activeElement?.isContentEditable;

        const key = event.key?.toLowerCase();
        const meta = event.ctrlKey || event.metaKey;

        const isK = meta && key === 'k';
        const isCtrlSpace = event.ctrlKey && (event.code === 'Space' || key === ' ');
        const isAltSpace = event.altKey && (event.code === 'Space' || key === ' ');
        const isSlash = key === '/' && !meta && !event.altKey && !typing;

        if (isK || isCtrlSpace || isAltSpace || isSlash) {
            event.preventDefault();
            event.stopPropagation();
            this.toggle();
            return true;
        }
        return false;
    }

    toggle() {
        if (this.open) this.close();
        else this.show();
    }

    show(initialQuery = '') {
        if (!this.root) return;
        this.open = true;
        this.root.classList.add('open');
        this.input.value = initialQuery;
        this.search(initialQuery);
        // Focus after paint so the caret lands correctly.
        setTimeout(() => {
            this.input.focus();
            this.input.select();
        }, 0);
    }

    close() {
        if (!this.root) return;
        this.open = false;
        this.root.classList.remove('open');
    }

    search(query) {
        const all = this.searchService.search(query);
        this.results = query.trim() ? all.slice(0, 40) : all.slice(0, 12);
        this.index = 0;
        this.paint(query);
    }

    paint(query) {
        if (!this.results.length) {
            this.list.innerHTML = `<li class="palette-empty">No tool matches “${escapeHtml(query)}”</li>`;
            return;
        }

        this.list.innerHTML = this.results.map((tool, i) => `
            <li class="palette-item" role="option" data-index="${i}" data-cat="${escapeHtml(tool.category)}"
                aria-selected="${i === 0 ? 'true' : 'false'}">
                <span class="pi-icon" aria-hidden="true">${tool.icon}</span>
                <span class="pi-text">
                    <span class="pi-name">${escapeHtml(tool.name)}</span>
                    <span class="pi-desc">${escapeHtml(tool.description)}</span>
                </span>
                <span class="pi-cat">${escapeHtml(tool.category)}</span>
            </li>`).join('');
    }

    paintSelection() {
        [...this.list.children].forEach((node, i) => {
            node.setAttribute('aria-selected', i === this.index ? 'true' : 'false');
        });
        this.list.children[this.index]?.scrollIntoView({ block: 'nearest' });
    }

    move(delta) {
        if (!this.results.length) return;
        this.index = (this.index + delta + this.results.length) % this.results.length;
        this.paintSelection();
    }

    choose(index) {
        const tool = this.results[index];
        if (!tool) return;
        this.close();
        this.onSelect(tool);
    }
}
