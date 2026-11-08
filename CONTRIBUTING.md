# Contributing

Thanks for helping improve the Voyara reference build. Voyara is a fictitious insurer, so keep every price, limit and product detail clearly made up.

## Prerequisites

- [`uv`](https://docs.astral.sh/uv/)
- Node 22.22+ or 24.15+
- Chromium for the end-to-end tests (`npx playwright install chromium`)

## Getting started

```sh
cd server && uv sync
cd web && npm install
```

See the [README](README.md) for running the MCP server and web pages.

## Workflow

1. **Raise an issue.** Every change, however small, needs a GitHub issue before any code is written. Use the template that matches the work; see [Issues](#issues).
2. **Fork and branch.** Cut your branch from `main`, named per [Branch naming](#branch-naming).
3. **Write the test first.** Add a test that fails for the behaviour you are adding or fixing, then make it pass. See [Testing](#testing).
4. **Keep it focused.** One issue per branch and per pull request. Unrelated fixes belong in a separate pull request.
5. **Update the docs.** If you change a tool, route, requirement or run command, update the README in the same pull request.
6. **Pass the quality gates**, then open a pull request to `main`.

## Issues

Work is tracked in GitHub Issues, and every branch and pull request must link to one. Blank issues are turned off: pick the template that matches the work, and it sets the issue title prefix, the label and the branch prefix you will use.

| Template | Use for | Branch prefix |
| --- | --- | --- |
| [Bug report](.github/ISSUE_TEMPLATE/bug_report.yml) | Behaviour that differs from the README or the PRD requirements | `hotfix/` |
| [Feature request](.github/ISSUE_TEMPLATE/feature_request.yml) | A new capability, so the approach can be agreed before code is written | `feature/` |
| [Other](.github/ISSUE_TEMPLATE/other.yml) | Docs, tooling, dependencies, config or refactors | `other/` |

## Development phases

Every change runs through four phases, in this order: **Spec, Test, Implement, Review**. The spec is the GitHub issue itself; this repo uses no spec tool and keeps no separate spec files.

No phase may be skipped, with one exception: an Other issue that changes no behaviour (docs, or a dependency bump that leaves every test green) skips Test.

| Phase | Purpose | Input | Artefact | Exit: do not start the next phase until |
| --- | --- | --- | --- | --- |
| 1. Spec | Agree what will change and how you will know it works | A problem, a bug or an idea | A GitHub issue raised from the matching template, with its required fields filled | The issue states the expected behaviour (Feature request), the steps to reproduce (Bug report) or the what and why (Other), and a maintainer has not objected to the approach |
| 2. Test | Turn the expected behaviour into a test that fails | The issue's expected behaviour or reproduction steps | A failing test on a branch named for the issue | The new test runs and fails for the reason the issue describes, and no other test fails |
| 3. Implement | Make the failing test pass with the minimum change | The failing test | Code and README changes on the branch | The new test passes and every quality gate passes locally |
| 4. Review | Confirm the change matches the issue and keeps the service boundaries | The branch | A pull request to `main` that closes the issue | A maintainer approves it and it is merged |

### Commands per phase

| Phase | Command | What it does |
| --- | --- | --- |
| Spec | `gh issue create` or the **New issue** button on GitHub | Raises the issue from a template |
| Test | `git switch -c feature/<issue-number>-<kebab-title>` | Cuts the branch (use `hotfix/` or `other/` to match the issue) |
| Test | `cd server && uv run pytest -k <test_name>` | Runs one server test to watch it fail |
| Test | `cd web && npx vitest run <file>` | Runs one unit test file to watch it fail |
| Test | `cd web && npx playwright test <file>` | Runs one end-to-end spec to watch it fail |
| Implement | The four commands in [Quality gates](#quality-gates) | Confirms the whole suite passes |
| Review | `gh pr create --base main` | Opens the pull request |

### From a fresh fork to your first spec

1. Fork the repo on GitHub and clone your fork.
2. Add this repo as `upstream`: `git remote add upstream <this-repo-url>`.
3. Install dependencies: `cd server && uv sync`, then `cd web && npm install && npx playwright install chromium`.
4. Run every quality gate once on `main` to confirm a clean starting point.
5. Run the server and web pages per the [README](README.md) and try the behaviour you want to change.
6. Raise an issue from the matching template. That issue is your first spec, and the Spec phase ends when it meets the exit condition above.

## Branch strategy

This repo uses a trunk-based workflow. `main` is the only long-lived branch and the only pull request target. Short-lived branches are cut from `main` and merged back to `main` via pull request.

```text
main
 ├── feature/14-add-cruise-pack-limits     # new capability
 ├── hotfix/22-fix-age-cap-off-by-one       # bug fix
 └── other/31-bump-playwright               # docs, tooling, dependencies, refactors
```

### Branch naming

```text
<prefix>/<github-issue-number>-<lowercase-kebab-title>
```

| Prefix | Use for |
| --- | --- |
| `feature/` | New feature or capability |
| `hotfix/` | Bug fix against `main` |
| `other/` | Docs, tooling, dependencies, config, refactors that fit nowhere else |

Rules:

- The ticket ID is the bare GitHub issue number (`14`, not `#14` or `GH-14`), placed straight after the prefix.
- The title is lowercase kebab-case derived from the issue title.
- One branch per issue.

## Commit messages

Format: `<type>(<scope>): <subject>` ([Conventional Commits](https://www.conventionalcommits.org/)).

```text
feat(server): add cruise pack to the comprehensive tier
fix(web): keep a customised excess when the tier changes
test(server): cover the 75+ medical assessment flag
docs: explain the WebMCP flag in chrome://flags
```

| Type | Use for |
| --- | --- |
| `feat` | New feature or capability |
| `fix` | Bug fix |
| `docs` | Documentation only |
| `refactor` | Code restructuring with no behaviour change |
| `test` | Adding or fixing tests |
| `chore` | Tooling, dependencies, config |

Commit types and branch prefixes are independent. A `hotfix/` branch usually holds `fix:` commits; an `other/` branch may hold `docs:`, `chore:` and `refactor:` commits.

**Scope:** `server` or `web`. Omit it when the change spans both.

**Subject:** imperative voice ("add", not "added"), no capital first letter, no trailing full stop, no emojis, under 72 characters.

**Body:** explain the why, not the what. Wrap at 72 characters. Optional for small changes.

## Testing

Expected behaviour is written down before the code that delivers it, never after. Two practices apply:

- **TDD (test-driven development):** you write a small test against one function, tool or route, watch it fail, then write the minimum code that makes it pass.
- **BDD (behaviour-driven development):** you write a Playwright spec that tells a customer or agent story from start to finish in the browser, named after the story (for example `Story 2: the Nguyen family quote is completed by the in-browser agent`), watch it fail, then build until the whole journey passes.

**Which to use:** use BDD when the change alters what a customer or agent sees or does across the pages; use TDD for everything else. When a change does both, write the BDD spec first, then a TDD test for each rule underneath it.

| Kind of change | Where the test goes |
| --- | --- |
| Pricing, eligibility, tiers, quote lifecycle | `server/tests/test_domain.py` |
| MCP tools, resources or prompt | `server/tests/test_mcp.py` |
| REST routes, rate limiting, cross-channel parity | `server/tests/test_http.py` |
| WebMCP adapter | `web/tests/unit/` |
| A user journey through the pages | `web/tests/e2e/` |

Worked example: say travellers aged 75 or over must be flagged for a medical assessment. Write the test first in `server/tests/test_domain.py`, asserting that a quote with a 76-year-old traveller returns `medical_assessment_required: true` and one with a 74-year-old returns `false`. Run `uv run pytest`, see it fail, then change `rules.py` until it passes.

A change that touches a requirement in the README coverage table (R-01 to R-12) must add or update a test listed against that requirement.

## Quality gates

| Gate | When | Pass threshold | On failure |
| --- | --- | --- | --- |
| `cd server && uv run pytest` | Before opening a pull request | All tests pass | Do not open the pull request until fixed |
| `cd web && npm run build` | Before opening a pull request | Type check and build succeed with no errors | Do not open the pull request until fixed |
| `cd web && npm test` | Before opening a pull request | All unit tests pass | Do not open the pull request until fixed |
| `cd web && npm run e2e` | Before opening a pull request | All Playwright specs pass | Do not open the pull request until fixed |
| Review | After the pull request is opened | One maintainer approval | Address the comments and push to the same branch |

## Service boundaries

| Area | Owns | Never touches |
| --- | --- | --- |
| `server/src/voyara/` domain (`catalogue`, `rules`, `pricing`, `quotes`) | Every price, eligibility rule and quote state change | HTTP, MCP or browser concerns |
| `server/src/voyara/mcp_server.py`, `api.py` | Mapping MCP tools and REST routes onto `QuoteService` | Pricing or eligibility logic |
| `web/src/webmcp/adapter.ts` | All calls to `navigator.modelContext` | Page logic |
| `web/src/pages/` | Page UI and the WebMCP tools each page registers | Pricing or eligibility logic; all data goes through `/api` |

Two rules must always hold:

- Both agent channels (MCP and WebMCP) call the same `QuoteService`, so the same trip always gets the same premium.
- Agents never complete a payment. The checkout page registers no WebMCP tools, and that stays the case.

## Pull requests

- **Title:** same format as a commit subject, `type(scope): subject`.
- **Description:** a bullet summary of what changed and why, and how you tested it. Link the issue with `Closes #<number>`.
- **Target:** `main` only.
- **No draft pull requests** unless you want early feedback.

### Merge strategy

Squash merge for small branches (one to three commits). Merge commit for larger branches where the individual commits tell a useful story. The merge commit subject matches the pull request title.

### Conflict resolution

If your branch is behind `main`, merge `main` into your branch and resolve conflicts in place:

```sh
git fetch upstream
git merge upstream/main
# resolve conflicts, then:
git add <resolved-files>
git commit
git push
```

Do not rebase a branch you have already pushed; that needs a force-push. Do not cherry-pick commits across branches.

### Branch retention

The author deletes the branch after the pull request is merged.

## Releases

There is no release process. This is a reference build with no versioned packages or deployments; `main` is always the current version.

## Reporting bugs

Raise an issue with the [Bug report](.github/ISSUE_TEMPLATE/bug_report.yml) template. It asks for the channel you used (MCP, WebMCP or plain web), the steps to reproduce, what you expected and what happened.

## Licence

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE).
