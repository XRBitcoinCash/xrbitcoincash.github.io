// xrpl-proxy/server.js — secure XRPL + Chat proxy (drop-in)
const express = require("express");
const axios = require("axios");
const cors = require("cors");

const app = express();
const PORT = process.env.PORT || 10000;

// ===== XRPL (no API key required) =====
const XRPL_RPC = "https://s1.ripple.com:51234";

// ===== OpenAI config (set in Render env) =====
const OPENAI_KEY   = process.env.OPENAI_API_KEY || "";
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini"; // use a model your key has access to
const OPENAI_BASE  = process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";

// ===== Middleware =====
app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use((req, _res, next) => { console.log(`[REQ] ${req.method} ${req.path}`); next(); });

// ===== XRPL helper =====
async function xrplRpc(body) {
  const resp = await axios.post(XRPL_RPC, body, {
    headers: { "Content-Type": "application/json" },
    timeout: 20000
  });
  return resp.data;
}

// ===== Health =====
app.get("/healthz", (_req, res) => res.json({ ok: true, ts: Date.now() }));

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
      params: [{ account, ledger_index: "validated" }]
    });
    res.json(data);
  } catch (err) {
    console.error("account error", err?.message || err);
    res.status(502).json({ error: "Account fetch failed", detail: err?.message || String(err) });
  }
});

// ===== Chat proxy =====
app.post("/chat", async (req, res) => {
  try {
    const { messages } = req.body || {};
    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: "Missing or invalid messages array" });
    }

    if (!OPENAI_KEY) {
      return res.status(500).json({ error: "OpenAI key not configured on server" });
    }

    // limit to last 10 for safety (frontend also trims)
    const trimmed = messages.slice(-10);

    const payload = {
      model: OPENAI_MODEL,
      messages: trimmed,
      temperature: 0.6,
      max_tokens: 600
    };

    const r = await axios.post(`${OPENAI_BASE}/chat/completions`, payload, {
      headers: {
        "Authorization": `Bearer ${OPENAI_KEY}`,
        "Content-Type": "application/json"
      },
      timeout: 30000,
      validateStatus: () => true
    });

    // explicit handling for common upstream errors
    if (r.status === 401) {
      return res.status(502).json({ error: "OpenAI auth failed (401)", detail: r.data });
    }
    if (r.status === 429) {
      return res.status(502).json({ error: "OpenAI rate limit / insufficient quota (429)", detail: r.data });
    }
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

// ===== Env check =====
app.get("/env-check", (_req, res) => {
  res.json({
    hasOpenAIKey: !!OPENAI_KEY,
    model: OPENAI_MODEL
  });
});

// ===== 404 fallback =====
app.use((req, res) => res.status(404).json({ error: "Not found", path: req.path, method: req.method }));

// ===== Boot log =====
function printRoutes() {
  const routes = [];
  app._router.stack.forEach(mw => {
    if (mw.route) {
      routes.push(`${Object.keys(mw.route.methods).join(",").toUpperCase()} ${mw.route.path}`);
    } else if (mw.name === "router" && mw.handle?.stack) {
      mw.handle.stack.forEach(r => { if (r.route) routes.push(`${Object.keys(r.route.methods).join(",").toUpperCase()} ${r.route.path}`); });
    }
  });
  console.log("[ROUTES]", routes);
}

// ===== Start =====
app.listen(PORT, () => {
  console.log(`✅ XRBC Secure XRPL/Chat proxy running on port ${PORT}`);
  printRoutes();
});
