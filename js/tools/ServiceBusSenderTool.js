// Publish messages to an Azure Service Bus queue or topic.
import { BaseTool } from '../core/BaseTool.js';
import { StorageManager } from '../utils/StorageManager.js';
import { EnvironmentManager } from '../core/EnvironmentManager.js';
import { call, checkProxy, inspectConnectionString, relayBanner } from '../lib/servicebus.js';
import { toast } from '../ui/toast.js';

const escapeHtml = (value) => String(value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

export class ServiceBusSenderTool extends BaseTool {
    constructor(config) {
        super(config);
        this.storage = new StorageManager();
        this.envManager = new EnvironmentManager();
        this.sent = 0;
    }

    render() {
        const saved = this.storage.loadConfig('servicebus-sender') || {};
        const history = this.storage.loadHistory('servicebus-sender') || [];
        const activeEnv = this.envManager.getActiveEnvironment();

        return `
            <div class="tool-interface" data-cat="cloud">
                <h2><span class="tool-icon">${this.icon}</span>${escapeHtml(this.name)}</h2>
                <p class="tool-lede">
                    Publish a message to a queue or topic using a connection string. Requests are relayed through
                    your own machine, so the credentials never go anywhere except Azure.
                </p>

                <div id="sbRelayStatus"></div>

                ${activeEnv ? `
                    <div class="alert info">
                        <span>🌍</span>
                        <span>Environment <strong>${escapeHtml(activeEnv.name)}</strong> is active — write
                        <code>{{variableName}}</code> anywhere below to substitute a variable.</span>
                    </div>` : ''}

                <div class="tool-section">
                    <h3>Connection</h3>

                    ${history.length ? `
                        <div style="margin-bottom:0.85rem;">
                            <label for="sbHistory">Saved connections</label>
                            <select id="sbHistory">
                                <option value="">— Select a saved connection —</option>
                                ${history.map((entry, index) => `
                                    <option value="${index}">${escapeHtml(entry.label || entry.queueName || 'Untitled')} · ${escapeHtml(new Date(entry.timestamp).toLocaleString())}</option>
                                `).join('')}
                            </select>
                        </div>` : ''}

                    <div style="margin-bottom:0.85rem;">
                        <label for="sbConnectionString">Connection string</label>
                        <textarea id="sbConnectionString" class="short" spellcheck="false"
                            placeholder="Endpoint=sb://your-namespace.servicebus.windows.net/;SharedAccessKeyName=RootManageSharedAccessKey;SharedAccessKey=…">${escapeHtml(saved.connectionString || '')}</textarea>
                        <div class="helper-text" id="sbConnInfo"></div>
                    </div>

                    <div class="field-group">
                        <div>
                            <label for="sbEntity">Queue, or topic name</label>
                            <input type="text" id="sbEntity" value="${escapeHtml(saved.queueName || '')}" placeholder="orders">
                        </div>
                        <div>
                            <label for="sbLabel">Save as (optional)</label>
                            <input type="text" id="sbLabel" value="${escapeHtml(saved.label || '')}" placeholder="Production orders">
                        </div>
                    </div>

                    <div class="btn-row">
                        <button class="action-btn secondary" id="sbTest">Test connection</button>
                        <button class="action-btn secondary" id="sbSave">Save connection</button>
                        <button class="action-btn secondary" id="sbForget">Forget saved</button>
                    </div>
                </div>

                <div class="tool-section">
                    <h3>Message</h3>
                    <textarea id="sbBody" class="short" spellcheck="false"
                        placeholder='{"orderId": 1234, "status": "created"}'></textarea>

                    <div class="field-group" style="margin-top:0.85rem;">
                        <div>
                            <label for="sbContentType">Content type</label>
                            <input type="text" id="sbContentType" value="application/json" placeholder="application/json">
                        </div>
                        <div>
                            <label for="sbMessageId">Message ID (optional)</label>
                            <input type="text" id="sbMessageId" placeholder="auto-generated if blank">
                        </div>
                        <div>
                            <label for="sbSessionId">Session ID (optional)</label>
                            <input type="text" id="sbSessionId" placeholder="required for session-enabled entities">
                        </div>
                        <div>
                            <label for="sbCorrelationId">Correlation ID (optional)</label>
                            <input type="text" id="sbCorrelationId" placeholder="">
                        </div>
                        <div>
                            <label for="sbSubject">Subject / Label (optional)</label>
                            <input type="text" id="sbSubject" placeholder="">
                        </div>
                        <div>
                            <label for="sbTtl">Time to live, seconds (optional)</label>
                            <input type="number" id="sbTtl" min="1" placeholder="entity default">
                        </div>
                    </div>

                    <div style="margin-top:0.85rem;">
                        <label for="sbProperties">Custom application properties (JSON object, optional)</label>
                        <textarea id="sbProperties" class="short" spellcheck="false"
                            style="min-height:90px" placeholder='{"tenant": "acme", "priority": 1}'></textarea>
                    </div>

                    <div class="field-group" style="margin-top:0.85rem;">
                        <div>
                            <label for="sbRepeat">Send this message N times</label>
                            <input type="number" id="sbRepeat" value="1" min="1" max="100">
                        </div>
                    </div>
                </div>

                <div class="btn-row">
                    <button class="action-btn" id="sbSend">Send message</button>
                    <button class="action-btn secondary" id="sbClear">Clear message</button>
                </div>

                <div class="tool-section" style="margin-top:1.5rem;">
                    <h3>Log</h3>
                    <div class="output-section" id="sbLog"><pre>Nothing sent yet.</pre></div>
                </div>
            </div>
        `;
    }

    onOpen() {
        setTimeout(async () => {
            const status = document.getElementById('sbRelayStatus');
            const available = await checkProxy(true);
            if (status) status.innerHTML = relayBanner(available);

            document.getElementById('sbSend')?.addEventListener('click', () => this.send());
            document.getElementById('sbTest')?.addEventListener('click', () => this.test());
            document.getElementById('sbSave')?.addEventListener('click', () => this.saveConnection());
            document.getElementById('sbForget')?.addEventListener('click', () => this.forget());
            document.getElementById('sbClear')?.addEventListener('click', () => {
                document.getElementById('sbBody').value = '';
                document.getElementById('sbProperties').value = '';
            });

            const connection = document.getElementById('sbConnectionString');
            connection?.addEventListener('input', () => this.describeConnection());
            this.describeConnection();

            document.getElementById('sbHistory')?.addEventListener('change', (event) => {
                if (event.target.value === '') return;
                const history = this.storage.loadHistory('servicebus-sender') || [];
                const entry = history[Number(event.target.value)];
                if (!entry) return;
                document.getElementById('sbConnectionString').value = entry.connectionString || '';
                document.getElementById('sbEntity').value = entry.queueName || '';
                document.getElementById('sbLabel').value = entry.label || '';
                this.describeConnection();
            });
        }, 0);
    }

    describeConnection() {
        const node = document.getElementById('sbConnInfo');
        const raw = document.getElementById('sbConnectionString')?.value || '';
        if (!node) return;

        if (!raw.trim()) { node.textContent = ''; return; }

        const info = inspectConnectionString(this.envManager.replaceVariables(raw));
        node.innerHTML = info.valid
            ? `<span style="color:var(--green)">✓ namespace <strong>${escapeHtml(info.namespace)}</strong> · policy <strong>${escapeHtml(info.keyName)}</strong> · key ${info.keyLength} chars${info.entityPath ? ` · EntityPath ${escapeHtml(info.entityPath)}` : ''}</span>`
            : `<span style="color:var(--red)">✕ ${escapeHtml(info.error)}</span>`;
    }

    readConnection() {
        const connectionString = this.envManager.replaceVariables(
            document.getElementById('sbConnectionString')?.value.trim() || '',
        );
        const entity = this.envManager.replaceVariables(
            document.getElementById('sbEntity')?.value.trim() || '',
        );

        const info = inspectConnectionString(connectionString);
        if (!info.valid) throw new Error(info.error);
        if (!entity && !info.entityPath) throw new Error('Enter a queue or topic name');

        return { connectionString, entity: entity || info.entityPath };
    }

    log(message, kind = 'info') {
        const node = document.getElementById('sbLog');
        if (!node) return;
        const colour = { ok: 'var(--green)', err: 'var(--red)', info: 'var(--ink)' }[kind];
        const stamp = new Date().toLocaleTimeString();
        const entry = `<pre style="color:${colour}">[${stamp}] ${escapeHtml(message)}</pre>`;
        if (node.querySelector('pre')?.textContent === 'Nothing sent yet.') node.innerHTML = '';
        node.insertAdjacentHTML('afterbegin', entry);
    }

    async test() {
        const button = document.getElementById('sbTest');
        try {
            const { connectionString, entity } = this.readConnection();
            button.disabled = true;
            button.textContent = 'Testing…';
            const result = await call({ action: 'test', connectionString, entity });
            this.log(`Connection OK — ${result.detail}`, 'ok');
            toast('Connection OK');
        } catch (err) {
            this.log(`Connection failed: ${err.message}`, 'err');
            toast('Connection failed', 'err');
        } finally {
            button.disabled = false;
            button.textContent = 'Test connection';
        }
    }

    async send() {
        const button = document.getElementById('sbSend');
        try {
            const { connectionString, entity } = this.readConnection();
            const body = this.envManager.replaceVariables(document.getElementById('sbBody').value);
            if (!body.trim()) throw new Error('The message body is empty');

            const propertiesText = document.getElementById('sbProperties').value.trim();
            let properties = {};
            if (propertiesText) {
                try {
                    properties = JSON.parse(this.envManager.replaceVariables(propertiesText));
                } catch (err) {
                    throw new Error(`Custom properties are not valid JSON: ${err.message}`);
                }
                if (properties === null || typeof properties !== 'object' || Array.isArray(properties)) {
                    throw new Error('Custom properties must be a JSON object');
                }
            }

            const ttl = Number(document.getElementById('sbTtl').value);
            const brokerProperties = {
                MessageId: document.getElementById('sbMessageId').value.trim() || undefined,
                SessionId: document.getElementById('sbSessionId').value.trim() || undefined,
                CorrelationId: document.getElementById('sbCorrelationId').value.trim() || undefined,
                Label: document.getElementById('sbSubject').value.trim() || undefined,
                TimeToLive: Number.isFinite(ttl) && ttl > 0 ? ttl : undefined,
            };

            const contentType = document.getElementById('sbContentType').value.trim() || 'application/json';
            const repeat = Math.max(1, Math.min(100, Number(document.getElementById('sbRepeat').value) || 1));

            button.disabled = true;
            for (let i = 0; i < repeat; i++) {
                const perMessage = { ...brokerProperties };
                // Let Azure assign distinct ids when repeating.
                if (repeat > 1 && perMessage.MessageId) perMessage.MessageId = `${perMessage.MessageId}-${i + 1}`;

                button.textContent = repeat > 1 ? `Sending ${i + 1} of ${repeat}…` : 'Sending…';
                // eslint-disable-next-line no-await-in-loop
                const result = await call({
                    action: 'send',
                    connectionString,
                    entity,
                    body,
                    contentType,
                    brokerProperties: perMessage,
                    properties,
                });
                this.sent++;
                this.log(`Sent ${result.bytesSent} bytes to ${result.namespace}/${result.entity}`, 'ok');
            }
            toast(repeat > 1 ? `Sent ${repeat} messages` : 'Message sent');
        } catch (err) {
            this.log(`Send failed: ${err.message}`, 'err');
            toast('Send failed', 'err');
        } finally {
            button.disabled = false;
            button.textContent = 'Send message';
        }
    }

    saveConnection() {
        const connectionString = document.getElementById('sbConnectionString').value.trim();
        const queueName = document.getElementById('sbEntity').value.trim();
        const label = document.getElementById('sbLabel').value.trim();

        if (!connectionString || !queueName) {
            toast('Enter a connection string and entity first', 'err');
            return;
        }

        const config = { label, connectionString, queueName };
        this.storage.saveConfig('servicebus-sender', config);
        this.storage.saveToHistory('servicebus-sender', config);
        this.log('Connection saved to this browser\'s local storage.', 'ok');
        toast('Connection saved');
    }

    forget() {
        this.storage.clearConfig('servicebus-sender');
        this.storage.clearHistory('servicebus-sender');
        this.log('Saved connections cleared from local storage.', 'ok');
        toast('Saved connections cleared');
    }
}
