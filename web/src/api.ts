// Typed client for the shared Quote API. The WebMCP tools and the human UI both go through here.

export type Channel = 'web' | 'webmcp';
export type Tier = 'essentials' | 'explorer' | 'comprehensive' | 'elite';
export type Pack = 'adventure' | 'snow' | 'cruise' | 'gadget';

export const TIERS: Tier[] = ['essentials', 'explorer', 'comprehensive', 'elite'];
export const PACKS: Pack[] = ['adventure', 'snow', 'cruise', 'gadget'];
export const EXCESS_OPTIONS = [0, 100, 200, 250, 500];
export const TIER_NAMES: Record<Tier, string> = {
  essentials: 'Essentials',
  explorer: 'Explorer',
  comprehensive: 'Comprehensive',
  elite: 'Elite',
};
export const PACK_NAMES: Record<Pack, string> = {
  adventure: 'Adventure Pack',
  snow: 'Snow Pack',
  cruise: 'Cruise Pack',
  gadget: 'Gadget Pack',
};

export interface Disclosure {
  general_advice_warning: string;
  pds_url: string;
  tmd_url: string;
}

export interface Quote {
  quote_id: string;
  status: 'active';
  destination: string | null;
  destination_region: string;
  start_date: string;
  end_date: string;
  traveller_ages: number[];
  tier: Tier;
  excess: number;
  packs: Pack[];
  premium: { currency: 'AUD'; total: string; travellers: { age: number; amount: string }[]; packs: { pack: Pack; amount: string }[] };
  medical_assessment_required: boolean;
  expires_at: string;
  disclosure: Disclosure;
  catalogue_version: string;
}

export interface Eligibility {
  eligible_tiers: Tier[];
  ineligible_tiers: { tier: Tier; reason: string }[];
  highest_eligible_tier: Tier | null;
  medical_assessment_required: boolean;
}

export interface CompareRow {
  inclusion: string;
  label: string;
  [tier: string]: string;
}

export interface Explanation {
  inclusion: string;
  label: string;
  tier: Tier;
  limit: string;
  description: string;
  exclusions: string[];
  pds_section: string;
  pds_url: string;
}

export interface Checkout {
  checkout_session_id: string;
  checkout_url: string;
  expires_at: string;
  quote: Quote;
}

export interface TripInput {
  destination: string;
  start_date: string;
  end_date: string;
  traveller_ages: number[];
}

/** An error from the Quote API. `message` is the rule reason, safe to show to the customer and the agent. */
export class ApiError extends Error {
  override name = 'ApiError';
  constructor(message: string, readonly status: number, readonly details: Record<string, unknown> = {}) {
    super(message);
  }
}

async function call<T>(method: string, path: string, body?: unknown, channel?: Channel): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (channel) headers['X-Voyara-Channel'] = channel;
  const res = await fetch(`/api${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const { error, detail, ...rest } = data as { error?: string; detail?: unknown };
    throw new ApiError(error ?? (typeof detail === 'string' ? detail : `Request failed (${res.status})`), res.status, rest);
  }
  return data as T;
}

export const api = {
  destinations: () => call<{ destinations: string[] }>('GET', '/destinations').then((d) => d.destinations),
  eligibility: (traveller_ages: number[]) => call<Eligibility>('POST', '/eligibility', { traveller_ages }),
  compare: (tiers: Tier[]) =>
    call<{ matrix: CompareRow[] }>('GET', `/compare?${tiers.map((t) => `tiers=${t}`).join('&')}`).then((d) => d.matrix),
  explain: (inclusion: string, tier: Tier) =>
    call<Explanation>('GET', `/inclusions/${encodeURIComponent(inclusion)}?tier=${tier}`),
  createQuote: (trip: TripInput, tier: Tier, channel: Channel) => call<Quote>('POST', '/quotes', { ...trip, tier }, channel),
  updateQuote: (quoteId: string, changes: { tier?: Tier; excess?: number; packs?: Pack[] }, channel: Channel) =>
    call<Quote>('PATCH', `/quotes/${encodeURIComponent(quoteId)}`, changes, channel),
  startCheckout: (quoteId: string, channel: Channel) =>
    call<Checkout>('POST', `/quotes/${encodeURIComponent(quoteId)}/checkout`, undefined, channel),
  getCheckout: (sessionId: string) => call<Omit<Checkout, 'checkout_url'>>('GET', `/checkout/${encodeURIComponent(sessionId)}`),
};
