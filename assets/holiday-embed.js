// /assets/holiday-embed.js
// Unified holiday rotator + dual-scenery background + theme — drop-in anywhere.

(() => {
  /* ======================== CSS (widgets + scenery) ======================== */
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

  /* Scenery layer (2 sides + ambient), injected automatically */
  .holiday-scenery{
    position:fixed; inset:0; z-index:0; pointer-events:none;
    --scene-left:none; --scene-right:none;
    --scene-opacity:.35;
    --scene-blend:screen;           /* good on dark */
    --scene-blend-light:multiply;   /* good on light */
    --ambient:
      radial-gradient(800px 500px at 15% 85%, rgba(255,255,255,.03), transparent 60%),
      radial-gradient(1000px 600px at 85% 90%, rgba(255,255,255,.03), transparent 60%);
    background-image: var(--scene-left), var(--scene-right), var(--ambient);
    background-repeat: no-repeat,no-repeat,no-repeat;
    background-position:
      left -6% bottom -4%,
      right -8% bottom -8%,
      center;
    background-size:
      min(60vw, 900px) auto,
      min(55vw, 820px) auto,
      cover;
    opacity: var(--scene-opacity);
    mix-blend-mode: var(--scene-blend);
    transition: background-image .4s ease, opacity .3s ease;
    filter: saturate(1.05);
  }
  [data-theme="light"] .holiday-scenery,
  body.light-mode .holiday-scenery{
    mix-blend-mode: var(--scene-blend-light);
    opacity:.28;
    filter: saturate(1.1) contrast(1.02);
  }
  .holiday-scenery::before, .holiday-scenery::after{
    content:""; position:absolute; inset:0; pointer-events:none;
    background:
      radial-gradient(900px 520px at 0% 100%, rgba(11,15,24,0) 0%, rgba(11,15,24,.12) 45%, rgba(11,15,24,.5) 90%),
      linear-gradient(180deg, transparent 0%, rgba(11,15,24,.15) 100%);
  }
  [data-theme="light"] .holiday-scenery::before,
  [data-theme="light"] .holiday-scenery::after,
  body.light-mode .holiday-scenery::before,
  body.light-mode .holiday-scenery::after{
    background:
      radial-gradient(900px 520px at 0% 100%, rgba(255,255,255,0) 0%, rgba(255,255,255,.18) 55%, rgba(255,255,255,1) 100%),
      linear-gradient(180deg, transparent 0%, rgba(255,255,255,.35) 100%);
  }
  `;

  if (!document.getElementById('holiday-embed-css')) {
    const s = document.createElement('style');
    s.id = 'holiday-embed-css';
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  /* ======================== Utility + SVG library ========================= */
  const svgUrl = (svg) => `url("data:image/svg+xml;utf8,${encodeURIComponent(svg)}")`;

  const SVGS = {
    fireworks: svgUrl(`<svg xmlns='http://www.w3.org/2000/svg' width='1200' height='900' viewBox='0 0 1200 900'>
      <rect fill='none' width='1200' height='900'/>
      <g fill='none' stroke='rgba(0,229,255,.45)' stroke-width='2'>
        <circle cx='250' cy='700' r='90'/><circle cx='250' cy='700' r='60'/><circle cx='250' cy='700' r='30'/>
        <circle cx='980' cy='740' r='120'/><circle cx='980' cy='740' r='80'/><circle cx='980' cy='740' r='40'/>
      </g>
      <g stroke='rgba(255,212,79,.45)' stroke-width='2'>
        <line x1='250' y1='700' x2='320' y2='680'/><line x1='250' y1='700' x2='220' y2='640'/><line x1='250' y1='700' x2='280' y2='760'/>
        <line x1='980' y1='740' x2='1040' y2='700'/><line x1='980' y1='740' x2='930' y2='690'/><line x1='980' y1='740' x2='1020' y2='800'/>
      </g>
    </svg>`),
    tree: svgUrl(`<svg xmlns='http://www.w3.org/2000/svg' width='800' height='900' viewBox='0 0 800 900'>
      <path d='M400 120 L520 280 L460 280 L560 420 L500 420 L620 580 L180 580 L300 420 L240 420 L340 280 L280 280 Z'
            fill='rgba(76,175,80,.55)' stroke='rgba(255,255,255,.12)'/>
      <rect x='370' y='580' width='60' height='90' fill='rgba(121,85,72,.6)'/>
      <circle cx='400' cy='120' r='10' fill='rgba(255,212,79,.7)'/>
    </svg>`),
    pumpkin: svgUrl(`<svg xmlns='http://www.w3.org/2000/svg' width='900' height='900' viewBox='0 0 900 900'>
      <ellipse cx='420' cy='720' rx='160' ry='110' fill='rgba(255,140,0,.55)'/>
      <ellipse cx='520' cy='720' rx='150' ry='105' fill='rgba(255,160,0,.45)'/>
      <path d='M470 580 c20 -30 40 -30 60 0' fill='none' stroke='rgba(0,229,255,.25)' stroke-width='6'/>
      <rect x='500' y='560' width='14' height='28' fill='rgba(76,175,80,.6)'/>
    </svg>`),
    menorah: svgUrl(`<svg xmlns='http://www.w3.org/2000/svg' width='900' height='900' viewBox='0 0 900 900'>
      <g fill='none' stroke='rgba(120,180,255,.7)' stroke-width='8' stroke-linecap='round'>
        <path d='M200 600 Q450 450 700 600'/><line x1='450' y1='600' x2='450' y2='720'/><line x1='200' y1='600' x2='700' y2='600'/>
      </g>
      <g fill='rgba(120,180,255,.7)'>
        <rect x='440' y='370' width='20' height='230' rx='6'/><rect x='350' y='420' width='18' height='180' rx='6'/><rect x='532' y='420' width='18' height='180' rx='6'/>
      </g>
      <g fill='rgba(255,255,180,.8)'><circle cx='450' cy='360' r='10'/><circle cx='359' cy='412' r='8'/><circle cx='541' cy='412' r='8'/></g>
    </svg>`),
    crescent: svgUrl(`<svg xmlns='http://www.w3.org/2000/svg' width='900' height='900' viewBox='0 0 900 900'>
      <circle cx='620' cy='680' r='120' fill='rgba(255,255,255,.12)'/>
      <circle cx='660' cy='660' r='120' fill='#000'/>
      <path d='M200 780 Q300 680 420 760' fill='none' stroke='rgba(255,255,255,.12)' stroke-width='14' stroke-linecap='round'/>
    </svg>`),
    diya: svgUrl(`<svg xmlns='http://www.w3.org/2000/svg' width='800' height='900' viewBox='0 0 800 900'>
      <path d='M180 700 Q400 800 620 700 Q520 780 400 780 Q280 780 180 700 Z' fill='rgba(255,215,0,.45)'/>
      <path d='M400 620 C380 600 360 560 400 520 C440 560 420 600 400 620 Z' fill='rgba(255,140,0,.7)'/>
    </svg>`),
    turkeyLeaves: svgUrl(`<svg xmlns='http://www.w3.org/2000/svg' width='1200' height='900' viewBox='0 0 1200 900'>
      <circle cx='260' cy='760' r='28' fill='rgba(165,42,42,.6)'/><circle cx='290' cy='760' r='18' fill='rgba(210,105,30,.6)'/>
      <path d='M940 700 q40 -30 80 0 q-40 30 -80 0Z' fill='rgba(255,165,0,.45)'/>
      <path d='M980 730 q30 -25 60 0 q-30 25 -60 0Z' fill='rgba(255,140,0,.45)'/>
    </svg>`),
    papelPicado: svgUrl(`<svg xmlns='http://www.w3.org/2000/svg' width='1200' height='900' viewBox='0 0 1200 900'>
      <path d='M80 640 q140 -60 280 0 q140 -60 280 0 q140 -60 280 0' stroke='rgba(255,255,255,.22)' stroke-width='10' fill='none'/>
      <g fill='rgba(255,255,255,.14)'><circle cx='220' cy='620' r='10'/><circle cx='500' cy='620' r='10'/><circle cx='780' cy='620' r='10'/><circle cx='1060' cy='620' r='10'/></g>
    </svg>`),
    shamrock: svgUrl(`<svg xmlns='http://www.w3.org/2000/svg' width='900' height='900' viewBox='0 0 900 900'>
      <g fill='rgba(0,200,120,.55)'><circle cx='260' cy='760' r='42'/><circle cx='300' cy='720' r='42'/><circle cx='320' cy='780' r='42'/></g>
      <rect x='340' y='760' width='10' height='50' transform='rotate(-30 345 785)' fill='rgba(0,200,120,.55)'/>
    </svg>`),
    hearts: svgUrl(`<svg xmlns='http://www.w3.org/2000/svg' width='1200' height='900' viewBox='0 0 1200 900'>
      <path d='M260 720 c-30 -40 40 -80 60 -30 c20 -50 90 -10 60 30 c-30 40 -90 60 -120 0Z' fill='rgba(255,105,135,.55)'/>
      <path d='M980 760 c-30 -40 40 -80 60 -30 c20 -50 90 -10 60 30 c-30 40 -90 60 -120 0Z' fill='rgba(255,64,129,.45)'/>
    </svg>`),
    lanterns: svgUrl(`<svg xmlns='http://www.w3.org/2000/svg' width='900' height='900' viewBox='0 0 900 900'>
      <g fill='rgba(255,80,80,.6)' stroke='rgba(255,255,255,.2)'><ellipse cx='260' cy='720' rx='40' ry='55'/><rect x='245' y='660' width='30' height='10'/></g>
      <g fill='rgba(255,120,60,.55)' stroke='rgba(255,255,255,.2)'><ellipse cx='600' cy='760' rx='50' ry='65'/><rect x='585' y='690' width='30' height='10'/></g>
      <line x1='260' y1='660' x2='260' y2='600' stroke='rgba(255,255,255,.15)' stroke-width='2'/>
      <line x1='600' y1='690' x2='600' y2='630' stroke='rgba(255,255,255,.15)' stroke-width='2'/>
    </svg>`),
    holi: svgUrl(`<svg xmlns='http://www.w3.org/2000/svg' width='1200' height='900' viewBox='0 0 1200 900'>
      <circle cx='260' cy='760' r='50' fill='rgba(255,0,128,.35)'/>
      <circle cx='320' cy='760' r='50' fill='rgba(0,220,255,.35)'/>
      <circle cx='290' cy='720' r='40' fill='rgba(255,220,0,.35)'/>
    </svg>`),
    snowflakes: svgUrl(`<svg xmlns='http://www.w3.org/2000/svg' width='1200' height='900' viewBox='0 0 1200 900'>
      <g stroke='rgba(255,255,255,.35)' stroke-width='2' fill='none'>
        <path d='M220 760 l60 0 m-30 -30 l0 60 M205 745 l30 30 M245 745 l-30 30'/>
        <path d='M980 740 l80 0 m-40 -40 l0 80 M960 720 l40 40 M1000 720 l-40 40'/>
      </g>
    </svg>`),
    leaves: svgUrl(`<svg xmlns='http://www.w3.org/2000/svg' width='1200' height='900' viewBox='0 0 1200 900'>
      <path d='M260 760 q40 -30 80 0 q-40 30 -80 0Z' fill='rgba(255,165,0,.45)'/>
      <path d='M980 760 q40 -30 80 0 q-40 30 -80 0Z' fill='rgba(255,120,0,.45)'/>
    </svg>`),
    flowers: svgUrl(`<svg xmlns='http://www.w3.org/2000/svg' width='1200' height='900' viewBox='0 0 1200 900'>
      <g fill='rgba(255,182,193,.55)'><circle cx='250' cy='740' r='18'/><circle cx='270' cy='760' r='18'/><circle cx='230' cy='760' r='18'/></g>
      <g fill='rgba(186,85,211,.4)'><circle cx='980' cy='740' r='18'/><circle cx='1000' cy='760' r='18'/><circle cx='960' cy='760' r='18'/></g>
    </svg>`),
    tools: svgUrl(`<svg xmlns='http://www.w3.org/2000/svg' width='1200' height='900' viewBox='0 0 1200 900'>
      <path d='M240 760 l40 40 l-12 12 l-40 -40 Z' fill='rgba(200,200,200,.5)'/>
      <rect x='260' y='760' width='14' height='44' fill='rgba(160,160,160,.5)'/>
      <path d='M960 760 l40 40 l-12 12 l-40 -40 Z' fill='rgba(200,200,200,.5)'/>
      <rect x='980' y='760' width='14' height='44' fill='rgba(160,160,160,.5)'/>
    </svg>`),
    water: svgUrl(`<svg xmlns='http://www.w3.org/2000/svg' width='1200' height='900' viewBox='0 0 1200 900'>
      <path d='M200 780 q60 -40 120 0 q60 -40 120 0' fill='none' stroke='rgba(0,200,255,.45)' stroke-width='10'/>
      <path d='M760 780 q60 -40 120 0 q60 -40 120 0' fill='none' stroke='rgba(0,200,255,.45)' stroke-width='10'/>
    </svg>`),
    candle: svgUrl(`<svg xmlns='http://www.w3.org/2000/svg' width='900' height='900' viewBox='0 0 900 900'>
      <rect x='420' y='620' width='20' height='80' fill='rgba(255,255,255,.6)'/>
      <path d='M430 600 q10 -20 0 -40 q-10 20 0 40Z' fill='rgba(255,215,0,.7)'/>
    </svg>`),
    poppy: svgUrl(`<svg xmlns='http://www.w3.org/2000/svg' width='900' height='900' viewBox='0 0 900 900'>
      <circle cx='260' cy='760' r='22' fill='rgba(220,20,60,.7)'/><circle cx='260' cy='760' r='6' fill='rgba(0,0,0,.6)'/>
      <circle cx='980' cy='760' r='22' fill='rgba(220,20,60,.7)'/><circle cx='980' cy='760' r='6' fill='rgba(0,0,0,.6)'/>
    </svg>`),
    earthLeaf: svgUrl(`<svg xmlns='http://www.w3.org/2000/svg' width='900' height='900' viewBox='0 0 900 900'>
      <circle cx='280' cy='760' r='40' fill='rgba(0,200,180,.35)'/>
      <path d='M260 760 q20 -20 40 0 q-20 20 -40 0Z' fill='rgba(0,255,140,.4)'/>
      <circle cx='840' cy='760' r='40' fill='rgba(0,200,180,.35)'/>
      <path d='M820 760 q20 -20 40 0 q-20 20 -40 0Z' fill='rgba(0,255,140,.4)'/>
    </svg>`)
  };

  /* ============================ Holiday dataset ============================ */
  // rule types:
  // - fixed: {month, day}
  // - nthWeekday: {month, weekday(0=Sun..6), nth(1..5)}
  // - lastWeekday: {month, weekday}
  // - easterOffset: {offset} from Western Easter
  // - fixedList: {dates: ["YYYY-MM-DD", ...]} for lunar/observational/orthodox etc.
  // meta: {emoji, tone, info?}
  const HOLIDAYS = [
    // National / Civic
    { id:"new_year",        name:"New Year's Day",             cat:"national", rule:{type:"fixed", month:1, day:1},          meta:{emoji:"🎆"} },
    { id:"australia_day",   name:"Australia Day (AU)",         cat:"national", rule:{type:"fixed", month:1, day:26},         meta:{emoji:"🎆"} },
    { id:"canada",          name:"Canada Day (CA)",            cat:"national", rule:{type:"fixed", month:7, day:1},          meta:{emoji:"🍁"} },
    { id:"us_independence", name:"Independence Day (US)",      cat:"national", rule:{type:"fixed", month:7, day:4},          meta:{emoji:"🎇"} },
    { id:"bastille",        name:"Bastille Day (FR)",          cat:"national", rule:{type:"fixed", month:7, day:14},         meta:{emoji:"🇫🇷"} },
    { id:"brazil_independence", name:"Independence Day (BR)",  cat:"national", rule:{type:"fixed", month:9, day:7},          meta:{emoji:"🎆"} },
    { id:"mexico_independence", name:"Día de la Independencia (MX)", cat:"national", rule:{type:"fixed", month:9, day:16}, meta:{emoji:"🇲🇽"} },
    { id:"india_independence",  name:"Independence Day (IN)",  cat:"national", rule:{type:"fixed", month:8, day:15},         meta:{emoji:"🎆"} },
    { id:"pakistan_independence", name:"Independence Day (PK)",cat:"national", rule:{type:"fixed", month:8, day:14},         meta:{emoji:"🎆"} },
    { id:"philippines_independence", name:"Independence Day (PH)", cat:"national", rule:{type:"fixed", month:6, day:12}, meta:{emoji:"🎆"} },
    { id:"south_africa_freedom", name:"Freedom Day (ZA)",      cat:"national", rule:{type:"fixed", month:4, day:27},         meta:{emoji:"🎆"} },
    { id:"china_national_day", name:"National Day (CN)",       cat:"national", rule:{type:"fixed", month:10, day:1},         meta:{emoji:"🎆"} },
    { id:"nigeria_independence", name:"Independence Day (NG)", cat:"national", rule:{type:"fixed", month:10, day:1},         meta:{emoji:"🎆"} },
    { id:"mlk",             name:"Martin Luther King Jr. Day (US)", cat:"national", rule:{type:"nthWeekday", month:1, weekday:1, nth:3}, meta:{emoji:"🕊️", tone:"solemn"} },
    { id:"presidents",      name:"Presidents' Day (US)",       cat:"national", rule:{type:"nthWeekday", month:2, weekday:1, nth:3}, meta:{emoji:"🦅"} },
    { id:"labor_us",        name:"Labor Day (US)",             cat:"national", rule:{type:"nthWeekday", month:9, weekday:1, nth:1}, meta:{emoji:"🛠️"} },
    { id:"memorial_us",     name:"Memorial Day (US)",          cat:"national", rule:{type:"lastWeekday", month:5, weekday:1}, meta:{emoji:"🎖️", tone:"solemn"} },
    { id:"thanksgiving_us", name:"Thanksgiving (US)",          cat:"national", rule:{type:"nthWeekday", month:11, weekday:4, nth:4}, meta:{emoji:"🦃"} },
    { id:"thanksgiving_ca", name:"Thanksgiving (CA)",          cat:"national", rule:{type:"nthWeekday", month:10, weekday:1, nth:2}, meta:{emoji:"🦃"} },
    { id:"veterans",        name:"Veterans Day (US)",          cat:"national", rule:{type:"fixed", month:11, day:11},        meta:{emoji:"🎖️"} },
    { id:"remembrance",     name:"Remembrance Day",            cat:"national", rule:{type:"fixed", month:11, day:11},        meta:{emoji:"🌺", tone:"solemn"} },
    { id:"black_friday",    name:"Black Friday",               cat:"cultural", rule:{type:"custom", fn:"dayAfterThanksgivingUS"}, meta:{emoji:"🛍️"} },
    { id:"boxing_day",      name:"Boxing Day",                 cat:"national", rule:{type:"fixed", month:12, day:26},        meta:{emoji:"🎁"} },

    // Universal/civic observances
    { id:"womens_day",      name:"International Women's Day",  cat:"cultural", rule:{type:"fixed", month:3, day:8},          meta:{emoji:"🌸"} },
    { id:"earth_day",       name:"Earth Day",                  cat:"cultural", rule:{type:"fixed", month:4, day:22},         meta:{emoji:"🌍"} },
    { id:"workers_day",     name:"International Workers' Day", cat:"cultural", rule:{type:"fixed", month:5, day:1},          meta:{emoji:"🛠️"} },
    { id:"mothers_day_us",  name:"Mother's Day (US)",          cat:"cultural", rule:{type:"nthWeekday", month:5, weekday:0, nth:2}, meta:{emoji:"💐"} },
    { id:"fathers_day_us",  name:"Father's Day (US)",          cat:"cultural", rule:{type:"nthWeekday", month:6, weekday:0, nth:3}, meta:{emoji:"🧰"} },
    { id:"nowruz",          name:"Nowruz",                     cat:"cultural", rule:{type:"fixed", month:3, day:20},         meta:{emoji:"🌱"} },
    { id:"songkran",        name:"Songkran (TH)",              cat:"cultural", rule:{type:"fixed", month:4, day:13},         meta:{emoji:"💧"} },
    { id:"guy_fawkes",      name:"Bonfire Night (UK)",         cat:"cultural", rule:{type:"fixed", month:11, day:5},         meta:{emoji:"🎆"} },

    // Christian (Western) — computed via Western Easter
    { id:"epiphany",        name:"Epiphany",                   cat:"christian", rule:{type:"fixed", month:1, day:6},         meta:{emoji:"⭐"} },
    { id:"ash_wednesday",   name:"Ash Wednesday",              cat:"christian", rule:{type:"easterOffset", offset:-46},      meta:{emoji:"⛪", tone:"solemn"} },
    { id:"mardi_gras",      name:"Mardi Gras",                 cat:"christian", rule:{type:"easterOffset", offset:-47},      meta:{emoji:"🎭"} },
    { id:"palm_sunday",     name:"Palm Sunday",                cat:"christian", rule:{type:"easterOffset", offset:-7},       meta:{emoji:"🌿"} },
    { id:"good_friday",     name:"Good Friday",                cat:"christian", rule:{type:"easterOffset", offset:-2},       meta:{emoji:"✝️", tone:"solemn"} },
    { id:"easter",          name:"Easter (Western)",           cat:"christian", rule:{type:"easterOffset", offset:0},        meta:{emoji:"🌅"} },
    { id:"ascension",       name:"Ascension",                  cat:"christian", rule:{type:"easterOffset", offset:39},       meta:{emoji:"☁️"} },
    { id:"pentecost",       name:"Pentecost",                  cat:"christian", rule:{type:"easterOffset", offset:49},       meta:{emoji:"🕊️"} },
    { id:"christmas",       name:"Christmas (Western)",        cat:"christian", rule:{type:"fixed", month:12, day:25},       meta:{emoji:"🎄"} },

    // Orthodox (fixed lists / fixed date)
    { id:"orthodox_christmas", name:"Christmas (Orthodox)",    cat:"christian", rule:{type:"fixed", month:1, day:7},        meta:{emoji:"🎄"} },
    { id:"orthodox_easter", name:"Easter (Orthodox)",          cat:"christian", rule:{type:"fixedList", dates:["2025-04-20","2026-04-12","2027-05-02","2028-04-16"]}, meta:{emoji:"🌅"} },

    // Jewish (fixed lists – replace with authoritative tables if desired)
    { id:"passover_start",  name:"Passover (Pesach) Begins",   cat:"jewish",    rule:{type:"fixedList", dates:["2025-04-12","2026-04-01","2027-04-21","2028-04-10"]}, meta:{emoji:"🍷"} },
    { id:"rosh_hashanah",   name:"Rosh Hashanah (Eve)",        cat:"jewish",    rule:{type:"fixedList", dates:["2025-09-22","2026-09-11","2027-10-01","2028-09-20"]}, meta:{emoji:"📯"} },
    { id:"yom_kippur",      name:"Yom Kippur (Eve)",           cat:"jewish",    rule:{type:"fixedList", dates:["2025-10-01","2026-09-20","2027-10-10","2028-09-29"]}, meta:{emoji:"🕯️", tone:"solemn"} },
    { id:"hanukkah_start",  name:"Hanukkah Begins",            cat:"jewish",    rule:{type:"fixedList", dates:["2025-12-14","2026-12-04","2027-12-24","2028-12-12"]}, meta:{emoji:"🕎"} },

    // Muslim (approx lists – observational)
    { id:"ramadan_start",   name:"Ramadan Begins (approx.)",   cat:"muslim",    rule:{type:"fixedList", dates:["2025-03-01","2026-02-18","2027-02-08","2028-01-28"]}, meta:{emoji:"🌙", tone:"solemn"} },
    { id:"eid_fitr",        name:"Eid al-Fitr (approx.)",      cat:"muslim",    rule:{type:"fixedList", dates:["2025-03-31","2026-03-29","2027-03-20","2028-03-09"]}, meta:{emoji:"🕌"} },
    { id:"eid_adha",        name:"Eid al-Adha (approx.)",      cat:"muslim",    rule:{type:"fixedList", dates:["2025-06-07","2026-05-27","2027-05-17","2028-05-05"]}, meta:{emoji:"🕋"} },

    // Hindu / Buddhist (fixed lists where needed)
    { id:"holi",            name:"Holi",                       cat:"hindu",     rule:{type:"fixedList", dates:["2025-03-14","2026-03-03","2027-03-22","2028-03-11"]}, meta:{emoji:"🌈"} },
    { id:"diwali",          name:"Diwali/Deepavali",           cat:"hindu",     rule:{type:"fixedList", dates:["2025-10-20","2026-11-08","2027-10-29","2028-10-17"]}, meta:{emoji:"🪔"} },
    { id:"vesak",           name:"Vesak",                      cat:"buddhist",  rule:{type:"fixedList", dates:["2025-05-12","2026-05-01","2027-05-20","2028-05-09"]}, meta:{emoji:"🪷"} },
    { id:"obon",            name:"Obon (JP, approx.)",         cat:"buddhist",  rule:{type:"fixedList", dates:["2025-08-15","2026-08-15","2027-08-15","2028-08-15"]}, meta:{emoji:"🏮"} },

    // Lunar / East Asian
    { id:"lunar_new_year",  name:"Lunar New Year",             cat:"cultural",  rule:{type:"fixedList", dates:["2025-01-29","2026-02-17","2027-02-06","2028-01-26"]}, meta:{emoji:"🧧"} },
    { id:"mid_autumn",      name:"Mid-Autumn Festival (approx.)",cat:"cultural",rule:{type:"fixedList", dates:["2025-10-06","2026-09-25","2027-09-15","2028-10-03"]}, meta:{emoji:"🥮"} },

    // Seasonal / Other
    { id:"valentines",      name:"Valentine's Day",            cat:"cultural",  rule:{type:"fixed", month:2, day:14},        meta:{emoji:"💘"} },
    { id:"st_patrick",      name:"St. Patrick's Day",          cat:"cultural",  rule:{type:"fixed", month:3, day:17},        meta:{emoji:"🍀"} },
    { id:"cinco",           name:"Cinco de Mayo",              cat:"cultural",  rule:{type:"fixed", month:5, day:5},         meta:{emoji:"🎺"} },
    { id:"oktoberfest_open",name:"Oktoberfest Opening (DE)",   cat:"cultural",  rule:{type:"custom", fn:"oktoberfestOpen"},  meta:{emoji:"🍺"} },
    { id:"halloween",       name:"Halloween",                  cat:"cultural",  rule:{type:"fixed", month:10, day:31},       meta:{emoji:"🎃"} },
    { id:"day_of_the_dead", name:"Día de los Muertos",         cat:"cultural",  rule:{type:"fixed", month:11, day:1},        meta:{emoji:"💀"} },
    { id:"kwanzaa_start",   name:"Kwanzaa Begins",             cat:"cultural",  rule:{type:"fixed", month:12, day:26},       meta:{emoji:"🕯️"} },
    { id:"nye",             name:"New Year's Eve",             cat:"cultural",  rule:{type:"fixed", month:12, day:31},       meta:{emoji:"🎉"} }
  ];

  const DEFAULT_CATS = ['national','christian','jewish','muslim','hindu','buddhist','cultural'];

  /* ============================== Date engine ============================== */
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

  /* ============================= Scene mapping ============================= */
  // Specific-id scenes first; category fallbacks after.
  const SCENES = {
    // National fireworks
    us_independence:{left:SVGS.fireworks,right:SVGS.fireworks,accent:'#00e5ff'},
    canada:{left:SVGS.fireworks,right:SVGS.fireworks,accent:'#00e5ff'},
    bastille:{left:SVGS.fireworks,right:SVGS.fireworks,accent:'#00e5ff'},
    australia_day:{left:SVGS.fireworks,right:SVGS.fireworks,accent:'#00e5ff'},
    brazil_independence:{left:SVGS.fireworks,right:SVGS.fireworks,accent:'#00e5ff'},
    mexico_independence:{left:SVGS.papelPicado,right:SVGS.fireworks,accent:'#ffd54f'},
    india_independence:{left:SVGS.fireworks,right:SVGS.fireworks,accent:'#00e5ff'},
    pakistan_independence:{left:SVGS.fireworks,right:SVGS.fireworks,accent:'#00e5ff'},
    philippines_independence:{left:SVGS.fireworks,right:SVGS.fireworks,accent:'#00e5ff'},
    south_africa_freedom:{left:SVGS.fireworks,right:SVGS.fireworks,accent:'#00e5ff'},
    china_national_day:{left:SVGS.lanterns,right:SVGS.fireworks,accent:'#ffd54f'},
    nigeria_independence:{left:SVGS.fireworks,right:SVGS.fireworks,accent:'#00e5ff'},

    // Seasonal / cultural
    valentines:{left:SVGS.hearts,right:SVGS.hearts,accent:'#ff4081'},
    st_patrick:{left:SVGS.shamrock,right:SVGS.shamrock,accent:'#00c878'},
    cinco:{left:SVGS.papelPicado,right:SVGS.papelPicado,accent:'#ffd54f'},
    halloween:{left:SVGS.pumpkin,right:SVGS.papelPicado,accent:'#ff9f1a'},
    day_of_the_dead:{left:SVGS.papelPicado,right:SVGS.papelPicado,accent:'#ff6f61'},
    oktoberfest_open:{left:SVGS.lanterns,right:SVGS.fireworks,accent:'#ffd54f'},
    thanksgiving_us:{left:SVGS.turkeyLeaves,right:SVGS.leaves,accent:'#ff9f1a'},
    thanksgiving_ca:{left:SVGS.turkeyLeaves,right:SVGS.leaves,accent:'#ff9f1a'},
    black_friday:{left:SVGS.leaves,right:SVGS.fireworks,accent:'#ffd54f'},
    boxing_day:{left:SVGS.snowflakes,right:SVGS.fireworks,accent:'#b3e5fc'},
    nye:{left:SVGS.fireworks,right:SVGS.fireworks,accent:'#ffd54f'},
    new_year:{left:SVGS.fireworks,right:SVGS.fireworks,accent:'#00e5ff'},
    guy_fawkes:{left:SVGS.fireworks,right:SVGS.fireworks,accent:'#ffd54f'},
    womens_day:{left:SVGS.flowers,right:SVGS.flowers,accent:'#ff80c0'},
    earth_day:{left:SVGS.earthLeaf,right:SVGS.earthLeaf,accent:'#00d1b2'},
    workers_day:{left:SVGS.tools,right:SVGS.fireworks,accent:'#00e5ff'},
    mothers_day_us:{left:SVGS.flowers,right:SVGS.hearts,accent:'#ff80c0'},
    fathers_day_us:{left:SVGS.tools,right:SVGS.hearts,accent:'#00e5ff'},
    nowruz:{left:SVGS.flowers,right:SVGS.earthLeaf,accent:'#8ae234'},
    songkran:{left:SVGS.water,right:SVGS.lanterns,accent:'#87e8ff'},

    // Lunar / East Asian
    lunar_new_year:{left:SVGS.lanterns,right:SVGS.fireworks,accent:'#ffd54f'},
    mid_autumn:{left:SVGS.lanterns,right:SVGS.lanterns,accent:'#ff7043'},

    // Christian
    christmas:{left:SVGS.tree,right:SVGS.snowflakes,accent:'#00e676'},
    orthodox_christmas:{left:SVGS.tree,right:SVGS.snowflakes,accent:'#00e676'},
    epiphany:{left:SVGS.snowflakes,right:SVGS.tree,accent:'#90caf9'},
    ash_wednesday:{left:SVGS.tree,right:SVGS.candle,accent:'#ff5a5a',tone:'solemn'},
    mardi_gras:{left:SVGS.hearts,right:SVGS.lanterns,accent:'#ffd54f'},
    palm_sunday:{left:SVGS.tree,right:SVGS.leaves,accent:'#66bb6a'},
    good_friday:{left:SVGS.candle,right:SVGS.tree,accent:'#ff5a5a',tone:'solemn'},
    easter:{left:SVGS.tree,right:SVGS.fireworks,accent:'#ffd54f'},
    ascension:{left:SVGS.snowflakes,right:SVGS.fireworks,accent:'#b3e5fc'},
    pentecost:{left:SVGS.lanterns,right:SVGS.fireworks,accent:'#ffd54f'},
    orthodox_easter:{left:SVGS.tree,right:SVGS.fireworks,accent:'#ffd54f'},

    // Jewish
    hanukkah_start:{left:SVGS.menorah,right:SVGS.snowflakes,accent:'#78b4ff'},
    passover_start:{left:SVGS.menorah,right:SVGS.lanterns,accent:'#78b4ff'},
    rosh_hashanah:{left:SVGS.menorah,right:SVGS.lanterns,accent:'#78b4ff'},
    yom_kippur:{left:SVGS.menorah,right:SVGS.candle,accent:'#78b4ff',tone:'solemn'},

    // Muslim (abstract, non-depictive)
    ramadan_start:{left:SVGS.crescent,right:SVGS.candle,accent:'#87e8ff',tone:'solemn'},
    eid_fitr:{left:SVGS.crescent,right:SVGS.fireworks,accent:'#87e8ff'},
    eid_adha:{left:SVGS.crescent,right:SVGS.crescent,accent:'#87e8ff'},

    // Buddhist / Hindu
    diwali:{left:SVGS.diya,right:SVGS.fireworks,accent:'#ffd54f'},
    vesak:{left:SVGS.lanterns,right:SVGS.lanterns,accent:'#ffd54f'},
    obon:{left:SVGS.lanterns,right:SVGS.lanterns,accent:'#ffd54f'},

    remembrance:{left:SVGS.poppy,right:SVGS.poppy,accent:'#ff5a5a',tone:'solemn'},
    day_of_the_dead:{left:SVGS.papelPicado,right:SVGS.papelPicado,accent:'#ff6f61'}
  };

  const CAT_SCENES = {
    national:{left:SVGS.fireworks,right:SVGS.fireworks,accent:'#00e5ff'},
    cultural:{left:SVGS.lanterns,right:SVGS.papelPicado,accent:'#ffd54f'},
    christian:{left:SVGS.tree,right:SVGS.fireworks,accent:'#00e676'},
    jewish:{left:SVGS.menorah,right:SVGS.lanterns,accent:'#78b4ff'},
    muslim:{left:SVGS.crescent,right:SVGS.crescent,accent:'#87e8ff'},
    hindu:{left:SVGS.diya,right:SVGS.holi,accent:'#ffd54f'},
    buddhist:{left:SVGS.lanterns,right:SVGS.lanterns,accent:'#ffd54f'}
  };

  /* ============================== Core modeling ============================ */
  function computeModel({today=new Date(), categories=DEFAULT_CATS}={}){
    const norm = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const occs = listOccurrences(norm, categories);
    const primary = pickCurrentOrNext(norm, occs);
    let companion = null;

    if (primary){
      // Prefer a different category within next ~45 days
      const windowDays = 45;
      const minTs = +norm;
      const maxTs = +addDays(norm, windowDays);

      companion = occs.find(x =>
        x.h.id !== primary.h.id &&
        x.h.cat !== primary.h.cat &&
        +x.date >= minTs && +x.date <= maxTs
      ) || occs.find(x => x.h.id !== primary.h.id && +x.date >= minTs)
        || occs[0] || null;
    }

    const nextRefreshAt = at0001Tomorrow(norm);
    return { primary, companion, nextRefreshAt, occurrences: occs };
  }

  /* ============================ Rendering widgets ========================== */
  function renderInto(el, model){
    const { primary, nextRefreshAt } = model;
    const variant = (el.dataset.variant || 'chip').toLowerCase();
    const holiday = primary?.h; const date = primary?.date;
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

  /* ============================ Scenery handling =========================== */
  function ensureSceneryLayer(){
    if (!document.getElementById('holidayScenery')){
      const d = document.createElement('div');
      d.id = 'holidayScenery';
      d.className = 'holiday-scenery';
      document.body.appendChild(d);
    }
    return document.getElementById('holidayScenery');
  }
  function applySceneFromPair(pair){
    const node = ensureSceneryLayer(); if (!node) return;
    const primary = pair?.primary?.h || null;
    const companion = pair?.companion?.h || null;

    // Pick scenes by id first, then fallback to category
    const pickScene = (h) => {
      if (!h) return null;
      const id = (h.id||'').toLowerCase();
      const cat = (h.cat||'').toLowerCase();
      return SCENES[id] || CAT_SCENES[cat] || null;
    };

    const s1 = pickScene(primary);
    const s2 = pickScene(companion);

    const left  = s1?.left  || CAT_SCENES[(primary?.cat||'').toLowerCase()]?.left  || 'none';
    const right = s2?.right || CAT_SCENES[(companion?.cat||'').toLowerCase()]?.right || left;

    // tone + accent derive from primary
    const tone = primary?.meta?.tone || s1?.tone || 'celebration';
    const accent = s1?.accent || '#00e5ff';
    const opacity = tone === 'solemn' ? .26 : .35;

    node.style.setProperty('--scene-left', left);
    node.style.setProperty('--scene-right', right);
    node.style.setProperty('--scene-opacity', opacity);

    // page accent + tone tag (your CSS can react to these)
    document.documentElement.style.setProperty('--accent', accent);
    document.body.setAttribute('data-tone', tone);
  }

  /* =============================== Event bus =============================== */
  function dispatchHolidayChange(detail){
    window.dispatchEvent(new CustomEvent('holidaychange', { detail }));
  }

  /* ============================= Global scheduler ========================== */
  function parseCats(attr){
    if (!attr) return DEFAULT_CATS;
    return attr.split(',').map(s=>s.trim()).filter(Boolean);
  }

  function tick(){
    // 1) Compute the global pair from DEFAULT_CATS (inclusive, diverse)
    const model = computeModel({ categories: DEFAULT_CATS });

    // 2) Render every widget with its own category filter (if provided)
    document.querySelectorAll('[data-holiday-rotator]').forEach(el => {
      const categories = parseCats(el.dataset.cats);
      const localModel = computeModel({ categories });
      renderInto(el, localModel);
    });

    // 3) Apply global dual-scenery from the inclusive model
    applySceneFromPair(model);

    // 4) Notify listeners (keeps your custom hooks working)
    dispatchHolidayChange({
      holiday: model.primary?.h || null,          // backward-compat
      date:    model.primary?.date || null,
      companion: model.companion?.h || null,      // NEW: the right-side holiday
      companionDate: model.companion?.date || null,
      nextRefreshAt: model.nextRefreshAt,
      occurrences: model.occurrences
    });

    // 5) Schedule next daily refresh (00:01 local)
    const at = at0001Tomorrow(new Date());
    const ms = at - new Date();
    clearTimeout(tick._timer);
    tick._timer = setTimeout(tick, Math.max(1000, ms));
  }

  /* ================================ Public API ============================= */
  window.HolidayRotator = window.HolidayRotator || {
    ymd,
    get now(){ return computeModel({ categories: DEFAULT_CATS }); },
    onChange(cb){ window.addEventListener('holidaychange', (e)=>cb(e.detail)); }
  };

  /* ================================== Boot ================================= */
  if (document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', tick);
  } else {
    tick();
  }
})();
