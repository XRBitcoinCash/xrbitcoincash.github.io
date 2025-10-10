// xrpl-proxy/server.js — full drop-in replacement (2025 build)
const express = require("express");
const axios = require("axios");
const cors = require("cors");

const app = express();
const PORT = process.env.PORT || 10000;
const XRPL_RPC = "https://s1.ripple.com:51234";

// ===== Middleware =====
app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use((req, _res, next) => {
  console.log(`[REQ] ${req.method} ${req.path}`);
  next();
});

// ===== XRPL helpers =====
async function xrplRpc(body) {
  const resp = await axios.post(XRPL_RPC, body, {
    headers: { "Content-Type": "application/json" },
    timeout: 20000,
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
    res
      .status(502)
      .json({ error: "Proxy request failed", detail: err?.message || String(err) });
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

// ===== Upgraded Chat Proxy (GPT-5 compatible) =====
app.post("/chat", async (req, res) => {
  try {
    const { messages } = req.body || {};
    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: "Missing or invalid messages array" });
    }

    // limit context to last 10 messages for safety
    const trimmed = messages.slice(-10);

    const payload = {
      model: process.env.OPENAI_MODEL || "gpt-5",
      messages: trimmed,
      temperature: 0.6,
      max_tokens: 900,
    };

    const r = await axios.post("https://api.openai.com/v1/chat/completions", payload, {
      headers: {
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      timeout: 30000,
      validateStatus: () => true,
    });

    if (r.status < 200 || r.status >= 300) {
      console.error("[OpenAI error]", r.status, r.data);
      return res
        .status(502)
        .json({ error: "Upstream OpenAI error", status: r.status, detail: r.data });
    }

    if (!r.data || typeof r.data !== "object") {
      return res.status(502).json({ error: "Invalid OpenAI response format" });
    }

    res.json(r.data);
  } catch (err) {
    console.error("[chat proxy error]", err?.message || err);
    res
      .status(502)
      .json({ error: "Chat proxy request failed", detail: err?.message || String(err) });
  }
});

// ===== Env Check =====
app.get("/env-check", (_req, res) => {
  res.json({
    hasOpenAIKey: !!process.env.OPENAI_API_KEY,
    model: process.env.OPENAI_MODEL || "gpt-5",
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
      routes.push(`${Object.keys(mw.route.methods).join(",").toUpperCase()} ${mw.route.path}`);
    } else if (mw.name === "router" && mw.handle?.stack) {
      mw.handle.stack.forEach((r) => {
        if (r.route)
          routes.push(`${Object.keys(r.route.methods).join(",").toUpperCase()} ${r.route.path}`);
      });
    }
  });
  console.log("[ROUTES]", routes);
}

// ===== Start Server =====
app.listen(PORT, () => {
  console.log(`XRBC Secure XRPL/Chat proxy running on port ${PORT}`);
  printRoutes();
});
