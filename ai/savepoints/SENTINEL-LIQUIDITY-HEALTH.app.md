# Sentinel Liquidity Health — Xaman App Savepoint
Version: 2025-10-31
Scope: App registry + frontend wiring notes (NO SECRETS)

## App
- Name: Sentinel Liquidity Health
- Console: https://apps.xumm.dev
- Public App Key (safe for frontend): **f3efcfc9-90d0-4c06-b632-b4680f24c207**
- App Secret: **NOT STORED HERE**. Keep only in secure secret manager or server env.

## Purpose
Scan wallet-held XRPL IOUs and score exit-route quality using AMM and order books:
- Labels: Healthy / Caution / Risk
- No custody. User signs in Xaman.

## URLs
- Homepage: https://xrbitcoincash.com/
- Support:  https://github.com/XRBitcoinCash/xrbitcoincash.github.io/issues
- Terms:    https://xrbitcoincash.com/terms.html
- Privacy:  https://xrbitcoincash.com/privacy.html
- Webhook:  none
- Sign-in with Xaman: not enabled; add Redirect URIs later if needed.

## Security policy
- Never commit App Secret.
- Server-side usage only:
  - `XUMM_APP_KEY=...`
  - `XUMM_APP_SECRET=...`
- Frontend usage:
  - Only `xummApiKey` from `#app-config`.
- Rotation (recommended anytime a secret appears in logs or chats):
  1) Xaman console → App → **Rotate Secret**.
  2) Update server env `XUMM_APP_SECRET`.
  3) Restart proxy. No frontend change required unless you also rotate the public key.

## Frontend wiring (pages using Xaman)
Keep the existing pattern: `<script id="app-config">` JSON **immediately before** the main script.

Minimal example:
```html
<script type="application/json" id="app-config">
{
  "proxyUrl": "https://xrbitcoincash-github-io.onrender.com",
  "xummApiKey": "f3efcfc9-90d0-4c06-b632-b4680f24c207",
  "networks": { "mainnet": { "label": "Mainnet" }, "testnet": { "label": "Testnet" } }
}
</script>
Notes:

Do not move this tag below scripts.

Do not expose any secrets in HTML/JS.

Keep desktop = QR-only, mobile = deep-link.

Server-side call template (no secret in repo)
For testing from a secure host or dev shell (Linux/macOS):

bash
Copy code
export XUMM_API_KEY='YOUR_KEY'
export XUMM_APP_SECRET='YOUR_SECRET'
curl --silent --request POST https://xumm.app/api/v1/platform/ping \
  --header "x-api-key: ${XUMM_API_KEY}" \
  --header "x-api-secret: ${XUMM_APP_SECRET}" \
  --header 'content-type: application/json' \
  --data '{}' | python -m json.tool
Page to implement next
File: /sentinel-liquidity-health.html (public site)

Reuse stop-loss connect flow and UI cards.

Add token scan, price refs via amm_info and book_offers, score per token, ordered list, and sequential actions.

Include Quick Buy XRBC block and existing widget footer.

Asset
Icon: use sentinel_liquidity_health_1024.png (and maskable variants) already prepared in working files. Store final copies in the site repo under /favicons/ or root as needed.

QA checklist
Desktop QR shows on Connect; mobile deep-links into Xaman.

No network changes; proxy stays https://xrbitcoincash-github-io.onrender.com.

No innerHTML with unsanitized external data.

#app-config parses without error in console.

Testnet toggle does not leak Secret; server paths guard POSTs.

Provenance
Owner: XRBitcoinCash
Created: 2025-10-31
Edits: append changes below, newest first.

kotlin
Copy code

Note: your **App Secret appears in this chat transcript**. Rotate it now or accept the risk.






