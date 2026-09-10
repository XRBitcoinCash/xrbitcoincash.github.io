'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const axios = require('../xrpl-proxy/node_modules/axios/dist/node/axios.cjs');
test('deployed Express stack preserves public reads and rejects unsafe or unsigned requests', async () => {
  // Exercise the real middleware and routes, with the external ledger transport mocked.
  const originalPost = axios.post, originalListen = http.Server.prototype.listen, originalLog = console.log;
  console.log = (...args) => { if (!String(args[0]).startsWith('[REQ]')) originalLog(...args); };
  let server, forwarded = 0;
  axios.post = async (_url, body) => {forwarded++;return {data:{result:{status:'success',method:body.method}}};};
  http.Server.prototype.listen = function () {server=this;return this;};
  try { require('../xrpl-proxy/server.js'); } finally { http.Server.prototype.listen=originalListen; }
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base='http://127.0.0.1:'+server.address().port;
  const post=body=>fetch(base+'/',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
  try {
    assert.equal((await fetch(base+'/healthz')).status,200);
    assert.equal((await fetch(base+'/api/v1/project')).status,200);
    const denied=await fetch(base+'/api/v1/tools/risk-lens/report');
    assert.equal(denied.status,401);
    assert.equal((await denied.json()).error.code,'authentication_required');
    assert.equal((await post({method:'ledger',params:[{ledger_index:'validated'}]})).status,200);
    assert.equal(forwarded,1);
    assert.equal((await post({method:'submit',params:[{}]})).status,400);
    assert.equal((await post({method:'simulate',params:[{secret:'test-only'}]})).status,400);
    assert.equal(forwarded,1,'rejected requests must not reach the ledger');
    const invalid=await fetch(base+'/api/v1/tokenization/plan',{method:'POST',headers:{'content-type':'application/json'},body:'{'});
    assert.equal(invalid.status,400);
    assert.equal((await invalid.json()).error.code,'invalid_json');
    const cors=await fetch(base+'/api/v1/project',{headers:{Origin:'https://xrbitcoincash.com'}});
    assert.equal(cors.headers.get('access-control-allow-origin'),'*');
    const baseline=forwarded;
    let limited;
    for(let i=0;i<181;i++)limited=await post({method:'ping'});
    assert.equal(limited.status,429);
    assert(Number(limited.headers.get('retry-after'))>0);
    assert(forwarded-baseline<181);
  } finally {
    axios.post=originalPost;
    console.log=originalLog;
    await new Promise(resolve=>server.close(resolve));
  }
});
