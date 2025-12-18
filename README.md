# DevToolkit 🛠️

> A modern, open-source developer tools platform with 120+ tools across 11 categories. Clean bento grid design, zero dependencies, 100% client-side.

**Created by [@nikboson](https://github.com/nikboson)**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

## ✨ Features

- 🎨 **Clean Design** - Black & white bento grid with animated background
- 🔍 **Smart Search** - Global search with category filtering (Ctrl+Enter / Cmd+Enter)
- ⚙️ **Environment Manager** - Postman-like variable management with `{{variable}}` substitution
- 🧩 **Modular Architecture** - SOLID principles, factory pattern, plug-and-play tools
- 📝 **Zero Config** - Pure vanilla JavaScript, no build tools or bundlers
- ⚡ **Client-Side** - All processing in browser, no server required
- 💾 **Persistent State** - localStorage for configurations and preferences
- 📱 **Responsive** - Works on desktop, tablet, and mobile
- 🐳 **Docker Ready** - Production-ready containerization
- 🤖 **SEO Optimized** - AI-scrapeable metadata for LLMs

## 📦 Quick Start

### Local Development

```bash
# Clone the repository
git clone https://github.com/nikboson/devtoolkit.git
cd devtoolkit

# Start development server
python3 -m http.server 8000

# Open browser
open http://localhost:8000
```

### Docker Deployment

```bash
# Build and run with Docker Compose
docker-compose up -d

# Access at http://localhost:8080
```

Or build manually:

```bash
docker build -t devtoolkit .
docker run -p 8080:80 devtoolkit
```

## 🛠️ Available Tools

### 11 Categories | 120+ Tools

#### 🔧 Backend Development (20+ tools)
- **Active:** JSON Beautifier, Base64 Encoder/Decoder, JWT Decoder, RegEx Tester
- Coming: GraphQL Playground, API Blueprint, Webhook Tester, etc.

#### 🎨 Frontend Development (15+ tools)
- Coming: Color Picker, CSS Minifier, HTML Formatter, SVG Optimizer, etc.

#### 🚀 DevOps & Infrastructure (15+ tools)
- Coming: YAML Validator, Docker Composer, Kubernetes Config, Cron Parser, etc.

#### 🤖 AI & Machine Learning (11 tools)
- Coming: API Agent Chat, Model Comparer, Token Counter, AI Humanizer, Prompt Builder, etc.

#### 🔐 Cybersecurity (20+ tools)
- Coming: SQL Injection Tester, XSS Generator, Hash Cracker, Port Scanner, JWT Cracker, etc.

#### 🔄 Data Conversion (13 tools)
- Coming: Parquet Viewer, CSV↔Excel, Parquet↔CSV/JSON/Excel, Avro↔Parquet, etc.

#### 🗄️ SQL & Database (10+ tools)
- Coming: Query Formatter, Schema Validator, ER Diagram Generator, Query Optimizer, etc.

#### 📚 Cheat Sheets (10+ tools)
- Coming: Git, Docker, Kubernetes, SQL, RegEx, HTTP Status, etc.

#### 📊 Data Tools (5+ tools)
- **Active:** Difference Checker
- Coming: Data Validator, CSV Parser, Log Analyzer, etc.

#### 🔒 Security Tools (5+ tools)
- **Active:** SHA256 Hash Generator
- Coming: Password Generator, Encryption/Decryption, Certificate Decoder, etc.

#### 🎯 Utilities (15+ tools)
- **Active:** GUID Generator, Service Bus Sender/Listener
- Coming: QR Code Generator, Markdown Previewer, Timestamp Converter, etc.

## 🏗️ Architecture

DevToolkit follows **SOLID principles** with clean separation of concerns:

### Project Structure
```
devtoolkit/
├── index.html                    # Main entry point with SEO
├── styles.css                    # Global styles with CSS Grid
├── tools-config.json             # Tool registry (120+ tools)
├── Dockerfile                    # Multi-stage production build
├── docker-compose.yml            # Container orchestration
├── robots.txt                    # Search engine & AI crawler rules
├── sitemap.xml                   # SEO sitemap
└── js/
    ├── app.js                    # Application bootstrap
    ├── core/                     # Framework layer
    │   ├── BaseTool.js           # Abstract base class for all tools
    │   ├── ToolFactory.js        # Factory pattern (registers tools)
    │   ├── ConfigManager.js      # Loads tools-config.json
    │   ├── SearchService.js      # Search & filter engine
    │   ├── UIManager.js          # Renders cards & modals
    │   └── EnvironmentManager.js # Variable substitution engine
    ├── ui/
    │   └── EnvironmentUI.js      # Settings modal interface
    ├── utils/
    │   └── StorageManager.js     # localStorage wrapper
    └── tools/                    # Tool implementations
        ├── JsonBeautifierTool.js
        ├── GuidGeneratorTool.js
        ├── Sha256Tool.js
        ├── Base64Tool.js
        ├── DiffCheckerTool.js
        ├── ServiceBusSenderTool.js
        ├── ServiceBusListenerTool.js
        └── PlaceholderTool.js
```

### Design Patterns

#### 1. **Factory Pattern** (`ToolFactory.js`)
```javascript
class ToolFactory {
  constructor() {
    this.toolRegistry = new Map([
      ['json-beautifier', JsonBeautifierTool],
      ['guid-generator', GuidGeneratorTool],
      // Add new tools here
    ]);
  }
  
  createTool(config) {
    const ToolClass = this.toolRegistry.get(config.id) || PlaceholderTool;
    return new ToolClass(config);
  }
}
```

#### 2. **Template Method** (`BaseTool.js`)
```javascript
export class BaseTool {
  constructor(config) { /* ... */ }
  
  // Template methods - override in subclasses
  render() { throw new Error('Must implement render()'); }
  onOpen() { /* Optional lifecycle hook */ }
  onClose() { /* Optional cleanup */ }
}
```

#### 3. **Dependency Injection**
- Tools receive configuration via constructor
- No hard-coded dependencies
- Easy to test and mock

#### 4. **Single Responsibility**
- `ConfigManager`: Configuration loading only
- `SearchService`: Search logic only
- `UIManager`: UI rendering only
- `StorageManager`: localStorage only

#### 5. **Open/Closed Principle**
- Open for extension (add new tools)
- Closed for modification (core unchanged)

## 🤝 Contributing

We welcome contributions! Here's how to add a new tool:

### Prerequisites
- Basic JavaScript (ES6 modules)
- Understanding of HTML/CSS
- Git fundamentals

### Development Workflow

#### 1️⃣ **Find or Create an Issue**
- Check [Issues](https://github.com/nikboson/devtoolkit/issues) for existing feature requests
- Create a new issue describing the tool you want to add
- Wait for maintainer approval before starting work

#### 2️⃣ **Fork & Clone**
```bash
# Fork the repo on GitHub, then:
git clone https://github.com/YOUR_USERNAME/devtoolkit.git
cd devtoolkit
git checkout -b feature/my-new-tool
```

#### 3️⃣ **Add Tool Configuration**
Edit `tools-config.json` to register your tool:

```json
{
  "tools": [
    {
      "id": "url-encoder",
      "name": "URL Encoder/Decoder",
      "description": "Encode or decode URLs for safe transmission",
      "category": "backend",
      "enabled": true,
      "icon": "🔗",
      "keywords": ["url", "encode", "decode", "uri", "percent", "escape"]
    }
  ]
}
```

**Configuration Fields:**
- `id` (required): Unique kebab-case identifier
- `name` (required): Display name (2-5 words)
- `description` (required): Brief explanation (10-20 words)
- `category` (required): One of: `backend`, `frontend`, `devops`, `ai`, `cybersecurity`, `conversion`, `sql`, `cheatsheet`, `data`, `security`, `utility`
- `enabled` (required): `true` for working tools, `false` for placeholders
- `icon` (required): Single emoji representing the tool
- `keywords` (required): Array of search terms (5-10 words)

#### 4️⃣ **Implement Tool Class**
Create `js/tools/UrlEncoderTool.js`:

```javascript
import { BaseTool } from '../core/BaseTool.js';

export class UrlEncoderTool extends BaseTool {
  render() {
    return `
      <div class="tool-interface">
        <h2>${this.icon} ${this.name}</h2>
        
        <div class="tool-section">
          <label for="urlInput">Input URL</label>
          <textarea id="urlInput" rows="4" placeholder="Enter URL to encode/decode"></textarea>
        </div>

        <div class="tool-section button-group">
          <button class="action-btn" id="encodeBtn">🔒 Encode</button>
          <button class="action-btn" id="decodeBtn">🔓 Decode</button>
        </div>

        <div class="tool-section">
          <label for="urlOutput">Output</label>
          <div class="output-section" id="urlOutput">
            <pre>Result will appear here...</pre>
          </div>
        </div>
      </div>
    `;
  }

  onOpen() {
    // Use setTimeout to ensure DOM is ready
    setTimeout(() => {
      document.getElementById('encodeBtn')?.addEventListener('click', () => this.encode());
      document.getElementById('decodeBtn')?.addEventListener('click', () => this.decode());
    }, 0);
  }

  encode() {
    const input = document.getElementById('urlInput').value;
    const output = document.getElementById('urlOutput');
    
    try {
      const encoded = encodeURIComponent(input);
      output.innerHTML = `<pre>${encoded}</pre>`;
    } catch (error) {
      output.innerHTML = `<pre class="error">Error: ${error.message}</pre>`;
    }
  }

  decode() {
    const input = document.getElementById('urlInput').value;
    const output = document.getElementById('urlOutput');
    
    try {
      const decoded = decodeURIComponent(input);
      output.innerHTML = `<pre>${decoded}</pre>`;
    } catch (error) {
      output.innerHTML = `<pre class="error">Error: ${error.message}</pre>`;
    }
  }
}
```

**Key Methods:**
- `render()`: Returns HTML string for tool UI (required)
- `onOpen()`: Lifecycle hook for event listeners (optional)
- `onClose()`: Cleanup when modal closes (optional)

**Best Practices:**
- Use `setTimeout(() => { ... }, 0)` for DOM manipulation in `onOpen()`
- Always wrap operations in `try-catch` blocks
- Provide clear error messages to users
- Use semantic IDs (e.g., `toolNameInput`, `toolNameOutput`)
- Maintain consistent styling with existing tools

#### 5️⃣ **Register in Factory**
Edit `js/core/ToolFactory.js`:

```javascript
import { UrlEncoderTool } from '../tools/UrlEncoderTool.js';

constructor() {
  this.toolRegistry = new Map([
    // ... existing tools
    ['url-encoder', UrlEncoderTool], // Add this line
  ]);
}
```

#### 6️⃣ **Test Locally**
```bash
# Start development server
python3 -m http.server 8000

# Open in browser
open http://localhost:8000

# Test your tool:
# 1. Search for your tool by name or keyword
# 2. Click to open modal
# 3. Test all functionality
# 4. Check error handling
# 5. Verify responsive design
# 6. Test Settings button access
```

#### 7️⃣ **Commit & Push**
```bash
git add .
git commit -m "feat: add URL encoder/decoder tool"
git push origin feature/my-new-tool
```

**Commit Message Format:**
- `feat: add [tool name]` - New tool implementation
- `fix: resolve [issue] in [tool name]` - Bug fixes
- `docs: update [section] in README` - Documentation
- `style: improve [aspect] of [tool name]` - Visual changes
- `refactor: optimize [tool name]` - Code improvements

#### 8️⃣ **Create Pull Request**
1. Go to GitHub and create a PR from your fork
2. Use template: `[Tool] Tool Name`
3. Describe what the tool does
4. Reference related issue(s)
5. Add screenshots/GIFs if applicable
6. Wait for code review

### Code Review Checklist

Before submitting, ensure:
- ✅ Tool follows `BaseTool` pattern
- ✅ Registered in `ToolFactory.js`
- ✅ Configuration in `tools-config.json` is complete
- ✅ Error handling implemented
- ✅ No console errors in browser
- ✅ Works on mobile/desktop
- ✅ Settings button accessible
- ✅ Follows existing code style
- ✅ No external dependencies added
- ✅ Pure client-side (no server calls)

### Creating Placeholder Tools

To reserve a tool for future implementation:

```json
{
  "id": "my-future-tool",
  "name": "My Future Tool",
  "description": "Will be implemented soon",
  "category": "utility",
  "enabled": false,  // Shows "Coming Soon" card
  "icon": "⏳",
  "keywords": ["future", "planned"]
}
```

### Environment Variables

Tools can use the Environment Manager for dynamic values:

```javascript
import { EnvironmentManager } from '../core/EnvironmentManager.js';

const envManager = EnvironmentManager.getInstance();
const apiUrl = envManager.getValue('apiUrl'); // Gets from settings

// Or use variable substitution
const template = 'Connecting to {{apiUrl}}/endpoint';
const replaced = envManager.replaceVariables(template);
```

### Styling Guidelines

Use existing CSS classes:
- `.tool-interface` - Main container
- `.tool-section` - Content sections
- `.action-btn` - Primary buttons
- `.output-section` - Result displays
- `.error` - Error messages
- `.button-group` - Multiple buttons

### Need Help?

- 💬 [Join Discussions](https://github.com/nikboson/devtoolkit/discussions)
- 🐛 [Report Bug](https://github.com/nikboson/devtoolkit/issues/new?template=bug_report.md)
- 💡 [Request Feature](https://github.com/nikboson/devtoolkit/issues/new?template=feature_request.md)
- 📧 Contact: nikboson@github.com

## ⚙️ Environment Manager

Postman-like variable management for reusable configurations:

### Features
- Define variables once, use everywhere with `{{variableName}}`
- 15+ predefined variables (Azure, HTTP, Database, etc.)
- Custom variable support
- Persistent storage in browser
- Accessible from any tool via Settings button

### Usage Example
```javascript
// In Settings (⚙️):
apiUrl = https://api.example.com
apiKey = sk-abc123

// In any tool:
Endpoint: {{apiUrl}}/users
Authorization: Bearer {{apiKey}}

// Automatically replaced with:
Endpoint: https://api.example.com/users
Authorization: Bearer sk-abc123
```

### Predefined Variables
- **Azure:** `azureServiceBusConnectionString`, `azureEventHubConnectionString`, `azureStorageConnectionString`
- **HTTP:** `apiUrl`, `apiKey`, `bearerToken`
- **Database:** `dbHost`, `dbPort`, `dbName`, `dbUser`, `dbPassword`
- **Custom:** Add your own variables

## 🚀 Deployment

### Development Server
```bash
# Python (Recommended)
python3 -m http.server 8000

# Node.js
npx http-server -p 8000

# PHP
php -S localhost:8000
```

### Production Docker
```bash
# Build multi-stage optimized image
docker build -t devtoolkit:latest .

# Run with Compose
docker-compose up -d

# Access at http://localhost:8080
```

### Cloud Deployment

#### AWS S3 + CloudFront
```bash
aws s3 sync . s3://your-bucket --exclude ".git/*"
aws cloudfront create-invalidation --distribution-id YOUR_ID --paths "/*"
```

#### Netlify
```bash
# Install Netlify CLI
npm install -g netlify-cli

# Deploy
netlify deploy --prod
```

#### Vercel
```bash
# Install Vercel CLI
npm install -g vercel

# Deploy
vercel --prod
```

#### GitHub Pages
```bash
# Push to gh-pages branch
git subtree push --prefix . origin gh-pages
```

## 🎨 Customization

### Theme Colors
Edit CSS variables in `styles.css`:
```css
:root {
  --bg-primary: #000000;      /* Main background */
  --bg-secondary: #0a0a0a;    /* Secondary background */
  --bg-card: #111111;         /* Card background */
  --text-primary: #ffffff;    /* Primary text */
  --text-secondary: #999999;  /* Secondary text */
  --accent-color: #ffffff;    /* Accent color */
  --border-color: #333333;    /* Border color */
}
```

### Grid Layout
Adjust responsive breakpoints in `styles.css`:
```css
.bento-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 1.5rem;
  padding: 2rem;
}

/* Mobile */
@media (max-width: 768px) {
  .bento-grid {
    grid-template-columns: 1fr;
    gap: 1rem;
    padding: 1rem;
  }
}
```

### Fonts
Using [Google Fonts Inter](https://fonts.google.com/specimen/Inter):
```html
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet">
```

## 🌐 Browser Support

| Browser | Minimum Version | Notes |
|---------|----------------|-------|
| Chrome | 61+ | Full support |
| Firefox | 60+ | Full support |
| Safari | 11+ | Full support |
| Edge | 16+ | Full support |
| Opera | 48+ | Full support |

**Requirements:**
- ES6 Modules (`import`/`export`)
- CSS Grid
- CSS Custom Properties
- Fetch API
- localStorage

## 📊 Performance

- **Bundle Size:** 0 KB (no bundler, no dependencies)
- **Load Time:** < 1s (pure HTML/CSS/JS)
- **Tools:** Client-side processing (no server calls)
- **Storage:** Browser localStorage (5-10 MB limit)

## 🔒 Security & Privacy

- **100% Client-Side:** All processing happens in your browser
- **No Analytics:** Zero tracking or telemetry
- **No Server Calls:** Tools work offline after initial load
- **localStorage Only:** Data never leaves your device
- **No Cookies:** No tracking mechanisms
- **Open Source:** Audit the code yourself

**Azure Service Bus Tools:**  
These provide UI simulation only. For production:
1. Use secure backend proxy (never expose connection strings client-side)
2. Implement Azure Functions middleware
3. Use SAS tokens with minimal permissions
4. Enable Azure Key Vault for secrets

## 📄 License

MIT License - see [LICENSE](LICENSE) file for details.

**TL;DR:** Use freely, modify, distribute. Attribution appreciated but not required.

## 🙏 Acknowledgments

- Built with ❤️ by [@nikboson](https://github.com/nikboson)
- Inspired by developer communities worldwide
- Icons from emoji standards
- Font: [Inter](https://rsms.me/inter/) by Rasmus Andersson

## 📞 Support & Contact

- 🐛 **Bug Reports:** [GitHub Issues](https://github.com/nikboson/devtoolkit/issues)
- 💡 **Feature Requests:** [GitHub Discussions](https://github.com/nikboson/devtoolkit/discussions)
- 💬 **Questions:** [GitHub Discussions](https://github.com/nikboson/devtoolkit/discussions)
- 📧 **Email:** nikboson@github.com
- ⭐ **Star the Repo:** Help others discover DevToolkit!

---

**Made with ☕ and code by [@nikboson](https://github.com/nikboson)**
