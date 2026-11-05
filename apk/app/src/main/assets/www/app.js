/* ==========================================================================
   Wflix klient – logika (TV webOS + Android)
   Bez frameworku, syntaxe bezpečná i pro starší Chromium v TV (žádné ?. ani ??).
   Komunikuje s backendem Wflixu: /api/search, /api/proxy, /api/stream,
   /api/live, /api/live/hls, /api/subtitles, /api/thumb, /api/catalog.
   ========================================================================== */
(function () {
  'use strict';

  var VERSION = '1.0.0';
  var LS_SERVER = 'wflix.server';
  var LS_SETTINGS = 'wflix.settings';

  var Native = window.WflixNative || null;
  var isTouch = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
  var isTV = !isTouch;

  /* ------------------------------------------------------------------ *
   *  Malé pomocníky
   * ------------------------------------------------------------------ */
  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function pad2(n) { return n < 10 ? '0' + n : String(n); }
  function fmtTime(sec) {
    if (!isFinite(sec) || sec < 0) sec = 0;
    var h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = Math.floor(sec % 60);
    return h > 0 ? h + ':' + pad2(m) + ':' + pad2(s) : m + ':' + pad2(s);
  }
  function show(el) { if (el) el.hidden = false; }
  function hide(el) { if (el) el.hidden = true; }

  var toastTimer = null;
  function toast(msg, ms) {
    var el = $('toast');
    el.textContent = msg;
    show(el);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { hide(el); }, ms || 2600);
  }
  function loading(text) {
    var el = $('loading');
    if (text === null) { hide(el); return; }
    $('loadingText').textContent = text || 'Načítám…';
    show(el);
  }

  /* ------------------------------------------------------------------ *
   *  Nastavení
   * ------------------------------------------------------------------ */
  var settings = {
    server: '',
    direct: true,      // přímé přehrávání z CDN (jako ve webovém Wflixu)
    lang: 'cz',        // jazyk katalogu
    live: 'cz'         // výchozí zdroj živého vysílání
  };

  function loadSettings() {
    try {
      var s = JSON.parse(localStorage.getItem(LS_SETTINGS) || '{}');
      if (s && typeof s === 'object') {
        if (typeof s.direct === 'boolean') settings.direct = s.direct;
        if (s.lang === 'en' || s.lang === 'cz') settings.lang = s.lang;
        if (typeof s.live === 'string') settings.live = s.live;
      }
    } catch (e) { /* poškozené úložiště – jedeme s výchozím */ }
    settings.server = localStorage.getItem(LS_SERVER) || '';
  }
  function saveSettings() {
    try {
      localStorage.setItem(LS_SETTINGS, JSON.stringify({
        direct: settings.direct, lang: settings.lang, live: settings.live
      }));
      localStorage.setItem(LS_SERVER, settings.server || '');
    } catch (e) { /* TV může mít úložiště vypnuté – jede se dál bez uložení */ }
  }

  function normalizeServer(v) {
    v = String(v || '').trim();
    if (!v) return '';
    if (!/^https?:\/\//i.test(v)) v = 'http://' + v;
    return v.replace(/\/+$/, '');
  }
  function url(path) { return settings.server ? settings.server + path : path; }

  /* ------------------------------------------------------------------ *
   *  API – s nativním mostem (Android) obejde CORS, jinak fetch
   * ------------------------------------------------------------------ */
  function nativeGet(path) {
    if (!Native || typeof Native.httpGet !== 'function') return null;
    var raw = Native.httpGet(url(path));
    if (raw === null || raw === undefined) throw new Error('Nativní požadavek selhal');
    raw = String(raw);
    if (raw.indexOf('__ERROR__:') === 0) throw new Error(raw.slice(10));
    return raw;
  }

  function apiJson(path, timeoutMs) {
    var to = timeoutMs || 25000;
    try {
      var body = nativeGet(path);
      if (body !== null) {
        try { return Promise.resolve(JSON.parse(body)); }
        catch (e) { return Promise.reject(new Error('Server nevrátil JSON')); }
      }
    } catch (e) {
      // most je jen zrychlení; když selže, zkusíme normální fetch
    }

    var ctrl = (typeof AbortController === 'function') ? new AbortController() : null;
    var timer = null;
    var opts = { headers: { 'Accept': 'application/json' }, cache: 'no-store' };
    if (ctrl) {
      opts.signal = ctrl.signal;
      timer = setTimeout(function () { ctrl.abort(); }, to);
    }
    var p = fetch(url(path), opts).then(function (r) {
      if (timer) clearTimeout(timer);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }).catch(function (e) {
      if (timer) clearTimeout(timer);
      if (e && e.name === 'AbortError') throw new Error('Server neodpovídá (timeout)');
      if (e && e.name === 'TypeError') throw new Error('Server neodpovídá – zkontroluj adresu a CORS na backendu');
      throw e;
    });
    return p;
  }

  function apiText(path) {
    var ctrl = (typeof AbortController === 'function') ? new AbortController() : null;
    var opts = {};
    if (ctrl) opts.signal = ctrl.signal;
    return fetch(url(path), opts).then(function (r) { return r.text(); });
  }

  function proxyQS() { return ''; }             // proxy servery řeší backend
  function thumbUrl(q) { return url('/api/thumb?q=' + encodeURIComponent(q || '')); }
  function streamUrl(page, download, name, cdn) {
    var u = '/api/stream?url=' + encodeURIComponent(page);
    if (cdn) u += '&v=' + encodeURIComponent(cdn);
    if (download) u += '&download=1&name=' + encodeURIComponent(name || 'video');
    return url(u);
  }
  function subtitleUrl(vtt) { return url('/api/subtitles?url=' + encodeURIComponent(vtt)); }

  /* ------------------------------------------------------------------ *
   *  Katalog pro úvodní stránku (fallback, když /api/catalog selže)
   * ------------------------------------------------------------------ */
  var FALLBACK = [
    { t: 'Matrix', q: 'Matrix', y: 1999, g: ['Sci-fi', 'Akční'], e: '🕶️' },
    { t: 'Interstellar', q: 'Interstellar', y: 2014, g: ['Sci-fi', 'Drama'], e: '🚀' },
    { t: 'Počátek', q: 'Počátek Inception', y: 2010, g: ['Sci-fi', 'Thriller'], e: '🌀' },
    { t: 'Duna', q: 'Duna 2021', y: 2021, g: ['Sci-fi'], e: '🏜️' },
    { t: 'Blade Runner 2049', q: 'Blade Runner 2049', y: 2017, g: ['Sci-fi'], e: '🌆' },
    { t: 'Temný rytíř', q: 'Temný rytíř', y: 2008, g: ['Akční', 'Thriller'], e: '🦇' },
    { t: 'Gladiátor', q: 'Gladiátor', y: 2000, g: ['Akční', 'Drama'], e: '⚔️' },
    { t: 'Top Gun: Maverick', q: 'Top Gun Maverick', y: 2022, g: ['Akční'], e: '✈️' },
    { t: 'John Wick', q: 'John Wick', y: 2014, g: ['Akční', 'Thriller'], e: '🔫' },
    { t: 'Vykoupení z věznice Shawshank', q: 'Vykoupení z věznice Shawshank', y: 1994, g: ['Drama'], e: '⛓️' },
    { t: 'Forrest Gump', q: 'Forrest Gump', y: 1994, g: ['Drama'], e: '🍫' },
    { t: 'Pulp Fiction', q: 'Pulp Fiction', y: 1994, g: ['Thriller', 'Drama'], e: '💼' },
    { t: 'Parazit', q: 'Parazit', y: 2019, g: ['Thriller', 'Drama'], e: '🏠' },
    { t: 'Oppenheimer', q: 'Oppenheimer', y: 2023, g: ['Drama'], e: '💥' },
    { t: 'Pán prstenů: Společenstvo Prstenu', q: 'Pán prstenů Společenstvo Prstenu', y: 2001, g: ['Fantasy', 'Akční'], e: '💍' },
    { t: 'Harry Potter a Kámen mudrců', q: 'Harry Potter a Kámen mudrců', y: 2001, g: ['Fantasy', 'Rodinné'], e: '⚡' },
    { t: 'Shrek', q: 'Shrek', y: 2001, g: ['Rodinné', 'Animované'], e: '👹' },
    { t: 'Toy Story', q: 'Toy Story', y: 1995, g: ['Rodinné', 'Animované'], e: '🤠' },
    { t: 'Lví král', q: 'Lví král', y: 1994, g: ['Rodinné', 'Animované'], e: '🦁' },
    { t: 'Ledové království', q: 'Ledové království', y: 2013, g: ['Rodinné', 'Animované'], e: '❄️' },
    { t: 'Pelíšky', q: 'Pelíšky', y: 1999, g: ['České', 'Komedie'], e: '🏡' },
    { t: 'Kolja', q: 'Kolja', y: 1996, g: ['České', 'Drama'], e: '🎻' },
    { t: 'Samotáři', q: 'Samotáři', y: 2000, g: ['České', 'Komedie'], e: '💑' },
    { t: 'Vesničko má středisková', q: 'Vesničko má středisková', y: 1985, g: ['České', 'Komedie'], e: '🌾' }
  ];
  var GENRE_ORDER = ['Sci-fi', 'Akční', 'Drama', 'Thriller', 'Fantasy', 'Rodinné', 'Animované', 'České', 'Komedie'];

  var state = {
    view: 'home',
    catalog: [],
    heroIndex: 0,
    query: '',
    results: [],
    channels: [],
    liveFilter: 'cz',
    liveFlags: { hd: false, noGeo: false, only24: false },
    detail: null
  };

  /* ------------------------------------------------------------------ *
   *  Fokus a navigace (TV dálkové ovládání)
   * ------------------------------------------------------------------ */
  function isVisible(el) {
    if (!el || el.hidden) return false;
    var r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return false;
    var cs = window.getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none' || cs.opacity === '0') return false;
    return true;
  }

  function activeScope() {
    var kbd = $('kbd'), pl = $('player'), det = $('detail');
    if (kbd && !kbd.hidden) return kbd;
    if (pl && !pl.hidden) return pl;
    if (det && !det.hidden) return det;
    return document;
  }

  function focusables() {
    var scope = activeScope();
    var nodes = scope.querySelectorAll('.f');
    var out = [];
    for (var i = 0; i < nodes.length; i++) {
      if (isVisible(nodes[i])) out.push(nodes[i]);
    }
    return out;
  }

  function focusEl(el) {
    if (!el) return;
    if (typeof el.focus === 'function') el.focus();
    if (el.scrollIntoView) {
      try {
        el.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
      } catch (e) {
        el.scrollIntoView(false);
      }
    }
  }

  function focusFirst() {
    var list = focusables();
    if (list.length) focusEl(list[0]);
  }

  function currentFocus() {
    var a = document.activeElement;
    if (a && a.classList && a.classList.contains('f')) return a;
    return null;
  }

  function moveFocus(dx, dy) {
    var list = focusables();
    if (!list.length) return false;
    var cur = currentFocus();
    if (!cur) { focusEl(list[0]); return true; }
    var cr = cur.getBoundingClientRect();
    var cx = cr.left + cr.width / 2, cy = cr.top + cr.height / 2;
    var best = null, bestScore = Infinity;
    for (var i = 0; i < list.length; i++) {
      var el = list[i];
      if (el === cur) continue;
      var r = el.getBoundingClientRect();
      var x = r.left + r.width / 2, y = r.top + r.height / 2;
      var along, across;
      if (dx !== 0) {
        along = (x - cx) * dx;
        across = Math.abs(y - cy);
      } else {
        along = (y - cy) * dy;
        across = Math.abs(x - cx);
      }
      if (along <= 4) continue;                       // opačným směrem
      var score = along + across * 1.9;
      if (score < bestScore) { bestScore = score; best = el; }
    }
    if (!best) return false;
    focusEl(best);
    return true;
  }

  /* ------------------------------------------------------------------ *
   *  Obrazovková klávesnice (TV)
   * ------------------------------------------------------------------ */
  var kbdState = { value: '', title: '', onDone: null, onCancel: null };
  var KBD_ROWS = [
    ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '-', '.'],
    ['q', 'w', 'e', 'r', 't', 'z', 'u', 'i', 'o', 'p', '/', ':'],
    ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l', '@'],
    ['y', 'x', 'c', 'v', 'b', 'n', 'm', '_', ' '],
    ['ě', 'š', 'č', 'ř', 'ž', 'ý', 'á', 'í', 'é', 'ú', 'ů', '!'],
    ['?', '&', '=', '+', '%', '#', '(', ')', '*']
  ];

  function openKeyboard(opts) {
    if (isTouch) {                                   // na mobilu ať to udělá systém
      var input = window.prompt(opts.title || 'Zadej text', opts.value || '');
      if (input === null) { if (opts.onCancel) opts.onCancel(); return; }
      if (opts.onDone) opts.onDone(String(input));
      return;
    }
    kbdState = {
      value: String(opts.value || ''),
      title: opts.title || 'Zadej text',
      onDone: opts.onDone || null,
      onCancel: opts.onCancel || null
    };
    $('kbdTitle').textContent = kbdState.title;
    renderKeyboard();
    show($('kbd'));
    var keys = $('kbdKeys').querySelectorAll('.f');
    if (keys.length) focusEl(keys[0]);
  }

  function renderKeyboard() {
    $('kbdValue').innerHTML = esc(kbdState.value) + '<span class="caret"></span>';
    var html = '';
    for (var r = 0; r < KBD_ROWS.length; r++) {
      html += '<div class="kbd-row">';
      for (var c = 0; c < KBD_ROWS[r].length; c++) {
        var ch = KBD_ROWS[r][c];
        var label = ch === ' ' ? 'mezera' : ch;
        html += '<button class="key f' + (ch === ' ' ? ' wide' : '') + '" type="button" data-k="' + esc(ch) + '">' + esc(label) + '</button>';
      }
      html += '</div>';
    }
    html += '<div class="kbd-row">'
      + '<button class="key wide f" type="button" data-k="__back">⌫ smazat</button>'
      + '<button class="key wide f" type="button" data-k="__clear">vymazat</button>'
      + '<button class="key wide gold f" type="button" data-k="__ok">Hotovo</button>'
      + '<button class="key wide f" type="button" data-k="__cancel">Zpět</button>'
      + '</div>';
    $('kbdKeys').innerHTML = html;
  }

  function kbdPress(k) {
    if (k === '__back') kbdState.value = kbdState.value.slice(0, -1);
    else if (k === '__clear') kbdState.value = '';
    else if (k === '__ok') {
      var v = kbdState.value, cb = kbdState.onDone;
      hide($('kbd'));
      if (cb) cb(v);
      return;
    } else if (k === '__cancel') {
      var c = kbdState.onCancel;
      hide($('kbd'));
      if (c) c();
      return;
    } else {
      kbdState.value += k;
    }
    renderKeyboard();
    var btns = $('kbdKeys').querySelectorAll('[data-k="' + (k === '__back' || k === '__clear' ? k : k) + '"]');
    if (btns.length) focusEl(btns[0]);
    else focusFirst();
  }

  document.addEventListener('click', function (e) {
    var t = e.target;
    if (t && t.getAttribute && t.getAttribute('data-k') !== null) {
      kbdPress(t.getAttribute('data-k'));
    }
  });

  /* ------------------------------------------------------------------ *
   *  Pohledy
   * ------------------------------------------------------------------ */
  function setView(name) {
    state.view = name;
    var views = document.querySelectorAll('.view');
    for (var i = 0; i < views.length; i++) views[i].classList.remove('active');
    var v = $('view-' + name);
    if (v) v.classList.add('active');
    var navs = document.querySelectorAll('.navbtn');
    for (var j = 0; j < navs.length; j++) {
      navs[j].classList.toggle('active', navs[j].getAttribute('data-nav') === name);
    }
    $('main').scrollTop = 0;
    if (name === 'live' && !state.channels.length) loadLive();
    if (name === 'search' && isTouch) setTimeout(function () { $('searchInput').focus(); }, 60);
  }

  /* ------------------------------------------------------------------ *
   *  Úvodní stránka – katalog, hero, řady
   * ------------------------------------------------------------------ */
  function itemTitle(it) { return it.t || it.title || ''; }
  function itemQuery(it) { return it.q || it.query || itemTitle(it); }
  function itemYear(it) { return it.y || it.year || ''; }
  function itemGenres(it) { return it.g || it.genres || []; }
  function itemImg(it) { return it.img || it.poster || ''; }
  function itemEmoji(it) { return it.e || '🎬'; }

  function renderHero() {
    var list = state.catalog;
    if (!list.length) { $('hero').innerHTML = ''; return; }
    var it = list[state.heroIndex % list.length];
    var g = itemGenres(it);
    var img = itemImg(it);
    var bg = img ? 'style="background-image:url(' + "'" + esc(img) + "'" + ')"' : '';
    var html = ''
      + '<div class="hero-art" ' + bg + '></div>'
      + '<div class="hero-scrim"></div>'
      + (img ? '<div class="hero-poster"><img src="' + esc(img) + '" alt=""></div>' : '')
      + '<div class="hero-inner">'
      + '  <div class="hero-kicker">'
      + '    <span class="pill gold">Katalog</span>'
      + (itemYear(it) ? '<span class="pill">' + esc(itemYear(it)) + '</span>' : '')
      + (g.length ? '<span class="pill ghost">' + esc(g.join(' · ')) + '</span>' : '')
      + '  </div>'
      + '  <h1>' + esc(itemTitle(it)) + '</h1>'
      + '  <div class="hero-meta">'
      + '    <span class="pill">Wflix</span>'
      + '    <span class="pill ghost">prehraj.to</span>'
      + '  </div>'
      + '  <p class="hero-desc">Po spuštění klient vyhledá dostupné verze na prehraj.to a přehraje tu nejlepší. '
      + 'Když přímé přehrávání z CDN selže, pokračuje přes server.</p>'
      + '  <div class="hero-actions">'
      + '    <button class="f btn primary" type="button" data-hero="play">▶ Přehrát</button>'
      + '    <button class="f btn ghost" type="button" data-hero="info">Více info</button>'
      + '  </div>'
      + '</div>';
    $('hero').innerHTML = html;
    var play = $('hero').querySelector('[data-hero="play"]');
    var info = $('hero').querySelector('[data-hero="info"]');
    if (play) play.addEventListener('click', function () { playCatalogItem(it); });
    if (info) info.addEventListener('click', function () { openCatalogDetail(it); });
  }

  function cardHtml(it, idx, extra) {
    var img = itemImg(it);
    var art = img
      ? '<img src="' + esc(img) + '" alt="" loading="lazy" onerror="this.style.display=\'none\';this.parentNode.querySelector(\'.ph\').style.display=\'grid\'">'
      : '';
    var ph = '<div class="ph"' + (img ? ' style="display:none"' : '') + '>' + esc(itemEmoji(it)) + '</div>';
    var year = itemYear(it);
    var badge = extra || (year ? String(year).slice(0, 4) : '');
    return '<button class="f card' + (extra === 'wide' ? ' wide' : '') + '" type="button" data-idx="' + idx + '">'
      + (badge && badge !== 'wide' ? '<span class="badge">' + esc(badge) + '</span>' : '')
      + '<span class="art">' + art + ph + '</span>'
      + '<span class="grad"></span>'
      + '<span class="meta-block"><span class="t">' + esc(itemTitle(it)) + '</span>'
      + (year ? '<span class="y">' + esc(year) + '</span>' : '') + '</span>'
      + '</button>';
  }

  function renderRows() {
    var cat = state.catalog;
    var rows = [];
    rows.push({ name: 'Doporučujeme', items: cat.slice(0, 16) });
    for (var i = 0; i < GENRE_ORDER.length; i++) {
      var g = GENRE_ORDER[i];
      var items = cat.filter(function (it) {
        return itemGenres(it).indexOf(g) !== -1;
      });
      if (items.length >= 3) rows.push({ name: g, items: items });
    }
    var html = '';
    for (var r = 0; r < rows.length; r++) {
      html += '<section class="row"><div class="row-head"><h2 class="row-title">' + esc(rows[r].name)
        + '</h2><span class="row-sub">' + rows[r].items.length + '</span></div>'
        + '<div class="row-scroll" data-row="' + r + '">';
      for (var k = 0; k < rows[r].items.length; k++) {
        html += cardHtml(rows[r].items[k], r + ':' + k);
      }
      html += '</div></section>';
    }
    $('rows').innerHTML = html;

    // klikání na karty
    var cards = $('rows').querySelectorAll('.card');
    for (var c = 0; c < cards.length; c++) {
      (function (el) {
        el.addEventListener('click', function () {
          var parts = el.getAttribute('data-idx').split(':');
          var row = rows[parseInt(parts[0], 10)];
          if (!row) return;
          var it = row.items[parseInt(parts[1], 10)];
          if (it) openCatalogDetail(it);
        });
      })(cards[c]);
    }
  }

  function loadHome() {
    loading('Načítám katalog…');
    return apiJson('/api/catalog?lang=' + settings.lang).then(function (d) {
      if (d && d.success && d.items && d.items.length) {
        state.catalog = d.items.concat(FALLBACK.filter(function (m) {
          return itemGenres(m).indexOf('České') !== -1;
        }));
      } else {
        state.catalog = FALLBACK.slice();
      }
    }).catch(function () {
      state.catalog = FALLBACK.slice();
    }).then(function () {
      loading(null);
      state.heroIndex = Math.floor(Date.now() / 3600000) % Math.max(1, state.catalog.length);
      renderHero();
      renderRows();
      if (state.view === 'home' && !currentFocus()) {
        var b = $('hero').querySelector('.btn.primary');
        if (b) focusEl(b);
      }
    });
  }

  /* ------------------------------------------------------------------ *
   *  Hledání
   * ------------------------------------------------------------------ */
  function rankMovies(q, movies) {
    var needle = String(q || '').toLowerCase();
    function score(m) {
      var t = String(m.title || '').toLowerCase();
      if (t === needle) return 0;
      if (t.indexOf(needle) === 0) return 1;
      if (t.indexOf(needle) !== -1) return 2;
      return 3;
    }
    return movies.slice().sort(function (a, b) { return score(a) - score(b); });
  }

  function doSearch(q) {
    q = String(q || '').trim();
    if (!q) { toast('Zadej název filmu nebo seriálu.'); return Promise.resolve(); }
    state.query = q;
    $('searchInput').value = q;
    $('searchGrid').innerHTML = '';
    var st = $('searchState');
    st.className = 'state show';
    st.textContent = 'Hledám „' + q + '“ …';
    loading('Hledám „' + q + '“ …');
    return apiJson('/api/search?q=' + encodeURIComponent(q)).then(function (d) {
      loading(null);
      if (!d) { st.className = 'state show err'; st.textContent = 'Server nevrátil platnou odpověď.'; return; }
      if (!d.success) { st.className = 'state show err'; st.textContent = d.error || 'Chyba při vyhledávání.'; return; }
      var movies = d.movies || [];
      if (!movies.length) {
        st.className = 'state show';
        st.textContent = 'Nic jsme nenašli pro „' + q + '“. Zkus jiný název nebo jiný pravopis.';
        return;
      }
      state.results = rankMovies(q, movies);
      st.className = 'state show';
      st.textContent = 'Nalezeno ' + state.results.length + ' výsledků pro „' + q + '“';
      renderResults();
    }).catch(function (e) {
      loading(null);
      st.className = 'state show err';
      st.textContent = 'Chyba: ' + e.message;
    });
  }

  function renderResults() {
    var grid = $('searchGrid');
    var html = '';
    for (var i = 0; i < state.results.length; i++) {
      var m = state.results[i];
      var img = m.thumbnail || thumbUrl(m.title);
      html += '<button class="f card" type="button" data-idx="' + i + '">'
        + (m.year ? '<span class="badge">' + esc(String(m.year).slice(0, 4)) + '</span>' : '')
        + '<span class="art"><img src="' + esc(img) + '" alt="" loading="lazy" referrerpolicy="no-referrer"'
        + ' onerror="this.onerror=null;this.src=\'' + esc(thumbUrl(m.title)) + '\'"><div class="ph" style="display:none">🎬</div></span>'
        + '<span class="grad"></span>'
        + '<span class="meta-block"><span class="t">' + esc(m.title) + '</span>'
        + (m.year ? '<span class="y">' + esc(m.year) + '</span>' : '') + '</span>'
        + '</button>';
    }
    grid.innerHTML = html;
    var cards = grid.querySelectorAll('.card');
    for (var c = 0; c < cards.length; c++) {
      (function (el) {
        el.addEventListener('click', function () {
          var m = state.results[parseInt(el.getAttribute('data-idx'), 10)];
          if (m) openMovieDetail(m);
        });
      })(cards[c]);
    }
  }

  /* ------------------------------------------------------------------ *
   *  Detail
   * ------------------------------------------------------------------ */
  function closeDetail() {
    hide($('detail'));
    state.detail = null;
  }

  function openCatalogDetail(it) {
    state.detail = { kind: 'catalog', item: it };
    var img = itemImg(it) || thumbUrl(itemTitle(it));
    $('detailBg').style.backgroundImage = 'url("' + img + '")';
    $('detailPoster').src = img;
    $('detailPoster').style.visibility = 'visible';
    $('detailTitle').textContent = itemTitle(it);
    var g = itemGenres(it);
    $('detailMeta').innerHTML = (itemYear(it) ? '<span class="pill">' + esc(itemYear(it)) + '</span>' : '')
      + (g.length ? '<span class="pill ghost">' + esc(g.join(' · ')) + '</span>' : '')
      + '<span class="pill">prehraj.to</span>';
    $('detailNote').textContent = 'Klient vyhledá dostupné verze na prehraj.to a nabídne je k přehrání. '
      + 'Titulky se načtou automaticky, pokud je zdroj má.';
    hide($('detailDl'));
    bindDetailActions(function () { searchThenPlay(itemQuery(it)); });
    show($('detail'));
    focusEl($('detailPlay'));
  }

  function openMovieDetail(m) {
    state.detail = { kind: 'movie', movie: m };
    var img = m.thumbnail || thumbUrl(m.title);
    $('detailBg').style.backgroundImage = 'url("' + img + '")';
    $('detailPoster').src = img;
    $('detailPoster').style.visibility = 'visible';
    $('detailTitle').textContent = m.title || 'Video';
    $('detailMeta').innerHTML = (m.year ? '<span class="pill">' + esc(m.year) + '</span>' : '')
      + '<span class="pill gold">prehraj.to</span>';
    $('detailNote').textContent = 'Přehrání jde nejdřív přímo z CDN. Když odkaz vyprší nebo CDN neodpovídá, '
      + 'klient pokračuje přes server, takže se přehrávání nezasekne.';
    if (Native && typeof Native.download === 'function') {
      show($('detailDl'));
    } else {
      hide($('detailDl'));
    }
    bindDetailActions(function () { playMovie(m); });
    show($('detail'));
    focusEl($('detailPlay'));
  }

  function bindDetailActions(onPlay) {
    var play = $('detailPlay'), dl = $('detailDl'), close = $('detailClose');
    var fresh = play.cloneNode(true);
    play.parentNode.replaceChild(fresh, play);
    fresh.addEventListener('click', function () { onPlay(); });
    fresh.id = 'detailPlay';
    var freshClose = close.cloneNode(true);
    close.parentNode.replaceChild(freshClose, close);
    freshClose.addEventListener('click', function () { closeDetail(); focusAfterOverlay(); });
    freshClose.id = 'detailClose';
    if (Native && typeof Native.download === 'function') {
      var freshDl = dl.cloneNode(true);
      dl.parentNode.replaceChild(freshDl, dl);
      freshDl.id = 'detailDl';
      freshDl.addEventListener('click', function () {
        if (!state.detail || state.detail.kind !== 'movie') return;
        var m = state.detail.movie;
        Native.download(streamUrl(m.url, true, m.title), (m.title || 'video') + '.mp4');
      });
    }
  }

  function focusAfterOverlay() {
    var list = focusables();
    if (list.length) focusEl(list[0]);
  }

  /* Z katalogu: najdi film a otevři detail prvního rozumného výsledku */
  function searchThenPlay(q) {
    loading('Hledám „' + q + '“ …');
    apiJson('/api/search?q=' + encodeURIComponent(q)).then(function (d) {
      loading(null);
      if (!d || !d.success || !(d.movies || []).length) {
        toast('Pro „' + q + '“ prehraj.to nic nenašel.');
        return;
      }
      var ranked = rankMovies(q, d.movies);
      state.results = ranked;
      setView('search');
      $('searchInput').value = q;
      $('searchState').className = 'state show';
      $('searchState').textContent = 'Nalezeno ' + ranked.length + ' výsledků pro „' + q + '“';
      renderResults();
      openMovieDetail(ranked[0]);
    }).catch(function (e) {
      loading(null);
      toast('Chyba: ' + e.message, 4000);
    });
  }

  function playCatalogItem(it) {
    searchThenPlay(itemQuery(it));
  }

  /* ------------------------------------------------------------------ *
   *  Živé vysílání
   * ------------------------------------------------------------------ */
  var LIVE_SOURCES = [
    { id: 'cz', label: 'Česko', q: 'country=cz' },
    { id: 'ces', label: 'Čeština', q: 'lang=ces' },
    { id: 'sk', label: 'Slovensko', q: 'country=sk' },
    { id: 'us', label: 'USA', q: 'country=us' },
    { id: 'uk', label: 'VB', q: 'country=uk' }
  ];

  function renderLiveChips() {
    var html = '';
    for (var i = 0; i < LIVE_SOURCES.length; i++) {
      var s = LIVE_SOURCES[i];
      html += '<button class="f chip' + (state.liveFilter === s.id ? ' active' : '') + '" type="button" data-live-src="' + s.id + '">' + esc(s.label) + '</button>';
    }
    html += '<span style="width:1px;background:rgba(255,255,255,.12);margin:0 .4rem"></span>';
    html += '<button class="f chip' + (state.liveFlags.hd ? ' active' : '') + '" type="button" data-live-flag="hd">1080p</button>';
    html += '<button class="f chip' + (state.liveFlags.noGeo ? ' active' : '') + '" type="button" data-live-flag="noGeo">Bez geo bloku</button>';
    html += '<button class="f chip' + (state.liveFlags.only24 ? ' active' : '') + '" type="button" data-live-flag="only24">Jen 24/7</button>';
    var box = $('liveChips');
    box.innerHTML = html;
    var srcs = box.querySelectorAll('[data-live-src]');
    for (var a = 0; a < srcs.length; a++) {
      (function (el) {
        el.addEventListener('click', function () {
          var id = el.getAttribute('data-live-src');
          if (state.liveFilter === id) return;
          state.liveFilter = id;
          settings.live = id;
          saveSettings();
          state.channels = [];
          renderLiveChips();
          loadLive();
        });
      })(srcs[a]);
    }
    var flags = box.querySelectorAll('[data-live-flag]');
    for (var b = 0; b < flags.length; b++) {
      (function (el) {
        el.addEventListener('click', function () {
          var f = el.getAttribute('data-live-flag');
          state.liveFlags[f] = !state.liveFlags[f];
          renderLiveChips();
          renderChannels();
        });
      })(flags[b]);
    }
  }

  function sourceQuery(id) {
    for (var i = 0; i < LIVE_SOURCES.length; i++) if (LIVE_SOURCES[i].id === id) return LIVE_SOURCES[i].q;
    return 'country=cz';
  }

  function loadLive() {
    var st = $('liveState');
    st.className = 'state show';
    st.textContent = 'Načítám kanály…';
    loading('Načítám kanály…');
    return apiJson('/api/live?' + sourceQuery(state.liveFilter), 35000).then(function (d) {
      loading(null);
      if (!d || !d.success) throw new Error((d && d.error) || 'Seznam kanálů se nepodařilo načíst');
      state.channels = d.channels || [];
      if (!state.channels.length) throw new Error('Seznam je prázdný');
      renderChannels();
    }).catch(function (e) {
      loading(null);
      state.channels = [];
      st.className = 'state show err';
      st.textContent = e.message + ' – zkontroluj adresu serveru a jestli backend /api/live povoluje CORS.';
      $('liveGrid').innerHTML = '';
    });
  }

  function renderChannels() {
    var st = $('liveState');
    var items = state.channels.filter(function (c) {
      var tags = c.tags || [];
      if (state.liveFlags.hd && !(c.quality === '1080p' || c.quality === '4k')) return false;
      if (state.liveFlags.noGeo && tags.indexOf('geo') !== -1) return false;
      if (state.liveFlags.only24 && tags.indexOf('not24') !== -1) return false;
      return true;
    });
    st.className = 'state' + (items.length ? '' : ' show');
    st.textContent = items.length ? '' : 'Takový kanál tu není. Zkus jiný zdroj nebo jiné filtry.';
    var html = '';
    for (var i = 0; i < items.length; i++) {
      var c = items[i];
      var idx = state.channels.indexOf(c);
      var tags = c.tags || [];
      var initials = String(c.name || '?').split(/\s+/).slice(0, 2).map(function (w) { return w.charAt(0); }).join('').toUpperCase();
      html += '<button class="f ch" type="button" data-ch="' + idx + '">'
        + '<span class="logo">' + (c.logo
          ? '<img src="' + esc(c.logo) + '" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.parentNode.innerHTML=\'<span class=&quot;init&quot;>' + esc(initials) + '</span>\'">'
          : '<span class="init">' + esc(initials) + '</span>') + '</span>'
        + '<span class="name">' + esc(c.name) + '</span>'
        + '<span class="badges">'
        + (c.quality ? '<span class="b q">' + esc(c.quality) + '</span>' : '')
        + (tags.indexOf('geo') !== -1 ? '<span class="b geo">geo blok</span>' : '')
        + (tags.indexOf('not24') !== -1 ? '<span class="b">ne 24/7</span>' : '')
        + '</span>'
        + '</button>';
    }
    var grid = $('liveGrid');
    grid.innerHTML = html;
    var cards = grid.querySelectorAll('.ch');
    for (var k = 0; k < cards.length; k++) {
      (function (el) {
        el.addEventListener('click', function () {
          var ch = state.channels[parseInt(el.getAttribute('data-ch'), 10)];
          if (ch) playLive(ch);
        });
      })(cards[k]);
    }
  }

  /* ------------------------------------------------------------------ *
   *  Přehrávač
   * ------------------------------------------------------------------ */
  var player = {
    kind: 'movie',        // 'movie' | 'live'
    page: '', cdn: '', title: '', poster: '',
    mode: 'direct',       // 'direct' | 'relay'
    hls: null,
    subs: [], subIndex: -1,
    triedRelay: false,
    idleTimer: null
  };

  var video = $('video');

  function setPlayerState(msg) {
    var el = $('pState');
    if (!msg) { hide(el); return; }
    el.textContent = msg;
    show(el);
  }

  function destroyHls() {
    if (player.hls) {
      try { player.hls.destroy(); } catch (e) { }
      player.hls = null;
    }
  }

  function resetVideo() {
    destroyHls();
    try { video.pause(); } catch (e) { }
    video.removeAttribute('src');
    try { video.load(); } catch (e) { }
    var tracks = video.querySelectorAll('track');
    for (var i = 0; i < tracks.length; i++) tracks[i].parentNode.removeChild(tracks[i]);
    player.subs = [];
    player.subIndex = -1;
    $('pSub').textContent = 'Titulky';
  }

  function openPlayer(kind, title) {
    player.kind = kind;
    player.title = title || '';
    player.mode = settings.direct ? 'direct' : 'relay';
    player.triedRelay = false;
    $('pTitle').textContent = title || '';
    $('pLive').hidden = kind !== 'live';
    $('pBar').style.display = kind === 'live' ? 'none' : '';
    $('pTime').style.display = kind === 'live' ? 'none' : '';
    $('pSub').style.display = kind === 'live' ? 'none' : '';
    $('pPlay').textContent = 'Pozastavit';
    $('pRelay').textContent = (settings.direct && kind === 'movie') ? 'Přes server' : 'Znovu načíst';
    setPlayerState(null);
    show($('player'));
    $('player').classList.remove('idle');
    bumpIdle();
    if (Native) {
      if (typeof Native.setFullscreen === 'function') Native.setFullscreen(true);
      if (typeof Native.setKeepScreenOn === 'function') Native.setKeepScreenOn(true);
    }
    focusEl($('pBack'));
  }

  function closePlayer() {
    var t = video.currentTime;
    resetVideo();
    if (Native) {
      if (typeof Native.setFullscreen === 'function') Native.setFullscreen(false);
      if (typeof Native.setKeepScreenOn === 'function') Native.setKeepScreenOn(false);
    }
    hide($('player'));
    $('player').classList.remove('idle');
    clearTimeout(player.idleTimer);
    player.page = '';
    return t;
  }

  function bumpIdle() {
    var p = $('player');
    p.classList.remove('idle');
    clearTimeout(player.idleTimer);
    player.idleTimer = setTimeout(function () {
      if (!p.hidden && !video.paused) p.classList.add('idle');
    }, 5000);
  }

  function attachSource(src, isHls, opts) {
    opts = opts || {};
    destroyHls();
    setPlayerState(null);
    if (isHls && window.Hls && window.Hls.isSupported()) {
      var hls = new window.Hls({
        lowLatencyMode: false,
        enableWorker: true,
        maxBufferLength: 30,
        manifestLoadingTimeOut: 15000
      });
      player.hls = hls;
      hls.on(window.Hls.Events.ERROR, function (evt, data) {
        if (!data || !data.fatal) return;
        if (opts.onFatal) opts.onFatal(data);
      });
      hls.loadSource(src);
      hls.attachMedia(video);
      hls.on(window.Hls.Events.MANIFEST_PARSED, function () {
        play();
      });
      return;
    }
    // nativní HLS (Safari/iOS) i běžné mp4
    video.src = src;
    play();
  }

  function play() {
    var p = video.play();
    if (p && typeof p.catch === 'function') {
      p.catch(function () { setPlayerState('Připraveno. Stiskni Přehrát.'); });
    }
  }

  function updateProgress() {
    if (player.kind === 'live') return;
    var d = video.duration;
    var t = video.currentTime;
    var pct = (isFinite(d) && d > 0) ? (t / d * 100) : 0;
    $('pProg').style.width = pct + '%';
    $('pKnob').style.left = pct + '%';
    try {
      if (video.buffered && video.buffered.length) {
        var end = video.buffered.end(video.buffered.length - 1);
        $('pBuf').style.width = (isFinite(d) && d > 0 ? end / d * 100 : 0) + '%';
      }
    } catch (e) { }
    $('pTime').textContent = fmtTime(t) + ' / ' + (isFinite(d) ? fmtTime(d) : '—');
  }

  function seekBy(sec) {
    if (player.kind === 'live') return;
    var d = video.duration;
    if (!isFinite(d) || d <= 0) return;
    video.currentTime = Math.min(d - 0.3, Math.max(0, video.currentTime + sec));
    updateProgress();
    bumpIdle();
  }

  function seekFraction(f) {
    if (player.kind === 'live') return;
    var d = video.duration;
    if (!isFinite(d) || d <= 0) return;
    video.currentTime = Math.max(0, Math.min(d - 0.3, d * f));
    updateProgress();
    bumpIdle();
  }

  video.addEventListener('timeupdate', updateProgress);
  video.addEventListener('progress', updateProgress);
  video.addEventListener('durationchange', updateProgress);
  video.addEventListener('play', function () { $('pPlay').textContent = 'Pozastavit'; bumpIdle(); });
  video.addEventListener('pause', function () { $('pPlay').textContent = 'Přehrát'; $('player').classList.remove('idle'); });
  video.addEventListener('waiting', function () { setPlayerState('Načítám stream…'); });
  video.addEventListener('playing', function () { setPlayerState(null); bumpIdle(); });
  video.addEventListener('ended', function () {
    var d = video.duration;
    var finished = isFinite(d) && d > 0 && video.currentTime >= d - 1.5;
    if (finished) {
      // Film dohrál do konce – není to chyba CDN, nic nepřepínáme.
      $('player').classList.remove('idle');
      setPlayerState('Přehráno. Zpět nebo Enter spustí znovu.');
      $('pPlay').textContent = 'Přehrát znovu';
      return;
    }
    if (player.kind === 'movie' && !player.triedRelay && player.page) {
      switchToRelay(video.currentTime);   // utržený stream před koncem = vypršelý odkaz
    }
  });
  video.addEventListener('error', function () {
    if (player.kind === 'movie' && player.page && !player.triedRelay) {
      switchToRelay(video.currentTime);
      return;
    }
    if (player.kind === 'live' && player.page && !player.triedRelay) {
      switchToRelay(0);
      return;
    }
    setPlayerState('Přehrání selhalo. Zkus jiný zdroj nebo server přes /api/stream.');
  });

  // Klik/tap do obrazu (ne na ovládací prvky) přehraje nebo pozastaví.
  $('player').addEventListener('click', function (e) {
    if (e.target === $('player') || e.target === video) {
      if (video.paused) play(); else video.pause();
      bumpIdle();
    }
  });

  $('pPlay').addEventListener('click', function () {
    if (video.ended) { video.currentTime = 0; }
    if (video.paused) play(); else video.pause();
    bumpIdle();
  });
  $('pBack').addEventListener('click', function () { closePlayer(); focusAfterOverlay(); });
  $('pRelay').addEventListener('click', function () { switchToRelay(video.currentTime); });

  $('pBar').addEventListener('click', function (e) {
    var r = $('pBar').getBoundingClientRect();
    var f = (e.clientX - r.left) / r.width;
    seekFraction(Math.max(0, Math.min(1, f)));
  });
  $('pBar').addEventListener('pointerdown', function (e) {
    var r = $('pBar').getBoundingClientRect();
    var f = (e.clientX - r.left) / r.width;
    seekFraction(Math.max(0, Math.min(1, f)));
  });

  /* --- titulky --- */
  function setSubtitles(subs) {
    player.subs = subs || [];
    player.subIndex = -1;
    var old = video.querySelectorAll('track');
    for (var i = 0; i < old.length; i++) old[i].parentNode.removeChild(old[i]);
    for (var j = 0; j < player.subs.length; j++) {
      var s = player.subs[j];
      var tr = document.createElement('track');
      tr.kind = 'subtitles';
      tr.label = s.label || s.lang || ('Titulky ' + (j + 1));
      tr.srclang = (s.lang || 'cs').slice(0, 2);
      tr.src = subtitleUrl(s.url);
      if (j === 0) tr.default = false;
      video.appendChild(tr);
    }
    $('pSub').textContent = player.subs.length ? 'Titulky' : 'Bez titulků';
    $('pSub').disabled = !player.subs.length;
  }

  function cycleSubtitles() {
    if (!player.subs.length) { toast('Tento film titulky nemá.'); return; }
    var tracks = video.textTracks;
    player.subIndex = player.subIndex + 1;
    if (player.subIndex >= player.subs.length) player.subIndex = -1;
    for (var i = 0; i < tracks.length; i++) {
      tracks[i].mode = (i === player.subIndex) ? 'showing' : 'disabled';
    }
    $('pSub').textContent = player.subIndex === -1
      ? 'Titulky'
      : 'Titulky: ' + (player.subs[player.subIndex].label || player.subs[player.subIndex].lang || (player.subIndex + 1));
    toast(player.subIndex === -1 ? 'Titulky vypnuty' : 'Titulky zapnuty');
  }
  $('pSub').addEventListener('click', cycleSubtitles);

  /* --- filmy --- */
  function playMovie(m) {
    closeDetail();
    player.page = m.url;
    player.cdn = '';
    player.title = m.title || 'Video';
    openPlayer('movie', player.title);
    setPlayerState('Získávám odkaz na video…');
    if (player.kind === 'movie') $('pSub').disabled = true;
    apiJson('/api/proxy?url=' + encodeURIComponent(m.url) + '&_=' + Date.now(), 30000).then(function (d) {
      if (!d || !d.success || !d.videoUrl) throw new Error((d && d.error) || 'Video se nepodařilo načíst');
      player.cdn = d.videoUrl;
      setSubtitles(d.subtitles || []);
      var isHls = /\.m3u8(\?|$)/i.test(d.videoUrl);
      var useRelay = !settings.direct && !isHls;
      player.mode = useRelay ? 'relay' : 'direct';
      var src = useRelay ? streamUrl(m.url, false, player.title, d.videoUrl) : d.videoUrl;
      attachSource(src, isHls, {
        onFatal: function () { switchToRelay(video.currentTime || 0); }
      });
    }).catch(function (e) {
      setPlayerState('Chyba: ' + e.message);
      toast('Video se nepodařilo načíst: ' + e.message, 4000);
    });
  }

  function switchToRelay(atTime) {
    if (!player.page || player.triedRelay) {
      setPlayerState('Přehrání přes server se nepovedlo.');
      return;
    }
    player.triedRelay = true;
    player.mode = 'relay';
    var isLive = player.kind === 'live';
    var src = isLive
      ? liveRelayUrl(state.channels[player.page.channelIndex] || player.page.channel)
      : streamUrl(player.page, false, player.title, player.cdn || '');
    setPlayerState(isLive ? 'Přepínám na relay serveru…' : 'Přímé CDN selhalo, pokračuji přes server…');
    if (!isLive) {
      video.addEventListener('loadedmetadata', function () {
        if (atTime > 1) video.currentTime = atTime;
        play();
      }, { once: true });
    }
    var hlsSrc = isLive || /\.m3u8(\?|$)/i.test(player.cdn || '');
    attachSource(src, hlsSrc, {
      onFatal: function () { setPlayerState('Ani relay nepřehraje tento zdroj.'); }
    });
  }

  /* --- živé kanály --- */
  function liveRelayUrl(ch) {
    var u = '/api/live/hls?url=' + encodeURIComponent(ch.url);
    if (ch.ua) u += '&ua=' + encodeURIComponent(ch.ua);
    if (ch.referrer) u += '&referrer=' + encodeURIComponent(ch.referrer);
    return url(u);
  }

  function playLive(ch) {
    player.page = { channel: ch, channelIndex: state.channels.indexOf(ch) };
    player.cdn = '';
    player.title = ch.name || 'Živě';
    openPlayer('live', player.title);
    var needsHeaders = !!(ch.ua || ch.referrer);
    setPlayerState('Připojuji kanál…');
    if (needsHeaders || !settings.direct) {
      player.triedRelay = true;
      player.mode = 'relay';
      attachSource(liveRelayUrl(ch), true, {
        onFatal: function () { setPlayerState('Kanál se nepodařilo přehrát.'); }
      });
      return;
    }
    player.mode = 'direct';
    player.triedRelay = false;
    attachSource(ch.url, true, {
      onFatal: function () {
        // zdroj bez CORS nebo nepřístupný → zkusit relay
        player.triedRelay = false;
        switchToRelay(0);
      }
    });
  }

  /* ------------------------------------------------------------------ *
   *  Nastavení
   * ------------------------------------------------------------------ */
  function renderSettings() {
    var html = ''
      + '<div class="set-row">'
      + '  <div class="lab"><b>Server</b><span>' + esc(settings.server || '—') + '</span></div>'
      + '  <div class="set-actions">'
      + '    <button class="f btn ghost" type="button" id="setServer">Změnit</button>'
      + '    <button class="f btn ghost" type="button" id="setTest">Otestovat</button>'
      + '  </div>'
      + '</div>'
      + '<div class="set-row">'
      + '  <div class="lab"><b>Přímé přehrávání z CDN</b><span>Když vypneš, video jde hned přes server (pomalejší, ale spolehlivější).</span></div>'
      + '  <div class="set-actions"><button class="f btn ghost" type="button" id="setDirect">' + (settings.direct ? 'Zapnuto' : 'Vypnuto') + '</button></div>'
      + '</div>'
      + '<div class="set-row">'
      + '  <div class="lab"><b>Jazyk katalogu</b><span>Plakáty a tituly na úvodní stránce.</span></div>'
      + '  <div class="set-actions"><button class="f btn ghost" type="button" id="setLang">' + (settings.lang === 'en' ? 'English' : 'Čeština') + '</button></div>'
      + '</div>'
      + '<div class="set-row">'
      + '  <div class="lab"><b>Živé vysílání</b><span>Výchozí zdroj kanálů (iptv-org).</span></div>'
      + '  <div class="set-actions"><button class="f btn ghost" type="button" id="setLive">' + esc(liveLabel(settings.live)) + '</button></div>'
      + '</div>'
      + '<div class="set-row">'
      + '  <div class="lab"><b>O aplikaci</b><span>Wflix klient ' + VERSION + ' · ' + (isTV ? 'TV' : 'mobil') + ' · ' + (Native ? 'nativní most' : 'webový režim') + '</span></div>'
      + '  <div class="set-actions"><button class="f btn ghost" type="button" id="setAbout">Co to je?</button></div>'
      + '</div>';
    $('settingsList').innerHTML = html;

    $('setServer').addEventListener('click', function () {
      openKeyboard({
        title: 'Adresa serveru', value: settings.server,
        onDone: function (v) {
          var s = normalizeServer(v);
          if (!s) { toast('Adresa nesmí být prázdná.'); return; }
          settings.server = s;
          saveSettings();
          renderSettings();
          loadHome();
          state.channels = [];
          toast('Server uložen.');
        }
      });
    });
    $('setTest').addEventListener('click', function () {
      loading('Testuji server…');
      apiJson('/api/live?country=cz', 20000).then(function (d) {
        loading(null);
        toast(d && d.success ? 'Server odpovídá ✔ (' + ((d.channels || []).length) + ' kanálů)' : 'Server odpověděl, ale bez dat.');
      }).catch(function (e) {
        loading(null);
        toast('Server neodpovídá: ' + e.message, 4500);
      });
    });
    $('setDirect').addEventListener('click', function () {
      settings.direct = !settings.direct;
      saveSettings();
      renderSettings();
      toast('Přímé přehrávání: ' + (settings.direct ? 'zapnuto' : 'vypnuto'));
    });
    $('setLang').addEventListener('click', function () {
      settings.lang = settings.lang === 'en' ? 'cz' : 'en';
      saveSettings();
      renderSettings();
      loadHome();
    });
    $('setLive').addEventListener('click', function () {
      var ids = LIVE_SOURCES.map(function (s) { return s.id; });
      var i = ids.indexOf(settings.live);
      settings.live = ids[(i + 1) % ids.length];
      saveSettings();
      renderSettings();
      state.liveFilter = settings.live;
      state.channels = [];
      renderLiveChips();
    });
    $('setAbout').addEventListener('click', function () {
      toast('Klient pro Wflix proxy: hledá na prehraj.to, přehrává přes CDN nebo server. Obsah nehostuje.', 6000);
    });
  }

  function liveLabel(id) {
    for (var i = 0; i < LIVE_SOURCES.length; i++) if (LIVE_SOURCES[i].id === id) return LIVE_SOURCES[i].label;
    return 'Česko';
  }

  /* ------------------------------------------------------------------ *
   *  Klávesy / dálkové ovládání
   * ------------------------------------------------------------------ */
  function closeOverlays() {
    if (!$('kbd').hidden) { hide($('kbd')); return true; }
    if (!$('player').hidden) { closePlayer(); focusAfterOverlay(); return true; }
    if (!$('detail').hidden) { closeDetail(); focusAfterOverlay(); return true; }
    return false;
  }

  function notifyBackHandled() {
    if (Native && typeof Native.backHandled === 'function') Native.backHandled();
  }

  function goBack() {
    if (closeOverlays()) { notifyBackHandled(); return; }
    if (state.view !== 'home') { setView('home'); focusAfterOverlay(); notifyBackHandled(); return; }
    if (Native && typeof Native.exitApp === 'function') { Native.exitApp(); }
  }

  function onKeyDown(e) {
    var k = e.key;
    var code = e.keyCode;

    // webOS dálkové ovládání
    if (code === 461) { e.preventDefault(); goBack(); return; }
    if (code === 415) { e.preventDefault(); if (!$('player').hidden) play(); return; }
    if (code === 19) { e.preventDefault(); if (!$('player').hidden) video.pause(); return; }
    if (code === 412) { e.preventDefault(); if (!$('player').hidden) seekBy(-10); return; }
    if (code === 417) { e.preventDefault(); if (!$('player').hidden) seekBy(10); return; }

    var playerOpen = !$('player').hidden;
    var kbdOpen = !$('kbd').hidden;

    if (k) {
      if (k === 'Escape' || k === 'Backspace' || k === 'GoBack' || k === 'BrowserBack') {
        e.preventDefault();
        goBack();
        return;
      }
      if (k === 'ArrowLeft' || k === 'ArrowRight' || k === 'ArrowUp' || k === 'ArrowDown') {
        if (playerOpen) {
          bumpIdle();
          var focused = currentFocus();
          if (focused === $('pBar')) {
            e.preventDefault();
            seekBy(k === 'ArrowLeft' ? -10 : (k === 'ArrowRight' ? 10 : 0));
            if (k === 'ArrowUp') moveFocus(0, -1);
            if (k === 'ArrowDown') moveFocus(0, 1);
            return;
          }
          if (k === 'ArrowLeft' || k === 'ArrowRight') {
            e.preventDefault();
            seekBy(k === 'ArrowLeft' ? -10 : 10);
            return;
          }
        }
        var moved;
        if (k === 'ArrowLeft') moved = moveFocus(-1, 0);
        else if (k === 'ArrowRight') moved = moveFocus(1, 0);
        else if (k === 'ArrowUp') moved = moveFocus(0, -1);
        else moved = moveFocus(0, 1);
        if (moved || kbdOpen) { e.preventDefault(); }
        return;
      }
      if (k === 'Enter') {
        var f = currentFocus();
        if (f === $('searchInput') && !isTouch) {
          e.preventDefault();
          openKeyboard({
            title: 'Hledat film nebo seriál', value: $('searchInput').value,
            onDone: function (v) { doSearch(v); }
          });
          return;
        }
        return; // Enter na tlačítku řeší prohlížeč
      }
    }
  }

  document.addEventListener('keydown', onKeyDown, true);

  /* ------------------------------------------------------------------ *
   *  Start
   * ------------------------------------------------------------------ */
  var serverPrefill = '';

  function showSetup() {
    hide($('shell'));
    show($('setup'));
    $('serverField').textContent = settings.server || serverPrefill || 'http://192.168.1.10:5218';
    setTimeout(function () { focusEl($('serverField')); }, 50);
  }

  function startApp() {
    hide($('setup'));
    show($('shell'));
    setView('home');
    loadHome();
    renderLiveChips();
    renderSettings();
    if (settings.live) state.liveFilter = settings.live;
  }

  function testAndConnect(server) {
    settings.server = server;
    loading('Připojuji se k serveru…');
    $('setupMsg').textContent = '';
    $('setupMsg').className = 'msg';
    apiJson('/api/catalog?lang=' + settings.lang, 20000).then(function (d) {
      loading(null);
      if (!d || !d.success) throw new Error('Server nevrátil očekávaná data');
      saveSettings();
      $('setupMsg').textContent = 'Připojeno ✔';
      $('setupMsg').className = 'msg ok';
      startApp();
    }).catch(function (e) {
      loading(null);
      $('setupMsg').textContent = 'Nepřipojeno: ' + e.message + ' — můžeš to zkusit i tak.';
      $('setupMsg').className = 'msg err';
      saveSettings();
      setTimeout(function () {
        if ($('setupMsg').className.indexOf('err') !== -1) startApp();
      }, 1600);
    });
  }

  function boot() {
    document.body.classList.toggle('touch', isTouch);
    loadSettings();
    $('verLine').textContent = VERSION;

    if (!settings.server && /^https?:$/.test(location.protocol)) {
      // Předvyplníme adresu, na které klient běží – uživatel jen potvrdí.
      serverPrefill = location.origin;
      $('serverField').textContent = serverPrefill;
    }

    $('serverField').addEventListener('click', function () {
      openKeyboard({
        title: 'Adresa serveru', value: settings.server || (($('serverField').textContent || '').indexOf('http') === 0 ? $('serverField').textContent : ''),
        onDone: function (v) {
          var s = normalizeServer(v);
          if (!s) return;
          settings.server = s;
          saveSettings();
          $('serverField').textContent = s;
          $('setupMsg').textContent = '';
        }
      });
    });

    $('connectBtn').addEventListener('click', function () {
      var s = normalizeServer(settings.server || $('serverField').textContent);
      if (!s || s === 'http://192.168.1.10:5218') {
        toast('Nejdřív zadej adresu serveru.');
        return;
      }
      settings.server = s;
      $('serverField').textContent = s;
      testAndConnect(s);
    });

    var navs = document.querySelectorAll('.navbtn');
    for (var i = 0; i < navs.length; i++) {
      (function (el) {
        el.addEventListener('click', function () {
          var v = el.getAttribute('data-nav');
          setView(v);
          if (v === 'home') {
            var b = $('hero').querySelector('.btn.primary');
            if (b) focusEl(b);
          } else {
            var first = $('view-' + v).querySelector('.f');
            if (first) focusEl(first);
          }
        });
      })(navs[i]);
    }

    // hledání
    $('searchGo').addEventListener('click', function () { doSearch($('searchInput').value); });
    $('searchInput').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); doSearch($('searchInput').value); }
    });
    $('searchInput').addEventListener('click', function () {
      if (!isTouch) {
        openKeyboard({
          title: 'Hledat film nebo seriál', value: $('searchInput').value,
          onDone: function (v) { doSearch(v); }
        });
      }
    });

    $('detailClose').addEventListener('click', function () { closeDetail(); focusAfterOverlay(); });
    $('detail').addEventListener('click', function (e) { if (e.target === $('detail')) closeDetail(); });

    document.addEventListener('mousemove', function () { if (!$('player').hidden) bumpIdle(); });

    renderLiveChips();
    renderSettings();

    if (settings.server) {
      hide($('setup'));
      show($('shell'));
      startApp();
    } else {
      showSetup();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
