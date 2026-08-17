// Supplies the tool catalogue.
//
// The catalogue lives in js/tools/registry.js rather than a JSON file, so a
// tool cannot appear on the page without a working implementation behind it.
// The agent cards are the one data-driven part: they come from
// agents/index.json, which scripts/build_agents.py generates.

import { TOOLS, CATEGORIES, TOOL_BY_ID, withAgents } from '../tools/registry.js';
import { loadAgentTools } from '../tools/AgentTool.js';

export class ConfigManager {
    async load() {
        const agents = await loadAgentTools();
        this.tools = withAgents(agents);
        this.categories = { ...CATEGORIES };

        // Hide the agents category entirely when no manifest is present.
        if (!agents.length) delete this.categories.agents;

        return { tools: this.tools, categories: this.categories };
    }

    getTools() { return this.tools || TOOLS; }
    getAllTools() { return this.getTools(); }
    getEnabledTools() { return this.getTools(); }
    getCategories() { return this.categories || CATEGORIES; }
    getTool(id) { return TOOL_BY_ID.get(id); }
}
