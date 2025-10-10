// xrpl-proxy/server.js — safe-by-default proxy (drop-in replacement)
const express = require("express");
const axios = require("axios");
const cors = require("cors");
const rateLimit = require("express-rate-limit");

const app = express();
const PORT = process.env.PORT || 10000;
const XRPL_RPC = "https://s1.ripple.com:51234";

// Safety flags (env)
const DISABLE_CHAT = (process.env.DISABLE_CHAT || "true").toLowerCase() === "true";
const AUTH_TOKEN = process.env.XRBC_AUTH || ""; // optional shared secret for /chat when enabled
const MAX_REQ_PER_MIN = Number(process.env.RATE_LIMIT_PER_MIN || 30); // per-IP default

// ===== Middleware =====
app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use((req, _res, next) => {
  console.log(`[REQ] ${req.method} ${req.path} from ${req.ip}`);
  next();
});

// ===== Small per-IP limiter (applies to chat endpoint only) =====
const chatLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: MAX_REQ_PER_MIN,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    console.warn(`[RATE_LIMIT] ${req.ip} exceeded rate limit`);
    res.status(429).json({ error: "Too many requests — rate limit exceeded" });
  },
});

// ===== XRPL helper =====
async function xrplRpc(body) {
  const resp = await axios.post(XRPL_RPC, body, {
    headers: { "Content-Type": "application/json" },
    timeout: 20000,
  });
  return resp.data;
}

// ===== Health =====
app.get("/healthz", (_req, res) => res.json({ ok: true, ts: Date.now(), disableChat: DISABLE_CHAT }));

// ===== Generic XRPL passthrough =====
app.post("/", async (req, res) => {
  try {
    const data = await xrplRpc(req.body);
    res.json(data);
  } catch (err) {
    console.error("generic proxy error:", err?.response?.status, err?.message);
    res.status(502).json({ error: "Proxy request failed", detail: err?.message || String(err) });
  }
});

// ===== Ledger info =====
app.get("/api/xrpl/ledger", async (_req, res) => {
  try {
    const data = await xrplRpc({ method: "ledger", params: [{ ledger_index: "validated" }] });
    res.json(data);
  } catch (err) {
    console.error("ledger error", err?.message || err);
    res.status(502).json({ error: "Ledger fetch failed", detail: err?.message || String(err) });
  }
});

// ===== Account info =====
app.get("/api/xrpl/account/:acct", async (req, res) => {
  try {
    const account = req.params.acct;
    const data = await xrplRpc({
      method: "account_info",
      params: [{ account, ledger_index: "validated" }],
    });
    res.json(data);
  } catch (err) {
    console.error("account error", err?.message || err);
    res.status(502).json({ error: "Account fetch failed", detail: err?.message || String(err) });
  }
});

// ===== CHAT endpoint (SAFE-BY-DEFAULT) =====
app.post("/chat", chatLimiter, async (req, res) => {
  // If we are disabled, respond with 503 and log
  if (DISABLE_CHAT) {
    console.warn("[CHAT_BLOCKED] /chat requested while DISABLE_CHAT=true");
    return res.status(503).json({
      error: "Chat endpoint is temporarily disabled for public safety. Contact maintainer to enable.",
      disableChat: true,
    });
  }

  // If AUTH_TOKEN is configured, require it
  if (AUTH_TOKEN) {
    const provided = req.get("x-xrbc-auth") || "";
    if (provided !== AUTH_TOKEN) {
      console.warn(`[CHAT_AUTH_FAIL] ${req.ip} provided invalid auth header`);
      return res.status(401).json({ error: "Unauthorized - invalid auth token" });
    }
  }

  try {
    const { messages } = req.body || {};
    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: "Missing or invalid messages array" });
    }

    // limit context to last 10 messages for safety
    const trimmed = messages.slice(-10);

    // use the API key only if present in environment (server must have it)
    if (!process.env.OPENAI_API_KEY) {
      console.error("[CHAT_ERROR] OPENAI_API_KEY not configured on server");
      return res.status(502).json({ error: "Upstream OpenAI key not configured" });
    }

    const payload = {
      model: process.env.OPENAI_MODEL || "gpt-4o-mini",
      messages: trimmed,
      temperature: 0.6,
      max_tokens: Number(process.env.MAX_TOKENS || 900),
    };

    const r = await axios.post("https://api.openai.com/v1/chat/completions", payload, {
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      timeout: 30000,
      validateStatus: () => true,
    });

    if (r.status < 200 || r.status >= 300) {
      console.error("[OpenAI error]", r.status, r.data);
      return res.status(502).json({ error: "Upstream OpenAI error", status: r.status, detail: r.data });
    }
    if (!r.data || typeof r.data !== "object") {
      return res.status(502).json({ error: "Invalid OpenAI response format" });
    }

    res.json(r.data);
  } catch (err) {
    console.error("[chat proxy error]", err?.message || err);
    res.status(502).json({ error: "Chat proxy request failed", detail: err?.message || String(err) });
  }
});

// ===== Env check (helps debugging) =====
app.get("/env-check", (_req, res) => {
  res.json({
    hasOpenAIKey: !!process.env.OPENAI_API_KEY,
    model: process.env.OPENAI_MODEL || null,
    disableChat: DISABLE_CHAT,
    authRequired: !!AUTH_TOKEN,
    rateLimitPerMin: MAX_REQ_PER_MIN,
  });
});

// ===== 404 fallback =====
app.use((req, res) => {
  res.status(404).json({ error: "Not found", path: req.path, method: req.method });
});

// ===== Boot log =====
function printRoutes() {
  const routes = [];
  app._router.stack.forEach((mw) => {
    if (mw.route) {
      routes.push(`${Object.keys(mw.rou
