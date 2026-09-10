'use strict';

// Supply definitions are public accounting policy, never signing authority.
function createSupply({rpc, memo, policy, asset, address, decimal, compare, sumDecimals, ApiError}) {
  const invalid = message => { throw new ApiError(502, 'invalid_supply_data', message); };
  const unavailable = message => { throw new ApiError(503, 'supply_policy_unavailable', message); };
  const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const currency = value => typeof value === 'string' && value.length === 40 ? value.toUpperCase() : value;
  const target = value => currency(value) === asset.currency;
  const subtract = (a, b) => sumDecimals([a, '-' + b]);
  function quantity(value, signed = false) {
    let result;
    try { result = decimal(value).text; } catch { invalid('Supply amounts must be valid decimal strings.'); }
    if (!signed && compare(result, '0') < 0) invalid('Supply amounts cannot be negative.');
    return result;
  }
  function amountMap(value) {
    if (value === undefined) return '0';
    if (!object(value)) invalid('Supply currency totals are malformed.');
    const matching = Object.entries(value).filter(([key]) => target(key));
    if (matching.length > 1) invalid('Duplicate supply currency totals.');
    return matching.length ? quantity(matching[0][1]) : '0';
  }
  function accountAmounts(value, signed = false) {
    if (value === undefined) return new Map();
    if (!object(value)) invalid('Supply account balances are malformed.');
    const out = new Map();
    for (const [account, rows] of Object.entries(value)) {
      try { address(account); } catch { invalid('Supply account address is malformed.'); }
      if (!Array.isArray(rows)) invalid('Supply account balances must be arrays.');
      const matching = rows.filter(row => {
        if (!object(row) || typeof row.currency !== 'string') invalid('Supply balance row is malformed.');
        return target(row.currency);
      });
      if (matching.length > 1) invalid('Duplicate account/currency balance.');
      if (matching.length) out.set(account, quantity(matching[0].value, signed));
    }
    return out;
  }
  function readPolicy() {
    if (!object(policy) || policy.schemaVersion !== '1.0.0' ||
        policy.asset?.issuer !== asset.issuer || policy.asset?.currency !== asset.currency) {
      unavailable('Supply policy does not match the configured XRBC asset.');
    }
    let declared;
    try { declared = decimal(policy.declaredMaxSupply, {positive: true}).text; }
    catch { unavailable('Declared maximum supply is invalid.'); }
    const publicUrl = value => {
      try { const u = new URL(value); return u.protocol === 'https:' && !u.username && !u.password; }
      catch { return false; }
    };
    if (!publicUrl(policy.maxSupplySource)) unavailable('Maximum supply needs a public source.');
    const review = policy.circulation;
    if (!object(review) || !['pending', 'project-reviewed'].includes(review.reviewStatus) ||
        !Array.isArray(review.exclusions) || review.exclusions.length > 50) {
      unavailable('Circulation policy is invalid.');
    }
    if (review.reviewStatus === 'project-reviewed' &&
        (!/^\d{4}-\d{2}-\d{2}$/.test(review.reviewedAt || '') ||
         !Number.isFinite(Date.parse(review.reviewedAt)) ||
         new Date(review.reviewedAt).toISOString().slice(0, 10) !== review.reviewedAt ||
         !publicUrl(review.evidenceUrl))) {
      unavailable('Reviewed circulation needs a valid review date and public evidence URL.');
    }
    const seen = new Set();
    const exclusions = review.exclusions.map(entry => {
      try { address(entry?.address); } catch { unavailable('Exclusion address is invalid.'); }
      if (entry.address === asset.issuer || seen.has(entry.address)) unavailable('Duplicate or issuer exclusion address.');
      if (!['team', 'treasury', 'vesting', 'locked', 'other'].includes(entry.reason) ||
          !publicUrl(entry.evidenceUrl)) unavailable('Every excluded account needs a reason and public evidence URL.');
      seen.add(entry.address);
      return {address: entry.address, reason: entry.reason, evidenceUrl: entry.evidenceUrl};
    });
    return {declared, review, exclusions};
  }
  async function escrowSupply(ledger) {
    const amounts = [], entries = new Set(), markers = new Set();
    let marker, pages = 0;
    do {
      const result = await rpc('account_objects', {
        account: asset.issuer, type: 'escrow', ledger_hash: ledger.hash,
        limit: 400, ...(marker === undefined ? {} : {marker})
      });
      if (!Array.isArray(result.account_objects)) invalid('Escrow inventory is unavailable.');
      for (const item of result.account_objects) {
        if (!object(item) || item.LedgerEntryType !== 'Escrow' ||
            !/^[a-f0-9]{64}$/i.test(item.index || '') || entries.has(item.index.toUpperCase())) {
          invalid('Escrow inventory contains an invalid or duplicate entry.');
        }
        entries.add(item.index.toUpperCase());
        const amount = item.Amount;
        if (typeof amount === 'string') continue; // XRP escrow is a different asset.
        if (!object(amount)) invalid('Escrow amount is malformed.');
        if (amount.mpt_issuance_id) continue;
        if (typeof amount.currency !== 'string' || typeof amount.issuer !== 'string') invalid('Escrow asset identity is unavailable.');
        if (target(amount.currency) && amount.issuer === asset.issuer) amounts.push(quantity(amount.value));
      }
      marker = result.marker;
      pages++;
      if (marker !== undefined && marker !== null) {
        const key = JSON.stringify(marker);
        if (markers.has(key)) invalid('Escrow pagination repeated its marker.');
        markers.add(key);
      }
    } while (marker !== undefined && marker !== null && pages < 10);
    if (marker !== undefined && marker !== null) throw new ApiError(503, 'incomplete_supply', 'Escrow inventory exceeded the bounded traversal; supply is withheld.');
    return {amount: sumDecimals(amounts), count: amounts.length, pages};
  }
  async function snapshot(ledger) {
    const config = readPolicy();
    if (config.review.reviewStatus === 'project-reviewed' && config.review.reviewedAt > ledger.closedAt.slice(0, 10)) {
      unavailable('Circulation review cannot be dated after the ledger checkpoint.');
    }
    return memo('supply:' + ledger.hash, 10000, async () => {
      const [gateway, escrow] = await Promise.all([
        rpc('gateway_balances', {account: asset.issuer, ledger_hash: ledger.hash, strict: true}),
        escrowSupply(ledger)
      ]);
      if (gateway.marker !== undefined || (gateway.balances !== undefined &&
          (!object(gateway.balances) || Object.keys(gateway.balances).length))) invalid('Unexpected partial or hot-wallet-filtered supply response.');
      const obligations = amountMap(gateway.obligations);
      const frozen = accountAmounts(gateway.frozen_balances);
      const frozenSupply = sumDecimals([...frozen.values()]);
      const totalSupply = sumDecimals([obligations, frozenSupply, escrow.amount]);
      let balances = new Map();
      if (config.exclusions.length) {
        const filtered = await rpc('gateway_balances', {
          account: asset.issuer, ledger_hash: ledger.hash, strict: true,
          hotwallet: config.exclusions.map(entry => entry.address)
        });
        if (filtered.marker !== undefined) invalid('Filtered supply response is incomplete.');
        balances = accountAmounts(filtered.balances, true);
        if ([...balances.keys()].some(account => !config.exclusions.some(entry => entry.address === account))) {
          invalid('Upstream returned an unrequested excluded account.');
        }
      }
      const exclusions = config.exclusions.map(entry => {
        const raw = balances.get(entry.address) || '0';
        const balance = compare(raw, '0') < 0 ? '0' : raw;
        const alreadyFrozen = frozen.get(entry.address) || '0';
        if (compare(alreadyFrozen, balance) > 0) invalid('Excluded account and frozen balance disagree.');
        return {...entry, balance, alreadyExcludedFrozen: alreadyFrozen, additionalExcluded: subtract(balance, alreadyFrozen)};
      });
      const accountExcluded = sumDecimals(exclusions.map(entry => entry.additionalExcluded));
      if (compare(accountExcluded, obligations) > 0) invalid('Excluded account balances exceed available obligations.');
      const reviewed = config.review.reviewStatus === 'project-reviewed';
      const circulatingSupply = reviewed ? subtract(obligations, accountExcluded) : null;
      const maxConsistent = compare(totalSupply, config.declared) <= 0;
      return {
        asset, symbol: 'XRBC', totalSupply, circulatingSupply,
        maxSupply: maxConsistent ? config.declared : null, declaredMaxSupply: config.declared,
        outstandingObligations: obligations, frozenSupply, escrowedSupply: escrow.amount,
        excludedAccountSupply: reviewed ? accountExcluded : null,
        nonCirculatingSupply: reviewed ? sumDecimals([frozenSupply, escrow.amount, accountExcluded]) : null,
        hotwalletExclusions: [], exclusions,
        circulationStatus: reviewed ? 'project-reviewed' : 'awaiting-project-allocation-review',
        maxSupplyStatus: maxConsistent ? 'project-declared' : 'declared-cap-below-observed-supply',
        maxSupplyVerifiedOnLedger: false,
        circulationReview: {reviewedAt: config.review.reviewedAt, evidenceUrl: config.review.evidenceUrl},
        totalSupplyMethod: 'Reported unfrozen issuer obligations + frozen balances + exact-asset escrow amounts, all pinned to the same validated ledger.',
        circulatingSupplyMethod: 'Total supply minus escrow, individually frozen balances, and project-reviewed excluded account balances; frozen amounts are not subtracted twice.',
        maxSupplySource: policy.maxSupplySource,
        escrowInventory: {complete: true, objects: escrow.count, pages: escrow.pages},
        meaning: 'Outstanding obligations alone are not circulating or maximum supply. Total is currently outstanding issued XRBC, not cumulative historical issuance.',
        limitations: [
          'Gateway aggregate values retain upstream XRPL precision; this API preserves their decimal text and performs additions/subtractions without JavaScript floating-point rounding.',
          'Account labels and declared maximum are project statements, not independent tracker approval or proof of immutable issuance limits.',
          'The ledger cannot identify undisclosed team, treasury, vesting, or off-ledger ownership arrangements.',
          'Escrow is enumerated by exact currency AND issuer; gateway locked currency-only totals are not used.',
          'Returned-to-issuer tokens cease being outstanding obligations; the difference from the design cap is not a verified historical burn count.'
        ]
      };
    });
  }
  return {snapshot};
}

module.exports = {createSupply};
