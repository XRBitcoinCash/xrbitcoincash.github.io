// xrpl-proxy/server.js (DEBUG)
const express = require('express');
const axios = require('axios');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 10000;

// ===== Middleware =====
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use((req, _res, next) => {
  console.log(`[REQ] ${req.method} ${req.path}`);
  next();
});

// ===== XRPL endpoint =====
const XRPL_RPC = 'https://s1.ripple.com:51234';

async function xrplRpc(body) {
  const resp = await axios.post(XRPL_RPC, body, {
    headers: { 'Content-Type': 'application/json' },
    timeout: 20000,
  });
  return resp.data;
}

// ===== Health =====
app.get('/healthz', (_req, res) => res.json({ ok: true, ts: Date.now() }));

// ===== XRPL generic proxy =====
app.post('/', async (req, res) => {
  try {
    const data = await xrplRpc(req.body);
    res.json(data);
  } catch (err) {
    console.error('generic proxy error:', err?.response?.status, err?.message);
    res.status(502).json({ error: 'Proxy request failed', detail: err?.message || String(err) });
  }
});

// ===== XRPL ledger =====
app.get('/api/xrpl/ledger', async (_req, res) => {
  try {
    const data = await xrplRpc({ method: 'ledger', params: [{ ledger_index: 'validated' }] });
    res.json(data);
  } catch (err) {
    console.error('ledger error', err?.message || err);
    res.status(502).json({ error: 'Ledger fetch failed', detail: err?.message || String(err) });
  }
});

// ===== XRPL account info =====
app.get('/api/xrpl/account/:acct', async (req, res) => {
  try {
    const account = req.params.acct;
    const data = await xrplRpc({ method: 'account_info', params: [{ account, ledger_index: 'validated' }] });
    res.json(data);
  } catch (err) {
    console.error('account error', err?.message || err);
    res.status(502).json({ error: 'Account fetch failed', detail: err?.message || String(err) });
  }
});

// ===== Chat proxy to OpenAI =====
app.post('/chat', async (req, res) => {
  try {
    const { messages } = req.body || {};
    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'Missing messages array' });
    }

    const payload = {
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      messages,
    };

    const r = await axios.post('https://api.openai.com/v1/chat/completions', payload, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      timeout: 30000,
      validateStatus: () => true,
    });

    if (!r.data || typeof r.data !== 'object') {
      console.error('OpenAI non-JSON response:', r.status, r.data);
      return res.status(502).json({ error: 'OpenAI returned non-JSON', status: r.status });
    }

    if (r.status < 200 || r.status >= 300) {
      console.error('OpenAI error:', r.status, r.data);
      return res.status(502).json({ error: 'Upstream OpenAI error', status: r.status, detail: r.data });
    }

    return res.json(r.data);
  } catch (err) {
    console.error('[chat proxy error]', err?.message || err);
    res.status(502).json({ error: 'Chat proxy request failed', detail: err?.message || String(err) });
  }
});

// ===== Env sanity (no secrets) =====
app.get('/env-check', (_req, res) => {
  res.json({
    hasOpenAIKey: !!process.env.OPENAI_API_KEY,
    model: process.env.OPENAI_MODEL || 'gpt-4o-mini'
  });
});

// ===== 404 JSON fallback =====
app.use((req, res) => {
  res.status(404).json({ error: 'Not found', path: req.path, method: req.method });
});

// ===== Route list (prints once on boot) =====
function printRoutes() {
  const routes = [];
  app._router.stack.forEach(mw => {
    if (mw.route) {
      routes.push(`${Object.keys(mw.route.methods).join(',').toUpperCase()} ${mw.route.path}`);
    } else if (mw.name === 'router' && mw.handle?.stack) {
      mw.handle.stack.forEach(r => {
        if (r.route) routes.push(`${Object.keys(r.route.methods).join(',').toUpperCase()} ${r.route.path}`);
      });
    }
  });
  console.log('[ROUTES]', routes);
}

// ===== Start =====
app.listen(PORT, () => {
  console.log(`XRPL proxy running on port ${PORT}`);
  printRoutes();
});
