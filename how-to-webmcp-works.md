# How WebMCP works in Voyara

> *(Detail level: 2 - Component Map)*

This page explains how an AI agent built into a customer's browser completes a Voyara quote through WebMCP. It names the parts involved and how data moves between them. It does not go into internal logic.

Voyara is an example system. The insurer, its prices and its policy wording are all fictitious.

For the headless channel, see [How MCP works](how-to-mcp-works.md).

## WebMCP in one paragraph

WebMCP is a browser API, `navigator.modelContext`, that lets a web page publish tools to the AI agent built into the browser. It is in origin trial in Chrome 149 or later.

There is no server to connect to. The page itself registers tools when it loads, and the browser's agent calls them. Each tool runs inside the customer's own tab, with the customer's own session, and changes the page in front of them. The tools exist only while the page is open. When the customer navigates away, they are gone.

## Where WebMCP sits in Voyara

| Layer | Component | File | Role |
| --- | --- | --- | --- |
| Browser | In-browser agent | Part of the browser | Talks with the customer, picks page tools and reads their results |
| Browser | WebMCP API | `navigator.modelContext` | The browser feature the page registers tools with |
| Page | WebMCP adapter | `web/src/webmcp/adapter.ts` | The only code that touches the browser API. Registers and unregisters tools, waits for the screen to update, formats results and errors. |
| Page | Quote form page | `web/src/pages/quote.ts` | The trip details form and its four tools |
| Page | Results page | `web/src/pages/results.ts` | Tier cards, the selection panel, inclusion details and their six tools |
| Page | Checkout page | `web/src/pages/checkout.ts` | Order summary and the Pay button. Registers no tools. |
| Page | API client | `web/src/api.ts` | Calls the Quote API and labels each call with its channel |
| Page | UI helpers | `web/src/ui.ts` | Highlights what the agent changed and renders the disclosure |
| Network | Vite dev proxy | `web/vite.config.ts` | Forwards `/api` from the page origin to the Python server |
| Server | REST API | `server/src/voyara/api.py` | Validates requests, checks the destination allow-list, calls the quote service |
| Server | Quote service, rules, pricing, catalogue | `server/src/voyara/` | The same business logic the MCP server uses |

## How a tool call travels

| Step | From | To | What moves |
| --- | --- | --- | --- |
| 1 | Page | WebMCP API, through the adapter | On page load, each tool's name, description and input schema |
| 2 | In-browser agent | WebMCP API | A tool call with arguments, for example `select_tier` with `comprehensive` |
| 3 | WebMCP API | Adapter | The call, passed to the matching page handler |
| 4 | Page handler | API client and REST API | A quote request labelled `X-Voyara-Channel: webmcp` |
| 5 | REST API | Quote service | Validated trip details, the same entry point the MCP server uses |
| 6 | Quote service | Page handler | The re-priced quote, with disclosure |
| 7 | Page handler | Screen | Updated card, price or form field, highlighted so the customer can see the change |
| 8 | Adapter | In-browser agent | The result, sent only after the browser has painted the change |

When a person clicks the same buttons, the same page functions run. The only difference is the channel label, `web` instead of `webmcp`.

## Tools by page

| Page | Tool | What the customer sees |
| --- | --- | --- |
| `/quote/` | `fill_trip_details` | Destination, dates and traveller ages appear in the form |
| `/quote/` | `add_traveller` | A new traveller row appears, and any age-cap notice updates |
| `/quote/` | `get_form_state` | Nothing changes. The agent reads what is filled and what is missing. |
| `/quote/` | `submit_quote_form` | The page moves to the results, as if Get Quote was clicked |
| `/quote/results/` | `get_displayed_quotes` | Nothing changes. The agent reads the tier prices on screen. |
| `/quote/results/` | `select_tier` | The chosen tier card is highlighted |
| `/quote/results/` | `set_excess` | The excess and total update |
| `/quote/results/` | `toggle_pack` | The pack is added and the total updates, or a message explains why the pack is not allowed |
| `/quote/results/` | `explain_on_page` | The inclusion's detail panel opens |
| `/quote/results/` | `proceed_to_checkout` | The page moves to checkout |
| `/checkout/` | None | The customer reviews the policy and presses Pay |

## Page lifecycle

| Moment | What happens to the tools |
| --- | --- |
| Page loads in a WebMCP browser | The adapter registers that page's tools |
| Page loads in any other browser | The adapter does nothing. The form works as normal, with no errors. |
| Page loads inside a frame | The adapter does nothing, so only top-level Voyara pages expose tools |
| Customer navigates away | The adapter unregisters the tools. The next page registers its own. |
| Moving from form to results | Trip details travel in the results page address. The results page prices each eligible tier on load. |

## A worked journey: the Nguyen family skiing in Japan

Linh is on the quote page planning a ski trip for two adults and two children. She asks the browser's agent to sort out the quote.

| Step | Tool | Components reached | What Linh sees |
| --- | --- | --- | --- |
| 1 | `fill_trip_details` | Quote form page, REST API (eligibility) | Japan, the dates and two adult ages fill in |
| 2 | `add_traveller` (twice) | Quote form page, REST API (eligibility) | Two child rows appear |
| 3 | `submit_quote_form` | Quote form page | The results page opens |
| 4 | `get_displayed_quotes` | Results page, REST API, quote service | Four tier prices on screen |
| 5 | `explain_on_page` | Results page, REST API | The rental vehicle excess panel opens: not covered on Explorer, $5,000 on Comprehensive |
| 6 | `select_tier` | Results page | Comprehensive is highlighted |
| 7 | `toggle_pack` | Results page, REST API, quote service | Snow Pack is ticked and the total rises by $79 |
| 8 | `proceed_to_checkout` | Results page, REST API, quote service | The checkout page opens |
| 9 | None | Checkout page | Linh reviews the policy and presses Pay herself |

## Boundaries the design enforces

| Boundary | How it is enforced |
| --- | --- |
| Agents cannot pay | The checkout page registers no tools. Pay needs a human click. |
| The customer sees every change | The adapter returns a result only after the change is painted on screen |
| No browser support needed | The adapter checks for `navigator.modelContext` and steps aside when it is missing |
| Only first-party pages | The adapter refuses to register tools inside a frame |
| Untrusted text is checked | Free-text destinations must match the allow-list, both in the page and again in the REST API |
| Rules live in one place | Page tools hold no pricing or eligibility logic. Ineligible packs are rejected by the quote service, and the page shows the reason. |
| API churn is contained | The browser API is still changing, so only the adapter knows its names |

## How it is tested without Chrome's WebMCP

Real WebMCP needs Chrome 149 or later with the origin trial or a browser flag. The tests use a stand-in instead.

| Component | File | Role |
| --- | --- | --- |
| Fake model context | `web/tests/fake-model-context.ts` | Takes the place of `navigator.modelContext` and lets a test call page tools as the agent would |
| Adapter unit tests | `web/tests/unit/adapter.test.ts` | Missing API, frames, result and error formatting, unregistering |
| End-to-end tests | `web/tests/e2e/` | Drive the real pages in Chromium. They run the Nguyen family journey and the rule checks, compare premiums with the MCP channel, and use the plain form without WebMCP. |

## How WebMCP relates to MCP here

| Question | WebMCP | MCP |
| --- | --- | --- |
| Who calls it | The agent built into the customer's browser | An agent anywhere, with no browser |
| Where the tools live | In the open quote page, only while it is open | On the Voyara server, always on |
| What a tool changes | The page in front of the customer, then the quote | The quote only |
| Path to the quote service | Page tools, then `/api` | `/mcp`, then the MCP server |
| Channel recorded on the quote | `webmcp` | `mcp` |

Read [How MCP works](how-to-mcp-works.md) for the server side.
