// UI Manager (Single Responsibility Principle - manages UI rendering)
export class UIManager {
    constructor(toolFactory) {
        this.toolFactory = toolFactory;
        this.currentTool = null;
    }

    renderToolCard(toolConfig) {
        const card = document.createElement('div');
        card.className = `tool-card visible ${!toolConfig.enabled ? 'disabled' : ''}`;
        card.dataset.toolId = toolConfig.id;

        card.innerHTML = `
            <span class="tool-icon">${toolConfig.icon}</span>
            <h3 class="tool-name">${toolConfig.name}</h3>
            <p class="tool-description">${toolConfig.description}</p>
            <span class="tool-badge">${toolConfig.category}</span>
            ${!toolConfig.enabled ? '<span class="tool-badge">Coming Soon</span>' : ''}
        `;

        if (toolConfig.enabled) {
            card.addEventListener('click', () => this.openTool(toolConfig));
        }

        return card;
    }

    renderToolsGrid(toolConfigs) {
        const grid = document.getElementById('toolsGrid');
        grid.innerHTML = '';

        toolConfigs.forEach(config => {
            const card = this.renderToolCard(config);
            grid.appendChild(card);
        });
    }

    openTool(toolConfig) {
        const tool = this.toolFactory.create(toolConfig);
        this.currentTool = tool;

        const modal = document.getElementById('toolModal');
        const modalBody = document.getElementById('modalBody');

        modalBody.innerHTML = `
            <div style="display: flex; justify-content: flex-end; margin-bottom: 1rem; gap: 0.5rem;">
                <button onclick="window.app.openEnvironmentSettings()" class="modal-action-btn" title="Environment Settings">
                    <span style="font-size: 1rem;">⚙️</span>
                    <span style="font-size: 0.85rem;">Settings</span>
                </button>
            </div>
            ${tool.render()}
        `;
        modal.classList.add('active');
        
        tool.onOpen();
    }

    closeModal() {
        const modal = document.getElementById('toolModal');
        modal.classList.remove('active');

        if (this.currentTool) {
            this.currentTool.onClose();
            this.currentTool = null;
        }
    }

    showCards(toolIds) {
        const allCards = document.querySelectorAll('.tool-card');
        allCards.forEach(card => {
            const cardId = card.dataset.toolId;
            if (toolIds.includes(cardId)) {
                card.classList.remove('hidden');
                card.classList.add('visible');
            } else {
                card.classList.add('hidden');
                card.classList.remove('visible');
            }
        });
    }
}
