// xrbitcoincash Cloudflare Worker proxy to XRPL JSON-RPC

export default {
  async fetch(request, env) {
    // Handle CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "https://xrbitcoincash.com",
          "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Authorization",
        },
      });
    }

    const XRPL_TARGET = env.XRPL_TARGET || "https://xrplcluster.com/";

    // Forward request to XRPL node
    const forwardReq = new Request(XRPL_TARGET, {
      method: request.method,
      headers: request.headers,
      body: request.body,
      redirect: "manual",
    });

    const res = await fetch(forwardReq);

    // Inject CORS headers for your site
    const headers = new Headers(res.headers);
    headers.set("Access-Control-Allow-Origin", "https://xrbitcoincash.com");
    headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
    headers.set("Access-Control-Allow-Methods", "GET,POST,OPTIONS");

    return new Response(res.body, {
      status: res.status,
      headers,
    });
  },
};
