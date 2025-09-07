// xrpl-connector.js
const XRPL_PROXY_BASE = "/api/xrpl"; // Node.js proxy endpoint

/**
 * Generic function to call the XRPL proxy
 * @param {string} endpoint - endpoint after /api/xrpl
 * @param {object} options - { method: "GET"/"POST", data: {...} }
 */
async function xrplCall(endpoint = "", options = {}) {
  const url = `${XRPL_PROXY_BASE}/${endpoint}`;
  const fetchOptions = {
    method: options.method || "GET",
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
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

/**
 * Get ledger info
 */
async function getLedger() {
  return xrplCall("ledger", { method: "GET" });
}

/**
 * Get account info
 * @param {string} account - XRPL account address
 */
async function getAccount(account) {
  return xrplCall(`account/${account}`, { method: "GET" });
}

/**
 * Submit a transaction to the XRPL
 * @param {object} txData - transaction data
 */
async function submitTransaction(txData) {
  return xrplCall("submit", { method: "POST", data: txData });
}
