<!--
Title: type(scope): subject, e.g. feat(server): add cruise pack to the comprehensive tier
Branch: <prefix>/<issue-number>-<kebab-title>, targeting main
-->

Closes #

## What changed and why

-

## How it was tested

-

## Checklist

- [ ] One issue per pull request, with no unrelated changes
- [ ] Test written first and seen failing before the fix or feature
- [ ] Any change to an R-01 to R-12 requirement adds or updates a test listed against it in the README
- [ ] README updated if a tool, route, requirement or run command changed
- [ ] Service boundaries kept: pricing and eligibility logic stays in the `server/src/voyara/` domain modules
- [ ] Both channels still call the same `QuoteService`
- [ ] Checkout page still registers no WebMCP tools
- [ ] All prices, limits and product details are clearly fictitious

### Quality gates

- [ ] `cd server && uv run pytest`
- [ ] `cd web && npm run build`
- [ ] `cd web && npm test`
- [ ] `cd web && npm run e2e`
