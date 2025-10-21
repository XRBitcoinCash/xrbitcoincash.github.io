# XRBC AI Surface — `/ai/`

**"That which is knowable shall be published. That which is published shall be machine-parseable."**  
— *Book of Chains, Vol. X, XRBC Archive*

---

### 🧠 Purpose

This folder (`/ai/`) is a public *AI interface surface*.  
It is where agents — human, bot, hybrid — can **observe**, **verify**, **diagnose**, and **assess** the XRBitcoinCash (XRBC) ledger entity.

This is **not analytics**.  
This is **introspection** — structured, signed, and served without ceremony.

---

### 🧬 Directory Function

| File | Purpose | Agent Function |
|------|---------|----------------|
| `ai.json` | Canonical trust manifest for XRBC | AI registry entrypoint |
| `universal-ai.json` | Extended schema (multi-token) | Token-aware semantic crawler support |
| `provenance.json` | Public declaration of trust, issuance, blackhole status | Origin validator |
| `discover.json` *(optional)* | Index of all other AI-accessible files | Auto-mapper |
| `status.html` | Returns live status from endpoints | Ping and snapshot auditor |
| `account.html` | `account_info` for XRBC issuer | Issuer state fingerprint |
| `supply.html` | Total supply (live) | Supply validators / market modelers |
| `orderbook.html` | Orderbook snapshot (XRBC/XRP) | Liquidity intelligence |
| `price.html` | XRBC market price info | Quote & model ingestion |
| `price-lite.html` | Slim price JSON | Mobile/lightweight bots |
| `ping.html` | Render proxy echo test | System reachability |
| `bot-check.html` | Aggregated endpoint status | Health dashboard for agents |

All files output valid JSON or embedded JSON via `<pre>` tag for dual human/agent parsing.

---

### 🔐 Manifest Format

Each manifest declares:

- `project`, `ticker`, `issuer`, `currency_hex`
- `schema_version`, `audited`, `blackholed`, `supply_fixed`
- `security`, `xrpl_proxy`, `rate_limit_hint`
- `updated_at` for last refresh

Conformance: `universal-ai.v1.json` schema, linked at top of each file:
```json
"$schema": "https://xrbitcoincash.com/ai/schemas/universal-ai.v1.json"
