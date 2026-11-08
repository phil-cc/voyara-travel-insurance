import { expect, test } from '@playwright/test';
import { expectOk, invoke, JAPAN_TRIP, money, waitForTool, withAgent } from './helpers';

test('Story 2: the Nguyen family quote is completed by the in-browser agent', async ({ page }) => {
  await withAgent(page);
  await page.goto('/quote/');

  // 1. Fill the form; the values are on screen when the tool returns (R-08).
  const filled = await expectOk(
    invoke(page, 'fill_trip_details', { ...JAPAN_TRIP, traveller_ages: [42, 40] }, {
      destination: ['#destination', 'value'],
      start: ['#start-date', 'value'],
    }),
  );
  expect(filled.dom).toEqual({ destination: 'Japan', start: '2027-07-03' });
  for (const age of [10, 8]) {
    const added = await expectOk(invoke(page, 'add_traveller', { age, relationship: 'child' }, { last: ['.traveller:last-child .age', 'value'] }));
    expect(added.dom.last).toBe(String(age));
  }
  const state = await expectOk(invoke(page, 'get_form_state'));
  expect(state.result.ready).toBe(true);
  expect(state.result.fields.travellers.map((t: { age: number }) => t.age)).toEqual([42, 40, 10, 8]);

  // 2. Submit and read prices.
  await expectOk(invoke(page, 'submit_quote_form'));
  await page.waitForURL(/\/quote\/results\//);
  const displayed = await expectOk(invoke(page, 'get_displayed_quotes'));
  expect(displayed.result.quotes.map((q: { tier: string }) => q.tier)).toEqual(['essentials', 'explorer', 'comprehensive', 'elite']);
  expect(displayed.result.disclosure.general_advice_warning).toContain('general advice');
  for (const q of displayed.result.quotes) expect(q.quote_id).toMatch(/^Q-\d{5}$/);

  // 3. Is rental car excess covered on Explorer?
  const explained = await expectOk(
    invoke(page, 'explain_on_page', { inclusion: 'rental_vehicle_excess' }, { open: ['#inc-rental_vehicle_excess', 'open'] }),
  );
  expect(explained.result.limits_by_tier.explorer).toBe('Not covered');
  expect(explained.result.limits_by_tier.comprehensive).toBe('$5,000');
  expect(explained.dom.open).toBe('true');

  // 4. Comprehensive plus Snow Pack; the price on screen matches the tool result when it returns.
  const selected = await expectOk(
    invoke(page, 'select_tier', { tier: 'comprehensive' }, { card: ['#tier-comprehensive', 'className'] }),
  );
  expect(selected.dom.card).toContain('selected');
  const withSnow = await expectOk(
    invoke(page, 'toggle_pack', { pack: 'snow', enabled: true }, { total: ['#selected-total', 'textContent'], box: ['#pack-snow', 'checked'] }),
  );
  expect(withSnow.result.packs).toEqual(['snow']);
  expect(withSnow.dom).toEqual({ total: money(withSnow.result.premium), box: 'true' });
  expect(Number(withSnow.result.premium) - Number(selected.result.premium)).toBe(79);
  expect(withSnow.result.disclosure.pds_url).toContain('/pds/comprehensive');

  // 5. Checkout: the agent can navigate there but no tool can pay (R-06).
  const checkout = await expectOk(invoke(page, 'proceed_to_checkout'));
  expect(checkout.result.checkout_url).toContain('/checkout/?session=');
  await page.waitForURL(/\/checkout\//);
  await expect(page.locator('#summary')).toBeVisible();
  await expect(page.locator('#total')).toHaveText(money(withSnow.result.premium));
  expect(await page.evaluate(() => window.__webmcp.names())).toEqual([]);
  await page.getByRole('button', { name: 'Pay' }).click();
  await expect(page.locator('#pay-message')).toContainText('not part of this demo');
});

test('only the current page tools are registered', async ({ page }) => {
  await withAgent(page);
  await page.goto('/quote/');
  await waitForTool(page, 'submit_quote_form');
  expect((await page.evaluate(() => window.__webmcp.names())).sort()).toEqual(
    ['add_traveller', 'fill_trip_details', 'get_form_state', 'submit_quote_form'],
  );
});
