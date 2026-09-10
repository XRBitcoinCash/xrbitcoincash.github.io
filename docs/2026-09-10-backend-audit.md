# Backend continuation checkpoint — September 10, 2026

## Source baseline

- Repository: https://github.com/XRBitcoinCash/xrbitcoincash.github.io
- Verified remote branch: `main`
- Baseline commit: `9c14827cacf33c700352fb4aa2b21989b49ab7e0` (September 10, 2026, 11:58:16 UTC)
- Local work branch: `codex/repository-cleanup-20260910`
- Scope of this pass: Developer API request identity and documented errors, backend installation and existing access-control regression tests.

The baseline already includes API v1 mounting, Xaman credential health checks, server-side signed-wallet access and XRBC holdings checks, public proxy method restrictions, request limits, and 31 regression tests. The baseline tree had no recent repository-wide continuation document. Deployment status was not established by this local audit.

## Changes prepared

1. **Required assets are explicit.** The shared `asset` validator previously substituted XRBC when a required request-body asset was omitted. This could produce a quote for the wrong assumed asset or compare a receipt to an assumed XRBC invoice. Missing trade `from`/`to`, bridge `asset`, or invoice `asset` now returns HTTP 400. Public query endpoints retain their explicit XRBC default. Holding thresholds and wallet-signing behavior are unchanged.
2. **Either documented installation layout can start.** A clean installation from the repository root failed with `Cannot find module 'express-rate-limit'`, although the root start script launches the server. The root manifest now declares that dependency, uses the same patched `qs` override as the backend package, and includes a dependency lockfile. The root test script and server test dependency resolution now support installation at either the root or `xrpl-proxy`.
3. **Local health checks use the server's default port.** The backend health script previously used 8787 when `PORT` was unset; it now uses 10000, matching the server.
4. **Receipt contracts document pending validation.** OpenAPI now declares HTTP 409 for an unvalidated transaction on receipt lookup and settlement verification. An unvalidated transaction cannot confirm settlement.
5. **Installed dependencies stay out of source control.** Added a `node_modules/` ignore rule.

## Verification completed

- Installed the committed backend lockfile with `npm ci --ignore-scripts` in `xrpl-proxy`.
- Original baseline: all **31 tests passed**.
- Updated code: all **32 tests passed** using the backend installation.
- Isolated root-only production dependency installation: `npm ci --ignore-scripts --omit=dev`, then all **32 tests passed**, including the actual Express middleware stack with mocked external transport.
- The new request-identity regression returned HTTP 200 instead of 400 against the original API; the missing HTTP 409 schema checks also failed against the original schema. Both pass with the prepared changes.
- `git diff --check` passed.

Tests use synthetic wallet accounts, test-only credentials, mocked Xaman responses, and mocked ledger transport. This work did not submit live wallet requests, send communications, change environment values, or deploy. Passing local tests is not evidence that a production deployment contains these changes.

## Integration and next work

- Synchronize the frontend's published OpenAPI JSON with `xrpl-proxy/openapi.json` when the frontend changes are integrated.
- In the developer portal, `walletAuthentication: configured` only means credentials exist. A ready state requires `walletAuthenticationVerified: true`; configured but unverified must not be presented as confirmed authentication readiness.
- Preserve current XRBC holding requirements: Extended Auditor 50; Sentinel Forensics 150; Risk Lens 150; Value Path 400; Watchtower 1000; Advanced Tokenization 2500; Bridge Integrity Monitor 10.
- Continue the separately authorized page-by-page frontend and repository audit. This checkpoint does not claim that all legacy HTML pages, every backend legacy route, or live wallet/device flows have been comprehensively reviewed.
- Before integration, compare the remote head with the recorded baseline, review the focused diff and frontend/backend contract parity, and record the actual commit and deployment verification outcome.
