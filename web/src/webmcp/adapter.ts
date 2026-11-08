// The ONLY module that touches navigator.modelContext. WebMCP is in Chrome origin trial and its names may change,
// so every page registers tools through registerTools() and nothing else needs to know the browser API.

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: { readOnlyHint?: boolean };
  /** Update the page, then resolve with a JSON-serialisable result. Throw ToolError for an expected failure. */
  handler: (input: Record<string, unknown>) => Promise<unknown>;
}

/** An expected failure the agent should read, such as an ineligible pack or a missing form field. */
export class ToolError extends Error {}

interface ToolResult {
  content: { type: 'text'; text: string }[];
  isError?: boolean;
}

interface ModelContext {
  registerTool(tool: {
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
    annotations?: { readOnlyHint?: boolean };
    execute(input: Record<string, unknown>): Promise<ToolResult>;
  }): unknown;
  unregisterTool?(name: string): unknown;
}

export interface AdapterEnv {
  navigator: Navigator;
  window: Window;
}

/** Resolve after the browser has painted, so a change the tool made is on screen before the tool returns (R-08). */
export function afterPaint(win: Window = window): Promise<void> {
  return new Promise((resolve) => win.requestAnimationFrame(() => win.requestAnimationFrame(() => resolve())));
}

function text(value: unknown, isError = false): ToolResult {
  const result: ToolResult = { content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) }] };
  if (isError) result.isError = true;
  return result;
}

/**
 * Register page tools with the browser's agent. Does nothing (and never throws) when the browser has no
 * WebMCP support (R-09) or when the page is framed, so only top-level first-party pages expose tools.
 * Returns a function that unregisters the tools; they are also unregistered when the page is hidden.
 */
export function registerTools(
  tools: ToolDefinition[],
  env: AdapterEnv = { navigator, window },
): () => void {
  const { navigator: nav, window: win } = env;
  if (!('modelContext' in nav) || win.top !== win.self) return () => {};
  const modelContext = (nav as Navigator & { modelContext: ModelContext }).modelContext;

  const registered: string[] = [];
  for (const tool of tools) {
    try {
      modelContext.registerTool({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
        annotations: tool.annotations,
        async execute(input) {
          try {
            const result = await tool.handler(input ?? {});
            await afterPaint(win);
            return text(result);
          } catch (err) {
            await afterPaint(win);
            if (err instanceof ToolError || (err instanceof Error && err.name === 'ApiError')) return text(err.message, true);
            console.error(`WebMCP tool ${tool.name} failed`, err);
            return text(`The ${tool.name} tool failed unexpectedly. Ask the customer to use the page directly.`, true);
          }
        },
      });
      registered.push(tool.name);
    } catch (err) {
      console.warn(`WebMCP: could not register ${tool.name}`, err);
    }
  }

  const unregister = () => {
    for (const name of registered.splice(0)) {
      try {
        modelContext.unregisterTool?.(name);
      } catch {
        // The page is going away; nothing useful to do.
      }
    }
  };
  win.addEventListener('pagehide', unregister, { once: true });
  return unregister;
}
