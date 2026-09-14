/* XRBitcoinCash · .well-known/ai.js
   Canonical, read-only AI memory index for agents (no secrets).
   Agents must read the memory contract before planning or editing repository code.
   This file contains public project facts and workflow rules only. */

(function (self) {
  const MEMORY_CONTRACT = "https://raw.githubusercontent.com/XRBitcoinCash/-ai-savepoint-protocol-checkpointai/main/AI-SAVEPOINT-PROTOCOL-CHECKPOINT-TIA.md";
  const MEMORY_JSON = "https://raw.githubusercontent.com/XRBitcoinCash/-ai-savepoint-protocol-checkpointai/main/ai-memory.json";
  const SANDBOX_GUIDE = "https://raw.githubusercontent.com/XRBitcoinCash/-ai-savepoint-protocol-checkpointai/main/ai/sandbox/README.md";

  const SAVEPOINT = Object.freeze({
    version: "2026-09-14.2",
    ts: "2026-09-14T00:00:00Z",
    project: "XRBitcoinCash",
    domains: Object.freeze({
      site: "https://xrbitcoincash.com/",
      repo_site: "XRBitcoinCash/xrbitcoincash.github.io",
      repo_core: "XRBitcoinCash/xrbitcoincash-core",
      repo_savepoints: "XRBitcoinCash/-ai-savepoint-protocol-checkpointai"
    }),

    memory: Object.freeze({
      canonical_contract: MEMORY_CONTRACT,
      machine_readable: MEMORY_JSON,
      sandbox_guide: SANDBOX_GUIDE,
      read_before_edit: true,
      read_sequence: Object.freeze([
        "memory contract and machine-readable twin",
        "target repository instructions and security policy",
        "latest target-feature savepoint or release note",
        "exact target file, branch, and current commit"
      ]),
      missing_evidence: "stop and report; never invent values",
      one_bounded_change: true,
      archive_transcripts: false
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
      network: "XRP Ledger Mainnet",
      xrp_to_drops: 1000000,
      endpoints_allowed: Object.freeze([
        "https://xrbitcoincash-github-io.onrender.com",
        "https://s1.ripple.com",
        "https://xrplcluster.com",
        "https://xrpl.ws"
      ])
    }),

    model_routing: Object.freeze({
      luna: Object.freeze(["wording", "CSS", "documentation", "mechanical edits", "routine parsing"]),
      terra: Object.freeze(["contained implementation", "tests", "ordinary debugging"]),
      sol: Object.freeze(["multi-file XRPL/Xaman/Render integration", "security review", "difficult failures"]),
      astra: Object.freeze(["architecture", "ambiguous threat models", "deep research", "final high-risk audit"])
    }),

    sandbox: Object.freeze({
      path: "ai/sandbox/",
      mode: "local synthetic reversible experiments",
      forbidden: Object.freeze(["seeds", "private keys", "API secrets", "personal data", "real signing payloads", "wallet transactions", "live backend mutation"]),
      promotion: "human-reviewed patch plus relevant test suite"
    }),

    diagnostics: Object.freeze({
      health: "https://xrbitcoincash.com/ai/ai/health.html",
      price: "https://xrbitcoincash.com/ai/ai/ai/price.html"
    }),

    build_rules: Object.freeze({
      single_html: true,
      single_js: true,
      config_tag_order: "app-config_before_main_script",
      no_network_changes_without_request: true,
      case_sensitive_paths: true,
      no_production_sandbox_artifacts: true
    }),

    security: Object.freeze({
      target_blank_policy: "noopener_noreferrer",
      dom_write_policy: "textContent_or_escapeHTML",
      never_commit_secrets: true,
      public_reads_separate_from_signing: true,
      external_services_are_not_endorsements: true
    }),

    savepoints: Object.freeze([
      Object.freeze({
        id: "SAVEPOINT-2025-10-30-security-baseline-v1",
        impact: "Safer defaults without broad refactors"
      }),
      Object.freeze({
        id: "SAVEPOINT-2025-10-30-xrbc-connectivity",
        impact: "Prevents accidental connectivity changes"
      }),
      Object.freeze({
        id: "SAVEPOINT-2025-10-30-diagnostics",
        impact: "Agents consult diagnostics before raising issues"
      })
    ]),

    discoverability: Object.freeze({
      robots_txt: "/robots.txt",
      sitemap_xml: "/sitemap.xml",
      xrp_ledger_toml: "/.well-known/xrp-ledger.toml"
    }),

    legal: "Public metadata only. Never store or infer secrets, credentials, wallet seeds, or private keys. This index does not override model safeguards, repository permissions, user approval, or independent wallet review."
  });

  self.XRBC_AI_SAVEPOINT = SAVEPOINT;
  self.XRBC_AI_MEMORY = SAVEPOINT.memory;
  try {
    Object.freeze(self.XRBC_AI_SAVEPOINT);
    Object.freeze(self.XRBC_AI_MEMORY);
  } catch (_) {}
})(self);
