'use strict';
// XRBitcoinCash Developer API v1. Read-only; no wallet secrets or transaction submission.
const crypto = require('node:crypto');
const core = require('./api-core.cjs');
const VERSION = '1.0.0';
const SITE = 'https://xrbitcoincash.com';
const BASE = 'https://xrbitcoincash-github-io.onrender.com/api/v1';
const XRBC = Object.freeze({currency:'5852626974636F696E6361736800000000000000',issuer:'rEjwniYhYR5QDZzK1a1x2359j8j8N43Ypw'});
const XRP = Object.freeze({currency:'XRP'});
const TOOLS = [
  ['liquidity-sentinel','Liquidity Sentinel',0,'Direct XRP pool health, reserves, fees and impact.','snapshot'],
  ['extended-audit','Extended Auditor',50,'Market, issuer and sampled participation evidence. Full browser composite is not published by v1.','evidence'],
  ['sentinel-forensics','Sentinel Forensics',150,'Holder concentration, validated pool events, issuer history and AMM governance.','evidence'],
  ['risk-lens','Risk Lens',150,'Issuer restrictions, funded market depth and wallet exposure evidence. Full browser risk score remains withheld.','evidence'],
  ['value-path','Value Path',400,'Compare direct and XRP intermediary AMM/book quote candidates.','quotes'],
  ['watchtower','Watchtower',1000,'A current threshold-based snapshot. Hosted continuous monitoring is not included.','snapshot'],
  ['asset-tokenization-auditor','Asset Tokenization',0,'Evidence completeness and architecture planning; protected mint workflow stays in the existing wallet UI (2,500 XRBC).','planning'],
  ['asset-tokenization-auditor-advanced','Advanced Tokenization',2500,'Source-derived token intelligence, holder distribution and warning points, with evidence gaps.','intelligence'],
  ['xrpl-bridge-integrity-monitor','Bridge Integrity Monitor',10,'Evidence consistency checks; public status reports missing authenticated live feeds.','evidence'],
  ['xrbc-readiness','Readiness Evaluator',0,'Live ledger and XRBC market telemetry. Institutional adoption evidence remains a separate review.','telemetry'],
  ['xrbc-settlement','Settlement Desk',0,'Validated receipt lookup and exact invoice comparison.','receipts'],
  ['xrbc-ecosystem','XRBC Ecosystem',0,'Project identity, public market data and tool discovery.','catalog']
].map(([id,name,minimumXrbc,description,scope])=>({id,name,minimumXrbc:String(minimumXrbc),description,scope,url:`${SITE}/${id}.html`}));
class ApiError extends Error { constructor(status,code,message,details){super(message);Object.assign(this,{status,code,details});} }
const bad = message => {throw new ApiError(400,'invalid_request',message);};
const sha = value=>crypto.createHash('sha256').update(value).digest();
function address(value){
  if(typeof value!=='string'||!/^r[1-9A-HJ-NP-Za-km-z]{24,34}$/.test(value))bad('Use a valid XRPL classic address.');
  const alphabet='rpshnaf39wBUDNEGHJKLM4PQRST7VWXYZ2bcdeCg65jkm8oFqi1tuvAxyz';
  let n=0n;for(const c of value){const d=alphabet.indexOf(c);if(d<0)bad('Invalid address.');n=n*58n+BigInt(d);}
  let hex=n.toString(16);if(hex.length%2)hex='0'+hex;
  let bytes=Buffer.from(hex,'hex');for(const c of value){if(c!=='r')break;bytes=Buffer.concat([Buffer.from([0]),bytes]);}
  if(bytes.length!==25||bytes[0]!==0||!crypto.timingSafeEqual(sha(sha(bytes.subarray(0,21))).subarray(0,4),bytes.subarray(21)))bad('Address checksum is invalid.');
  return value;
}
function decimal(value,{positive=false}={}){
  if(typeof value!=='string'||value.length>100||!/^[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[-+]?\d+)?$/i.test(value))bad('Amounts must be decimal strings.');
  let [mantissa,exponent='0']=value.toLowerCase().split('e'), e=Number(exponent);
  if(!Number.isInteger(e)||Math.abs(e)>96)bad('Amount exponent exceeds the supported range.');
  let sign=1n;if(mantissa[0]==='-'){sign=-1n;mantissa=mantissa.slice(1);}else if(mantissa[0]==='+')mantissa=mantissa.slice(1);
  const parts=mantissa.split('.');let coefficient=BigInt(parts.join('')||'0')*sign, scale=(parts[1]||'').length-e;
  if(scale<0){coefficient*=10n**BigInt(-scale);scale=0;}
  while(scale>0&&coefficient%10n===0n){coefficient/=10n;scale--;}
  if(positive&&coefficient<=0n)bad('Amount must be greater than zero.');
  let digits=(coefficient<0n?-coefficient:coefficient).toString().padStart(scale+1,'0');
  return {n:coefficient,s:scale,text:(coefficient<0n?'-':'')+(scale?digits.slice(0,-scale)+'.'+digits.slice(-scale):digits)};
}
function compare(a,b){a=decimal(a);b=decimal(b);const s=Math.max(a.s,b.s),x=a.n*10n**BigInt(s-a.s),y=b.n*10n**BigInt(s-b.s);return x<y?-1:x>y?1:0;}
function sumDecimals(values){let n=0n,s=0;for(const v of values){const d=decimal(v),next=Math.max(s,d.s);n=n*10n**BigInt(next-s)+d.n*10n**BigInt(next-d.s);s=next;}return decimal(n.toString()+'e-'+s).text;}
function asset(value=XRBC){
  if(!value||typeof value!=='object'||Array.isArray(value))bad('Asset must contain currency and issuer (except XRP).');
  const c=value.currency;if(c==='XRP'){if(value.issuer)bad('XRP has no issuer.');return XRP;}
  if(typeof c!=='string'||!(/^[a-zA-Z0-9?!@#$%^&*<>(){}[\]|]{3}$/.test(c)||/^[a-fA-F0-9]{40}$/.test(c)))bad('Currency must be a 3-character code or 40-character hex code.');
  if(/^0{40}$/.test(c)||/^0000000000000000000000005852500000000000$/i.test(c))bad('Invalid issued currency.');
  return {currency:c.length===40?c.toUpperCase():c,issuer:address(value.issuer)};
}
const same=(a,b)=>a.currency===b.currency&&a.issuer===b.issuer;
const key=a=>a.currency+(a.issuer?'.'+a.issuer:'');
function queryAsset(q){if(!q.has('currency')&&!q.has('issuer'))return XRBC;return asset({currency:q.get('currency'),issuer:q.get('issuer')||undefined});}
function amount(raw,a){
  if(a.currency==='XRP'){if(typeof raw!=='string'||!/^\d+$/.test(raw))throw new ApiError(502,'invalid_upstream','Malformed XRP amount.');return decimal(raw+'e-6').text;}
  if(!raw||typeof raw!=='object'||!same(asset(raw),a))throw new ApiError(502,'identity_mismatch','Upstream asset identity did not match.');
  return decimal(raw.value).text;
}
const approximate=s=>{const n=Number(s);if(!Number.isFinite(n)||Math.abs(n)>1e90)throw new ApiError(502,'invalid_upstream','Amount exceeds the analytics range.');return n;};
const estimate=n=>Number.isFinite(n)?String(Number(n.toPrecision(15))):null;
function poolData(r,a,b=XRP){
  if(!r.amm)return {exists:false};
  const x=r.amm, values=[x.amount,x.amount2];
  const get=t=>{const v=values.find(v=>t.currency==='XRP'?typeof v==='string':v&&typeof v==='object'&&v.currency===t.currency&&v.issuer===t.issuer);if(v===undefined)throw new ApiError(502,'identity_mismatch','AMM assets do not match.');return amount(v,t);};
  const reserves=[get(a),get(b)];
  if(!Number.isInteger(x.trading_fee)||x.trading_fee<0||x.trading_fee>1000)throw new ApiError(502,'invalid_upstream','AMM fee is unavailable.');
  return {exists:true,account:address(x.account),assets:[a,b],reserves,feeUnits:x.trading_fee,feePercent:x.trading_fee/1000,frozen:!!(x.asset_frozen||x.asset2_frozen),lpToken:x.lp_token||null,auctionSlot:x.auction_slot||null,voteSlots:x.vote_slots||[]};
}
function fundedBook(raw,input,output,exclude){
  if(!Array.isArray(raw.offers))throw new ApiError(502,'invalid_upstream','Book offers are unavailable.');
  const budgets=new Map(), rows=[];let invalid=0;
  for(const o of raw.offers){
    if(o.Account===exclude)continue;
    try{
      const gets=approximate(amount(o.TakerGets,output)),pays=approximate(amount(o.TakerPays,input));
      if(!(gets>0&&pays>0))continue;
      if(!budgets.has(o.Account)&&o.owner_funds!==undefined)budgets.set(o.Account,approximate(output.currency==='XRP'?amount(o.owner_funds,XRP):decimal(o.owner_funds).text));
      let fraction=1;
      if(o.taker_gets_funded!==undefined)fraction=Math.min(fraction,approximate(amount(o.taker_gets_funded,output))/gets);
      if(o.taker_pays_funded!==undefined)fraction=Math.min(fraction,approximate(amount(o.taker_pays_funded,input))/pays);
      if(budgets.has(o.Account))fraction=Math.min(fraction,budgets.get(o.Account)/gets);
      fraction=Math.max(0,fraction);
      if(budgets.has(o.Account))budgets.set(o.Account,Math.max(0,budgets.get(o.Account)-gets*fraction));
      if(fraction>0)rows.push({maker:o.Account,input:estimate(pays*fraction),output:estimate(gets*fraction),rate:estimate(gets/pays)});
    }catch{invalid++;}
  }
  rows.sort((a,b)=>Number(b.rate)-Number(a.rate));
  return {inputAsset:input,outputAsset:output,offersRead:raw.offers.length,fundedOffers:rows.length,atLimit:raw.offers.length>=100,invalidOffers:invalid,rows,amounts:'Approximate funded depth; no taker-specific transfer fees, own offers excluded only for authenticated reports.'};
}
function simulateBook(book,input){
  let remaining=input,output=0,used=0;const makers=new Map();
  for(const row of book.rows){if(remaining<=0)break;const paid=Math.min(remaining,Number(row.input));output+=paid*Number(row.rate);remaining-=paid;used+=paid;makers.set(row.maker,(makers.get(row.maker)||0)+paid);}
  return {venue:'order_book',inputUsed:estimate(used),output:estimate(output),fillRatio:used/input,partial:remaining>input*1e-12,offersAvailable:book.fundedOffers,topMakerShare:used?Math.max(...makers.values())/used:null};
}
function ammQuote(pool,input,from,to){
  if(!pool?.exists||pool.frozen)return null;
  const i=pool.assets.findIndex(a=>same(a,from)),j=pool.assets.findIndex(a=>same(a,to));if(i<0||j<0||i===j)return null;
  const rin=Number(pool.reserves[i]),rout=Number(pool.reserves[j]);if(!(rin>0&&rout>0))return null;
  const effective=input*(1-pool.feeUnits/100000),out=rout*effective/(rin+effective);
  return {venue:'amm',inputUsed:estimate(input),output:estimate(out),fillRatio:1,partial:false,impactPercent:100*(1-out/input/(rout/rin)),feePercent:pool.feePercent};
}
function sentinel(m,ledgerAge){
  if(!m.pool.exists)return {score:null,maximum:7,status:'No direct XRP AMM'};
  const xrp=Number(m.pool.reserves[1]),token=Number(m.pool.reserves[0]);
  if(!(xrp>0&&token>0)||m.pool.frozen)return {score:null,maximum:7,status:'Pool unavailable or frozen'};
  const impact10=ammQuote(m.pool,10,XRP,m.asset)?.impactPercent,impact100=ammQuote(m.pool,100,XRP,m.asset)?.impactPercent;
  if(!Number.isFinite(impact10)||!Number.isFinite(impact100))return {score:null,status:'Impact unavailable'};
  let score=xrp>=500?2:xrp>=100?1:0;score+=m.pool.feePercent<=.3?1:m.pool.feePercent>.5?-1:0;score+=impact10<=1?2:impact10<=3?1:0;score+=impact100<=10?1:0;score+=ledgerAge<=20?1:0;score=Math.max(0,Math.min(7,score));
  return {score,maximum:7,status:score>=6?'Healthy':score<=2?'Risk':'Caution',impact10XrpPercent:impact10,impact100XrpPercent:impact100,methodology:'Liquidity Sentinel 0–7 heuristic; not a safety certification.'};
}
function watchtower(m,issuer,line){
  const thresholds={minAmmXrp:250,maxSlippage:10,maxSpread:10,minDepth:25,minOffers:10,maxTransferFee:5};
  let score=m.pool.exists?100:0;const warnings=[];const flag=(code,points,detail)=>{warnings.push({code,points,detail});score-=points;};
  const xrp=m.pool.exists?Number(m.pool.reserves[1]):0, impact=ammQuote(m.pool,250,XRP,m.asset)?.impactPercent;
  const bids=m.sell.rows,asks=m.buy.rows,bestBid=Number(bids[0]?.rate),bestAsk=1/Number(asks[0]?.rate),spread=bestBid>0&&bestAsk>0?Math.abs(bestAsk-bestBid)/((bestAsk+bestBid)/2)*100:null;
  const allDepth=bids.reduce((s,r)=>s+Number(r.output),0)+asks.reduce((s,r)=>s+Number(r.input),0);
  const depth=bids.filter(r=>Number(r.rate)>=bestBid*.98).reduce((s,r)=>s+Number(r.output),0)+asks.filter(r=>1/Number(r.rate)<=bestAsk*1.02).reduce((s,r)=>s+Number(r.input),0);
  const makers=new Map();for(const [rows,field] of [[bids,'output'],[asks,'input']])for(const r of rows)makers.set(r.maker,(makers.get(r.maker)||0)+Number(r[field]));
  if(!m.pool.exists)warnings.push({code:'no_pool',points:0,detail:'No direct XRP AMM.'});
  if(xrp<thresholds.minAmmXrp)flag('low_reserve',20,'XRP reserve below 250.');
  if(impact>thresholds.maxSlippage)flag('impact',15,'250 XRP estimate exceeds 10% impact.');
  if(!bids.length&&!asks.length)flag('no_book',15,'No funded direct orders returned.');
  else {if(spread>thresholds.maxSpread)flag('spread',15,'Spread exceeds 10%.');if(depth<thresholds.minDepth)flag('depth',10,'Sampled depth within 2% of best prices is below 25 XRP.');if(bids.length+asks.length<thresholds.minOffers)flag('few_offers',10,'Fewer than ten funded offers.');if(allDepth&&Math.max(...makers.values())/allDepth>.5)flag('maker_concentration',10,'One maker supplies over half the sampled depth.');}
  if(issuer.globalFreeze)flag('global_freeze',30,'Issuer global freeze is enabled.');if(issuer.clawback)flag('clawback',15,'Issuer clawback is enabled.');if(issuer.requireAuth)flag('require_auth',5,'Issuer authorization is required.');if(issuer.transferFeePercent>5)flag('transfer_fee',10,'Issuer transfer fee exceeds 5%.');
  if(line){if(line.deep_freeze||line.deep_freeze_peer)flag('deep_freeze',35,'Trustline deep freeze.');else if(line.freeze||line.freeze_peer)flag('freeze',25,'Trustline freeze.');if(line.no_ripple===false)flag('rippling',5,'Holder rippling is enabled.');if(issuer.requireAuth&&line.peer_authorized!==true)flag('unauthorized',15,'Required issuer authorization is absent.');if(line.quality_in||line.quality_out)flag('quality',5,'Trustline quality adjustment.');}
  const gaps=[];if(!line)gaps.push('The wallet has no selected-asset trustline; holder-specific scoring is incomplete.');if(m.pool.frozen)gaps.push('The pool reports a frozen asset.');if(m.sell.invalidOffers||m.buy.invalidOffers)gaps.push('Some book entries could not be interpreted.');if(spread===null)gaps.push('A two-sided spread is unavailable.');
  return {score:gaps.length?null:Math.max(0,score),observedScore:Math.max(0,score),maximum:100,thresholds,warnings,gaps,monitoring:'One snapshot; no stored history or background alerts.',methodology:'Watchtower balanced thresholds; score withheld when required evidence is incomplete.'};
}
function planning(body){
  const p=body.project;if(!p||typeof p!=='object')bad('Provide project.asset, representedRight, parties and evidence.');
  const a=p.asset||{},r=p.representedRight||{},parties=p.parties||{},e=p.evidence||{};
  const resolved=x=>typeof x==='string'&&x.trim().length>0&&!/^(unknown|tbd|n\/a|none|not sure|to be determined)$/i.test(x.trim())&&!/^(?:No (?:separate|independent|expiration)|Not (?:provided|supplied|identified|applicable)|Applicable\b|Defined in supporting records)/i.test(x.trim());
  const checks={assetName:resolved(a.name),externalId:resolved(a.externalId),holderReceives:resolved(r.holderReceives),holderDoesNotReceive:resolved(r.holderDoesNotReceive),owner:resolved(parties.owner),issuer:resolved(parties.issuer),registry:resolved(parties.registry),fileHashes:Array.isArray(e.files)&&e.files.some(f=>typeof f?.sha256==='string'&&/^[a-f0-9]{64}$/i.test(f.sha256)),registryReference:resolved(e.registryReference)||resolved(e.verificationUrl),attestation:resolved(e.attestationReference)||resolved(parties.attestor)};
  const score=Object.values(checks).filter(Boolean).length*10;
  const proposals={proof:'document_anchor',collectible:'nft',receipt:'nft',fractional:'mpt',debt:'mpt',revenue:'mpt',redemption:'mpt',payment:'trustline',certificate:'credential',access:'credential',license:'credential'};
  return {evidenceCompletenessPercent:score,checks,architecture:score>=50?proposals[r.type]||'needs_review':'not_ready',inputSource:'Caller-supplied information; no URLs or private evidence files are fetched or stored.',limitations:['Completeness does not verify legal rights, backing, attestor identity or document contents.','Planning only; token issuance and wallet signing remain in the existing tool.'],methodology:'API planning v1: ten-field submitted-evidence completeness, SHA-256 format validation and a readiness floor; not full browser taxonomy parity.'};
}
function receiptResult(r,hash){
  const t=r.tx_json||r,meta=r.meta;
  if(String(r.hash||t.hash||'').toUpperCase()!==hash.toUpperCase())throw new ApiError(502,'transaction_mismatch','Returned transaction hash did not match the requested receipt.');
  if(r.validated!==true)throw new ApiError(409,'not_validated','Transaction has not been validated.');
  if(!meta||typeof meta!=='object')throw new ApiError(502,'missing_metadata','Transaction metadata is unavailable.');
  let delivered=null;
  if(t.TransactionType==='Payment'&&meta.TransactionResult==='tesSUCCESS'){
    let d=meta.delivered_amount??meta.DeliveredAmount;
    if(d===undefined&&!(Number(t.Flags||0)&0x00020000))d=t.Amount??t.DeliverMax;
    if(d!==undefined&&d!=='unavailable'){const a=typeof d==='string'?XRP:asset(d);delivered={asset:a,value:amount(d,a)};}
  }
  return {hash,validated:true,successful:meta.TransactionResult==='tesSUCCESS',result:meta.TransactionResult,type:t.TransactionType,account:t.Account||null,destination:t.Destination||null,destinationTag:t.DestinationTag??null,invoiceId:t.InvoiceID||null,delivered,ledgerIndex:r.ledger_index??t.ledger_index??null,date:t.date===undefined?null:new Date((t.date+946684800)*1000).toISOString(),explorer:`https://livenet.xrpl.org/transactions/${hash}`};
}
function compareInvoice(receipt,invoice){
  if(!invoice||typeof invoice!=='object')bad('Provide an invoice object.');
  const expected={destination:address(invoice.destination),asset:asset(invoice.asset),amount:decimal(invoice.amount,{positive:true}).text};
  if(invoice.destinationTag!==undefined&&(!Number.isInteger(invoice.destinationTag)||invoice.destinationTag<0||invoice.destinationTag>4294967295))bad('destinationTag must be uint32.');
  if(invoice.invoiceId!==undefined&&!/^[a-f0-9]{64}$/i.test(invoice.invoiceId))bad('invoiceId must be 64 hex characters.');
  const checks={payment:receipt.type==='Payment',validated:receipt.validated,successful:receipt.successful,destination:receipt.destination===expected.destination,destinationTag:receipt.destinationTag===(invoice.destinationTag??null),invoiceId:receipt.invoiceId===(invoice.invoiceId?.toUpperCase()??null),asset:!!receipt.delivered&&same(receipt.delivered.asset,expected.asset),amount:!!receipt.delivered&&compare(receipt.delivered.value,expected.amount)===0};
  return {matches:Object.values(checks).every(Boolean),checks,receipt,limitations:'A matching receipt can be reused. Integrators must uniquely record accepted transaction hashes and invoice IDs to prevent duplicate credit.'};
}
function createApi(options={}){
  const fetcher=options.fetch||globalThis.fetch, now=options.now||Date.now, env=options.env||process.env;
  const rpcUrl=options.rpcUrl||'https://s1.ripple.com:51234';
  const cache=new Map(),inflight=new Map(),rates=new Map(),challenges=new Map(),sessions=new Map(),ledgerIndexes=new Map();
  let activeRpc=0,activeJobs=0;
  const configured=()=>!!(env.XAMAN_API_KEY&&env.XAMAN_API_SECRET);
  const cleanup=map=>{for(const [k,v] of map)if(v.expires<=now())map.delete(k);};
  function rate(id,max,window=60000){cleanup(rates);let r=rates.get(id);if(!r){if(rates.size>=5000)throw new ApiError(503,'busy','Service capacity reached.');r={count:0,expires:now()+window};rates.set(id,r);}if(++r.count>max)throw new ApiError(429,'rate_limit','Request limit reached. Retry after the indicated delay.',{retryAfter:Math.ceil((r.expires-now())/1000)});}
  async function jsonFetch(url,init){
    let r;try{r=await fetcher(url,{...init,signal:AbortSignal.timeout(10000),redirect:'error'});}catch{throw new ApiError(503,'upstream_unavailable','Upstream service is temporarily unavailable.');}
    if(!r.ok)throw new ApiError(503,'upstream_unavailable','Upstream service is temporarily unavailable.');
    try{return await r.json();}catch{throw new ApiError(502,'invalid_upstream','Upstream returned an invalid response.');}
  }
  async function rpc(method,params={}){
    if(activeRpc>=16)throw new ApiError(503,'busy','Ledger request capacity reached.');activeRpc++;
    try{const raw=await jsonFetch(rpcUrl,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({method,params:[{api_version:2,...params}]})});const r=raw.result;
      if(!r||r.error)throw new ApiError(r?.error==='txnNotFound'?404:503,r?.error==='txnNotFound'?'transaction_not_found':'ledger_unavailable',r?.error==='txnNotFound'?'Transaction is absent from this server’s available history.':'Ledger data is temporarily unavailable.',{upstreamCode:r?.error||'invalid_response'});
      // s1 currently omits validated on book_offers and gateway_balances. Exact hash/index
      // still bind those responses to our independently validated checkpoint. Gates require true.
      const validationKnown=r.validated===true||(r.validated===undefined&&['book_offers','gateway_balances'].includes(method));
      if(params.ledger_hash&&(!validationKnown||r.ledger_hash!==params.ledger_hash||Number(r.ledger_index)!==ledgerIndexes.get(params.ledger_hash)))throw new ApiError(502,'ledger_mismatch','Upstream response did not match the pinned validated ledger.');
      if(params.account&&['account_lines','gateway_balances','account_tx'].includes(method)&&r.account!==params.account)throw new ApiError(502,'account_mismatch','Upstream account identity did not match.');
      if(method==='account_info'&&r.account_data?.Account!==params.account)throw new ApiError(502,'account_mismatch','Upstream account identity did not match.');
      return r;
    }finally{activeRpc--;}
  }
  async function memo(k,ttl,fn){cleanup(cache);const hit=cache.get(k);if(hit)return hit.value;if(inflight.has(k))return inflight.get(k);if(inflight.size>=100)throw new ApiError(503,'busy','Cache fill capacity reached.');const pending=fn().then(value=>{if(cache.size>=300)cache.delete(cache.keys().next().value);cache.set(k,{value,expires:now()+ttl});return value;}).finally(()=>inflight.delete(k));inflight.set(k,pending);return pending;}
  async function ledger(fresh=false){const fetchLedger=async()=>{const r=await rpc('ledger',{ledger_index:'validated',transactions:false,expand:false});const l=r.ledger,hash=r.ledger_hash||l?.ledger_hash,index=Number(r.ledger_index||l?.ledger_index),close=Number(l?.close_time);if(r.validated!==true||!/^[a-f0-9]{64}$/i.test(hash||'')||!Number.isInteger(index)||!Number.isFinite(close))throw new ApiError(503,'unvalidated_ledger','A validated ledger snapshot is unavailable.');const closedAt=(close+946684800)*1000,age=(now()-closedAt)/1000;if(age>60||age< -10)throw new ApiError(503,'stale_ledger','The validated ledger is not recent enough.');if(ledgerIndexes.size>=100)ledgerIndexes.delete(ledgerIndexes.keys().next().value);ledgerIndexes.set(hash,index);return {hash,index,closedAt:new Date(closedAt).toISOString()};};return fresh?fetchLedger():memo('ledger',3000,fetchLedger);}
  async function lines(account,peer,l,maxPages=5){const items=[],seen=new Set();let marker,pages=0;do{const r=await rpc('account_lines',{account,...(peer?{peer}:{}),ledger_hash:l.hash,limit:400,...(marker?{marker}:{})});if(!Array.isArray(r.lines))throw new ApiError(502,'invalid_upstream','Trustlines are unavailable.');for(const row of r.lines){if(peer&&row.account!==peer)throw new ApiError(502,'peer_mismatch','Upstream trustline issuer did not match.');const k=core.canonicalCurrency(row.currency)+'.'+row.account;if(seen.has(k))throw new ApiError(502,'duplicate_trustline','Trustline pagination returned a duplicate identity.');seen.add(k);items.push(row);}marker=r.marker;pages++;}while(marker&&pages<maxPages);return {items,pages,complete:!marker};}
  async function getPool(a,b,l){try{return await rpc('amm_info',{asset:a,asset2:b,ledger_hash:l.hash});}catch(e){if(['actNotFound','ammNotFound','objectNotFound'].includes(e.details?.upstreamCode))return {};throw e;}}
  async function market(a,l,wallet){if(a.currency==='XRP')bad('Select an issued asset for an XRP market.');return memo(`market:${key(a)}:${l.hash}:${wallet||''}`,10000,async()=>{const [rawPool,sell,buy]=await Promise.all([getPool(a,XRP,l),rpc('book_offers',{taker_gets:XRP,taker_pays:a,limit:100,ledger_hash:l.hash}),rpc('book_offers',{taker_gets:a,taker_pays:XRP,limit:100,ledger_hash:l.hash})]);return {asset:a,quoteAsset:XRP,pool:poolData(rawPool,a),sell:fundedBook(sell,a,XRP,wallet),buy:fundedBook(buy,XRP,a,wallet),_rawPool:rawPool,_rawSell:sell};});}
  async function xaman(path,body){if(!configured())throw new ApiError(503,'authentication_unconfigured','Wallet access is not configured on this deployment.');return jsonFetch('https://xumm.app/api/v1/platform/'+path,{method:body?'POST':'GET',headers:{'content-type':'application/json','x-api-key':env.XAMAN_API_KEY,'x-api-secret':env.XAMAN_API_SECRET},...(body?{body:JSON.stringify(body)}:{})});}
  async function authenticationHealth(){
    if(!configured())return {walletAuthentication:'unconfigured',walletAuthenticationVerified:false,walletAuthenticationCheckedAt:null};
    return memo('xaman:health',30000,async()=>{
      let verified=false;
      try{
        const ping=await xaman('ping');
        verified=ping.pong===true&&ping.auth?.application?.uuidv4===env.XAMAN_API_KEY&&
          (ping.auth.application.disabled===undefined||ping.auth.application.disabled===0);
      }catch{/* Never publish upstream authentication errors or credential material. */}
      return {walletAuthentication:'configured',walletAuthenticationVerified:verified,
        walletAuthenticationCheckedAt:new Date(now()).toISOString()};
    });
  }
  function bearer(req){const match=/^Bearer ([A-Za-z0-9_-]{43})$/.exec(String(req.headers.authorization||''));if(!match)throw new ApiError(401,'authentication_required','Provide Authorization: Bearer followed by your session token.');return match[1];}
  function session(req){const token=bearer(req);cleanup(sessions);const s=sessions.get(sha(token).toString('hex'));if(!s)throw new ApiError(401,'authentication_required','Provide a valid signed-wallet bearer session.');return s;}
  async function gate(req,tool){const s=session(req);if(!s.tools.includes(tool.id))throw new ApiError(403,'scope_denied','This session does not include the requested tool.');rate('session:'+s.id,12);if(s.busy)throw new ApiError(429,'session_busy','Only one protected request may run per session.');s.busy=true;
    try{const l=await ledger(true),p=await lines(s.account,XRBC.issuer,l,3);if(!p.complete)throw new ApiError(503,'gate_incomplete','The access balance could not be verified completely.');let total='0';const row=p.items.find(x=>String(x.currency).toUpperCase()===XRBC.currency);if(row)total=decimal(row.balance).text;if(compare(total,tool.minimumXrbc)<0)throw new ApiError(403,'insufficient_holdings',`This tool requires ${tool.minimumXrbc} XRBC.`,{required:tool.minimumXrbc,balance:total});return {s,l};}catch(e){s.busy=false;throw e;}
  }
  const envelope=(data,l)=>{if(l&&(now()-Date.parse(l.closedAt))/1000>60)throw new ApiError(503,'stale_ledger','The ledger aged beyond 60 seconds while collecting evidence.');return {data,meta:{apiVersion:VERSION,network:'XRPL Mainnet',source:l?rpcUrl:'XRBitcoinCash API',fetchedAt:new Date(now()).toISOString(),...(l?{ledger:{...l,ageSeconds:Math.max(0,Math.floor((now()-Date.parse(l.closedAt))/1000))}}:{}),amounts:'Exact ledger amounts are decimal strings. Estimates are explicitly labeled.',custody:'Read-only. No signing, submission or custody.'}};};
  const publicMarket=m=>{const {_rawPool,_rawSell,...out}=m;return {...out,spotPriceXrp:m.pool.exists&&Number(m.pool.reserves[0])>0?estimate(Number(m.pool.reserves[1])/Number(m.pool.reserves[0])):null,priceType:'AMM reserve ratio; not last traded price.',volume24h:null,circulatingSupply:null,marketCap:null,limitations:['Order books are bounded to 100 offers per direction.','24-hour volume requires a complete, durable trade history collector.']};};
  async function quoteCandidates(from,to,value,l,wallet){
    if(same(from,to))bad('Input and output assets must differ.');const parsed=decimal(value,{positive:true});if(from.currency==='XRP'&&parsed.s>6)bad('XRP input must use whole drops (at most six decimal places).');const input=approximate(parsed.text);if(input>1e15||input<1e-12)bad('Quote input must be between 1e-12 and 1e15 units.');
    async function leg(a,b,n){const [p,book]=await Promise.all([getPool(a,b,l),rpc('book_offers',{taker_gets:b,taker_pays:a,limit:100,ledger_hash:l.hash})]);const pool=poolData(p,a,b),model=fundedBook(book,a,b,wallet);return [ammQuote(pool,n,a,b),simulateBook(model,n)].filter(x=>x&&Number(x.output)>0).map(x=>({...x,from:a,to:b}));}
    const direct=await leg(from,to,input);const candidates=direct.map(x=>({route:'direct',legs:[x],output:x.output,partial:x.partial}));
    if(from.currency!=='XRP'&&to.currency!=='XRP'){const first=await leg(from,XRP,input);for(const f of first){for(const s of await leg(XRP,to,Number(f.output)))candidates.push({route:'via_XRP',legs:[f,s],output:s.output,partial:f.partial||s.partial});}}
    return {from,to,input:decimal(value,{positive:true}).text,candidates:candidates.sort((a,b)=>Number(b.output)-Number(a.output)),estimateOnly:true,transaction:null,expiresAt:new Date(now()+15000).toISOString(),limitations:['Venue models are alternatives, not additive liquidity.','No pathfinding, route optimization, issuer transfer fees, trustline eligibility or auction discounts are included.','Outputs and intermediary amounts are mathematical estimates and may include fractional drops; they are not transaction-ready.','A partial second leg can leave intermediary XRP unspent.','Use the wallet trading UI for an executable quote and explicit approval.'],tradeUrl:SITE+'/value-path.html'};
  }
  async function report(id,a,l,wallet){
    const [m,ir,holderPages]=await Promise.all([market(a,l,wallet),rpc('account_info',{account:a.issuer,ledger_hash:l.hash}),lines(wallet,a.issuer,l,3)]);
    if(!holderPages.complete)throw new ApiError(503,'incomplete_trustline','Holder trustline traversal is incomplete.');
    const issuer=core.issuerMetrics(ir),trustline=holderPages.items.find(x=>core.canonicalCurrency(x.currency)===a.currency)||null;
    const data={tool:id,asset:a,account:wallet,issuer,trustline,market:publicMarket(m),scope:'Single-asset evidence snapshot; not a wallet-wide scan.'};
    if(id==='watchtower')data.analysis=watchtower(m,issuer,trustline);
    if(id==='risk-lens')data.analysis={score:null,publishable:false,restrictions:{globalFreeze:issuer.globalFreeze,clawback:issuer.clawback,issuerFreeze:trustline?.freeze_peer??null,deepFreeze:trustline?.deep_freeze_peer??null,authorized:trustline?.peer_authorized??null},poolExposureRatio:trustline&&m.pool.exists&&Number(m.pool.reserves[0])>0?Number(trustline.balance)/Number(m.pool.reserves[0]):null,reason:'v1 exposes source evidence. The full Risk Lens weighted model, issuer-object traversal and affected-address model have not been ported.'};
    if(['sentinel-forensics','asset-tokenization-auditor-advanced'].includes(id)){
      const holders=await lines(a.issuer,null,l,5);data.holders=core.holdersMetrics(holders,a,m.pool.account);
      const observed=sumDecimals(holders.items.filter(x=>core.canonicalCurrency(x.currency)===a.currency&&compare(x.balance,'0')<0).map(x=>decimal(x.balance).text.slice(1)));
      data.holders.observedIssuedBalance=observed;data.holders.issuedBalance=data.holders.complete?observed:null;data.holders.numericEstimates='Concentration percentages are approximate. Outstanding balance sums are exact decimal strings.';
      if(m.pool.exists){const h=await rpc('account_tx',{account:m.pool.account,ledger_index_min:-1,ledger_index_max:l.index,limit:100,forward:false});data.poolHistory=core.historyMetrics(h,m.pool);}
      if(id==='sentinel-forensics'){const h=await rpc('account_tx',{account:a.issuer,ledger_index_min:-1,ledger_index_max:l.index,limit:100,forward:false});data.issuerControlHistory={sampleLimit:100,hasMore:!!h.marker,events:(h.transactions||[]).filter(e=>e.validated===true&&e.meta?.TransactionResult==='tesSUCCESS'&&['AccountSet','SetRegularKey','SignerListSet','DelegateSet','Clawback'].includes((e.tx_json||e.tx)?.TransactionType)).map(e=>{const t=e.tx_json||e.tx;return {type:t.TransactionType,hash:e.hash||t.hash,ledgerIndex:e.ledger_index||t.ledger_index};})};data.analysis={score:null,confidence:null,reason:'Evidence API only. Full behavior classification, durable continuity and browser forensic composite are not published by v1.'};}
      else {const pool=m.pool.exists?core.poolMetrics(m._rawPool,a):{exists:false},book=core.bookMetrics(m._rawSell,a,wallet),sources=['issuer','holders','pool','book'].map(id=>({id,label:id,status:'available'}));sources.push({id:'external',label:'External market context',status:'unavailable',error:'Third-party redistribution is not configured.'});data.analysis=core.evaluate({issuer,trustline,holders:data.holders,pool,book,history:data.poolHistory,sources});data.methodology='Advanced intelligence core 3.0.0; missing trustline does not assert missing issuer authorization.';}
    }
    if(id==='extended-audit'){
      const h=m.pool.exists?await rpc('account_tx',{account:m.pool.account,ledger_index_min:-1,ledger_index_max:l.index,limit:100,forward:false}):null;
      const txs=(h?.transactions||[]).filter(e=>e.validated===true&&e.meta?.TransactionResult==='tesSUCCESS'),actors=new Set(txs.map(e=>(e.tx_json||e.tx)?.Account).filter(Boolean));
      data.participation={successfulTransactionsObserved:txs.length,initiatingAccountsObserved:actors.size,sampleLimit:100,hasMore:h?!!h.marker:null,meaning:'Initiating account counts in bounded pool history, not unique people or full trading volume.'};data.analysis={score:null,reason:'v1 exposes bounded evidence; the full Extended Auditor participation/burst composite is not published.'};
    }
    return data;
  }
  async function route(req,path,q,body){
    if(req.method==='GET'&&path==='/')return envelope({name:'XRBitcoinCash Developer API',version:VERSION,docs:SITE+'/developers.html',openapi:BASE+'/openapi.json',tools:BASE+'/tools',mode:'read_only'});
    if(req.method==='GET'&&path==='/openapi.json')return require('./openapi.json');
    if(req.method==='GET'&&path==='/status'){const [l,auth]=await Promise.all([ledger(),authenticationHealth()]);return envelope({status:'operational',...auth,bridgeLiveFeed:'unconfigured',continuousMonitoring:false},l);}
    if(req.method==='GET'&&path==='/tools')return envelope(TOOLS.map(t=>({...t,access:Number(t.minimumXrbc)>0?'signed_wallet_and_holdings':'public'})));
    if(req.method==='GET'&&path==='/project')return envelope({name:'XRBitcoinCash',symbol:'XRBC',asset:XRBC,website:SITE,explorer:`https://bithomp.com/explorer/${XRBC.issuer}`,listingStatus:'No listing or endorsement is asserted by this API.',maxSupply:null,circulatingSupply:null});
    if(req.method==='GET'&&path==='/ledger'){const l=await ledger();return envelope(l,l);}
    if(req.method==='GET'&&path==='/market/xrbc'){const l=await ledger();return envelope(publicMarket(await market(XRBC,l)),l);}
    if(req.method==='GET'&&path==='/market/xrbc/quote'){const side=q.get('side')||'buy';if(!['buy','sell'].includes(side))bad('side must be buy or sell.');const l=await ledger();return envelope(await quoteCandidates(side==='buy'?XRP:XRBC,side==='buy'?XRBC:XRP,q.get('amount')||'25',l),l);}
    if(req.method==='GET'&&path==='/supply/xrbc'){const l=await ledger();const r=await rpc('gateway_balances',{account:XRBC.issuer,ledger_hash:l.hash,strict:true});const amount=r.obligations?.[XRBC.currency];return envelope({asset:XRBC,outstandingObligations:amount===undefined?'0':decimal(amount).text,hotwalletExclusions:[],circulatingSupply:null,maxSupply:null,meaning:'Issuer obligations returned by gateway_balances with no hot-wallet exclusions; not verified circulating or maximum supply.'},l);}
    if(req.method==='GET'&&path==='/liquidity'){const a=queryAsset(q);if(a.currency==='XRP')bad('Select an issued asset for an XRP pool.');const l=await ledger(),pool=poolData(await getPool(a,XRP,l),a);return envelope({asset:a,pool,analysis:sentinel({asset:a,pool},(now()-Date.parse(l.closedAt))/1000)},l);}
    if(req.method==='GET'&&path==='/readiness'){const l=await ledger(),m=await market(XRBC,l);return envelope({ledgerFresh:true,market:publicMarket(m),networkAndMarketTelemetryOnly:true,integrationEvidenceIndex:null,institutionalAdoption:null,reviewUrl:SITE+'/xrbc-readiness.html'},l);}
    if(req.method==='GET'&&path==='/bridges/status')return envelope({operationalState:'unverified',favorableRankingAllowed:false,liveScore:null,reasons:['No pinned publisher keys or authenticated live proxy are configured.','Durable replay history and current evidence coverage are not established.'],toolUrl:SITE+'/xrpl-bridge-integrity-monitor.html'});
    if(req.method==='POST'&&path==='/tokenization/plan')return envelope(planning(body));
    if(req.method==='GET'&&path==='/settlement/destination'){
      const account=address(q.get('account')),a=queryAsset(q),l=await ledger(),info=await rpc('account_info',{account,ledger_hash:l.hash});
      const f=Number(info.account_data?.Flags);if(!Number.isInteger(f))throw new ApiError(502,'invalid_upstream','Destination flags are unavailable.');
      let trustline=null;if(a.currency!=='XRP'){const p=await lines(account,a.issuer,l,3);if(!p.complete)throw new ApiError(503,'incomplete_trustline','Destination trustline lookup is incomplete.');trustline=p.items.find(x=>core.canonicalCurrency(x.currency)===a.currency)||null;}
      return envelope({account,asset:a,requiresDestinationTag:!!(f&0x00020000),depositAuth:!!(f&0x01000000),trustline,paymentEligibility:null,meaning:'Destination evidence only. Issuer policy, available limit, deposit preauthorization, permissions and execution must be checked by the signing application.'},l);
    }
    if(req.method==='GET'&&/^\/transactions\/[a-f0-9]{64}$/i.test(path)){const hash=path.split('/')[2].toUpperCase();return envelope(receiptResult(await rpc('tx',{transaction:hash,binary:false}),hash));}
    if(req.method==='POST'&&path==='/settlement/verify'){const hash=String(body.hash||'').toUpperCase();if(!/^[A-F0-9]{64}$/.test(hash))bad('Provide a 64-character transaction hash.');compareInvoice({delivered:null},body.invoice);return envelope(compareInvoice(receiptResult(await rpc('tx',{transaction:hash,binary:false}),hash),body.invoice));}
    if(req.method==='POST'&&path==='/auth/challenges'){
      rate('signin:'+req.xrbcClientIp,5,900000);cleanup(challenges);if(challenges.size>=200)throw new ApiError(503,'busy','Sign-in capacity reached.');const account=address(body.account);
      if(!Array.isArray(body.tools)||!body.tools.length||body.tools.length>8||body.tools.some(id=>!TOOLS.find(t=>t.id===id&&Number(t.minimumXrbc)>0)))bad('Request one or more protected tool IDs.');
      const id=crypto.randomUUID(),secret=crypto.randomBytes(32).toString('base64url'),expires=now()+300000;
      const created=await xaman('payload',{txjson:{TransactionType:'SignIn'},options:{submit:false,expire:5,force_network:'MAINNET',signers:[account]},custom_meta:{identifier:id,instruction:'Sign in to XRBitcoinCash Developer API. Read-only tool access.'}});
      if(!/^[a-f0-9-]{36}$/i.test(created.uuid||'')||typeof created.next?.always!=='string'||!created.next.always.startsWith('https://xumm.app/'))throw new ApiError(502,'invalid_signin','Signing service did not return a valid challenge.');
      challenges.set(id,{id,account,tools:[...new Set(body.tools)],secret:sha(secret),uuid:created.uuid,expires,busy:false});
      return envelope({challengeId:id,challengeSecret:secret,signInUrl:created.next.always,expiresAt:new Date(expires).toISOString(),next:'Open signInUrl, then POST challengeId and challengeSecret to /auth/sessions after approval. Keep the secret private.'});
    }
    if(req.method==='POST'&&path==='/auth/sessions'){
      rate('verify:'+req.xrbcClientIp,15,300000);cleanup(challenges);const c=challenges.get(body.challengeId),hash=sha(typeof body.challengeSecret==='string'?body.challengeSecret:'');
      if(!c||!crypto.timingSafeEqual(hash,c.secret))throw new ApiError(401,'invalid_challenge','Challenge or private secret is invalid or expired.');if(c.busy)throw new ApiError(409,'verification_pending','Signature verification is already running.');c.busy=true;
      try{const p=await xaman('payload/'+c.uuid);if(!p.meta?.resolved)throw new ApiError(409,'signature_pending','Wallet approval is still pending.');
        const valid=p.meta.uuid===c.uuid&&p.meta.exists===true&&p.meta.signed===true&&!p.meta.cancelled&&!p.meta.expired&&p.meta.force_network==='MAINNET'&&p.application?.uuidv4===env.XAMAN_API_KEY&&p.application.disabled===0&&p.payload?.tx_type==='SignIn'&&p.payload.request_json?.TransactionType==='SignIn'&&p.response?.account===c.account&&p.custom_meta?.identifier===c.id&&c.expires>now();
        const node=p.response?.environment_nodetype,network=p.response?.environment_networkid;
        if(!valid||(node!=null&&String(node).toUpperCase()!=='MAINNET')||(network!=null&&Number(network)!==0)){challenges.delete(c.id);throw new ApiError(401,'signature_rejected','The signature did not match this mainnet sign-in challenge.');}
        challenges.delete(c.id);cleanup(sessions);if(sessions.size>=1000)throw new ApiError(503,'busy','Session capacity reached.');const token=crypto.randomBytes(32).toString('base64url'),expires=now()+300000;sessions.set(sha(token).toString('hex'),{id:crypto.randomUUID(),account:c.account,tools:c.tools,expires,busy:false});return envelope({accessToken:token,tokenType:'Bearer',expiresIn:300,account:c.account,tools:c.tools});
      }finally{c.busy=false;}
    }
    if(req.method==='DELETE'&&path==='/auth/session'){session(req);sessions.delete(sha(bearer(req)).toString('hex'));return envelope({revoked:true});}
    if(req.method==='POST'&&path==='/trade/quote'){
      const from=asset(body.from),to=asset(body.to),value=decimal(body.amount,{positive:true}).text;const {s,l}=await gate(req,TOOLS.find(t=>t.id==='value-path'));try{return envelope(await quoteCandidates(from,to,value,l,s.account),l);}finally{s.busy=false;}
    }
    if(req.method==='POST'&&path==='/bridges/evidence-check'){
      const {s,l}=await gate(req,TOOLS.find(t=>t.id==='xrpl-bridge-integrity-monitor'));try{
        const a=asset(body.asset),reserve=decimal(body.reserve).text,liability=decimal(body.liability,{positive:true}).text;if(compare(reserve,'0')<0)bad('reserve must be nonnegative.');
        const observed=Date.parse(body.observedAt),fresh=Number.isFinite(observed)&&now()-observed>=0&&now()-observed<=3600000;
        return envelope({asset:a,reserve,liability,reserveCoversLiability:compare(reserve,liability)>=0,observationWithinOneHour:fresh,inputSource:'caller_supplied',independentlyVerified:false,liveScore:null,favorableRankingAllowed:false,missingVerification:['Authenticated publisher and exact bridge/route binding','Independent finalized reserve and liability checkpoints','Durable replay protection and incident history'],meaning:'Arithmetic and freshness checks on submitted claims; not a solvency or bridge safety certification.'},l);
      }finally{s.busy=false;}
    }
    if(req.method==='GET'&&/^\/tools\/[^/]+\/report$/.test(path)){
      const id=path.split('/')[2],tool=TOOLS.find(t=>t.id===id&&['snapshot','evidence','intelligence'].includes(t.scope)&&Number(t.minimumXrbc)>0&&t.id!=='xrpl-bridge-integrity-monitor');if(!tool)throw new ApiError(404,'not_found','Use the tool catalog to select an available report.');
      const a=queryAsset(q);if(a.currency==='XRP')bad('A report requires an issued asset.');const {s,l}=await gate(req,tool);try{return envelope(await report(id,a,l,s.account),l);}finally{s.busy=false;}
    }
    throw new ApiError(404,'not_found','Endpoint not found. See /api/v1/tools and /api/v1/openapi.json.');
  }
  async function handler(req,res,next){
    const requestId=crypto.randomUUID();res.setHeader('X-Request-Id',requestId);res.setHeader('Cache-Control','no-store');res.setHeader('Access-Control-Allow-Origin','*');res.setHeader('Access-Control-Allow-Headers','Content-Type, Authorization');res.setHeader('Access-Control-Allow-Methods','GET, POST, DELETE, OPTIONS');res.setHeader('Access-Control-Expose-Headers','Retry-After, X-Request-Id');res.setHeader('X-Content-Type-Options','nosniff');
    if(req.method==='OPTIONS'){res.statusCode=204;return res.end();}
    let acquired=false;
    try{
      req.xrbcClientIp=req.ip||req.socket?.remoteAddress||'unknown';rate('ip:'+req.xrbcClientIp,60);if(activeJobs>=8)throw new ApiError(503,'busy','API request capacity reached.');activeJobs++;acquired=true;
      if(String(req.url).length>2048)bad('URL is too long.');let body=req.body||{};if(Buffer.byteLength(JSON.stringify(body))>32768)throw new ApiError(413,'body_too_large','Maximum request body is 32 KiB.');if(!body||typeof body!=='object'||Array.isArray(body))bad('Use a JSON object.');
      const url=new URL(req.url,'http://api.local');const out=await route(req,url.pathname.replace(/\/$/,'')||'/',url.searchParams,body);
      res.statusCode=200;res.setHeader('Content-Type','application/json; charset=utf-8');res.end(JSON.stringify(out));
    }catch(error){const e=error instanceof ApiError?error:new ApiError(500,'internal_error','Request could not be completed.');res.statusCode=e.status;res.setHeader('Content-Type','application/json; charset=utf-8');if(e.status===429||e.status===503)res.setHeader('Retry-After',String(e.details?.retryAfter||15));res.end(JSON.stringify({error:{code:e.code,message:e.message,...(e.details?{details:e.details}:{})},meta:{apiVersion:VERSION,requestId}}));}
    finally{if(acquired)activeJobs--;}
  }
  return handler;
}
module.exports={createApi,ApiError,XRBC,XRP,TOOLS,VERSION,BASE,address,decimal,compare,sumDecimals,asset,poolData,fundedBook,simulateBook,ammQuote,sentinel,watchtower,planning,receiptResult,compareInvoice};
