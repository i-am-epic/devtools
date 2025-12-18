// Search Service (Single Responsibility Principle)
export class SearchService {
    constructor() {
        this.tools = [];
    }

    setTools(tools) {
        this.tools = tools;
    }

    search(query) {
        if (!query || query.trim() === '') {
            return this.tools;
        }

        const lowerQuery = query.toLowerCase();
        
        return this.tools.filter(tool => {
            return (
                tool.name.toLowerCase().includes(lowerQuery) ||
                tool.description.toLowerCase().includes(lowerQuery) ||
                tool.category.toLowerCase().includes(lowerQuery) ||
                tool.id.toLowerCase().includes(lowerQuery)
            );
        });
    }
}
