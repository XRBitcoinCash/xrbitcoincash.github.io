# AI Savepoints (XRBitcoinCash)

Authoritative, append-only checkpoints for pages/features. Each entry has a machine-readable twin in `/ai/savepoints`.

- **2025-10-31 — Liquidity Sentinel (active)**  
  File: `/ai/savepoints/2025-10-31.liquidity-sentinel.json`  
  Key guarantees:
  - `#app-config` immediately before main script
  - Xaman connect, challenge memo anti-spoofing
  - TrustSet uses `tfClearNoRipple` (allow rippling)
  - Health table + “Risk-only” filter
  - Desktop QR-only; Mobile deep-link
