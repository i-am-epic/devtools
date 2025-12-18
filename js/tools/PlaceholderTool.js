import { BaseTool } from '../core/BaseTool.js';

export class PlaceholderTool extends BaseTool {
    render() {
        return `
            <div class="tool-interface">
                <h2>${this.icon} ${this.name}</h2>
                
                <div class="tool-section">
                    <p style="color: var(--text-secondary); font-size: 1.1rem;">
                        ${this.description}
                    </p>
                    <br>
                    <p style="color: var(--text-secondary);">
                        This tool is coming soon! Check back later.
                    </p>
                </div>
            </div>
        `;
    }
}
