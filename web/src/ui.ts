import type { Disclosure } from './api';

export function $<T extends HTMLElement = HTMLElement>(selector: string, root: ParentNode = document): T {
  const el = root.querySelector<T>(selector);
  if (!el) throw new Error(`Missing element ${selector}`);
  return el;
}

export function money(amount: string | number): string {
  return Number(amount).toLocaleString('en-AU', { style: 'currency', currency: 'AUD' });
}

/** Briefly highlight an element so the customer can see what the agent changed. */
export function flash(el: Element): void {
  el.classList.remove('agent-changed');
  void (el as HTMLElement).offsetWidth; // restart the animation
  el.classList.add('agent-changed');
}

export function renderDisclosure(target: HTMLElement, d: Disclosure): void {
  target.replaceChildren();
  const p = document.createElement('p');
  p.textContent = d.general_advice_warning;
  const links = document.createElement('p');
  links.append(link(d.pds_url, 'Product Disclosure Statement'), ' · ', link(d.tmd_url, 'Target Market Determination'));
  target.append(p, links);
}

function link(href: string, label: string): HTMLAnchorElement {
  const a = document.createElement('a');
  a.href = href;
  a.textContent = label;
  a.target = '_blank';
  a.rel = 'noopener';
  return a;
}

export function showErrors(target: HTMLElement, errors: string[]): void {
  target.replaceChildren(
    ...errors.map((e) => {
      const li = document.createElement('li');
      li.textContent = e;
      return li;
    }),
  );
  target.hidden = errors.length === 0;
}
