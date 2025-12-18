import { BaseTool } from '../core/BaseTool.js';
import { StorageManager } from '../utils/StorageManager.js';
import { EnvironmentManager } from '../core/EnvironmentManager.js';

export class ServiceBusSenderTool extends BaseTool {
    constructor(config) {
        super(config);
        this.storage = new StorageManager();
        this.envManager = new EnvironmentManager();
        this.isConnected = false;
    }

    render() {
        const savedConfig = this.storage.loadConfig('servicebus-sender');
        const history = this.storage.loadHistory('servicebus-sender');
        const activeEnv = this.envManager.getActiveEnvironment();

        return `
            <div class="tool-interface">
                <h2>${this.icon} ${this.name}</h2>
                
                ${activeEnv ? `
                    <div style="padding: 0.75rem 1rem; background: rgba(81, 207, 102, 0.1); border: 1px solid rgba(81, 207, 102, 0.3); border-radius: 8px; margin-bottom: 1.5rem;">
                        <div style="color: #51cf66; font-weight: 600; font-size: 0.9rem; margin-bottom: 0.25rem;">
                            🌍 Environment: ${activeEnv.name}
                        </div>
                        <div style="color: var(--text-secondary); font-size: 0.85rem;">
                            Using environment variables. Type {{variableName}} to use them.
                        </div>
                    </div>
                ` : `
                    <div style="padding: 0.75rem 1rem; background: rgba(255, 215, 0, 0.1); border: 1px solid rgba(255, 215, 0, 0.3); border-radius: 8px; margin-bottom: 1.5rem;">
                        <div style="color: #ffd700; font-weight: 600; font-size: 0.9rem; margin-bottom: 0.25rem;">
                            ⚠️ No Environment Active
                        </div>
                        <div style="color: var(--text-secondary); font-size: 0.85rem;">
                            Click the ⚙️ button in the header to set up environments.
                        </div>
                    </div>
                `}
                
                <div class="config-section">
                    <div class="tool-section">
                        <h3>Configuration</h3>
                        
                        ${history.length > 0 ? `
                        <div style="margin-bottom: 1rem;">
                            <label style="color: var(--text-secondary); font-size: 0.875rem; display: block; margin-bottom: 0.5rem;">
                                Load from History
                            </label>
                            <select id="sbConfigHistory" style="width: 100%; padding: 0.75rem; background: var(--bg-card); border: 1px solid var(--border-color); border-radius: 8px; color: var(--text-primary); font-size: 0.9rem;">
                                <option value="">-- Select a saved configuration --</option>
                                ${history.map((h, i) => `
                                    <option value="${i}">${h.label} (${new Date(h.timestamp).toLocaleString()})</option>
                                `).join('')}
                            </select>
                        </div>
                        ` : ''}
                        
                        <div style="margin-bottom: 1rem;">
                            <label style="color: var(--text-secondary); font-size: 0.875rem; display: block; margin-bottom: 0.5rem;">
                                Configuration Label (optional)
                            </label>
                            <input type="text" id="sbConfigLabel" placeholder="e.g., Production, Dev, Test" 
                                value="${savedConfig?.label || ''}"
                                style="width: 100%; padding: 0.75rem; background: var(--bg-card); border: 1px solid var(--border-color); border-radius: 8px; color: var(--text-primary); font-size: 0.9rem; min-height: auto;">
                        </div>
                        
                        <div style="margin-bottom: 1rem;">
                            <label style="color: var(--text-secondary); font-size: 0.875rem; display: block; margin-bottom: 0.5rem;">
                                Connection String *
                            </label>
                            <textarea id="sbConnectionString" placeholder="Endpoint=sb://...;SharedAccessKeyName=...;SharedAccessKey=..." 
                                style="min-height: 100px; font-family: 'Monaco', monospace; font-size: 0.85rem;"
                            >${savedConfig?.connectionString || ''}</textarea>
                        </div>
                        
                        <div style="margin-bottom: 1rem;">
                            <label style="color: var(--text-secondary); font-size: 0.875rem; display: block; margin-bottom: 0.5rem;">
                                Queue or Topic Name *
                            </label>
                            <input type="text" id="sbQueueName" placeholder="my-queue or my-topic" 
                                value="${savedConfig?.queueName || ''}"
                                style="width: 100%; padding: 0.75rem; background: var(--bg-card); border: 1px solid var(--border-color); border-radius: 8px; color: var(--text-primary); font-size: 0.9rem; min-height: auto;">
                        </div>
                        
                        <button class="action-btn" id="sbSaveConfig">Save Configuration</button>
                        <button class="action-btn secondary" id="sbClearConfig">Clear</button>
                    </div>

                    <div class="tool-section">
                        <h3>Message</h3>
                        <textarea id="sbMessageBody" placeholder="Enter your message body (JSON, text, etc.)..."></textarea>
                        
                        <div style="margin-top: 1rem;">
                            <label style="color: var(--text-secondary); font-size: 0.875rem; display: block; margin-bottom: 0.5rem;">
                                Custom Properties (JSON, optional)
                            </label>
                            <textarea id="sbMessageProps" placeholder='{"property1": "value1", "property2": "value2"}' 
                                style="min-height: 80px; font-family: 'Monaco', monospace; font-size: 0.85rem;"></textarea>
                        </div>
                    </div>

                    <div class="tool-section">
                        <button class="action-btn" id="sbSendBtn">Send Message</button>
                        <button class="action-btn secondary" id="sbClearMessage">Clear Message</button>
                    </div>

                    <div class="tool-section">
                        <h3>Response</h3>
                        <div class="output-section" id="sbOutput">
                            <pre>Message status will appear here...</pre>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    onOpen() {
        setTimeout(() => {
            // Load from history
            document.getElementById('sbConfigHistory')?.addEventListener('change', (e) => {
                if (e.target.value !== '') {
                    const history = this.storage.loadHistory('servicebus-sender');
                    const config = history[parseInt(e.target.value)];
                    if (config) {
                        document.getElementById('sbConfigLabel').value = config.label || '';
                        document.getElementById('sbConnectionString').value = config.connectionString || '';
                        document.getElementById('sbQueueName').value = config.queueName || '';
                    }
                }
            });

            // Save configuration
            document.getElementById('sbSaveConfig')?.addEventListener('click', () => this.saveConfiguration());
            
            // Clear configuration
            document.getElementById('sbClearConfig')?.addEventListener('click', () => this.clearConfiguration());
            
            // Send message
            document.getElementById('sbSendBtn')?.addEventListener('click', () => this.sendMessage());
            
            // Clear message
            document.getElementById('sbClearMessage')?.addEventListener('click', () => this.clearMessage());
        }, 0);
    }

    saveConfiguration() {
        const label = document.getElementById('sbConfigLabel').value.trim();
        const connectionString = document.getElementById('sbConnectionString').value.trim();
        const queueName = document.getElementById('sbQueueName').value.trim();

        if (!connectionString || !queueName) {
            this.showOutput('Please provide connection string and queue/topic name', 'error');
            return;
        }

        const config = { label, connectionString, queueName };
        
        this.storage.saveConfig('servicebus-sender', config);
        this.storage.saveToHistory('servicebus-sender', config);
        
        this.showOutput('✓ Configuration saved successfully!', 'success');
        
        // Refresh the page to show new history
        setTimeout(() => {
            const currentTool = document.querySelector('.tool-interface');
            if (currentTool) {
                currentTool.innerHTML = this.render();
                this.onOpen();
            }
        }, 1000);
    }

    clearConfiguration() {
        document.getElementById('sbConfigLabel').value = '';
        document.getElementById('sbConnectionString').value = '';
        document.getElementById('sbQueueName').value = '';
        this.showOutput('Configuration cleared', 'info');
    }

    clearMessage() {
        document.getElementById('sbMessageBody').value = '';
        document.getElementById('sbMessageProps').value = '';
    }

    async sendMessage() {
        let connectionString = document.getElementById('sbConnectionString').value.trim();
        let queueName = document.getElementById('sbQueueName').value.trim();
        const messageBody = document.getElementById('sbMessageBody').value.trim();
        const messagePropsStr = document.getElementById('sbMessageProps').value.trim();

        // Replace environment variables
        connectionString = this.envManager.replaceVariables(connectionString);
        queueName = this.envManager.replaceVariables(queueName);

        if (!connectionString || !queueName || !messageBody) {
            this.showOutput('Please provide connection string, queue name, and message body', 'error');
            return;
        }

        let messageProps = {};
        if (messagePropsStr) {
            try {
                messageProps = JSON.parse(messagePropsStr);
            } catch (error) {
                this.showOutput('Invalid JSON in custom properties', 'error');
                return;
            }
        }

        this.showOutput('Sending message to Service Bus...\n\nNote: This is a client-side tool. For actual Azure Service Bus integration, you need:\n\n1. Azure Service Bus SDK (@azure/service-bus)\n2. A backend proxy to handle credentials securely\n3. Or use Azure Service Bus REST API with SAS token\n\nMessage Preview:\n' + JSON.stringify({
            queueName: queueName,
            body: messageBody,
            properties: messageProps,
            timestamp: new Date().toISOString()
        }, null, 2), 'info');

        // Simulate sending (in production, you'd call Azure Service Bus REST API or backend)
        setTimeout(() => {
            this.showOutput('✓ Message simulated successfully!\n\nTo enable real Service Bus integration:\n\n1. Install: npm install @azure/service-bus\n2. Create a backend endpoint\n3. Use REST API with SAS token\n4. Or implement Azure Functions proxy\n\nMessage Details:\n' + JSON.stringify({
                queueName: queueName,
                messageId: this.generateMessageId(),
                body: messageBody,
                properties: messageProps,
                timestamp: new Date().toISOString(),
                status: 'Simulated (Ready for Integration)'
            }, null, 2), 'success');
        }, 1000);
    }

    generateMessageId() {
        return 'msg-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
    }

    showOutput(message, type = 'info') {
        const output = document.getElementById('sbOutput');
        const colors = {
            success: '#51cf66',
            error: '#ff6b6b',
            info: 'var(--text-primary)',
            warning: '#ffd43b'
        };
        
        output.innerHTML = `<pre style="color: ${colors[type]};">${this.escapeHtml(message)}</pre>`;
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}
