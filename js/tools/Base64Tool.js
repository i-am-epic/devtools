import { BaseTool } from '../core/BaseTool.js';

export class Base64Tool extends BaseTool {
    render() {
        return `
            <div class="tool-interface">
                <h2>${this.icon} ${this.name}</h2>
                
                <div class="tool-section">
                    <h3>Input</h3>
                    <textarea id="base64Input" placeholder="Enter text to encode/decode..."></textarea>
                </div>

                <div class="tool-section">
                    <button class="action-btn" id="encodeBtn">Encode</button>
                    <button class="action-btn" id="decodeBtn">Decode</button>
                    <button class="action-btn secondary" id="copyBase64Btn">Copy</button>
                    <button class="action-btn secondary" id="clearBase64Btn">Clear</button>
                </div>

                <div class="tool-section">
                    <h3>Output</h3>
                    <div class="output-section" id="base64Output">
                        <pre>Result will appear here...</pre>
                    </div>
                </div>
            </div>
        `;
    }

    onOpen() {
        setTimeout(() => {
            document.getElementById('encodeBtn')?.addEventListener('click', () => this.encode());
            document.getElementById('decodeBtn')?.addEventListener('click', () => this.decode());
            document.getElementById('copyBase64Btn')?.addEventListener('click', () => this.copy());
            document.getElementById('clearBase64Btn')?.addEventListener('click', () => this.clear());
        }, 0);
    }

    encode() {
        const input = document.getElementById('base64Input').value;
        const output = document.getElementById('base64Output');

        if (!input) {
            output.innerHTML = '<pre style="color: #ff6b6b;">Please enter text to encode</pre>';
            return;
        }

        try {
            const encoded = btoa(unescape(encodeURIComponent(input)));
            output.innerHTML = `<pre>${this.escapeHtml(encoded)}</pre>`;
        } catch (error) {
            output.innerHTML = `<pre style="color: #ff6b6b;">Error: ${error.message}</pre>`;
        }
    }

    decode() {
        const input = document.getElementById('base64Input').value;
        const output = document.getElementById('base64Output');

        if (!input) {
            output.innerHTML = '<pre style="color: #ff6b6b;">Please enter text to decode</pre>';
            return;
        }

        try {
            const decoded = decodeURIComponent(escape(atob(input)));
            output.innerHTML = `<pre>${this.escapeHtml(decoded)}</pre>`;
        } catch (error) {
            output.innerHTML = `<pre style="color: #ff6b6b;">Error: Invalid Base64 string</pre>`;
        }
    }

    copy() {
        const output = document.getElementById('base64Output');
        const text = output.textContent.trim();
        
        if (text && text !== 'Result will appear here...') {
            navigator.clipboard.writeText(text).then(() => {
                const btn = document.getElementById('copyBase64Btn');
                const originalText = btn.textContent;
                btn.textContent = 'Copied!';
                setTimeout(() => btn.textContent = originalText, 2000);
            });
        }
    }

    clear() {
        document.getElementById('base64Input').value = '';
        document.getElementById('base64Output').innerHTML = '<pre>Result will appear here...</pre>';
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}
