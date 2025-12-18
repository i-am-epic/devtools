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
