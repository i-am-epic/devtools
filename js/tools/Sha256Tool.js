import { BaseTool } from '../core/BaseTool.js';

export class Sha256Tool extends BaseTool {
    render() {
        return `
            <div class="tool-interface">
                <h2>${this.icon} ${this.name}</h2>
                
                <div class="tool-section">
                    <h3>Input Text</h3>
                    <textarea id="sha256Input" placeholder="Enter text to hash..."></textarea>
                </div>

                <div class="tool-section">
                    <button class="action-btn" id="hashBtn">Generate Hash</button>
                    <button class="action-btn secondary" id="copyShaBtn">Copy Hash</button>
                    <button class="action-btn secondary" id="clearShaBtn">Clear</button>
                </div>

                <div class="tool-section">
                    <h3>SHA256 Hash</h3>
                    <div class="output-section" id="sha256Output">
                        <pre>Hash will appear here...</pre>
                    </div>
                </div>
            </div>
        `;
    }

    onOpen() {
        setTimeout(() => {
            document.getElementById('hashBtn')?.addEventListener('click', () => this.generateHash());
            document.getElementById('copyShaBtn')?.addEventListener('click', () => this.copy());
            document.getElementById('clearShaBtn')?.addEventListener('click', () => this.clear());
        }, 0);
    }

    async generateHash() {
        const input = document.getElementById('sha256Input').value;
        const output = document.getElementById('sha256Output');

        if (!input) {
            output.innerHTML = '<pre style="color: #ff6b6b;">Please enter text to hash</pre>';
            return;
        }

        try {
            const encoder = new TextEncoder();
            const data = encoder.encode(input);
            const hashBuffer = await crypto.subtle.digest('SHA-256', data);
            const hashArray = Array.from(new Uint8Array(hashBuffer));
            const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
            
            output.innerHTML = `<pre>${hashHex}</pre>`;
        } catch (error) {
            output.innerHTML = `<pre style="color: #ff6b6b;">Error: ${error.message}</pre>`;
        }
    }

    copy() {
        const output = document.getElementById('sha256Output');
        const text = output.textContent.trim();
        
        if (text && text !== 'Hash will appear here...') {
            navigator.clipboard.writeText(text).then(() => {
                const btn = document.getElementById('copyShaBtn');
                const originalText = btn.textContent;
                btn.textContent = 'Copied!';
                setTimeout(() => btn.textContent = originalText, 2000);
            });
        }
    }

    clear() {
        document.getElementById('sha256Input').value = '';
        document.getElementById('sha256Output').innerHTML = '<pre>Hash will appear here...</pre>';
    }
}
