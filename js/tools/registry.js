// The single source of truth for what tools exist.
//
// Every entry here is a tool that actually works. There are no placeholder or
// "coming soon" entries — if it is listed, it does something.
//
// Entries either carry a `spec` (rendered by SimpleTool) or a `toolClass`
// (a bespoke implementation).

import { textTools } from './specs/text.js';
import { urlTools } from './specs/url.js';
import { webTools } from './specs/web.js';
import { dataTools } from './specs/data.js';
import { encodingTools } from './specs/encoding.js';
import { cryptoTools } from './specs/crypto.js';
import { generatorTools } from './specs/generators.js';
import { miscTools } from './specs/misc.js';
import { qrTools } from './specs/qr.js';
import { aiTools } from './specs/ai.js';
import { codegenTools } from './specs/codegen.js';
import { devxTools } from './specs/devx.js';
import { devopsTools } from './specs/devops.js';
import { diagramTools } from './specs/diagram.js';
import { securityTools } from './specs/security.js';

import { ParquetViewerTool } from './ParquetViewerTool.js';
import { MarkdownViewerTool } from './MarkdownViewerTool.js';
import { ServiceBusSenderTool } from './ServiceBusSenderTool.js';
import { ServiceBusListenerTool } from './ServiceBusListenerTool.js';
import { DiffCheckerTool } from './DiffCheckerTool.js';
import { MermaidViewerTool } from './MermaidViewerTool.js';
import { CsvToExcelTool } from './CsvToExcelTool.js';

export const CATEGORIES = {
    ai:         { name: 'AI & LLM',          icon: '✳',   order: 1 },
    devx:       { name: 'Developer Utilities', icon: '⚙', order: 2 },
    devops:     { name: 'DevOps & Config',   icon: '🐳',  order: 3 },
    security:   { name: 'Security',          icon: '🛡',   order: 4 },
    codegen:    { name: 'JSON Power Tools',  icon: '{→}', order: 5 },
    text:       { name: 'Text',              icon: '¶',   order: 6 },
    url:        { name: 'URL',               icon: '🔗',  order: 7 },
    web:        { name: 'HTML, CSS & JS',    icon: '</>', order: 8 },
    json:       { name: 'JSON, XML & YAML',  icon: '{ }', order: 9 },
    data:       { name: 'Data & Tables',     icon: '▦',   order: 10 },
    sql:        { name: 'SQL',               icon: 'SQL', order: 11 },
    crypto:     { name: 'Hashing & Crypto',  icon: '#',   order: 12 },
    encoding:   { name: 'Encoding',          icon: 'b64', order: 13 },
    generators: { name: 'Generators',        icon: '🎲',  order: 14 },
    image:      { name: 'Diagrams & Colour', icon: '🎨',  order: 15 },
    time:       { name: 'Time & Scheduling', icon: '🕐',  order: 16 },
    network:    { name: 'Network & Client',  icon: '🌐',  order: 17 },
    cloud:      { name: 'Azure Service Bus', icon: '☁',   order: 18 },
    agents:     { name: 'Nik Agents',        icon: '🤖',  order: 19 },
};

/** Tools with their own implementation class. */
const bespokeTools = [
    {
        id: 'parquet-viewer',
        name: 'Parquet Viewer',
        description: 'Open Parquet files, inspect schema and metadata, filter rows and see column statistics.',
        category: 'data',
        icon: '▦',
        keywords: ['parquet', 'apache parquet', 'columnar', 'data', 'viewer', 'schema', 'stats',
            'statistics', 'row group', 'arrow', 'big data', 'analytics', 'spark', 'pandas'],
        toolClass: ParquetViewerTool,
    },
    {
        id: 'csv-to-excel',
        name: 'CSV to Excel',
        description: 'Convert CSV data into a downloadable .xlsx workbook.',
        category: 'data',
        icon: 'XLS',
        keywords: ['csv', 'excel', 'xlsx', 'spreadsheet', 'convert', 'workbook', 'export'],
        toolClass: CsvToExcelTool,
    },
    {
        id: 'diff-checker',
        name: 'Text Diff',
        description: 'Compare two texts with real insert/delete detection and a unified diff export.',
        category: 'text',
        icon: '±',
        keywords: ['diff', 'compare', 'difference', 'text', 'merge', 'patch', 'changes', 'lcs'],
        toolClass: DiffCheckerTool,
    },
    {
        id: 'mermaid-viewer',
        name: 'Mermaid Viewer',
        description: 'Write Mermaid diagrams with a live preview and export to SVG or PNG.',
        category: 'image',
        icon: '◈',
        keywords: ['mermaid', 'diagram', 'flowchart', 'sequence', 'gantt', 'chart', 'uml', 'graph',
            'render', 'preview', 'export', 'svg', 'png'],
        toolClass: MermaidViewerTool,
    },
    {
        id: 'markdown-viewer',
        name: 'Markdown Reader',
        description: 'Open a .md file and read it rendered — tables, task lists, anchors and Mermaid diagrams.',
        category: 'web',
        icon: 'M↓',
        keywords: ['markdown', 'md', 'reader', 'viewer', 'render', 'preview', 'readme', 'file',
            'mermaid', 'toc', 'table of contents', 'gfm', 'github', 'docs', 'open', 'print', 'pdf'],
        toolClass: MarkdownViewerTool,
    },
    {
        id: 'servicebus-sender',
        name: 'Service Bus Publisher',
        description: 'Publish messages to an Azure Service Bus queue or topic using a connection string.',
        category: 'cloud',
        icon: '📤',
        keywords: ['azure', 'service bus', 'servicebus', 'publish', 'send', 'queue', 'topic',
            'message', 'broker', 'amqp', 'connection string'],
        toolClass: ServiceBusSenderTool,
    },
    {
        id: 'servicebus-listener',
        name: 'Service Bus Consumer',
        description: 'Receive and settle messages from an Azure Service Bus queue or subscription.',
        category: 'cloud',
        icon: '📥',
        keywords: ['azure', 'service bus', 'servicebus', 'consume', 'receive', 'listen', 'queue',
            'subscription', 'peek', 'lock', 'message', 'dead letter', 'connection string'],
        toolClass: ServiceBusListenerTool,
    },
];

const specTools = [
    ...aiTools,
    ...devxTools,
    ...devopsTools,
    ...securityTools,
    ...diagramTools,
    ...codegenTools,
    ...textTools,
    ...urlTools,
    ...webTools,
    ...dataTools,
    ...encodingTools,
    ...cryptoTools,
    ...generatorTools,
    ...miscTools,
    ...qrTools,
];

const sortTools = (tools) => [...tools].sort((a, b) => {
    const byCategory = (CATEGORIES[a.category]?.order ?? 99) - (CATEGORIES[b.category]?.order ?? 99);
    return byCategory || a.name.localeCompare(b.name);
});

/** Fail loudly in development rather than silently shadowing a tool. */
function validate(tools) {
    const seen = new Set();
    for (const tool of tools) {
        if (seen.has(tool.id)) console.error(`Duplicate tool id: ${tool.id}`);
        seen.add(tool.id);
        if (!CATEGORIES[tool.category]) console.error(`Tool ${tool.id} has unknown category "${tool.category}"`);
    }
    return tools;
}

export const TOOLS = validate(sortTools([...specTools, ...bespokeTools].map((tool) => ({ ...tool, enabled: true }))));

export const TOOL_BY_ID = new Map(TOOLS.map((tool) => [tool.id, tool]));

/**
 * The agent cards are data-driven (agents/index.json), so they are appended
 * after the manifest loads rather than being imported statically.
 */
export function withAgents(agentTools) {
    if (!agentTools.length) return TOOLS;
    const combined = validate(sortTools([...TOOLS, ...agentTools]));
    for (const tool of agentTools) TOOL_BY_ID.set(tool.id, tool);
    return combined;
}
