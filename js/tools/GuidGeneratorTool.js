import { BaseTool } from '../core/BaseTool.js';

export class GuidGeneratorTool extends BaseTool {
    render() {
        return `
            <div class="tool-interface">
                <h2>${this.icon} ${this.name}</h2>
                
                <div class="tool-section">
                    <h3>Generate UUID/GUID</h3>
                    <button class="action-btn" id="generateGuidBtn">Generate</button>
                    <button class="action-btn" id="generateMultipleBtn">Generate 10</button>
                    <button class="action-btn secondary" id="copyGuidBtn">Copy</button>
                </div>

                <div class="tool-section">
                    <h3>Generated IDs</h3>
                    <div class="output-section" id="guidOutput">
                        <pre>Click Generate to create GUIDs...</pre>
                    </div>
                </div>
            </div>
        `;
    }

    onOpen() {
        setTimeout(() => {
            document.getElementById('generateGuidBtn')?.addEventListener('click', () => this.generateOne());
            document.getElementById('generateMultipleBtn')?.addEventListener('click', () => this.generateMultiple());
            document.getElementById('copyGuidBtn')?.addEventListener('click', () => this.copy());
        }, 0);
    }

    generateUUID() {
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
            const r = Math.random() * 16 | 0;
            const v = c === 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
    }

    generateOne() {
        const guid = this.generateUUID();
        const output = document.getElementById('guidOutput');
        output.innerHTML = `<pre>${guid}</pre>`;
    }

    generateMultiple() {
        const guids = Array.from({ length: 10 }, () => this.generateUUID());
        const output = document.getElementById('guidOutput');
        output.innerHTML = `<pre>${guids.join('\n')}</pre>`;
    }

    copy() {
        const output = document.getElementById('guidOutput');
        const text = output.textContent;
        
        navigator.clipboard.writeText(text).then(() => {
            const btn = document.getElementById('copyGuidBtn');
            const originalText = btn.textContent;
            btn.textContent = 'Copied!';
            setTimeout(() => btn.textContent = originalText, 2000);
        });
    }
}
