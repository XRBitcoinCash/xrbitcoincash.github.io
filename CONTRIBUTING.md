# Contributing to XRBitcoinCash

XRBitcoinCash welcomes technical, security, usability, accessibility, documentation, and XRP Ledger review.

The canonical live portal is https://xrbitcoincash.com/. This repository contains the public GitHub Pages implementation and earlier XRBitcoinCash web tooling.

## Useful review areas

- XRPL transaction construction and amount handling
- Xaman request, rejection, cancellation, and return flows
- issuer, currency, network, flag, path, and memo verification
- trust-line and wallet-state handling
- AMM, order-book, liquidity, and routing calculations
- safe DOM rendering and input validation
- mobile and desktop usability
- accessibility and reduced-motion behavior
- metadata, canonical URLs, structured data, and documentation accuracy

## Before opening an issue

1. Identify the exact page or component.
2. Describe the expected and observed behavior.
3. Include reproducible steps and the browser/device when relevant.
4. Include a public transaction hash or public XRPL address only when necessary.
5. Never post wallet secrets or credentials.

Security vulnerabilities must be reported privately through security@xrbitcoincash.com or the official disclosure routes in [SECURITY.md](SECURITY.md).

## Pull requests

Keep changes focused and auditable. Explain what changed, why it changed, how it was tested, and whether it affects transaction construction, Xaman flows, public metadata, legal disclosures, or user-visible risk information.

Do not describe experimental or unverified behavior as guaranteed, approved, secure, legally binding, or investment-grade.
