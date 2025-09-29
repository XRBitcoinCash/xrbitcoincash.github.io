// server.js

const express = require('express');
const axios = require('axios');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 10000;

// CORS + JSON body parsing
app.use(cors());
app.use(express.json({ limit: '1mb' }));

// Mainnet JSON-RPC endpoint (HTTPS)
const XRPL_RPC = 'https://s1.ripple.com:51234';

// Small helper to POST to XRPL
async function xrplRpc(body) {
  const resp = await axios.post(XRPL_RPC, body, {
    headers: { 'Content-Type': 'application/json' }
  });
  return resp.data;
}

// Health check for Render
app.get('/healthz', (_req, res) => res.status(200).send('ok'));

// ✅ Generic proxy: accept JSON-RPC at POST /
app.post('/', async (req, res) => {
  try {
    const data = await xrplRpc(req.body);
    res.json(data);
  } catch (err) {
    console.error('generic proxy error:', err?.response?.status, err?.message);
    res.status(500).json({ error: 'Proxy request failed', detail: err?.message || String(err) });
  }
});

// Convenience endpoints (keep these if you like)
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

app.listen(PORT, () => {
  console.log(`XRPL proxy running on port ${PORT}`);
});
