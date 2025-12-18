import { BaseTool } from '../core/BaseTool.js';

export class DiffCheckerTool extends BaseTool {
    render() {
        return `
            <div class="tool-interface">
                <h2>${this.icon} ${this.name}</h2>
                
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem;">
                    <div class="tool-section">
                        <h3>Text 1</h3>
                        <textarea id="diffText1" placeholder="Enter first text..."></textarea>
                    </div>

                    <div class="tool-section">
                        <h3>Text 2</h3>
                        <textarea id="diffText2" placeholder="Enter second text..."></textarea>
                    </div>
                </div>

                <div class="tool-section">
                    <button class="action-btn" id="compareBtn">Compare</button>
                    <button class="action-btn secondary" id="clearDiffBtn">Clear</button>
                </div>

                <div class="tool-section">
                    <h3>Differences</h3>
                    <div class="output-section" id="diffOutput">
                        <pre>Comparison result will appear here...</pre>
                    </div>
                </div>
            </div>
        `;
    }

    onOpen() {
        setTimeout(() => {
            document.getElementById('compareBtn')?.addEventListener('click', () => this.compare());
            document.getElementById('clearDiffBtn')?.addEventListener('click', () => this.clear());
        }, 0);
    }

    compare() {
        const text1 = document.getElementById('diffText1').value;
        const text2 = document.getElementById('diffText2').value;
        const output = document.getElementById('diffOutput');

        if (!text1 || !text2) {
            output.innerHTML = '<pre style="color: #ff6b6b;">Please enter both texts to compare</pre>';
            return;
        }

        const lines1 = text1.split('\n');
        const lines2 = text2.split('\n');
        
        let result = '';
        const maxLines = Math.max(lines1.length, lines2.length);

        for (let i = 0; i < maxLines; i++) {
            const line1 = lines1[i] || '';
            const line2 = lines2[i] || '';

            if (line1 === line2) {
                result += `  ${line1}\n`;
            } else {
                if (line1) result += `- ${line1}\n`;
                if (line2) result += `+ ${line2}\n`;
            }
        }

        const identical = text1 === text2;
        const stats = `Lines in Text 1: ${lines1.length}\nLines in Text 2: ${lines2.length}\nStatus: ${identical ? '✓ Identical' : '✗ Different'}\n\n`;

        output.innerHTML = `<pre>${this.escapeHtml(stats + result)}</pre>`;
    }

    clear() {
        document.getElementById('diffText1').value = '';
        document.getElementById('diffText2').value = '';
        document.getElementById('diffOutput').innerHTML = '<pre>Comparison result will appear here...</pre>';
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}
