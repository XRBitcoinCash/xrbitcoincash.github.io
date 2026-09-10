'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const api=require('../xrpl-proxy/api-v1.cjs');
const {createApi,XRBC,XRP}=api;
const WALLET='rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh';
const HASH='A'.repeat(64), TXHASH='B'.repeat(64), INDEX=100000000;
const EPOCH=Date.UTC(2026,8,10,9,0,0),CLOSE=EPOCH/1000-946684800-5;
const ENV={XAMAN_API_KEY:'11111111-1111-4111-8111-111111111111',XAMAN_API_SECRET:'test-only-no-real-secret'};
function fixture(config={}){
  let clock=EPOCH,created,pingCalls=0,accountBalance=config.balance||'2500',rpcCalls=[];
  const pinned={validated:true,ledger_hash:HASH,ledger_index:INDEX};
  const fetch=async(url,init)=>{
    if(url.includes('xumm.app')){
      if(url.endsWith('/ping')){pingCalls++;if(config.pingFails)throw new Error('private upstream auth detail');return {ok:true,json:async()=>config.ping||{pong:true,auth:{application:{uuidv4:ENV.XAMAN_API_KEY,disabled:0}}}};}
      if(init.method==='POST'){created=JSON.parse(init.body);return {ok:true,json:async()=>({uuid:'22222222-2222-4222-8222-222222222222',next:{always:'https://xumm.app/sign/example'}})};}
      const p={meta:{uuid:'22222222-2222-4222-8222-222222222222',exists:true,resolved:true,signed:true,cancelled:false,expired:false,force_network:'MAINNET'},application:{uuidv4:ENV.XAMAN_API_KEY,disabled:0},payload:{tx_type:'SignIn',request_json:{TransactionType:'SignIn'}},response:{account:WALLET,environment_nodetype:'MAINNET',environment_networkid:0},custom_meta:{identifier:created.custom_meta.identifier}};
      if(config.signin)config.signin(p);return {ok:true,json:async()=>p};
    }
    const {method,params:[p]}=JSON.parse(init.body);rpcCalls.push({method,params:p});let result;
    switch(method){
      case 'ledger':result={...pinned,ledger:{close_time:config.stale?CLOSE-100:CLOSE,ledger_index:INDEX}};break;
      case 'account_lines':{
        const lines=p.account===WALLET?(config.holderLines||[{currency:XRBC.currency,account:XRBC.issuer,balance:accountBalance,limit:'10000',no_ripple:true,peer_authorized:true}]):[{currency:XRBC.currency,account:WALLET,balance:'-9007199254740993'}];
        result={...pinned,account:p.account,lines};if(config.lines)result=config.lines(result,p);break;}
      case 'amm_info':{
        if(config.noPool){result={error:'actNotFound'};break;}
        const token={...XRBC,value:'10000'};result={...pinned,amm:{account:WALLET,amount:'1000000000',amount2:token,trading_fee:300,lp_token:{issuer:WALLET,currency:'03'+'1'.repeat(38),value:'500'},vote_slots:[]}};break;}
      case 'book_offers':{
        if(config.bookFails){result={error:'tooBusy'};break;}
        const sell=p.taker_gets.currency==='XRP';result={...pinned,offers:[{Account:XRBC.issuer,TakerGets:sell?'50000000':{...XRBC,value:'500'},TakerPays:sell?{...XRBC,value:'500'}:'51000000',owner_funds:sell?'50000000':'500'}]};break;}
      case 'account_info':result={...pinned,account_data:{Account:p.account,Flags:0x00800000,TransferRate:1000000000}};break;
      case 'account_objects':result={...pinned,account:p.account,account_objects:[]};break;
      case 'gateway_balances':result={...pinned,account:p.account,obligations:{[XRBC.currency]:'20999999.999999996'}};break;
      case 'account_tx':result={account:p.account,transactions:[],ledger_index_min:1,ledger_index_max:INDEX};break;
      case 'tx':result={hash:TXHASH,validated:true,ledger_index:INDEX,tx_json:{TransactionType:'Payment',Account:WALLET,Destination:XRBC.issuer,Amount:{...XRBC,value:'0.10000000000000001'}},meta:{TransactionResult:'tesSUCCESS',delivered_amount:{...XRBC,value:'0.10000000000000001'}}};break;
      default:throw new Error('Unexpected mock RPC '+method);
    }
    if(config.response)result=config.response(result,method,p);
    return {ok:true,json:async()=>({result})};
  };
  const handler=createApi({fetch,now:()=>clock,env:config.noAuth?{}:ENV,supplyPolicy:config.supplyPolicy});
  async function request(url,{method='GET',body,token,rawAuthorization,ip='198.51.100.1'}={}){
    const req={url,method,body,headers:token?{authorization:'Bearer '+token}:rawAuthorization?{authorization:rawAuthorization}:{},socket:{remoteAddress:ip}};
    // Express exposes a getter-only req.ip. This catches assignment regressions.
    Object.defineProperty(req,'ip',{get:()=>ip});const headers={};let text;
    const res={statusCode:200,setHeader:(k,v)=>{headers[k.toLowerCase()]=v;},end:value=>{text=value;}};
    await handler(req,res);return {status:res.statusCode,body:text?JSON.parse(text):null,headers,text};
  }
  async function signIn(tools=['extended-audit']){
    const c=await request('/auth/challenges',{method:'POST',body:{account:WALLET,tools}});assert.equal(c.status,200);
    const v=await request('/auth/sessions',{method:'POST',body:{challengeId:c.body.data.challengeId,challengeSecret:c.body.data.challengeSecret}});
    return {challenge:c.body.data,verification:v,token:v.body.data?.accessToken};
  }
  return {request,signIn,rpcCalls,pingCount:()=>pingCalls,setBalance:v=>{accountBalance=v;},advance:ms=>{clock+=ms;}};
}
test('public discovery works with Express getter-only request properties',async()=>{const f=fixture();const r=await f.request('/');assert.equal(r.status,200);assert.equal(r.body.data.mode,'read_only');assert.equal(r.headers['cache-control'],'no-store');});
test('classic-address checksum rejects an altered issuer',()=>{assert.equal(api.address(WALLET),WALLET);assert.throws(()=>api.address(WALLET.slice(0,-1)+'s'));});
test('decimal comparison and summation preserve exact fractional and large balances',()=>{assert.equal(api.compare('49.999999999999999','50'),-1);assert.equal(api.compare('5e1','50.000'),0);assert.equal(api.sumDecimals(['9007199254740993','0.000000001']),'9007199254740993.000000001');assert.notEqual(api.compare('0.10000000000000001','0.1'),0);});

const SECOND_WALLET='rPT1Sjq2YGrBMTttX4GZHjKu9dyfzbpAYe';
function reviewedSupply(exclusions=[]){
  const policy=JSON.parse(fs.readFileSync(path.join(__dirname,'../xrpl-proxy/supply-policy.json'),'utf8'));
  policy.circulation={reviewStatus:'project-reviewed',reviewedAt:'2026-09-10',evidenceUrl:'https://example.com/allocation-policy',exclusions};
  return policy;
}
const escrow=(index,value,issuer=XRBC.issuer)=>({index:index.repeat(64),LedgerEntryType:'Escrow',Amount:{currency:XRBC.currency,issuer,value}});
test('tracker supply preserves decimal bytes and withholds unreviewed circulation',async()=>{
  const f=fixture({noAuth:true}),combined=await f.request('/supply/xrbc'),total=await f.request('/supply/xrbc/total'),max=await f.request('/supply/xrbc/max'),circ=await f.request('/supply/xrbc/circulating');
  assert.equal(combined.status,200);assert.equal(combined.body.data.totalSupply,'20999999.999999996');
  assert.equal(combined.body.data.circulatingSupply,null);assert.equal(combined.body.data.maxSupplyVerifiedOnLedger,false);
  assert.equal(total.status,200);assert.equal(total.text,'20999999.999999996');assert.equal(total.headers['content-type'],'text/plain; charset=utf-8');
  assert.equal(total.headers['x-xrpl-ledger-hash'],HASH);assert.equal(total.headers['cache-control'],'no-store');
  assert.equal(max.text,'21000000');assert.equal(max.headers['x-xrbc-supply-basis'],'project-declared');
  assert.equal(circ.status,503);assert.equal(circ.body.error.code,'supply_unverified');assert.ok(circ.headers['retry-after']);
  assert.equal(f.rpcCalls.filter(x=>x.method==='gateway_balances').length,1);assert.equal(f.pingCount(),0);
});
test('total includes frozen and exact-issuer escrow; circulating avoids double exclusions',async()=>{
  const entries=[{address:WALLET,reason:'treasury',evidenceUrl:'https://example.com/treasury'},{address:SECOND_WALLET,reason:'locked',evidenceUrl:'https://example.com/lock'}];
  const f=fixture({supplyPolicy:reviewedSupply(entries),response:(r,method,p)=>{
    if(method==='gateway_balances')return {...r,obligations:{[XRBC.currency]:'100'},frozen_balances:{[SECOND_WALLET]:[{currency:XRBC.currency,value:'20'}]},locked:{[XRBC.currency]:'999999'},...(p.hotwallet?{balances:{[WALLET]:[{currency:XRBC.currency,value:'30'}],[SECOND_WALLET]:[{currency:XRBC.currency,value:'20'}]}}:{})};
    if(method==='account_objects')return {...r,account_objects:[escrow('C','10'),escrow('D','999999',WALLET)]};return r;
  }}),r=await f.request('/supply/xrbc');
  assert.equal(r.status,200);const s=r.body.data;assert.equal(s.totalSupply,'130');assert.equal(s.escrowedSupply,'10');
  assert.equal(s.circulatingSupply,'70');assert.equal(s.nonCirculatingSupply,'60');assert.equal(s.excludedAccountSupply,'30');
  assert.equal(s.exclusions[1].additionalExcluded,'0');assert.equal(s.escrowInventory.objects,1);
  assert.ok(f.rpcCalls.filter(x=>x.method!=='ledger').every(x=>x.params.ledger_hash===HASH));
});
test('filtered empty escrow pages are followed until no marker remains',async()=>{
  const f=fixture({response:(r,m,p)=>m==='account_objects'?{...r,account_objects:p.marker?[escrow('C','0.000001')]:[],...(p.marker?{}:{marker:'next'})}:r});
  const r=await f.request('/supply/xrbc');assert.equal(r.status,200);assert.equal(r.body.data.escrowInventory.pages,2);
  assert.equal(r.body.data.totalSupply,'21000000.000000996');assert.equal(r.body.data.maxSupply,null);
  assert.equal((await f.request('/supply/xrbc/max')).status,503);
});
test('incomplete escrow traversal never produces partial supply or zero',async()=>{
  const f=fixture({response:(r,m,p)=>m==='account_objects'?{...r,marker:String(Number(p.marker||0)+1)}:r});
  const r=await f.request('/supply/xrbc/total');assert.equal(r.status,503);assert.equal(r.body.error.code,'incomplete_supply');
  assert.equal(f.rpcCalls.filter(x=>x.method==='account_objects').length,10);
});
test('duplicate escrow identities and repeated pagination markers fail closed',async()=>{
  for(const response of [(r,m)=>m==='account_objects'?{...r,account_objects:[escrow('C','1'),escrow('C','1')]}:r,(r,m)=>m==='account_objects'?{...r,marker:'repeat'}:r]){
    const r=await fixture({response}).request('/supply/xrbc/total');assert.equal(r.status,502);assert.equal(r.body.error.code,'invalid_supply_data');
  }
});
test('malformed upstream supply is never coerced to zero',async()=>{
  for(const bad of [null,[],{[XRBC.currency]:5},{[XRBC.currency]:'NaN'},{[XRBC.currency]:'-1'}]){
    const f=fixture({response:(r,m)=>m==='gateway_balances'?{...r,obligations:bad}:r});
    const r=await f.request('/supply/xrbc/total');assert.equal(r.status,502);assert.equal(r.body.error.code,'invalid_supply_data');
  }
});
test('supply rejects different account/ledger evidence and stale collections',async()=>{
  for(const change of [{account:WALLET},{ledger_hash:'F'.repeat(64)},{validated:false}]){
    const r=await fixture({response:(r,m)=>m==='account_objects'?{...r,...change}:r}).request('/supply/xrbc/total');assert.equal(r.status,502);
  }
  let f;f=fixture({response:(r,m)=>{if(m==='account_objects')f.advance(61000);return r;}});
  const r=await f.request('/supply/xrbc/total');assert.equal(r.status,503);assert.equal(r.body.error.code,'stale_ledger');
});
test('reviewed empty allocation policy can report a legitimate zero circulating value',async()=>{
  const f=fixture({supplyPolicy:reviewedSupply(),response:(r,m)=>{if(m==='gateway_balances'){const {obligations,...empty}=r;return empty;}return r;}});
  const r=await f.request('/supply/xrbc/circulating');assert.equal(r.status,200);assert.equal(r.text,'0');
});
test('supply policy rejects duplicate/issuer exclusions and unverifiable review metadata',async()=>{
  const entry={address:WALLET,reason:'team',evidenceUrl:'https://example.com/team'};
  const policies=[reviewedSupply([entry,entry]),reviewedSupply([{...entry,address:XRBC.issuer}]),reviewedSupply([{...entry,evidenceUrl:'file:///secret'}])];
  for(const date of ['2026-02-31','2099-01-01',null]){const p=reviewedSupply();p.circulation.reviewedAt=date;policies.push(p);}
  const wrong=reviewedSupply();wrong.asset.issuer=WALLET;policies.push(wrong);
  for(const supplyPolicy of policies){const r=await fixture({supplyPolicy}).request('/supply/xrbc/total');assert.equal(r.status,503);assert.equal(r.body.error.code,'supply_policy_unavailable');}
});
test('unrequested or excessive excluded balances cannot inflate or underflow circulation',async()=>{
  const entry={address:WALLET,reason:'team',evidenceUrl:'https://example.com/team'};
  for(const balances of [{[WALLET]:[{currency:XRBC.currency,value:'30000000'}]},{[SECOND_WALLET]:[{currency:XRBC.currency,value:'1'}]}]){
    const r=await fixture({supplyPolicy:reviewedSupply([entry]),response:(r,m,p)=>m==='gateway_balances'&&p.hotwallet?{...r,balances}:r}).request('/supply/xrbc/circulating');
    assert.equal(r.status,502);assert.equal(r.body.error.code,'invalid_supply_data');
  }
});
test('combined tracker metrics withhold unverified capitalization and historical metrics',async()=>{
  const f=fixture(),r=await f.request('/metrics/xrbc');assert.equal(r.status,200);
  assert.equal(r.body.data.estimatedMarketCapXrp,null);assert.equal(r.body.data.estimatedFullyDilutedValueXrp,'2100000');
  for(const field of ['marketCapUsd','volume24h','priceChange24h'])assert.equal(r.body.data[field],null);
  const noPool=await fixture({noPool:true,supplyPolicy:reviewedSupply()}).request('/metrics/xrbc');
  assert.equal(noPool.status,200);assert.equal(noPool.body.data.estimatedMarketCapXrp,null);assert.equal(noPool.body.data.estimatedFullyDilutedValueXrp,null);
});
test('query parameters cannot supply allocation facts or override the declared cap',async()=>{
  const r=await fixture().request('/supply/xrbc?circulatingSupply=21000000&maxSupply=999&reviewStatus=project-reviewed');
  assert.equal(r.status,200);assert.equal(r.body.data.circulatingSupply,null);assert.equal(r.body.data.maxSupply,'21000000');
});
test('AMM asset order and fee units are normalized',()=>{const p=api.poolData({amm:{account:WALLET,amount:'1000000000',amount2:{...XRBC,value:'10000'},trading_fee:300}},XRBC);assert.deepEqual(p.reserves,['10000','1000']);assert.equal(p.feePercent,.3);const q=api.ammQuote(p,25,XRP,XRBC);assert(q.output>0);assert(q.impactPercent>0);});
test('funded books share owner budget and preserve tiny partial fills',()=>{const offer={Account:WALLET,TakerGets:'10000000',TakerPays:{...XRBC,value:'100'},owner_funds:'10000000'};const b=api.fundedBook({offers:[offer,offer]},XRBC,XRP);assert.equal(b.fundedOffers,1);assert.equal(b.rows[0].output,'10');assert.equal(api.simulateBook({rows:[{maker:'one',input:'1e-13',rate:'1'}],fundedOffers:1},1e-12).partial,true);});
test('Sentinel succeeds when unrelated books are unavailable; absent pool has null score',async()=>{const f=fixture({bookFails:true});const r=await f.request('/liquidity');assert.equal(r.status,200);assert.equal(typeof r.body.data.analysis.score,'number');assert(!f.rpcCalls.some(c=>c.method==='book_offers'));const absent=await fixture({noPool:true}).request('/liquidity');assert.equal(absent.body.data.analysis.score,null);});
test('public market responses pin every dependent read and keep unknown volume null',async()=>{const f=fixture(),r=await f.request('/market/xrbc');assert.equal(r.status,200);assert.equal(r.body.data.volume24h,null);assert.equal(r.body.data.priceType,'AMM reserve ratio; not last traded price.');for(const c of f.rpcCalls.filter(c=>c.method!=='ledger'))assert.equal(c.params.ledger_hash,HASH);});
test('public snapshot cache shares concurrent requests',async()=>{const f=fixture();await Promise.all([f.request('/market/xrbc'),f.request('/market/xrbc')]);assert.equal(f.rpcCalls.filter(c=>c.method==='ledger').length,1);assert.equal(f.rpcCalls.filter(c=>c.method==='amm_info').length,1);});
test('current s1 book and supply responses may omit validated but must match checkpoint hash/index',async()=>{const f=fixture({response:(r,m)=>{if(['book_offers','gateway_balances'].includes(m)){const {validated,...rest}=r;return rest;}return r;}});assert.equal((await f.request('/market/xrbc')).status,200);assert.equal((await f.request('/supply/xrbc')).status,200);});
test('stale ledgers and mismatched upstream snapshot identities fail closed',async()=>{assert.equal((await fixture({stale:true}).request('/ledger')).status,503);for(const mutate of [r=>({...r,validated:false}),r=>({...r,ledger_hash:'F'.repeat(64)}),r=>({...r,ledger_index:INDEX+1})]){const f=fixture({response:(r,m)=>m==='book_offers'?mutate(r):r});assert.equal((await f.request('/market/xrbc')).status,502);}});
test('XRP inputs reject fractional drops',async()=>{const r=await fixture().request('/market/xrbc/quote?amount=0.0000001');assert.equal(r.status,400);});
test('protected endpoints reject missing authentication before ledger analytics',async()=>{const f=fixture(),r=await f.request('/tools/risk-lens/report');assert.equal(r.status,401);assert.equal(f.rpcCalls.length,0);});
test('unconfigured wallet authentication fails safely without affecting public catalog',async()=>{const f=fixture({noAuth:true});assert.equal((await f.request('/tools')).status,200);assert.equal((await f.request('/auth/challenges',{method:'POST',body:{account:WALLET,tools:['risk-lens']}})).body.error.code,'authentication_unconfigured');});
test('server-bound signature verifies once; private challenge secret and replay checks hold',async()=>{const f=fixture();const c=await f.request('/auth/challenges',{method:'POST',body:{account:WALLET,tools:['extended-audit']}});const body={challengeId:c.body.data.challengeId,challengeSecret:'wrong'};assert.equal((await f.request('/auth/sessions',{method:'POST',body})).status,401);body.challengeSecret=c.body.data.challengeSecret;assert.equal((await f.request('/auth/sessions',{method:'POST',body})).status,200);assert.equal((await f.request('/auth/sessions',{method:'POST',body})).status,401);});
test('wrong application, wallet, network, type and cancelled signatures are rejected',async()=>{const mutations=[p=>{p.application.uuidv4='other';},p=>{p.response.account=XRBC.issuer;},p=>{p.response.environment_networkid=1;},p=>{p.meta.force_network='TESTNET';},p=>{p.payload.tx_type='Payment';},p=>{p.meta.cancelled=true;}];for(const signin of mutations){const {verification}=await fixture({signin}).signIn();assert.equal(verification.status,401);}});
test('exact balance threshold rejects rounding-up and rechecks on each request',async()=>{const f=fixture({balance:'49.999999999999999'}),{token}=await f.signIn();const first=await f.request('/tools/extended-audit/report',{token});assert.equal(first.status,403);assert(!f.rpcCalls.some(c=>c.method==='amm_info'));f.setBalance('50');assert.equal((await f.request('/tools/extended-audit/report',{token})).status,200);f.setBalance('0');assert.equal((await f.request('/tools/extended-audit/report',{token})).status,403);});
test('missing or conflicting gate account, issuer, validation and duplicate lines cannot grant access',async()=>{for(const lines of [r=>({...r,account:XRBC.issuer}),r=>({...r,validated:false}),r=>({...r,lines:r.lines.map(x=>({...x,account:WALLET}))}),r=>({...r,lines:[...r.lines,...r.lines]})]){const f=fixture({lines}),{token}=await f.signIn();assert.equal((await f.request('/tools/extended-audit/report',{token})).status,502);assert(!f.rpcCalls.some(c=>c.method==='amm_info'));}});
test('incomplete pagination never grants access, including short pages',async()=>{const f=fixture({lines:(r,p)=>({...r,lines:p.marker?[]:r.lines,marker:'next'})}),{token}=await f.signIn();const r=await f.request('/tools/extended-audit/report',{token});assert.equal(r.status,503);assert.equal(f.rpcCalls.filter(c=>c.method==='account_lines').length,3);});
test('scope, bearer prefix, expiry and revocation prevent unauthorized reuse',async()=>{const f=fixture(),{token}=await f.signIn();assert.equal((await f.request('/tools/risk-lens/report',{token})).status,403);assert.equal((await f.request('/auth/session',{method:'DELETE',rawAuthorization:token})).status,401);assert.equal((await f.request('/auth/session',{method:'DELETE',token})).status,200);assert.equal((await f.request('/tools/extended-audit/report',{token})).status,401);const second=await f.signIn();f.advance(300001);assert.equal((await f.request('/tools/extended-audit/report',{token:second.token})).status,401);});
test('transaction identity and exact delivered amounts control invoice matching',()=>{const base={hash:TXHASH,validated:true,tx_json:{TransactionType:'Payment',Destination:XRBC.issuer},meta:{TransactionResult:'tesSUCCESS',delivered_amount:{...XRBC,value:'0.10000000000000001'}}};assert.throws(()=>api.receiptResult({...base,hash:HASH},TXHASH));const receipt=api.receiptResult(base,TXHASH);assert.equal(api.compareInvoice(receipt,{destination:XRBC.issuer,asset:XRBC,amount:'0.1'}).matches,false);assert.equal(api.compareInvoice(receipt,{destination:XRBC.issuer,asset:XRBC,amount:'0.10000000000000001'}).matches,true);});
test('partial payments with unknown delivery and validated failures cannot match invoices',()=>{const base={hash:TXHASH,validated:true,tx_json:{TransactionType:'Payment',Destination:XRBC.issuer,Flags:0x00020000,Amount:{...XRBC,value:'1000'}},meta:{TransactionResult:'tesSUCCESS',delivered_amount:'unavailable'}};assert.equal(api.receiptResult(base,TXHASH).delivered,null);base.meta.TransactionResult='tecPATH_DRY';assert.equal(api.receiptResult(base,TXHASH).successful,false);});
test('advanced outstanding-holder sums remain exact, evidence stays incomplete without external source',async()=>{const f=fixture(),{token}=await f.signIn(['asset-tokenization-auditor-advanced']);const r=await f.request('/tools/asset-tokenization-auditor-advanced/report',{token});assert.equal(r.status,200);assert.equal(r.body.data.holders.issuedBalance,'9007199254740993');assert.equal(r.body.data.analysis.complete,false);});
test('bridge check handles zero reserves without claiming independent verification',async()=>{const f=fixture(),{token}=await f.signIn(['xrpl-bridge-integrity-monitor']);const r=await f.request('/bridges/evidence-check',{method:'POST',token,body:{asset:XRP,reserve:'0',liability:'1',observedAt:new Date(EPOCH).toISOString()}});assert.equal(r.status,200);assert.equal(r.body.data.reserveCoversLiability,false);assert.equal(r.body.data.independentlyVerified,false);});
test('public rate limit is bounded and returns retry guidance',async()=>{const f=fixture();let r;for(let i=0;i<61;i++)r=await f.request('/project');assert.equal(r.status,429);assert(r.headers['retry-after']);});
test('OpenAPI routes and portal catalog agree with the release inventory',()=>{
 const root=path.resolve(__dirname,'..'),spec=JSON.parse(fs.readFileSync(root+'/xrpl-proxy/openapi.json'));
 assert.equal(spec.openapi,'3.1.0');assert.equal(spec.info.version,api.VERSION);assert.equal(Object.keys(spec.paths).length,24);assert.equal(api.TOOLS.length,12);
 const scalar=spec.paths['/supply/xrbc/{metric}'].get;assert.deepEqual(scalar.parameters[0].schema.enum,['total','circulating','max']);assert.ok(scalar.responses[200].content['text/plain']);assert.ok(scalar.responses[503]);assert.ok(spec.paths['/metrics/xrbc'].get.responses[200]);
 for(const [endpoint,method] of [['/transactions/{hash}','get'],['/settlement/verify','post']]){
  const conflict=spec.paths[endpoint][method].responses['409'];
  assert.match(conflict.description,/not been validated/i);
  assert.equal(conflict.content['application/json'].schema.$ref,'#/components/schemas/Error');
 }
});

test('read-only authentication health verifies app identity and caches concurrent pings',async()=>{
 const f=fixture();const responses=await Promise.all([f.request('/status'),f.request('/status')]);
 for(const r of responses){assert.equal(r.status,200);assert.equal(r.body.data.walletAuthenticationVerified,true);}
 assert.equal(f.pingCount(),1);f.advance(30001);await f.request('/status');assert.equal(f.pingCount(),2);
});
test('missing, invalid, disabled or unavailable Xaman credentials never report verified',async()=>{
 for(const config of [{noAuth:true},{pingFails:true},{ping:{pong:true,auth:{application:{uuidv4:'wrong'}}}},{ping:{pong:true,auth:{application:{uuidv4:ENV.XAMAN_API_KEY,disabled:1}}}},{ping:{error:{message:'private credential detail'}}}]){
  const f=fixture(config),r=await f.request('/status');assert.equal(r.status,200);assert.equal(r.body.data.walletAuthenticationVerified,false);assert(!JSON.stringify(r).includes('private'));
  if(config.noAuth)assert.equal(f.pingCount(),0);
 }
});
test('required body assets never silently default to XRBC',async()=>{
 const f=fixture();
 const {token}=await f.signIn(['value-path','xrpl-bridge-integrity-monitor']);
 for(const body of [{to:XRP,amount:'1'},{from:XRP,amount:'1'}]){
  const r=await f.request('/trade/quote',{method:'POST',body,token});
  assert.equal(r.status,400);assert.equal(r.body.error.code,'invalid_request');
 }
 const bridge=await f.request('/bridges/evidence-check',{method:'POST',token,body:{reserve:'1',liability:'1',observedAt:new Date(EPOCH).toISOString()}});
 assert.equal(bridge.status,400);assert.equal(bridge.body.error.code,'invalid_request');
 const receipt=await f.request('/settlement/verify',{method:'POST',body:{hash:TXHASH,invoice:{destination:XRBC.issuer,amount:'0.10000000000000001'}}});
 assert.equal(receipt.status,400);assert.equal(receipt.body.error.code,'invalid_request');
 assert(!f.rpcCalls.some(c=>c.method==='tx'),'an incomplete invoice must be rejected before receipt lookup');
 const publicDefault=await f.request('/liquidity');
 assert.equal(publicDefault.status,200);assert.deepEqual(publicDefault.body.data.asset,XRBC);
});
