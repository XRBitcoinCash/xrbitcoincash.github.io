// server.js
const express = require('express');
const axios = require('axios');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 10000;

// Allow all origins (easy test mode) — later we can lock down
app.use(cors());

// XRPL JSON-RPC endpoint (mainnet)
// For Testnet: use 'https://s.altnet.rippletest.net:51234'
const XRPL_RPC = 'https://s1.ripple.com:51234';

// POST helper to XRPL node
async function xrplRpc(body) {
  const resp = await axios.post(XRPL_RPC, body, {
    headers: { 'Content-Type': 'application/json' }
  });
  return resp.data;
}

// GET /api/xrpl/ledger
app.get('/api/xrpl/ledger', async (req, res) => {
  try {
    const data = await xrplRpc({
      method: 'ledger',
      params: [{ ledger_index: 'validated' }]
    });
    res.json(data);
  } catch (err) {
    console.error('ledger error', err?.message || err);
    res.status(500).json({ error: 'Ledger fetch failed', detail: err?.message || String(err) });
  }
});

// GET /api/xrpl/account/:acct
app.get('/api/xrpl/account/:acct', async (req, res) => {
  try {
    const account = req.params.acct;
    const data = await xrplRpc({
      method: 'account_info',
      params: [{ account, ledger_index: 'validated' }]
    });
    res.json(data);
  } catch (err) {
    console.error('account error', err?.message || err);
    res.status(500).json({ error: 'Account fetch failed', detail: err?.message || String(err) });
  }
});

app.listen(PORT, () => {
  console.log(`XRPL proxy running on port ${PORT}`);
});
