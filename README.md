Here’s a clean, drop-in **README.md** update that keeps your vibe while centering the new security/stress-test focus and the future-pairs caveat.

---

# XRBitcoinCash (XRBC) — Code, Faith & Ledger

> *"Le registre ne dort jamais.
> Entre les blocs, une promesse chuchotée."*
> (*The ledger never sleeps.
> Between the blocks, a whispered promise.*)

---

## ⧉ Introduction

XRBitcoinCash (**XRBC**) isn’t just another IOU on XRPL.
It is a **security-first experiment** in scarcity, legality, and cryptography — now explicitly **stress-testing the XAMAN (Xumm) wallet flow** and **XRPL primitives** while refining a safe, auditable way to trade **XRBC ↔ XRP**.

This repository is both:

* a **functional toolkit** — wallet connection, trustlines, AMM helper, order book, footer/legal anchors.
* a **cryptic monument** — commits as glyphs; source as poem; clarity as a defensive posture.

---

## ⧉ Token Parameters

* **Symbol**: `XRBC`
* **Issuer**: `rEjwniYhYR5QDZzK1a1x2359j8j8N43Ypw` *(blackholed, immutable, beyond temptation)*
* **Currency Code**: `5852626974636F696E6361736800000000000000`
* **Total Supply**: **21,000,000** — because legends matter.
* **Domain**: **xrbitcoincash.com**
* **Anchors**:

  * `/.well-known/xrp-ledger.toml` (identity manifest)
  * `/.well-known/security.txt` (responsible disclosure)
  * `/pgp-key.txt` (cryptographic anchoring)

---

## ⧉ What’s new (security & UX)

* **Mobile-only signing**: All orders/trustlines are signed **in XAMAN on mobile**.
  Desktop “Place Limit Order” is **read-only** and opens a **QR modal to the verified trade page**.
* **URL verification**: QR/modal copy emphasizes **checking `https://xrbitcoincash.com`** before signing.
* **Trustline first**: Guided TrustSet flow; XRBC constants (issuer/currency) are **hard-coded & audited**.
* **AMM “Best Price” helper**: Estimates include the **LP-voted AMM fee** and potential slippage.
  (Fee is **not a site fee**; it’s governed by LPs and may vary by pool conditions.)
* **Safer client**: No `eval`, no dynamic script injection, minimal localStorage (public address only),
  state cleared on disconnect, and reduced-motion respected for the animated background.
* **Desktop footer/layout**: Mobile-first sizing and better readability, without overflow on small screens.

---

## ⧉ Stress testing scope

**Wallet / XAMAN (Xumm) flows**

* Deep-link & QR handoff reliability, payload lifecycle (`createAndSubscribe`), cancel/reject paths.
* Resume logic after app-switch; **idempotent** UI updates when the page regains focus/visibility.
* Session hygiene: only the **public account** may be cached; cleared on disconnect.

**XRPL primitives**

* `ledger` (validated), `book_offers` (dual-sided view), `amm_info` (reserves + fee).
* Periodic refresh with defensive UI, error surfaces, and conservative fallbacks.

---

## ⧉ Repository Map

* **`index.html`** — Home portal.
* **`trade.html`** — XRBC/XRP **AMM + Orderbook** with **mobile-only signing** and desktop QR gating.
* **`/css/xrbc-trade.css`** — Dark Aurora theme, responsive footer, reduced-motion support.
* **`nfts.html`** — NFT utilities with inline legal cues.
* **`compliance.html`** — Compliance & Legal Center (SEC/MiCA/FCA/MAS/FinCEN notes + TOML checker).
* **`whitepaper.html`** — Vision + cryptographic ethos.
* **`privacy.html`, `terms.html`, `security-policy.html`** — Legal anchors.
* **`secure-xrpl.js` / inline scripts** — Minimal proxy bridge, typed transaction shapes.

---

## ⧉ Security & Trust (current posture)

* ✅ **Immutable issuer** (blackhole sealed).
* ✅ **Trustline verification** before meaningful actions.
* ✅ **Mobile-only signing**; desktop order button shows QR to the verified mobile page.
* ✅ **Constant transaction shapes** (XRPL `OfferCreate`, `TrustSet`); typed amounts/drops conversions.
* ✅ **No secrets in client**; **no key requests ever**; only public address may be cached locally.
* ✅ **Explicit URL hygiene** messaging (anti-phishing).
* ✅ **Reduced-motion** honored; **accessible** modal semantics & contrast targets.
* ✅ **No trackers/analytics** embedded in the trading page.

> *“Clarity as defense.
> Openness as shield.”*

---

## ⧉ AMM Fee & Slippage — plain-English

* XRBC↔XRP trades pay a **small AMM pool fee** chosen by the **liquidity providers (LPs)**, not this site.
* The fee exists to **compensate LPs** and **discourage short-lived arbitrage** that can drain pools.
* Our **Best Price** helper and totals already **include** the current AMM fee and estimate slippage.
* Some wallets/apps may also show a **separate service fee** — that is **wallet/app specific**.

*(The exact LP-voted fee can vary by pool governance. Copy is intentionally conservative and accurate.)*

---

## ⧉ Compliance & Lawful-Good stance

* **SEC Readiness Checklist** and **Jurisdictional Matrix** (MiCA, FCA, MAS, FinCEN, etc.).
* **Risk disclosures** baked into the UI; exportable for audits.
* **security.txt** + public channels for responsible disclosure.
* Client is **auditable**, un-obfuscated HTML/JS/CSS.

---

## ⧉ Roadmap: more pairs, but security first

We do plan to add **additional trading pairs**, however **not** before a deeper security & regulatory pass:

* Per-pair **allow-list** and issuer verification.
* **Feature flags** to enable pairs gradually after review.
* **Slippage caps**, **price-impact warnings**, and **size/rate limits** to reduce toxic order flow.
* Consistent **mobile-only signing** and QR gating across all pairs.
* Clear **fee disclosure** per pair (LP fee vs. any wallet/app service fee).
* Updated compliance notes per jurisdiction where relevant.

---

## ⧉ Threat model (condensed)

* **Phishing/Impersonation** → Mobilized signing, URL checks, issuer/currency constants.
* **Payload Tampering** → Static transaction schema; no eval; minimal, explicit DOM updates.
* **State Desync** → Focus/visibility refresh; retry windows; non-blocking status messaging.
* **User Error** → Trustline first; explicit totals; fee/slippage explainer; conservative helper text.

---

## ⧉ Disclaimers

* This repository = **code + poetry**; **not** financial advice.
* XRPL transactions are **final**; responsibility remains with the user.
* Compliance tools are **advisory scaffolds**, not legal determinations.
* AMM, order book, and UI are **experimental** presentations of XRPL primitives.

> *"Entre loi et rêve, nous écrivons."*
> (*Between law and dream, we write.*)

---

## ⧉ Commit Log as Oracle

Commits are meant to read like a ledger-poem while signaling engineering rigor:

* `sec(flow): enforce mobile-only signing; desktop QR gating for orders`
* `feat(trade): AMM helper includes LP fee + slippage, safer defaults`
* `ux(a11y): modal roles, reduced-motion background, footer responsive`
* `docs(readme): stress-testing scope for XAMAN & XRPL; roadmap for pairs`
* `chore(anchors): update /.well-known & legal pages`

> *"Chaque commit, une strophe.
> Chaque diff, une confession."*

---

### Contributing

Security first. Please prefer `sec:`, `feat:`, `fix:`, `docs:`, `chore:` prefixes and keep diffs auditable.
Responsible disclosures via **`/.well-known/security.txt`**.

---
