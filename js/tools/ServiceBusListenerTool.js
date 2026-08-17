// Consume messages from an Azure Service Bus queue or subscription.
//
// Uses the REST peek-lock flow: receive locks a message and returns a lock URI,
// then you complete it (removes it) or abandon it (returns it to the queue).
// Receive-and-delete mode skips the lock entirely.

import { BaseTool } from '../core/BaseTool.js';
import { StorageManager } from '../utils/StorageManager.js';
import { EnvironmentManager } from '../core/EnvironmentManager.js';
import { call, checkProxy, inspectConnectionString, relayBanner } from '../lib/servicebus.js';
import { toast, copyText, downloadText } from '../ui/toast.js';

const escapeHtml = (value) => String(value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/** Pretty-print a body when it happens to be JSON. */
function formatBody(text) {
    const trimmed = (text || '').trim();
    if (!trimmed) return '(empty body)';
    if (/^[[{]/.test(trimmed)) {
        try {
            return JSON.stringify(JSON.parse(trimmed), null, 2);
        } catch {
            return text;
        }
    }
    return text;
}

export class ServiceBusListenerTool extends BaseTool {
    constructor(config) {
        super(config);
        this.storage = new StorageManager();
        this.envManager = new EnvironmentManager();
        this.messages = [];
        this.running = false;
        this.emptyPolls = 0;
    }

    render() {
        const saved = this.storage.loadConfig('servicebus-listener') || {};
        const history = this.storage.loadHistory('servicebus-listener') || [];

        return `
            <div class="tool-interface" data-cat="cloud">
                <h2><span class="tool-icon">${this.icon}</span>${escapeHtml(this.name)}</h2>
                <p class="tool-lede">
                    Read messages from a queue or a topic subscription. Peek-lock mode leaves each message on the
                    entity until you explicitly complete it, so you can inspect traffic without consuming it.
                </p>

                <div id="sbRelayStatus"></div>

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
                            placeholder="Endpoint=sb://your-namespace.servicebus.windows.net/;SharedAccessKeyName=Listen;SharedAccessKey=…">${escapeHtml(saved.connectionString || '')}</textarea>
                        <div class="helper-text" id="sbConnInfo"></div>
                    </div>

                    <div class="field-group">
                        <div>
                            <label for="sbEntity">Queue, or topic/subscriptions/name</label>
                            <input type="text" id="sbEntity" value="${escapeHtml(saved.queueName || '')}"
                                   placeholder="orders  ·  events/subscriptions/audit">
                        </div>
                        <div>
                            <label for="sbMode">Receive mode</label>
                            <select id="sbMode">
                                <option value="peek-lock">Peek-lock — inspect, then settle</option>
                                <option value="receive-delete">Receive and delete — destructive</option>
                            </select>
                        </div>
                        <div>
                            <label for="sbWait">Long-poll wait (seconds)</label>
                            <input type="number" id="sbWait" value="5" min="0" max="55">
                        </div>
                        <div>
                            <label for="sbLabel">Save as (optional)</label>
                            <input type="text" id="sbLabel" value="${escapeHtml(saved.label || '')}" placeholder="Prod orders">
                        </div>
                    </div>

                    <div class="btn-row">
                        <button class="action-btn secondary" id="sbTest">Test connection</button>
                        <button class="action-btn secondary" id="sbSave">Save connection</button>
                    </div>
                </div>

                <div class="tool-section">
                    <div class="btn-row">
                        <button class="action-btn" id="sbReceiveOne">Receive one</button>
                        <button class="action-btn" id="sbStart">Start listening</button>
                        <button class="action-btn danger" id="sbStop" disabled>Stop</button>
                        <button class="action-btn secondary" id="sbCompleteAll">Complete all shown</button>
                        <button class="action-btn secondary" id="sbExport">Export JSON</button>
                        <button class="action-btn secondary" id="sbClearLog">Clear</button>
                    </div>
                    <div class="helper-text" id="sbRunState">Idle.</div>
                </div>

                <div class="tool-section">
                    <h3>Messages (<span id="sbCount">0</span>)</h3>
                    <div id="sbMessages">
                        <div class="info-box">No messages yet. Press <strong>Receive one</strong> to pull a single
                        message, or <strong>Start listening</strong> to poll continuously.</div>
                    </div>
                </div>
            </div>
        `;
    }

    onOpen() {
        setTimeout(async () => {
            const status = document.getElementById('sbRelayStatus');
            const available = await checkProxy(true);
            if (status) status.innerHTML = relayBanner(available);

            document.getElementById('sbReceiveOne')?.addEventListener('click', () => this.receiveOnce(true));
            document.getElementById('sbStart')?.addEventListener('click', () => this.startLoop());
            document.getElementById('sbStop')?.addEventListener('click', () => this.stopLoop());
            document.getElementById('sbCompleteAll')?.addEventListener('click', () => this.completeAll());
            document.getElementById('sbExport')?.addEventListener('click', () => this.exportMessages());
            document.getElementById('sbClearLog')?.addEventListener('click', () => {
                this.messages = [];
                this.renderMessages();
            });
            document.getElementById('sbTest')?.addEventListener('click', () => this.test());
            document.getElementById('sbSave')?.addEventListener('click', () => this.saveConnection());

            document.getElementById('sbConnectionString')?.addEventListener('input', () => this.describeConnection());
            this.describeConnection();

            document.getElementById('sbHistory')?.addEventListener('change', (event) => {
                if (event.target.value === '') return;
                const history = this.storage.loadHistory('servicebus-listener') || [];
                const entry = history[Number(event.target.value)];
                if (!entry) return;
                document.getElementById('sbConnectionString').value = entry.connectionString || '';
                document.getElementById('sbEntity').value = entry.queueName || '';
                document.getElementById('sbLabel').value = entry.label || '';
                this.describeConnection();
            });
        }, 0);
    }

    onClose() {
        this.stopLoop();
    }

    describeConnection() {
        const node = document.getElementById('sbConnInfo');
        const raw = document.getElementById('sbConnectionString')?.value || '';
        if (!node) return;
        if (!raw.trim()) { node.textContent = ''; return; }

        const info = inspectConnectionString(this.envManager.replaceVariables(raw));
        node.innerHTML = info.valid
            ? `<span style="color:var(--green)">✓ namespace <strong>${escapeHtml(info.namespace)}</strong> · policy <strong>${escapeHtml(info.keyName)}</strong></span>`
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
        if (!entity && !info.entityPath) throw new Error('Enter a queue name, or topic/subscriptions/name');

        return {
            connectionString,
            entity: entity || info.entityPath,
            mode: document.getElementById('sbMode')?.value || 'peek-lock',
            waitSeconds: Number(document.getElementById('sbWait')?.value) || 5,
        };
    }

    setRunState(text) {
        const node = document.getElementById('sbRunState');
        if (node) node.textContent = text;
    }

    async test() {
        const button = document.getElementById('sbTest');
        try {
            const { connectionString, entity } = this.readConnection();
            button.disabled = true;
            button.textContent = 'Testing…';
            const result = await call({ action: 'test', connectionString, entity });
            this.setRunState(`Connection OK — ${result.detail}`);
            toast('Connection OK');
        } catch (err) {
            this.setRunState(`Connection failed: ${err.message}`);
            toast('Connection failed', 'err');
        } finally {
            button.disabled = false;
            button.textContent = 'Test connection';
        }
    }

    async receiveOnce(announceEmpty) {
        const options = this.readConnection();
        const result = await call({
            action: 'receive',
            connectionString: options.connectionString,
            entity: options.entity,
            mode: options.mode,
            waitSeconds: options.waitSeconds,
        });

        if (result.empty) {
            this.emptyPolls++;
            this.setRunState(this.running
                ? `Listening — no messages in the last ${this.emptyPolls} poll${this.emptyPolls === 1 ? '' : 's'}.`
                : 'The entity is empty.');
            if (announceEmpty && !this.running) toast('No messages waiting');
            return false;
        }

        this.emptyPolls = 0;
        this.messages.unshift({
            ...result.message,
            entity: options.entity,
            connectionString: options.connectionString,
            settled: options.mode === 'receive-delete' ? 'deleted' : null,
        });
        this.renderMessages();
        this.setRunState(`Received ${this.messages.length} message${this.messages.length === 1 ? '' : 's'} this session.`);
        return true;
    }

    async startLoop() {
        try {
            this.readConnection();
        } catch (err) {
            toast(err.message, 'err');
            this.setRunState(err.message);
            return;
        }

        this.running = true;
        this.emptyPolls = 0;
        document.getElementById('sbStart').disabled = true;
        document.getElementById('sbStop').disabled = false;
        document.getElementById('sbReceiveOne').disabled = true;
        this.setRunState('Listening…');

        while (this.running) {
            try {
                // eslint-disable-next-line no-await-in-loop
                await this.receiveOnce(false);
            } catch (err) {
                this.setRunState(`Stopped: ${err.message}`);
                toast('Listener stopped', 'err');
                this.stopLoop();
                return;
            }
            if (this.messages.length >= 500) {
                this.setRunState('Stopped — 500 messages held in the page. Clear or export them first.');
                this.stopLoop();
                return;
            }
        }
    }

    stopLoop() {
        this.running = false;
        const start = document.getElementById('sbStart');
        const stop = document.getElementById('sbStop');
        const one = document.getElementById('sbReceiveOne');
        if (start) start.disabled = false;
        if (stop) stop.disabled = true;
        if (one) one.disabled = false;
        if (start) this.setRunState('Idle.');
    }

    async settle(index, action) {
        const message = this.messages[index];
        if (!message || !message.lockLocation) {
            toast('This message has no lock to settle', 'err');
            return;
        }

        try {
            await call({
                action,
                connectionString: message.connectionString,
                lockLocation: message.lockLocation,
            });
            message.settled = action === 'complete' ? 'completed'
                : action === 'abandon' ? 'abandoned' : 'renewed';
            if (action !== 'renew') message.lockLocation = action === 'complete' ? '' : message.lockLocation;
            this.renderMessages();
            toast(`Message ${message.settled}`);
        } catch (err) {
            toast(err.message, 'err');
            this.setRunState(err.message);
        }
    }

    async completeAll() {
        const pending = this.messages.filter((m) => m.lockLocation && !m.settled);
        if (!pending.length) {
            toast('Nothing to complete', 'err');
            return;
        }
        let done = 0;
        for (const message of pending) {
            try {
                // eslint-disable-next-line no-await-in-loop
                await call({
                    action: 'complete',
                    connectionString: message.connectionString,
                    lockLocation: message.lockLocation,
                });
                message.settled = 'completed';
                message.lockLocation = '';
                done++;
            } catch {
                message.settled = 'lock expired';
            }
        }
        this.renderMessages();
        toast(`Completed ${done} of ${pending.length}`);
    }

    exportMessages() {
        if (!this.messages.length) {
            toast('No messages to export', 'err');
            return;
        }
        const payload = this.messages.map(({ connectionString, lockLocation, ...rest }) => rest);
        downloadText(JSON.stringify(payload, null, 2), 'servicebus-messages.json', 'application/json');
        toast(`Exported ${payload.length} messages`);
    }

    renderMessages() {
        const container = document.getElementById('sbMessages');
        const count = document.getElementById('sbCount');
        if (!container) return;

        if (count) count.textContent = this.messages.length;

        if (!this.messages.length) {
            container.innerHTML = '<div class="info-box">No messages held. Press <strong>Receive one</strong> or <strong>Start listening</strong>.</div>';
            return;
        }

        container.innerHTML = this.messages.map((message, index) => {
            const broker = message.brokerProperties || {};
            const properties = message.properties || {};
            const settledColour = message.settled === 'completed' ? 'var(--green)'
                : message.settled === 'abandoned' ? '#c9a800'
                : message.settled === 'deleted' ? 'var(--ink-3)'
                : 'var(--blue)';

            return `
                <div class="message-card" style="border-left-color:${settledColour}">
                    <div class="msg-head">
                        <span>#${this.messages.length - index} · ${escapeHtml(broker.MessageId || '(no message id)')}</span>
                        <span>${escapeHtml(message.receivedAt || '')}</span>
                    </div>

                    <div class="btn-row" style="margin-bottom:0.6rem;">
                        <span class="chip">${escapeHtml(String(message.size))} bytes</span>
                        ${broker.SequenceNumber !== undefined ? `<span class="chip">seq ${escapeHtml(String(broker.SequenceNumber))}</span>` : ''}
                        ${broker.DeliveryCount !== undefined ? `<span class="chip">delivery ${escapeHtml(String(broker.DeliveryCount))}</span>` : ''}
                        ${message.contentType ? `<span class="chip">${escapeHtml(message.contentType)}</span>` : ''}
                        ${message.settled ? `<span class="chip on" style="background:${settledColour};border-color:${settledColour}">${escapeHtml(message.settled)}</span>` : '<span class="chip on">locked</span>'}
                    </div>

                    <details ${index === 0 ? 'open' : ''}>
                        <summary>Body</summary>
                        <pre style="max-height:260px;overflow:auto">${escapeHtml(formatBody(message.body))}</pre>
                    </details>

                    ${Object.keys(properties).length ? `
                        <details style="margin-top:0.5rem;">
                            <summary>Application properties (${Object.keys(properties).length})</summary>
                            <pre>${escapeHtml(JSON.stringify(properties, null, 2))}</pre>
                        </details>` : ''}

                    <details style="margin-top:0.5rem;">
                        <summary>Broker properties</summary>
                        <pre>${escapeHtml(JSON.stringify(broker, null, 2))}</pre>
                    </details>

                    <div class="btn-row" style="margin-top:0.75rem;">
                        <button class="mini-btn" data-copy="${index}">Copy body</button>
                        ${message.lockLocation && !message.settled ? `
                            <button class="mini-btn" data-settle="complete" data-index="${index}">Complete</button>
                            <button class="mini-btn" data-settle="abandon" data-index="${index}">Abandon</button>
                            <button class="mini-btn" data-settle="renew" data-index="${index}">Renew lock</button>
                        ` : ''}
                    </div>
                </div>`;
        }).join('');

        container.querySelectorAll('[data-copy]').forEach((button) => {
            button.addEventListener('click', () => {
                copyText(this.messages[Number(button.dataset.copy)].body, 'Body copied');
            });
        });

        container.querySelectorAll('[data-settle]').forEach((button) => {
            button.addEventListener('click', () => {
                this.settle(Number(button.dataset.index), button.dataset.settle);
            });
        });
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
        this.storage.saveConfig('servicebus-listener', config);
        this.storage.saveToHistory('servicebus-listener', config);
        toast('Connection saved');
    }
}
