// Main Application Entry Point (Dependency Injection Pattern)
console.log('📦 Loading modules...');

import { ConfigManager } from './core/ConfigManager.js';
import { ToolFactory } from './core/ToolFactory.js';
import { SearchService } from './core/SearchService.js';
import { UIManager } from './core/UIManager.js';
import { EnvironmentManager } from './core/EnvironmentManager.js';
import { EnvironmentUI } from './ui/EnvironmentUI.js';

console.log('✅ All modules loaded successfully');

class Application {
    constructor() {
        this.configManager = new ConfigManager('./tools-config.json');
        this.toolFactory = new ToolFactory();
        this.searchService = new SearchService();
        this.uiManager = new UIManager(this.toolFactory);
        this.envManager = new EnvironmentManager();
        this.envUI = new EnvironmentUI();
        this.allTools = [];
    }

    async init() {
        try {
            console.log('🚀 Starting DevTools Hub...');
            
            // Load configuration
            console.log('📋 Loading configuration...');
            await this.configManager.load();
            this.allTools = this.configManager.getAllTools();
            this.categories = this.configManager.getCategories();
            console.log('✓ Loaded', this.allTools.length, 'tools');
            
            // Set tools for search service
            this.searchService.setTools(this.allTools);
            
            // Render category filters
            this.renderCategoryFilters();
            
            // Restore last selected category
            const savedCategory = localStorage.getItem('selectedCategory') || 'all';
            this.currentCategory = savedCategory;
            
            // Render initial grid with saved category
            console.log('🎨 Rendering tools grid...');
            const initialTools = savedCategory === 'all' 
                ? this.allTools 
                : this.allTools.filter(tool => tool.category === savedCategory);
            this.uiManager.renderToolsGrid(initialTools);
            
            // Set active category button
            setTimeout(() => {
                const activeBtn = document.querySelector(`.category-btn[data-category="${savedCategory}"]`);
                if (activeBtn) {
                    document.querySelectorAll('.category-btn').forEach(btn => btn.classList.remove('active'));
                    activeBtn.classList.add('active');
                }
            }, 0);
            
            console.log('✓ Grid rendered');
            
            // Setup event listeners
            console.log('🔌 Setting up event listeners...');
            this.setupEventListeners();
            
            // Update active environment indicator
            this.updateEnvironmentIndicator();
            
            // Auto-focus search on page load
            setTimeout(() => {
                const searchInput = document.getElementById('globalSearch');
                if (searchInput) {
                    searchInput.focus();
                }
            }, 100);
            
            console.log('✅ DevTools Hub initialized successfully');
        } catch (error) {
            console.error('❌ Failed to initialize application:', error);
            console.error('Stack trace:', error.stack);
            
            // Show error to user
            document.body.innerHTML = `
                <div style="padding: 2rem; text-align: center; color: #ff6b6b;">
                    <h1>❌ Failed to Load</h1>
                    <p style="color: #a0a0a0; margin-top: 1rem;">
                        ${error.message}
                    </p>
                    <pre style="text-align: left; background: #111; padding: 1rem; margin-top: 1rem; border-radius: 8px; overflow-x: auto;">
                        ${error.stack}
                    </pre>
                    <p style="margin-top: 1rem;">Check browser console for details</p>
                </div>
            `;
        }
    }

    updateEnvironmentIndicator() {
        const activeEnv = this.envManager.getActiveEnvironment();
        const indicator = document.getElementById('activeEnvIndicator');
        
        if (indicator) {
            if (activeEnv) {
                indicator.textContent = activeEnv.name;
                indicator.style.color = '#51cf66';
            } else {
                indicator.textContent = '';
            }
        }
    }

    setupEventListeners() {
        // Global search
        const searchInput = document.getElementById('globalSearch');
        searchInput?.addEventListener('input', (e) => {
            this.handleSearch(e.target.value);
        });

        // Environment settings button
        const envSettingsBtn = document.getElementById('openEnvSettings');
        envSettingsBtn?.addEventListener('click', () => {
            this.openEnvironmentSettings();
        });

        // Modal close button
        const closeModal = document.getElementById('closeModal');
        closeModal?.addEventListener('click', () => {
            this.uiManager.closeModal();
        });

        // Close modal on background click
        const modal = document.getElementById('toolModal');
        modal?.addEventListener('click', (e) => {
            if (e.target === modal) {
                this.uiManager.closeModal();
            }
        });

        // Global keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            // ESC to close modal
            if (e.key === 'Escape') {
                this.uiManager.closeModal();
            }
            
            // Ctrl+Enter (Windows/Linux) or Cmd+Enter (Mac) to focus search
            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                e.preventDefault();
                searchInput?.focus();
                searchInput?.select();
            }
        });
    }

    openEnvironmentSettings() {
        const modal = document.getElementById('toolModal');
        const modalBody = document.getElementById('modalBody');

        modalBody.innerHTML = this.envUI.render();
        modal.classList.add('active');
        
        setTimeout(() => {
            this.envUI.attachEventListeners();
        }, 0);

        // Refresh environment indicator when modal closes
        const observer = new MutationObserver(() => {
            if (!modal.classList.contains('active')) {
                this.updateEnvironmentIndicator();
            }
        });
        observer.observe(modal, { attributes: true, attributeFilter: ['class'] });
    }

    renderCategoryFilters() {
        const filterContainer = document.getElementById('categoryFilter');
        if (!filterContainer || !this.categories) return;
        
        // Count tools per category
        const categoryCounts = {};
        this.allTools.forEach(tool => {
            categoryCounts[tool.category] = (categoryCounts[tool.category] || 0) + 1;
        });
        
        // Sort categories by order
        const sortedCategories = Object.entries(this.categories)
            .sort(([, a], [, b]) => (a.order || 0) - (b.order || 0));
        
        // Add category buttons
        sortedCategories.forEach(([id, category]) => {
            const count = categoryCounts[id] || 0;
            if (count === 0) return;
            
            const button = document.createElement('button');
            button.className = 'category-btn';
            button.dataset.category = id;
            button.innerHTML = `
                <span>${category.icon}</span>
                <span>${category.name}</span>
                <span class="count">${count}</span>
            `;
            
            button.addEventListener('click', () => this.filterByCategory(id));
            filterContainer.appendChild(button);
        });
    }
    
    filterByCategory(categoryId) {
        // Store current category
        this.currentCategory = categoryId;
        
        // Update active button
        document.querySelectorAll('.category-btn').forEach(btn => {
            btn.classList.remove('active');
        });
        
        const activeBtn = categoryId === 'all' 
            ? document.querySelector('.category-btn[data-category="all"]')
            : document.querySelector(`.category-btn[data-category="${categoryId}"]`);
        
        if (activeBtn) {
            activeBtn.classList.add('active');
        }
        
        // Filter tools
        const filteredTools = categoryId === 'all' 
            ? this.allTools 
            : this.allTools.filter(tool => tool.category === categoryId);
        
        // Clear search
        const searchInput = document.getElementById('globalSearch');
        if (searchInput) searchInput.value = '';
        
        // Re-render grid
        this.uiManager.renderToolsGrid(filteredTools);
        
        // Save to localStorage
        localStorage.setItem('selectedCategory', categoryId);
    }

    handleSearch(query) {
        const filteredTools = this.searchService.search(query);
        const filteredIds = filteredTools.map(tool => tool.id);
        this.uiManager.showCards(filteredIds);
    }
}

// Initialize application when DOM is ready
console.log('⏳ Waiting for DOM to be ready...');

document.addEventListener('DOMContentLoaded', () => {
    console.log('✅ DOM ready, initializing application...');
    window.app = new Application();
    window.app.init();
});

console.log('📜 App.js script loaded');

