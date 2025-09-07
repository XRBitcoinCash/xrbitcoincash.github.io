const express = require('express');
const axios = require('axios');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// Public XRPL node
const XRPL_NODE_URL = 'https://s1.ripple.com:51234/';

// Ledger info
app.get('/api/xrpl/ledger', async (req, res) => {
  try {
    const response = await axios.post(XRPL_NODE_URL, {
      method: "ledger",
      params: [{ ledger_index: "validated" }]
    });
    res.json(response.data);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch ledger" });
  }
});

// Account info
app.get('/api/xrpl/account/:account', async (req, res) => {
  const account = req.params.account;
  try {
    const response = await axios.post(XRPL_NODE_URL, {
      method: "account_info",
      params: [{ account }]
    });
    res.json(response.data);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch account info" });
  }
});

// Submit transaction
app.post('/api/xrpl/submit', async (req, res) => {
  try {
    const response = await axios.post(XRPL_NODE_URL, {
      method: "submit",
      params: [req.body]
    });
    res.json(response.data);
  } catch (err) {
    res.status(500).json({ error: "Failed to submit transaction" });
  }
});

app.listen(PORT, () => {
  console.log(`XRPL proxy running on port ${PORT}`);
});
