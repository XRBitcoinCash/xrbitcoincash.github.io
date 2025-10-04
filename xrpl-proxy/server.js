// server.js

const express = require('express');
const axios = require('axios');
const cors = require('cors');
const fetch = require('node-fetch');

const app = express();
const PORT = process.env.PORT || 10000;

// === Middleware ===
app.use(cors());
app.use(express.json({ limit: '1mb' }));

// === XRPL Mainnet JSON-RPC endpoint ===
const XRPL_RPC = 'https://s1.ripple.com:51234';

// Helper: post JSON-RPC to XRPL
async function xrplRpc(body) {
  const resp = await axios.post(XRPL_RPC, body, {
    headers: { 'Content-Type': 'application/json' }
  });
  return resp.data;
}

// === Health check for Render ===
app.get('/healthz', (_req, res) => res.status(200).send('ok'));

// === XRPL Generic Proxy ===
app.post('/', async (req, res) => {
  try {
    const data = await xrplRpc(req.body);
    res.json(data);
  } catch (err) {
    console.error('generic proxy error:', err?.response?.status, err?.message);
    res.status(500).json({ error: 'Proxy request failed', detail: err?.message || String(err) });
  }
});

// === XRPL Convenience Endpoints ===
app.get('/api/xrpl/ledger', async (_req, res) => {
  try {
    const data = await xrplRpc({ method: 'ledger', params: [{ ledger_index: 'validated' }] });
    res.json(data);
  } catch (err) {
    console.error('ledger error', err?.message || err);
    res.status(500).json({ error: 'Ledger fetch failed', detail: err?.message || String(err) });
  }
});

app.get('/api/xrpl/account/:acct', async (req, res) => {
  try {
    const account = req.params.acct;
    const data = await xrplRpc({ method: 'account_info', params: [{ account, ledger_index: 'validated' }] });
    res.json(data);
  } catch (err) {
    console.error('account error', err?.message || err);
    res.status(500).json({ error: 'Account fetch failed', detail: err?.message || String(err) });
  }
});

// === NEW: ChatGPT Auditor Proxy ===
app.post('/chat', async (req, res) => {
  try {
    const { messages } = req.body;
    if (!messages) {
      return res.status(400).json({ error: 'Missing messages array' });
    }

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`, // set in Render dashboard
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4o-mini", // fast + cost efficient
        messages
      })
    });

    if (!response.ok) {
      const txt = await response.text();
      console.error("OpenAI error:", txt);
      return res.status(500).json({ error: "Upstream failure", detail: txt });
    }

    const data = await response.json();
    res.json(data);
  } catch (err) {
    console.error("chat proxy error:", err.message || err);
    res.status(500).json({ error: "Chat proxy request failed", detail: err.message || String(err) });
  }
});

// === Start server ===
app.listen(PORT, () => {
  console.log(`XRPL proxy running on port ${PORT}`);
});
