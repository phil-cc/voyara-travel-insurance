// Test double for the WebMCP browser API. Injected with page.addInitScript, so it must be self-contained.
// It records registered tools and exposes window.__webmcp.invoke(name, args) to play the in-browser agent.

export interface FakeToolResult {
  content: { type: 'text'; text: string }[];
  isError?: boolean;
}

export interface FakeWebMcp {
  names(): string[];
  describe(name: string): { description: string; inputSchema: unknown } | undefined;
  invoke(name: string, args?: Record<string, unknown>): Promise<FakeToolResult>;
}

export function installFakeModelContext(): void {
  type Tool = { name: string; description: string; inputSchema: unknown; execute(args: Record<string, unknown>): Promise<FakeToolResult> };
  const tools = new Map<string, Tool>();
  Object.defineProperty(navigator, 'modelContext', {
    configurable: true,
    value: {
      registerTool(tool: Tool) {
        if (tools.has(tool.name)) throw new Error(`Duplicate tool ${tool.name}`);
        tools.set(tool.name, tool);
      },
      unregisterTool(name: string) {
        tools.delete(name);
      },
    },
  });
  const api: FakeWebMcp = {
    names: () => [...tools.keys()],
    describe: (name) => {
      const t = tools.get(name);
      return t && { description: t.description, inputSchema: t.inputSchema };
    },
    invoke: async (name, args = {}) => {
      const tool = tools.get(name);
      if (!tool) throw new Error(`Tool ${name} is not registered on this page`);
      return tool.execute(args);
    },
  };
  (window as unknown as { __webmcp: FakeWebMcp }).__webmcp = api;
}
