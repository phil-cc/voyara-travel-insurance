import { expect, test } from '@playwright/test';
import { JAPAN_TRIP, money } from './helpers';

// R-09: a browser without navigator.modelContext gets the normal page with no errors.
test('manual quote works with no WebMCP support and no console errors', async ({ page, request }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

  await page.goto('/quote/');
  expect(await page.evaluate(() => 'modelContext' in navigator)).toBe(false);

  await page.getByLabel('Destination').fill(JAPAN_TRIP.destination);
  await page.getByLabel('Departure date').fill(JAPAN_TRIP.start_date);
  await page.getByLabel('Return date').fill(JAPAN_TRIP.end_date);
  await page.getByLabel('Traveller 1 age').fill('35');
  await page.getByRole('button', { name: 'Get Quote' }).click();

  await page.waitForURL(/\/quote\/results\//);
  const card = page.locator('#tier-explorer');
  await expect(card.locator('.premium')).toHaveText(/\$/);
  await card.getByRole('button', { name: 'Select' }).click();
  await expect(page.locator('#selection')).toBeVisible();
  await page.getByLabel('Excess').selectOption('500');
  const quoteId = (await card.locator('.meta').last().textContent())!.replace('Quote ', '');
  await expect(async () => {
    const quote = await (await request.get(`/api/quotes/${quoteId}`)).json();
    expect(quote.excess).toBe(500);
    expect(quote.channel).toBe('web');
    await expect(page.locator('#selected-total')).toHaveText(money(quote.premium.total));
  }).toPass();
  await page.getByRole('button', { name: 'Proceed to checkout' }).click();
  await page.waitForURL(/\/checkout\//);
  await expect(page.getByRole('button', { name: 'Pay' })).toBeVisible();

  expect(errors).toEqual([]);
});
