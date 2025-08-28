// xrpl-proxy.js
const WebSocket = require('ws');
const http = require('http');
const url = require('url');

// XRPL public node you want to connect to
const TARGET_NODE = 'wss://s1.ripple.com';

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('XRPL WebSocket Proxy running\n');
});

const wss = new WebSocket.Server({ noServer: true });

wss.on('connection', (wsClient) => {
  const wsNode = new WebSocket(TARGET_NODE);

  wsNode.on('open', () => {
    console.log('Connected to XRPL node', TARGET_NODE);
  });

  wsNode.on('message', (msg) => {
    wsClient.send(msg);
  });

  wsNode.on('close', () => wsClient.close());
  wsNode.on('error', (err) => {
    console.error('XRPL node error:', err);
    wsClient.close();
  });

  wsClient.on('message', (msg) => wsNode.send(msg));
  wsClient.on('close', () => wsNode.close());
  wsClient.on('error', (err) => wsNode.close());
});

server.on('upgrade', (req, socket, head) => {
  const pathname = url.parse(req.url).pathname;
  // Accept all upgrades to WS
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
});

// CORS headers for browser
server.on('request', (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
  }
});

const PORT = 8080;
server.listen(PORT, () => console.log(`XRPL WebSocket Proxy running on http://localhost:${PORT}`));
