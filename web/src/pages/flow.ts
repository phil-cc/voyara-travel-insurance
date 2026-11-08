// The /flow walkthrough: steps through the MCP and WebMCP channels with real requests, animating each message
// between the parts of the system and logging exactly what went over the wire.
import { api, PACK_NAMES, TIER_NAMES, TIERS, type Pack, type Quote, type Tier } from '../api';
import { $, flash, money } from '../ui';
import { registerTools, ToolError, type ToolDefinition } from '../webmcp/adapter';

type NodeId = 'customer' | 'agent' | 'mcp' | 'service' | 'bagent' | 'modelctx' | 'page' | 'api';
type Kind = 'req' | 'res' | 'local';
type Hop = { from: NodeId; to: NodeId; kind: Kind; label: string } | 'wait';
type TourId = 'mcp' | 'webmcp' | 'both';

interface Step {
  title: string;
  body: string;
  code: string;
  hops: Hop[];
  run?: () => Promise<void>;
  /** What the model sees for this step, built from the live data after the step runs. */
  model?: () => ModelView;
}

interface ModelView {
  note: string;
  blocks: { label: string; value: unknown }[];
}

interface Tour {
  screenTitle: string;
  focus: NodeId[];
  steps: Step[];
  renderScreen(): void;
}

interface WireEntry {
  kind: 'http' | 'webmcp';
  summary: string;
  request: unknown;
  response: unknown;
}

const MCP_NODES: NodeId[] = ['customer', 'agent', 'mcp', 'service'];
const WEBMCP_NODES: NodeId[] = ['customer', 'bagent', 'modelctx', 'page', 'api', 'service'];
const LINKS: [NodeId, NodeId][] = [
  ['customer', 'agent'], ['agent', 'mcp'], ['mcp', 'service'],
  ['customer', 'bagent'], ['bagent', 'modelctx'], ['modelctx', 'page'], ['page', 'api'], ['api', 'service'],
];
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

// Trips used by the tours. Dates are relative to today so they never fall in the past.
function isoInDays(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toLocaleDateString('en-CA');
}
const NEPAL = { start_date: isoInDays(150), end_date: isoInDays(170), traveller_ages: [27] };
const JAPAN = { destination: 'Japan', start_date: isoInDays(70), end_date: isoInDays(80), traveller_ages: [42, 40, 10, 8] };

// -- wire log: records every /api and /mcp request made during a step ---------

let wire: WireEntry[] = [];
let serverDown = false;
const realFetch = window.fetch.bind(window);

window.fetch = async (input: RequestInfo | URL, init: RequestInit = {}) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const watched = url.startsWith('/api') || url.startsWith('/mcp');
  let res: Response;
  try {
    res = await realFetch(input, init);
  } catch (err) {
    if (watched) serverDown = true;
    throw err;
  }
  if (!watched) return res;
  if (res.status >= 500) serverDown = true;
  const method = init.method ?? 'GET';
  const request = typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
  const headers: Record<string, string> = {};
  new Headers(init.headers).forEach((value, key) => {
    if (key !== 'content-type') headers[key] = value;
  });
  const response = await res.clone().json().catch(() => '(no body)');
  const rpc = request as { method?: string; params?: { name?: string; uri?: string } } | undefined;
  const rpcLabel = url.startsWith('/mcp') && rpc?.method ? `  ${rpc.method}${rpc.params?.name ? ` ${rpc.params.name}` : ''}${rpc.params?.uri ? ` ${rpc.params.uri}` : ''}` : '';
  wire.push({
    kind: 'http',
    summary: `${method} ${url}${rpcLabel}  →  HTTP ${res.status}`,
    request: { headers, ...(request === undefined ? {} : { body: request }) },
    response,
  });
  return res;
};

// -- a minimal MCP client: JSON-RPC 2.0 over HTTP POST (Streamable HTTP, stateless, JSON responses) -----------

let rpcId = 0;
let protocolVersion = '2025-06-18';

async function rpc<T = Record<string, unknown>>(method: string, params?: Record<string, unknown>, notification = false): Promise<T> {
  const message = { jsonrpc: '2.0', ...(notification ? {} : { id: ++rpcId }), method, ...(params ? { params } : {}) };
  const res = await fetch('/mcp', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      'mcp-protocol-version': protocolVersion,
    },
    body: JSON.stringify(message),
  });
  if (!res.ok) throw new Error(`The MCP server returned HTTP ${res.status}.`);
  if (notification) return undefined as T;
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  return data.result as T;
}

interface ToolCallRecord {
  name: string;
  input: Record<string, unknown>;
  transport: unknown;
  result: { content: { type?: string; text: string }[]; isError?: boolean };
}
let lastMcpCall: ToolCallRecord | null = null;

async function callTool<T = Record<string, unknown>>(name: string, args: Record<string, unknown>): Promise<T> {
  const result = await rpc<{ isError?: boolean; content: { text: string }[]; structuredContent?: T }>('tools/call', { name, arguments: args });
  lastMcpCall = {
    name,
    input: args,
    transport: { jsonrpc: '2.0', id: rpcId, method: 'tools/call', params: { name, arguments: args } },
    result,
  };
  if (result.isError) throw new Error(result.content[0]?.text ?? `${name} failed`);
  return result.structuredContent ?? (JSON.parse(result.content[0].text) as T);
}

// -- diagram and animation -------------------------------------------------------------------------------------

const stage = $('#stage');
const wires = $('#wires') as unknown as SVGSVGElement;
const nodeEl = (id: NodeId) => $(`[data-node="${id}"]`, stage);

function center(id: NodeId) {
  const s = stage.getBoundingClientRect();
  const r = nodeEl(id).getBoundingClientRect();
  return { x: r.left - s.left + r.width / 2, y: r.top - s.top + r.height / 2 };
}

function drawWires() {
  wires.replaceChildren(
    ...LINKS.map(([a, b]) => {
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      const p = center(a);
      const q = center(b);
      line.setAttribute('x1', String(p.x));
      line.setAttribute('y1', String(p.y));
      line.setAttribute('x2', String(q.x));
      line.setAttribute('y2', String(q.y));
      line.dataset.link = [a, b].sort().join('-');
      if (tour && !(tour.focus.includes(a) && tour.focus.includes(b))) line.classList.add('dim');
      return line;
    }),
  );
}
new ResizeObserver(drawWires).observe(stage);

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function travel(hop: Exclude<Hop, 'wait'>): Promise<void> {
  const from = nodeEl(hop.from);
  const to = nodeEl(hop.to);
  const line = wires.querySelector(`[data-link="${[hop.from, hop.to].sort().join('-')}"]`);
  from.classList.add('active');
  to.classList.add('active');
  line?.classList.add('hot');

  const packet = document.createElement('div');
  packet.className = `packet ${hop.kind}`;
  packet.textContent = hop.label;
  stage.append(packet);
  const w = packet.offsetWidth;
  const h = packet.offsetHeight;
  const a = center(hop.from);
  const b = center(hop.to);
  const at = (p: { x: number; y: number }) => `translate(${p.x - w / 2}px, ${p.y - h / 2}px)`;

  if (reducedMotion.matches) {
    packet.style.transform = at({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
    await sleep(700);
  } else {
    const distance = Math.hypot(b.x - a.x, b.y - a.y);
    await packet.animate(
      [
        { transform: at(a), opacity: 0 },
        { opacity: 1, offset: 0.12 },
        { opacity: 1, offset: 0.88 },
        { transform: at(b), opacity: 0 },
      ],
      { duration: 1500 + distance * 3, easing: 'cubic-bezier(.45,0,.25,1)' },
    ).finished;
    await sleep(300); // a beat between hops so each message can be read
  }
  packet.remove();
  from.classList.remove('active');
  to.classList.remove('active');
  line?.classList.remove('hot');
}

// -- simulated WebMCP browser API ------------------------------------------------------------------------------
// The real adapter (adapter.ts) registers the tools. It is handed this stand-in for navigator.modelContext, so the
// walkthrough works in any browser and its tools stay invisible to a real browser agent.

interface RegisteredTool {
  name: string;
  description: string;
  inputSchema: unknown;
  annotations?: unknown;
  execute(input: Record<string, unknown>): Promise<{ content: { text: string }[]; isError?: boolean }>;
}

const browserTools = new Map<string, RegisteredTool>();
const simulatedModelContext = {
  registerTool(tool: RegisteredTool) {
    browserTools.set(tool.name, tool);
    const { execute: _execute, ...definition } = tool;
    wire.push({ kind: 'webmcp', summary: `navigator.modelContext.registerTool("${tool.name}")`, request: definition, response: '(returns nothing)' });
  },
  unregisterTool(name: string) {
    browserTools.delete(name);
    wire.push({ kind: 'webmcp', summary: `navigator.modelContext.unregisterTool("${name}")`, request: { name }, response: '(returns nothing)' });
  },
};
const simulatedEnv = { navigator: { modelContext: simulatedModelContext } as unknown as Navigator, window };

let lastBrowserCall: ToolCallRecord | null = null;

// -- what the model sees -----------------------------------------------------------------------------------------
// The model never speaks MCP or WebMCP. The agent (the client) translates: tool definitions become entries in the
// model request's `tools` list, the model's `tool_use` block becomes a tools/call or execute(), and the result goes
// back as a `tool_result`. These payloads follow the Anthropic Messages API format and are illustrative; the MCP and
// WebMCP payloads they wrap are the real ones from this run.

const MODEL = 'claude-opus-5-5';
const MCP_PREFIX = 'mcp__voyara__';
const CLIENT_PROMPT = "You are Claude, an AI assistant. [The client's own instructions: tone, safety rules, how to use tools.]";

function toolUseId(name: string): string {
  let h = 0;
  for (const c of name + Date.now()) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return `toolu_01${h.toString(36).padStart(8, '0')}Demo`;
}

function toModelTool(prefix: string, t: { name: string; description: string; inputSchema: unknown }) {
  return { name: `${prefix}${t.name}`, description: t.description, input_schema: t.inputSchema };
}

function toolRoundTrip(prefix: string, call: ToolCallRecord | null, transportLabel: string, resultLabel: string): ModelView {
  if (!call) return { note: 'No tool call in this step.', blocks: [] };
  const id = toolUseId(call.name);
  return {
    note: `Parameters in: the model writes a tool_use block. The agent ${prefix ? `strips the "${prefix}" prefix and ` : ''}passes the model's "input" through unchanged as the tool's ${prefix ? '"arguments"' : 'input'}. Parameters out: the agent copies the result's "content" into a tool_result with the same tool_use_id, so the model can match the answer to its call.`,
    blocks: [
      { label: '1. Model output (assistant message): tool_use', value: { role: 'assistant', content: [{ type: 'tool_use', id, name: `${prefix}${call.name}`, input: call.input }] } },
      { label: `2. Agent unwraps it: ${transportLabel}`, value: call.transport },
      { label: `3. Tool returns: ${resultLabel}`, value: call.result },
      {
        label: '4. Agent hands it back to the model (next user message): tool_result',
        value: {
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: id, content: call.result.content.map((c) => ({ type: 'text', text: c.text })), ...(call.result.isError ? { is_error: true } : {}) }],
        },
      },
    ],
  };
}

/** Call a page tool the way the browser's agent does. Returns the parsed result text. */
async function browserAgentCalls<T = Record<string, unknown>>(name: string, input: Record<string, unknown> = {}): Promise<T> {
  const tool = browserTools.get(name);
  if (!tool) throw new Error(`${name} is not registered on the page that is open`);
  const result = await tool.execute(input);
  lastBrowserCall = { name, input, transport: { call: `tools.get("${name}").execute(input)`, input }, result };
  wire.push({ kind: 'webmcp', summary: `tool.execute()  ${name}${result.isError ? '  (isError)' : ''}`, request: input, response: result });
  if (result.isError) throw new Error(result.content[0].text);
  return JSON.parse(result.content[0].text) as T;
}

// -- page state and screens ------------------------------------------------------------------------------------

const screen = $('#screen');

function chatScreen(bubbles: { who: 'user' | 'bot' | 'tool'; html: string }[]) {
  screen.replaceChildren();
  const chat = document.createElement('div');
  chat.className = 'chat';
  if (bubbles.length === 0) chat.innerHTML = '<p class="bubble tool">The conversation appears here.</p>';
  for (const b of bubbles) {
    const el = document.createElement('div');
    el.className = `bubble ${b.who}`;
    el.innerHTML = b.html;
    chat.append(el);
  }
  screen.append(chat);
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const quoteSummary = (q: Quote) => ({ tier: q.tier, quote_id: q.quote_id, premium_total: q.premium.total, excess: q.excess, packs: q.packs });

// -- tour 1: MCP -----------------------------------------------------------------------------------------------

function mcpTour(): Tour {
  const chat: { who: 'user' | 'bot' | 'tool'; html: string }[] = [];
  let recommended: { recommended_tier: Tier; packs: Pack[] } | null = null;
  let quote: Quote | null = null;
  let instructions = '';
  let tools: { name: string; description: string; inputSchema: unknown; annotations?: unknown }[] = [];
  let pdsText = '';
  let finalAnswer = '';
  const question = "I'm going to Nepal for three weeks to trek to Everest Base Camp. I'm 27. What travel insurance do I need?";
  const systemPrompt = () =>
    `${CLIENT_PROMPT}\n\n# MCP Server Instructions\n\nThe following MCP servers have provided instructions for how to use their tools and resources:\n\n## voyara\n${instructions}`;
  const show = () => chatScreen(chat);
  const toolBubble = (text: string) => chat.push({ who: 'tool', html: esc(text) });

  return {
    screenTitle: "Customer's chat with Claude",
    focus: MCP_NODES,
    renderScreen: show,
    steps: [
      {
        title: 'The customer asks Claude a question',
        body: `<p>The customer never visits Voyara. They ask their assistant, and the assistant decides it needs Voyara's tools.</p>
          <p>Claude knows about Voyara because someone added the server once: <code>claude mcp add --transport http voyara http://localhost:8000/mcp</code>. From then on Claude is an <strong>MCP client</strong> and Voyara is an <strong>MCP server</strong>.</p>`,
        code: 'README.md, "Connect an MCP client"',
        hops: [{ from: 'customer', to: 'agent', kind: 'req', label: 'question' }],
        async run() {
          chat.push({ who: 'user', html: esc(question) });
          show();
        },
        model: () => ({
          note: 'The model only ever receives one request shape: a system prompt, a list of tools and the conversation so far. The next two steps show where the system prompt and the tools come from. Nothing about Voyara is in the model yet.',
          blocks: [
            { label: 'Model request (skeleton)', value: { model: MODEL, max_tokens: 4096, system: '(built in step 2 from the client prompt and the server instructions)', tools: '(built in step 3 from tools/list)', messages: [{ role: 'user', content: question }] } },
          ],
        }),
      },
      {
        title: 'Handshake: initialize',
        body: `<p>MCP messages are <strong>JSON-RPC 2.0</strong> sent as HTTP POSTs to one URL, <code>/mcp</code> (the "Streamable HTTP" transport).</p>
          <p>The client opens with <code>initialize</code>: its name and the protocol version it speaks. The server answers with its name, what it offers (tools, resources, prompts) and <strong>instructions</strong>, the rules the model must follow: show the disclosure with every price, and never claim it can buy a policy.</p>
          <p>The client confirms with <code>notifications/initialized</code>. A notification has no <code>id</code>, so there is no reply, just HTTP 202. This server runs <em>stateless</em>, so no session ID comes back and every later POST stands on its own.</p>`,
        code: 'server/src/voyara/app.py (stateless_http=True, json_response=True) · mcp_server.py INSTRUCTIONS',
        hops: [{ from: 'agent', to: 'mcp', kind: 'req', label: 'initialize' }, 'wait', { from: 'mcp', to: 'agent', kind: 'res', label: 'serverInfo + instructions' }],
        async run() {
          const result = await rpc<{ protocolVersion: string }>('initialize', {
            protocolVersion,
            capabilities: {},
            clientInfo: { name: 'voyara-flow-walkthrough', version: '1.0.0' },
          });
          protocolVersion = result.protocolVersion;
          instructions = String((result as { instructions?: string }).instructions ?? '');
          await rpc('notifications/initialized', undefined, true);
          toolBubble('Connected to Voyara Travel Insurance');
          show();
        },
        model: () => ({
          note: "The server's instructions are not sent to the model as a message. The client pastes them into the system prompt under a heading per server. This is how the model learns the rules for this server before it sees a single tool: show the disclosure with every price, recommendations are general advice, it cannot buy a policy.",
          blocks: [
            { label: 'From the server: initialize result.instructions', value: instructions },
            { label: 'Into the model request: system', value: systemPrompt() },
          ],
        }),
      },
      {
        title: 'Discovery: tools/list',
        body: `<p>Next the client asks what the server can do. <code>tools/list</code> returns nine tools. Each has a name, a plain-English description the model reads, and a <strong>JSON Schema</strong> for its arguments.</p>
          <p>Nobody wrote that schema by hand. The MCP SDK builds it from the Python type hints, so <code>Age = Annotated[int, Field(ge=0, le=120)]</code> becomes <code>"minimum": 0, "maximum": 120</code>.</p>
          <p><strong>Annotations</strong> tell the client how risky a tool is. <code>readOnlyHint: true</code> means it changes nothing, so a client can call it without asking the customer first.</p>`,
        code: 'server/src/voyara/mcp_server.py (@mcp.tool, READ_ONLY, WRITES)',
        hops: [{ from: 'agent', to: 'mcp', kind: 'req', label: 'tools/list' }, 'wait', { from: 'mcp', to: 'agent', kind: 'res', label: '9 tools + schemas' }],
        async run() {
          tools = (await rpc<{ tools: typeof tools }>('tools/list')).tools;
          toolBubble(`Found ${tools.length} tools: ${tools.map((t) => t.name).join(', ')}`);
          show();
        },
        model: () => {
          const sample = tools.find((t) => t.name === 'check_eligibility') ?? tools[0];
          return {
            note: `Each MCP tool becomes one entry in the model's "tools" list. The client renames it with a server prefix ("${MCP_PREFIX}") so tools from different servers cannot clash, and renames inputSchema to input_schema. The description and schema are the model's only guide to the parameters, so they must say what each one means, its units and its limits. Annotations stay with the client: they decide whether to ask the customer first, and are not shown to the model.`,
            blocks: [
              { label: 'From the server: one tools/list entry', value: sample },
              { label: 'Into the model request: the same tool', value: sample && toModelTool(MCP_PREFIX, sample) },
              {
                label: 'The full model request now',
                value: {
                  model: MODEL,
                  max_tokens: 4096,
                  system: systemPrompt(),
                  tools: tools.map((t) => (t === sample ? toModelTool(MCP_PREFIX, t) : { name: `${MCP_PREFIX}${t.name}`, description: t.description, input_schema: '(schema)' })),
                  messages: [{ role: 'user', content: question }],
                },
              },
            ],
          };
        },
      },
      {
        title: 'tools/call: check_eligibility',
        body: `<p>Claude calls its first tool. A tool call is a <code>tools/call</code> request with the tool <code>name</code> and an <code>arguments</code> object.</p>
          <p>The SDK checks the arguments against the schema <em>before</em> any Voyara code runs. An age of 130 would be rejected right there. Then the tool hands the work to the same rules module the website uses.</p>
          <p>The result comes back twice: as <code>content</code> text (for models that only read text) and as <code>structuredContent</code> (JSON a client can use directly).</p>`,
        code: 'mcp_server.py check_eligibility → rules.py check_eligibility',
        hops: [
          { from: 'agent', to: 'mcp', kind: 'req', label: 'tools/call check_eligibility' },
          { from: 'mcp', to: 'service', kind: 'req', label: 'rules.check_eligibility([27])' },
          'wait',
          { from: 'service', to: 'mcp', kind: 'res', label: 'all 4 tiers eligible' },
          { from: 'mcp', to: 'agent', kind: 'res', label: 'result' },
        ],
        async run() {
          const r = await callTool<{ eligible_tiers: Tier[] }>('check_eligibility', { traveller_ages: NEPAL.traveller_ages, destination_region: 'asia' });
          toolBubble(`check_eligibility → eligible: ${r.eligible_tiers.join(', ')}`);
          show();
        },
        model: () => toolRoundTrip(MCP_PREFIX, lastMcpCall, 'JSON-RPC tools/call to /mcp', 'CallToolResult'),
      },
      {
        title: 'tools/call: recommend_tier',
        body: `<p>Trekking is an adventure activity, so Claude asks which tier and packs cover it. The tool matches trip features to product rules and returns the lowest tier that fits, plus the reasons.</p>
          <p>Every recommendation carries a <code>note</code> saying it is <strong>general advice only</strong>. Australian rules require it, so the server puts it in the data rather than trusting the model to remember.</p>`,
        code: 'mcp_server.py recommend_tier → rules.py recommend_tier',
        hops: [
          { from: 'agent', to: 'mcp', kind: 'req', label: 'tools/call recommend_tier' },
          { from: 'mcp', to: 'service', kind: 'req', label: 'rules.recommend_tier(...)' },
          'wait',
          { from: 'service', to: 'mcp', kind: 'res', label: 'tier + packs + rationale' },
          { from: 'mcp', to: 'agent', kind: 'res', label: 'result' },
        ],
        async run() {
          const r = await callTool<{ recommended_tier: Tier; packs: Pack[] }>('recommend_tier', {
            activities: ['trekking'], trip_cost: 4500, cruise: false, rental_car: false, ages: NEPAL.traveller_ages, max_trek_altitude_m: 5364,
          });
          recommended = r;
          toolBubble(`recommend_tier → ${r.recommended_tier} + ${r.packs.join(', ')}`);
          show();
        },
        model: () => toolRoundTrip(MCP_PREFIX, lastMcpCall, 'JSON-RPC tools/call to /mcp', 'CallToolResult'),
      },
      {
        title: 'tools/call: create_quote',
        body: `<p>Now Claude prices the trip. <code>create_quote</code> is marked as a write (<code>readOnlyHint: false</code>) because it saves a quote, valid for 7 days.</p>
          <p>The tool calls <strong>QuoteService</strong>, the same object behind the website. The quote records <code>channel: "mcp"</code> and the client's name from <code>initialize</code>, so Voyara can audit where it came from.</p>
          <p>Every price includes a <code>disclosure</code> block with the general advice warning and the PDS and TMD links.</p>`,
        code: 'mcp_server.py create_quote → quotes.py QuoteService.create_quote → pricing.py',
        hops: [
          { from: 'agent', to: 'mcp', kind: 'req', label: 'tools/call create_quote' },
          { from: 'mcp', to: 'service', kind: 'req', label: 'QuoteService.create_quote' },
          'wait',
          { from: 'service', to: 'mcp', kind: 'res', label: 'quote + premium + disclosure' },
          { from: 'mcp', to: 'agent', kind: 'res', label: 'result' },
        ],
        async run() {
          quote = await callTool<Quote>('create_quote', {
            destination_region: 'asia', start_date: NEPAL.start_date, end_date: NEPAL.end_date, traveller_ages: NEPAL.traveller_ages,
            tier: recommended?.recommended_tier ?? 'comprehensive', packs: recommended?.packs ?? ['adventure'],
          });
          toolBubble(`create_quote → ${quote.quote_id}, ${money(quote.premium.total)}`);
          show();
        },
        model: () => toolRoundTrip(MCP_PREFIX, lastMcpCall, 'JSON-RPC tools/call to /mcp', 'CallToolResult'),
      },
      {
        title: 'resources/read: the PDS',
        body: `<p>Tools <em>do</em> things. <strong>Resources</strong> are documents the client can read into the model's context, addressed by URI.</p>
          <p>Before answering, Claude reads the Product Disclosure Statement extract for the quoted tier from <code>voyara://pds/{tier}</code>, so its explanation quotes the real wording rather than a guess.</p>`,
        code: 'mcp_server.py @mcp.resource("voyara://pds/{tier}")',
        hops: [
          { from: 'agent', to: 'mcp', kind: 'req', label: 'resources/read' },
          { from: 'mcp', to: 'service', kind: 'req', label: 'catalogue PDS text' },
          'wait',
          { from: 'service', to: 'mcp', kind: 'res', label: 'text' },
          { from: 'mcp', to: 'agent', kind: 'res', label: 'PDS extract' },
        ],
        async run() {
          const read = await rpc<{ contents: { text?: string }[] }>('resources/read', { uri: `voyara://pds/${quote?.tier ?? 'comprehensive'}` });
          pdsText = read.contents.map((c) => c.text ?? '').join('\n');
          toolBubble(`resources/read voyara://pds/${quote?.tier ?? 'comprehensive'}`);
          show();
        },
        model: () => ({
          note: 'A resource is not a tool call, so there is no tool_use or tool_result. The client fetches the document and adds its text to the conversation as context. In Claude Code, for example, this happens when the user @-mentions a resource.',
          blocks: [
            { label: 'Into the conversation: a text block with the resource', value: { role: 'user', content: [{ type: 'text', text: `<resource uri="voyara://pds/${quote?.tier ?? 'comprehensive'}">\n${pdsText}\n</resource>` }] } },
          ],
        }),
      },
      {
        title: 'tools/call: start_checkout, then a human pays',
        body: `<p>No MCP tool can pay. <code>start_checkout</code> returns a link, valid for 30 minutes, to Voyara's own checkout page.</p>
          <p>Claude replies with the price, the disclosure and the link. The customer opens it, checks the details and presses <strong>Pay</strong> themselves. The agent helps the customer decide; the customer makes the purchase.</p>
          <p>The checkout link in the chat is real. Open it to see the quote Claude just made.</p>`,
        code: 'mcp_server.py start_checkout → quotes.py start_checkout · web/src/pages/checkout.ts',
        hops: [
          { from: 'agent', to: 'mcp', kind: 'req', label: 'tools/call start_checkout' },
          { from: 'mcp', to: 'service', kind: 'req', label: 'start_checkout' },
          'wait',
          { from: 'service', to: 'mcp', kind: 'res', label: 'checkout_url' },
          { from: 'mcp', to: 'agent', kind: 'res', label: 'result' },
          { from: 'agent', to: 'customer', kind: 'res', label: 'answer + link' },
        ],
        async run() {
          if (!quote) throw new Error('Run the create_quote step first.');
          const checkout = await callTool<{ checkout_url: string }>('start_checkout', { quote_id: quote.quote_id });
          const packs = quote.packs.map((p) => PACK_NAMES[p]).join(', ');
          finalAnswer = `Voyara ${TIER_NAMES[quote.tier]}${packs ? ` with the ${packs}` : ''} covers trekking to Everest Base Camp. For your trip it costs ${money(quote.premium.total)} (quote ${quote.quote_id}, excess ${money(quote.excess)}).\n\n${quote.disclosure.general_advice_warning}\nPDS: ${quote.disclosure.pds_url}\nTMD: ${quote.disclosure.tmd_url}\n\nI can't buy it for you. Open this link to review it and pay: ${checkout.checkout_url}`;
          chat.push({
            who: 'bot',
            html: `Voyara <strong>${TIER_NAMES[quote.tier]}</strong>${packs ? ` with the ${esc(packs)}` : ''} covers trekking to Everest Base Camp. For your trip it costs <strong>${money(quote.premium.total)}</strong> (quote ${esc(quote.quote_id)}, excess ${money(quote.excess)}).
              <small>${esc(quote.disclosure.general_advice_warning)}</small>
              <small><a href="${esc(quote.disclosure.pds_url)}" target="_blank" rel="noopener">PDS</a> · <a href="${esc(quote.disclosure.tmd_url)}" target="_blank" rel="noopener">TMD</a></small>
              <small>I can't buy it for you. <a href="${esc(checkout.checkout_url)}" target="_blank" rel="noopener">Open the checkout page</a> to review it and pay.</small>`,
          });
          show();
        },
        model: () => {
          const trip = toolRoundTrip(MCP_PREFIX, lastMcpCall, 'JSON-RPC tools/call to /mcp', 'CallToolResult');
          return {
            note: `${trip.note} With the checkout link in hand, the model stops calling tools and writes its answer. It follows the server instructions from step 2: price, disclosure and links together, and no claim that it can buy.`,
            blocks: [...trip.blocks, { label: '5. Final model output: text, shown to the customer', value: { role: 'assistant', content: [{ type: 'text', text: finalAnswer }], stop_reason: 'end_turn' } }],
          };
        },
      },
    ],
  };
}

// -- tour 2: WebMCP --------------------------------------------------------------------------------------------

function webmcpTour(): Tour {
  type View = 'blank' | 'quote' | 'results' | 'checkout';
  const tab = {
    view: 'blank' as View,
    url: '',
    form: { destination: '', start: '', end: '', ages: [] as number[] },
    notice: '',
    quotes: new Map<Tier, Quote>(),
    unavailable: new Map<Tier, string>(),
    selected: null as Tier | null,
    checkoutUrl: '',
    paid: false,
  };
  let changed: string[] = [];
  let unregisterPage: () => void = () => {};

  function render() {
    screen.replaceChildren();
    if (tab.view === 'blank') {
      screen.innerHTML = '<p class="bubble tool">The customer\'s browser tab appears here.</p>';
      return;
    }
    const wrap = document.createElement('div');
    wrap.className = 'tab';
    const bar = document.createElement('div');
    bar.className = 'tab-bar';
    bar.textContent = `localhost:5173${tab.url}`;
    const body = document.createElement('div');
    body.className = 'tab-body';
    wrap.append(bar, body);

    if (tab.view === 'quote') {
      const f = tab.form;
      body.innerHTML = `<strong>Get a travel insurance quote</strong>
        <div class="field mini"><span>Destination</span><span class="pill" data-k="destination">${esc(f.destination) || '&nbsp;'}</span></div>
        <div class="field mini"><span>Dates</span><span class="pill" data-k="start">${f.start || '&nbsp;'}</span><span class="pill" data-k="end">${f.end || '&nbsp;'}</span></div>
        <div class="field mini"><span>Traveller ages</span>${(f.ages.length ? f.ages : [NaN]).map((a) => `<span class="pill" data-k="ages">${Number.isNaN(a) ? '&nbsp;' : a}</span>`).join('')}</div>
        ${tab.notice ? `<p class="notice">${esc(tab.notice)}</p>` : ''}
        <button type="button" class="primary" disabled>Get Quote</button>`;
    } else if (tab.view === 'results') {
      const cards = TIERS.map((tier) => {
        const q = tab.quotes.get(tier);
        if (!q) return `<article class="card ineligible" data-k="card-${tier}"><h3>${TIER_NAMES[tier]}</h3><p class="meta">${esc(tab.unavailable.get(tier) ?? 'Not available')}</p></article>`;
        const packs = q.packs.map((p) => PACK_NAMES[p]).join(', ');
        return `<article class="card${tier === tab.selected ? ' selected' : ''}" data-k="card-${tier}"><h3>${TIER_NAMES[tier]}</h3>
          <p class="premium">${money(q.premium.total)}</p><p class="meta">Excess ${money(q.excess)}${packs ? ` · ${esc(packs)}` : ''}</p></article>`;
      }).join('');
      body.innerHTML = `<strong>Your quotes</strong><div class="cards">${cards}</div>`;
    } else {
      const q = tab.selected ? tab.quotes.get(tab.selected) : undefined;
      body.innerHTML = `<strong>Review and pay</strong>
        ${q ? `<p>Voyara ${TIER_NAMES[q.tier]}, ${q.packs.map((p) => PACK_NAMES[p]).join(', ') || 'no packs'}: <span class="total">${money(q.premium.total)}</span></p>` : ''}
        <button type="button" class="primary" data-k="pay" disabled>Pay</button>
        ${tab.paid ? '<p class="notice">The customer pressed Pay. Payment is not part of this demo.</p>' : ''}
        ${tab.checkoutUrl ? `<p class="meta"><a href="${esc(tab.checkoutUrl)}" target="_blank" rel="noopener">Open the real checkout page for this quote</a></p>` : ''}`;
    }
    const note = document.createElement('p');
    note.className = 'tools-note';
    const names = [...browserTools.keys()];
    note.textContent = names.length ? `WebMCP tools on this page: ${names.join(', ')}` : 'WebMCP tools on this page: none';
    screen.append(wrap, note);
    for (const key of changed) screen.querySelectorAll(`[data-k="${key}"]`).forEach(flash);
    changed = [];
  }

  async function loadResults() {
    const eligibility = await api.eligibility(tab.form.ages);
    for (const { tier, reason } of eligibility.ineligible_tiers) tab.unavailable.set(tier, reason);
    const trip = { destination: tab.form.destination, start_date: tab.form.start, end_date: tab.form.end, traveller_ages: tab.form.ages };
    const quotes = await Promise.all(eligibility.eligible_tiers.map((tier) => api.createQuote(trip, tier, 'webmcp')));
    for (const q of quotes) tab.quotes.set(q.tier, q);
  }

  // Simplified copies of the tools in pages/quote.ts and pages/results.ts, acting on the mini tab above.
  const quotePageTools: ToolDefinition[] = [
    {
      name: 'fill_trip_details',
      description: 'Fill the Voyara quote form with the trip destination, dates and traveller ages. The customer sees each value appear.',
      inputSchema: {
        type: 'object',
        properties: {
          destination: { type: 'string', description: 'Country or place, e.g. "Japan". Must be on the destination list.' },
          start_date: { type: 'string', format: 'date' },
          end_date: { type: 'string', format: 'date' },
          traveller_ages: { type: 'array', items: { type: 'integer', minimum: 0, maximum: 120 }, minItems: 1 },
        },
        required: ['destination', 'start_date', 'end_date', 'traveller_ages'],
      },
      async handler(input) {
        const list = await api.destinations();
        const destination = list.find((d) => d.toLowerCase() === String(input.destination ?? '').trim().toLowerCase());
        if (!destination) throw new ToolError(`"${input.destination}" is not on the Voyara destination list.`);
        const ages = (input.traveller_ages as number[]) ?? [];
        tab.form = { destination, start: String(input.start_date), end: String(input.end_date), ages };
        const eligibility = await api.eligibility(ages);
        tab.notice = eligibility.ineligible_tiers[0]?.reason ?? '';
        changed = ['destination', 'start', 'end', 'ages'];
        render();
        return { fields: tab.form, ready: true, eligibility_notice: tab.notice || null };
      },
    },
    {
      name: 'add_traveller',
      description: 'Add one traveller row to the Voyara quote form and re-check which tiers the group can buy.',
      inputSchema: { type: 'object', properties: { age: { type: 'integer', minimum: 0, maximum: 120 } }, required: ['age'] },
      async handler(input) {
        tab.form.ages = [...tab.form.ages, Number(input.age)];
        changed = ['ages'];
        render();
        return { traveller_ages: tab.form.ages };
      },
    },
    {
      name: 'get_form_state',
      description: 'Read what is filled in on the Voyara quote form, which fields are missing and any validation errors.',
      inputSchema: { type: 'object', properties: {} },
      annotations: { readOnlyHint: true },
      async handler() {
        return { fields: tab.form, ready: Boolean(tab.form.destination && tab.form.ages.length) };
      },
    },
    {
      name: 'submit_quote_form',
      description: 'Request prices, the same as the customer clicking Get Quote. Navigates to the results page, where results tools become available.',
      inputSchema: { type: 'object', properties: {} },
      async handler() {
        const params = new URLSearchParams({ destination: tab.form.destination, start: tab.form.start, end: tab.form.end, ages: tab.form.ages.join(','), via: 'webmcp' });
        return { status: 'navigating', url: `/quote/results/?${params}`, next: 'Call get_displayed_quotes once the results page has loaded.' };
      },
    },
  ];

  const selectedQuote = () => {
    const q = tab.selected && tab.quotes.get(tab.selected);
    if (!q) throw new ToolError('Select a tier first.');
    return q;
  };

  const resultsPageTools: ToolDefinition[] = [
    {
      name: 'get_displayed_quotes',
      description: 'Read the Voyara tier prices shown on the results page, with excess, packs and quote ID for each, plus the disclosure the customer must see.',
      inputSchema: { type: 'object', properties: {} },
      annotations: { readOnlyHint: true },
      async handler() {
        const first = tab.quotes.values().next().value;
        return {
          quotes: [...tab.quotes.values()].map(quoteSummary),
          unavailable: [...tab.unavailable].map(([tier, reason]) => ({ tier, reason })),
          disclosure: first?.disclosure,
        };
      },
    },
    {
      name: 'select_tier',
      description: 'Select a Voyara policy tier on the results page. The tier card is highlighted for the customer.',
      inputSchema: { type: 'object', properties: { tier: { type: 'string', enum: TIERS } }, required: ['tier'] },
      async handler(input) {
        const tier = input.tier as Tier;
        if (!tab.quotes.has(tier)) throw new ToolError(`${TIER_NAMES[tier] ?? tier} is not available for this trip.`);
        tab.selected = tier;
        changed = [`card-${tier}`];
        render();
        return quoteSummary(tab.quotes.get(tier)!);
      },
    },
    {
      name: 'toggle_pack',
      description: 'Add or remove an add-on pack on the selected tier and re-price on screen. Packs a tier cannot have are blocked with the reason.',
      inputSchema: { type: 'object', properties: { pack: { type: 'string', enum: ['adventure', 'snow', 'cruise', 'gadget'] }, enabled: { type: 'boolean' } }, required: ['pack', 'enabled'] },
      async handler(input) {
        const q = selectedQuote();
        const pack = input.pack as Pack;
        const packs = input.enabled ? [...new Set([...q.packs, pack])] : q.packs.filter((p) => p !== pack);
        const updated = await api.updateQuote(q.quote_id, { packs }, 'webmcp');
        tab.quotes.set(updated.tier, updated);
        changed = [`card-${updated.tier}`];
        render();
        return { ...quoteSummary(updated), disclosure: updated.disclosure };
      },
    },
    {
      name: 'proceed_to_checkout',
      description: 'Go to the checkout page for the selected tier. The customer reviews the policy and presses Pay themselves; the agent cannot pay.',
      inputSchema: { type: 'object', properties: {} },
      async handler() {
        const checkout = await api.startCheckout(selectedQuote().quote_id, 'webmcp');
        tab.checkoutUrl = checkout.checkout_url;
        return { status: 'navigating', checkout_url: checkout.checkout_url, message: 'The customer must review and press Pay. No payment tools exist.' };
      },
    },
  ];

  const ask = 'Sort out a quote for our Japan ski trip, two adults and two kids aged 10 and 8.';
  const pageTools = () => [...browserTools.values()].map((t) => toModelTool('', { name: t.name, description: t.description, inputSchema: t.inputSchema }));
  const browserSystem = () =>
    "You are the browser's assistant. [The browser's own instructions.]\n\nThe user's open tab is " + `localhost:5173${tab.url}` + '. It offers the tools listed below. Changes you make appear on the page as you make them.';

  return {
    screenTitle: "Customer's browser tab",
    focus: WEBMCP_NODES,
    renderScreen: render,
    steps: [
      {
        title: 'The page registers its tools',
        body: `<p>With WebMCP there is no MCP server to connect to. <strong>The web page is the tool provider.</strong> When <code>/quote/</code> loads, its script calls <code>navigator.modelContext.registerTool()</code> once per tool.</p>
          <p>Each registration carries the same three things as an MCP tool: a name, a description and a JSON Schema for the input. It also carries an <code>execute</code> function: plain JavaScript that runs in the customer's tab.</p>
          <p>Only <code>adapter.ts</code> touches the browser API. It does nothing in browsers without WebMCP, so the form still works for people, and nothing inside an iframe, so other sites cannot borrow Voyara's tools.</p>`,
        code: 'web/src/webmcp/adapter.ts registerTools · web/src/pages/quote.ts',
        hops: [
          { from: 'customer', to: 'page', kind: 'req', label: 'opens /quote/' },
          { from: 'page', to: 'api', kind: 'req', label: 'GET /api/destinations' },
          'wait',
          { from: 'api', to: 'page', kind: 'res', label: 'destination list' },
          { from: 'page', to: 'modelctx', kind: 'local', label: 'registerTool × 4' },
        ],
        async run() {
          tab.view = 'quote';
          tab.url = '/quote/';
          await api.destinations();
          unregisterPage = registerTools(quotePageTools, simulatedEnv);
          render();
        },
        model: () => {
          const t = browserTools.get('fill_trip_details')!;
          return {
            note: 'A WebMCP tool turns into a model tool the same way an MCP tool does: name, description and schema. There is no prefix, because the browser only offers one page at a time. There is also no instructions field: the page cannot add to the system prompt, so every rule the model must follow has to be written into the tool descriptions.',
            blocks: [
              { label: 'From the page: registerTool(...) definition', value: { name: t.name, description: t.description, inputSchema: t.inputSchema, annotations: t.annotations } },
              { label: 'Into the model request: the same tool', value: toModelTool('', t) },
            ],
          };
        },
      },
      {
        title: "The customer asks the browser's agent",
        body: `<p>The customer types a request into the agent built into their browser. The agent asks <code>navigator.modelContext</code> which tools the open page offers.</p>
          <p>The agent sees <strong>only the tools of the page that is open</strong>, and it works <strong>inside the customer's own session</strong>: same tab, same cookies, and everything it does is on screen. No OAuth, no API key, no separate login.</p>`,
        code: 'Browser behaviour (Chrome WebMCP origin trial)',
        hops: [
          { from: 'customer', to: 'bagent', kind: 'req', label: 'request' },
          { from: 'bagent', to: 'modelctx', kind: 'local', label: 'which tools?' },
          { from: 'modelctx', to: 'bagent', kind: 'local', label: '4 tools + schemas' },
        ],
        async run() {
          wire.push({ kind: 'webmcp', summary: 'Customer → browser agent', request: { prompt: ask }, response: { tools_visible: [...browserTools.keys()] } });
          render();
        },
        model: () => ({
          note: "The browser agent builds its own model request from the page it is on. When the tab moves to another page, the tools list in the next request changes with it.",
          blocks: [{ label: 'Model request', value: { model: MODEL, max_tokens: 4096, system: browserSystem(), tools: pageTools(), messages: [{ role: 'user', content: ask }] } }],
        }),
      },
      {
        title: 'execute: fill_trip_details',
        body: `<p>The agent calls <code>fill_trip_details</code>. The browser runs the tool's <code>execute</code> function in the page. It fills the form fields (watch them flash), then calls the <strong>same REST API</strong> the form uses to check eligibility.</p>
          <p>The adapter waits for the browser to <strong>paint</strong> before it returns the result, so the customer has seen the change before the agent hears it worked (R-08).</p>
          <p>The result goes back as <code>{ content: [{ type: "text", text }] }</code>, the same shape an MCP tool returns.</p>`,
        code: 'pages/quote.ts fill_trip_details · adapter.ts afterPaint · api.ts → /api/eligibility',
        hops: [
          { from: 'bagent', to: 'modelctx', kind: 'local', label: 'execute fill_trip_details' },
          { from: 'modelctx', to: 'page', kind: 'local', label: 'handler(input)' },
          { from: 'page', to: 'api', kind: 'req', label: 'POST /api/eligibility' },
          { from: 'api', to: 'service', kind: 'req', label: 'rules.check_eligibility' },
          'wait',
          { from: 'service', to: 'api', kind: 'res', label: 'eligible tiers' },
          { from: 'api', to: 'page', kind: 'res', label: '200 OK' },
          { from: 'page', to: 'bagent', kind: 'local', label: 'result, after paint' },
        ],
        async run() {
          await browserAgentCalls('fill_trip_details', { ...JAPAN });
        },
        model: () => toolRoundTrip('', lastBrowserCall, 'tool.execute(input) in the page', 'ToolResult from the adapter'),
      },
      {
        title: 'execute: submit_quote_form, and the page changes',
        body: `<p><code>submit_quote_form</code> does what the Get Quote button does: it moves the tab to <code>/quote/results/</code>.</p>
          <p>When a page unloads, its tools go with it: the adapter calls <code>unregisterTool</code> for each. The results page then registers <strong>its own</strong> tools and prices every eligible tier through <code>POST /api/quotes</code>.</p>
          <p>Look at the <code>x-voyara-channel: webmcp</code> header on those requests. The page tells the API that an agent caused them, so the quote is audited as WebMCP rather than a person clicking.</p>`,
        code: 'pages/quote.ts submit_quote_form · pages/results.ts load · api.py create_quote',
        hops: [
          { from: 'bagent', to: 'modelctx', kind: 'local', label: 'execute submit_quote_form' },
          { from: 'modelctx', to: 'page', kind: 'local', label: 'navigate' },
          { from: 'page', to: 'modelctx', kind: 'local', label: 'unregister 4 · register 4' },
          { from: 'page', to: 'api', kind: 'req', label: 'POST /api/quotes × tiers' },
          { from: 'api', to: 'service', kind: 'req', label: 'QuoteService.create_quote' },
          'wait',
          { from: 'service', to: 'api', kind: 'res', label: 'quotes' },
          { from: 'api', to: 'page', kind: 'res', label: 'prices on screen' },
        ],
        async run() {
          const result = await browserAgentCalls<{ url: string }>('submit_quote_form');
          unregisterPage();
          tab.view = 'results';
          tab.url = result.url;
          unregisterPage = registerTools(resultsPageTools, simulatedEnv);
          await loadResults();
          changed = TIERS.map((t) => `card-${t}`);
          render();
        },
        model: () => toolRoundTrip('', lastBrowserCall, 'tool.execute(input) in the page', 'ToolResult from the adapter'),
      },
      {
        title: 'execute: get_displayed_quotes (read-only)',
        body: `<p>The agent reads the prices the customer is looking at. This tool is marked <code>readOnlyHint: true</code> and never leaves the browser. It reads the page's own state, so <strong>no network request</strong> appears in the log.</p>
          <p>The result includes the <code>disclosure</code>, so the agent can show the warning and PDS links alongside any price it repeats.</p>`,
        code: 'pages/results.ts get_displayed_quotes',
        hops: [
          { from: 'bagent', to: 'modelctx', kind: 'local', label: 'execute get_displayed_quotes' },
          { from: 'modelctx', to: 'page', kind: 'local', label: 'read page state' },
          { from: 'page', to: 'bagent', kind: 'local', label: 'prices + disclosure' },
        ],
        async run() {
          await browserAgentCalls('get_displayed_quotes');
        },
        model: () => toolRoundTrip('', lastBrowserCall, 'tool.execute(input) in the page', 'ToolResult from the adapter'),
      },
      {
        title: 'execute: select_tier',
        body: `<p>Snow sports need Explorer or above, so the agent selects <strong>Explorer</strong>. The card highlights for the customer.</p>
          <p>This is still a page-only change: nothing is saved until the price changes. Some WebMCP tools are purely UI, which an MCP server could never offer.</p>`,
        code: 'pages/results.ts select_tier',
        hops: [
          { from: 'bagent', to: 'modelctx', kind: 'local', label: 'execute select_tier' },
          { from: 'modelctx', to: 'page', kind: 'local', label: 'highlight Explorer' },
          { from: 'page', to: 'bagent', kind: 'local', label: 'result' },
        ],
        async run() {
          await browserAgentCalls('select_tier', { tier: 'explorer' });
        },
        model: () => toolRoundTrip('', lastBrowserCall, 'tool.execute(input) in the page', 'ToolResult from the adapter'),
      },
      {
        title: 'execute: toggle_pack (Snow Pack)',
        body: `<p>Adding the Snow Pack changes the price, so this tool goes back to the server: <code>PATCH /api/quotes/{id}</code>. QuoteService checks that the pack is allowed on the tier and re-prices.</p>
          <p>If the agent tried a pack the tier cannot have, the API's rule error would come back as a tool result with <code>isError: true</code>, worded so the agent can explain it to the customer.</p>`,
        code: 'pages/results.ts toggle_pack · api.py update_quote · rules.py pack eligibility',
        hops: [
          { from: 'bagent', to: 'modelctx', kind: 'local', label: 'execute toggle_pack' },
          { from: 'modelctx', to: 'page', kind: 'local', label: 'handler' },
          { from: 'page', to: 'api', kind: 'req', label: 'PATCH /api/quotes/{id}' },
          { from: 'api', to: 'service', kind: 'req', label: 'update_quote' },
          'wait',
          { from: 'service', to: 'api', kind: 'res', label: 're-priced quote' },
          { from: 'api', to: 'page', kind: 'res', label: 'new price on screen' },
          { from: 'page', to: 'bagent', kind: 'local', label: 'result' },
        ],
        async run() {
          await browserAgentCalls('toggle_pack', { pack: 'snow', enabled: true });
        },
        model: () => toolRoundTrip('', lastBrowserCall, 'tool.execute(input) in the page', 'ToolResult from the adapter'),
      },
      {
        title: 'execute: proceed_to_checkout',
        body: `<p>The agent moves the customer to checkout. The API creates a checkout session, and the tab moves to <code>/checkout/</code>.</p>
          <p>The checkout page <strong>registers no tools at all</strong>. After this step the tool list is empty, so the agent has nothing it could use to pay.</p>`,
        code: 'pages/results.ts proceed_to_checkout · pages/checkout.ts (no registerTools call)',
        hops: [
          { from: 'bagent', to: 'modelctx', kind: 'local', label: 'execute proceed_to_checkout' },
          { from: 'modelctx', to: 'page', kind: 'local', label: 'handler' },
          { from: 'page', to: 'api', kind: 'req', label: 'POST /api/quotes/{id}/checkout' },
          { from: 'api', to: 'service', kind: 'req', label: 'start_checkout' },
          'wait',
          { from: 'service', to: 'api', kind: 'res', label: 'checkout session' },
          { from: 'api', to: 'page', kind: 'res', label: 'navigate' },
          { from: 'page', to: 'modelctx', kind: 'local', label: 'unregister 4 · register 0' },
        ],
        async run() {
          await browserAgentCalls('proceed_to_checkout');
          unregisterPage();
          tab.view = 'checkout';
          tab.url = '/checkout/';
          render();
        },
        model: () => toolRoundTrip('', lastBrowserCall, 'tool.execute(input) in the page', 'ToolResult from the adapter'),
      },
      {
        title: 'The customer presses Pay',
        body: `<p>Only a person can finish. The customer reads the policy, the price and the disclosure, then clicks <strong>Pay</strong>.</p>
          <p>In both channels, agents can explain, compare, fill in and price, but they cannot pay.</p>
          <p>The link on the checkout screen opens the real checkout page for the quote this tour created.</p>`,
        code: 'web/src/pages/checkout.ts · README requirement R-06',
        hops: [{ from: 'customer', to: 'page', kind: 'req', label: 'clicks Pay' }],
        async run() {
          tab.paid = true;
          changed = ['pay'];
          render();
        },
      },
    ],
  };
}

// -- tour 3: both channels -------------------------------------------------------------------------------------

function bothTour(): Tour {
  let rows: { channel: string; via: string; quote: Quote }[] = [];
  const render = () => {
    if (rows.length === 0) {
      screen.innerHTML = '<p class="bubble tool">Run the step to price one trip through both channels.</p>';
      return;
    }
    const same = rows[0].quote.premium.total === rows[1].quote.premium.total;
    screen.innerHTML = `<div class="table-wrap"><table class="compare"><thead><tr><th>Channel</th><th>Sent as</th><th>Quote</th><th>Premium</th></tr></thead><tbody>
      ${rows.map((r) => `<tr><td>${esc(r.channel)}</td><td><code>${esc(r.via)}</code></td><td>${esc(r.quote.quote_id)}</td><td class="${same ? 'same' : ''}">${money(r.quote.premium.total)}</td></tr>`).join('')}
      </tbody></table></div>
      <p>${same ? 'Same trip, same rules, same price. Only the quote ID and the recorded channel differ.' : 'The premiums differ. That would break requirement R-01.'}</p>`;
  };

  return {
    screenTitle: 'Result',
    focus: ['agent', 'mcp', 'service', 'page', 'api'],
    renderScreen: render,
    steps: [
      {
        title: 'One trip, two doors, one price',
        body: `<p>This step prices the Nguyen family's Japan ski trip (Explorer with Snow Pack) twice, at the same moment: once as Claude would over MCP and once as the quote page would over REST.</p>
          <p>Both doors lead to the same <strong>QuoteService</strong>. Neither <code>mcp_server.py</code> nor <code>api.py</code> holds any pricing logic. They only translate their protocol into a QuoteService call, so the price cannot drift between channels (R-01).</p>`,
        code: 'mcp_server.py create_quote · api.py create_quote · quotes.py QuoteService',
        hops: [
          { from: 'agent', to: 'mcp', kind: 'req', label: 'tools/call create_quote' },
          { from: 'page', to: 'api', kind: 'req', label: 'POST /api/quotes' },
          { from: 'mcp', to: 'service', kind: 'req', label: 'create_quote(channel="mcp")' },
          { from: 'api', to: 'service', kind: 'req', label: 'create_quote(channel="webmcp")' },
          'wait',
          { from: 'service', to: 'mcp', kind: 'res', label: 'quote' },
          { from: 'service', to: 'api', kind: 'res', label: 'quote' },
        ],
        async run() {
          const trip = { start_date: JAPAN.start_date, end_date: JAPAN.end_date, traveller_ages: JAPAN.traveller_ages, tier: 'explorer', packs: ['snow'] };
          const [viaMcp, viaRest] = await Promise.all([
            callTool<Quote>('create_quote', { destination_region: 'asia', ...trip }),
            fetch('/api/quotes', {
              method: 'POST',
              headers: { 'content-type': 'application/json', 'X-Voyara-Channel': 'webmcp' },
              body: JSON.stringify({ destination: JAPAN.destination, ...trip }),
            }).then(async (res) => {
              if (!res.ok) throw new Error(`The Quote API returned HTTP ${res.status}.`);
              return (await res.json()) as Quote;
            }),
          ]);
          rows = [
            { channel: 'MCP (Claude)', via: 'POST /mcp tools/call', quote: viaMcp },
            { channel: 'WebMCP (quote page)', via: 'POST /api/quotes', quote: viaRest },
          ];
          render();
        },
      },
      {
        title: 'MCP and WebMCP side by side',
        body: `<div class="table-wrap"><table>
            <thead><tr><th></th><th>MCP</th><th>WebMCP</th></tr></thead>
            <tbody>
              <tr><th>Who calls the tools</th><td>An agent anywhere: chat apps, scheduled jobs</td><td>The agent built into the customer's browser</td></tr>
              <tr><th>Where tools live</th><td>A server (<code>mcp_server.py</code>)</td><td>The web page (<code>pages/*.ts</code>)</td></tr>
              <tr><th>Transport</th><td>JSON-RPC 2.0 over HTTP POST</td><td>A browser API, <code>navigator.modelContext</code></td></tr>
              <tr><th>Discovery</th><td><code>tools/list</code>, once</td><td>Changes as the customer moves between pages</td></tr>
              <tr><th>Identity</th><td>Client name from <code>initialize</code> (OAuth later)</td><td>The customer's own browser session</td></tr>
              <tr><th>Customer sees</th><td>The agent's answer</td><td>Every change, on the page, as it happens</td></tr>
              <tr><th>Guard rails</th><td>Schema validation, 60 calls a minute per IP, local Host check</td><td>Top-level pages only, results after paint</td></tr>
              <tr><th>Can it pay?</th><td>No: checkout link only</td><td>No: checkout page has no tools</td></tr>
            </tbody></table></div>
          <p>Use MCP when the customer is not on your site. Use WebMCP when they are, and want help with the page in front of them. Voyara offers both and keeps the rules in one place.</p>`,
        code: 'README.md · CONTRIBUTING.md "Service boundaries"',
        hops: [],
      },
    ],
  };
}

// -- controller ------------------------------------------------------------------------------------------------

const TOURS: Record<TourId, () => Tour> = { mcp: mcpTour, webmcp: webmcpTour, both: bothTour };

let tourId: TourId = 'mcp';
let tour: Tour;
let index = 0;
let busy = false;
let autoplayTimer = 0;
const done = new Map<number, { wire: WireEntry[]; screen: string; error?: string; model?: ModelView }>();

const prevBtn = $<HTMLButtonElement>('#prev');
const nextBtn = $<HTMLButtonElement>('#next');
const replayBtn = $<HTMLButtonElement>('#replay');
const autoplay = $<HTMLInputElement>('#autoplay');
const offline = $('#offline');

function renderWire(entries: WireEntry[], ran = false) {
  const el = $('#wire');
  el.replaceChildren();
  if (entries.length === 0) {
    el.innerHTML = ran
      ? '<p class="empty">No messages. This step happens between people and screens, with no tool call or request.</p>'
      : '<p class="empty">Nothing yet. Run the step to see its messages.</p>';
    return;
  }
  entries.forEach((entry, i) => {
    const d = document.createElement('details');
    d.open = i === entries.length - 1;
    const summary = document.createElement('summary');
    summary.innerHTML = `<span class="tag ${entry.kind}">${entry.kind === 'http' ? 'HTTP' : 'WebMCP'}</span>`;
    summary.append(entry.summary);
    const pair = document.createElement('div');
    pair.className = 'pair';
    for (const [label, value] of [['Request', entry.request], ['Response', entry.response]] as const) {
      const box = document.createElement('div');
      const h = document.createElement('h4');
      h.textContent = label;
      const pre = document.createElement('pre');
      pre.textContent = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
      box.append(h, pre);
      pair.append(box);
    }
    d.append(summary, pair);
    el.append(d);
  });
}

function renderModel(view: ModelView | undefined) {
  const panel = $('#model-panel');
  panel.hidden = !view || view.blocks.length === 0;
  if (!view) return;
  $('#model-note').textContent = view.note;
  $('#model').replaceChildren(
    ...view.blocks.map((b) => {
      const card = document.createElement('div');
      card.className = 'model-block';
      const h = document.createElement('h4');
      h.textContent = b.label;
      const pre = document.createElement('pre');
      pre.textContent = typeof b.value === 'string' ? b.value : JSON.stringify(b.value, null, 2);
      card.append(h, pre);
      return card;
    }),
  );
}

function renderStepList() {
  const list = $('#step-list');
  list.replaceChildren(
    ...tour.steps.map((step, i) => {
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = String(i + 1);
      b.title = step.title;
      b.setAttribute('aria-label', `Step ${i + 1}: ${step.title}`);
      b.classList.toggle('done', done.has(i));
      if (i === index) b.setAttribute('aria-current', 'step');
      b.disabled = busy || (!done.has(i) && i !== done.size);
      b.addEventListener('click', () => void goTo(i));
      li.append(b);
      return li;
    }),
  );
}

function renderControls() {
  const current = done.get(index);
  const last = index === tour.steps.length - 1;
  prevBtn.disabled = busy || index === 0;
  replayBtn.disabled = busy || !current || current.error !== undefined;
  nextBtn.disabled = busy || (Boolean(current) && !current?.error && last);
  nextBtn.textContent = !current || current.error ? (current?.error ? 'Run again' : 'Run this step') : last ? 'Tour complete' : 'Next';
  nextBtn.setAttribute('aria-busy', String(busy));
  renderStepList();
}

function show(i: number) {
  index = i;
  const step = tour.steps[i];
  $('#step-title').textContent = `Step ${i + 1} of ${tour.steps.length}: ${step.title}`;
  const body = $('#step-body');
  body.innerHTML = step.body;
  const result = done.get(i);
  if (result?.error) {
    const p = document.createElement('p');
    p.className = 'notice';
    p.textContent = result.error;
    body.append(p);
  }
  $('#step-code').innerHTML = `Code: <code>${esc(step.code)}</code>`;
  if (result) {
    screen.innerHTML = result.screen;
    renderWire(result.wire, true);
  } else {
    tour.renderScreen();
    renderWire([]);
  }
  renderModel(result && !result.error ? result.model : undefined);
  renderControls();
}

async function animate(hops: Hop[], pending: Promise<unknown>) {
  for (const hop of hops) {
    if (hop === 'wait') {
      const ok = await pending.then(() => true, () => false);
      if (!ok) return;
    } else {
      await travel(hop);
    }
  }
}

async function runStep(i: number) {
  const step = tour.steps[i];
  busy = true;
  serverDown = false;
  offline.hidden = true;
  wire = [];
  show(i);
  done.delete(i);
  renderControls();
  const pending = step.run ? step.run() : Promise.resolve();
  pending.catch(() => {}); // handled below
  await animate(step.hops, pending);
  let error: string | undefined;
  try {
    await pending;
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
    offline.hidden = !serverDown;
  }
  let model: ModelView | undefined;
  if (!error) {
    try {
      model = step.model?.();
    } catch (err) {
      console.error('Could not build the model view', err);
    }
  }
  done.set(i, { wire, screen: screen.innerHTML, error, model });
  busy = false;
  show(i);
  if (!error && autoplay.checked && i < tour.steps.length - 1) {
    autoplayTimer = window.setTimeout(() => void runStep(i + 1), 2500);
  }
}

async function goTo(i: number) {
  if (busy) return;
  clearTimeout(autoplayTimer);
  if (done.has(i) && !done.get(i)?.error) show(i);
  else await runStep(i);
}

function selectTour(id: TourId) {
  clearTimeout(autoplayTimer);
  tourId = id;
  tour = TOURS[id]();
  done.clear();
  browserTools.clear();
  wire = [];
  offline.hidden = true;
  $('#screen-title').textContent = tour.screenTitle;
  document.querySelectorAll<HTMLButtonElement>('[data-tour]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tour === id)));
  stage.querySelectorAll<HTMLElement>('.node').forEach((n) => n.classList.toggle('dim', !tour.focus.includes(n.dataset.node as NodeId)));
  drawWires();
  show(0);
}

nextBtn.addEventListener('click', () => {
  const current = done.get(index);
  if (!current || current.error) void runStep(index);
  else if (index < tour.steps.length - 1) void goTo(index + 1);
});
prevBtn.addEventListener('click', () => void goTo(index - 1));
replayBtn.addEventListener('click', async () => {
  if (busy) return;
  busy = true;
  renderControls();
  await animate(tour.steps[index].hops, Promise.resolve());
  busy = false;
  renderControls();
});
$('#reset').addEventListener('click', () => selectTour(tourId));
autoplay.addEventListener('change', () => {
  if (!autoplay.checked) clearTimeout(autoplayTimer);
});
document.querySelectorAll<HTMLButtonElement>('[data-tour]').forEach((b) => b.addEventListener('click', () => {
  if (!busy) selectTour(b.dataset.tour as TourId);
}));
document.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement || e.altKey || e.metaKey || e.ctrlKey) return;
  if (e.key === 'ArrowRight') nextBtn.click();
  if (e.key === 'ArrowLeft' && !prevBtn.disabled) prevBtn.click();
});

const requested = new URLSearchParams(location.search).get('tour');
selectTour(requested && requested in TOURS ? (requested as TourId) : 'mcp');
