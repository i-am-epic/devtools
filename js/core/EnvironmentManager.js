// Environment Manager - Similar to Postman's environment system
export class EnvironmentManager {
    constructor() {
        this.storageKey = 'devtools_environments';
        this.activeEnvKey = 'devtools_active_environment';
    }

    // Get all environments
    getAllEnvironments() {
        try {
            const data = localStorage.getItem(this.storageKey);
            return data ? JSON.parse(data) : [];
        } catch (error) {
            console.error('Failed to load environments:', error);
            return [];
        }
    }

    // Get active environment
    getActiveEnvironment() {
        try {
            const activeId = localStorage.getItem(this.activeEnvKey);
            if (!activeId) return null;

            const environments = this.getAllEnvironments();
            return environments.find(env => env.id === activeId) || null;
        } catch (error) {
            console.error('Failed to load active environment:', error);
            return null;
        }
    }

    // Set active environment
    setActiveEnvironment(envId) {
        try {
            localStorage.setItem(this.activeEnvKey, envId);
            return true;
        } catch (error) {
            console.error('Failed to set active environment:', error);
            return false;
        }
    }

    // Save environment
    saveEnvironment(environment) {
        try {
            const environments = this.getAllEnvironments();
            
            // Generate ID if new
            if (!environment.id) {
                environment.id = 'env_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
            }

            // Find and update, or add new
            const index = environments.findIndex(env => env.id === environment.id);
            if (index >= 0) {
                environments[index] = environment;
            } else {
                environments.push(environment);
            }

            localStorage.setItem(this.storageKey, JSON.stringify(environments));
            return true;
        } catch (error) {
            console.error('Failed to save environment:', error);
            return false;
        }
    }

    // Delete environment
    deleteEnvironment(envId) {
        try {
            const environments = this.getAllEnvironments();
            const filtered = environments.filter(env => env.id !== envId);
            
            localStorage.setItem(this.storageKey, JSON.stringify(filtered));
            
            // Clear active if deleted
            const activeId = localStorage.getItem(this.activeEnvKey);
            if (activeId === envId) {
                localStorage.removeItem(this.activeEnvKey);
            }
            
            return true;
        } catch (error) {
            console.error('Failed to delete environment:', error);
            return false;
        }
    }

    // Get variable from active environment
    getVariable(key) {
        const activeEnv = this.getActiveEnvironment();
        return activeEnv?.variables?.[key] || '';
    }

    // Get all variables from active environment
    getVariables() {
        const activeEnv = this.getActiveEnvironment();
        return activeEnv?.variables || {};
    }

    // Replace variables in text (e.g., {{connectionString}})
    replaceVariables(text) {
        const variables = this.getVariables();
        let result = text;

        Object.keys(variables).forEach(key => {
            const placeholder = `{{${key}}}`;
            result = result.replace(new RegExp(placeholder, 'g'), variables[key]);
        });

        return result;
    }

    // Create default environment template
    static createDefaultTemplate() {
        return {
            id: null,
            name: '',
            description: '',
            variables: {
                // Azure Service Bus
                serviceBusConnectionString: '',
                serviceBusQueueName: '',
                serviceBusTopicName: '',
                serviceBusSubscriptionName: '',
                
                // Azure Event Hub
                eventHubConnectionString: '',
                eventHubName: '',
                eventHubConsumerGroup: '$Default',
                
                // HTTP/REST APIs
                apiEndpoint: '',
                apiKey: '',
                bearerToken: '',
                
                // Database
                databaseConnectionString: '',
                databaseName: '',
                
                // Custom (can add more as needed)
                customVariable1: '',
                customVariable2: '',
                customVariable3: ''
            }
        };
    }
    
    // ---------------------------------------------------------- export --

    /**
     * Serialise environments for download.
     * @param {string[]|null} ids environment ids to include, or null for all
     */
    exportEnvironments(ids = null) {
        const all = this.getAllEnvironments();
        const chosen = ids ? all.filter((env) => ids.includes(env.id)) : all;

        return {
            format: 'devtools-environments',
            version: 1,
            exportedAt: new Date().toISOString(),
            environments: chosen.map((env) => ({
                name: env.name,
                description: env.description || '',
                variables: { ...(env.variables || {}) },
            })),
        };
    }

    /**
     * Read an exported file back in. Ids are regenerated so importing never
     * overwrites an unrelated environment that happens to share an id.
     *
     * @param {object|string} payload parsed JSON or raw text
     * @param {'rename'|'replace'|'skip'} onConflict what to do when a name already exists
     * @returns {{imported: number, replaced: number, skipped: number, names: string[]}}
     */
    importEnvironments(payload, onConflict = 'rename') {
        let data = payload;
        if (typeof data === 'string') {
            try {
                data = JSON.parse(data);
            } catch (err) {
                throw new Error(`That file is not valid JSON: ${err.message}`);
            }
        }

        // Accept our own format, a bare array, or a single environment object.
        let incoming;
        if (Array.isArray(data)) incoming = data;
        else if (Array.isArray(data?.environments)) incoming = data.environments;
        else if (data && typeof data === 'object' && data.variables) incoming = [data];
        else {
            throw new Error(
                'Unrecognised file. Expected an export from this tool, an array of environments, '
                + 'or a single { name, variables } object.',
            );
        }

        const existing = this.getAllEnvironments();
        const result = { imported: 0, replaced: 0, skipped: 0, names: [] };

        for (const raw of incoming) {
            if (!raw || typeof raw !== 'object') continue;

            const variables = raw.variables && typeof raw.variables === 'object' && !Array.isArray(raw.variables)
                ? raw.variables
                : {};

            // Coerce every value to a string -- variables are substituted into text.
            const cleanVariables = {};
            for (const [key, value] of Object.entries(variables)) {
                if (!key) continue;
                cleanVariables[key] = value === null || value === undefined ? '' : String(value);
            }

            let name = String(raw.name || 'Imported environment').trim() || 'Imported environment';
            const clash = existing.find((env) => env.name === name);

            if (clash) {
                if (onConflict === 'skip') { result.skipped++; continue; }
                if (onConflict === 'replace') {
                    clash.description = String(raw.description || '');
                    clash.variables = cleanVariables;
                    this.saveEnvironment(clash);
                    result.replaced++;
                    result.names.push(name);
                    continue;
                }
                let suffix = 2;
                while (existing.some((env) => env.name === `${name} (${suffix})`)) suffix++;
                name = `${name} (${suffix})`;
            }

            const created = {
                id: null,
                name,
                description: String(raw.description || ''),
                variables: cleanVariables,
            };
            this.saveEnvironment(created);
            existing.push(created);
            result.imported++;
            result.names.push(name);
        }

        if (!result.imported && !result.replaced && !result.skipped) {
            throw new Error('The file contained no environments.');
        }

        return result;
    }

    // Add or update a custom variable
    addVariable(envId, key, value) {
        const environments = this.getAllEnvironments();
        const env = environments.find(e => e.id === envId);
        
        if (env) {
            env.variables[key] = value;
            this.saveEnvironment(env);
            return true;
        }
        return false;
    }
}
