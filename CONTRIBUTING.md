# Contributing to DevToolkit

First off, thank you for considering contributing to DevToolkit! 🎉

## 📋 Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Development Process](#development-process)
- [Tool Development Guide](#tool-development-guide)
- [Code Style](#code-style)
- [Pull Request Process](#pull-request-process)
- [Issue Reporting](#issue-reporting)

## 📜 Code of Conduct

### Our Pledge

We pledge to make participation in our project a harassment-free experience for everyone, regardless of age, body size, disability, ethnicity, gender identity, level of experience, nationality, personal appearance, race, religion, or sexual identity and orientation.

### Our Standards

**Examples of behavior that contributes to a positive environment:**
- Using welcoming and inclusive language
- Being respectful of differing viewpoints
- Gracefully accepting constructive criticism
- Focusing on what is best for the community
- Showing empathy towards other community members

**Examples of unacceptable behavior:**
- Trolling, insulting/derogatory comments, and personal attacks
- Public or private harassment
- Publishing others' private information without permission
- Other conduct which could reasonably be considered inappropriate

## 🚀 Getting Started

### Prerequisites

- Git installed and configured
- Modern web browser (Chrome, Firefox, Safari, Edge)
- Code editor (VS Code recommended)
- Python 3 (for local dev server) or Node.js

### Fork & Clone

1. Fork the repository on GitHub
2. Clone your fork locally:
   ```bash
   git clone https://github.com/YOUR_USERNAME/devtoolkit.git
   cd devtoolkit
   ```
3. Add upstream remote:
   ```bash
   git remote add upstream https://github.com/nikboson/devtoolkit.git
   ```
4. Create a feature branch:
   ```bash
   git checkout -b feature/my-awesome-tool
   ```

### Running Locally

```bash
# Start development server
python3 -m http.server 8000

# Open browser
open http://localhost:8000

# Make changes and refresh browser
```

## 🔄 Development Process

### 1. Find or Create an Issue

- Browse [existing issues](https://github.com/nikboson/devtoolkit/issues)
- Check if someone is already working on it
- If not found, create a new issue describing:
  - What tool you want to add
  - Why it would be useful
  - Any technical considerations
- Wait for maintainer approval before starting work

### 2. Branch Naming Convention

```
feature/tool-name       # New tool implementation
fix/bug-description     # Bug fixes
docs/section-name       # Documentation updates
refactor/component-name # Code improvements
style/ui-change         # Visual/CSS changes
```

### 3. Commit Messages

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add URL encoder/decoder tool
fix: resolve JSON parsing error in beautifier
docs: update contribution guidelines
style: improve modal spacing and typography
refactor: optimize search performance
test: add unit tests for base64 encoder
```

**Format:** `<type>: <description>`

**Types:**
- `feat`: New feature or tool
- `fix`: Bug fix
- `docs`: Documentation changes
- `style`: Visual changes (CSS, UI)
- `refactor`: Code restructuring
- `test`: Adding tests
- `chore`: Maintenance tasks

### 4. Keep Your Fork Updated

```bash
# Fetch upstream changes
git fetch upstream

# Merge into your branch
git checkout main
git merge upstream/main

# Update your feature branch
git checkout feature/my-awesome-tool
git rebase main
```

## 🛠️ Tool Development Guide

### Tool Checklist

Before starting implementation:

- [ ] Issue created and approved
- [ ] Tool doesn't duplicate existing functionality
- [ ] Tool works 100% client-side (no server required)
- [ ] Tool fits into one of the 11 categories
- [ ] You understand the BaseTool pattern

### Step-by-Step Implementation

#### 1. Add to tools-config.json

```json
{
  "id": "color-picker",
  "name": "Color Picker",
  "description": "Pick colors and convert between HEX, RGB, HSL formats",
  "category": "frontend",
  "enabled": true,
  "icon": "🎨",
  "keywords": ["color", "picker", "hex", "rgb", "hsl", "palette", "design"]
}
```

**Field Guidelines:**
- `id`: Lowercase, kebab-case, unique
- `name`: Title Case, 2-5 words
- `description`: Brief, clear, 10-20 words
- `category`: One of: `backend`, `frontend`, `devops`, `ai`, `cybersecurity`, `conversion`, `sql`, `cheatsheet`, `data`, `security`, `utility`
- `enabled`: `true` if implemented, `false` for placeholder
- `icon`: Single emoji (relevant to tool function)
- `keywords`: 5-10 searchable terms (lowercase)

#### 2. Create Tool Class

Create `js/tools/ColorPickerTool.js`:

```javascript
import { BaseTool } from '../core/BaseTool.js';

export class ColorPickerTool extends BaseTool {
  /**
   * Renders the tool interface
   * @returns {string} HTML string
   */
  render() {
    return `
      <div class="tool-interface">
        <h2>${this.icon} ${this.name}</h2>
        
        <!-- Color Picker Input -->
        <div class="tool-section">
          <label for="colorInput">Pick a Color</label>
          <input type="color" id="colorInput" value="#3498db">
        </div>

        <!-- Output Formats -->
        <div class="tool-section">
          <h3>Color Formats</h3>
          <div class="output-section" id="colorOutput">
            <div class="color-format">
              <strong>HEX:</strong> <span id="hexValue">#3498db</span>
            </div>
            <div class="color-format">
              <strong>RGB:</strong> <span id="rgbValue">rgb(52, 152, 219)</span>
            </div>
            <div class="color-format">
              <strong>HSL:</strong> <span id="hslValue">hsl(204, 70%, 53%)</span>
            </div>
          </div>
        </div>

        <!-- Color Preview -->
        <div class="tool-section">
          <div class="color-preview" id="colorPreview" style="background-color: #3498db;"></div>
        </div>
      </div>
    `;
  }

  /**
   * Lifecycle hook - called when tool modal opens
   */
  onOpen() {
    // Use setTimeout to ensure DOM is ready
    setTimeout(() => {
      const colorInput = document.getElementById('colorInput');
      if (colorInput) {
        colorInput.addEventListener('input', (e) => this.updateColor(e.target.value));
      }
    }, 0);
  }

  /**
   * Update color displays
   * @param {string} hex - Hex color value
   */
  updateColor(hex) {
    try {
      // Update preview
      const preview = document.getElementById('colorPreview');
      if (preview) {
        preview.style.backgroundColor = hex;
      }

      // Convert and display formats
      document.getElementById('hexValue').textContent = hex;
      document.getElementById('rgbValue').textContent = this.hexToRgb(hex);
      document.getElementById('hslValue').textContent = this.hexToHsl(hex);
    } catch (error) {
      console.error('Error updating color:', error);
    }
  }

  /**
   * Convert HEX to RGB
   * @param {string} hex - Hex color
   * @returns {string} RGB format
   */
  hexToRgb(hex) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgb(${r}, ${g}, ${b})`;
  }

  /**
   * Convert HEX to HSL
   * @param {string} hex - Hex color
   * @returns {string} HSL format
   */
  hexToHsl(hex) {
    let r = parseInt(hex.slice(1, 3), 16) / 255;
    let g = parseInt(hex.slice(3, 5), 16) / 255;
    let b = parseInt(hex.slice(5, 7), 16) / 255;

    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    let h, s, l = (max + min) / 2;

    if (max === min) {
      h = s = 0;
    } else {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      
      switch (max) {
        case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
        case g: h = ((b - r) / d + 2) / 6; break;
        case b: h = ((r - g) / d + 4) / 6; break;
      }
    }

    h = Math.round(h * 360);
    s = Math.round(s * 100);
    l = Math.round(l * 100);

    return `hsl(${h}, ${s}%, ${l}%)`;
  }

  /**
   * Cleanup when modal closes (optional)
   */
  onClose() {
    // Remove event listeners, clear intervals, etc.
  }
}
```

#### 3. Register in Factory

Edit `js/core/ToolFactory.js`:

```javascript
import { ColorPickerTool } from '../tools/ColorPickerTool.js';

constructor() {
  this.toolRegistry = new Map([
    // ... existing tools
    ['color-picker', ColorPickerTool], // Add this line
  ]);
}
```

#### 4. Test Thoroughly

- [ ] Tool loads without errors
- [ ] All buttons and inputs work
- [ ] Error handling displays proper messages
- [ ] Works on mobile viewport
- [ ] Settings button is accessible
- [ ] No console errors
- [ ] Matches existing UI style

### Code Organization

```javascript
export class MyTool extends BaseTool {
  // 1. Lifecycle methods first
  render() { /* ... */ }
  onOpen() { /* ... */ }
  onClose() { /* ... */ }

  // 2. Public methods
  doAction() { /* ... */ }
  
  // 3. Private helper methods (prefix with _)
  _helperMethod() { /* ... */ }
  
  // 4. Utility methods last
  formatOutput(data) { /* ... */ }
}
```

### Error Handling

Always wrap operations in try-catch:

```javascript
doAction() {
  const input = document.getElementById('input').value;
  const output = document.getElementById('output');
  
  try {
    // Validate input
    if (!input.trim()) {
      throw new Error('Input cannot be empty');
    }
    
    // Process
    const result = this.process(input);
    
    // Display success
    output.innerHTML = `<pre>${result}</pre>`;
  } catch (error) {
    // Display error
    output.innerHTML = `<pre class="error">❌ ${error.message}</pre>`;
  }
}
```

### Using Environment Variables

```javascript
import { EnvironmentManager } from '../core/EnvironmentManager.js';

doAction() {
  const envManager = EnvironmentManager.getInstance();
  
  // Get variable value
  const apiUrl = envManager.getValue('apiUrl');
  
  // Replace variables in template
  const template = document.getElementById('input').value;
  const replaced = envManager.replaceVariables(template);
  
  // Use in your logic
  console.log(`Connecting to: ${apiUrl}`);
}
```

## 🎨 Code Style

### JavaScript

```javascript
// Use ES6 modules
import { BaseTool } from '../core/BaseTool.js';

// Use const/let, never var
const tool = new MyTool();
let counter = 0;

// Arrow functions for callbacks
array.map(item => item.toUpperCase());

// Template literals for strings
const message = `Hello ${name}, you have ${count} items`;

// Destructuring
const { id, name, description } = toolConfig;

// Optional chaining
document.getElementById('btn')?.addEventListener('click', handler);

// Meaningful names
const userInput = document.getElementById('input').value;  // Good
const x = document.getElementById('input').value;          // Bad
```

### HTML in render()

```javascript
render() {
  return `
    <div class="tool-interface">
      <h2>${this.icon} ${this.name}</h2>
      
      <!-- Use semantic HTML -->
      <div class="tool-section">
        <label for="uniqueId">Label Text</label>
        <input type="text" id="uniqueId" placeholder="Hint text">
      </div>

      <!-- Consistent button style -->
      <div class="tool-section">
        <button class="action-btn" id="actionBtn">
          🚀 Action
        </button>
      </div>

      <!-- Output sections -->
      <div class="tool-section">
        <h3>Results</h3>
        <div class="output-section" id="output">
          <pre>Output here...</pre>
        </div>
      </div>
    </div>
  `;
}
```

### CSS Classes

Use existing utility classes:

```html
<!-- Containers -->
<div class="tool-interface">      Main wrapper
<div class="tool-section">         Content section
<div class="output-section">       Result displays
<div class="button-group">         Multiple buttons

<!-- Components -->
<button class="action-btn">        Primary button
<input class="tool-input">         Text input
<textarea class="tool-textarea">   Text area
<pre class="error">                Error message
```

### Comments

```javascript
/**
 * Calculate the SHA256 hash of input text
 * @param {string} text - Input text to hash
 * @returns {string} Hex-encoded hash
 */
async generateHash(text) {
  // Implementation
}

// Single-line comment for brief explanations
const encoded = btoa(input); // Base64 encode
```

## 🔍 Pull Request Process

### Before Submitting

1. **Test your changes:**
   ```bash
   # Start server
   python3 -m http.server 8000
   
   # Test in multiple browsers
   # - Chrome
   # - Firefox
   # - Safari (if on Mac)
   ```

2. **Check for errors:**
   - Open browser DevTools (F12)
   - Check Console for errors
   - Test all tool functionality
   - Verify responsive design (mobile/tablet)

3. **Update documentation:**
   - Add tool to README if significant
   - Update CHANGELOG.md
   - Add JSDoc comments to functions

4. **Commit your changes:**
   ```bash
   git add .
   git commit -m "feat: add color picker tool"
   git push origin feature/color-picker
   ```

### Creating the PR

1. Go to GitHub and click "New Pull Request"
2. Select your fork and branch
3. Use this template:

```markdown
## Description
Brief description of what this PR does.

## Type of Change
- [ ] New tool
- [ ] Bug fix
- [ ] Documentation update
- [ ] Code refactoring
- [ ] UI/UX improvement

## Tool Details (if applicable)
- **Tool Name:** Color Picker
- **Category:** Frontend
- **Icon:** 🎨
- **Description:** Pick colors and convert between HEX, RGB, HSL

## Checklist
- [ ] Tool follows BaseTool pattern
- [ ] Registered in ToolFactory.js
- [ ] Configuration added to tools-config.json
- [ ] Tested in Chrome, Firefox, Safari
- [ ] Works on mobile viewport
- [ ] No console errors
- [ ] Error handling implemented
- [ ] Code follows style guide
- [ ] Documentation updated

## Screenshots
(Add screenshots or GIFs showing the tool in action)

## Related Issues
Closes #123
```

4. Request review from maintainers
5. Address any requested changes
6. Wait for approval and merge

### After Merge

1. Delete your feature branch:
   ```bash
   git branch -d feature/color-picker
   git push origin --delete feature/color-picker
   ```

2. Update your fork:
   ```bash
   git checkout main
   git pull upstream main
   git push origin main
   ```

## 🐛 Issue Reporting

### Bug Reports

Use the bug report template:

```markdown
## Bug Description
Clear description of the bug

## Steps to Reproduce
1. Go to '...'
2. Click on '...'
3. Enter '...'
4. See error

## Expected Behavior
What should happen

## Actual Behavior
What actually happens

## Screenshots
(If applicable)

## Environment
- Browser: Chrome 120
- OS: macOS 14.0
- Device: Desktop

## Additional Context
Any other relevant information
```

### Feature Requests

```markdown
## Feature Description
Clear description of the proposed tool/feature

## Use Case
Why this would be useful

## Proposed Implementation
How you think it could work

## Alternatives Considered
Other approaches you've thought about

## Additional Context
Screenshots, mockups, examples
```

## 📝 Documentation

### README Updates

When adding significant features:

1. Update tool count in header
2. Add tool to appropriate category
3. Update screenshots if UI changed
4. Add any new dependencies or requirements

### Code Documentation

Use JSDoc comments:

```javascript
/**
 * Encode text to Base64
 * @param {string} text - Plain text to encode
 * @returns {string} Base64 encoded string
 * @throws {Error} If input is empty
 * @example
 * encode('hello') // returns 'aGVsbG8='
 */
encode(text) {
  if (!text) throw new Error('Input required');
  return btoa(text);
}
```

## 🎯 Good First Issues

Looking for your first contribution? Check issues labeled:
- `good first issue` - Easy pickings for newcomers
- `help wanted` - Community contributions needed
- `documentation` - Improve docs
- `bug` - Fix known issues

## 💬 Getting Help

Stuck? Need guidance?

- 💬 [GitHub Discussions](https://github.com/nikboson/devtoolkit/discussions)
- 📧 Email: nikboson@github.com
- 🐛 [Issues](https://github.com/nikboson/devtoolkit/issues)

## 🏆 Recognition

Contributors are recognized in:
- GitHub Contributors list
- CHANGELOG.md for significant contributions
- Special thanks in releases

## 📜 License

By contributing, you agree that your contributions will be licensed under the MIT License.

---

**Thank you for contributing to DevToolkit! 🎉**
