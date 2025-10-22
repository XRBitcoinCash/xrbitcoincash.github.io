// xrpl-proxy/server.js
// XRBitcoinCash — Read-only XRPL JSON-RPC proxy (Express)
// - Strict allowlist of methods (no custody, no signing)
// - Per-IP token-bucket rate limiting (RPS + burst)
// - Round-robin upstream selection with failover
// - CORS (allow configured origins), Helmet, Compression
// - /healthz probes server_state; /diag shows config
// - Stable, machine-friendly JSON responses
//
// Requirements: Node 18+ (built-in fetch). If not, install node-fetch.

import express from "express";
import compression from "compression";
import helmet from "helmet";
import cors from "cors";

// Optional fallback for Node < 18
let _fetch = globalThis.fetch;
if (typeof _fetch !== "function") {
  try {
    const nf = await import("node-fetch");
    _fetch = nf.default;
  } catch {
    console.warn("[warn] fetch not available; please run on Node >= 18 or add node-fetch");
  }
}
const fetch = _fetch;

const app = express();

// ------------------------------
// Config (env-driven)
// ------------------------------
const VERSION = process.env.PROXY_VERSION || "2025.10.22";
const PORT = Number(process.env.PORT || 8080);

// Public, read-only XRPL JSON-RPC upstreams (HTTPS)
const UPSTREAMS = (process.env.UPSTREAMS || "")
  .split(",")
  .map(s => s.trim())
  .filter(Boolean);

// Provide safe defaults only if env not set.
// (You can override in Render dashboard: UPSTREAMS="https://xrplcluster.com")
const FALLBACK_UPSTREAMS = [
  "https://xrplcluster.com" // JSON-RPC POST; replace/augment via env if needed
];
const UPSTREAM_POOL = UPSTREAMS.length ? UPSTREAMS : FALLBACK_UPSTREAMS;

// Allowed XRPL methods — align with public manifests (advisory only)
const ALLOWED_METHODS = (process.env.ALLOWED_METHODS || [
  "server_state",
  "ledger",
  "account_info",
  "book_offers",
  "amm_info"
]).toString().split(",").map(s => s.trim());

// Timeouts / limits
const RPC_TIMEOUT_MS = Number(process.env.RPC_TIMEOUT_MS || 9000);
const JSON_LIMIT = process.env.JSON_LIMIT || "32kb";

// Rate limit (token bucket per IP)
const RATE_LIMIT_RPS = Number(process.env.RATE_LIMIT_RPS || 3);
const RATE_LIMIT_BURST = Number(process.env.RATE_LIMIT_BURST || 6);

// CORS
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || [
  "https://xrbitcoincash.com",
  "https://xrbitcoincash.github.io",
  "https://xrbitcoincash.info"
]).toString().split(",").map(s => s.trim());

// ------------------------------
// Middleware
// ------------------------------
app.set("trust proxy", true);
app.disable("x-powered-by");

app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" }
}));
app.use(compression());

app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true); // allow curl/CLI
    if (ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
    return cb(null, false);
  },
  methods: ["POST", "GET", "OPTIONS"],
  allowedHeaders: ["Content-Type"],
  maxAge: 600
}));

app.use(express.json({ limit: JSON_LIMIT }));

// Simple request logger (minimal)
app.use((req, res, next) => {
  res.setHeader("X-XRBC-Proxy-Version", VERSION);
  res.setHeader("Cache-Control", "no-store");
  next();
});

// ------------------------------
// Token bucket rate limiter
// ------------------------------
const buckets = new Map(); // ip -> { tokens, last }
function rateCheck(ip) {
  const now = Date.now();
  let b = buckets.get(ip);
  if (!b) {
    b = { tokens: RATE_LIMIT_BURST, last: now };
    buckets.set(ip, b);
  }
  const elapsed = (now - b.last) / 1000;
  b.tokens = Math.min(RATE_LIMIT_BURST, b.tokens + elapsed * RATE_LIMIT_RPS);
  b.last = now;

  if (b.tokens >= 1) {
    b.tokens -= 1;
    return true;
  }
  return false;
}

app.use((req, res, next) => {
  const ip = req.ip || req.connection?.remoteAddress || "unknown";
  if (!rateCheck(ip)) {
    res.status(429).json({
      error: "rate_limited",
      hint: `Max ~${RATE_LIMIT_RPS} rps with burst ${RATE_LIMIT_BURST}`,
      ts: new Date().toISOString()
    });
    return;
  }
  next();
});

// ------------------------------
// Round-robin upstream selector
// ------------------------------
let rr = 0;
function pickUpstream() {
  const url = UPSTREAM_POOL[rr % UPSTREAM_POOL.length];
  rr++;
  return url;
}

// ------------------------------
// Helpers
// ------------------------------
function withTimeout(ms) {
  const ac = new AbortController();
  const id = setTimeout(() => ac.abort(), ms);
  return { signal: ac.signal, cancel: () => clearTimeout(id) };
}

function badRequest(res, msg) {
  res.status(400).json({ error: "bad_request", message: msg });
}

function isObject(v) {
  return v && typeof v === "object" && !Array.isArray(v);
}

// ------------------------------
// Health endpoints
// ------------------------------
app.get("/healthz", async (req, res) => {
  const upstream = pickUpstream();
  const payload = { method: "server_state", params: [{}] };

  const t = withTimeout(Math.min(4000, RPC_TIMEOUT_MS));
  const started = Date.now();
  try {
    const r = await fetch(upstream, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: t.signal
    });
    const elapsed_ms = Date.now() - started;
    if (!r.ok) {
      return res.status(503).json({
        ok: false,
        upstream,
        status: r.status,
        elapsed_ms,
        error: "upstream_not_ok"
      });
    }
    const json = await r.json().catch(() => null);
    return res.json({
      ok: true,
      upstream,
      elapsed_ms,
      server_state: json?.result?.state || null,
      complete_ledgers: json?.result?.state?.complete_ledgers || null,
      time: new Date().toISOString(),
      version: VERSION
    });
  } catch (e) {
    const elapsed_ms = Date.now() - started;
    return res.status(504).json({
      ok: false,
      upstream,
      elapsed_ms,
      error: String(e && e.name === "AbortError" ? "timeout" : e)
    });
  } finally {
    t.cancel();
  }
});

app.get("/diag", (req, res) => {
  res.json({
    ok: true,
    version: VERSION,
    upstreams: UPSTREAM_POOL,
    allowed_methods: ALLOWED_METHODS,
    rate_limit: { rps: RATE_LIMIT_RPS, burst: RATE_LIMIT_BURST },
    json_limit: JSON_LIMIT,
    cors: { allowed_origins: ALLOWED_ORIGINS },
    now: new Date().toISOString()
  });
});

// ------------------------------
// JSON-RPC proxy (read-only)
// Accept POST /rpc and POST /
// ------------------------------
async function forwardRpc(req, res) {
  if (!isObject(req.body)) {
    return badRequest(res, "Body must be a JSON object");
  }

  const { method, params, id } = req.body;

  if (typeof method !== "string" || !ALLOWED_METHODS.includes(method)) {
    return badRequest(res, `Method not allowed: ${method}`);
  }

  // XRPL JSON-RPC accepts params as array (preferred) or object (will wrap)
  let normalizedParams;
  if (Array.isArray(params)) {
    normalizedParams = params;
  } else if (isObject(params)) {
    normalizedParams = [params];
  } else if (typeof params === "undefined") {
    normalizedParams = [{}];
  } else {
    return badRequest(res, "params must be array, object, or omitted");
  }

  const upstream = pickUpstream();
  const t = withTimeout(RPC_TIMEOUT_MS);
  const started = Date.now();

  try {
    const r = await fetch(upstream, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ method, params: normalizedParams, id }),
      signal: t.signal
    });

    const elapsed_ms = Date.now() - started;

    // Pass-through status where possible, but coerce to JSON if upstream misbehaves
    const ct = r.headers.get("content-type") || "";
    let payload = null;
    if (ct.includes("application/json")) {
      payload = await r.json().catch(() => null);
    } else {
      const text = await r.text().catch(() => "");
      try { payload = JSON.parse(text); }
      catch { payload = { error: "upstream_non_json", raw: text.slice(0, 512) }; }
    }

    res.status(r.ok ? 200 : (r.status || 502)).json({
      proxy: "xrbc-readonly",
      upstream,
      elapsed_ms,
      method,
      result: payload
    });
  } catch (e) {
    const elapsed_ms = Date.now() - started;
    res.status(504).json({
      proxy: "xrbc-readonly",
      upstream,
      elapsed_ms,
      method,
      error: String(e && e.name === "AbortError" ? "timeout" : e)
    });
  } finally {
    t.cancel();
  }
}

app.post("/", forwardRpc);
app.post("/rpc", forwardRpc);

// ------------- 404 -------------
app.use((req, res) => {
  res.status(404).json({
    error: "not_found",
    hint: "POST /rpc with {method, params} or GET /healthz",
    version: VERSION
  });
});

// ------------------------------
// Start
// ------------------------------
app.listen(PORT, () => {
  console.log(`[xrbc-proxy] v${VERSION} listening on :${PORT}`);
  console.log(`[xrbc-proxy] upstreams:`, UPSTREAM_POOL);
  console.log(`[xrbc-proxy] allowed_methods:`, ALLOWED_METHODS);
});
