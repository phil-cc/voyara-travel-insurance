import {
  api, ApiError, EXCESS_OPTIONS, PACK_NAMES, PACKS, TIER_NAMES, TIERS,
  type Channel, type CompareRow, type Pack, type Quote, type Tier, type TripInput,
} from '../api';
import { $, flash, money, renderDisclosure } from '../ui';
import { registerTools, ToolError } from '../webmcp/adapter';

const params = new URLSearchParams(location.search);
const trip: TripInput = {
  destination: params.get('destination') ?? '',
  start_date: params.get('start') ?? '',
  end_date: params.get('end') ?? '',
  traveller_ages: (params.get('ages') ?? '').split(',').filter(Boolean).map(Number),
};
const loadChannel: Channel = params.get('via') === 'webmcp' ? 'webmcp' : 'web';

const quotes = new Map<Tier, Quote>();
const ineligible = new Map<Tier, string>();
let matrix: CompareRow[] = [];
let selected: Tier | null = null;

const statusEl = $('#status');
const cardsEl = $('#cards');
const selectionEl = $('#selection');
const excessEl = $<HTMLSelectElement>('#excess');
const packsEl = $('#packs');
const packMessageEl = $('#pack-message');

// -- rendering ---------------------------------------------------------------

function renderCards() {
  cardsEl.replaceChildren(
    ...TIERS.map((tier) => {
      const card = document.createElement('article');
      card.id = `tier-${tier}`;
      card.className = 'card';
      const quote = quotes.get(tier);
      const h = document.createElement('h2');
      h.textContent = TIER_NAMES[tier];
      card.append(h);
      if (!quote) {
        card.classList.add('ineligible');
        const p = document.createElement('p');
        p.className = 'meta';
        p.textContent = ineligible.get(tier) ?? 'Not available';
        card.append(p);
        return card;
      }
      card.classList.toggle('selected', tier === selected);
      card.innerHTML += `
        <p class="premium">${money(quote.premium.total)}</p>
        <p class="meta">Excess ${money(quote.excess)}${quote.packs.length ? ` · ${quote.packs.map((p) => PACK_NAMES[p]).join(', ')}` : ''}</p>
        <p class="meta">Quote ${quote.quote_id}</p>`;
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = tier === selected ? 'Selected' : 'Select';
      button.setAttribute('aria-pressed', String(tier === selected));
      button.addEventListener('click', () => selectTier(tier));
      card.append(button);
      return card;
    }),
  );
}

function renderSelection() {
  if (!selected) {
    selectionEl.hidden = true;
    return;
  }
  const quote = quotes.get(selected)!;
  selectionEl.hidden = false;
  $('#selected-name').textContent = TIER_NAMES[selected];
  excessEl.value = String(quote.excess);
  for (const pack of PACKS) $<HTMLInputElement>(`#pack-${pack}`).checked = quote.packs.includes(pack);
  $('#selected-total').textContent = money(quote.premium.total);
  renderDisclosure($('#disclosure'), quote.disclosure);
}

function renderInclusions() {
  const shown = TIERS.filter((t) => quotes.has(t) || ineligible.has(t));
  $('#inclusions').replaceChildren(
    ...matrix.map((row) => {
      const details = document.createElement('details');
      details.id = `inc-${row.inclusion}`;
      details.innerHTML = `
        <summary>${row.label}</summary>
        <div class="table-wrap"><table>
          <tr>${shown.map((t) => `<th scope="col">${TIER_NAMES[t]}</th>`).join('')}</tr>
          <tr>${shown.map((t) => `<td>${row[t]}</td>`).join('')}</tr>
        </table></div>
        <div class="explain"></div>`;
      return details;
    }),
  );
}

function showPackMessage(message: string | null) {
  packMessageEl.textContent = message ?? '';
  packMessageEl.hidden = !message;
}

// -- actions shared by the human UI and the WebMCP tools ---------------------

function requireSelected(): Quote {
  if (!selected) throw new ToolError('No tier is selected yet. Call select_tier first.');
  return quotes.get(selected)!;
}

function summary(quote: Quote) {
  return {
    tier: quote.tier,
    quote_id: quote.quote_id,
    premium: quote.premium.total,
    excess: quote.excess,
    packs: quote.packs,
    selected: quote.tier === selected,
  };
}

function selectTier(tier: Tier) {
  if (!quotes.has(tier)) throw new ToolError(ineligible.get(tier) ?? `${TIER_NAMES[tier]} is not available for this trip.`);
  selected = tier;
  showPackMessage(null);
  renderCards();
  renderSelection();
  flash($(`#tier-${tier}`));
  return quotes.get(tier)!;
}

async function updateSelected(changes: { excess?: number; packs?: Pack[] }, channel: Channel) {
  const quote = requireSelected();
  const updated = await api.updateQuote(quote.quote_id, changes, channel);
  quotes.set(updated.tier, updated);
  renderCards();
  renderSelection();
  flash($('#selected-total'));
  return updated;
}

async function togglePack(pack: Pack, enabled: boolean, channel: Channel) {
  const quote = requireSelected();
  const packs = enabled ? [...new Set([...quote.packs, pack])] : quote.packs.filter((p) => p !== pack);
  try {
    const updated = await updateSelected({ packs }, channel);
    showPackMessage(null);
    return updated;
  } catch (err) {
    if (err instanceof ApiError) {
      showPackMessage(err.message);
      renderSelection(); // put the checkbox back
      flash(packMessageEl);
    }
    throw err;
  }
}

async function explainOnPage(inclusion: string) {
  const details = document.querySelector<HTMLDetailsElement>(`#inc-${CSS.escape(inclusion)}`);
  if (!details) throw new ToolError(`Unknown inclusion "${inclusion}". Valid values: ${matrix.map((r) => r.inclusion).join(', ')}`);
  const row = matrix.find((r) => r.inclusion === inclusion)!;
  const info = await api.explain(inclusion, selected ?? 'explorer');
  $('.explain', details).innerHTML = '';
  const p = document.createElement('p');
  p.textContent = info.description;
  const ex = document.createElement('p');
  ex.textContent = info.exclusions.length ? `Key exclusions: ${info.exclusions.join('; ')}.` : '';
  const pds = document.createElement('p');
  pds.className = 'meta';
  pds.textContent = `PDS ${info.pds_section}`;
  $('.explain', details).append(p, ex, pds);
  details.open = true;
  details.scrollIntoView({ block: 'nearest' });
  flash(details);
  const limits = Object.fromEntries(TIERS.filter((t) => t in row).map((t) => [t, row[t]]));
  return { inclusion, label: row.label, limits_by_tier: limits, description: info.description, exclusions: info.exclusions, pds_section: info.pds_section };
}

async function proceedToCheckout(channel: Channel) {
  const quote = requireSelected();
  const checkout = await api.startCheckout(quote.quote_id, channel);
  return checkout.checkout_url;
}

// -- human UI wiring ---------------------------------------------------------

excessEl.replaceChildren(...EXCESS_OPTIONS.map((a) => Object.assign(document.createElement('option'), { value: String(a), textContent: money(a) })));
excessEl.addEventListener('change', () => void updateSelected({ excess: Number(excessEl.value) }, 'web'));
packsEl.replaceChildren(
  ...PACKS.map((pack) => {
    const label = document.createElement('label');
    label.innerHTML = `<input type="checkbox" id="pack-${pack}" /> ${PACK_NAMES[pack]}`;
    const box = $<HTMLInputElement>('input', label);
    box.addEventListener('change', () => togglePack(pack, box.checked, 'web').catch(() => {}));
    return label;
  }),
);
$('#proceed').addEventListener('click', async () => location.assign(await proceedToCheckout('web')));

// -- load --------------------------------------------------------------------

async function load() {
  if (!trip.destination || !trip.start_date || !trip.end_date || trip.traveller_ages.length === 0) {
    statusEl.innerHTML = 'Trip details are missing. <a href="/quote/">Start a quote</a>.';
    return;
  }
  $('#trip-summary').textContent = `${trip.destination}, ${trip.start_date} to ${trip.end_date}, travellers aged ${trip.traveller_ages.join(', ')}`;
  const eligibility = await api.eligibility(trip.traveller_ages);
  for (const { tier, reason } of eligibility.ineligible_tiers) ineligible.set(tier, reason);
  $('#medical').hidden = !eligibility.medical_assessment_required;
  const [created, compared] = await Promise.all([
    Promise.all(eligibility.eligible_tiers.map((tier) => api.createQuote(trip, tier, loadChannel))),
    api.compare(TIERS),
  ]);
  created.forEach((q) => quotes.set(q.tier, q));
  matrix = compared;
  statusEl.textContent = quotes.size ? 'Choose a tier to continue.' : 'No tiers are available for these travellers.';
  renderCards();
  renderInclusions();
  if (created[0]) renderDisclosure($('#disclosure'), created[0].disclosure);
}

const loaded = load().catch((err) => {
  statusEl.textContent = err instanceof ApiError ? err.message : 'Prices could not be loaded. Please try again.';
  throw err;
});

// -- WebMCP tools ------------------------------------------------------------

registerTools([
  {
    name: 'get_displayed_quotes',
    description: 'Read the Voyara tier prices shown on the results page, with excess, packs and quote ID for each, plus the disclosure the customer must see.',
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: true },
    async handler() {
      await loaded;
      const first = quotes.values().next().value;
      return {
        trip,
        quotes: [...quotes.values()].map(summary),
        unavailable: [...ineligible].map(([tier, reason]) => ({ tier, reason })),
        medical_assessment_required: first?.medical_assessment_required ?? false,
        disclosure: first?.disclosure,
      };
    },
  },
  {
    name: 'select_tier',
    description: 'Select a Voyara policy tier on the results page. The tier card is highlighted for the customer.',
    inputSchema: { type: 'object', properties: { tier: { type: 'string', enum: TIERS } }, required: ['tier'] },
    async handler(input) {
      await loaded;
      return summary(selectTier(input.tier as Tier));
    },
  },
  {
    name: 'set_excess',
    description: 'Change the excess on the selected tier and re-price it on screen. A higher excess lowers the premium.',
    inputSchema: { type: 'object', properties: { amount: { type: 'integer', enum: EXCESS_OPTIONS } }, required: ['amount'] },
    async handler(input) {
      await loaded;
      const updated = await updateSelected({ excess: Number(input.amount) }, 'webmcp');
      return { ...summary(updated), disclosure: updated.disclosure };
    },
  },
  {
    name: 'toggle_pack',
    description: 'Add or remove an add-on pack on the selected tier and re-price on screen. Packs a tier cannot have are blocked with the reason.',
    inputSchema: {
      type: 'object',
      properties: { pack: { type: 'string', enum: PACKS }, enabled: { type: 'boolean' } },
      required: ['pack', 'enabled'],
    },
    async handler(input) {
      await loaded;
      const updated = await togglePack(input.pack as Pack, Boolean(input.enabled), 'webmcp');
      return { ...summary(updated), disclosure: updated.disclosure };
    },
  },
  {
    name: 'explain_on_page',
    description: "Open an inclusion's detail panel on the results page and return its limits for each tier, description and key exclusions.",
    inputSchema: {
      type: 'object',
      properties: { inclusion: { type: 'string', description: 'Inclusion key, e.g. rental_vehicle_excess, trip_cancellation, luggage' } },
      required: ['inclusion'],
    },
    annotations: { readOnlyHint: true },
    async handler(input) {
      await loaded;
      return explainOnPage(String(input.inclusion));
    },
  },
  {
    name: 'proceed_to_checkout',
    description: 'Go to the checkout page for the selected tier. The customer reviews the policy and presses Pay themselves; the agent cannot pay.',
    inputSchema: { type: 'object', properties: {} },
    async handler() {
      await loaded;
      const url = await proceedToCheckout('webmcp');
      setTimeout(() => location.assign(url), 50); // let the tool result reach the agent before the page unloads
      return { status: 'navigating', checkout_url: url, message: 'The customer must review and press Pay. No payment tools exist.' };
    },
  },
]);
