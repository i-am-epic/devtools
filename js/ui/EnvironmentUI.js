import { EnvironmentManager } from '../core/EnvironmentManager.js';

export class EnvironmentUI {
    constructor() {
        this.envManager = new EnvironmentManager();
        this.currentEditingEnv = null;
    }

    render() {
        const environments = this.envManager.getAllEnvironments();
        const activeEnv = this.envManager.getActiveEnvironment();

        return `
            <div class="environment-panel">
                <div class="env-header">
                    <h2>🌍 Environment Manager</h2>
                    <p style="color: var(--text-secondary); font-size: 0.9rem; margin-top: 0.5rem;">
                        Manage your configurations like Postman environments. Set variables once, use everywhere.
                    </p>
                </div>

                <div class="env-section">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem;">
                        <h3 style="margin: 0;">Active Environment</h3>
                        <button class="action-btn" id="createNewEnv">+ New Environment</button>
                    </div>
                    
                    <select id="activeEnvSelect" style="width: 100%; padding: 0.875rem; font-size: 1rem;">
                        <option value="">-- No Environment Selected --</option>
                        ${environments.map(env => `
                            <option value="${env.id}" ${activeEnv?.id === env.id ? 'selected' : ''}>
                                ${env.name}${env.description ? ' - ' + env.description : ''}
                            </option>
                        `).join('')}
                    </select>
                </div>

                ${environments.length > 0 ? `
                    <div class="env-section">
                        <h3>Your Environments</h3>
                        <div class="env-list">
                            ${environments.map(env => `
                                <div class="env-card ${activeEnv?.id === env.id ? 'active' : ''}" data-env-id="${env.id}">
                                    <div class="env-card-header">
                                        <div>
                                            <div class="env-name">${env.name}</div>
                                            <div class="env-description">${env.description || 'No description'}</div>
                                        </div>
                                        <div class="env-actions">
                                            <button class="env-btn edit-env" data-env-id="${env.id}" title="Edit">✏️</button>
                                            <button class="env-btn delete-env" data-env-id="${env.id}" title="Delete">🗑️</button>
                                        </div>
                                    </div>
                                    <div class="env-vars-count">
                                        ${Object.keys(env.variables || {}).filter(k => env.variables[k]).length} variables configured
                                    </div>
                                </div>
                            `).join('')}
                        </div>
                    </div>
                ` : `
                    <div class="env-section">
                        <div style="text-align: center; padding: 3rem 1rem; color: var(--text-secondary);">
                            <div style="font-size: 3rem; margin-bottom: 1rem;">📦</div>
                            <p>No environments yet.</p>
                            <p style="font-size: 0.9rem; margin-top: 0.5rem;">Create your first environment to get started!</p>
                        </div>
                    </div>
                `}

                <div class="env-section info-box">
                    <h4>💡 About Environments</h4>
                    <ul style="margin-left: 1.5rem; color: var(--text-secondary); font-size: 0.9rem; line-height: 1.8;">
                        <li><strong>Multiple Environments:</strong> Create separate configs for Dev, Test, Production</li>
                        <li><strong>Reusable Variables:</strong> Define once, use in all tools</li>
                        <li><strong>Quick Switching:</strong> Change environments with one click</li>
                        <li><strong>Persistent Storage:</strong> Saved in your browser</li>
                    </ul>
                </div>

                <div class="env-section info-box" style="background: var(--bg-card); border-left: 3px solid #51cf66;">
                    <h4>🔍 Queue vs Topic - When to Use</h4>
                    <div style="color: var(--text-secondary); font-size: 0.9rem; line-height: 1.8;">
                        <p><strong>Queue (Point-to-Point):</strong></p>
                        <ul style="margin-left: 1.5rem; margin-bottom: 1rem;">
                            <li>One message → One consumer</li>
                            <li>Message is consumed (deleted) after processing</li>
                            <li>Use for: Task queues, job processing, load balancing</li>
                            <li>Example: Order processing, email sending</li>
                        </ul>
                        
                        <p><strong>Topic (Publish-Subscribe):</strong></p>
                        <ul style="margin-left: 1.5rem;">
                            <li>One message → Multiple subscribers</li>
                            <li>Each subscription gets a copy of the message</li>
                            <li>Message consumed per subscription independently</li>
                            <li>Use for: Event broadcasting, notifications, logging</li>
                            <li>Example: User signup event → Send email, Update analytics, Log event</li>
                        </ul>
                    </div>
                </div>
            </div>
        `;
    }

    renderEditForm(envId = null) {
        let env = envId ? this.envManager.getAllEnvironments().find(e => e.id === envId) : null;
        if (!env) {
            env = EnvironmentManager.createDefaultTemplate();
        }

        this.currentEditingEnv = env;

        return `
            <div class="tool-interface">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem;">
                    <h2>${envId ? '✏️ Edit' : '➕ Create'} Environment</h2>
                    <button class="action-btn secondary" id="backToEnvList">← Back</button>
                </div>

                <div class="tool-section">
                    <h3>Basic Information</h3>
                    
                    <div style="margin-bottom: 1rem;">
                        <label>Environment Name *</label>
                        <input type="text" id="envName" value="${env.name}" 
                            placeholder="e.g., Production, Development, Testing"
                            style="width: 100%; padding: 0.875rem; min-height: auto;">
                    </div>

                    <div style="margin-bottom: 1rem;">
                        <label>Description (optional)</label>
                        <input type="text" id="envDescription" value="${env.description || ''}" 
                            placeholder="Brief description of this environment"
                            style="width: 100%; padding: 0.875rem; min-height: auto;">
                    </div>
                </div>

                <div class="tool-section">
                    <h3>Azure Service Bus Variables</h3>
                    
                    <div style="margin-bottom: 1rem;">
                        <label>Service Bus Connection String</label>
                        <textarea id="varServiceBusConnectionString" placeholder="Endpoint=sb://...;SharedAccessKeyName=...;SharedAccessKey=..."
                            style="min-height: 100px; font-family: Monaco, monospace; font-size: 0.85rem;"
                        >${env.variables.serviceBusConnectionString}</textarea>
                        <small style="color: var(--text-secondary); font-size: 0.8rem;">Use as: {{serviceBusConnectionString}}</small>
                    </div>

                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin-bottom: 1rem;">
                        <div>
                            <label>Queue Name</label>
                            <input type="text" id="varServiceBusQueueName" value="${env.variables.serviceBusQueueName}"
                                placeholder="my-queue"
                                style="width: 100%; padding: 0.875rem; min-height: auto;">
                            <small style="color: var(--text-secondary); font-size: 0.8rem;">{{serviceBusQueueName}}</small>
                        </div>
                        <div>
                            <label>Topic Name</label>
                            <input type="text" id="varServiceBusTopicName" value="${env.variables.serviceBusTopicName}"
                                placeholder="my-topic"
                                style="width: 100%; padding: 0.875rem; min-height: auto;">
                            <small style="color: var(--text-secondary); font-size: 0.8rem;">{{serviceBusTopicName}}</small>
                        </div>
                    </div>

                    <div style="margin-bottom: 1rem;">
                        <label>Subscription Name (for Topics)</label>
                        <input type="text" id="varServiceBusSubscriptionName" value="${env.variables.serviceBusSubscriptionName}"
                            placeholder="my-subscription"
                            style="width: 100%; padding: 0.875rem; min-height: auto;">
                        <small style="color: var(--text-secondary); font-size: 0.8rem;">{{serviceBusSubscriptionName}}</small>
                    </div>
                </div>

                <div class="tool-section">
                    <h3>Azure Event Hub Variables</h3>
                    
                    <div style="margin-bottom: 1rem;">
                        <label>Event Hub Connection String</label>
                        <textarea id="varEventHubConnectionString" placeholder="Endpoint=sb://...;SharedAccessKeyName=...;SharedAccessKey=...;EntityPath=..."
                            style="min-height: 100px; font-family: Monaco, monospace; font-size: 0.85rem;"
                        >${env.variables.eventHubConnectionString}</textarea>
                        <small style="color: var(--text-secondary); font-size: 0.8rem;">{{eventHubConnectionString}}</small>
                    </div>

                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin-bottom: 1rem;">
                        <div>
                            <label>Event Hub Name</label>
                            <input type="text" id="varEventHubName" value="${env.variables.eventHubName}"
                                placeholder="my-eventhub"
                                style="width: 100%; padding: 0.875rem; min-height: auto;">
                            <small style="color: var(--text-secondary); font-size: 0.8rem;">{{eventHubName}}</small>
                        </div>
                        <div>
                            <label>Consumer Group</label>
                            <input type="text" id="varEventHubConsumerGroup" value="${env.variables.eventHubConsumerGroup}"
                                placeholder="$Default"
                                style="width: 100%; padding: 0.875rem; min-height: auto;">
                            <small style="color: var(--text-secondary); font-size: 0.8rem;">{{eventHubConsumerGroup}}</small>
                        </div>
                    </div>
                </div>

                <div class="tool-section">
                    <h3>HTTP/REST API Variables</h3>
                    
                    <div style="margin-bottom: 1rem;">
                        <label>API Endpoint</label>
                        <input type="text" id="varApiEndpoint" value="${env.variables.apiEndpoint}"
                            placeholder="https://api.example.com"
                            style="width: 100%; padding: 0.875rem; min-height: auto;">
                        <small style="color: var(--text-secondary); font-size: 0.8rem;">{{apiEndpoint}}</small>
                    </div>

                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin-bottom: 1rem;">
                        <div>
                            <label>API Key</label>
                            <input type="password" id="varApiKey" value="${env.variables.apiKey}"
                                placeholder="your-api-key"
                                style="width: 100%; padding: 0.875rem; min-height: auto;">
                            <small style="color: var(--text-secondary); font-size: 0.8rem;">{{apiKey}}</small>
                        </div>
                        <div>
                            <label>Bearer Token</label>
                            <input type="password" id="varBearerToken" value="${env.variables.bearerToken}"
                                placeholder="your-bearer-token"
                                style="width: 100%; padding: 0.875rem; min-height: auto;">
                            <small style="color: var(--text-secondary); font-size: 0.8rem;">{{bearerToken}}</small>
                        </div>
                    </div>
                </div>

                <div class="tool-section">
                    <h3>Database Variables</h3>
                    
                    <div style="margin-bottom: 1rem;">
                        <label>Database Connection String</label>
                        <textarea id="varDatabaseConnectionString" placeholder="Server=...;Database=...;User Id=...;Password=..."
                            style="min-height: 80px; font-family: Monaco, monospace; font-size: 0.85rem;"
                        >${env.variables.databaseConnectionString}</textarea>
                        <small style="color: var(--text-secondary); font-size: 0.8rem;">{{databaseConnectionString}}</small>
                    </div>

                    <div style="margin-bottom: 1rem;">
                        <label>Database Name</label>
                        <input type="text" id="varDatabaseName" value="${env.variables.databaseName}"
                            placeholder="my-database"
                            style="width: 100%; padding: 0.875rem; min-height: auto;">
                        <small style="color: var(--text-secondary); font-size: 0.8rem;">{{databaseName}}</small>
                    </div>
                </div>

                <div class="tool-section">
                    <h3>Custom Variables</h3>
                    <p style="color: var(--text-secondary); font-size: 0.85rem; margin-bottom: 1rem;">
                        Add any custom variables you need for your tools
                    </p>
                    
                    <div style="margin-bottom: 1rem;">
                        <label>Custom Variable 1</label>
                        <input type="text" id="varCustomVariable1" value="${env.variables.customVariable1}"
                            placeholder="Custom value"
                            style="width: 100%; padding: 0.875rem; min-height: auto;">
                        <small style="color: var(--text-secondary); font-size: 0.8rem;">{{customVariable1}}</small>
                    </div>

                    <div style="margin-bottom: 1rem;">
                        <label>Custom Variable 2</label>
                        <input type="text" id="varCustomVariable2" value="${env.variables.customVariable2}"
                            placeholder="Custom value"
                            style="width: 100%; padding: 0.875rem; min-height: auto;">
                        <small style="color: var(--text-secondary); font-size: 0.8rem;">{{customVariable2}}</small>
                    </div>

                    <div style="margin-bottom: 1rem;">
                        <label>Custom Variable 3</label>
                        <input type="text" id="varCustomVariable3" value="${env.variables.customVariable3}"
                            placeholder="Custom value"
                            style="width: 100%; padding: 0.875rem; min-height: auto;">
                        <small style="color: var(--text-secondary); font-size: 0.8rem;">{{customVariable3}}</small>
                    </div>
                </div>

                <div class="tool-section">
                    <button class="action-btn" id="saveEnvBtn">💾 Save Environment</button>
                    <button class="action-btn secondary" id="cancelEnvBtn">Cancel</button>
                </div>
            </div>
        `;
    }

    attachEventListeners() {
        // Active environment selector
        document.getElementById('activeEnvSelect')?.addEventListener('change', (e) => {
            if (e.target.value) {
                this.envManager.setActiveEnvironment(e.target.value);
                this.showMessage('Environment activated!', 'success');
                this.refreshUI();
            }
        });

        // Create new environment
        document.getElementById('createNewEnv')?.addEventListener('click', () => {
            this.showEditForm();
        });

        // Edit environment buttons
        document.querySelectorAll('.edit-env').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const envId = btn.dataset.envId;
                this.showEditForm(envId);
            });
        });

        // Delete environment buttons
        document.querySelectorAll('.delete-env').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const envId = btn.dataset.envId;
                if (confirm('Are you sure you want to delete this environment?')) {
                    this.envManager.deleteEnvironment(envId);
                    this.showMessage('Environment deleted', 'info');
                    this.refreshUI();
                }
            });
        });
    }

    attachEditFormListeners() {
        // Back button
        document.getElementById('backToEnvList')?.addEventListener('click', () => {
            this.refreshUI();
        });

        // Cancel button
        document.getElementById('cancelEnvBtn')?.addEventListener('click', () => {
            this.refreshUI();
        });

        // Save button
        document.getElementById('saveEnvBtn')?.addEventListener('click', () => {
            this.saveEnvironment();
        });
    }

    saveEnvironment() {
        const env = this.currentEditingEnv || EnvironmentManager.createDefaultTemplate();

        env.name = document.getElementById('envName').value.trim();
        env.description = document.getElementById('envDescription').value.trim();

        if (!env.name) {
            this.showMessage('Please provide an environment name', 'error');
            return;
        }

        // Collect all variables
        env.variables = {
            serviceBusConnectionString: document.getElementById('varServiceBusConnectionString').value.trim(),
            serviceBusQueueName: document.getElementById('varServiceBusQueueName').value.trim(),
            serviceBusTopicName: document.getElementById('varServiceBusTopicName').value.trim(),
            serviceBusSubscriptionName: document.getElementById('varServiceBusSubscriptionName').value.trim(),
            eventHubConnectionString: document.getElementById('varEventHubConnectionString').value.trim(),
            eventHubName: document.getElementById('varEventHubName').value.trim(),
            eventHubConsumerGroup: document.getElementById('varEventHubConsumerGroup').value.trim(),
            apiEndpoint: document.getElementById('varApiEndpoint').value.trim(),
            apiKey: document.getElementById('varApiKey').value.trim(),
            bearerToken: document.getElementById('varBearerToken').value.trim(),
            databaseConnectionString: document.getElementById('varDatabaseConnectionString').value.trim(),
            databaseName: document.getElementById('varDatabaseName').value.trim(),
            customVariable1: document.getElementById('varCustomVariable1').value.trim(),
            customVariable2: document.getElementById('varCustomVariable2').value.trim(),
            customVariable3: document.getElementById('varCustomVariable3').value.trim()
        };

        this.envManager.saveEnvironment(env);
        this.showMessage('Environment saved successfully!', 'success');
        
        setTimeout(() => this.refreshUI(), 1000);
    }

    showEditForm(envId = null) {
        const modalBody = document.getElementById('modalBody');
        if (modalBody) {
            modalBody.innerHTML = this.renderEditForm(envId);
            this.attachEditFormListeners();
        }
    }

    refreshUI() {
        const modalBody = document.getElementById('modalBody');
        if (modalBody) {
            modalBody.innerHTML = this.render();
            setTimeout(() => this.attachEventListeners(), 0);
        }
    }

    showMessage(message, type = 'info') {
        // Create a toast notification
        const toast = document.createElement('div');
        toast.className = 'toast-notification ' + type;
        toast.textContent = message;
        toast.style.cssText = `
            position: fixed;
            top: 2rem;
            right: 2rem;
            padding: 1rem 1.5rem;
            background: var(--bg-card);
            border: 1px solid var(--border-color);
            border-radius: 12px;
            color: var(--text-primary);
            z-index: 10000;
            animation: slideInRight 0.3s ease-out;
            box-shadow: var(--shadow-hover);
        `;

        if (type === 'success') toast.style.borderColor = '#51cf66';
        if (type === 'error') toast.style.borderColor = '#ff6b6b';

        document.body.appendChild(toast);

        setTimeout(() => {
            toast.style.animation = 'slideOutRight 0.3s ease-out';
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    }
}
