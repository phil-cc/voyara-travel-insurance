// Checkout registers no WebMCP tools: paying always needs a human click (R-06).
import { api, ApiError, PACK_NAMES, TIER_NAMES } from '../api';
import { $, money, renderDisclosure } from '../ui';

const statusEl = $('#status');
const session = new URLSearchParams(location.search).get('session');

async function load() {
  if (!session) {
    statusEl.textContent = 'This checkout link is missing its session.';
    return;
  }
  const checkout = await api.getCheckout(session);
  const quote = checkout.quote;
  $('#policy-name').textContent = `Voyara ${TIER_NAMES[quote.tier]} (quote ${quote.quote_id})`;
  $('#trip').textContent = `${quote.destination ?? quote.destination_region}, ${quote.start_date} to ${quote.end_date}, travellers aged ${quote.traveller_ages.join(', ')}`;
  $('#extras').textContent = `Excess ${money(quote.excess)}${quote.packs.length ? ` · ${quote.packs.map((p) => PACK_NAMES[p]).join(', ')}` : ''}`;
  $('#total').textContent = money(quote.premium.total);
  renderDisclosure($('#disclosure'), quote.disclosure);
  statusEl.textContent = 'Check the details, then press Pay.';
  $('#summary').hidden = false;
}

$('#pay').addEventListener('click', () => {
  const msg = $('#pay-message');
  msg.textContent = 'Payment is not part of this demo. In production, this is where the customer pays.';
  msg.hidden = false;
});

load().catch((err) => {
  statusEl.textContent = err instanceof ApiError ? err.message : 'Checkout could not be loaded.';
});
