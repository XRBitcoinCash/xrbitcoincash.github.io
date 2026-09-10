// Derived from asset-tokenization-auditor-advanced.html core v3.0.0.
// Missing trustline evidence does not establish failed authorization.
function createXRBCIntelligenceCore(){
  'use strict';
  const VERSION='3.0.0';
  const finite=v=>(typeof v==='number'||typeof v==='string'&&/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(v))&&Number.isFinite(Number(v))?Number(v):null;
  const positive=v=>{const n=finite(v);return n!==null&&n>=0?n:null};
  const canonicalCurrency=v=>/^[A-Fa-f0-9]{40}$/.test(String(v))?String(v).toUpperCase():String(v||'');
  const identity=(currency,issuer)=>canonicalCurrency(currency)+'.'+String(issuer||'');
  const validAsset=a=>!!(a&&/^r[1-9A-HJ-NP-Za-km-z]{24,34}$/.test(a.issuer)&&(/^[0-9A-F]{40}$/.test(canonicalCurrency(a.currency))||/^[\x21-\x7e]{3}$/.test(a.currency))&&a.currency!=='XRP'&&!/^0{40}$/.test(a.currency));
  function amount(v,asset){
    if(asset==='XRP')return typeof v==='string'?positive(v)===null?null:Number(v)/1e6:null;
    return v&&typeof v==='object'&&identity(v.currency,v.issuer)===identity(asset.currency,asset.issuer)?positive(v.value):null;
  }
  function issuerMetrics(r){
    const a=r?.account_data;
    if(!a||!Number.isInteger(a.Flags)||a.Flags<0||a.Flags>4294967295)throw new Error('Issuer account fields unavailable.');
    const f=Number(a.Flags)>>>0;
    const rate=finite(a.TransferRate||1000000000);
    return{flags:f,globalFreeze:!!(f&0x00400000),noFreeze:!!(f&0x00200000),requireAuth:!!(f&0x00040000),clawback:!!(f&0x80000000),disableMaster:!!(f&0x00100000),defaultRipple:!!(f&0x00800000),transferFeePercent:rate!==null&&rate>=1e9?(rate/1e9-1)*100:null,domainHex:typeof a.Domain==='string'?a.Domain:null,regularKeyPresent:typeof a.RegularKey==='string',ammAccount:!!a.AMMID,blackholeStatus:'Not determined: key flags alone do not prove permanent loss of signing authority.'};
  }
  function holdersMetrics(pages,asset,poolAccount){
    const balances=new Map();let invalid=0;
    for(const line of pages.items){
      if(canonicalCurrency(line.currency)!==canonicalCurrency(asset.currency))continue;
      const n=finite(line.balance);
      if(n===null){invalid++;continue}
      if(n<0)balances.set(line.account,-n);
    }
    const rows=[...balances].sort((a,b)=>b[1]-a[1]);
    const total=rows.reduce((s,r)=>s+r[1],0);
    const complete=pages.complete&&invalid===0&&Number.isFinite(total);
    const top10=rows.slice(0,10).reduce((s,r)=>s+r[1],0);
    const largestNonPool=rows.find(r=>r[0]!==poolAccount);
    return{complete,pages:pages.pages,linesRead:pages.items.length,observedHolderAccounts:rows.length,observedIssuedBalance:total,totalHolderAccounts:complete?rows.length:null,issuedBalance:complete?total:null,top1Percent:complete&&total>0?100*(rows[0]?.[1]||0)/total:null,top10Percent:complete&&total>0?100*top10/total:null,largestNonPoolPercent:complete&&total>0?100*(largestNonPool?.[1]||0)/total:null,knownXrpPoolPercent:complete&&total>0?100*(balances.get(poolAccount)||0)/total:null,invalidBalances:invalid,meaning:'Accounts are not people. Exchanges, AMMs and custodians can hold for many users. Issued balance is outstanding liabilities, not maximum supply.'};
  }
  function poolMetrics(r,asset){
    const a=r?.amm;if(!a)throw new Error('AMM fields unavailable.');
    const amounts=[a.amount,a.amount2];
    const xrp=amounts.map(v=>amount(v,'XRP')).find(v=>v!==null);
    const token=amounts.map(v=>amount(v,asset)).find(v=>v!==null);
    const lp=positive(a.lp_token?.value);
    if(xrp===undefined||token===undefined||lp===null||!a.account||a.lp_token?.issuer!==a.account||!/^03[A-Fa-f0-9]{38}$/.test(a.lp_token?.currency||''))throw new Error('AMM identity or reserve fields do not match.');
    return{exists:true,account:a.account,xrpReserve:xrp,tokenReserve:token,lpSupply:lp,lpCurrency:a.lp_token.currency,assetFrozen:!!a.asset_frozen,asset2Frozen:!!a.asset2_frozen,frozen:!!(a.asset_frozen||a.asset2_frozen),feePercent:positive(a.trading_fee)===null?null:Number(a.trading_fee)/1000,spotXrp:token>0?xrp/token:null,meaning:'XRP pair only. Reserves and indicative spot price do not guarantee an executable exit.'};
  }
  function bookMetrics(r,asset,wallet){
    if(!Array.isArray(r?.offers))throw new Error('Order book fields unavailable.');
    const rows=[];const funds=new Map();let skipped=0;
    for(const o of r.offers){
      if(o.Account===wallet)continue;
      const gx=amount(o.TakerGets,'XRP'),pt=amount(o.TakerPays,asset);
      if(gx===null||pt===null||gx<=0||pt<=0){skipped++;continue}
      let fx=positive(o.taker_gets_funded),ft=amount(o.taker_pays_funded,asset);
      if(!funds.has(o.Account)&&positive(o.owner_funds)!==null)funds.set(o.Account,Number(o.owner_funds)/1e6);
      if(fx!==null)fx/=1e6;
      if(fx===null){
        // XRPL omits partial-funding fields for fully funded offers.
        fx=funds.has(o.Account)?Math.min(gx,funds.get(o.Account)):gx;
      }
      fx=Math.min(gx,fx);
      const ratio=gx/pt;
      ft=Math.min(pt,ft===null?fx/ratio:ft,fx/ratio);
      if(funds.has(o.Account))funds.set(o.Account,Math.max(0,funds.get(o.Account)-Math.min(fx,ft*ratio)));
      if(fx>0&&ft>0)rows.push({xrp:Math.min(fx,ft*ratio),tokens:ft,priceXrp:ratio});
    }
    rows.sort((a,b)=>b.priceXrp-a.priceXrp);
    const best=rows[0]?.priceXrp??null;
    return{offersRead:r.offers.length,fundedOffers:rows.length,unknownFundingOffers:skipped,atLimit:r.offers.length>=100,bestBidXrp:best,fundedBidXrp:rows.reduce((s,o)=>s+o.xrp,0),fundedTokenCapacity:rows.reduce((s,o)=>s+o.tokens,0),depthWithin2PercentXrp:best===null?0:rows.filter(o=>o.priceXrp>=best*.98).reduce((s,o)=>s+o.xrp,0),rows,meaning:'Up to 100 offers to sell this token for XRP, with known funding; own offers excluded. AMM depth is separate. Fees, route changes and later fills are not included.'};
  }
  function externalMetrics(data,asset,now=Date.now()){
    if(!Array.isArray(data))throw new Error('Market response is not a pair list.');
    const wanted=identity(asset.currency,asset.issuer),pairs=new Map();
    for(const p of data){
      if(p?.chainId!=='xrpl'||typeof p.baseToken?.address!=='string')continue;
      const dot=p.baseToken.address.lastIndexOf('.');
      if(dot<0||identity(p.baseToken.address.slice(0,dot),p.baseToken.address.slice(dot+1))!==wanted)continue;
      if(typeof p.pairAddress!=='string'||pairs.has(p.pairAddress))continue;
      pairs.set(p.pairAddress,p);
    }
    const list=[...pairs.values()].sort((a,b)=>(positive(b.liquidity?.usd)??-1)-(positive(a.liquidity?.usd)??-1));
    if(!list.length)return{matched:false,matchedPairs:0,meaning:'No exact base-token match returned. Coverage gap; not proof of no market.'};
    const p=list[0],created=positive(p.pairCreatedAt),buys=positive(p.txns?.h24?.buys),sells=positive(p.txns?.h24?.sells);
    return{matched:true,matchedPairs:list.length,pairAddress:p.pairAddress,dex:String(p.dexId||''),quote:String(p.quoteToken?.symbol||''),priceUsd:positive(p.priceUsd),liquidityUsd:positive(p.liquidity?.usd),volume24hUsd:positive(p.volume?.h24),change24hPercent:finite(p.priceChange?.h24),buys24h:buys,sells24h:sells,sellSharePercent:buys!==null&&sells!==null&&buys+sells>0?100*sells/(buys+sells):null,marketFirstSeenAt:created!==null&&created>0&&created<=now?new Date(created).toISOString():null,marketAgeDays:created!==null&&created>0&&created<=now?(now-created)/86400000:null,providerDataTimestamp:null,fetchedAt:new Date(now).toISOString(),meaning:'DEX Screener; deepest returned exact-base market. Trading activity is not proof of real-world utility or unique users. Fetch time is not provider data age. Market first-seen is not proven token launch.'};
  }
  function historyMetrics(result,pool){
    if(!Array.isArray(result?.transactions))throw new Error('Pool history unavailable.');
    const events=[];let oldest=null,newest=null,ignored=0;
    for(const e of result.transactions){
      const tx=e.tx_json||e.tx||e.transaction||{},m=e.meta||e.metaData||{};
      if(e.validated!==true||m.TransactionResult!=='tesSUCCESS'){ignored++;continue}
      const d=finite(tx.date??e.date),time=d===null?null:(d+946684800)*1000;
      if(time!==null){oldest=oldest===null?time:Math.min(oldest,time);newest=newest===null?time:Math.max(newest,time)}
      if(!['AMMWithdraw','AMMClawback','AMMCreate','AMMDelete','AMMDeposit'].includes(tx.TransactionType))continue;
      let before=null,after=null,matchedPool=false;
      for(const node of m.AffectedNodes||[]){
        const n=node.ModifiedNode||node.DeletedNode||node.CreatedNode;
        const fields=n?.FinalFields||n?.NewFields||{};
        if(n?.LedgerEntryType!=='AMM'||fields.Account!==pool.account)continue;
        matchedPool=true;
        before=positive(n.PreviousFields?.LPTokenBalance?.value);
        after=node.DeletedNode?0:positive(fields.LPTokenBalance?.value);
      }
      if(!matchedPool)continue;
      const hash=String(e.hash||tx.hash||'');
      if(!/^[A-Fa-f0-9]{64}$/.test(hash))continue;
      events.push({type:tx.TransactionType,hash:hash.toUpperCase(),ledgerIndex:finite(e.ledger_index??tx.ledger_index),at:time===null?null:new Date(time).toISOString(),lpBefore:before,lpAfter:after,lpReductionPercent:before!==null&&before>0&&after!==null?100*(before-after)/before:null});
    }
    return{events,transactionsRead:result.transactions.length,hasMore:!!result.marker,ignoredUnvalidatedOrFailed:ignored,oldestObservedAt:oldest===null?null:new Date(oldest).toISOString(),newestObservedAt:newest===null?null:new Date(newest).toISOString(),meaning:'Recent bounded pool-account history. Events are validated successes; omitted or older history remains unknown.'};
  }
  function changes(current,previous){
    if(!current||!previous||!current.exists||!previous.exists||current.account!==previous.account)return null;
    const pct=(a,b)=>finite(a)!==null&&finite(b)!==null&&b>0?100*(a-b)/b:null;
    return{xrpReservePercent:pct(current.xrpReserve,previous.xrpReserve),tokenReservePercent:pct(current.tokenReserve,previous.tokenReserve),lpSupplyPercent:pct(current.lpSupply,previous.lpSupply),meaning:'Comparison with the prior observation in this revealed session. Reserve moves alone do not identify liquidity withdrawal.'};
  }
  function evaluate(record){
    const findings=[],gaps=[];const add=(id,severity,points,title,detail,source)=>findings.push({id,severity,points,title,detail,source});
    const c=record.issuer,b=record.book,p=record.pool,h=record.holders,e=record.external,t=record.trustline||{};
    for(const s of record.sources||[])if(s.status!=='available')gaps.push(s.label+': '+s.status+(s.error?' — '+s.error:''));
    if(c){
      if(c.globalFreeze)add('global-freeze','critical',70,'Issuer has globally frozen the token','Transfers and market use can be restricted across the asset. Review issuer instructions before attempting to trade.','issuer');
      if(t.freeze_peer||t.deep_freeze_peer)add('wallet-frozen','critical',70,'Your trustline is frozen by the issuer','The issuer-side trustline flags restrict this wallet. A quoted price does not establish that you can sell.','wallet');
      if(record.trustline&&c.requireAuth&&t.peer_authorized!==true)add('wallet-auth','critical',60,'Issuer authorization is missing','This asset requires authorization and your trustline does not show issuer approval.','wallet');
      if(c.clawback)add('clawback','caution',12,'Issuer can reclaim tokens','Clawback is an issuer control. It can serve a disclosed regulated use, but holders depend on that issuer’s policy.','issuer');
      if(!c.ammAccount&&!c.noFreeze&&!c.globalFreeze)add('freeze-capable','caution',6,'Issuer retains freeze authority','A token can be restricted later. This capability alone does not show abuse.','issuer');
      if(c.transferFeePercent!==null&&c.transferFeePercent>1)add('transfer-fee','caution',10,'Transfer fee exceeds 1%','Transfers between holders may incur '+c.transferFeePercent.toFixed(3)+'%. Some transfers are exempt; displayed market depth excludes these costs.','issuer');
    }
    if(b&&b.unknownFundingOffers)gaps.push('Some returned offers lack usable funding evidence; depth may be understated.');
    if(p?.frozen)add('pool-frozen','critical',60,'The XRP pool has a frozen asset','The AMM reports a frozen pool asset. Visible reserves do not establish usable liquidity; this can restrict trading even when your own trustline is clear.','pool');
    if(p&&p.exists===false)gaps.push('No XRP AMM exists at the selected ledger; other quote-asset pools are not enumerated.');
    if(b&&b.fundedBidXrp===0&&b.unknownFundingOffers===0&&p&&(p.exists===false||p.xrpReserve===0))add('no-xrp-route','high',40,'No funded direct XRP exit observed','The sampled XRP book has no funded bids and no funded XRP AMM was found. Other routes may exist; this is not proof that every exit is impossible.','book + pool');
    if(p?.exists&&p.xrpReserve>0&&p.xrpReserve<1000)add('thin-xrp-pool','caution',12,'Small XRP liquidity reserve','The XRP side holds less than 1,000 XRP. Larger sells can move the price sharply; this threshold is a screening heuristic.','pool');
    if(h?.complete&&h.largestNonPoolPercent>=50)add('concentration','high',25,'One non-pool account holds at least half','The largest account outside the observed XRP pool holds '+h.largestNonPoolPercent.toFixed(1)+'% of observed outstanding issued balances. It may be a custodian; ownership is not established.','holders');
    else if(h?.complete&&h.top10Percent>=80)add('concentration','caution',14,'Balances are concentrated in ten accounts','The largest ten accounts hold '+h.top10Percent.toFixed(1)+'%. Custodians and liquidity pools may explain part of this concentration.','holders');
    if(h&&!h.complete)gaps.push('Holder traversal is incomplete; total supply, holder totals and concentration percentages are withheld.');
    if(e?.matched){
      if(e.marketAgeDays!==null&&e.marketAgeDays<7)add('new-market','caution',12,'Very short observed market history','The provider first saw this market fewer than seven days ago. This does not establish the token’s launch date.','external');
      if(e.liquidityUsd!==null&&e.liquidityUsd<10000)add('external-thin','caution',8,'Low reported dollar liquidity','The deepest returned exact-base market reports less than $10,000 liquidity. This can change rapidly and is not a realizable wallet valuation.','external');
      if(e.change24hPercent!==null&&e.change24hPercent<=-30)add('price-fall','high',20,'Large reported 24-hour price fall','The selected market fell at least 30% in 24 hours. A price fall alone does not prove fraud or a liquidity withdrawal.','external');
      if(e.sellSharePercent!==null&&e.sellSharePercent>=80&&(e.buys24h+e.sells24h)>=20)add('sell-pressure','caution',10,'Reported trades are heavily sell-sided','At least 80% of the selected market’s 24-hour trade count is sells, with at least 20 trades. Counts do not measure net dollar flow or independent users.','external');
      if(e.volume24hUsd!==null&&e.liquidityUsd>0&&e.volume24hUsd/e.liquidityUsd>10)add('turnover','caution',8,'Unusually high turnover relative to liquidity','Reported daily volume exceeds ten times current liquidity. Arbitrage, incentives or artificial activity are possible explanations; wash trading is not established.','external');
    }else if(e)gaps.push('External market coverage has no exact base-token match.');
    const withdrawals=(record.history?.events||[]).filter(x=>['AMMWithdraw','AMMClawback','AMMDelete'].includes(x.type));
    const severe=withdrawals.find(x=>x.lpReductionPercent>=20);
    if(severe)add('confirmed-lp-removal','high',35,'Large liquidity withdrawal recorded','A validated '+severe.type+' reduced this XRP pool’s LP supply by '+severe.lpReductionPercent.toFixed(1)+'% in one observed transaction. Withdrawal is not by itself proof of fraud.','history:'+severe.hash);
    const created=(record.history?.events||[]).filter(x=>x.type==='AMMCreate'&&x.at).sort((a,b)=>a.at.localeCompare(b.at))[0];
    if(created&&withdrawals.some(x=>x.lpReductionPercent>=20&&x.at&&Date.parse(x.at)>=Date.parse(created.at)&&Date.parse(x.at)-Date.parse(created.at)<7*86400000))add('early-removal','high',15,'Large removal soon after observed pool creation','The sampled validated history includes pool creation followed within seven days by at least 20% LP-supply removal. This is pool chronology, not the launch date of the token.','history');
    if(record.change?.lpSupplyPercent<=-20&&!severe)add('lp-decrease','high',25,'LP supply fell between observations','The pool’s LP supply fell by '+Math.abs(record.change.lpSupplyPercent).toFixed(1)+'% since the prior session observation. Check transaction history to identify the cause.','pool comparison');
    if(record.change?.xrpReservePercent<=-30)add('reserve-change','caution',10,'XRP reserve fell sharply between observations','The XRP side fell by '+Math.abs(record.change.xrpReservePercent).toFixed(1)+'%. Swaps can cause this; it is not automatically liquidity removal.','pool comparison');
    if(record.history?.hasMore)gaps.push('Pool history is bounded; earlier events were not searched.');
    gaps.push('Real-world utility, redemption backing, legal rights, team identity and maximum supply are not established by these market metrics.');
    const externalUsable=e?.matched&&['liquidityUsd','volume24hUsd','change24hPercent','buys24h','sells24h'].every(k=>finite(e[k])!==null);
    if(e?.matched&&!externalUsable)gaps.push('Some required external liquidity or activity fields are missing; market coverage is partial.');
    const required=['issuer','holders','pool','book','external'];
    const known=required.filter(k=>record.sources?.find(s=>s.id===k)?.status==='available'&&(k!=='issuer'||!!c)&&(k!=='holders'||h?.complete)&&(k!=='pool'||!!p)&&(k!=='book'||!!b)&&(k!=='external'||externalUsable)).length;
    const coverage=Math.round(100*known/required.length);
    const points=Math.min(100,findings.reduce((s,f)=>s+f.points,0));
    const critical=findings.some(f=>f.severity==='critical'),high=findings.some(f=>f.severity==='high');
    const band=known===0?'Evidence unavailable':critical?'Critical restriction':high||points>=40?'High concern':points>0?'Caution':coverage<100?'Incomplete evidence':'No flagged conditions';
    return{band,points:known===0?null:points,coveragePercent:coverage,complete:coverage===100,findings:findings.sort((a,b)=>b.points-a.points),gaps,summary:known===0?'Evidence is unavailable. No token safety conclusion can be made.':findings.length?findings[0].title+'. '+(coverage<100?'Some evidence is missing. ':'')+'Review the causes and source evidence below.':'No configured warning threshold was triggered. '+(coverage<100?'The evidence is incomplete. ':'')+'This is not a safety endorsement.',methodology:'Additive heuristic warning points, capped at 100; not a calibrated fraud probability or investment recommendation. Restrictions and high-severity observations override the numeric band. Coverage measures usable source categories, not certainty.'};
  }
  return{VERSION,finite,positive,identity,canonicalCurrency,validAsset,issuerMetrics,holdersMetrics,poolMetrics,bookMetrics,externalMetrics,historyMetrics,changes,evaluate};
}
module.exports = createXRBCIntelligenceCore();
