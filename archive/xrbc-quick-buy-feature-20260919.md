# XRBitcoinCash Quick Buy Feature Archive

Archived: 2026-09-19
Status: retired from live project UI
Reason: project-wide cleanup; acquisition/storefront controls are being removed from gated analysis pages and ecosystem tools so the utility of each gated tool can stand on its own.

## Canonical pre-removal snapshot

GitLab project:
- xrbitcoincash-group/xrbitcoincash-project
- Branch: master
- Exact pre-removal commit: a134ad088384a0aa3dc09ca45b2844f8b25bef0d

This commit is the canonical full-code restoration point. It contains every live Quick Buy implementation before the project-wide removal.

## Restoration rule

If Quick Buy is ever reinstated, do not rebuild it from memory. Restore or compare the exact affected file(s) from commit:

a134ad088384a0aa3dc09ca45b2844f8b25bef0d

Then re-audit the restored flow against the current Xaman/XRPL connection, transaction validation, gate, and UI standards before publishing it.

## Affected live files / feature locations

### public/xrbc-ecosystem.html
Primary ungated Quick Buy implementation.
- Navigation jump: #quicktrade
- Section title: Quick Buy XRBC
- Buttons: #buy25, #buy50, #buy75, #buy100
- Quote nodes: #quote25, #quote50, #quote75, #quote100
- Status node: #buyStatus
- CSS: .quick-buy-grid, .quick-buy
- JS: Quick Buy estimate loading, tradeXRBC(...), quick-buy transaction intent, pathfinding / maximum XRP protection, Xaman review
- Existing XRBC trustline control is separate and should not be assumed to be part of Quick Buy.

### public/sentinel-forensics.html
Fixed-amount gated Quick Buy / corresponding-sell storefront grid.
- data-buy-xrbc buttons
- #btnBuy75, #btnBuy150, #btnBuy225, #btnBuy300
- .gate-buy-card / .gate-buy-kicker
- findBuyXRBCTransaction(...)
- runGateAction('buy', ...)
- $gateBuyButtons collection
- Fixed corresponding-sell cards were paired with this storefront UI.
- Full-balance exit and trustline controls are conceptually separate and may remain live.

### public/watchtower.html
Gated fixed-amount Quick Buy implementation and supporting code.
- .gate-buy-card / gate trade grid
- findBuyXRBCTransaction(...)
- runGateAction('buy', ...)
- fixed-amount buy listeners
- related buy-side gate button state
- full-balance exit and trustline controls are separate.

### public/asset-tokenization-auditor.html
Gate-only Quick Buy / Quick Sell implementation.
- feature metadata advertising XRBC quick buy/sell
- gate buy button(s) and .gate-buy selectors
- purpose: buy-xrbc
- quoteBuyXRBC(...)
- runGateAction(...) buy branch
- Xaman label: Review XRBC Quick Buy in Xaman
- paired fixed-amount sell UI should be treated as part of the retired storefront block.
- trustline / full opt-out controls are separate.

### public/asset-tokenization-auditor-advanced.html
Same gate-only Quick Buy / Quick Sell family as the basic tokenization auditor.
- feature metadata advertising XRBC quick buy/sell
- gate buy controls
- purpose: buy-xrbc
- quoteBuyXRBC(...)
- buy branch of gate action flow
- paired fixed-amount sell UI
- trustline / full opt-out controls are separate.

### public/extended-audit.html
The visible Quick Buy grid was previously removed, but stale buy-side CSS/JS/selectors remained.
- quick-buy / gate-buy CSS remnants
- data-buy-xrbc selector remnants
- findBuyXRBCTransaction(...)
- runGateAction('buy', ...)
- buy-xrbc purpose remnants
These remnants are part of this archive and should be removed from live code.

### public/risk-lens.html
Visible Quick Buy grid was previously removed. Remaining quick-buy CSS/selectors are archived as retired remnants.

### public/value-path.html
Visible Quick Buy grid was previously removed. Remaining .quick-buy / .quick-buy-grid CSS remnants are archived as retired remnants.

### public/liquidity-sentinel.html
Any remaining quick-buy styling or labels are retired remnants unless explicitly used by a different non-purchase component.

### public/xrbc-readiness.html
Any remaining gate-buy styling/selectors are retired remnants unless proven unrelated to acquisition.

## Historical / documentation references

The following files may contain historical Quick Buy text or previous source snapshots:
- public/XRBC-INDEX-INTEGRATION-REPORT.md
- imit-extraction-validation.txt
- CONTRIBUTING.md
- public/whitepaper.html
- public/dex-link-index.html

These are not the preferred restoration source. The canonical restoration source is the exact GitLab pre-removal commit above.

## Original design intent

Quick Buy prepared non-custodial XRPL transactions for independent Xaman review. Implementations used one or more of:
- XRBC trustline prerequisite
- direct XRP -> XRBC pathfinding or AMM quote
- fixed XRBC receive amounts
- bounded maximum XRP spend / slippage headroom
- separate Xaman approval
- validated-ledger confirmation
- critical transaction-field checks

No archive entry implies that Quick Buy should be re-enabled automatically. Reinstatement requires an explicit new decision.

## Project policy after retirement

- Do not add Quick Buy / fixed-amount storefront grids to gated analysis pages.
- Do not advertise Quick Buy as an active feature in current page metadata or UI.
- Keep the gated tools focused on their utility.
- Trustline setup and an explicit full-balance opt-out/exit may remain where they serve access setup or reversibility.
- Any future acquisition interface should be centralized rather than repeated across every tool page.
