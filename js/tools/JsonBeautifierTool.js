import { BaseTool } from '../core/BaseTool.js';

export class JsonBeautifierTool extends BaseTool {
    render() {
        return `
            <div class="tool-interface">
                <h2>${this.icon} ${this.name}</h2>
                
                <div class="tool-section">
                    <h3>Input JSON</h3>
                    <textarea id="jsonInput" placeholder="Paste your JSON here..."></textarea>
                </div>

                <div class="tool-section">
                    <button class="action-btn" id="beautifyBtn">Beautify</button>
                    <button class="action-btn secondary" id="minifyBtn">Minify</button>
                    <button class="action-btn secondary" id="validateBtn">Validate</button>
                    <button class="action-btn secondary" id="clearJsonBtn">Clear</button>
                </div>

                <div class="tool-section">
                    <h3>Output</h3>
                    <div class="output-section" id="jsonOutput">
                        <pre>Result will appear here...</pre>
                    </div>
                </div>
            </div>
        `;
    }

    onOpen() {
        setTimeout(() => {
            const beautifyBtn = document.getElementById('beautifyBtn');
            const minifyBtn = document.getElementById('minifyBtn');
            const validateBtn = document.getElementById('validateBtn');
            const clearBtn = document.getElementById('clearJsonBtn');

            beautifyBtn?.addEventListener('click', () => this.beautify());
            minifyBtn?.addEventListener('click', () => this.minify());
            validateBtn?.addEventListener('click', () => this.validate());
            clearBtn?.addEventListener('click', () => this.clear());
        }, 0);
    }

    beautify() {
        const input = document.getElementById('jsonInput').value;
        const output = document.getElementById('jsonOutput');

        try {
            const parsed = JSON.parse(input);
            const beautified = JSON.stringify(parsed, null, 2);
            output.innerHTML = `<pre>${this.escapeHtml(beautified)}</pre>`;
        } catch (error) {
            output.innerHTML = `<pre style="color: #ff6b6b;">Error: ${error.message}</pre>`;
        }
    }

    minify() {
        const input = document.getElementById('jsonInput').value;
        const output = document.getElementById('jsonOutput');

        try {
            const parsed = JSON.parse(input);
            const minified = JSON.stringify(parsed);
            output.innerHTML = `<pre>${this.escapeHtml(minified)}</pre>`;
        } catch (error) {
            output.innerHTML = `<pre style="color: #ff6b6b;">Error: ${error.message}</pre>`;
        }
    }

    validate() {
        const input = document.getElementById('jsonInput').value;
        const output = document.getElementById('jsonOutput');

        try {
            JSON.parse(input);
            output.innerHTML = `<pre style="color: #51cf66;">✓ Valid JSON</pre>`;
        } catch (error) {
            output.innerHTML = `<pre style="color: #ff6b6b;">✗ Invalid JSON\n\n${error.message}</pre>`;
        }
    }

    clear() {
        document.getElementById('jsonInput').value = '';
        document.getElementById('jsonOutput').innerHTML = '<pre>Result will appear here...</pre>';
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}
