// xrpl-connector.js
const PROXY_URL = "https://xrbitcoincash-github-io.onrender.com";

// === XRPL Proxy Connector ===

// Fetch latest validated ledger info
async function getLedgerInfo() {
  try {
    const res = await fetch(`${PROXY_URL}/api/xrpl/ledger`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    console.log("Ledger Info:", data);
    return data;
  } catch (err) {
    console.error("Ledger fetch error:", err);
    throw err;
  }
}

// Fetch account info (replace rEXAMPLE with real XRPL address)
async function getAccountInfo(account) {
  try {
    const res = await fetch(`${PROXY_URL}/api/xrpl/account/${account}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    console.log("Account Info:", data);
    return data;
  } catch (err) {
    console.error("Account fetch error:", err);
    throw err;
  }
}
