/* XRBC compact home: presentation only; reuses original nodes, IDs and handlers. */
(() => {
  'use strict';
  const body = document.body;
  const main = document.querySelector('main.wrap');
  const market = document.getElementById('xrbc-market');
  const wallet = document.getElementById('wallet');
  const oldMenu = document.getElementById('menuDrop');
  if (!main || !market || !wallet || !oldMenu || body.classList.contains('xrbc-app-ready')) return;

  const make = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  };
  // Keep anchors for rollback: never replace, clone or serialize working controls.
  const undo = [];
  const created = [];
  const move = (node, destination) => {
    if (!node) return;
    const anchor = document.createComment('xrbc-original-position');
    node.before(anchor);
    undo.push(() => { anchor.replaceWith(node); });
    destination.append(node);
  };
  const edit = (node, attribute, value) => {
    const previous = node.getAttribute(attribute);
    undo.push(() => previous === null ? node.removeAttribute(attribute) : node.setAttribute(attribute, previous));
    node.setAttribute(attribute, value);
  };
  const resize = () => requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));

  try {
    const shell = make('div', 'xrbc-ui-pages');
    created.push(shell);
    main.prepend(shell);
    const views = new Map();
    const labels = {
      overview: 'Dashboard', history: 'History & exports', token: 'Token details',
      orderbook: 'Order book', safety: 'Safety & issuer', learn: 'Learn & links'
    };
    Object.entries(labels).forEach(([key, label]) => {
      const view = make('section', 'xrbc-ui-view');
      view.id = `xrbc-ui-${key}`;
      view.dataset.xrbcUiView = key;
      view.setAttribute('aria-label', label);
      view.tabIndex = -1;
      view.hidden = key !== 'overview';
      shell.append(view);
      views.set(key, view);
    });
    const disclose = (node, destination, title, open = false) => {
      if (!node) return null;
      const details = make('details', 'xrbc-ui-disclosure');
      const summary = make('summary', '', title);
      const content = make('div', 'xrbc-ui-disclosure-content');
      details.append(summary, content);
      details.open = open;
      destination.append(details);
      move(node, content);
      details.addEventListener('toggle', resize);
      return details;
    };

    move(market, views.get('overview'));
    const walletPanel = make('details', 'xrbc-ui-wallet-panel');
    walletPanel.append(make('summary', '', 'Wallet: connect, add XRBC, trade'));
    views.get('overview').append(walletPanel);
    const smallWallet = window.matchMedia('(max-width: 760px)');
    walletPanel.open = !smallWallet.matches;
    const adaptWallet = () => { walletPanel.open = !smallWallet.matches; };
    smallWallet.addEventListener('change', adaptWallet);
    undo.push(() => smallWallet.removeEventListener('change', adaptWallet));
    walletPanel.addEventListener('toggle', resize);
    move(wallet, walletPanel);
    move(document.getElementById('walletDebug'), views.get('overview'));
    const walletQr = wallet.querySelector('[data-qr]');
    if (walletQr) {
      const help = make('details', 'xrbc-ui-disclosure xrbc-ui-wallet-help');
      const helpContent = make('div', 'xrbc-ui-disclosure-content');
      help.append(make('summary', '', 'Wallet QR & connection help'), helpContent);
      wallet.append(help);
      created.push(help);
      move(wallet.querySelector('.wallet-note'), helpContent);
      move(walletQr, helpContent);
      const reveal = () => { walletPanel.open = true; help.open = true; };
      ['connectBtn', 'trustBtn'].forEach(id => {
        const button = document.getElementById(id);
        if (button) {
          button.addEventListener('click', reveal);
          undo.push(() => button.removeEventListener('click', reveal));
        }
      });
      const qrImage = document.getElementById('qrImage');
      const originalImage = qrImage && qrImage.getAttribute('src');
      const observer = new MutationObserver(() => {
        const canvas = document.getElementById('qrCanvas');
        const deepLink = document.getElementById('openInXaman');
        if ((canvas && !canvas.hidden && canvas.style.display !== 'none') ||
            (deepLink && !deepLink.hidden && deepLink.style.display !== 'none') ||
            (qrImage && qrImage.getAttribute('src') !== originalImage)) reveal();
      });
      observer.observe(walletQr, { subtree: true, attributes: true, attributeFilter: ['hidden', 'style', 'src'] });
      undo.push(() => observer.disconnect());
    }

    disclose(document.getElementById('metrics-audit-history'), views.get('history'), 'Market history & PDF export', true);
    disclose(document.getElementById('ledger-history'), views.get('history'), 'Ledger records, price history & downloads');
    move(document.getElementById('market-metrics'), views.get('token'));
    disclose(document.getElementById('market-sentiment'), views.get('token'), 'Wallet activity & sentiment');
    move(document.getElementById('orderbook-panel'), views.get('orderbook'));
    move(document.getElementById('issuer-meta'), views.get('safety'));
    disclose(main.querySelector('.hero-card'), views.get('learn'), 'About XRBitcoinCash', true);
    move(main.querySelector('.promo-grid'), views.get('learn'));
    move(market.querySelector('.micro-grid'), views.get('learn'));
    move(main.querySelector('[aria-labelledby="xrbc-amm-intel-title"]'), views.get('learn'));
    disclose(document.getElementById('download-section'), views.get('learn'), 'Download & install');
    disclose(document.getElementById('disclaimer'), views.get('learn'), 'Risks & important information');

    const statGrid = market.querySelector('.market-stat-grid');
    if (statGrid) {
      const cards = Array.from(statGrid.children);
      const extra = make('div', 'xrbc-ui-extra-stats');
      const important = ['xrbc-priceusd', 'xrbc-liq-usd', 'xrbc-xrpusd', 'xrbc-price-change'];
      cards.filter(card => !important.some(id => card.querySelector(`[id="${id}"]`)))
        .forEach(card => move(card, extra));
      if (extra.children.length) {
        const details = make('details', 'xrbc-ui-disclosure xrbc-ui-stat-details');
        details.append(make('summary', '', 'More market statistics'), extra);
        statGrid.after(details);
        created.push(details);
      }
    }
    const chart = market.querySelector('.chart-shell');
    if (chart) {
      const details = make('details', 'xrbc-ui-disclosure xrbc-ui-chart-details');
      const controls = make('div', 'xrbc-ui-disclosure-content');
      details.append(make('summary', '', 'Chart controls & downloads'), controls);
      chart.append(details);
      created.push(details);
      ['.chart-toolbar', '.chart-insights', '.chart-nav', '.chart-footer-actions',
        '.chart-mini', '.history-inline-facts', '.chart-legend'].forEach(selector => move(chart.querySelector(selector), controls));
      details.addEventListener('toggle', resize);
      const originalRanges = Array.from(chart.querySelectorAll('button[data-lookback]'));
      const chartHeader = chart.querySelector('.chart-header');
      if (originalRanges.length && chartHeader) {
        const label = make('label', 'xrbc-ui-range');
        label.append(make('span', '', 'Time range'));
        const select = make('select');
        select.id = 'xrbc-ui-range';
        originalRanges.forEach(button => {
          const option = make('option', '', button.textContent.trim());
          option.value = button.dataset.lookback;
          select.append(option);
        });
        const syncRange = () => {
          const active = originalRanges.find(button => button.getAttribute('aria-pressed') === 'true');
          if (active) select.value = active.dataset.lookback;
        };
        syncRange();
        select.addEventListener('change', () => {
          const original = originalRanges.find(button => button.dataset.lookback === select.value);
          if (original) original.click();
        });
        originalRanges.forEach(button => button.addEventListener('click', () => queueMicrotask(syncRange)));
        label.append(select);
        chartHeader.append(label);
        created.push(label);
      }
    }

    const sidebar = make('aside', 'xrbc-ui-sidebar');
    sidebar.id = 'xrbc-ui-sidebar';
    sidebar.setAttribute('aria-label', 'Main navigation');
    const brand = make('a', 'xrbc-ui-brand');
    brand.href = '#xrbc-ui-overview';
    const monogram = make('span', 'xrbc-ui-brand-mark', 'X');
    monogram.setAttribute('aria-hidden', 'true');
    const brandText = make('span', '', 'XRBitcoinCash');
    brandText.append(make('small', '', 'XRPL market & tools'));
    brand.append(monogram, brandText);
    sidebar.append(brand);
    const close = make('button', 'xrbc-ui-close', 'Close menu');
    close.type = 'button';
    sidebar.append(close);
    const navigation = make('nav', 'xrbc-ui-nav');
    navigation.setAttribute('aria-label', 'Workspace');
    const navLinks = [];
    const addLink = (label, href, key) => {
      const link = make('a', '', label);
      link.href = href;
      if (key) link.dataset.xrbcUiNav = key;
      navigation.append(link);
      navLinks.push(link);
    };
    addLink('Dashboard', '#xrbc-ui-overview', 'overview');
    addLink('Trade XRBC', '/live.html');
    addLink('Liquidity pools', '/pool.html');
    addLink('Wallet', '#wallet');
    navigation.append(make('span', 'xrbc-ui-nav-label', 'Explore'));
    Object.entries(labels).filter(([key]) => key !== 'overview')
      .forEach(([key, label]) => addLink(label, `#xrbc-ui-${key}`, key));
    sidebar.append(navigation);
    edit(oldMenu, 'class', oldMenu.className.split(/\s+/).filter(name => name !== 'sidebar').concat('xrbc-ui-more').join(' '));
    const menuSummary = oldMenu.querySelector(':scope > summary');
    if (menuSummary) {
      const previousNodes = Array.from(menuSummary.childNodes);
      undo.push(() => menuSummary.replaceChildren(...previousNodes));
      menuSummary.textContent = 'More links';
    }
    move(oldMenu, sidebar);
    const trustbar = document.querySelector('.top-trustbar');
    if (trustbar) move(trustbar, sidebar);
    body.prepend(sidebar);
    created.push(sidebar);
    const backdrop = make('button', 'xrbc-ui-backdrop');
    backdrop.type = 'button';
    backdrop.tabIndex = -1;
    backdrop.setAttribute('aria-label', 'Close navigation');
    backdrop.hidden = true;
    body.append(backdrop);
    created.push(backdrop);

    const heading = make('header', 'xrbc-ui-header');
    const toggle = make('button', 'xrbc-ui-toggle', 'Menu');
    toggle.type = 'button';
    toggle.setAttribute('aria-controls', sidebar.id);
    toggle.setAttribute('aria-expanded', 'false');
    const headingText = make('div', 'xrbc-ui-heading');
    const originalH1 = main.querySelector(':scope > h1');
    if (originalH1) move(originalH1, headingText);
    else headingText.append(make('h1', '', 'XRBitcoinCash'));
    const currentLabel = make('p', '', 'Dashboard');
    headingText.append(currentLabel);
    const walletLink = make('a', 'xrbc-ui-wallet-link', 'Your wallet');
    walletLink.href = '#wallet';
    heading.append(toggle, headingText, walletLink);
    main.prepend(heading);
    created.push(heading);

    const mobile = window.matchMedia('(max-width: 1099px)');
    let drawerOpen = false;
    let returnFocus = null;
    const setDrawer = (open, restoreFocus = false) => {
      drawerOpen = mobile.matches && open;
      body.classList.toggle('xrbc-ui-menu-open', drawerOpen);
      toggle.setAttribute('aria-expanded', String(drawerOpen));
      backdrop.hidden = !drawerOpen;
      main.inert = drawerOpen;
      sidebar.inert = mobile.matches && !drawerOpen;
      if (drawerOpen) {
        returnFocus = document.activeElement;
        close.focus();
      } else if (restoreFocus && returnFocus instanceof HTMLElement && returnFocus.isConnected) {
        returnFocus.focus();
      }
    };
    toggle.addEventListener('click', () => setDrawer(!drawerOpen, true));
    close.addEventListener('click', () => setDrawer(false, true));
    backdrop.addEventListener('click', () => setDrawer(false, true));
    mobile.addEventListener('change', () => setDrawer(false));
    document.addEventListener('keydown', event => {
      if (!drawerOpen) return;
      if (event.key === 'Escape') { event.preventDefault(); setDrawer(false, true); }
      if (event.key === 'Tab') {
        const focusable = Array.from(sidebar.querySelectorAll('a[href],button,summary,[tabindex="0"]'))
          .filter(node => !node.disabled && node.getClientRects().length);
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    });
    const activate = (target, focus) => {
      const view = target && target.closest('[data-xrbc-ui-view]');
      if (!view) return false;
      const key = view.dataset.xrbcUiView;
      views.forEach((node, name) => { node.hidden = name !== key; });
      navLinks.forEach(link => {
        if (link.dataset.xrbcUiNav === key) link.setAttribute('aria-current', 'page');
        else link.removeAttribute('aria-current');
      });
      currentLabel.textContent = labels[key];
      for (let node = target.parentElement; node && node !== view; node = node.parentElement) {
        if (node.tagName === 'DETAILS') node.open = true;
      }
      setDrawer(false);
      resize();
      if (focus) {
        if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
        target.focus({ preventScroll: true });
        target.scrollIntoView({ block: 'start', behavior: 'auto' });
      }
      return true;
    };
    const route = (focus = false) => {
      let id = '';
      try { id = decodeURIComponent(location.hash.slice(1)); } catch (_) { /* Invalid URL: default view. */ }
      const target = id ? document.getElementById(id) : views.get('overview');
      if (!activate(target, focus)) activate(views.get('overview'), false);
    };
    document.addEventListener('click', event => {
      const link = event.target instanceof Element ? event.target.closest('a[href]') : null;
      if (!link || event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      if (link.target && link.target !== '_self') return;
      const url = new URL(link.href, location.href);
      if (url.origin !== location.origin || url.pathname !== location.pathname || url.search !== location.search || !url.hash) return;
      let target;
      try { target = document.getElementById(decodeURIComponent(url.hash.slice(1))); } catch (_) { return; }
      if (!target || !target.closest('[data-xrbc-ui-view]')) return;
      event.preventDefault();
      if (location.hash !== url.hash) history.pushState(null, '', url.hash);
      activate(target, true);
    });
    window.addEventListener('hashchange', () => route(true));
    window.addEventListener('popstate', () => route(true));
    body.classList.add('xrbc-app-ready');
    setDrawer(false);
    route(Boolean(location.hash));
    resize();
  } catch (error) {
    // A missing/incompatible structure must leave the original homepage usable.
    for (let i = undo.length - 1; i >= 0; i -= 1) {
      try { undo[i](); } catch (_) { /* Continue restoring the other nodes. */ }
    }
    created.forEach(node => node.remove());
    body.classList.remove('xrbc-app-ready', 'xrbc-ui-menu-open');
    main.inert = false;
    console.error('XRBC compact layout could not initialize; original layout restored.', error);
  }
})();
