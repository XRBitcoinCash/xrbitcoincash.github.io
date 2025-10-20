// /assets/holiday-embed.js
// Single-file holiday rotator: dataset + engine + CSS + widget + theme + event.

(() => {
  const CSS = `
  :root{
    --hr-bg:#0b1422; --hr-edge:rgba(255,255,255,.16);
    --hr-ink:#e6f0ff; --hr-muted:#9EB2D0;
    --accent: var(--accent, #00e5ff);
  }
  [data-holiday-rotator]{display:inline-block}
  .hr-chip{
    display:inline-flex; align-items:center; gap:.5rem;
    padding:.4rem .7rem; border-radius:999px;
    border:1px solid var(--hr-edge); color:var(--hr-ink); background:var(--hr-bg);
    box-shadow:0 0 0 2px rgba(0,229,255,.10);
  }
  .hr-chip .hr-date{ color:var(--hr-muted) }
  .hr-chip .hr-emoji{ font-size:1.1rem }

  .hr-banner{
    display:flex; align-items:center; gap:.8rem;
    padding:.7rem .9rem; border-radius:14px;
    border:1px solid var(--hr-edge); color:var(--hr-ink); background:var(--hr-bg);
    box-shadow:0 0 0 2px rgba(0,229,255,.10), 0 0 30px rgba(0,229,255,.05) inset;
  }
  .hr-banner .hr-emoji{ font-size:1.6rem }
  .hr-banner .hr-title{ font-weight:700 }
  .hr-banner .hr-sub{ color:var(--hr-muted); font-size:.92rem }
  `;

  // Inject CSS once
  if (!document.getElementById('holiday-embed-css')) {
    const s = document.createElement('style');
    s.id = 'holiday-embed-css';
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  // ===== Dataset (extend any time) =====
  const HOLIDAYS = [
    // National / Civic
    { id:"new_year",        name:"New Year's Day",             cat:"national", rule:{type:"fixed", month:1, day:1},          meta:{emoji:"🎆", tone:"celebration"} },
    { id:"mlk",             name:"Martin Luther King Jr. Day", cat:"national", rule:{type:"nthWeekday", month:1, weekday:1, nth:3}, meta:{emoji:"🕊️", tone:"solemn"} },
    { id:"presidents",      name:"Presidents' Day (US)",       cat:"national", rule:{type:"nthWeekday", month:2, weekday:1, nth:3}, meta:{emoji:"🦅"} },
    { id:"valentines",      name:"Valentine's Day",            cat:"cultural", rule:{type:"fixed", month:2, day:14},         meta:{emoji:"💘"} },
    { id:"st_patrick",      name:"St. Patrick's Day",          cat:"cultural", rule:{type:"fixed", month:3, day:17},         meta:{emoji:"🍀"} },
    { id:"cinco",           name:"Cinco de Mayo",              cat:"cultural", rule:{type:"fixed", month:5, day:5},          meta:{emoji:"🎺"} },
    { id:"memorial_us",     name:"Memorial Day (US)",          cat:"national", rule:{type:"lastWeekday", month:5, weekday:1}, meta:{emoji:"🎖️", tone:"solemn"} },
    { id:"juneteenth",      name:"Juneteenth (US)",            cat:"national", rule:{type:"fixed", month:6, day:19},         meta:{emoji:"🕯️", tone:"solemn"} },
    { id:"canada",          name:"Canada Day (CA)",            cat:"national", rule:{type:"fixed", month:7, day:1},          meta:{emoji:"🍁"} },
    { id:"us_independence", name:"Independence Day (US)",      cat:"national", rule:{type:"fixed", month:7, day:4},          meta:{emoji:"🎇"} },
    { id:"bastille",        name:"Bastille Day (FR)",          cat:"national", rule:{type:"fixed", month:7, day:14},         meta:{emoji:"🇫🇷"} },
    { id:"labor_us",        name:"Labor Day (US)",             cat:"national", rule:{type:"nthWeekday", month:9, weekday:1, nth:1}, meta:{emoji:"🛠️"} },
    { id:"oktoberfest_open",name:"Oktoberfest Opening (DE)",   cat:"cultural", rule:{type:"custom", fn:"oktoberfestOpen"},    meta:{emoji:"🍺"} },
    { id:"halloween",       name:"Halloween",                  cat:"cultural", rule:{type:"fixed", month:10, day:31},        meta:{emoji:"🎃"} },
    { id:"day_of_the_dead", name:"Día de los Muertos",         cat:"cultural", rule:{type:"fixed", month:11, day:1},         meta:{emoji:"💀"} },
    { id:"veterans",        name:"Veterans Day (US)",          cat:"national", rule:{type:"fixed", month:11, day:11},        meta:{emoji:"🎖️"} },
    { id:"thanksgiving_us", name:"Thanksgiving (US)",          cat:"national", rule:{type:"nthWeekday", month:11, weekday:4, nth:4}, meta:{emoji:"🦃"} },
    { id:"black_friday",    name:"Black Friday",               cat:"cultural", rule:{type:"custom", fn:"dayAfterThanksgivingUS"}, meta:{emoji:"🛍️"} },
    { id:"boxing_day",      name:"Boxing Day",                 cat:"national", rule:{type:"fixed", month:12, day:26},        meta:{emoji:"🎁"} },
    // Christian (Western)
    { id:"good_friday",     name:"Good Friday",                cat:"christian", rule:{type:"easterOffset", offset:-2},       meta:{emoji:"✝️", tone:"solemn"} },
    { id:"easter",          name:"Easter (Western)",           cat:"christian", rule:{type:"easterOffset", offset:0},        meta:{emoji:"🌅"} },
    { id:"christmas",       name:"Christmas (Western)",        cat:"christian", rule:{type:"fixed", month:12, day:25},       meta:{emoji:"🎄"} },
    // Jewish (approx lists; replace with authoritative if needed)
    { id:"passover_start",  name:"Passover Begins",            cat:"jewish",    rule:{type:"fixedList", dates:["2025-04-12","2026-04-01","2027-04-21","2028-04-10"]}, meta:{emoji:"🍷"} },
    { id:"rosh_hashanah",   name:"Rosh Hashanah (Eve)",        cat:"jewish",    rule:{type:"fixedList", dates:["2025-09-22","2026-09-11","2027-10-01","2028-09-20"]}, meta:{emoji:"📯"} },
    { id:"yom_kippur",      name:"Yom Kippur (Eve)",           cat:"jewish",    rule:{type:"fixedList", dates:["2025-10-01","2026-09-20","2027-10-10","2028-09-29"]}, meta:{emoji:"🕯️", tone:"solemn"} },
    { id:"hanukkah_start",  name:"Hanukkah Begins",            cat:"jewish",    rule:{type:"fixedList", dates:["2025-12-14","2026-12-04","2027-12-24","2028-12-12"]}, meta:{emoji:"🕎"} },
    // Muslim (approx lists)
    { id:"ramadan_start",   name:"Ramadan Begins (approx.)",   cat:"muslim",    rule:{type:"fixedList", dates:["2025-03-01","2026-02-18","2027-02-08","2028-01-28"]}, meta:{emoji:"🌙", tone:"solemn"} },
    { id:"eid_fitr",        name:"Eid al-Fitr (approx.)",      cat:"muslim",    rule:{type:"fixedList", dates:["2025-03-31","2026-03-29","2027-03-20","2028-03-09"]}, meta:{emoji:"🕌"} },
    { id:"eid_adha",        name:"Eid al-Adha (approx.)",      cat:"muslim",    rule:{type:"fixedList", dates:["2025-06-07","2026-05-27","2027-05-17","2028-05-05"]}, meta:{emoji:"🕋"} },
    // Hindu / Buddhist (approx lists)
    { id:"holi",            name:"Holi",                       cat:"hindu",     rule:{type:"fixedList", dates:["2025-03-14","2026-03-03","2027-03-22","2028-03-11"]}, meta:{emoji:"🌈"} },
    { id:"diwali",          name:"Diwali/Deepavali",           cat:"hindu",     rule:{type:"fixedList", dates:["2025-10-20","2026-11-08","2027-10-29","2028-10-17"]}, meta:{emoji:"🪔"} },
    { id:"vesak",           name:"Vesak",                      cat:"buddhist",  rule:{type:"fixedList", dates:["2025-05-12","2026-05-01","2027-05-20","2028-05-09"]}, meta:{emoji:"🪷"} },
    // Cultural
    { id:"nowruz",          name:"Nowruz",                     cat:"cultural",  rule:{type:"fixed", month:3, day:20},        meta:{emoji:"🌱"} },
    { id:"mid_autumn",      name:"Mid-Autumn Festival (approx.)",cat:"cultural",rule:{type:"fixedList", dates:["2025-10-06","2026-09-25","2027-09-15","2028-10-03"]}, meta:{emoji:"🥮"} },
    { id:"kwanzaa_start",   name:"Kwanzaa Begins",             cat:"cultural",  rule:{type:"fixed", month:12, day:26},       meta:{emoji:"🕯️"} },
    { id:"nye",             name:"New Year's Eve",             cat:"cultural",  rule:{type:"fixed", month:12, day:31},       meta:{emoji:"🎉"} },
  ];

  const DEFAULT_CATS = ['national','christian','jewish','muslim','hindu','buddhist','cultural'];

  // ===== Rules/Engine =====
  function nthWeekdayOfMonth(year, m, weekday, nth){
    const first = new Date(year, m, 1);
    const firstWeekday = first.getDay();
    const day = 1 + ((7 + weekday - firstWeekday) % 7) + (nth - 1) * 7;
    return new Date(year, m, day);
  }
  function lastWeekdayOfMonth(year, m, weekday){
    const last = new Date(year, m + 1, 0);
    const lastWeekday = last.getDay();
    const diff = (7 + lastWeekday - weekday) % 7;
    return new Date(year, m + 1, 0 - diff);
  }
  function westernEaster(year){
    const a=year%19, b=Math.floor(year/100), c=year%100, d=Math.floor(b/4),
          e=b%4, f=Math.floor((b+8)/25), g=Math.floor((b-f+1)/3),
          h=(19*a+b-d-g+15)%30, i=Math.floor(c/4), k=c%4,
          l=(32+2*e+2*i-h-k)%7, m=Math.floor((a+11*h+22*l)/451),
          month=Math.floor((h+l-7*m+114)/31), day=((h+l-7*m+114)%31)+1;
    return new Date(year, month-1, day);
  }
  function addDays(d,n){ const x=new Date(d); x.setDate(x.getDate()+n); return x; }
  function sameYMD(a,b){ return a.getFullYear()===b.getFullYear() && a.getMonth()===b.getMonth() && a.getDate()===b.getDate(); }
  function ymd(d){ return d.toISOString().slice(0,10); }
  function at0001Tomorrow(base=new Date()){
    const d=new Date(base); d.setHours(0,1,0,0);
    const now=new Date(base);
    if (now>=d){ const t=new Date(now); t.setDate(t.getDate()+1); t.setHours(0,1,0,0); return t; }
    return d;
  }
  function oktoberfestOpen(year){
    const base=new Date(year,8,16); const day=base.getDay();
    const off=(6 - day + 7) % 7; return new Date(year,8,16+off);
  }
  function dayAfterThanksgivingUS(year){
    const th = nthWeekdayOfMonth(year,10,4,4); return addDays(th,1);
  }
  function computeDateForYear(h, year){
    const r=h.rule;
    switch (r.type){
      case 'fixed':       return new Date(year, r.month-1, r.day);
      case 'nthWeekday':  return nthWeekdayOfMonth(year, r.month-1, r.weekday, r.nth);
      case 'lastWeekday': return lastWeekdayOfMonth(year, r.month-1, r.weekday);
      case 'easterOffset':return addDays(westernEaster(year), r.offset||0);
      case 'fixedList': {
        const list=(r.dates||[]).map(d=>new Date(d+'T00:00:00'));
        const exact=list.find(d=>d.getFullYear()===year); if (exact) return exact;
        const future=list.find(d=>d>=new Date(year,0,1)&&d<new Date(year+1,0,1)); if (future) return future;
        if (list.length){
          let best=list[0], bestDelta=Math.abs(+best - +new Date(year,6,1));
          for (const d of list){ const delta=Math.abs(+d - +new Date(year,6,1)); if (delta<bestDelta){best=d; bestDelta=delta;} }
          return new Date(year, best.getMonth(), best.getDate());
        }
        return null;
      }
      case 'custom':
        if (r.fn==='oktoberfestOpen') return oktoberfestOpen(year);
        if (r.fn==='dayAfterThanksgivingUS') return dayAfterThanksgivingUS(year);
        return null;
      default: return null;
    }
  }
  function listOccurrences(fromDate=new Date(), categories=DEFAULT_CATS){
    const y=fromDate.getFullYear(); const cats=new Set(categories); const pool=[];
    for (const h of HOLIDAYS){
      if (!cats.has(h.cat)) continue;
      const d1=computeDateForYear(h,y);   if (d1) pool.push({h, date:d1});
      const d2=computeDateForYear(h,y+1); if (d2) pool.push({h, date:d2});
    }
    return pool.filter(x=>x.date).sort((a,b)=>a.date-b.date);
  }
  function pickCurrentOrNext(today, occs){
    const t=occs.filter(x=>sameYMD(x.date,today)); if (t.length) return t[0];
    return occs.find(x=>x.date>=today) || occs[0] || null;
  }
  function nextHoliday({today=new Date(), categories=DEFAULT_CATS}={}){
    const norm=new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const occs=listOccurrences(norm, categories);
    const pick=pickCurrentOrNext(norm, occs);
    const nextRefreshAt=at0001Tomorrow(norm);
    return { holiday: pick?.h || null, date: pick?.date || null, occurrences: occs, nextRefreshAt };
  }

  // Theme hook
  function applyThemeToDocument(h){
    const tone = h?.meta?.tone || 'celebration';
    document.body.dataset.tone = tone;
    const accent = tone==='solemn' ? '#ff5a5a' : '#00e5ff';
    document.documentElement.style.setProperty('--accent', accent);
  }

  // Rendering
  function renderInto(el, model){
    const { holiday, date, nextRefreshAt } = model;
    const variant = (el.dataset.variant || 'chip').toLowerCase();
    if (!holiday || !date){
      el.innerHTML = `<span class="hr-chip">📅 No holidays found</span>`;
      return;
    }
    const emoji = holiday.meta?.emoji || '🎉';
    const when = ymd(date);
    if (variant === 'banner'){
      el.innerHTML = `
        <div class="hr-banner" title="Auto-refresh: ${nextRefreshAt.toLocaleString()}">
          <div class="hr-emoji">${emoji}</div>
          <div class="hr-text">
            <div class="hr-title">${holiday.name}</div>
            <div class="hr-sub">${when} • ${holiday.cat}</div>
          </div>
        </div>`;
    } else {
      el.innerHTML = `
        <span class="hr-chip" title="Auto-refresh: ${nextRefreshAt.toLocaleString()}">
          <span class="hr-emoji">${emoji}</span>
          <strong>${holiday.name}</strong>
          <span class="hr-date">${when}</span>
        </span>`;
    }
  }

  // Event
  function dispatchHolidayChange(detail){
    window.dispatchEvent(new CustomEvent('holidaychange', { detail }));
  }

  // Scheduler
  function schedule(onTick, base){
    const at = at0001Tomorrow(base);
    const ms = at - new Date();
    setTimeout(onTick, Math.max(1000, ms));
    return at;
  }

  // Init one element
  function parseCats(attr){
    if (!attr) return DEFAULT_CATS;
    return attr.split(',').map(s=>s.trim()).filter(Boolean);
  }
  function initOne(el){
    const categories = parseCats(el.dataset.cats);
    const computeAndRender = () => {
      const model = nextHoliday({ categories });
      renderInto(el, model);
      applyThemeToDocument(model.holiday);
      dispatchHolidayChange(model);
      schedule(computeAndRender, model.nextRefreshAt);
    };
    computeAndRender();
  }

  function initAll(){
    document.querySelectorAll('[data-holiday-rotator]').forEach(initOne);
  }

  // Public micro-API
  window.HolidayRotator = window.HolidayRotator || {
    get now(){
      return nextHoliday({});
    },
    onChange(cb){
      window.addEventListener('holidaychange', (e)=>cb(e.detail));
    },
    ymd,
  };

  if (document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', initAll);
  } else {
    initAll();
  }
})();
