// "How to use this page" guide for /flow. Read-only: it highlights parts of the page and explains them, and never
// runs a walkthrough step. Opens from the header button or the ? key. Esc, Done or a click outside closes it.

interface HelpStop {
  target: string;
  title: string;
  text: string;
}

const STOPS: HelpStop[] = [
  {
    target: '.tours',
    title: 'Pick a tour',
    text: 'Tour 1 follows a headless agent (Claude) over MCP. Tour 2 follows the agent built into the browser over WebMCP. Tour 3 prices one trip through both and compares the results. Start with tour 1.',
  },
  {
    target: '.stage-wrap',
    title: 'Watch the diagram',
    text: 'Each box is one part of the system. When a step runs, a label moves along the lines to show each message. Teal is a request, amber is a response, and purple stays inside the browser. Grey boxes are not part of the current tour.',
  },
  {
    target: '.step-panel',
    title: 'Step through',
    text: 'Read the explanation, then press Next to run the step against the real server. Back shows an earlier step again without running it. Replay plays the animation again. Autoplay runs the remaining steps for you. The arrow keys also work.',
  },
  {
    target: '.screen-panel',
    title: "The customer's screen",
    text: "This shows what the customer sees: the chat with Claude in tour 1, or their browser tab in tour 2. Fields flash when the agent changes them.",
  },
  {
    target: '#model-panel',
    title: 'Inside the agent',
    text: 'After a step runs, this shows what the language model receives: the system prompt, the tool definitions, and how parameters go out in a tool_use block and come back in a tool_result.',
  },
  {
    target: '.wire-panel',
    title: 'On the wire',
    text: 'The real requests and responses for the step, with headers. Open any row to see the full JSON. HTTP rows went to the server. WebMCP rows stayed in the browser.',
  },
];

const openBtn = document.querySelector<HTMLButtonElement>('#help-open')!;
let index = 0;
let overlay: HTMLDivElement | null = null;
let spot: HTMLDivElement;
let card: HTMLDivElement;

function visibleStops(): HelpStop[] {
  return STOPS.filter((s) => {
    const el = document.querySelector<HTMLElement>(s.target);
    return el && !el.hidden && el.getClientRects().length > 0;
  });
}

function place() {
  if (!overlay) return;
  const stops = visibleStops();
  const stop = stops[index];
  const el = document.querySelector<HTMLElement>(stop.target)!;
  const r = el.getBoundingClientRect();
  const pad = 8;
  Object.assign(spot.style, { top: `${r.top - pad}px`, left: `${r.left - pad}px`, width: `${r.width + pad * 2}px`, height: `${r.height + pad * 2}px` });

  const gap = 14;
  const cw = card.offsetWidth;
  const ch = card.offsetHeight;
  const below = r.bottom + pad + gap;
  const top = below + ch < innerHeight ? below : Math.max(gap, r.top - pad - gap - ch);
  const left = Math.min(Math.max(gap, r.left), innerWidth - cw - gap);
  Object.assign(card.style, { top: `${Math.min(top, innerHeight - ch - gap)}px`, left: `${left}px` });
}

function render() {
  const stops = visibleStops();
  index = Math.min(index, stops.length - 1);
  const stop = stops[index];
  card.querySelector('h2')!.textContent = stop.title;
  card.querySelector('p')!.textContent = stop.text;
  card.querySelector('.help-count')!.textContent = `${index + 1} of ${stops.length}`;
  card.querySelector<HTMLButtonElement>('[data-help="back"]')!.disabled = index === 0;
  const next = card.querySelector<HTMLButtonElement>('[data-help="next"]')!;
  next.textContent = index === stops.length - 1 ? 'Done' : 'Next';
  const el = document.querySelector<HTMLElement>(stop.target)!;
  el.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  place();
  setTimeout(place, 400); // after a smooth scroll settles
  next.focus({ preventScroll: true });
}

function close() {
  if (!overlay) return;
  overlay.remove();
  overlay = null;
  removeEventListener('scroll', place, true);
  removeEventListener('resize', place);
  openBtn.focus();
}

function open() {
  if (overlay) return;
  index = 0;
  overlay = document.createElement('div');
  overlay.className = 'help-overlay';
  overlay.innerHTML = `
    <div class="help-spot"></div>
    <div class="help-card" role="dialog" aria-modal="true" aria-labelledby="help-title">
      <h2 id="help-title"></h2>
      <p aria-live="polite"></p>
      <div class="help-actions">
        <span class="help-count"></span>
        <button type="button" data-help="close" class="help-skip">Close</button>
        <button type="button" data-help="back">Back</button>
        <button type="button" data-help="next" class="primary">Next</button>
      </div>
    </div>`;
  spot = overlay.querySelector('.help-spot')!;
  card = overlay.querySelector('.help-card')!;
  overlay.addEventListener('click', (e) => {
    const action = (e.target as HTMLElement).closest<HTMLElement>('[data-help]')?.dataset.help;
    if (action === 'next') index === visibleStops().length - 1 ? close() : (index++, render());
    else if (action === 'back') (index--, render());
    else if (action === 'close' || !card.contains(e.target as Node)) close();
  });
  document.body.append(overlay);
  addEventListener('scroll', place, true);
  addEventListener('resize', place);
  render();
}

openBtn.addEventListener('click', open);

// Capture phase, so the walkthrough's own arrow-key shortcuts never fire while the guide is open.
addEventListener(
  'keydown',
  (e) => {
    const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;
    if (!overlay) {
      if (e.key === '?' && !typing && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        open();
      }
      return;
    }
    const keys: Record<string, string> = { Escape: 'close', ArrowRight: 'next', ArrowLeft: 'back' };
    const action = keys[e.key];
    if (action) {
      e.preventDefault();
      e.stopImmediatePropagation();
      const btn = card.querySelector<HTMLButtonElement>(`[data-help="${action}"]`)!;
      if (!btn.disabled) btn.click();
    } else if (e.key === 'Tab') {
      // Keep keyboard focus inside the guide card.
      const buttons = [...card.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
      const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
      e.preventDefault();
      buttons[(i + (e.shiftKey ? -1 : 1) + buttons.length) % buttons.length].focus();
    }
  },
  true,
);
