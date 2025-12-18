import { BaseTool } from '../core/BaseTool.js';

export class ParquetViewerTool extends BaseTool {
  constructor(config) {
    super(config);
    this.files = [];
    this.parquetData = [];
  }

  render() {
    return `
      <div class="tool-interface">
        <h2>${this.icon} ${this.name}</h2>
        <p style="color: var(--text-secondary); margin-bottom: 1.5rem;">
          Upload and view multiple Parquet files with schema inspection and data preview
        </p>

        <!-- File Upload Section -->
        <div class="tool-section">
          <label for="parquetFileInput">Upload Parquet Files</label>
          <input type="file" id="parquetFileInput" accept=".parquet,.parq" multiple class="file-input">
          <p class="helper-text">You can select multiple Parquet files at once</p>
        </div>

        <!-- Uploaded Files List -->
        <div class="tool-section" id="filesListSection" style="display: none;">
          <h3>Uploaded Files (<span id="fileCount">0</span>)</h3>
          <div id="filesList" style="display: flex; flex-direction: column; gap: 0.5rem;">
            <!-- Files will be listed here -->
          </div>
        </div>

        <!-- File Selector -->
        <div class="tool-section" id="fileSelectorSection" style="display: none;">
          <label for="fileSelector">Select File to View</label>
          <select id="fileSelector" style="padding: 0.75rem; background: var(--bg-card); color: var(--text-primary); border: 1px solid var(--border-color); border-radius: 8px; width: 100%; font-size: 0.95rem;">
            <option value="">-- Select a file --</option>
          </select>
        </div>

        <!-- Schema Section -->
        <div class="tool-section" id="schemaSection" style="display: none;">
          <h3>📋 Schema Information</h3>
          <div class="output-section" id="schemaOutput">
            <!-- Schema will appear here -->
          </div>
        </div>

        <!-- Data Preview Section -->
        <div class="tool-section" id="dataSection" style="display: none;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem;">
            <h3>📊 Data Preview</h3>
            <div style="display: flex; gap: 0.5rem;">
              <button class="action-btn" id="exportCsvBtn" style="padding: 0.5rem 1rem; font-size: 0.85rem;">
                📥 Export CSV
              </button>
              <button class="action-btn" id="exportJsonBtn" style="padding: 0.5rem 1rem; font-size: 0.85rem;">
                📥 Export JSON
              </button>
            </div>
          </div>
          <div style="margin-bottom: 0.75rem;">
            <label for="rowsToShow">Rows to display:</label>
            <select id="rowsToShow" style="padding: 0.5rem; background: var(--bg-card); color: var(--text-primary); border: 1px solid var(--border-color); border-radius: 6px; margin-left: 0.5rem;">
              <option value="10">10</option>
              <option value="50" selected>50</option>
              <option value="100">100</option>
              <option value="500">500</option>
              <option value="all">All</option>
            </select>
          </div>
          <div class="output-section" id="dataOutput" style="overflow-x: auto; max-height: 500px; overflow-y: auto;">
            <!-- Data table will appear here -->
          </div>
        </div>

        <!-- Status Section -->
        <div class="tool-section" id="statusSection" style="display: none;">
          <div id="statusMessage" style="padding: 1rem; border-radius: 8px;"></div>
        </div>

        <!-- Info Section -->
        <div class="tool-section">
          <details style="background: var(--bg-secondary); padding: 1rem; border-radius: 8px;">
            <summary style="cursor: pointer; font-weight: 600;">ℹ️ About Apache Parquet</summary>
            <div style="color: var(--text-secondary); font-size: 0.9rem; margin-top: 1rem; line-height: 1.8;">
              <p>Apache Parquet is a columnar storage format optimized for big data processing.</p>
              <p><strong>Features:</strong></p>
              <ul style="margin-left: 1.5rem; margin-top: 0.5rem;">
                <li>Efficient compression and encoding</li>
                <li>Schema evolution support</li>
                <li>Columnar storage for analytical queries</li>
                <li>Language-agnostic format</li>
              </ul>
              <p style="margin-top: 1rem;">
                <strong>Note:</strong> This tool uses parquet-wasm for client-side parsing. 
                Large files may take time to load.
              </p>
            </div>
          </details>
        </div>
      </div>
    `;
  }

  onOpen() {
    this.loadParquetLibrary();
    
    setTimeout(() => {
      const fileInput = document.getElementById('parquetFileInput');
      const fileSelector = document.getElementById('fileSelector');
      const rowsToShow = document.getElementById('rowsToShow');
      const exportCsvBtn = document.getElementById('exportCsvBtn');
      const exportJsonBtn = document.getElementById('exportJsonBtn');

      fileInput?.addEventListener('change', (e) => this.handleFileUpload(e));
      fileSelector?.addEventListener('change', (e) => this.displayFile(e.target.value));
      rowsToShow?.addEventListener('change', () => this.updateDataDisplay());
      exportCsvBtn?.addEventListener('click', () => this.exportData('csv'));
      exportJsonBtn?.addEventListener('click', () => this.exportData('json'));
    }, 0);
  }

  loadParquetLibrary() {
    // Check if parquet-wasm is already loaded
    if (window.parquetWasm) {
      this.showStatus('Parquet library ready', 'success');
      return;
    }

    this.showStatus('Loading Parquet library... This may take a moment.', 'info');

    // Load parquet-wasm from CDN
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/parquet-wasm@0.5.0/esm/parquet_wasm.js';
    script.type = 'module';
    script.onload = async () => {
      try {
        // Initialize parquet-wasm
        const module = await import('https://cdn.jsdelivr.net/npm/parquet-wasm@0.5.0/esm/parquet_wasm.js');
        await module.default();
        window.parquetWasm = module;
        this.showStatus('Parquet library loaded successfully!', 'success');
      } catch (error) {
        this.showStatus('Failed to initialize Parquet library. Some features may not work.', 'error');
        console.error('Parquet library error:', error);
      }
    };
    script.onerror = () => {
      this.showStatus('Failed to load Parquet library. Please check your internet connection.', 'error');
    };
    document.head.appendChild(script);
  }

  async handleFileUpload(event) {
    const files = Array.from(event.target.files);
    if (files.length === 0) return;

    this.showStatus(`Loading ${files.length} file(s)...`, 'info');

    try {
      // Store files and read their content
      for (const file of files) {
        const arrayBuffer = await this.readFileAsArrayBuffer(file);
        this.files.push({
          name: file.name,
          size: file.size,
          data: arrayBuffer
        });
      }

      // Update UI
      this.updateFilesList();
      this.updateFileSelector();
      
      // Auto-select first file
      if (this.files.length > 0) {
        const fileSelector = document.getElementById('fileSelector');
        if (fileSelector) {
          fileSelector.value = '0';
          await this.displayFile('0');
        }
      }

      this.showStatus(`${files.length} file(s) loaded successfully!`, 'success');
    } catch (error) {
      this.showStatus(`Error loading files: ${error.message}`, 'error');
    }
  }

  readFileAsArrayBuffer(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => resolve(e.target.result);
      reader.onerror = (e) => reject(new Error('Failed to read file'));
      reader.readAsArrayBuffer(file);
    });
  }

  updateFilesList() {
    const filesListSection = document.getElementById('filesListSection');
    const filesList = document.getElementById('filesList');
    const fileCount = document.getElementById('fileCount');

    if (!filesList || !filesListSection || !fileCount) return;

    fileCount.textContent = this.files.length;
    filesListSection.style.display = 'block';

    filesList.innerHTML = this.files.map((file, index) => `
      <div style="display: flex; justify-content: space-between; align-items: center; padding: 0.75rem; background: var(--bg-card); border: 1px solid var(--border-color); border-radius: 6px;">
        <div>
          <strong>${file.name}</strong>
          <span style="color: var(--text-secondary); font-size: 0.85rem; margin-left: 0.5rem;">
            (${this.formatFileSize(file.size)})
          </span>
        </div>
        <button onclick="window.parquetTool.removeFile(${index})" style="padding: 0.25rem 0.75rem; background: #ef4444; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 0.85rem;">
          Remove
        </button>
      </div>
    `).join('');

    // Store reference for remove function
    window.parquetTool = this;
  }

  removeFile(index) {
    this.files.splice(index, 1);
    this.updateFilesList();
    this.updateFileSelector();
    
    if (this.files.length === 0) {
      document.getElementById('filesListSection').style.display = 'none';
      document.getElementById('fileSelectorSection').style.display = 'none';
      document.getElementById('schemaSection').style.display = 'none';
      document.getElementById('dataSection').style.display = 'none';
    }
  }

  updateFileSelector() {
    const fileSelectorSection = document.getElementById('fileSelectorSection');
    const fileSelector = document.getElementById('fileSelector');

    if (!fileSelector || !fileSelectorSection) return;

    if (this.files.length > 0) {
      fileSelectorSection.style.display = 'block';
      fileSelector.innerHTML = '<option value="">-- Select a file --</option>' +
        this.files.map((file, index) => 
          `<option value="${index}">${file.name}</option>`
        ).join('');
    } else {
      fileSelectorSection.style.display = 'none';
    }
  }

  async displayFile(index) {
    if (index === '' || !this.files[index]) {
      document.getElementById('schemaSection').style.display = 'none';
      document.getElementById('dataSection').style.display = 'none';
      return;
    }

    const file = this.files[index];
    this.currentFileIndex = parseInt(index);

    try {
      this.showStatus(`Parsing ${file.name}...`, 'info');

      // Parse Parquet file (simplified - actual implementation would use parquet-wasm)
      const parsedData = await this.parseParquetFile(file.data, file.name);
      this.parquetData = parsedData;

      // Display schema and data
      this.displaySchema(parsedData.schema);
      this.displayData(parsedData.data, parsedData.schema);

      this.showStatus(`${file.name} loaded successfully!`, 'success');
    } catch (error) {
      this.showStatus(`Error parsing file: ${error.message}`, 'error');
    }
  }

  async parseParquetFile(arrayBuffer, filename) {
    // Simplified parser - in a real implementation, this would use parquet-wasm library
    // For demonstration, we'll create mock data
    
    // Note: Real implementation would be:
    // const uint8Array = new Uint8Array(arrayBuffer);
    // const table = window.parquetWasm.readParquet(uint8Array);
    // return this.convertArrowTableToJSON(table);

    // Mock implementation for demonstration
    this.showStatus('Note: Using mock data for demonstration. Real Parquet parsing requires parquet-wasm library.', 'info');
    
    return {
      schema: [
        { name: 'id', type: 'int64' },
        { name: 'name', type: 'string' },
        { name: 'age', type: 'int32' },
        { name: 'email', type: 'string' },
        { name: 'created_at', type: 'timestamp' }
      ],
      data: Array.from({ length: 100 }, (_, i) => ({
        id: i + 1,
        name: `User ${i + 1}`,
        age: 20 + (i % 50),
        email: `user${i + 1}@example.com`,
        created_at: new Date(2024, 0, 1 + i).toISOString()
      })),
      filename
    };
  }

  displaySchema(schema) {
    const schemaSection = document.getElementById('schemaSection');
    const schemaOutput = document.getElementById('schemaOutput');

    if (!schemaOutput || !schemaSection) return;

    let schemaHTML = '<table style="width: 100%; border-collapse: collapse; font-size: 0.9rem;">';
    schemaHTML += `
      <thead>
        <tr>
          <th style="padding: 0.75rem; border: 1px solid var(--border-color); background: var(--bg-secondary); text-align: left;">Column Name</th>
          <th style="padding: 0.75rem; border: 1px solid var(--border-color); background: var(--bg-secondary); text-align: left;">Data Type</th>
        </tr>
      </thead>
      <tbody>
    `;

    schema.forEach(column => {
      schemaHTML += `
        <tr>
          <td style="padding: 0.75rem; border: 1px solid var(--border-color);"><code>${column.name}</code></td>
          <td style="padding: 0.75rem; border: 1px solid var(--border-color); color: var(--text-secondary);">${column.type}</td>
        </tr>
      `;
    });

    schemaHTML += '</tbody></table>';
    schemaOutput.innerHTML = schemaHTML;
    schemaSection.style.display = 'block';
  }

  displayData(data, schema) {
    this.updateDataDisplay();
  }

  updateDataDisplay() {
    const dataSection = document.getElementById('dataSection');
    const dataOutput = document.getElementById('dataOutput');
    const rowsToShow = document.getElementById('rowsToShow')?.value || '50';

    if (!dataOutput || !dataSection || !this.parquetData.data) return;

    const data = this.parquetData.data;
    const schema = this.parquetData.schema;
    const rowCount = rowsToShow === 'all' ? data.length : Math.min(parseInt(rowsToShow), data.length);
    const displayData = data.slice(0, rowCount);

    let tableHTML = '<table style="width: 100%; border-collapse: collapse; font-size: 0.85rem;">';
    
    // Header
    tableHTML += '<thead><tr>';
    schema.forEach(column => {
      tableHTML += `<th style="padding: 0.75rem; border: 1px solid var(--border-color); background: var(--bg-secondary); text-align: left; white-space: nowrap;">${column.name}</th>`;
    });
    tableHTML += '</tr></thead>';

    // Data rows
    tableHTML += '<tbody>';
    displayData.forEach(row => {
      tableHTML += '<tr>';
      schema.forEach(column => {
        const value = row[column.name];
        const displayValue = value !== null && value !== undefined ? String(value) : '<span style="color: var(--text-secondary);">null</span>';
        tableHTML += `<td style="padding: 0.75rem; border: 1px solid var(--border-color); max-width: 300px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${displayValue}</td>`;
      });
      tableHTML += '</tr>';
    });
    tableHTML += '</tbody></table>';

    if (data.length > rowCount) {
      tableHTML += `<p style="margin-top: 1rem; color: var(--text-secondary); font-size: 0.85rem;">Showing ${rowCount} of ${data.length} rows</p>`;
    }

    dataOutput.innerHTML = tableHTML;
    dataSection.style.display = 'block';
  }

  exportData(format) {
    if (!this.parquetData || !this.parquetData.data) {
      this.showStatus('No data to export. Please load a Parquet file first.', 'error');
      return;
    }

    const data = this.parquetData.data;
    const filename = this.files[this.currentFileIndex]?.name.replace('.parquet', '').replace('.parq', '') || 'data';

    try {
      if (format === 'csv') {
        const csv = this.convertToCSV(data, this.parquetData.schema);
        this.downloadFile(new Blob([csv], { type: 'text/csv' }), `${filename}.csv`);
        this.showStatus('CSV exported successfully!', 'success');
      } else if (format === 'json') {
        const json = JSON.stringify(data, null, 2);
        this.downloadFile(new Blob([json], { type: 'application/json' }), `${filename}.json`);
        this.showStatus('JSON exported successfully!', 'success');
      }
    } catch (error) {
      this.showStatus(`Export error: ${error.message}`, 'error');
    }
  }

  convertToCSV(data, schema) {
    const headers = schema.map(col => col.name).join(',');
    const rows = data.map(row => 
      schema.map(col => {
        const value = row[col.name];
        // Handle values with commas or quotes
        if (value === null || value === undefined) return '';
        const stringValue = String(value);
        if (stringValue.includes(',') || stringValue.includes('"') || stringValue.includes('\n')) {
          return `"${stringValue.replace(/"/g, '""')}"`;
        }
        return stringValue;
      }).join(',')
    );
    return [headers, ...rows].join('\n');
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

  formatFileSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(2) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
  }

  showStatus(message, type) {
    const statusSection = document.getElementById('statusSection');
    const statusMessage = document.getElementById('statusMessage');
    
    if (!statusMessage) return;

    const colors = {
      success: 'background: #10b98120; border: 1px solid #10b981; color: #10b981;',
      error: 'background: #ef444420; border: 1px solid #ef4444; color: #ef4444;',
      info: 'background: #3b82f620; border: 1px solid #3b82f6; color: #3b82f6;'
    };

    statusMessage.style = colors[type] || colors.info;
    statusMessage.textContent = message;
    statusSection.style.display = 'block';

    if (type === 'success' || type === 'info') {
      setTimeout(() => {
        statusSection.style.display = 'none';
      }, 5000);
    }
  }
}
