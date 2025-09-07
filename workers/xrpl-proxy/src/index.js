// workers/xrpl-proxy/src/index.js
// Simple CORS proxy for XRPL JSON-RPC. For basic usage only (read queries).
// Uses env.XRPL_TARGET (set in wrangler.toml) or defaults to xrplcluster.

export default {
  async fetch(request, env) {
    // handle CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Authorization",
        },
      });
    }

    const XRPL_TARGET = env.XRPL_TARGET || "https://xrplcluster.com/";

    // If request looks like a websocket upgrade, forward to websocket handler (optional)
    const upgradeHeader = request.headers.get("Upgrade");
    if (upgradeHeader && upgradeHeader.toLowerCase() === "websocket") {
      // Attempt a straight-through websocket proxy by forwarding request to the target.
      // For heavy/long-lived WebSocket usage consider Durable Objects (see notes).
      const proxied = new Request(XRPL_TARGET, {
        method: request.method,
        headers: request.headers,
        body: request.body,
        redirect: "manual",
      });
      return fetch(proxied);
    }

    // For JSON-RPC and normal HTTP requests, forward POST/GET to XRPL TARGET root ('/').
    // XRPL JSON-RPC expects POST to / with Content-Type: application/json
    const forwardReq = new Request(XRPL_TARGET, {
      method: request.method,
      headers: request.headers,
      body: request.body,
      redirect: "manual",
    });

    const res = await fetch(forwardReq);

    // Copy response back and inject CORS headers so browsers can call this worker.
    const headers = new Headers(res.headers);
    headers.set("Access-Control-Allow-Origin", "*");
    headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
    headers.set("Access-Control-Allow-Methods", "GET,POST,OPTIONS");

    return new Response(res.body, {
      status: res.status,
      headers,
    });
  },
};
