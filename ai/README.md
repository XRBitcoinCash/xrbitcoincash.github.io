XRBC AI Surface — /ai/

“That which is knowable shall be published. That which is published shall be machine-parseable.”
— Book of Chains, Vol. X, XRBC Archive

Purpose

This folder exposes a public, agent-readable interface for XRBitcoinCash (XRBC) so humans, scripts, and AIs can observe, verify, and audit the project without ceremony.

Not analytics. It’s structured introspection and provenance.

Machine-first. Every page must be trivially parseable.

Canonical constants (do not change)

Issuer: rEjwniYhYR5QDZzK1a1x2359j8j8N43Ypw

Currency HEX: 5852626974636F696E6361736800000000000000

XRPL proxy (authority): https://xrbitcoincash-github-io.onrender.com

Public surfaces (where agents should look)

Primary site (prod):

Well-known AI index → https://xrbitcoincash.com/.well-known/ai.json

Project manifest → https://xrbitcoincash.com/universal-ai.json

Provenance/recert → https://xrbitcoincash.com/ai/provenance.json

Developer aide (GitHub Pages):

Auditor commands (copy/paste) → https://xrbitcoincash.github.io/ai/auditor-commands.html

These endpoints are intentionally simple, cache-friendly JSON/text for crawlers and scripts.

Directory function (agent map)
File/Path	Purpose	Agent Function	Notes
/ai/ai.json	Canonical trust manifest for XRBC	AI registry entrypoint	Optional if using well-known only
/universal-ai.json	Expanded, multi-entity manifest	Token-aware semantic crawling	Root of site (not inside /ai/)
/ai/provenance.json	Public declaration of last audit/recert & immutability hints	Origin/provenance validator	Drives “Security Recertification” countdown
/ai/discover.json (optional)	Index of other AI-accessible files	Auto-mapper	Keep tight, stable keys
/ai/status.html (optional)	Live status snapshot (embedded JSON)	Ping + snapshot auditor	Returns HTML with a <pre>{…}</pre> JSON block
/ai/account.html (optional)	account_info for issuer	Issuer state fingerprint	Embedded JSON (<pre>)
/ai/supply.html (optional)	Circulating/total supply (live)	Supply validators	Embedded JSON (<pre>)
/ai/orderbook.html (optional)	book_offers (XRBC/XRP)	Liquidity intelligence	Embedded JSON (<pre>)
/ai/price.html (optional)	Price view (rich)	Quote/model ingestion	May include human text + embedded JSON
/ai/price-lite.html (optional)	Slim JSON price	Mobile/lightweight bots	Pure JSON
/ai/ping.html (optional)	Proxy echo test	Reachability check	Pure text or JSON { "ok": true }
/ai/bot-check.html (optional)	Aggregated endpoint status	One-glance health	Embedded JSON (<pre>)
/ai/schemas/ (optional)	JSON Schemas	Validation hints	e.g., universal-ai.v1.json
/ai/reports/ (optional)	Frozen audit artifacts	Long-term references	Static JSON/HTML
/ai/cache/ (optional)	Cached reads (ttl)	Throttle external hits	If used, document TTLs

Output rule: Each page must return valid JSON (or embedded JSON inside <pre>) so both humans and agents can consume it.

Manifest formats (minimal, machine-first)
A) .well-known/ai.json (site index)

Role: tiny “you are here” pointer for crawlers.

{
  "$schema": "https://xrbitcoincash.com/ai/schemas/universal-ai.v1.json",
  "project": "XRBitcoinCash",
  "ticker": "XRBC",
  "issuer": "rEjwniYhYR5QDZzK1a1x2359j8j8N43Ypw",
  "currency_hex": "5852626974636F696E6361736800000000000000",
  "manifests": {
    "universal": "https://xrbitcoincash.com/universal-ai.json",
    "provenance": "https://xrbitcoincash.com/ai/provenance.json"
  },
  "xrpl_proxy": "https://xrbitcoincash-github-io.onrender.com",
  "schema_version": "1.0",
  "updated_at": "2025-10-21T00:00:00Z"
}

B) universal-ai.json (expanded manifest)

Role: the “truthy, stable anchor” for multi-entity & audit keys.

{
  "$schema": "https://xrbitcoincash.com/ai/schemas/universal-ai.v1.json",
  "project": "XRBitcoinCash",
  "ticker": "XRBC",
  "issuer": "rEjwniYhYR5QDZzK1a1x2359j8j8N43Ypw",
  "currency_hex": "5852626974636F696E6361736800000000000000",
  "blackholed": true,
  "supply_fixed": true,
  "security": {
    "desktop_qr_only": true,
    "no_placeholder_endpoints": true
  },
  "endpoints": {
    "provenance": "https://xrbitcoincash.com/ai/provenance.json",
    "orderbook": "/ai/orderbook.html",
    "account": "/ai/account.html",
    "supply": "/ai/supply.html",
    "status": "/ai/status.html"
  },
  "xrpl_proxy": "https://xrbitcoincash-github-io.onrender.com",
  "schema_version": "1.0",
  "updated_at": "2025-10-21T00:00:00Z"
}


Keep keys stable. Add new keys conservatively; never silently change types.

Provenance format (/ai/provenance.json)

This drives public recert & immutability hints. Keep it small & explicit.

{
  "project": "XRBitcoinCash",
  "updated": "2025-10-21T00:00:00Z",
  "recert_after_days": 90,
  "immutable_hash": "sha256:<commit-or-artifact-hash>",
  "source": "xrbitcoincash.github.io",
  "ledger_index": null,
  "notes": "Public recert timer; values change only on real updates.",
  "signature": null
}


immutable_hash: hash of a frozen artifact (e.g., report bundle or manifest commit).

signature: include only if you actually sign; otherwise null is clearer than a fake.

Response shape (recommended keys for embedded JSON pages)

If you publish live snapshots (status.html, orderbook.html, etc.), embed a single <pre> with something like:

{
  "status": "ok",
  "source": "https://xrbitcoincash-github-io.onrender.com",
  "freshness_ms": 1234,
  "ledger_index": 123456789,
  "caution": 0,
  "score": 100
}


Do not fabricate fields you don’t actually compute. Omit them.

Caching & MIME

Manifests/Provenance: Content-Type: application/json

Live snapshots: allow short caching or no-store if highly dynamic

Frozen reports: long max-age is fine

Rate-limit etiquette (for external agents)

Be nice: 1–2 req/sec max to dynamic pages.

Prefer price-lite.html or manifest links if you only need basics.

Guardrails (why they matter to agents too)

One proxy authority: https://xrbitcoincash-github-io.onrender.com

No placeholders/dummy values in public JSON

Keep file casing canonical (case errors → 404 in prod)

If you embed JSON in HTML, ensure it’s valid JSON between <pre>…</pre>

Quick verification (copy/paste)

curl:

# Proxy health
curl -s -o /dev/null -w "%{http_code}\n" https://xrbitcoincash-github-io.onrender.com/healthz

# AI surfaces
for u in \
  https://xrbitcoincash.com/.well-known/ai.json \
  https://xrbitcoincash.com/universal-ai.json \
  https://xrbitcoincash.com/ai/provenance.json
do
  printf "%s -> " "$u"; curl -s -o /dev/null -w "%{http_code}\n" "$u"
done


PowerShell:

(iwr https://xrbitcoincash-github-io.onrender.com/healthz -UseBasicParsing).StatusCode
$urls = @(
  "https://xrbitcoincash.com/.well-known/ai.json",
  "https://xrbitcoincash.com/universal-ai.json",
  "https://xrbitcoincash.com/ai/provenance.json"
)
$urls | % { "$_ -> " + (iwr $_ -UseBasicParsing).StatusCode }

Auditor jump-off (dev convenience)

Commands & examples: https://xrbitcoincash.github.io/ai/auditor-commands.html

Versioning & anchor

schema_version increments only on breaking or additive schema changes.

Use this checksum to anchor token identity in agent logs:
CHECKSUM_HEX=5852626974636F696E6361736800000000000000
