// Storage utility for managing configuration in browser localStorage
export class StorageManager {
    constructor(prefix = 'devtools_') {
        this.prefix = prefix;
    }

    // Save configuration for a specific tool
    saveConfig(toolId, config) {
        const key = this.prefix + toolId;
        try {
            localStorage.setItem(key, JSON.stringify(config));
            return true;
        } catch (error) {
            console.error('Failed to save config:', error);
            return false;
        }
    }

    // Load configuration for a specific tool
    loadConfig(toolId) {
        const key = this.prefix + toolId;
        try {
            const data = localStorage.getItem(key);
            return data ? JSON.parse(data) : null;
        } catch (error) {
            console.error('Failed to load config:', error);
            return null;
        }
    }

    // Save to config history (keep last 5)
    saveToHistory(toolId, config) {
        const historyKey = this.prefix + toolId + '_history';
        try {
            let history = this.loadHistory(toolId) || [];
            
            // Add timestamp
            const entry = {
                ...config,
                timestamp: new Date().toISOString(),
                label: config.label || `Config ${history.length + 1}`
            };

            // Remove duplicates based on connection string
            history = history.filter(h => h.connectionString !== config.connectionString);
            
            // Add to beginning
            history.unshift(entry);
            
            // Keep only last 5
            history = history.slice(0, 5);
            
            localStorage.setItem(historyKey, JSON.stringify(history));
            return true;
        } catch (error) {
            console.error('Failed to save to history:', error);
            return false;
        }
    }

    // Load config history
    loadHistory(toolId) {
        const historyKey = this.prefix + toolId + '_history';
        try {
            const data = localStorage.getItem(historyKey);
            return data ? JSON.parse(data) : [];
        } catch (error) {
            console.error('Failed to load history:', error);
            return [];
        }
    }

    // Clear all configs for a tool
    clearConfig(toolId) {
        const key = this.prefix + toolId;
        try {
            localStorage.removeItem(key);
            return true;
        } catch (error) {
            console.error('Failed to clear config:', error);
            return false;
        }
    }

    // Clear history for a tool
    clearHistory(toolId) {
        const historyKey = this.prefix + toolId + '_history';
        try {
            localStorage.removeItem(historyKey);
            return true;
        } catch (error) {
            console.error('Failed to clear history:', error);
            return false;
        }
    }
}
