import { describe, expect, it, vi } from 'vitest';
import { registerTools, ToolError, type AdapterEnv, type ToolDefinition } from '../../src/webmcp/adapter';

type Registered = { name: string; execute(input: Record<string, unknown>): Promise<{ content: { text: string }[]; isError?: boolean }> };

function fakeWindow(framed = false) {
  const target = new EventTarget();
  const win: Record<string, unknown> = {
    addEventListener: target.addEventListener.bind(target),
    dispatchEvent: target.dispatchEvent.bind(target),
    requestAnimationFrame: (cb: FrameRequestCallback) => setTimeout(() => cb(0), 0),
  };
  win.self = win;
  win.top = framed ? {} : win;
  return win as unknown as Window;
}

function fakeEnv({ withModelContext = true, framed = false } = {}) {
  const registered = new Map<string, Registered>();
  const modelContext = {
    registerTool: vi.fn((t: Registered) => void registered.set(t.name, t)),
    unregisterTool: vi.fn((name: string) => void registered.delete(name)),
  };
  const navigator = (withModelContext ? { modelContext } : {}) as unknown as Navigator;
  const window = fakeWindow(framed);
  return { env: { navigator, window } as AdapterEnv, registered, modelContext, window };
}

const tool = (handler: ToolDefinition['handler']): ToolDefinition => ({
  name: 'demo',
  description: 'Demo tool',
  inputSchema: { type: 'object', properties: {} },
  handler,
});

describe('registerTools', () => {
  it('does nothing and throws nothing without navigator.modelContext (R-09)', () => {
    const { env } = fakeEnv({ withModelContext: false });
    const handler = vi.fn();
    expect(() => registerTools([tool(handler)], env)()).not.toThrow();
    expect(handler).not.toHaveBeenCalled();
  });

  it('does not register tools inside a frame', () => {
    const { env, modelContext } = fakeEnv({ framed: true });
    registerTools([tool(async () => 'ok')], env);
    expect(modelContext.registerTool).not.toHaveBeenCalled();
  });

  it('returns handler results as JSON text content', async () => {
    const { env, registered } = fakeEnv();
    registerTools([tool(async (input) => ({ echoed: input.value }))], env);
    const result = await registered.get('demo')!.execute({ value: 42 });
    expect(result.isError).toBeUndefined();
    expect(JSON.parse(result.content[0].text)).toEqual({ echoed: 42 });
  });

  it('turns ToolError into an error result the agent can read', async () => {
    const { env, registered } = fakeEnv();
    registerTools([tool(async () => { throw new ToolError('Gadget Pack requires Comprehensive or above'); })], env);
    const result = await registered.get('demo')!.execute({});
    expect(result).toEqual({ content: [{ type: 'text', text: 'Gadget Pack requires Comprehensive or above' }], isError: true });
  });

  it('hides unexpected error details from the agent', async () => {
    const { env, registered } = fakeEnv();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    registerTools([tool(async () => { throw new TypeError('secret internals'); })], env);
    const result = await registered.get('demo')!.execute({});
    expect(result.isError).toBe(true);
    expect(result.content[0].text).not.toContain('secret internals');
  });

  it('unregisters tools on pagehide', () => {
    const { env, registered, window } = fakeEnv();
    registerTools([tool(async () => 'ok')], env);
    expect(registered.size).toBe(1);
    window.dispatchEvent(new Event('pagehide'));
    expect(registered.size).toBe(0);
  });
});
