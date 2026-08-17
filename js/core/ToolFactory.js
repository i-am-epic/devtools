// Creates a tool instance from its registry entry.
//
// Entries carrying a `spec` are rendered by the generic SimpleTool engine;
// entries carrying a `toolClass` get their bespoke implementation.

import { SimpleTool } from './SimpleTool.js';

export class ToolFactory {
    constructor() {
        this.overrides = new Map();
    }

    /** Replace the implementation for a tool id (used by tests and plugins). */
    register(toolId, toolClass) {
        this.overrides.set(toolId, toolClass);
    }

    create(config) {
        const Override = this.overrides.get(config.id);
        if (Override) return new Override(config);
        if (config.toolClass) return new config.toolClass(config);
        if (config.spec) return new SimpleTool(config, config.spec);

        throw new Error(
            `Tool "${config.id}" has neither a spec nor a toolClass. `
            + 'Every entry in js/tools/registry.js must have one of the two.',
        );
    }
}
