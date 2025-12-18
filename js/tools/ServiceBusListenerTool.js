import { BaseTool } from '../core/BaseTool.js';
import { StorageManager } from '../utils/StorageManager.js';
import { EnvironmentManager } from '../core/EnvironmentManager.js';

export class ServiceBusListenerTool extends BaseTool {
    constructor(config) {
        super(config);
        this.storage = new StorageManager();
        this.envManager = new EnvironmentManager();
        this.isListening = false;
        this.messages = [];
        this.simulationInterval = null;
    }

    render() {
        const savedConfig = this.storage.loadConfig('servicebus-listener');
        const history = this.storage.loadHistory('servicebus-listener');
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
                ` : ''}
                
                <div class="config-section">
                    <div class="tool-section">
                        <h3>Configuration</h3>
                        
                        ${history.length > 0 ? `
                        <div style="margin-bottom: 1rem;">
                            <label style="color: var(--text-secondary); font-size: 0.875rem; display: block; margin-bottom: 0.5rem;">
                                Load from History
                            </label>
                            <select id="sblConfigHistory" style="width: 100%; padding: 0.75rem; background: var(--bg-card); border: 1px solid var(--border-color); border-radius: 8px; color: var(--text-primary); font-size: 0.9rem;">
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
                            <input type="text" id="sblConfigLabel" placeholder="e.g., Production, Dev, Test" 
                                value="${savedConfig?.label || ''}"
                                style="width: 100%; padding: 0.75rem; background: var(--bg-card); border: 1px solid var(--border-color); border-radius: 8px; color: var(--text-primary); font-size: 0.9rem; min-height: auto;">
                        </div>
                        
                        <div style="margin-bottom: 1rem;">
                            <label style="color: var(--text-secondary); font-size: 0.875rem; display: block; margin-bottom: 0.5rem;">
                                Connection String *
                            </label>
                            <textarea id="sblConnectionString" placeholder="Endpoint=sb://...;SharedAccessKeyName=...;SharedAccessKey=..." 
                                style="min-height: 100px; font-family: 'Monaco', monospace; font-size: 0.85rem;"
                            >${savedConfig?.connectionString || ''}</textarea>
                        </div>
                        
                        <div style="margin-bottom: 1rem;">
                            <label style="color: var(--text-secondary); font-size: 0.875rem; display: block; margin-bottom: 0.5rem;">
                                Queue or Topic/Subscription Name *
                            </label>
                            <input type="text" id="sblQueueName" placeholder="my-queue or my-topic/subscriptions/my-sub" 
                                value="${savedConfig?.queueName || ''}"
                                style="width: 100%; padding: 0.75rem; background: var(--bg-card); border: 1px solid var(--border-color); border-radius: 8px; color: var(--text-primary); font-size: 0.9rem; min-height: auto;">
                        </div>
                        
                        <button class="action-btn" id="sblSaveConfig">Save Configuration</button>
                        <button class="action-btn secondary" id="sblClearConfig">Clear</button>
                    </div>

                    <div class="tool-section">
                        <h3>Listener Control</h3>
                        <div style="display: flex; gap: 0.5rem; align-items: center; margin-bottom: 1rem;">
                            <button class="action-btn" id="sblStartBtn">Start Listening</button>
                            <button class="action-btn secondary" id="sblStopBtn" disabled>Stop Listening</button>
                            <button class="action-btn secondary" id="sblClearMessages">Clear Messages</button>
                        </div>
                        <div id="sblStatus" style="padding: 0.75rem; background: var(--bg-card); border: 1px solid var(--border-color); border-radius: 8px; color: var(--text-secondary); font-size: 0.9rem;">
                            Status: Not connected
                        </div>
                    </div>

                    <div class="tool-section">
                        <h3>Received Messages (<span id="sblMessageCount">0</span>)</h3>
                        <div class="output-section" id="sblOutput" style="max-height: 400px; overflow-y: auto;">
                            <pre>No messages received yet. Click "Start Listening" to begin...</pre>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    onOpen() {
        setTimeout(() => {
            // Load from history
            document.getElementById('sblConfigHistory')?.addEventListener('change', (e) => {
                if (e.target.value !== '') {
                    const history = this.storage.loadHistory('servicebus-listener');
                    const config = history[parseInt(e.target.value)];
                    if (config) {
                        document.getElementById('sblConfigLabel').value = config.label || '';
                        document.getElementById('sblConnectionString').value = config.connectionString || '';
                        document.getElementById('sblQueueName').value = config.queueName || '';
                    }
                }
            });

            // Save configuration
            document.getElementById('sblSaveConfig')?.addEventListener('click', () => this.saveConfiguration());
            
            // Clear configuration
            document.getElementById('sblClearConfig')?.addEventListener('click', () => this.clearConfiguration());
            
            // Start listening
            document.getElementById('sblStartBtn')?.addEventListener('click', () => this.startListening());
            
            // Stop listening
            document.getElementById('sblStopBtn')?.addEventListener('click', () => this.stopListening());
            
            // Clear messages
            document.getElementById('sblClearMessages')?.addEventListener('click', () => this.clearMessages());
        }, 0);
    }

    onClose() {
        this.stopListening();
    }

    saveConfiguration() {
        const label = document.getElementById('sblConfigLabel').value.trim();
        const connectionString = document.getElementById('sblConnectionString').value.trim();
        const queueName = document.getElementById('sblQueueName').value.trim();

        if (!connectionString || !queueName) {
            this.updateStatus('Please provide connection string and queue/topic name', 'error');
            return;
        }

        const config = { label, connectionString, queueName };
        
        this.storage.saveConfig('servicebus-listener', config);
        this.storage.saveToHistory('servicebus-listener', config);
        
        this.updateStatus('✓ Configuration saved successfully!', 'success');
        
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
        document.getElementById('sblConfigLabel').value = '';
        document.getElementById('sblConnectionString').value = '';
        document.getElementById('sblQueueName').value = '';
        this.updateStatus('Configuration cleared', 'info');
    }

    startListening() {
        let connectionString = document.getElementById('sblConnectionString').value.trim();
        let queueName = document.getElementById('sblQueueName').value.trim();

        // Replace environment variables
        connectionString = this.envManager.replaceVariables(connectionString);
        queueName = this.envManager.replaceVariables(queueName);

        if (!connectionString || !queueName) {
            this.updateStatus('Please provide connection string and queue/topic name', 'error');
            return;
        }

        this.isListening = true;
        this.messages = [];
        this.processedMessageIds = new Set(); // Track processed messages to avoid duplicates
        
        // Update UI
        document.getElementById('sblStartBtn').disabled = true;
        document.getElementById('sblStopBtn').disabled = false;
        
        this.updateStatus('🟢 Connected - Listening for messages...', 'success');
        this.addMessage({
            type: 'system',
            message: `Listener started for: ${queueName}\n\n📚 How Service Bus Works:\n\n${queueName.includes('topic') || queueName.includes('subscription') ? 
                '📢 TOPIC MODE:\n• Messages sent to topic are copied to all subscriptions\n• Each subscription processes messages independently\n• Same message can be read by multiple subscribers\n• Message is consumed (deleted) after successful processing per subscription\n' :
                '📫 QUEUE MODE:\n• Messages are consumed (deleted) after reading\n• One message → One consumer\n• FIFO order guaranteed\n• Peek-lock pattern: Lock → Process → Complete/Abandon\n'
            }\n💡 In Production:\n• Messages locked for 60s during processing\n• Must call Complete() to remove message\n• Call Abandon() to return to queue\n• Max delivery count prevents infinite retries\n\nDemo mode: Simulating new messages every 5 seconds...`
        });

        // Simulate receiving messages (in production, this would be real Service Bus receiver)
        this.simulationInterval = setInterval(() => {
            if (this.isListening) {
                this.simulateMessage(queueName);
            }
        }, 5000);
    }

    stopListening() {
        this.isListening = false;
        
        if (this.simulationInterval) {
            clearInterval(this.simulationInterval);
            this.simulationInterval = null;
        }

        // Update UI
        document.getElementById('sblStartBtn').disabled = false;
        document.getElementById('sblStopBtn').disabled = true;
        
        const totalMessages = this.messages.filter(m => m.type === 'message').length;
        
        this.updateStatus('⚫ Disconnected - Stopped listening', 'info');
        this.addMessage({
            type: 'system',
            message: `Listener stopped.\n\n📊 Session Summary:\n• Total messages received: ${totalMessages}\n• All messages consumed successfully\n• No messages left in queue (demo mode)\n\n✓ In production, messages would be:\n  - Locked during processing\n  - Completed (deleted) or Abandoned\n  - Returned to queue if not completed within lock time`
        });
    }

    clearMessages() {
        this.messages = [];
        const output = document.getElementById('sblOutput');
        output.innerHTML = '<pre>Messages cleared.</pre>';
        document.getElementById('sblMessageCount').textContent = '0';
    }

    simulateMessage(queueName) {
        const sampleMessages = [
            { type: 'order', data: { orderId: 'ORD-' + Date.now(), amount: (Math.random() * 1000).toFixed(2), status: 'pending' } },
            { type: 'notification', data: { title: 'New Message', content: 'You have a new notification', userId: 'user-' + Math.floor(Math.random() * 1000) } },
            { type: 'event', data: { eventType: 'user.login', userId: 'user-' + Math.floor(Math.random() * 1000), timestamp: new Date().toISOString() } },
            { type: 'telemetry', data: { deviceId: 'device-' + Math.floor(Math.random() * 100), temperature: (20 + Math.random() * 10).toFixed(1), humidity: (50 + Math.random() * 30).toFixed(0) } }
        ];

        const sample = sampleMessages[Math.floor(Math.random() * sampleMessages.length)];
        const messageId = this.generateMessageId();
        
        // Check if already processed (prevents duplicates)
        if (this.processedMessageIds.has(messageId)) {
            return;
        }
        
        const message = {
            messageId: messageId,
            queueName: queueName,
            body: sample.data,
            properties: {
                messageType: sample.type,
                contentType: 'application/json',
                deliveryCount: 1
            },
            enqueuedTimeUtc: new Date().toISOString(),
            sequenceNumber: Date.now(),
            lockToken: 'lock-' + Math.random().toString(36).substr(2, 16),
            expiresAtUtc: new Date(Date.now() + 60000).toISOString() // 60 sec lock
        };

        // Mark as processed (consumed)
        this.processedMessageIds.add(messageId);

        this.addMessage({
            type: 'message',
            message: message,
            consumed: true
        });
    }

    addMessage(data) {
        this.messages.push(data);
        
        const output = document.getElementById('sblOutput');
        const messageCount = document.getElementById('sblMessageCount');
        
        let html = '';
        
        this.messages.forEach((msg, index) => {
            if (msg.type === 'system') {
                html += `<div style="padding: 0.75rem; margin-bottom: 0.5rem; background: var(--bg-secondary); border-left: 3px solid var(--text-secondary); border-radius: 4px;">
                    <pre style="color: var(--text-secondary); font-size: 0.85rem; white-space: pre-wrap;">${this.escapeHtml(msg.message)}</pre>
                </div>`;
            } else {
                const msgNum = this.messages.slice(0, index + 1).filter(m => m.type === 'message').length;
                html += `<div style="padding: 0.75rem; margin-bottom: 0.5rem; background: var(--bg-secondary); border-left: 3px solid #51cf66; border-radius: 4px;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem;">
                        <div style="color: #51cf66; font-weight: 600; font-size: 0.9rem;">
                            📨 Message #${msgNum} - ${new Date(msg.message.enqueuedTimeUtc).toLocaleTimeString()}
                        </div>
                        <div style="color: #51cf66; font-size: 0.75rem; background: rgba(81, 207, 102, 0.1); padding: 0.25rem 0.5rem; border-radius: 4px;">
                            ✓ CONSUMED
                        </div>
                    </div>
                    <div style="margin-bottom: 0.5rem; color: var(--text-secondary); font-size: 0.8rem;">
                        ID: ${msg.message.messageId} | Lock: ${msg.message.lockToken}
                    </div>
                    <pre style="font-size: 0.85rem;">${this.escapeHtml(JSON.stringify(msg.message.body, null, 2))}</pre>
                </div>`;
            }
        });
        
        output.innerHTML = html;
        output.scrollTop = output.scrollHeight;
        
        const messageOnlyCount = this.messages.filter(m => m.type === 'message').length;
        messageCount.textContent = messageOnlyCount;
    }

    updateStatus(message, type = 'info') {
        const status = document.getElementById('sblStatus');
        const colors = {
            success: '#51cf66',
            error: '#ff6b6b',
            info: 'var(--text-secondary)',
            warning: '#ffd43b'
        };
        
        status.style.color = colors[type];
        status.textContent = `Status: ${message}`;
    }

    generateMessageId() {
        return 'msg-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}
