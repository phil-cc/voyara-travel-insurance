import { expect, type Page } from '@playwright/test';
import { installFakeModelContext, type FakeToolResult, type FakeWebMcp } from '../fake-model-context';

declare global {
  interface Window {
    __webmcp: FakeWebMcp;
  }
}

export const JAPAN_TRIP = { destination: 'Japan', start_date: '2027-07-03', end_date: '2027-07-12' };

export async function withAgent(page: Page): Promise<void> {
  await page.addInitScript(installFakeModelContext);
}

export async function waitForTool(page: Page, name: string): Promise<void> {
  await page.waitForFunction((n) => window.__webmcp?.names().includes(n), name);
}

export interface Invocation<T> {
  result: T;
  isError: boolean;
  text: string;
  /** DOM values read in the same task the tool resolved in, proving the change rendered before the tool returned (R-08). */
  dom: Record<string, string | null>;
}

/**
 * Invoke a page tool as the in-browser agent would. `read` maps a label to [selector, property]; the values are
 * read synchronously right after the tool resolves, with no waiting or retrying.
 */
export async function invoke<T = any>(
  page: Page,
  name: string,
  args: Record<string, unknown> = {},
  read: Record<string, [string, string]> = {},
): Promise<Invocation<T>> {
  await waitForTool(page, name);
  const { res, dom } = await page.evaluate(
    async ({ name, args, read }) => {
      const res: FakeToolResult = await window.__webmcp.invoke(name, args);
      const dom: Record<string, string | null> = {};
      for (const [label, [selector, prop]] of Object.entries(read)) {
        const el = document.querySelector(selector) as unknown as Record<string, unknown> | null;
        dom[label] = el ? String(el[prop]) : null;
      }
      return { res, dom };
    },
    { name, args, read },
  );
  const text = res.content[0].text;
  let result: T;
  try {
    result = JSON.parse(text);
  } catch {
    result = text as T;
  }
  return { result, isError: Boolean(res.isError), text, dom };
}

export async function expectOk<T>(call: Promise<Invocation<T>>): Promise<Invocation<T>> {
  const inv = await call;
  expect(inv.isError, inv.text).toBe(false);
  return inv;
}

export function money(amount: string | number): string {
  return Number(amount).toLocaleString('en-AU', { style: 'currency', currency: 'AUD' });
}

export function resultsUrl(ages: number[], destination = 'Japan'): string {
  const p = new URLSearchParams({ destination, start: JAPAN_TRIP.start_date, end: JAPAN_TRIP.end_date, ages: ages.join(','), via: 'webmcp' });
  return `/quote/results/?${p}`;
}
