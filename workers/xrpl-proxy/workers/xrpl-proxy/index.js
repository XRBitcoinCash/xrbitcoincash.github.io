import express from "express";
import fetch from "node-fetch"; // Node >=18 can use global fetch
import dotenv from "dotenv";

dotenv.config();
const app = express();
app.use(express.json());

const XRPL_NODE_URL = process.env.XRPL_NODE_URL; // e.g., https://s.altnet.rippletest.net
// Optional: XRPL_API_KEY / SECRET if your node requires authentication

// CORS headers
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*"); // Update with your domain for security
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.header("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

// --- Endpoint: GET /ledger ---
app.get("/api/xrpl/ledger", async (req, res) => {
  try {
    const response = await fetch(`${XRPL_NODE_URL}`, { method: "POST", body: JSON.stringify({ method: "ledger", params: [{}] }) });
    const data = await response.json();
    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch ledger" });
  }
});

// --- Endpoint: GET /account/:account ---
app.get("/api/xrpl/account/:account", async (req, res) => {
  const account = req.params.account;
  try {
    const response = await fetch(`${XRPL_NODE_URL}`, {
      method: "POST",
      body: JSON.stringify({ method: "account_info", params: [{ account }] }),
      headers: { "Content-Type": "application/json" },
    });
    const data = await response.json();
    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch account info" });
  }
});

// --- Endpoint: POST /submit ---
app.post("/api/xrpl/submit", async (req, res) => {
  const txData = req.body;
  try {
    const response = await fetch(`${XRPL_NODE_URL}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ method: "submit", params: [txData] }),
    });
    const data = await response.json();
    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to submit transaction" });
  }
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`XRPL proxy running on port ${PORT}`));
