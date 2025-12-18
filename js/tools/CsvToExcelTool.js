import { BaseTool } from '../core/BaseTool.js';

export class CsvToExcelTool extends BaseTool {
  render() {
    return `
      <div class="tool-interface">
        <h2>${this.icon} ${this.name}</h2>
        <p style="color: var(--text-secondary); margin-bottom: 1.5rem;">
          Convert CSV files to Excel (XLSX) format with preserved formatting
        </p>

        <!-- File Upload Section -->
        <div class="tool-section">
          <label for="csvFileInput">Upload CSV File</label>
          <input type="file" id="csvFileInput" accept=".csv,.txt" class="file-input">
          <p class="helper-text">or paste CSV text below</p>
        </div>

        <!-- CSV Text Input -->
        <div class="tool-section">
          <label for="csvInput">CSV Data</label>
          <textarea 
            id="csvInput" 
            rows="10" 
            placeholder="Paste your CSV data here...
Example:
Name,Age,Email
John Doe,30,john@example.com
Jane Smith,25,jane@example.com"
            style="font-family: 'Courier New', monospace; font-size: 0.9rem;"
          ></textarea>
        </div>

        <!-- Options -->
        <div class="tool-section">
          <h3>Options</h3>
          <div style="display: flex; flex-direction: column; gap: 0.75rem;">
            <label style="display: flex; align-items: center; gap: 0.5rem; cursor: pointer;">
              <input type="checkbox" id="hasHeaderRow" checked>
              <span>First row contains headers</span>
            </label>
            <label style="display: flex; align-items: center; gap: 0.5rem; cursor: pointer;">
              <input type="checkbox" id="autoWidth" checked>
              <span>Auto-adjust column widths</span>
            </label>
            <div style="display: flex; align-items: center; gap: 0.5rem;">
              <label for="delimiterSelect">Delimiter:</label>
              <select id="delimiterSelect" style="padding: 0.5rem; background: var(--bg-card); color: var(--text-primary); border: 1px solid var(--border-color); border-radius: 6px;">
                <option value=",">Comma (,)</option>
                <option value=";">Semicolon (;)</option>
                <option value="\\t">Tab (\\t)</option>
                <option value="|">Pipe (|)</option>
              </select>
            </div>
          </div>
        </div>

        <!-- Action Button -->
        <div class="tool-section">
          <button class="action-btn" id="convertBtn">
            📊 Convert to Excel
          </button>
        </div>

        <!-- Preview Section -->
        <div class="tool-section" id="previewSection" style="display: none;">
          <h3>Preview (First 10 rows)</h3>
          <div class="output-section" id="previewOutput" style="overflow-x: auto; max-height: 400px; overflow-y: auto;">
            <!-- Preview table will appear here -->
          </div>
        </div>

        <!-- Download Section -->
        <div class="tool-section" id="downloadSection" style="display: none;">
          <div style="display: flex; align-items: center; gap: 1rem;">
            <button class="action-btn" id="downloadBtn" style="background: #10b981;">
              ⬇️ Download Excel File
            </button>
            <span id="fileInfo" style="color: var(--text-secondary); font-size: 0.9rem;"></span>
          </div>
        </div>

        <!-- Status Messages -->
        <div class="tool-section" id="statusSection" style="display: none;">
          <div id="statusMessage" style="padding: 1rem; border-radius: 8px;"></div>
        </div>
      </div>
    `;
  }

  onOpen() {
    setTimeout(() => {
      const fileInput = document.getElementById('csvFileInput');
      const csvInput = document.getElementById('csvInput');
      const convertBtn = document.getElementById('convertBtn');

      fileInput?.addEventListener('change', (e) => this.handleFileUpload(e));
      convertBtn?.addEventListener('click', () => this.convertToExcel());
      
      const downloadBtn = document.getElementById('downloadBtn');
      downloadBtn?.addEventListener('click', () => this.downloadExcel());

      // Auto-convert on input if there's data
      csvInput?.addEventListener('input', () => {
        if (csvInput.value.trim()) {
          document.getElementById('previewSection').style.display = 'none';
          document.getElementById('downloadSection').style.display = 'none';
        }
      });
    }, 0);
  }

  downloadExcel() {
    if (!this.parsedData || this.parsedData.length === 0) {
      this.showStatus('No data to download. Please convert CSV first.', 'error');
      return;
    }

    try {
      // Create Excel file using simple HTML table approach (works in all browsers)
      const { hasHeaderRow, autoWidth } = this.options;
      
      let excelContent = `
        <html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">
        <head>
          <meta charset="UTF-8">
          <xml>
            <x:ExcelWorkbook>
              <x:ExcelWorksheets>
                <x:ExcelWorksheet>
                  <x:Name>Sheet1</x:Name>
                  <x:WorksheetOptions>
                    <x:DisplayGridlines/>
                  </x:WorksheetOptions>
                </x:ExcelWorksheet>
              </x:ExcelWorksheets>
            </x:ExcelWorkbook>
          </xml>
          <style>
            table { border-collapse: collapse; }
            th { background-color: #4472C4; color: white; font-weight: bold; padding: 8px; border: 1px solid #ccc; }
            td { padding: 8px; border: 1px solid #ccc; }
          </style>
        </head>
        <body>
          <table>
      `;

      // Add header row if specified
      if (hasHeaderRow && this.parsedData.length > 0) {
        excelContent += '<thead><tr>';
        this.parsedData[0].forEach(cell => {
          excelContent += `<th>${this.escapeHtml(cell)}</th>`;
        });
        excelContent += '</tr></thead>';
      }

      // Add data rows
      excelContent += '<tbody>';
      const startIdx = hasHeaderRow ? 1 : 0;
      for (let i = startIdx; i < this.parsedData.length; i++) {
        excelContent += '<tr>';
        this.parsedData[i].forEach(cell => {
          // Detect if cell is a number
          const isNumber = !isNaN(cell) && cell.trim() !== '';
          excelContent += `<td${isNumber ? ' style="mso-number-format:0.00"' : ''}>${this.escapeHtml(cell)}</td>`;
        });
        excelContent += '</tr>';
      }
      excelContent += '</tbody></table></body></html>';

      // Create blob and download
      const blob = new Blob([excelContent], { type: 'application/vnd.ms-excel' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `converted_${Date.now()}.xls`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      this.showStatus('Excel file downloaded successfully!', 'success');
    } catch (error) {
      this.showStatus(`Download error: ${error.message}`, 'error');
    }
  }

  handleFileUpload(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      const csvInput = document.getElementById('csvInput');
      if (csvInput) {
        csvInput.value = e.target.result;
        this.showStatus('File loaded successfully! Click "Convert to Excel" to proceed.', 'success');
      }
    };
    reader.onerror = () => {
      this.showStatus('Error reading file. Please try again.', 'error');
    };
    reader.readAsText(file);
  }

  convertToExcel() {
    const csvInput = document.getElementById('csvInput');
    const csvData = csvInput?.value.trim();

    if (!csvData) {
      this.showStatus('Please upload a file or paste CSV data.', 'error');
      return;
    }

    try {
      // Parse CSV
      const delimiter = document.getElementById('delimiterSelect')?.value || ',';
      const hasHeaderRow = document.getElementById('hasHeaderRow')?.checked || false;
      const autoWidth = document.getElementById('autoWidth')?.checked || false;

      const parsedData = this.parseCSV(csvData, delimiter);
      
      if (parsedData.length === 0) {
        this.showStatus('No data found in CSV.', 'error');
        return;
      }

      // Store parsed data for download
      this.parsedData = parsedData;
      this.options = { hasHeaderRow, autoWidth };

      // Show preview
      this.showPreview(parsedData, hasHeaderRow);
      
      // Show download button
      document.getElementById('downloadSection').style.display = 'block';
      const fileInfo = document.getElementById('fileInfo');
      if (fileInfo) {
        fileInfo.textContent = `${parsedData.length} rows, ${parsedData[0]?.length || 0} columns`;
      }

      this.showStatus('Conversion successful! Click download to save the Excel file.', 'success');
    } catch (error) {
      this.showStatus(`Error: ${error.message}`, 'error');
    }
  }

  parseCSV(csvText, delimiter) {
    const lines = csvText.split(/\\r?\\n/).filter(line => line.trim());
    const rows = [];

    for (const line of lines) {
      // Simple CSV parser (handles basic cases)
      const row = [];
      let current = '';
      let inQuotes = false;

      for (let i = 0; i < line.length; i++) {
        const char = line[i];
        
        if (char === '"') {
          inQuotes = !inQuotes;
        } else if (char === delimiter && !inQuotes) {
          row.push(current.trim());
          current = '';
        } else {
          current += char;
        }
      }
      row.push(current.trim());
      rows.push(row);
    }

    return rows;
  }

  showPreview(data, hasHeaderRow) {
    const previewSection = document.getElementById('previewSection');
    const previewOutput = document.getElementById('previewOutput');
    
    if (!previewOutput) return;

    const previewData = data.slice(0, 10);
    let tableHTML = '<table style="width: 100%; border-collapse: collapse; font-size: 0.9rem;">';

    // Header row
    if (hasHeaderRow && data.length > 0) {
      tableHTML += '<thead><tr>';
      data[0].forEach(cell => {
        tableHTML += `<th style="padding: 0.75rem; border: 1px solid var(--border-color); background: var(--bg-secondary); font-weight: 600; text-align: left;">${this.escapeHtml(cell)}</th>`;
      });
      tableHTML += '</tr></thead>';
    }

    // Data rows
    tableHTML += '<tbody>';
    const startIdx = hasHeaderRow ? 1 : 0;
    for (let i = startIdx; i < Math.min(previewData.length, startIdx + 9); i++) {
      tableHTML += '<tr>';
      previewData[i].forEach(cell => {
        tableHTML += `<td style="padding: 0.75rem; border: 1px solid var(--border-color);">${this.escapeHtml(cell)}</td>`;
      });
      tableHTML += '</tr>';
    }
    tableHTML += '</tbody></table>';

    if (data.length > 10) {
      tableHTML += `<p style="margin-top: 1rem; color: var(--text-secondary); font-size: 0.85rem;">Showing first 10 rows of ${data.length} total rows</p>`;
    }

    previewOutput.innerHTML = tableHTML;
    previewSection.style.display = 'block';
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
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

    // Auto-hide success messages after 5 seconds
    if (type === 'success') {
      setTimeout(() => {
        statusSection.style.display = 'none';
      }, 5000);
    }
  }
}
