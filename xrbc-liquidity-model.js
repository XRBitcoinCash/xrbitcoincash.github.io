/* XRBC liquidity-impact model: read-only chart augmentation using live market evidence. */
(() => {
  'use strict';
  const API = 'https://xrbitcoincash-github-io.onrender.com/api/v1';
  const DESIGN_SUPPLY = 21000000;
  const CURRENCY_HEX = '5852626974636F696E6361736800000000000000';
  const TARGETS = [0.01, 0.05, 0.10];
  const FETCH_MIN_MS = 12000;
  const state = { context: null, market: null, supply: null, lastFetch: 0, fetchPromise: null };

  const finite = value => {
    const n = typeof value === 'number' ? value : Number(String(value ?? '').replace(/[$,%\s,]/g, ''));
    return Number.isFinite(n) ? n : null;
  };
  const positive = value => { const n = finite(value); return n !== null && n > 0 ? n : null; };
  const text = (id, value) => { const node = document.getElementById(id); if (node) node.textContent = value; };
  const fmt = (n, digits = 6) => {
    if (!Number.isFinite(n)) return '—';
    const abs = Math.abs(n);
    if (abs >= 1e9) return (n / 1e9).toFixed(2) + 'B';
    if (abs >= 1e6) return (n / 1e6).toFixed(2) + 'M';
    if (abs >= 1e3) return (n / 1e3).toFixed(2) + 'K';
    return n.toLocaleString(undefined, { maximumFractionDigits: digits });
  };
  const money = n => Number.isFinite(n) ? '$' + fmt(n, n < 1 ? 8 : 2) : '—';
  const xrp = n => Number.isFinite(n) ? fmt(n, 6) + ' XRP' : '—';
  const pct = n => Number.isFinite(n) ? n.toFixed(3) + '%' : '—';

  function walkObject(root, test, depth = 0, seen = new Set()) {
    if (!root || typeof root !== 'object' || depth > 7 || seen.has(root)) return null;
    seen.add(root);
    for (const [key, value] of Object.entries(root)) {
      if (test(key, value, root)) return value;
    }
    for (const value of Object.values(root)) {
      if (value && typeof value === 'object') {
        const found = walkObject(value, test, depth + 1, seen);
        if (found !== null) return found;
      }
    }
    return null;
  }
  function namedNumber(root, names) {
    const wanted = new Set(names.map(name => name.toLowerCase()));
    const found = walkObject(root, (key, value) => wanted.has(key.toLowerCase()) && finite(value) !== null);
    return finite(found);
  }
  function namedObject(root, names) {
    const wanted = new Set(names.map(name => name.toLowerCase()));
    return walkObject(root, (key, value) => wanted.has(key.toLowerCase()) && value && typeof value === 'object');
  }
  function parseXrplAmount(value) {
    if (typeof value === 'string' && /^\d+(?:\.\d+)?$/.test(value)) {
      const drops = Number(value);
      return Number.isFinite(drops) ? { asset: 'XRP', value: drops / 1e6 } : null;
    }
    if (!value || typeof value !== 'object') return null;
    const amount = finite(value.value);
    if (!Number.isFinite(amount)) return null;
    const currency = String(value.currency || '').toUpperCase();
    if (currency === 'XRBC' || currency === CURRENCY_HEX) return { asset: 'XRBC', value: amount };
    if (currency === 'XRP') return { asset: 'XRP', value: amount };
    return { asset: currency || 'TOKEN', value: amount };
  }
  function normalizeAmm(payload) {
    const root = namedObject(payload, ['amm', 'pool', 'directAmm', 'direct_amm']) || payload;
    let base = namedNumber(root, ['reserveXrbc', 'xrbcReserve', 'baseReserve', 'reserveToken', 'tokenReserve']);
    let quote = namedNumber(root, ['reserveXrp', 'xrpReserve', 'quoteReserve']);
    let fee = namedNumber(root, ['tradingFee', 'trading_fee', 'feeRate', 'fee']);
    if ((!positive(base) || !positive(quote)) && root && typeof root === 'object') {
      const a = parseXrplAmount(root.amount);
      const b = parseXrplAmount(root.amount2);
      for (const item of [a, b]) {
        if (!item) continue;
        if (item.asset === 'XRBC') base = item.value;
        if (item.asset === 'XRP') quote = item.value;
      }
    }
    if (fee !== null && fee > 0.01) fee /= 100000;
    if (fee === null) fee = 0;
    if (!positive(base) || !positive(quote) || fee < 0 || fee >= 1) return null;
    return { base, quote, fee };
  }
  function normalizeOutstanding(payload) {
    const direct = namedNumber(payload, [
      'outstandingObligations', 'outstanding_obligations', 'outstanding', 'issuerObligations',
      'issuer_obligations', 'obligations', 'issued', 'issuedSupply'
    ]);
    return direct !== null && direct >= 0 ? direct : null;
  }
  function domXrpUsd() {
    const node = document.getElementById('xrbc-xrpusd');
    return node ? positive(node.textContent) : null;
  }
  function midpoint(context, amm) {
    const bid = positive(context?.bid), ask = positive(context?.ask);
    if (bid && ask && ask >= bid) return { value: (bid + ask) / 2, source: 'funded book midpoint' };
    if (amm) return { value: amm.quote / amm.base, source: 'AMM reserve ratio' };
    return { value: null, source: 'unavailable' };
  }
  function bookContext(context, price) {
    const asks = Array.isArray(context?.asks) ? context.asks : [];
    const prices = asks.map(row => positive(row?.price)).filter(Boolean).sort((a, b) => a - b);
    const best = prices[0] || positive(context?.ask);
    const highest = prices.at(-1) || null;
    return {
      count: asks.length,
      best,
      highest,
      bandPct: best && highest && price ? ((highest / price) - 1) * 100 : null
    };
  }
  function targetEstimate(amm, spot, move, valuationSupply) {
    if (!amm || !positive(spot)) return null;
    const factor = 1 + move;
    const effectiveQuote = amm.quote * (Math.sqrt(factor) - 1);
    const grossQuote = effectiveQuote / Math.max(1e-12, 1 - amm.fee);
    const targetPrice = spot * factor;
    const deltaValueXrp = Number.isFinite(valuationSupply) ? valuationSupply * spot * move : null;
    return {
      move,
      capitalXrp: grossQuote,
      targetPrice,
      deltaValueXrp,
      amplification: deltaValueXrp !== null && grossQuote > 0 ? deltaValueXrp / grossQuote : null
    };
  }
  function setMachineModel(model) {
    window.XRBC_LIQUIDITY_MODEL = Object.freeze(model);
    const panel = document.getElementById('xrbc-liquidity-impact');
    if (panel) {
      panel.dataset.updatedAt = model.updatedAt || '';
      panel.dataset.priceSource = model.price?.source || '';
      panel.dataset.supplyBasis = model.valuation?.basis || '';
      panel.dataset.model = 'constant-product-amm-plus-funded-book-context-v1';
    }
    document.dispatchEvent(new CustomEvent('xrbc:liquidity-model', { detail: model }));
  }

  function render() {
    const panel = document.getElementById('xrbc-liquidity-impact');
    if (!panel) return;
    const context = state.context || {};
    const amm = normalizeAmm(state.market);
    const price = midpoint(context, amm);
    const xrpUsd = domXrpUsd();
    const outstanding = normalizeOutstanding(state.supply);
    const book = bookContext(context, price.value);
    const supplyBasis = Number.isFinite(outstanding) ? outstanding : null;
    const markedXrp = supplyBasis !== null && price.value ? supplyBasis * price.value : null;
    const designXrp = price.value ? DESIGN_SUPPLY * price.value : null;
    const estimates = TARGETS.map(move => targetEstimate(amm, price.value, move, supplyBasis));

    text('xrbc-liq-model-price', price.value ? fmt(price.value, 9) + ' XRP' : '—');
    text('xrbc-liq-model-source', price.source);
    text('xrbc-liq-model-amm', amm ? `${fmt(amm.base, 4)} XRBC / ${fmt(amm.quote, 4)} XRP` : 'Awaiting AMM data');
    text('xrbc-liq-model-fee', amm ? pct(amm.fee * 100) : '—');
    text('xrbc-liq-model-book', context.bookState === 'available' ? `${book.count} nearest funded asks sampled` : 'Funded book unavailable');
    text('xrbc-liq-model-supply', supplyBasis !== null ? fmt(supplyBasis, 6) + ' XRBC' : 'Not asserted');
    text('xrbc-liq-model-marked', markedXrp !== null ? `${fmt(markedXrp, 2)} XRP${xrpUsd ? ' · ' + money(markedXrp * xrpUsd) : ''}` : 'Withheld until a supply basis is available');
    text('xrbc-liq-model-design', designXrp !== null ? `${fmt(designXrp, 2)} XRP${xrpUsd ? ' · ' + money(designXrp * xrpUsd) : ''}` : '—');
    text('xrbc-liq-model-updated', context.fetchedAt ? new Date(context.fetchedAt).toLocaleTimeString() : 'live refresh pending');

    estimates.forEach((row, index) => {
      const key = String(Math.round(TARGETS[index] * 100));
      text(`xrbc-liq-cap-${key}`, row ? xrp(row.capitalXrp) : '—');
      text(`xrbc-liq-target-${key}`, row ? fmt(row.targetPrice, 9) + ' XRP' : '—');
      text(`xrbc-liq-delta-${key}`, row && row.deltaValueXrp !== null ? `${fmt(row.deltaValueXrp, 2)} XRP${xrpUsd ? ' · ' + money(row.deltaValueXrp * xrpUsd) : ''}` : 'supply basis unavailable');
      text(`xrbc-liq-amp-${key}`, row && Number.isFinite(row.amplification) ? row.amplification.toFixed(2) + '×' : '—');
    });

    const model = {
      version: 1,
      updatedAt: context.fetchedAt || new Date().toISOString(),
      pair: context.pair || 'XRBC/XRP',
      price: { xrpPerXrbc: price.value, source: price.source, xrpUsd },
      amm: amm ? { xrbcReserve: amm.base, xrpReserve: amm.quote, feeRate: amm.fee } : null,
      fundedBook: { state: context.bookState || 'unknown', sampledAsks: book.count, bestAsk: book.best, highestSampledAsk: book.highest, sampledBandPct: book.bandPct },
      valuation: {
        basis: supplyBasis !== null ? 'outstanding issuer obligations; not asserted as circulating supply' : 'circulating supply unavailable',
        supplyUnits: supplyBasis,
        markedValueXrp: markedXrp,
        designSupplyUnits: DESIGN_SUPPLY,
        designSupplyValueXrp: designXrp,
        circulatingMarketCap: null
      },
      targets: estimates,
      formulas: {
        marketCap: 'circulatingSupply * marginalPrice',
        constantProduct: 'XRBCReserve * XRPReserve = k',
        targetQuoteInput: 'XRPReserve * (sqrt(1 + targetMove) - 1) / (1 - feeRate)',
        amplification: 'markedValuationChange / quoteCapitalUsed'
      },
      limitations: [
        'The amplification ratio is liquidity-state dependent and is not a universal multiplier.',
        'AMM target estimates model the direct constant-product pool; funded order-book and cross-venue routing can change real execution.',
        'Outstanding issuer obligations are not labeled circulating supply.',
        'Price is a funded-book midpoint when available, otherwise an AMM reserve ratio; neither is guaranteed execution.'
      ]
    };
    setMachineModel(model);
  }

  async function getJson(path, signal) {
    const response = await fetch(API + path, { headers: { Accept: 'application/json' }, cache: 'no-store', signal });
    if (!response.ok) throw new Error(`${path} returned HTTP ${response.status}`);
    return response.json();
  }
  async function refreshEvidence(force = false) {
    const now = Date.now();
    if (state.fetchPromise) return state.fetchPromise;
    if (!force && now - state.lastFetch < FETCH_MIN_MS) return;
    state.lastFetch = now;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 9000);
    state.fetchPromise = Promise.allSettled([
      getJson('/market/xrbc', controller.signal),
      getJson('/supply/xrbc', controller.signal)
    ]).then(results => {
      if (results[0].status === 'fulfilled') state.market = results[0].value;
      if (results[1].status === 'fulfilled') state.supply = results[1].value;
      render();
    }).catch(() => render()).finally(() => {
      clearTimeout(timeout);
      state.fetchPromise = null;
    });
    return state.fetchPromise;
  }

  function install() {
    const chart = document.querySelector('#xrbc-market .chart-shell');
    if (!chart || document.getElementById('xrbc-liquidity-impact')) return;
    const style = document.createElement('style');
    style.textContent = `
      #xrbc-liquidity-impact{margin:10px 0 0;border:1px solid var(--ui-border,#34445c);border-radius:8px;background:#0c1522;overflow:hidden}
      #xrbc-liquidity-impact>summary{cursor:pointer;padding:11px 13px;min-height:44px;color:#e6eefb;font-size:12px;font-weight:650}
      #xrbc-liquidity-impact[open]>summary{border-bottom:1px solid var(--ui-border,#34445c)}
      .xrbc-liq-body{padding:12px}.xrbc-liq-note{margin:0 0 10px!important;font-size:11px!important;line-height:1.5;color:var(--ui-muted,#b0bdd0)!important}
      .xrbc-liq-facts{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:7px;margin-bottom:10px}
      .xrbc-liq-fact{border:1px solid var(--ui-border,#34445c);border-radius:7px;padding:8px;background:#111d2c;min-width:0}.xrbc-liq-fact span{display:block;font-size:9px;color:var(--ui-muted,#b0bdd0);text-transform:uppercase;letter-spacing:.05em}.xrbc-liq-fact strong{display:block;margin-top:3px;font-size:12px;overflow-wrap:anywhere}
      .xrbc-liq-table{width:100%;border-collapse:collapse;font-size:11px}.xrbc-liq-table th,.xrbc-liq-table td{text-align:right;padding:7px 6px;border-top:1px solid var(--ui-border,#34445c);vertical-align:top}.xrbc-liq-table th:first-child,.xrbc-liq-table td:first-child{text-align:left}.xrbc-liq-sub{display:block;margin-top:2px;color:var(--ui-muted,#b0bdd0);font-size:9px;font-weight:400}
      .xrbc-liq-why{margin-top:10px}.xrbc-liq-why>summary{cursor:pointer;font-size:11px;color:#bcd1f3}.xrbc-liq-why p{font-size:11px!important;color:var(--ui-muted,#b0bdd0)!important;line-height:1.55;margin:8px 0 0!important}.xrbc-liq-machine{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:9px;color:#8394ac;margin-top:8px}
      @media(max-width:760px){.xrbc-liq-facts{grid-template-columns:repeat(2,minmax(0,1fr))}.xrbc-liq-table{font-size:10px}.xrbc-liq-table th,.xrbc-liq-table td{padding:6px 4px}}
      @media(max-width:430px){.xrbc-liq-table th:nth-child(3),.xrbc-liq-table td:nth-child(3){display:none}}
    `;
    document.head.append(style);

    const panel = document.createElement('details');
    panel.id = 'xrbc-liquidity-impact';
    panel.open = false;
    panel.setAttribute('data-xrbc-liquidity-model', 'v1');
    panel.innerHTML = `
      <summary>Liquidity impact &amp; market-cap mechanics <span id="xrbc-liq-model-updated" class="xrbc-liq-sub">live refresh pending</span></summary>
      <div class="xrbc-liq-body">
        <p class="xrbc-liq-note"><strong>Market cap is a valuation, not deposited cash.</strong> Price changes at the margin as executable liquidity is consumed. The model below refreshes with the chart and shows how the direct XRBC/XRP AMM can reprice without requiring capital equal to a market-cap change.</p>
        <div class="xrbc-liq-facts">
          <div class="xrbc-liq-fact"><span>Reference price</span><strong id="xrbc-liq-model-price">—</strong><small id="xrbc-liq-model-source" class="xrbc-liq-sub">—</small></div>
          <div class="xrbc-liq-fact"><span>Direct AMM reserves</span><strong id="xrbc-liq-model-amm">Awaiting AMM data</strong><small>Fee <span id="xrbc-liq-model-fee">—</span></small></div>
          <div class="xrbc-liq-fact"><span>Funded book context</span><strong id="xrbc-liq-model-book">Awaiting book</strong><small>Nearest live asks from chart snapshot</small></div>
          <div class="xrbc-liq-fact"><span>Outstanding obligations</span><strong id="xrbc-liq-model-supply">Not asserted</strong><small>Not labeled circulating supply</small></div>
          <div class="xrbc-liq-fact"><span>Marked value on obligation basis</span><strong id="xrbc-liq-model-marked">—</strong><small>Educational valuation, not market cap</small></div>
          <div class="xrbc-liq-fact"><span>21M design-supply valuation</span><strong id="xrbc-liq-model-design">—</strong><small>Not circulating market cap / not pool cash</small></div>
        </div>
        <div style="overflow-x:auto">
          <table class="xrbc-liq-table" aria-label="Modeled AMM capital required for target price changes">
            <thead><tr><th>Target move</th><th>AMM quote input</th><th>Target price</th><th>Marked-value change</th><th>Liquidity amplification</th></tr></thead>
            <tbody>
              <tr><th>+1%</th><td id="xrbc-liq-cap-1">—</td><td id="xrbc-liq-target-1">—</td><td id="xrbc-liq-delta-1">—</td><td id="xrbc-liq-amp-1">—</td></tr>
              <tr><th>+5%</th><td id="xrbc-liq-cap-5">—</td><td id="xrbc-liq-target-5">—</td><td id="xrbc-liq-delta-5">—</td><td id="xrbc-liq-amp-5">—</td></tr>
              <tr><th>+10%</th><td id="xrbc-liq-cap-10">—</td><td id="xrbc-liq-target-10">—</td><td id="xrbc-liq-delta-10">—</td><td id="xrbc-liq-amp-10">—</td></tr>
            </tbody>
          </table>
        </div>
        <details class="xrbc-liq-why"><summary>Why market cap ≠ money invested</summary><p>A quoted price is set by marginal executable liquidity. Multiplying that marginal price by a supply figure marks every unit at the same price for valuation purposes, even though those units did not all trade there. A thin AMM or order book can therefore move price—and a derived valuation—by much more than the quote capital used. The ratio is state-dependent, not a fixed multiplier.</p><p>The +1/+5/+10% rows model only the direct 50/50 constant-product AMM and its current fee. Real XRPL execution may use funded order-book offers, the AMM, or both, and arbitrage can change reserves while an order is executing.</p></details>
        <div class="xrbc-liq-machine">Machine-readable live object: <code>window.XRBC_LIQUIDITY_MODEL</code> · event: <code>xrbc:liquidity-model</code></div>
      </div>`;
    const controls = chart.querySelector('.xrbc-ui-chart-details');
    if (controls) chart.insertBefore(panel, controls); else chart.append(panel);
    panel.addEventListener('toggle', () => requestAnimationFrame(() => window.dispatchEvent(new Event('resize'))));
    render();
    refreshEvidence(true);
  }

  document.addEventListener('xrbc:market-context', event => {
    state.context = event.detail && typeof event.detail === 'object' ? event.detail : null;
    render();
    refreshEvidence(false);
  });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true });
  else install();
})();
