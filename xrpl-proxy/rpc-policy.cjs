'use strict';
// The public proxy retrieves evidence and simulates transactions. Xaman handles signing/submission.
const READ_METHODS = new Set([
  'account_channels', 'account_currencies', 'account_info', 'account_lines',
  'account_nfts', 'account_objects', 'account_offers', 'account_tx', 'amm_info',
  'book_changes', 'book_offers', 'channel_verify', 'deposit_authorized', 'fee',
  'feature', 'gateway_balances', 'ledger', 'ledger_closed', 'ledger_current',
  'ledger_data', 'ledger_entry', 'manifest', 'nft_buy_offers', 'nft_sell_offers',
  'nft_history', 'nft_info', 'nfts_by_issuer', 'noripple_check', 'ping',
  'ripple_path_find', 'server_definitions', 'server_info', 'server_state',
  'simulate', 'transaction_entry', 'tx', 'vault_info'
]);
function validateRequest(body) {
  if (!body || Array.isArray(body) || typeof body !== 'object' || !READ_METHODS.has(body.method))
    return 'This proxy accepts supported read-only XRPL requests. Review and submit transactions in your wallet.';
  if (body.params !== undefined && (!Array.isArray(body.params) || body.params.length > 1 ||
      body.params.some(p => !p || typeof p !== 'object' || Array.isArray(p))))
    return 'Use a params array containing one request object.';
  const queue = [{value: body, depth: 0}];
  while (queue.length) {
    const {value, depth} = queue.pop();
    if (depth > 12) return 'Request nesting is too deep.';
    if (!value || typeof value !== 'object') continue;
    for (const [key, child] of Object.entries(value)) {
      if (/^(secret|seed|master_seed|master_seed_hex|master_key|private_key|privateKey|passphrase|seed_hex|signing_private_key)$/i.test(key))
        return 'Do not send wallet secrets to this service.';
      if (body.method === 'feature' && key === 'vetoed') return 'Amendment configuration is not available through this proxy.';
      if (child && typeof child === 'object') queue.push({value: child, depth: depth + 1});
    }
  }
  return null;
}
function middleware(req, res, next) {
  const message = validateRequest(req.body);
  if (message) return res.status(400).json({result:{status:'error',error:'invalid_request',error_message:message}});
  next();
}
module.exports = {validateRequest, middleware, READ_METHODS};
