# XRBC supply API for token trackers

API v1.1.0 extends the existing backend. These routes become public only after this revision is merged and deployed. The implementation uses the current XRBC issuer and currency; it does not change wallet flows or holding gates.

Base URL: `https://xrbitcoincash-github-io.onrender.com/api/v1`

| Tracker field | Path | Response |
| --- | --- | --- |
| Full supply information | `/supply/xrbc` | JSON with `data` and `meta` |
| Total Supply API | `/supply/xrbc/total` | Bare decimal text |
| Circulating Supply API | `/supply/xrbc/circulating` | Bare decimal text after allocation review; otherwise HTTP 503 |
| Max Supply API | `/supply/xrbc/max` | Project-declared design cap as bare decimal text; withheld if below observed total |
| Supply and market metrics | `/metrics/xrbc` | JSON with supply, current pool/books, estimate labels and ledger evidence |
| Machine-readable contract | `/openapi.json` | OpenAPI 3.1, API version 1.1.0 |

The three scalar routes return `text/plain` with a number only: no commas, ticker, quotes or JSON wrapper. JSON consumers should use `data.totalSupply`, `data.circulatingSupply`, and `data.maxSupply` from `/supply/xrbc`; these are decimal strings or null. Parse using decimal-capable software if exact digits matter. The backend does not convert supply balances to JavaScript Number.

No API key or wallet sign-in is required for these public reads. Existing 60 requests/IP/minute and server capacity limits apply. Concurrent same-ledger supply requests share bounded cached work. Responses remain `Cache-Control: no-store`; freshness is checked against the validated ledger and stale evidence is not served as current.

## Supply definitions

**Total supply** means current outstanding issued XRBC: unfrozen issuer obligations plus individually frozen balances plus XRBC held in escrow. It is not a historical sum of every issuance transaction. Returning tokens to the issuer removes outstanding obligations, so the difference between the design cap and current total is not labelled as an independently verified burn count.

`gateway_balances` supplies obligations and frozen account balances. The API enumerates the issuer's escrow inventory with `account_objects`, following markers even on empty filtered pages. It counts an escrow only when both the currency and issuer match XRBC. It does not use the currency-only `gateway_balances.locked` map: issuer-owned escrow of another issuer's token with the same currency code must not inflate XRBC supply. A ten-page bound, repeated marker, duplicate object, mismatched ledger, malformed amount, incomplete inventory, or unavailable upstream prevents a successful numeric supply response.

**Circulating supply** under this published methodology equals total minus escrow, individually frozen balances, and reviewed non-circulating account balances. An account already counted as frozen is not deducted twice. Publicly traded pool/exchange balances are not automatically excluded. Team, treasury, vesting and ownership classifications require project evidence; ledger activity alone cannot establish them. Individual trackers may use different eligibility rules and must review the methodology.

The committed policy remains `pending`, so circulating supply is **null**, and the scalar circulating route returns **HTTP 503**. An unreviewed empty exclusion list is not a statement that all tokens circulate. No example or guessed team address is installed in production policy.

**Maximum supply** is the project's published **21,000,000 XRBC design target**. The response calls it `project-declared` and sets `maxSupplyVerifiedOnLedger: false`. No immutable maximum or blackhole proof is inferred from an account flag, a trustline limit, or an aggregate balance. If measured total exceeds the declaration, the maximum field becomes null and its scalar route returns HTTP 503; the original declaration remains visible separately for review.

## Completing the allocation policy

Edit `xrpl-proxy/supply-policy.json` through normal source review. The policy is loaded at process startup; redeploy after a reviewed change.

1. Obtain the project's complete list of non-circulating team, treasury, vesting and locked accounts, including a reason and a public evidence URL for each. Public addresses only; never private keys or credentials.
2. If no such accounts exist, document that explicit project statement rather than guessing from an empty list.
3. Publish the allocation explanation and set `circulation.evidenceUrl` to it, `reviewedAt` to the actual `YYYY-MM-DD` review date, and `reviewStatus` to `project-reviewed`.
4. Add each applicable account to `exclusions` using `{ "address": "PUBLIC_CLASSIC_ADDRESS", "reason": "team", "evidenceUrl": "https://your-public-allocation-evidence" }`. Allowed reasons: `team`, `treasury`, `vesting`, `locked`, `other`. The example is not a valid production address. Partial-account allocations are not supported: only list an account when its entire XRBC holding qualifies for exclusion.
5. The service reads those accounts' current balances at the same validated ledger as the total; balances are not hardcoded. It publishes the address, classification, evidence link and amount for independent review. The maximum is 50 distinct exclusions.

Invalid, duplicate, issuer, unsupported-category, missing-evidence, or incorrectly dated policy entries fail closed. API query parameters cannot override policy or inject supply values. A reviewed policy is a project declaration, not an independent audit or tracker acceptance.

## Metrics and limitations

`/metrics/xrbc` combines the supply snapshot with the existing public AMM and bounded funded-order-book data at one ledger. It retains pool reserves, XRP reserve-ratio price, liquidity fees and book coverage information.

- `estimatedMarketCapXrp` is the AMM reserve-ratio price multiplied by reviewed circulating supply. It is null while circulation is unreviewed or a pool price is unavailable.
- `estimatedFullyDilutedValueXrp` uses the same ratio and project-declared maximum. It is an estimate, not a last-traded, executable or independently aggregated valuation.
- `marketCapUsd`, `volume24h`, and `priceChange24h` remain null. Reliable values need appropriate price inputs and complete durable trade history; a reserve ratio or a bounded transaction sample cannot substitute for them.
- No gated holder-level report, composite risk score, wallet signing or transaction submission is exposed by these endpoints.

Every full response includes the validated ledger hash/index, ledger close time, age, fetch time, source and component methodology. Scalar responses expose ledger headers and `X-XRBC-Supply-Basis`; their `Link` header points to the full methodology response. Gateways retain XRPL aggregate precision; this service preserves reported strings and performs subsequent additions/subtractions exactly.

On HTTP 429/502/503, treat the value as unavailable. Respect `Retry-After` where present; never substitute zero, reuse a stale value as current, or calculate market capitalization from null circulation.

## Verification and references

Run `npm test` with dependencies installed using either supported repository installation layout. Tests cover precision, policy validation, frozen/escrow accounting, double exclusions, pagination, stale/mismatched ledgers, unknown values, scalar response headers, and current market-estimate boundaries, alongside existing wallet/authentication regressions.

- [XRPL gateway_balances](https://xrpl.org/docs/references/http-websocket-apis/public-api-methods/account-methods/gateway_balances)
- [XRPL implementation of obligations, frozen balances, and escrow reporting](https://github.com/XRPLF/rippled/blob/release/3.3.x/src/xrpld/rpc/handlers/account/GatewayBalances.cpp)
- [CoinGecko supply methodology](https://www.coingecko.com/en/methodology)
- [XRBC declared design supply](https://xrbitcoincash.com/whitepaper.html)

The root `xrbc_supply.json` is now valid discovery JSON. Its previous contents were a non-deployed Flask example with placeholder identities, an unrelated sample total, incomplete trustline pagination and unsafe zero-on-error behavior. Do not use that file as a numeric supply feed.
