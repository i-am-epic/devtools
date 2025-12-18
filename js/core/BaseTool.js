// Base Tool interface (Interface Segregation Principle)
export class BaseTool {
    constructor(config) {
        this.id = config.id;
        this.name = config.name;
        this.description = config.description;
        this.category = config.category;
        this.enabled = config.enabled;
        this.icon = config.icon;
    }

    // Template method pattern
    render() {
        throw new Error('render() must be implemented by subclass');
    }

    // Hook methods
    onOpen() {}
    onClose() {}
    validate() { return true; }
}
