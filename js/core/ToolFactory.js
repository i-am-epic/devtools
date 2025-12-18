// Factory Pattern (Open/Closed Principle - open for extension, closed for modification)
import { JsonBeautifierTool } from '../tools/JsonBeautifierTool.js';
import { GuidGeneratorTool } from '../tools/GuidGeneratorTool.js';
import { Sha256Tool } from '../tools/Sha256Tool.js';
import { Base64Tool } from '../tools/Base64Tool.js';
import { DiffCheckerTool } from '../tools/DiffCheckerTool.js';
import { ServiceBusSenderTool } from '../tools/ServiceBusSenderTool.js';
import { ServiceBusListenerTool } from '../tools/ServiceBusListenerTool.js';
import { CsvToExcelTool } from '../tools/CsvToExcelTool.js';
import { MermaidViewerTool } from '../tools/MermaidViewerTool.js';
import { ParquetViewerTool } from '../tools/ParquetViewerTool.js';
import { PlaceholderTool } from '../tools/PlaceholderTool.js';

export class ToolFactory {
    constructor() {
        this.toolRegistry = new Map([
            ['json-beautifier', JsonBeautifierTool],
            ['guid-generator', GuidGeneratorTool],
            ['sha256-hash', Sha256Tool],
            ['base64-encoder', Base64Tool],
            ['diff-checker', DiffCheckerTool],
            ['servicebus-sender', ServiceBusSenderTool],
            ['servicebus-listener', ServiceBusListenerTool],
            ['csv-to-excel', CsvToExcelTool],
            ['mermaid-viewer', MermaidViewerTool],
            ['parquet-viewer', ParquetViewerTool]
        ]);
    }

    // Register new tool class (extensibility)
    register(toolId, toolClass) {
        this.toolRegistry.set(toolId, toolClass);
    }

    // Create tool instance
    create(config) {
        const ToolClass = this.toolRegistry.get(config.id);
        
        if (!ToolClass) {
            // Return placeholder for unimplemented tools
            return new PlaceholderTool(config);
        }

        return new ToolClass(config);
    }
}
