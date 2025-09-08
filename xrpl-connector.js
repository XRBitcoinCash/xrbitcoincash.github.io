// xrpl-connector.js
// Minimal XRPL connector communicating only through your proxy

const XRPL_PROXY_BASE = "https://xrbitcoincash-github-io.onrender.com/api/xrpl"; // your Render proxy

/**
 * Make a call to the proxy
 * @param {string} endpoint - XRPL endpoint (e.g., 'ledger', 'account/<acct>')
 * @param {object} options - Optional fetch options
 * @returns {Promise<object>} JSON response
 */
async function xrplCall(endpoint = "", options = {}) {
  const url = `${XRPL_PROXY_BASE}/${endpoint}`;
  const fetchOptions = {
    method: options.method || "GET",
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    body: options.data ? JSON.stringify(options.data) : undefined,
  };

  try {
    const response = await fetch(url, fetchOptions);
    if (!response.ok) throw new Error(`Proxy returned status ${response.status}`);
    return await response.json();
  } catch (err) {
    console.error("XRPL proxy call failed:", err);
    throw err;
  }
}

// Minimal test functions
async function testLedger() {
  return xrplCall("ledger");
}

async function testAccount(account) {
  return xrplCall(`account/${account}`);
}

// Expose to global for simple front-end testing
window.xrplConnector = {
  testLedger,
  testAccount
};
