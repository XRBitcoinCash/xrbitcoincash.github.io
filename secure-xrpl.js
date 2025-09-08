const SECURE_PROXY_URL = 'https://xrbitcoincash-github-io.onrender.com/api/xrpl/ledger';

/**
 * Generic secure request to XRPL via HTTPS
 */
export async function secureXrplRequest(payload) {
  const response = await fetch(SECURE_PROXY_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      // Optional: include API key or token here
      // 'Authorization': `Bearer ${TOKEN}`
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) throw new Error(`Secure proxy error: ${response.status}`);

  const data = await response.json();
  if (data.error) throw new Error(`XRPL error: ${JSON.stringify(data.error)}`);

  return data.result;
}

/**
 * Example: fetch latest validated ledger securely
 */
export async function fetchSecureLedgerInfo() {
  return await secureXrplRequest({ method: 'ledger', params: [{ ledger_index: 'validated' }] });
}
