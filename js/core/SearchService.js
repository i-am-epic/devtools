// Ranked search across tool names, descriptions and keywords.
//
// Ranking matters here: typing "md5" should surface the Hash Generator even
// though the word never appears in its name.

export class SearchService {
    constructor() {
        this.tools = [];
    }

    setTools(tools) {
        this.tools = tools.map((tool) => ({
            tool,
            name: tool.name.toLowerCase(),
            nameWords: tool.name.toLowerCase().split(/[^a-z0-9+#.]+/).filter(Boolean),
            description: tool.description.toLowerCase(),
            id: tool.id.toLowerCase(),
            keywords: (tool.keywords || []).map((k) => k.toLowerCase()),
            category: tool.category.toLowerCase(),
        }));
    }

    search(query) {
        const trimmed = query.trim().toLowerCase();
        if (!trimmed) return this.tools.map((entry) => entry.tool);

        const terms = trimmed.split(/\s+/);
        const scored = [];

        for (const entry of this.tools) {
            let score = 0;
            let matchedAll = true;

            for (const term of terms) {
                let best = 0;

                if (entry.name === term) best = 100;
                else if (entry.name.startsWith(term)) best = 70;
                // A whole word in the name beats an exact keyword hit, so
                // "token" finds the LLM Token Counter before the JWT Signer.
                else if (entry.nameWords.includes(term)) best = 65;
                else if (entry.name.includes(term)) best = 50;

                if (entry.keywords.some((k) => k === term)) best = Math.max(best, 60);
                else if (entry.keywords.some((k) => k.startsWith(term))) best = Math.max(best, 40);
                else if (entry.keywords.some((k) => k.includes(term))) best = Math.max(best, 25);

                if (entry.id.includes(term)) best = Math.max(best, 35);
                if (entry.description.includes(term)) best = Math.max(best, 15);
                if (entry.category.includes(term)) best = Math.max(best, 12);

                if (best === 0) { matchedAll = false; break; }
                score += best;
            }

            if (matchedAll) scored.push({ tool: entry.tool, score });
        }

        return scored
            .sort((a, b) => b.score - a.score || a.tool.name.localeCompare(b.tool.name))
            .map((entry) => entry.tool);
    }
}
