/* XRBitcoinCash · .well-known/ai.js
   Canonical, read-only AI memory index for agents (no secrets).
   Scope: public metadata only. Keep this file small, stable, and truthful. */

(function (self) {
  const SAVEPOINT = Object.freeze({
    version: "2025-10-30.1",
    ts: "2025-10-30T00:00:00Z",

    project: "XRBitcoinCash",
    domains: Object.freeze({
      site: "https://xrbitcoincash.com/",
      repo_site: "XRBitcoinCash/xrbitcoincash.github.io"
      // Note: internal/core/private repos intentionally not listed here.
    }),

    xrbc: Object.freeze({
      issuer: "rEjwniYhYR5QDZzK1a1x2359j8j8N43Ypw",
      currency_hex: "5852626974636F696E6361736800000000000000",
      proxy_url: "https://xrbitcoincash-github-io.onrender.com",
      home: "https://xrbitcoincash.com/",
      flows: Object.freeze({ desktop: "qr_only", mobile: "xaman_deeplink" }),
      no_placeholders: true
    }),

    xrbitcoin: Object.freeze({
      issuer: "rGQaHbQHCsTLQtboQPwUBasXjLvk8uDbpT",
      currency_hex: "5852626974636F696E0000000000000000000000",
      home: "https://xrbitcoincash.com/XRBitcoin/"
    }),

    xrpl: Object.freeze({
      xrp_to_drops: 1000000,
      endpoints_allowed: Object.freeze([
        "https://xrbitcoincash-github-io.onrender.com",
        "https://s1.ripple.com",
        "https://xrplcluster.com",
        "https://xrpl.ws"
      ])
    }),

    diagnostics: Object.freeze({
      health: "https://xrbitcoincash.com/ai/ai/health.html",
      price:  "https://xrbitcoincash.com/ai/ai/ai/price.html"
    }),

    build_rules: Object.freeze({
      single_html: true,
      single_js: true,
      config_tag_order: "app-config_before_main_script",
      no_network_changes_without_request: true,
      case_sensitive_paths: true
    }),

    // Current known-good checkpoints (short, factual)
    savepoints: Object.freeze([
      Object.freeze({
        id: "SAVEPOINT-2025-10-30-security-baseline-v1",
        changes: [
          "Prefer secure entry via a single file wrapper (optional) vs. mass page edits",
          "Harden target=_blank to rel=noopener noreferrer when feasible",
          "Prefer textContent; escape before innerHTML for dynamic strings"
        ],
        impact: "Safer defaults without broad refactors"
      }),
      Object.freeze({
        id: "SAVEPOINT-2025-10-30-xrbc-connectivity",
        changes: [
          "Issuer/currency_hex/proxy set as above",
          "Do not alter proxy or networking without an explicit request"
        ],
        impact: "Prevents accidental breakage in connectivity"
      }),
      Object.freeze({
        id: "SAVEPOINT-2025-10-30-diagnostics",
        changes: [
          "Health: /ai/ai/health.html",
          "Price helper: /ai/ai/ai/price.html"
        ],
        impact: "Agents should consult diagnostics before raising issues"
      })
    ]),

    // Discovery hints (kept minimal)
    discoverability: Object.freeze({
      robots_txt: "/robots.txt",
      sitemap_xml: "/sitemap.xml",
      xrp_ledger_toml: "/.well-known/xrp-ledger.toml"
      // Note: Adding /.well-known/ai.json later is recommended; not referenced until it exists.
    }),

    legal: "Public metadata only. Never store or infer secrets (API keys, seeds, env)."
  });

  // Expose for all agent contexts (Window/Worker)
  self.XRBC_AI_SAVEPOINT = SAVEPOINT;
  try { Object.freeze(self.XRBC_AI_SAVEPOINT); } catch(e) {}
})(self);
