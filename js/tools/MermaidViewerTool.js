import { BaseTool } from '../core/BaseTool.js';

export class MermaidViewerTool extends BaseTool {
  render() {
    return `
      <div class="tool-interface">
        <h2>${this.icon} ${this.name}</h2>
        <p style="color: var(--text-secondary); margin-bottom: 1.5rem;">
          Create and visualize Mermaid diagrams with live preview
        </p>

        <!-- Diagram Type Selection -->
        <div class="tool-section">
          <label>Quick Start Templates</label>
          <div style="display: flex; gap: 0.5rem; flex-wrap: wrap;">
            <button class="template-btn" data-template="flowchart">📊 Flowchart</button>
            <button class="template-btn" data-template="sequence">🔄 Sequence</button>
            <button class="template-btn" data-template="gantt">📅 Gantt</button>
            <button class="template-btn" data-template="class">🏛️ Class</button>
            <button class="template-btn" data-template="state">🔀 State</button>
            <button class="template-btn" data-template="pie">🥧 Pie Chart</button>
          </div>
        </div>

        <!-- Mermaid Code Input -->
        <div class="tool-section">
          <label for="mermaidInput">Mermaid Code</label>
          <textarea 
            id="mermaidInput" 
            rows="12" 
            placeholder="Enter Mermaid diagram code here...

Example:
graph TD
    A[Start] --> B{Is it working?}
    B -->|Yes| C[Great!]
    B -->|No| D[Debug it]
    D --> A"
            style="font-family: 'Courier New', monospace; font-size: 0.9rem;"
          ></textarea>
        </div>

        <!-- Action Buttons -->
        <div class="tool-section">
          <div style="display: flex; gap: 0.75rem; flex-wrap: wrap;">
            <button class="action-btn" id="renderBtn">
              🎨 Render Diagram
            </button>
            <button class="action-btn" id="exportPngBtn" style="background: var(--bg-secondary);">
              📥 Export PNG
            </button>
            <button class="action-btn" id="exportSvgBtn" style="background: var(--bg-secondary);">
              📥 Export SVG
            </button>
            <button class="action-btn secondary" id="copyCodeBtn">Copy code</button>
            <button class="action-btn secondary" id="copySvgBtn">Copy SVG</button>
            <button class="action-btn" id="clearBtn" style="background: #ef4444;">
              🗑️ Clear
            </button>
          </div>
        </div>

        <!-- Preview Section -->
        <div class="tool-section">
          <h3>Preview</h3>
          <div class="output-section" id="diagramOutput" style="padding: 2rem; background: white; border-radius: 8px; min-height: 300px; display: flex; align-items: center; justify-content: center;">
            <p style="color: #999;">Your diagram will appear here...</p>
          </div>
        </div>

        <!-- Error Section -->
        <div class="tool-section" id="errorSection" style="display: none;">
          <div id="errorMessage" style="padding: 1rem; border-radius: 8px; background: #ef444420; border: 1px solid #ef4444; color: #ef4444;"></div>
        </div>

        <!-- Info Section -->
        <div class="tool-section">
          <details style="background: var(--bg-secondary); padding: 1rem; border-radius: 8px;">
            <summary style="cursor: pointer; font-weight: 600; margin-bottom: 0.5rem;">📖 Mermaid Syntax Guide</summary>
            <div style="color: var(--text-secondary); font-size: 0.9rem; margin-top: 1rem; line-height: 1.8;">
              <p><strong>Flowchart:</strong> <code>graph TD; A-->B</code></p>
              <p><strong>Sequence:</strong> <code>sequenceDiagram; Alice->>Bob: Hello</code></p>
              <p><strong>Gantt:</strong> <code>gantt; section Tasks; Task1: a1, 2024-01-01, 3d</code></p>
              <p><strong>Class:</strong> <code>classDiagram; class Animal { +name }</code></p>
              <p><strong>State:</strong> <code>stateDiagram-v2; [*] --> Active</code></p>
              <p><strong>Pie:</strong> <code>pie title Pets; "Dogs" : 45; "Cats" : 30</code></p>
              <p style="margin-top: 1rem;">
                <a href="https://mermaid.js.org/intro/" target="_blank" style="color: #3b82f6; text-decoration: none;">
                  📚 Full Documentation →
                </a>
              </p>
            </div>
          </details>
        </div>
      </div>
    `;
  }

  onOpen() {
    this.loadMermaidLibrary();
    
    setTimeout(() => {
      const renderBtn = document.getElementById('renderBtn');
      const exportPngBtn = document.getElementById('exportPngBtn');
      const exportSvgBtn = document.getElementById('exportSvgBtn');
      const clearBtn = document.getElementById('clearBtn');
      const templateBtns = document.querySelectorAll('.template-btn');

      renderBtn?.addEventListener('click', () => this.renderDiagram());
      exportPngBtn?.addEventListener('click', () => this.exportDiagram('png'));
      exportSvgBtn?.addEventListener('click', () => this.exportDiagram('svg'));
      clearBtn?.addEventListener('click', () => this.clearAll());

      document.getElementById('copyCodeBtn')?.addEventListener('click', async () => {
        const { copyText, toast } = await import('../ui/toast.js');
        const code = document.getElementById('mermaidInput')?.value || '';
        if (code.trim()) copyText(code, 'Diagram source copied');
        else toast('Nothing to copy', 'err');
      });

      document.getElementById('copySvgBtn')?.addEventListener('click', async () => {
        const { copyText, toast } = await import('../ui/toast.js');
        const svg = document.querySelector('#diagramOutput svg');
        if (svg) copyText(svg.outerHTML, 'SVG copied');
        else toast('Render the diagram first', 'err');
      });

      templateBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
          const template = e.target.dataset.template;
          this.loadTemplate(template);
        });
      });
      // .template-btn is styled in styles.css -- it used to be injected here on
      // every open, which appended a duplicate <style> each time the tool ran.
    }, 0);
  }

  loadMermaidLibrary() {
    // Check if Mermaid is already loaded
    if (window.mermaid) {
      window.mermaid.initialize({ 
        startOnLoad: false,
        theme: 'default',
        // 'strict' escapes HTML in node labels. 'loose' would let a pasted
        // diagram inject markup into this page.
        securityLevel: 'strict'
      });
      return;
    }

    // Load Mermaid from CDN
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js';
    script.onload = () => {
      window.mermaid.initialize({ 
        startOnLoad: false,
        theme: 'default',
        // 'strict' escapes HTML in node labels. 'loose' would let a pasted
        // diagram inject markup into this page.
        securityLevel: 'strict'
      });
      this.showInfo('Mermaid library loaded successfully!');
    };
    script.onerror = () => {
      this.showError('Failed to load Mermaid library. Please check your internet connection.');
    };
    document.head.appendChild(script);
  }

  async renderDiagram() {
    const input = document.getElementById('mermaidInput');
    const output = document.getElementById('diagramOutput');
    const errorSection = document.getElementById('errorSection');
    
    if (!input || !output) return;

    const diagramCode = input.value.trim();
    if (!diagramCode) {
      this.showError('Please enter Mermaid diagram code.');
      return;
    }

    if (!window.mermaid) {
      this.showError('Mermaid library is still loading. Please wait a moment and try again.');
      return;
    }

    try {
      // Hide error
      errorSection.style.display = 'none';

      // Clear previous diagram
      output.innerHTML = '<p style="color: #999;">Rendering diagram...</p>';

      // Generate unique ID
      const id = 'mermaid-' + Date.now();
      
      // Render diagram
      const { svg } = await window.mermaid.render(id, diagramCode);
      
      // Display rendered SVG
      output.innerHTML = svg;
      
      // Store current SVG for export
      this.currentSvg = svg;
      this.currentCode = diagramCode;

      this.showInfo('Diagram rendered successfully!');
    } catch (error) {
      this.showError(`Rendering error: ${error.message || 'Invalid Mermaid syntax'}`);
      output.innerHTML = '<p style="color: #ef4444;">⚠️ Failed to render diagram. Check syntax and try again.</p>';
    }
  }

  exportDiagram(format) {
    if (!this.currentSvg) {
      this.showError('Please render a diagram first before exporting.');
      return;
    }

    try {
      if (format === 'svg') {
        // Export as SVG
        const blob = new Blob([this.currentSvg], { type: 'image/svg+xml' });
        this.downloadFile(blob, `mermaid-diagram-${Date.now()}.svg`);
        this.showInfo('SVG exported successfully!');
      } else if (format === 'png') {
        // Export as PNG
        this.convertSvgToPng(this.currentSvg);
      }
    } catch (error) {
      this.showError(`Export error: ${error.message}`);
    }
  }

  convertSvgToPng(svgString) {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const img = new Image();

    // Parse SVG to get dimensions
    const parser = new DOMParser();
    const svgDoc = parser.parseFromString(svgString, 'image/svg+xml');
    const svgElement = svgDoc.querySelector('svg');
    
    const width = svgElement.getAttribute('width') || svgElement.viewBox.baseVal.width || 800;
    const height = svgElement.getAttribute('height') || svgElement.viewBox.baseVal.height || 600;

    canvas.width = parseInt(width) * 2; // 2x for better quality
    canvas.height = parseInt(height) * 2;
    ctx.scale(2, 2);

    const blob = new Blob([svgString], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);

    img.onload = () => {
      // Fill white background
      ctx.fillStyle = 'white';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      
      // Draw SVG
      ctx.drawImage(img, 0, 0);
      
      // Convert to PNG
      canvas.toBlob((blob) => {
        this.downloadFile(blob, `mermaid-diagram-${Date.now()}.png`);
        this.showInfo('PNG exported successfully!');
        URL.revokeObjectURL(url);
      }, 'image/png');
    };

    img.onerror = () => {
      this.showError('Failed to convert diagram to PNG. Try exporting as SVG instead.');
      URL.revokeObjectURL(url);
    };

    img.src = url;
  }

  downloadFile(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  loadTemplate(type) {
    const templates = {
      flowchart: `graph TD
    A[Start] --> B{Decision}
    B -->|Yes| C[Option 1]
    B -->|No| D[Option 2]
    C --> E[End]
    D --> E`,
      
      sequence: `sequenceDiagram
    participant Alice
    participant Bob
    Alice->>Bob: Hello Bob!
    Bob->>Alice: Hi Alice!
    Alice->>Bob: How are you?
    Bob->>Alice: I'm good, thanks!`,
      
      gantt: `gantt
    title Project Schedule
    dateFormat YYYY-MM-DD
    section Phase 1
    Task 1: a1, 2024-01-01, 7d
    Task 2: a2, after a1, 5d
    section Phase 2
    Task 3: a3, 2024-01-15, 10d`,
      
      class: `classDiagram
    class Animal {
        +String name
        +int age
        +makeSound()
    }
    class Dog {
        +String breed
        +bark()
    }
    Animal <|-- Dog`,
      
      state: `stateDiagram-v2
    [*] --> Idle
    Idle --> Processing: Start
    Processing --> Success: Complete
    Processing --> Failed: Error
    Success --> [*]
    Failed --> Idle: Retry`,
      
      pie: `pie title Favorite Pets
    "Dogs" : 45
    "Cats" : 30
    "Birds" : 15
    "Fish" : 10`
    };

    const input = document.getElementById('mermaidInput');
    if (input && templates[type]) {
      input.value = templates[type];
      this.showInfo(`${type.charAt(0).toUpperCase() + type.slice(1)} template loaded!`);
    }
  }

  clearAll() {
    const input = document.getElementById('mermaidInput');
    const output = document.getElementById('diagramOutput');
    const errorSection = document.getElementById('errorSection');
    
    if (input) input.value = '';
    if (output) output.innerHTML = '<p style="color: #999;">Your diagram will appear here...</p>';
    if (errorSection) errorSection.style.display = 'none';
    
    this.currentSvg = null;
    this.currentCode = null;
  }

  showError(message) {
    const errorSection = document.getElementById('errorSection');
    const errorMessage = document.getElementById('errorMessage');
    
    if (errorMessage && errorSection) {
      errorMessage.textContent = message;
      errorSection.style.display = 'block';
    }
  }

  showInfo(message) {
    const errorSection = document.getElementById('errorSection');
    const errorMessage = document.getElementById('errorMessage');
    
    if (errorMessage && errorSection) {
      errorMessage.textContent = message;
      errorMessage.style = 'padding: 1rem; border-radius: 8px; background: #10b98120; border: 1px solid #10b981; color: #10b981;';
      errorSection.style.display = 'block';
      
      setTimeout(() => {
        errorSection.style.display = 'none';
      }, 3000);
    }
  }
}
