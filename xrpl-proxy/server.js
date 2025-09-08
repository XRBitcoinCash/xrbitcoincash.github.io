// server.js
const express = require("express");
const fetch = require("node-fetch"); // or global fetch in Node 18+
const app = express();
const PORT = process.env.PORT || 10000;

// XRPL public endpoint (Clio server)
const XRPL_NODE = "https://s1.ripple.com:51234";

// Middleware
app.use(express.json());

// Ledger route
app.get("/api/xrpl/ledger", async (req, res) => {
  try {
    const response = await fetch(XRPL_NODE, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        method: "ledger",
        params: [{ ledger_index: "validated" }]
      }),
    });
    const data = await response.json();
    res.json(data);
  } catch (err) {
    console.error("Ledger route error:", err);
    res.status(500).json({ error: "Ledger fetch failed" });
  }
});

// Account route
app.get("/api/xrpl/account/:acct", async (req, res) => {
  try {
    const response = await fetch(XRPL_NODE, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        method: "account_info",
        params: [{ account: req.params.acct, ledger_index: "validated" }]
      }),
    });
    const data = await response.json();
    res.json(data);
  } catch (err) {
    console.error("Account route error:", err);
    res.status(500).json({ error: "Account fetch failed" });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`XRPL proxy running on port ${PORT}`);
});
