import { api, type Channel } from '../api';
import { $, flash, showErrors } from '../ui';
import { registerTools, ToolError } from '../webmcp/adapter';

const RELATIONSHIPS = ['self', 'partner', 'child', 'other'] as const;
type Relationship = (typeof RELATIONSHIPS)[number];

const form = $<HTMLFormElement>('#quote-form');
const destinationInput = $<HTMLInputElement>('#destination');
const startInput = $<HTMLInputElement>('#start-date');
const endInput = $<HTMLInputElement>('#end-date');
const travellersEl = $('#travellers');
const eligibilityEl = $('#eligibility');
const errorsEl = $('#errors');

let allowedDestinations: string[] = [];
const destinationsLoaded = api.destinations().then((list) => {
  allowedDestinations = list;
  $('#destination-list').replaceChildren(
    ...list.map((name) => Object.assign(document.createElement('option'), { value: name })),
  );
});

function canonicalDestination(value: string): string | undefined {
  const wanted = value.trim().toLowerCase();
  return allowedDestinations.find((d) => d.toLowerCase() === wanted);
}

// -- travellers --------------------------------------------------------------

function addTravellerRow(age?: number, relationship: Relationship = 'self'): HTMLElement {
  const index = travellersEl.children.length + 1;
  const row = document.createElement('div');
  row.className = 'traveller';
  row.innerHTML = `
    <label>Age <input class="age" type="number" min="0" max="120" inputmode="numeric" aria-label="Traveller ${index} age" /></label>
    <select class="relationship" aria-label="Traveller ${index} relationship">
      ${RELATIONSHIPS.map((r) => `<option value="${r}">${r[0].toUpperCase()}${r.slice(1)}</option>`).join('')}
    </select>
    <button type="button" class="remove" aria-label="Remove traveller ${index}">Remove</button>`;
  const ageInput = $<HTMLInputElement>('.age', row);
  if (age !== undefined) ageInput.value = String(age);
  $<HTMLSelectElement>('.relationship', row).value = relationship;
  $('.remove', row).addEventListener('click', () => {
    row.remove();
    void refreshEligibility();
  });
  ageInput.addEventListener('change', () => void refreshEligibility());
  travellersEl.append(row);
  return row;
}

function travellers(): { age: number | null; relationship: Relationship }[] {
  return [...travellersEl.querySelectorAll<HTMLElement>('.traveller')].map((row) => {
    const raw = $<HTMLInputElement>('.age', row).value;
    return { age: raw === '' ? null : Number(raw), relationship: $<HTMLSelectElement>('.relationship', row).value as Relationship };
  });
}

async function refreshEligibility(): Promise<string | null> {
  const ages = travellers().map((t) => t.age).filter((a): a is number => a !== null && Number.isInteger(a) && a >= 0 && a <= 120);
  if (ages.length === 0) {
    eligibilityEl.hidden = true;
    return null;
  }
  const result = await api.eligibility(ages);
  const notes: string[] = result.ineligible_tiers.length ? [result.ineligible_tiers[0].reason + '.'] : [];
  if (result.medical_assessment_required) notes.push('A medical assessment is required. The traveller answers the questions themselves.');
  eligibilityEl.textContent = notes.join(' ');
  eligibilityEl.hidden = notes.length === 0;
  return notes.length ? eligibilityEl.textContent : null;
}

// -- validation and submit ---------------------------------------------------

function formState() {
  const fields = {
    destination: destinationInput.value.trim(),
    start_date: startInput.value,
    end_date: endInput.value,
    travellers: travellers(),
  };
  const missing: string[] = [];
  const errors: string[] = [];
  if (!fields.destination) missing.push('destination');
  else if (!canonicalDestination(fields.destination)) errors.push(`"${fields.destination}" is not a destination we cover. Choose one from the list.`);
  if (!fields.start_date) missing.push('start_date');
  if (!fields.end_date) missing.push('end_date');
  const today = new Date().toLocaleDateString('en-CA'); // local YYYY-MM-DD
  if (fields.start_date && fields.start_date < today) errors.push('Departure date cannot be in the past.');
  if (fields.start_date && fields.end_date && fields.end_date < fields.start_date) errors.push('Return date must be on or after the departure date.');
  if (fields.travellers.length === 0) missing.push('travellers');
  fields.travellers.forEach((t, i) => {
    if (t.age === null) missing.push(`travellers[${i}].age`);
    else if (!Number.isInteger(t.age) || t.age < 0 || t.age > 120) errors.push(`Traveller ${i + 1} age must be a whole number from 0 to 120.`);
  });
  return { fields, missing, errors, ready: missing.length === 0 && errors.length === 0 };
}

function submit(channel: Channel): string {
  const state = formState();
  const problems = [...state.missing.map((m) => `Missing: ${m}`), ...state.errors];
  showErrors(errorsEl, problems);
  if (!state.ready) throw new ToolError(problems.join(' '));
  const params = new URLSearchParams({
    destination: canonicalDestination(state.fields.destination)!,
    start: state.fields.start_date,
    end: state.fields.end_date,
    ages: state.fields.travellers.map((t) => t.age).join(','),
    via: channel,
  });
  return `/quote/results/?${params}`;
}

form.addEventListener('submit', (event) => {
  event.preventDefault();
  try {
    location.assign(submit('web'));
  } catch {
    // Errors are already shown on the page.
  }
});
$('#add-traveller').addEventListener('click', () => $<HTMLInputElement>('.age', addTravellerRow()).focus());
addTravellerRow();

// -- WebMCP tools ------------------------------------------------------------

function setField(input: HTMLInputElement, value: string) {
  input.value = value;
  input.dispatchEvent(new Event('change', { bubbles: true }));
  flash(input);
}

registerTools([
  {
    name: 'fill_trip_details',
    description:
      'Fill the Voyara quote form with the trip destination, dates and traveller ages. The customer sees each value appear. Replaces any travellers already entered.',
    inputSchema: {
      type: 'object',
      properties: {
        destination: { type: 'string', description: 'Country or place, e.g. "Japan". Must be on the destination list.' },
        start_date: { type: 'string', format: 'date', description: 'Departure date, YYYY-MM-DD' },
        end_date: { type: 'string', format: 'date', description: 'Return date, YYYY-MM-DD' },
        traveller_ages: { type: 'array', items: { type: 'integer', minimum: 0, maximum: 120 }, minItems: 1 },
      },
      required: ['destination', 'start_date', 'end_date', 'traveller_ages'],
    },
    async handler(input) {
      await destinationsLoaded;
      const destination = canonicalDestination(String(input.destination ?? ''));
      if (!destination) throw new ToolError(`"${input.destination}" is not on the Voyara destination list. Ask the customer to pick a destination from the form's list.`);
      setField(destinationInput, destination);
      setField(startInput, String(input.start_date ?? ''));
      setField(endInput, String(input.end_date ?? ''));
      travellersEl.replaceChildren();
      const ages = (input.traveller_ages as number[]) ?? [];
      ages.forEach((age, i) => flash(addTravellerRow(age, i === 0 ? 'self' : 'other')));
      const eligibility_notice = await refreshEligibility();
      const state = formState();
      showErrors(errorsEl, state.errors);
      return { ...state, eligibility_notice };
    },
  },
  {
    name: 'add_traveller',
    description: 'Add one traveller row to the Voyara quote form and re-check which tiers the group can buy.',
    inputSchema: {
      type: 'object',
      properties: {
        age: { type: 'integer', minimum: 0, maximum: 120 },
        relationship: { type: 'string', enum: [...RELATIONSHIPS] },
      },
      required: ['age', 'relationship'],
    },
    async handler(input) {
      const relationship = RELATIONSHIPS.includes(input.relationship as Relationship) ? (input.relationship as Relationship) : 'other';
      flash(addTravellerRow(Number(input.age), relationship));
      const eligibility_notice = await refreshEligibility();
      return { travellers: travellers(), eligibility_notice };
    },
  },
  {
    name: 'get_form_state',
    description: 'Read what is filled in on the Voyara quote form, which fields are missing and any validation errors.',
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: true },
    async handler() {
      await destinationsLoaded;
      return formState();
    },
  },
  {
    name: 'submit_quote_form',
    description: 'Request prices, the same as the customer clicking Get Quote. Navigates to the results page, where results tools become available.',
    inputSchema: { type: 'object', properties: {} },
    async handler() {
      await destinationsLoaded;
      const url = submit('webmcp');
      setTimeout(() => location.assign(url), 50); // let the tool result reach the agent before the page unloads
      return { status: 'navigating', url, next: 'Call get_displayed_quotes once the results page has loaded.' };
    },
  },
]);
