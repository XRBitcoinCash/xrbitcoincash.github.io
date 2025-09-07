// xrpl-connector.js
const XRPL_PROXY_BASE = "/api/xrpl"; // points to your deployed proxy

async function xrplCall(endpoint = "", options = {}) {
  const url = `${XRPL_PROXY_BASE}/${endpoint}`;
  const fetchOptions = {
    method: options.method || "GET",
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    body: options.data ? JSON.stringify(options.data) : undefined,
  };

  try {
    const response = await fetch(url, fetchOptions);
    const result = await response.json();
    return result;
  } catch (err) {
    console.error("XRPL proxy call failed:", err);
    throw err;
  }
}

// Example functions
async function getLedger() {
  return xrplCall("ledger", { method: "GET" });
}

async function getAccount(account) {
  return xrplCall(`account/${account}`, { method: "GET" });
}

async function submitTransaction(txData) {
  return xrplCall("submit", { method: "POST", data: txData });
}
