// Configuration Manager (Single Responsibility Principle)
export class ConfigManager {
    constructor(configPath) {
        this.configPath = configPath;
        this.config = null;
    }

    async load() {
        try {
            const response = await fetch(this.configPath);
            this.config = await response.json();
            return this.config;
        } catch (error) {
            console.error('Failed to load configuration:', error);
            return { tools: [] };
        }
    }

    getTools() {
        return this.config?.tools || [];
    }

    getEnabledTools() {
        return this.getTools().filter(tool => tool.enabled);
    }

    getAllTools() {
        return this.getTools();
    }
    
    getCategories() {
        return this.config?.categories || {};
    }
}
