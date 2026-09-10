# Tracker supply API checkpoint — 2026-09-10

- Repository: https://github.com/XRBitcoinCash/xrbitcoincash.github.io
- Verified baseline main: `4f85d484fca92c13bcc861df471afe517e015c7a`.
- Work branch: `codex/tracker-supply-api-20260910`, isolated from frontend/discovery work.
- Status at this source checkpoint: implemented and tested locally; repository review/publication pending. Not deployed to Render. Do not present the new URLs as currently live.

## Change

API v1.1.0 provides `/supply/xrbc`, bare decimal feeds `/supply/xrbc/total`, `/supply/xrbc/circulating`, `/supply/xrbc/max`, and `/metrics/xrbc`. Full integration instructions and the allocation policy procedure are in [tracker-supply-api.md](tracker-supply-api.md).

Total supply includes issuer obligations, individually frozen balances and escrow amounts for the exact XRBC currency/issuer. It follows empty filtered escrow pages and refuses incomplete/mixed/stale evidence. Arithmetic preserves decimal strings. Circulating supply requires an explicitly reviewed allocation policy. The policy currently remains pending with no invented team addresses. The maximum is the sourced project-declared design cap, not a claimed immutable ledger maximum.

The previous `xrbc_supply.json` contained an unrelated Flask placeholder with a sample billion-token total. It is replaced with valid JSON pointing integrators toward the implemented API paths. No dependencies, wallet routes, holding thresholds, credentials, deployment settings, or CI files changed.

## Verification

- All **44 tests pass**, including 12 new tracker supply tests and all 32 existing regressions.
- Command: `npm test`, using the previously installed committed dependencies via `NODE_PATH` from the existing backend/root-install check. No package/lockfile edits or new installation were needed.
- JavaScript syntax and `git diff --check` pass. OpenAPI parses and its new scalar format and route parameters are tested.
- A local instance of the new handler performed read-only HTTP JSON-RPC calls to the real XRPL server. Result: HTTP 200; total `20999933.67841492`; frozen `0`; escrowed `0`; declared maximum `21000000`; circulating null (allocation review pending).
- Ledger checkpoint: index `106892195`, hash `5973C225D2498A88265F237FEAA4965E66EC0DC79AC7346463602060B96C203A`, closed `2026-09-10T14:48:51.000Z`, age 30 seconds at response. Three escrow inventory pages were followed, with zero matching XRBC escrows. These are dated test observations, not permanently current supply values.
- Live smoke transport used curl to make the handler's read-only ledger requests in this environment. This is not evidence of a Render deployment, tracker acceptance or a wallet transaction test.
- Existing GitHub workflow is a passing stub named `Well-Known & AI Manifests — Validate`; its green result is not API test coverage. This change leaves the workflow unchanged and reports the local regression evidence explicitly.

## Required project fact and next steps

Ask the project owner for the complete non-circulating team, treasury, vesting and locked-account list, with reasons/evidence, or an explicit confirmation that no such accounts exist. Never infer that statement from an empty policy list. Whole-account exclusions are supported; partial-account allocations need a deliberate extension.

After reviewing that statement, publish the allocation methodology and set the policy to `project-reviewed` with the actual review date and evidence URL. Then verify the numeric circulating route. Before production, review the diff and obtain the specific publication/deployment authorization required by approval review. Earlier approval for GitLab MR !6 concerned the five discovery files; it is not a substitute for a review of this new backend change.

Keep the larger frontend cleanup separate. Do not resubmit tracking forms with new URLs until deployment and public endpoint checks succeed. Backend OpenAPI is updated here; the separate frontend portal still needs its catalog refreshed after API deployment.
