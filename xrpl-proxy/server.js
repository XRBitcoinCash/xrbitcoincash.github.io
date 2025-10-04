// xrpl-proxy/server.js
const express = require('express');
const axios = require('axios');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 10000;

// === Middleware ===
app.use(cors());
app.use(express.json({ limit: '1mb' }));

// === XRPL Mainnet JSON-RPC endpoint ===
const XRPL_RPC = 'https://s1.ripple.com:51234';

async function xrplRpc(body) {
  const resp = await axios.post(XRPL_RPC, body, {
    headers: { 'Content-Type': 'application/json' },
    timeout: 20000,
  });
  return resp.data;
}

// === Health check ===
app.get('/healthz', (_req, res) => res.json({ ok: true, ts: Date.now() }));

// === XRPL Generic Proxy ===
app.post('/', async (req, res) => {
  try {
    const data = await xrplRpc(req.body);
    res.json(data);
  } catch (err) {
    console.error('generic proxy error:', err?.response?.status, err?.message);
    res.status(502).json({ error: 'Proxy request failed', detail: err?.message || String(err) });
  }
});

// === XRPL Ledger ===
app.get('/api/xrpl/ledger', async (_req, res) => {
  try {
    const data = await xrplRpc({ method: 'ledger', params: [{ ledger_index: 'validated' }] });
    res.json(data);
  } catch (err) {
    console.error('ledger error', err?.message || err);
    res.status(502).json({ error: 'Ledger fetch failed', detail: err?.message || String(err) });
  }
});

// === XRPL Account Info ===
app.get('/api/xrpl/account/:acct', async (req, res) => {
  try {
    const account = req.params.acct;
    const data = await xrplRpc({ method: 'account_info', params: [{ account, ledger_index: 'validated' }] });
    res.json(data);
  } catch (err) {
    console.error('account error', err?.message || err);
    res.status(502).json({ error: 'Account fetch failed', detail: err?.message || String(err) });
  }
});

// === ChatGPT Auditor Proxy ===
app.post('/chat', async (req, res) => {
  try {
    const { messages } = req.body || {};
    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'Missing messages array' });
    }

    const payload = {
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      messages,
    };

    const r = await axios.post('https://api.openai.com/v1/chat/completions', payload, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      timeout: 30000,
      validateStatus: () => true,
    });

    if (r.status < 200 || r.status >= 300) {
      console.error('OpenAI error:', r.status, r.data);
      return res.status(502).json({ error: 'Upstream OpenAI error', status: r.status, detail: r.data });
    }

    res.json(r.data);
  } catch (err) {
    console.error('chat proxy error:', err.message || err);
    res.status(502).json({ error: 'Chat proxy request failed', detail: err.message || String(err) });
  }
});

// === JSON 404 Fallback (important) ===
app.use((req, res) => {
  res.status(404).json({ error: 'Not found', path: req.path, method: req.method });
});

// === Start ===
app.listen(PORT, () => {
  console.log(`XRPL proxy running on port ${PORT}`);
});
