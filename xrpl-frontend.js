// xrpl-frontend.js
import { getLedgerInfo, getAccountInfo, getServerInfo } from './xrpl-connector.js';

/**
 * Error handler
 */
function handleError(err) {
  console.error('XRPL frontend error:', err);
  throw err; // allow calling page to handle if desired
}

/**
 * Get latest validated ledger info
 */
export async function fetchLedgerInfo() {
  try {
    return await getLedgerInfo();
  } catch (err) {
    handleError(err);
  }
}

/**
 * Get account info by address
 */
export async function fetchAccountInfo(address) {
  if (!address) throw new Error('XRPL address required');
  try {
    return await getAccountInfo(address);
  } catch (err) {
    handleError(err);
  }
}

/**
 * Get server info
 */
export async function fetchServerInfo() {
  try {
    return await getServerInfo();
  } catch (err) {
    handleError(err);
  }
}

// Optional: attach globally for pages that don’t use modules
window.xrplFront = {
  fetchLedgerInfo,
  fetchAccountInfo,
  fetchServerInfo,
};
