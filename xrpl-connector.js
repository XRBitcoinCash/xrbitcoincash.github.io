// xrpl-connector.js
// Reusable connector that only communicates with your Render proxy
// Live Net only (not testnet)

const PROXY_URL = "https://xrbitcoincash-github-io.onrender.com"; 
// 🔥 replace above with your active Render proxy URL if it changes

/**
 * Send a request to the XRPL through the proxy
 * @param {Object} payload - The XRPL method + params
 * @returns {Promise<Object>} - The XRPL JSON response
 */
async function xrplRequest(payload) {
  try {
    const response = await fetch(`${PROXY_URL}/xrpl`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error(`Proxy error: ${response.status}`);
    }

    const data = await response.json();
    if (data.error) {
      throw new Error(`XRPL error: ${JSON.stringify(data.error)}`);
    }

    return data;
  } catch (err) {
    console.error("XRPL request failed:", err);
    throw err;
  }
}

/**
 * Get validated ledger info (default latest validated)
 */
export async function getLedgerInfo() {
  return await xrplRequest({ method: "ledger", params: [{ ledger_index: "validated" }] });
}

/**
 * Get account info for a given address
 * @param {string} address - XRPL account address
 */
export async function getAccountInfo(address) {
  return await xrplRequest({ method: "account_info", params: [{ account: address, ledger_index: "validated" }] });
}

/**
 * Example: Get server info (useful for diagnostics)
 */
export async function getServerInfo() {
  return await xrplRequest({ method: "server_info" });
}
