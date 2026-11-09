/* ==========================================================================
   Wflix klient – logika (TV webOS + Android)
   Bez frameworku, syntaxe bezpečná i pro starší Chromium v TV (žádné ?. ani ??).
   Komunikuje s backendem Wflixu: /api/search, /api/proxy, /api/stream,
   /api/live, /api/live/hls, /api/subtitles, /api/thumb, /api/catalog.
   ========================================================================== */
(function () {
  'use strict';

  var VERSION = '1.1.0';
  var LS_SERVER = 'wflix.server';
  // Pevný server – adresa se v aplikaci nezadává ani nemění.
  var FIXED_SERVER = 'http://wflix.runasp.net';
  var LS_SETTINGS = 'wflix.settings';

  var Native = window.WflixNative || null;
  var isTouch = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
  var isTV = !isTouch;

  /* ------------------------------------------------------------------ *
   *  Malé pomocníky
   * ------------------------------------------------------------------ */
  function $(id) { return document.getElementById(id); }
  /* Ikony ze sprite v index.html (stroke = currentColor). */
  function icon(name, cls) {
    return '<svg class="i' + (cls ? ' ' + cls : '') + '" aria-hidden="true"><use href="#i-' + name + '" xlink:href="#i-' + name + '"/></svg>';
  }
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
    server: FIXED_SERVER,
    direct: true,      // přímé přehrávání z CDN (jako ve webovém Wflixu)
    lang: 'cz',        // jazyk katalogu
    live: 'cz',        // výchozí zdroj živého vysílání
    subSize: 'm',      // velikost titulků (m | l | xl)
    subBg: 'dark',     // pozadí titulků (dark | light | none)
    searchMerge: false // Experimental: Více výsledků (source=all), tolerantní k výpadku zdroje
  };

  function loadSettings() {
    try {
      var s = JSON.parse(localStorage.getItem(LS_SETTINGS) || '{}');
      if (s && typeof s === 'object') {
        if (typeof s.direct === 'boolean') settings.direct = s.direct;
        if (s.lang === 'en' || s.lang === 'cz') settings.lang = s.lang;
        if (typeof s.live === 'string') settings.live = s.live;
        if (s.subSize === 'm' || s.subSize === 'l' || s.subSize === 'xl') settings.subSize = s.subSize;
        if (s.subBg === 'dark' || s.subBg === 'light' || s.subBg === 'none') settings.subBg = s.subBg;
        if (typeof s.searchMerge === 'boolean') settings.searchMerge = s.searchMerge;
      }
    } catch (e) { /* poškozené úložiště – jedeme s výchozím */ }
    settings.server = FIXED_SERVER;   // starší uložená adresa se ignoruje
  }
  function saveSettings() {
    try {
      localStorage.setItem(LS_SETTINGS, JSON.stringify({
        direct: settings.direct, lang: settings.lang, live: settings.live,
        subSize: settings.subSize, subBg: settings.subBg, searchMerge: settings.searchMerge
      }));
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
   *  Knihovna diváka – oblíbené (jen localStorage)
   *  Klíč je stejný jako u webového Wflixu, takže se formát nerozjíždí:
   *    wflix-favs     [{ key, url, title, poster, at }]
   * ------------------------------------------------------------------ */
  var LS_FAVS = 'wflix-favs';
  var CUE_SIZES = { m: '1em', l: '1.3em', xl: '1.6em' };
  var CUE_BACKGROUNDS = { dark: 'rgba(0,0,0,.72)', light: 'rgba(255,255,255,.88)', none: 'transparent' };
  var SUB_SIZE_LABELS = { m: 'Normální', l: 'Velké', xl: 'Extra velké' };
  var SUB_BG_LABELS = { dark: 'Tmavé', light: 'Světlé', none: 'Bez pozadí' };
  var lastFocus = null;

  function readList(key) {
    try {
      var v = JSON.parse(localStorage.getItem(key) || '[]');
      return Object.prototype.toString.call(v) === '[object Array]' ? v : [];
    } catch (e) { return []; }            /* TV může mít úložiště vypnuté */
  }
  function writeList(key, list) {
    try { localStorage.setItem(key, JSON.stringify(list)); } catch (e) { }
  }
  function normText(s) {
    return String(s === null || s === undefined ? '' : s).toLowerCase()
      .replace(/[áàâä]/g, 'a').replace(/[čć]/g, 'c').replace(/ď/g, 'd')
      .replace(/[éèêëě]/g, 'e').replace(/[íìîï]/g, 'i').replace(/ň/g, 'n')
      .replace(/[óòôö]/g, 'o').replace(/[řŕ]/g, 'r').replace(/[šś]/g, 's')
      .replace(/ť/g, 't').replace(/[úùûüů]/g, 'u').replace(/[ýÿ]/g, 'y')
      .replace(/[žź]/g, 'z')
      .replace(/[^a-z0-9]+/g, ' ').trim();
  }

  /* ------------------------------------------------------------------ *
   *  Seriály – prehraj.to vede každý díl jako samostatné video, sezónu
   *  a díl nese jen název. Parser z něj vytáhne SxxExx, zbytek před
   *  značkou je název seriálu a stejné díly se slijí do jedné karty.
   *  "S01E04-09" je prostě díl 4, číslo za pomlčkou není rozsah.
   * ------------------------------------------------------------------ */
  // ===== Seriály =====
  var EP_RELEASE_TAIL = /(?:[\s._-]+(?:cz|sk|en|dabing|titulky|subtitles|tit|sub|1080p|720p|2160p|4k|uhd|full[\s._-]*hd|hdtv|hd|web[\s._-]?dl|webrip|blu[\s._-]?ray|dvdrip|x264|x265|hevc|aac|mkv|mp4|avi))+$/i;

  function stripEpisodeTags(s) {
    var t = String(s || '').replace(/\.[a-z0-9]{2,4}\s*$/i, '');   // přípona souboru
    for (var i = 0; i < 10; i++) {
      var next = t.replace(/[\s._-]+$/, '').replace(EP_RELEASE_TAIL, '').trim();
      if (next === t) break;
      t = next;
    }
    return t.trim();
  }

  // název seriálu = text před značkou epizody, bez roku a koncových značek
  function cleanSeriesBase(s) {
    var b = stripEpisodeTags(s);
    b = b.replace(/\s*[\(\[]\s*(?:19|20)\d{2}\s*(?:[-–]\s*(?:19|20)\d{2})?\s*[\)\]]\s*$/, '');
    var noYear = b.replace(/[\s._-]+(?:19|20)\d{2}\s*$/, '');
    if (noYear.trim().length >= 2 && /[a-zá-ž]/i.test(noYear)) b = noYear;
    return b.replace(/^[\s._\-–—:]+|[\s._\-–—:]+$/g, '').trim();
  }

  // název zdroje: bez značky SxxExx, bez přípony a bez názvu seriálu na začátku
  function cleanEpisodeName(s, base) {
    var n = String(s || '').replace(/\.[a-z0-9]{2,4}\s*$/i, '').replace(/\s+/g, ' ').trim();
    n = n.replace(/^[\s._\-–—:]+|[\s._\-–—:]+$/g, '').trim();
    if (base && n.toLowerCase().indexOf(base.toLowerCase()) === 0) {
      var rest = n.slice(base.length).replace(/^[\s._\-–—:]+/, '').trim();
      if (rest) n = rest;
    }
    return n || base || '';
  }

  var EP_PATTERNS = [
    // S01E01, S01E01-E02, S01E01E02, S01E04-09, S1 E1
    { kind: 'sxxexx', re: /(^|[^0-9a-z])s\s*(\d{1,2})\s*[._ -]?\s*e\s*(\d{1,3})(?:\s*[-–—]\s*(?:e\s*)?(\d{1,3})|\s*e\s*(\d{1,3}))?(?![0-9])/i },
    // 1x01, 01x01
    { kind: 'nxnn', re: /(^|[^0-9])(\d{1,2})\s*[x×]\s*(\d{1,3})(?![0-9])/i },
    // 1. série 2. díl / 2. série - 1. díl / Season 1 Episode 2
    { kind: 'worded', re: /(^|[^0-9])(\d{1,2})\s*\.?\s*(?:série|serie|sezóna|sezona|season)\b[^\d]{0,20}?(\d{1,4})\s*\.?\s*(?:díl|diel|epizoda|epizóda|episode|ep\.?|část|časť)\b/i },
    // Season 2 Episode 4 / Série 2 - díl 4
    { kind: 'worded2', re: /(^|[^0-9a-z])(?:série|serie|sezóna|sezona|season)\s*(\d{1,2})\b[\s,;:._-]*(?:díl|diel|epizoda|epizóda|episode|ep\.?|část|časť)\s*(\d{1,4})\b/i },
    // Epizoda 1/8, 3. díl, Episode 5, Ep 12, E01 - bez sezóny
    { kind: 'episode', re: /(^|[^0-9a-z])(?:epizoda|epizóda|díl|diel|episode|ep\.?|e)\s*\.?\s*(\d{1,3})(?:\s*\/\s*\d{1,3})?(?![0-9])/i },
    { kind: 'episode', re: /(^|[^0-9])(\d{1,3})\s*\.\s*(?:díl|diel|epizoda|epizóda|část|časť)(?![a-z])/i }
  ];

  function parseEpisodeTitle(title) {
    var s = String(title || '');
    for (var i = 0; i < EP_PATTERNS.length; i++) {
      var p = EP_PATTERNS[i];
      var m = p.re.exec(s);
      if (!m) continue;

      var season = null;
      var episode = 0;
      if (p.kind === 'sxxexx' || p.kind === 'nxnn' || p.kind === 'worded' || p.kind === 'worded2') {
        season = Number(m[2]);
        episode = Number(m[3]);
      } else {
        episode = Number(m[2]);
      }
      if (!isFinite(episode)) continue;

      var baseStart = m.index + (m[1] ? m[1].length : 0);
      var markerEnd = m.index + m[0].length;
      var base = cleanSeriesBase(s.slice(0, baseStart));
      if (base.length < 2 || !/[a-zá-ž]/i.test(base)) continue;

      // Popisek končí číslem dílu: "S01E04-09" je díl 4, "-09" není rozsah.
      var label;
      if (p.kind === 'sxxexx') label = ('S' + m[2] + 'E' + m[3]).toUpperCase();
      else if (p.kind === 'nxnn') label = s.slice(baseStart, markerEnd).replace(/\s+/g, '');
      else if (p.kind === 'worded' || p.kind === 'worded2') label = 'S' + season + 'E' + episode;
      else label = 'Díl ' + episode;

      var name = cleanEpisodeName(s.slice(0, baseStart) + ' ' + s.slice(markerEnd), base);
      return { base: base, season: season, episodes: [episode], label: label, name: name };
    }
    return null;
  }

  function seriesKeyOf(base) { return normText(base); }

  function czCount(n, one, few, many) {
    n = Number(n) || 0;
    return n + ' ' + (n === 1 ? one : (n >= 2 && n <= 4 ? few : many));
  }

  // Z plochých výsledků udělá položky: film zůstane kartou, epizody stejného
  // seriálu se slijí do jedné karty. URL i stejné názvy se dedupují.
  function groupSearchResults(movies) {
    var byKey = {};
    var entries = [];

    for (var i = 0; i < movies.length; i++) {
      var movie = movies[i];
      var parsed = parseEpisodeTitle(movie.title);
      var key = parsed ? seriesKeyOf(parsed.base) : '';
      if (!key) { entries.push({ type: 'movie', movie: movie }); continue; }

      var series = byKey[key];
      if (!series) {
        series = { key: key, title: parsed.base, year: '', poster: '', raw: [] };
        byKey[key] = series;
        entries.push({ type: 'series', series: series });
      }
      series.raw.push({ movie: movie, parsed: parsed });
      if (!series.poster && movie.thumbnail) series.poster = movie.thumbnail;
      if (!series.year && movie.year) series.year = movie.year;
    }

    var out = [];
    for (var e = 0; e < entries.length; e++) {
      if (entries[e].type !== 'series') { out.push(entries[e]); continue; }
      var fin = finalizeSeries(entries[e].series);
      if (fin.episodeCount >= 2) {
        out.push({ type: 'series', series: fin });
      } else {
        // jediná epizoda nemá smysl seskupovat – zůstane normální kartou
        for (var r = 0; r < fin.raw.length; r++) out.push({ type: 'movie', movie: fin.raw[r].movie });
      }
    }
    return groupCollections(out);
  }

  function finalizeSeries(raw) {
    var seasonKeys = [];
    var seasons = {};

    for (var i = 0; i < raw.raw.length; i++) {
      var movie = raw.raw[i].movie;
      var parsed = raw.raw[i].parsed;
      for (var e = 0; e < parsed.episodes.length; e++) {
        var epNum = parsed.episodes[e];
        var sKey = parsed.season == null ? '?' : String(parsed.season);
        if (!seasons[sKey]) {
          seasons[sKey] = { key: sKey, season: parsed.season, list: [], byNum: {} };
          seasonKeys.push(sKey);
        }
        var bucket = seasons[sKey];
        var ep = bucket.byNum[epNum];
        if (!ep) {
          ep = {
            season: parsed.season, episode: epNum, label: parsed.label,
            variants: [], urls: {}, titles: {}
          };
          bucket.byNum[epNum] = ep;
          bucket.list.push(ep);
        }
        // stejná URL nebo přesně stejný název podruhé = duplikát, ne varianta
        var titleKey = normText(movie.title);
        if (ep.urls[movie.url] || (titleKey && ep.titles[titleKey])) continue;
        ep.urls[movie.url] = true;
        if (titleKey) ep.titles[titleKey] = true;
        ep.variants.push({ title: movie.title, url: movie.url, thumbnail: movie.thumbnail || '', year: movie.year || '', name: parsed.name });
      }
    }

    var seasonList = [];
    for (var k = 0; k < seasonKeys.length; k++) {
      var b = seasons[seasonKeys[k]];
      b.list.sort(function (a, c) { return a.episode - c.episode; });
      seasonList.push({ key: b.key, season: b.season, episodes: b.list });
    }
    seasonList.sort(function (a, b) {
      if (a.season == null) return b.season == null ? 0 : 1;
      if (b.season == null) return -1;
      return a.season - b.season;
    });

    var episodeCount = 0;
    for (var si = 0; si < seasonList.length; si++) episodeCount += seasonList[si].episodes.length;

    return {
      key: raw.key, title: raw.title, year: raw.year, poster: raw.poster,
      raw: raw.raw, seasons: seasonList,
      episodeCount: episodeCount,
      seasonCount: seasonList.filter(function (x) { return x.season != null; }).length
    };
  }

  /* ------------------------------------------------------------------ *
   *  Série bez číslování dílů (franšízy)
   *  U franšíz prehraj.to číslo dílu nemá: "Spider-Man: Brand New Day"
   *  je jen název. Když víc výsledků začíná stejným názvem, slijeme je
   *  do jedné série (kolekce) – otevře se stejně jako seriál s SxxExx.
   * ------------------------------------------------------------------ */
  var COLLECTION_STOP = {};
  ('a i k o s u v z ve ze do na po pro se si za je the an and of to in on for la le el de der die das')
    .split(' ').forEach(function (w) { COLLECTION_STOP[w] = true; });
  // Za těmito značkami název končí - uploader za ně přidává vlastní zkratky
  // ("Spiderman 2004 UHD CZ ned"), které by jinak z každého uploadu udělaly jiný film.
  var COLLECTION_CUT = /(?:^|[\s._,\-(])(?:cz|sk|en|český|česky|cesky|dabing|dab|titulky|subtitles|tit|sub|1080p|720p|2160p|480p|4k|uhd|full|fhd|hd|hdtv|web|webdl|webrip|bluray|brrip|dvdrip|dvd|x264|x265|h264|h265|hevc|aac|ac3|mkv|mp4|avi|topkvalita|kvalita|serial|seriál)(?=$|[\s._\-,;:)\]])/i;

  // Název bez ozdob, přípony, roku a všeho za první značkou kvality/jazyka.
  function collectionCore(title) {
    var t = String(title || '')
      .replace(/_+/g, ' ')
      .replace(/\s+/g, ' ')
      .replace(/^[-–—.\s#~+*:;|/\\]+/, '')
      .replace(/\.[a-z0-9]{2,4}$/i, '')
      .replace(/^(?:seri[aá]l|serial)\s+(?=[A-ZÁ-Ž0-9])/i, '')   // "Seriál Hospoda ..." = Hospoda
      .trim();
    var cut = t.search(COLLECTION_CUT);
    if (cut > 0) t = t.slice(0, cut);
    // Rok u prostřed názvu: za ním už jsou jen značky uploadera ("Matrix 1999 ned").
    var year = /(?:^|[\s._\-–—(\[])(?:19[5-9]\d|20[0-2]\d)(?=$|[\s._\-–—(\[)\].,;:])/.exec(t);
    if (year && year.index > 0) t = t.slice(0, year.index);
    return t.replace(/[,\s._-]+$/, '')
      .replace(/\s*[\(\[]\s*(?:19|20)\d{2}\s*[\)\]]\s*$/, '')
      .replace(/(?:^|[\s._-])(?:19|20)\d{2}$/, '')
      .replace(/[,\s._-]+$/, '')
      .trim();
  }

  // nejdelší společný začátek názvů (po slovech)
  function commonWordPrefix(lists) {
    var min = lists[0].length;
    for (var i = 1; i < lists.length; i++) if (lists[i].length < min) min = lists[i].length;
    var take = 0;
    for (var k = 0; k < min; k++) {
      var w = lists[0][k], all = true;
      for (var j = 1; j < lists.length; j++) if (lists[j][k] !== w) { all = false; break; }
      if (!all) break;
      take = k + 1;
    }
    return take;
  }

  // Skupiny výsledků, které začínají stejným názvem a nejsou to díly seriálu.
  function collectionGroups(items) {
    var buckets = {}, order = [];
    for (var i = 0; i < items.length; i++) {
      var first = items[i].words[0];
      if (!buckets[first]) { buckets[first] = []; order.push(first); }
      buckets[first].push(items[i]);
    }

    var groups = [];
    for (var b = 0; b < order.length; b++) {
      var list = buckets[order[b]];
      var head = order[b];
      if (COLLECTION_STOP[head] || head.length < 3) continue;
      var keys = [];
      for (var q = 0; q < list.length; q++) if (keys.indexOf(list[q].key) < 0) keys.push(list[q].key);
      if (keys.length < 2) continue;                 // samé uploady jednoho filmu
      var words = [];
      for (var w = 0; w < list.length; w++) words.push(list[w].words);
      var take = commonWordPrefix(words);
      if (!take) continue;
      var baseTokens = list[0].words.slice(0, take);
      // Jedno slovo jako název série jen když existuje i holý název ("Spiderman")
      // nebo je dost dlouhé - ať se neslijí filmy se stejnou předložkou na začátku.
      if (take === 1 && keys.indexOf(baseTokens[0]) < 0 && head.length < 6) continue;
      var bare = list[0];
      for (var f = 0; f < list.length; f++) if (list[f].key === baseTokens.join(' ')) { bare = list[f]; break; }
      var base = bare.core.split(/\s+/).slice(0, take).join(' ');
      var first_ = 1e9;
      for (var o = 0; o < list.length; o++) if (list[o].index < first_) first_ = list[o].index;
      groups.push({ base: base, baseTokens: baseTokens, items: list, order: first_ });
    }
    groups.sort(function (a, c) { return a.order - c.order; });
    return groups;
  }

  // Řádky kolekce: jeden název = jeden film, ostatní uploady téhož názvu jsou varianty.
  function collectionRows(items, baseTokens) {
    var keys = [], rows = {};
    for (var i = 0; i < items.length; i++) {
      var item = items[i], movie = item.movie;
      var row = rows[item.key];
      if (!row) {
        row = { key: item.key, core: item.core, year: '', variants: [], urls: {}, titles: {} };
        rows[item.key] = row;
        keys.push(item.key);
      }
      var titleKey = normText(movie.title);
      if (row.urls[movie.url] || (titleKey && row.titles[titleKey])) continue;
      row.urls[movie.url] = true;
      if (titleKey) row.titles[titleKey] = true;
      if (!row.year && movie.year) row.year = movie.year;
      row.variants.push(movie);
    }

    var out = [];
    for (var k = 0; k < keys.length; k++) {
      var r = rows[keys[k]];
      var rest = r.core.split(/\s+/).slice(baseTokens.length).join(' ')
        .replace(/^[\s._\-–—:,]+|[\s._\-–—:,]+$/g, '').trim();
      // "Bylo nás pět 2 Andělíček policajt" = číslo a za ním název dílu
      var num = /^(\d{1,3})(?:[.)\]]|,|\s)+\s*(\S.*)$/.exec(rest);
      var named = num && !/^[\(\[]/.test(num[2].trim());
      // "žena za pultem 2" = díl 2 i když za číslem nic není
      var sole = /^\d{1,3}$/.test(rest);
      out.push({
        row: r,
        rest: rest || r.core,
        episode: named ? Number(num[1]) : (sole ? Number(rest) : null),
        name: named ? num[2].trim() : ''
      });
    }
    return out;
  }

  function buildCollection(base, baseTokens, key, items) {
    var rows = collectionRows(items, baseTokens);

    // Číslování bereme jako díly jen když je v názvech opravdu celé (seriál).
    // U franšíz ("Matrix 2 Reloaded") zůstává číslo součástí názvu filmu.
    var numbered = 0;
    for (var i = 0; i < rows.length; i++) if (rows[i].episode != null) numbered++;
    var episodic = numbered >= 2 && numbered === rows.length;
    if (!episodic) for (var n = 0; n < rows.length; n++) rows[n].episode = null;

    rows.sort(function (a, b) {
      if ((a.episode == null) !== (b.episode == null)) return a.episode == null ? 1 : -1;
      if (a.episode != null && a.episode !== b.episode) return a.episode - b.episode;
      var ay = Number(a.row.year) || 9999, by = Number(b.row.year) || 9999;
      if (ay !== by) return ay - by;
      return a.row.key < b.row.key ? -1 : (a.row.key > b.row.key ? 1 : 0);
    });

    var episodes = [];
    for (var e = 0; e < rows.length; e++) {
      var r = rows[e];
      var num = r.episode != null ? 'Díl ' + r.episode : (r.row.year || '');
      var name = r.episode != null ? (r.name || r.row.core) : r.row.core;
      var variants = [];
      for (var v = 0; v < r.row.variants.length; v++) {
        var m = r.row.variants[v];
        variants.push({ title: m.title, url: m.url, thumbnail: m.thumbnail || '', year: m.year || '', name: name });
      }
      episodes.push({ season: null, episode: r.episode != null ? r.episode : e + 1, num: num, label: num, variants: variants });
    }

    var years = [];
    for (var y = 0; y < rows.length; y++) {
      var yr = Number(rows[y].row.year);
      if (yr > 1900) years.push(yr);
    }
    years.sort(function (a, b) { return a - b; });

    var poster = '';
    for (var t = 0; t < items.length; t++) if (items[t].movie.thumbnail) { poster = items[t].movie.thumbnail; break; }

    var raw = [];
    for (var w2 = 0; w2 < items.length; w2++) raw.push({ movie: items[w2].movie, parsed: null });

    return {
      key: key,
      kind: 'collection',
      unit: episodic ? 'dil' : 'film',
      title: base,
      baseTokens: baseTokens,
      year: years.length > 1 ? years[0] + '–' + years[years.length - 1] : (years.length ? String(years[0]) : ''),
      poster: poster,
      raw: raw,
      seasons: [{ key: '?', season: null, episodes: episodes }],
      episodeCount: episodes.length,
      seasonCount: 0
    };
  }

  function groupCollections(entries) {
    var items = [];
    for (var i = 0; i < entries.length; i++) {
      var e = entries[i];
      if (e.type !== 'movie') continue;
      if (parseEpisodeTitle(e.movie.title)) continue;      // díl seriálu, ne franšíza
      var core = collectionCore(e.movie.title);
      var words = normText(core).split(' ').filter(Boolean);
      if (!words.length) continue;
      items.push({ index: i, movie: e.movie, core: core, words: words, key: words.join(' ') });
    }
    if (items.length < 2) return entries;

    var groups = collectionGroups(items);
    if (!groups.length) return entries;

    var at = {}, drop = {};
    for (var g = 0; g < groups.length; g++) {
      var grp = groups[g], first = 1e9;
      for (var j = 0; j < grp.items.length; j++) if (grp.items[j].index < first) first = grp.items[j].index;
      at[first] = {
        type: 'series',
        series: buildCollection(grp.base, grp.baseTokens, 'c:' + grp.baseTokens.join(' '), grp.items)
      };
      for (var k = 0; k < grp.items.length; k++) if (grp.items[k].index !== first) drop[grp.items[k].index] = true;
    }

    var out = [];
    for (var x = 0; x < entries.length; x++) {
      if (drop[x]) continue;
      out.push(at[x] || entries[x]);
    }
    return out;
  }

  // Patří film do otevřené série? U kolekce rozhoduje stejný začátek názvu.
  function seriesAccepts(series, movie) {
    if (series.kind === 'collection') {
      if (parseEpisodeTitle(movie.title)) return false;
      var words = normText(collectionCore(movie.title)).split(' ').filter(Boolean);
      for (var i = 0; i < series.baseTokens.length; i++) if (words[i] !== series.baseTokens[i]) return false;
      return true;
    }
    var parsed = parseEpisodeTitle(movie.title);
    return !!parsed && seriesKeyOf(parsed.base) === series.key;
  }

  // Další stránka hledání: přidá jen epizody stejného seriálu, ostatní ignoruje.
  function mergeSeriesMovies(series, movies) {
    var known = {};
    for (var i = 0; i < series.raw.length; i++) known[series.raw[i].movie.url] = true;

    var added = 0;
    for (var j = 0; j < movies.length; j++) {
      var movie = movies[j];
      if (!movie || !movie.url || known[movie.url]) continue;
      if (!seriesAccepts(series, movie)) continue;
      known[movie.url] = true;
      series.raw.push({ movie: movie, parsed: parseEpisodeTitle(movie.title) });
      added++;
      if (!series.poster && movie.thumbnail) series.poster = movie.thumbnail;
      if (!series.year && movie.year) series.year = movie.year;
    }
    if (!added) return { added: 0, series: series };
    if (series.kind === 'collection') {
      var items = [];
      for (var r = 0; r < series.raw.length; r++) {
        var core = collectionCore(series.raw[r].movie.title);
        var words = normText(core).split(' ').filter(Boolean);
        if (!words.length) continue;
        items.push({ index: 0, movie: series.raw[r].movie, core: core, words: words, key: words.join(' ') });
      }
      return { added: added, series: buildCollection(series.title, series.baseTokens, series.key, items) };
    }
    return { added: added, series: finalizeSeries(series) };
  }

  function seriesMeta(series) {
    if (series.kind === 'collection') {
      return series.unit === 'dil'
        ? czCount(series.episodeCount, 'díl', 'díly', 'dílů')
        : czCount(series.episodeCount, 'film', 'filmy', 'filmů');
    }
    return czCount(series.seasonCount, 'série', 'série', 'sérií') + ' · '
      + czCount(series.episodeCount, 'díl', 'díly', 'dílů');
  }
  // ===== Konec seriálů =====

  var favorites = readList(LS_FAVS).filter(function (f) { return f && f.key; });

  function saveFavorites() { writeList(LS_FAVS, favorites); }

  function favKeyOf(item) { return item.url || ('q:' + normText(item.title)); }
  function isFav(item) {
    if (!item) return false;
    var k = favKeyOf(item);
    for (var i = 0; i < favorites.length; i++) if (favorites[i].key === k) return true;
    return false;
  }

  /* Vrací true, když se položka přidala (jinak se odebrala). */
  function toggleFav(item) {
    if (!item) return false;
    var k = favKeyOf(item), kept = [], had = false;
    for (var i = 0; i < favorites.length; i++) {
      if (favorites[i].key === k) had = true;
      else kept.push(favorites[i]);
    }
    if (!had) {
      kept.unshift({
        key: k, url: item.url || '', title: item.title || '',
        poster: item.poster || '', at: Date.now()
      });
    }
    favorites = kept;
    saveFavorites();
    renderRows();
    return !had;
  }

  function libCardHtml(rec, kind, idx) {
    var img = rec.poster || '';
    var art = img ? '<img src="' + esc(img) + '" alt="" loading="lazy" referrerpolicy="no-referrer">' : '';
    var ph = '<div class="ph"' + (img ? ' style="display:none"' : '') + '>' + icon('film') + '</div>';
    var pct = 0;
    var badge = '', note = 'Oblíbené';
    return '<button class="f card" type="button" data-idx="' + idx + '">'
      + '<span class="art">' + art + ph + badge
      + (pct ? '<span class="progress"><i style="width:' + pct + '%"></i></span>' : '') + '</span>'
      + '<span class="cap"><span class="t">' + esc(rec.title || 'Video') + '</span>'
      + (note ? '<span class="y">' + esc(note) + '</span>' : '') + '</span>'
      + '</button>';
  }

  /* Klik na kartu z osobní řady – oblíbené bez odkazu jdou přes hledání. */
  function openLibEntry(kind, rec) {
    if (!rec) return;
    if (!rec.url) { searchThenPlay(rec.title || ''); return; }
    openMovieDetail({ url: rec.url, title: rec.title, thumbnail: rec.poster || '' });
  }

  function applyCueStyle() {
    var root = document.documentElement;
    root.style.setProperty('--cue-size', CUE_SIZES[settings.subSize] || CUE_SIZES.m);
    root.style.setProperty('--cue-bg', CUE_BACKGROUNDS[settings.subBg] || CUE_BACKGROUNDS.dark);
  }
  function subSizeLabel() { return SUB_SIZE_LABELS[settings.subSize] || SUB_SIZE_LABELS.m; }
  function subBgLabel() { return SUB_BG_LABELS[settings.subBg] || SUB_BG_LABELS.dark; }
  function cycleIn(map, value) {
    var keys = [];
    for (var k in map) if (Object.prototype.hasOwnProperty.call(map, k)) keys.push(k);
    var i = keys.indexOf(value);
    return keys[(i + 1) % keys.length];
  }

  function detailItem() {
    if (!state.detail) return null;
    return state.detail.kind === 'movie'
      ? { url: state.detail.movie.url, title: state.detail.movie.title, poster: state.detail.movie.thumbnail || '' }
      : { url: '', title: itemTitle(state.detail.item), poster: itemImg(state.detail.item) };
  }

  function updateDetailFav() {
    var btn = $('detailFav');
    if (!btn) return;
    var item = detailItem();
    var on = item ? isFav(item) : false;
    btn.innerHTML = icon('star', on ? 'fill' : '') + '<span>' + (on ? 'V oblíbených' : 'Do oblíbených') + '</span>';
    if (on) btn.classList.add('on'); else btn.classList.remove('on');
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
  }

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

  var nativeSeq = 0;
  var nativePending = {};
  // Odpověď z nativního mostu (Android) – viz MainActivity.Bridge.httpGetAsync.
  window.__wflixNativeResult = function (id, ok, payload) {
    var p = nativePending[id];
    if (!p) return;
    delete nativePending[id];
    clearTimeout(p.timer);
    if (ok) p.resolve(String(payload));
    else p.reject(new Error(String(payload)));
  };

  function nativeGetAsync(path, timeoutMs) {
    return new Promise(function (resolve, reject) {
      var id = 'n' + (++nativeSeq);
      var timer = setTimeout(function () {
        delete nativePending[id];
        var e = new Error('Server neodpovídá (timeout)');
        e.noFallback = true;
        reject(e);
      }, timeoutMs + 5000);
      nativePending[id] = { resolve: resolve, reject: reject, timer: timer };
      try { Native.httpGetAsync(url(path), id); }
      catch (e) { clearTimeout(timer); delete nativePending[id]; reject(e); }
    });
  }

  function apiJson(path, timeoutMs) {
    var to = timeoutMs || 25000;
    // Asynchronní most: stránka se při čekání na server neblokuje (u synchronního httpGet by se zasekla).
    if (Native && typeof Native.httpGetAsync === 'function') {
      return nativeGetAsync(path, to).then(function (body) {
        try { return JSON.parse(body); }
        catch (e) { throw new Error('Server nevrátil JSON'); }
      }, function (err) {
        if (err && err.noFallback) throw err;
        return apiJsonFetch(path, to);      // most je jen zrychlení; když selže, zkusíme normální fetch
      });
    }
    try {
      var body = nativeGet(path);
      if (body !== null) {
        try { return Promise.resolve(JSON.parse(body)); }
        catch (e) { return Promise.reject(new Error('Server nevrátil JSON')); }
      }
    } catch (e) {
      // most je jen zrychlení; když selže, zkusíme normální fetch
    }

    return apiJsonFetch(path, to);
  }

  function apiJsonFetch(path, to) {
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
    entries: [],        // výsledky hledání po seskupení do seriálů
    series: null,       // otevřený seriál
    seriesQuery: '',    // dotaz, kterým se dotahují další stránky
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
    var kbd = $('kbd'), pl = $('player'), det = $('detail'), ser = $('series');
    if (kbd && !kbd.hidden) return kbd;
    if (pl && !pl.hidden) return pl;
    if (det && !det.hidden) return det;
    if (ser && !ser.hidden) return ser;
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

  function firstVisibleFocusable(root) {
    var n = root.querySelectorAll('.f');
    for (var i = 0; i < n.length; i++) if (isVisible(n[i])) return n[i];
    return null;
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
  var kbdState = { value: '', title: '', onDone: null, onCancel: null, physical: false };
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
      onCancel: opts.onCancel || null,
      physical: false
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
      + '<button class="key wide f" type="button" data-k="__back">Smazat</button>'
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
    var all = $('kbdKeys').querySelectorAll('[data-k]');
    var hit = null;
    for (var b = 0; b < all.length; b++) {
      if (all[b].getAttribute('data-k') === k) { hit = all[b]; break; }
    }
    if (hit) focusEl(hit);
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
    if (name === 'search') {
      setSearchText($('searchInput').value);
      renderSearchHint();
      if (isTouch) setTimeout(function () { $('searchInput').focus(); }, 60);
    }
  }

  /* ------------------------------------------------------------------ *
   *  Úvodní stránka – katalog, hero, řady
   * ------------------------------------------------------------------ */
  function itemTitle(it) { return it.t || it.title || ''; }
  function itemQuery(it) { return it.q || it.query || itemTitle(it); }
  function itemYear(it) { return it.y || it.year || ''; }
  function itemGenres(it) { return it.g || it.genres || []; }
  function itemImg(it) { return it.img || it.poster || ''; }

  function renderHero() {
    var list = state.catalog;
    if (!list.length) { $('hero').innerHTML = ''; return; }
    var it = list[state.heroIndex % list.length];
    var g = itemGenres(it);
    var img = itemImg(it);
    var bg = img ? 'style="background-image:url(' + "'" + esc(img) + "'" + ')"' : '';
    var meta = [];
    if (itemYear(it)) meta.push(String(itemYear(it)));
    for (var gi = 0; gi < g.length && gi < 3; gi++) meta.push(g[gi]);
    var html = ''
      + '<div class="hero-art" ' + bg + '></div>'
      + '<div class="hero-scrim"></div>'
      + (img ? '<div class="hero-poster"><img src="' + esc(img) + '" alt=""></div>' : '')
      + '<div class="hero-inner">'
      + '  <div class="hero-kicker">Doporučujeme</div>'
      + '  <h1>' + esc(itemTitle(it)) + '</h1>'
      + (meta.length ? '  <div class="hero-meta">' + esc(meta.join(' · ')) + '</div>' : '')
      + '  <div class="hero-actions">'
      + '    <button class="f btn primary" type="button" data-hero="play">' + icon('play', 'fill') + '<span>Přehrát</span></button>'
      + '    <button class="f btn ghost" type="button" data-hero="info"><span>Detail</span></button>'
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
    var ph = '<div class="ph"' + (img ? ' style="display:none"' : '') + '>' + icon('film') + '</div>';
    var year = itemYear(it);
    return '<button class="f card' + (extra === 'wide' ? ' wide' : '') + '" type="button" data-idx="' + idx + '">'
      + '<span class="art">' + art + ph + '</span>'
      + '<span class="cap"><span class="t">' + esc(itemTitle(it)) + '</span>'
      + (year ? '<span class="y">' + esc(year) + '</span>' : '') + '</span>'
      + '</button>';
  }

  function renderRows() {
    var cat = state.catalog;
    var rows = [];
    if (favorites.length) rows.push({ name: 'Moje oblíbené', items: favorites, lib: 'fav' });
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
        html += rows[r].lib
          ? libCardHtml(rows[r].items[k], rows[r].lib, r + ':' + k)
          : cardHtml(rows[r].items[k], r + ':' + k);
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
          if (!it) return;
          if (row.lib) openLibEntry(row.lib, it);
          else openCatalogDetail(it);
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
      renderSearchHint();
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

  /* ------------------------------------------------------------------ *
   *  Hledání jako na Netflixu / Oneplay: vlevo pole + klávesnice, vpravo výsledky
   *  (na TV se výsledky ukazují za pochodu, při psaní)
   * ------------------------------------------------------------------ */
  var SK_ROWS = ['abcdef', 'ghijkl', 'mnopqr', 'stuvwx', 'yz0123', '456789'];
  var searchTimer = null;
  var searchToken = 0;

  function renderSearchKeys() {
    var html = '';
    for (var r = 0; r < SK_ROWS.length; r++) {
      for (var c = 0; c < SK_ROWS[r].length; c++) {
        var ch = SK_ROWS[r].charAt(c);
        html += '<button class="skey f" type="button" data-sk="' + ch + '">' + ch + '</button>';
      }
    }
    html += '<button class="skey wide f" type="button" data-sk=" ">mezera</button>'
      + '<button class="skey wide f" type="button" data-sk="__back">smazat</button>'
      + '<button class="skey wide f" type="button" data-sk="__clear">vymazat</button>'
      + '<button class="skey full f" type="button" data-sk="__go">Hledat</button>';
    $('skeys').innerHTML = html;
  }

  /* Text v poli vlevo (zdroj pravdy je skrytý #searchInput, ten používá i mobil). */
  function setSearchText(v) {
    v = String(v || '');
    $('searchInput').value = v;
    $('searchText').textContent = v;
    $('searchField').classList.toggle('empty', !v);
    $('searchHint').hidden = !!v;
  }

  function renderSearchHint() {
    var box = $('searchHint');
    var items = state.catalog.slice(0, 10);
    if (!items.length) { box.innerHTML = ''; return; }
    var html = '<div class="hint-title">Oblíbená hledání</div><div class="hint-list">';
    for (var i = 0; i < items.length; i++) {
      html += '<button class="f hint" type="button" data-q="' + esc(itemQuery(items[i])) + '">'
        + icon('search') + '<span>' + esc(itemTitle(items[i])) + '</span></button>';
    }
    box.innerHTML = html + '</div>';
    var btns = box.querySelectorAll('.hint');
    for (var b = 0; b < btns.length; b++) {
      (function (el) {
        el.addEventListener('click', function () { doSearch(el.getAttribute('data-q')); });
      })(btns[b]);
    }
  }

  function scheduleSearch(v) {
    clearTimeout(searchTimer);
    v = String(v || '').trim();
    if (!v) {                                     // smazáno vše: výsledky pryč, zase nabídka
      searchToken++;
      state.results = []; state.entries = [];
      $('searchGrid').innerHTML = '';
      $('searchState').className = 'state';
      $('searchState').textContent = '';
      return;
    }
    if (v.length < 2) return;
    searchTimer = setTimeout(function () { doSearch(v, true); }, 700);
  }

  function searchKey(k) {
    var v = $('searchInput').value;
    if (k === '__go') { clearTimeout(searchTimer); doSearch(v); return; }
    if (k === '__back') v = v.slice(0, -1);
    else if (k === '__clear') v = '';
    else { if (v.length >= 60) return; v += k; }
    setSearchText(v);
    scheduleSearch(v);
  }

  function doSearch(q, quiet) {
    q = String(q || '').trim();
    clearTimeout(searchTimer);
    if (!q) { if (!quiet) toast('Zadej název filmu nebo seriálu.'); return Promise.resolve(); }
    var token = ++searchToken;
    state.query = q;
    setSearchText(q);
    var st = $('searchState');
    if (!quiet) $('searchGrid').innerHTML = '';
    st.className = 'state show';
    st.textContent = 'Hledám „' + q + '“ …';
    if (!quiet) loading('Hledám „' + q + '“ …');
    return apiJson('/api/search?q=' + encodeURIComponent(q) + (settings.searchMerge ? '&source=all' : '')).then(function (d) {
      if (!quiet) loading(null);
      if (token !== searchToken) return;          // mezitím se psalo dál
      if (!d) { showStateError(st, 'Server nevrátil platnou odpověď.'); return; }
      if (!d.success) { showStateError(st, d.error || 'Chyba při vyhledávání.'); return; }
      var movies = d.movies || [];
      if (!movies.length) {
        state.results = []; state.entries = [];
        $('searchGrid').innerHTML = '';
        st.className = 'state show';
        st.textContent = 'Nic jsme nenašli pro „' + q + '“. Zkus jiný název nebo jiný pravopis.';
        return;
      }
      state.results = rankMovies(q, movies);
      state.entries = groupSearchResults(state.results);
      st.className = 'state show';
      st.textContent = 'Nalezeno ' + state.entries.length + ' výsledků pro „' + q + '“';
      renderResults();
    }).catch(function (e) {
      if (!quiet) loading(null);
      if (token !== searchToken) return;
      showStateError(st, 'Chyba: ' + e.message);
    });
  }

  function movieCardHtml(m, idx) {
    var img = m.thumbnail || '';
    var artImg = img
      ? '<img src="' + esc(img) + '" alt="" loading="lazy" referrerpolicy="no-referrer"'
        + ' onerror="this.style.display=\'none\';this.parentNode.querySelector(\'.ph\').style.display=\'grid\'">'
      : '';
    return '<button class="f card wide" type="button" data-idx="' + idx + '">'
      + '<span class="art">' + artImg + '<span class="ph"' + (img ? ' style="display:none"' : '') + '>' + icon('film') + '</span></span>'
      + '<span class="cap"><span class="t">' + esc(m.title) + '</span>'
      + (m.year ? '<span class="y">' + esc(m.year) + '</span>' : '') + '</span>'
      + '</button>';
  }

  function seriesCardHtml(series, idx) {
    var img = series.poster || '';
    var artImg = img
      ? '<img src="' + esc(img) + '" alt="" loading="lazy" referrerpolicy="no-referrer"'
        + ' onerror="this.style.display=\'none\';this.parentNode.querySelector(\'.ph\').style.display=\'grid\'">'
      : '';
    return '<button class="f card wide" type="button" data-idx="' + idx + '">'
      + '<span class="art">' + artImg + '<span class="ph"' + (img ? ' style="display:none"' : '') + '>' + icon('film') + '</span>'
      + '<span class="badge">' + (series.kind === 'collection' ? 'Série' : 'Seriál') + '</span></span>'
      + '<span class="cap"><span class="t">' + esc(series.title) + '</span>'
      + '<span class="y">' + esc(seriesMeta(series)) + '</span></span>'
      + '</button>';
  }

  function renderResults() {
    var grid = $('searchGrid');
    var html = '';
    for (var i = 0; i < state.entries.length; i++) {
      var e = state.entries[i];
      html += e.type === 'series' ? seriesCardHtml(e.series, i) : movieCardHtml(e.movie, i);
    }
    grid.innerHTML = html;
    var cards = grid.querySelectorAll('.card');
    for (var c = 0; c < cards.length; c++) {
      (function (el) {
        el.addEventListener('click', function () {
          var entry = state.entries[parseInt(el.getAttribute('data-idx'), 10)];
          if (!entry) return;
          if (entry.type === 'series') openSeries(entry.series);
          else openMovieDetail(entry.movie);
        });
      })(cards[c]);
    }
  }

  /* ------------------------------------------------------------------ *
   *  Seriál – seznam dílů a dotahování dalších stránek hledání na pozadí
   * ------------------------------------------------------------------ */
  var SERIES_MAX_PAGES = 10;
  var seriesToken = 0;   // zavření starého seriálu zastaví jeho stránkování

  function setSeriesNote(text) {
    var el = $('seriesNote');
    if (!text) { el.textContent = ''; hide(el); return; }
    el.textContent = text;
    show(el);
  }

  // Jeden díl = jedno video: z uploadů téhož dílu vybereme nejlepší (kvalita, pak CZ dabing).
  function variantScore(v) {
    var t = String(v.title || '').toLowerCase();
    var q = 1;
    if (/2160p|\b4k\b|uhd|ultra\s*hd/.test(t)) q = 4;
    else if (/1080p|full\s*hd|\bfhd\b/.test(t)) q = 3;
    else if (/720p/.test(t)) q = 2;
    var cz = /dabing|dab\b|\bcz\b/.test(t) ? 1 : 0;
    return q * 10 + cz;
  }

  function bestVariant(ep) {
    var best = ep.variants[0];
    for (var i = 1; i < ep.variants.length; i++) {
      if (variantScore(ep.variants[i]) > variantScore(best)) best = ep.variants[i];
    }
    return best;
  }

  function episodeHtml(ep, series) {
    var v = bestVariant(ep);
    var label = String(v.name || v.title || '').replace(/\s+/g, ' ').trim();
    if (label.length > 58) label = label.slice(0, 55) + '…';
    // Kolekce nemá čísla dílů - u filmu bez roku se popisek prostě vynechá.
    var collection = series && series.kind === 'collection';
    var num = ep.num || (collection ? '' : 'Epizoda ' + ep.episode);
    return '<div class="ep-row">' + (num ? '<span class="ep-num">' + esc(num) + '</span>' : '') + '<div class="ep-srcs">'
      + '<button class="f ep-src" type="button" data-ep-url="' + esc(v.url) + '"'
      + ' data-fk="' + esc(String(ep.season == null ? 'x' : ep.season) + 'e' + ep.episode + '-0') + '"'
      + ' title="' + esc(v.title || '') + '">' + esc(label) + '</button>'
      + '</div></div>';
  }

  function seriesPageHtml(series) {
    var html = '';
    for (var i = 0; i < series.seasons.length; i++) {
      var s = series.seasons[i];
      var col = series.kind === 'collection';
      var head = col ? (series.unit === 'dil' ? 'Díly' : 'Filmy')
                     : (s.season == null ? 'Díly' : esc(s.season + '. série'));
      var count = col
        ? (series.unit === 'dil' ? czCount(s.episodes.length, 'díl', 'díly', 'dílů')
                                 : czCount(s.episodes.length, 'film', 'filmy', 'filmů'))
        : czCount(s.episodes.length, 'díl', 'díly', 'dílů');
      html += '<section class="season"><div class="season-head"><h2>' + head + '</h2><span>'
        + count + '</span></div>';
      for (var j = 0; j < s.episodes.length; j++) html += episodeHtml(s.episodes[j], series);
      html += '</section>';
    }
    return html;
  }

  function bindEpisodeButtons() {
    var btns = $('seriesBody').querySelectorAll('[data-ep-url]');
    for (var i = 0; i < btns.length; i++) {
      (function (el) {
        el.addEventListener('click', function () {
          var u = el.getAttribute('data-ep-url');
          if (!state.series) return;
          for (var r = 0; r < state.series.raw.length; r++) {
            if (state.series.raw[r].movie.url === u) { playEpisode(state.series.raw[r].movie); return; }
          }
        });
      })(btns[i]);
    }
  }

  function renderSeriesBody(keepFocus) {
    var active = keepFocus ? document.activeElement : null;
    var fk = (active && active.getAttribute) ? active.getAttribute('data-fk') : null;
    $('seriesBody').innerHTML = seriesPageHtml(state.series);
    $('seriesMeta').textContent = seriesMeta(state.series);
    bindEpisodeButtons();
    if (fk) {
      var back = $('seriesBody').querySelector('[data-fk="' + fk + '"]');
      if (back) focusEl(back);
    }
  }

  function openSeries(series) {
    lastFocus = document.activeElement;
    state.series = series;
    state.seriesQuery = state.query;
    seriesToken++;
    var token = seriesToken;
    var img = series.poster || thumbUrl(series.title);
    $('seriesTitle').textContent = series.title || 'Seriál';
    $('seriesBg').style.backgroundImage = 'url("' + img + '")';
    $('seriesPoster').src = img;
    $('seriesPoster').style.visibility = series.poster ? 'visible' : 'hidden';
    setSeriesNote(null);
    renderSeriesBody(false);
    show($('series'));
    var first = $('seriesBody').querySelector('.f');
    focusEl(first || $('seriesClose'));
    loadSeriesPages(token, 2, 0);
  }

  function closeSeries() {
    seriesToken++;
    state.series = null;
    hide($('series'));
  }


  function findNextEpisode(series, currentUrl) {
    if (!series || !series.seasons || !currentUrl) return null;
    var flat = [];
    for (var i = 0; i < series.seasons.length; i++) {
      var sn = series.seasons[i];
      var eps = sn && sn.episodes ? sn.episodes : [];
      for (var j = 0; j < eps.length; j++) {
        var ep = eps[j];
        var v = (typeof bestVariant === 'function') ? bestVariant(ep) : (ep && ep.variants ? ep.variants[0] : null);
        if (!v || !v.url) continue;
        var sl = (ep.season != null ? ('S' + ep.season) : (sn && sn.season != null ? ('S' + sn.season) : ''));
        var en = (ep.episode != null ? ('E' + ep.episode) : '');
        var label = (sl || en) ? (sl + en) : (ep.num || ep.label || '');
        var name = String(v.name || v.title || ep.label || '').replace(/\s+/g,' ').trim();
        flat.push({ url: v.url, title: v.title || name, name: name, label: label, thumbnail: v.thumbnail || series.poster || '', ep: ep, variant: v });
      }
    }
    for (var k = 0; k < flat.length; k++) {
      if (flat[k].url === currentUrl) {
        if (k + 1 < flat.length) return { seriesTitle: series.title || 'Seriál', next: flat[k + 1] };
        return null;
      }
    }
    return null;
  }
  function hideNextEpPrompt() {
    player.nextEpShown = false;
    var el = $('pNext'); if (el) el.hidden = true;
  }
  function showNextEpPrompt(info) {
    if (!info || !info.next) return;
    var el = $('pNext'), t = $('pNextTitle');
    if (!el || !t) return;
    var wasBar = false; try { wasBar = (document.activeElement === $('pBar') || !!(document.activeElement && document.activeElement.closest && document.activeElement.closest('#pBar'))); } catch(_){}
    var n = info.next;
    var txt = (info.seriesTitle ? (info.seriesTitle + ' · ') : '') + (n.label ? (n.label + (n.name ? ' – ' + n.name : '')) : (n.name || n.title || 'Další díl'));
    t.textContent = txt;
    var im = $('pNextImg'); if (im) { if (n.thumbnail) { im.src = n.thumbnail; im.hidden = false; } else { im.removeAttribute('src'); im.hidden = true; } }
    el.hidden = false;
    player.nextEpShown = true;
    if (wasBar) { try { focusEl($('pNextPlay')); } catch(_){ } }
  }
  function playNextEp() {
    var info = player.nextEpInfo;
    hideNextEpPrompt();
    if (!info || !info.next || !info.next.url) return;
    var nextUrl = info.next.url;
    try {
      player.nextEpInfo = (state.series) ? findNextEpisode(state.series, nextUrl) : null;
      player.nextEpShown = false; player.nextEpDismissed = false;
      player._keepNextEp = !!player.nextEpInfo;
    } catch(_){ player.nextEpInfo = null; player._keepNextEp = false; }
    playMovie({ url: nextUrl, title: info.next.title || info.next.name || 'Další díl', thumbnail: info.next.thumbnail || player.poster || '' });
  }
  function checkNextEpisodePrompt() {
    try {
      if (!$('player') || $('player').hidden) return;
      if (player.kind === 'live') return;
      if (!player.nextEpInfo || !player.nextEpInfo.next) return;
      if (player.nextEpShown || player.nextEpDismissed) return;
      var d = video.duration, t = video.currentTime;
      if (!isFinite(d) || d <= 0 || !isFinite(t)) return;
      var remain = d - t;
      if (remain <= 18 && remain > 1.5) showNextEpPrompt(player.nextEpInfo);
    } catch(_){}
  }

  function playEpisode(movie) {
    lastFocus = document.activeElement;
    try {
      player.nextEpInfo = (state.series && movie && movie.url) ? findNextEpisode(state.series, movie.url) : null;
      player.nextEpShown = false; player.nextEpDismissed = false;
      player._keepNextEp = true;
    } catch(_){ player.nextEpInfo = null; player._keepNextEp = false; }
    playMovie({ url: movie.url, title: movie.title, thumbnail: (state.series && state.series.poster) || '' });
  }

  // Další stránky: přidává jen díly stejného seriálu, končí když nic nového
  // nepřijde dvakrát po sobě, když dojdou výsledky nebo po 10 stranách.
  function loadSeriesPages(token, page, emptyStreak) {
    if (token !== seriesToken || !state.series) return;
    if (page > SERIES_MAX_PAGES) { setSeriesNote(null); return; }
    setSeriesNote('Načítám další díly…');
    apiJson('/api/search?q=' + encodeURIComponent(state.seriesQuery) + '&page=' + page + (settings.searchMerge ? '&source=all' : '')).then(function (d) {
      if (token !== seriesToken || !state.series) return;
      var movies = (d && d.success && d.movies) ? d.movies : [];
      if (!movies.length) { setSeriesNote('Další díly už nejsou.'); return; }
      var res = mergeSeriesMovies(state.series, movies);
      var streak = res.added ? 0 : emptyStreak + 1;
      if (res.added) {
        state.series = res.series;
        renderSeriesBody(true);
      }
      if (streak >= 2) { setSeriesNote('Další díly už nejsou.'); return; }
      loadSeriesPages(token, page + 1, streak);
    }).catch(function () {
      if (token !== seriesToken) return;
      setSeriesNote('Další díly se nepodařilo načíst.');
    });
  }

  /* ------------------------------------------------------------------ *
   *  Detail
   * ------------------------------------------------------------------ */
  function closeDetail() {
    hide($('detail'));
    state.detail = null;
  }

  function openCatalogDetail(it) {
    lastFocus = document.activeElement;
    state.detail = { kind: 'catalog', item: it };
    var img = itemImg(it) || thumbUrl(itemTitle(it));
    $('detailBg').style.backgroundImage = 'url("' + img + '")';
    $('detailPoster').src = img;
    $('detailPoster').style.visibility = 'visible';
    $('detailTitle').textContent = itemTitle(it);
    var g = itemGenres(it);
    var dm = [];
    if (itemYear(it)) dm.push(String(itemYear(it)));
    for (var di = 0; di < g.length && di < 3; di++) dm.push(g[di]);
    $('detailMeta').textContent = dm.join(' · ');
    $('detailNote').textContent = '';
    hide($('detailDl'));
    updateDetailFav();
    bindDetailActions(function () { searchThenPlay(itemQuery(it)); });
    show($('detail'));
    focusEl($('detailPlay'));
  }

  function openMovieDetail(m) {
    lastFocus = document.activeElement;
    state.detail = { kind: 'movie', movie: m };
    var img = m.thumbnail || thumbUrl(m.title);
    $('detailBg').style.backgroundImage = 'url("' + img + '")';
    $('detailPoster').src = img;
    $('detailPoster').style.visibility = 'visible';
    $('detailTitle').textContent = m.title || 'Video';
    $('detailMeta').textContent = m.year ? String(m.year) : '';
    $('detailNote').textContent = '';
    if (Native && typeof Native.download === 'function') {
      show($('detailDl'));
    } else {
      hide($('detailDl'));
    }
    updateDetailFav();
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
    if (Native && typeof Native.download === 'function' && state.detail && state.detail.kind === 'movie') {
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
    /* Zavřený překryv má vrátit fokus tam, odkud se otevřel (karta v řadě). */
    var back = lastFocus;
    lastFocus = null;
    if (back && isVisible(back)) { focusEl(back); return; }
    var list = focusables();
    if (list.length) focusEl(list[0]);
  }

  /* Z katalogu: najdi film a ukaž výsledky hledání (nic se nespouští samo) */
  function searchThenPlay(q) {
    loading('Hledám „' + q + '“ …');
    apiJson('/api/search?q=' + encodeURIComponent(q) + (settings.searchMerge ? '&source=all' : '')).then(function (d) {
      loading(null);
      if (!d || !d.success || !(d.movies || []).length) {
        toast('Pro „' + q + '“ prehraj.to nic nenašel.');
        return;
      }
      // Jen ukážeme výsledky hledání – nic se samo nespouští ani neotevírá.
      var ranked = rankMovies(q, d.movies);
      state.results = ranked;
      state.entries = groupSearchResults(ranked);
      state.query = q;
      closeDetail();
      setView('search');
      setSearchText(q);
      $('searchState').className = 'state show';
      $('searchState').textContent = 'Nalezeno ' + state.entries.length + ' výsledků pro „' + q + '“';
      renderResults();
      var firstCard = $('searchGrid').querySelector('.f.card');
      if (firstCard) focusEl(firstCard);
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
    html += '<span class="chip-sep" aria-hidden="true"></span>';
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
      showStateError(st, e.message + ' – zkontroluj adresu serveru a jestli backend /api/live povoluje CORS.');
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
    try{ if(typeof clearStallRecovery==='function') clearStallRecovery(); }catch(_){} try{ stallNudges=0; }catch(_){}
    destroyHls();
    try { video.pause(); } catch (e) { }
    video.removeAttribute('src');
    try { video.load(); } catch (e) { }
    var tracks = video.querySelectorAll('track');
    for (var i = 0; i < tracks.length; i++) tracks[i].parentNode.removeChild(tracks[i]);
    player.subs = [];
    player.subIndex = -1;
    $('pSub').textContent = 'Titulky';
    $('pSub').disabled = true;
    try { hideNextEpPrompt(); } catch(_){}
  }

  function openPlayer(kind, title) {
    player.kind = kind;
    player.title = title || '';
    player.mode = settings.direct ? 'direct' : 'relay';
    player.triedRelay = false;
    player.nextEpShown = false; player.nextEpDismissed = false;
    try { hideNextEpPrompt(); } catch(_){ }
    $('pTitle').textContent = title || '';
    $('pLive').hidden = kind !== 'live';
    $('pPlay').style.display = kind === 'live' ? 'none' : '';
    $('pBar').style.display = kind === 'live' ? 'none' : '';
    $('pTime').style.display = kind === 'live' ? 'none' : '';
    $('pSub').style.display = kind === 'live' ? 'none' : '';
    // Přehrát na TV: jen v mobilní/tabletové aplikaci (na TV samotné nemá smysl).
    $('pCast').style.display = canCast() ? '' : 'none';
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
    setTimeout(function(){ try{ if($('player')&&$('player').hidden) return; if(player.kind!=='live' && $('pBar') && $('pBar').style.display!=='none') focusEl($('pBar')); else focusEl($('pBack')); }catch(_){} }, 0);
  }

  function closePlayer() {
    var t = video.currentTime;
    try { saveVideoProgress(true); } catch(_){}
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
        applyResumeIfNeeded();
        play();
      });
      return;
    }
    // nativní HLS (Safari/iOS) i běžné mp4
    video.addEventListener('loadedmetadata', function(){ applyResumeIfNeeded(); }, { once: true });
    video.src = src;
    play();
  }

  function play() {
    var p = video.play();
    if (p && typeof p.catch === 'function') {
      p.catch(function () { setPlayerState('Připraveno. Stiskni Přehrát.'); });
    }
  }

  /* Živé vysílání se nedá pozastavit (tlačítko, dotyk, dálkové ovládání, systém). */
  function liveLocked() { return player.kind === 'live' && !$('player').hidden; }

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
    try { video.pause(); } catch(_){}
    video.currentTime = Math.min(d - 0.3, Math.max(0, video.currentTime + sec));
    updateProgress();
    bumpIdle();
  }

  function seekFraction(f) {
    if (player.kind === 'live') return;
    var d = video.duration;
    if (!isFinite(d) || d <= 0) return;
    try { video.pause(); } catch(_){}
    video.currentTime = Math.max(0, Math.min(d - 0.3, d * f));
    updateProgress();
    bumpIdle();
  }

  video.addEventListener('timeupdate', function(){ updateProgress(); checkNextEpisodePrompt(); if(!player._lastProgSave || Date.now()-player._lastProgSave>5000) saveVideoProgress(false); });
  video.addEventListener('progress', updateProgress);
  video.addEventListener('durationchange', updateProgress);
  video.addEventListener('play', function () { $('pPlay').textContent = 'Pozastavit'; bumpIdle(); });
  video.addEventListener('pause', function () {
    $('pPlay').textContent = 'Přehrát';
    $('player').classList.remove('idle');
    try{ saveVideoProgress(true); }catch(_){}
  });
  // Kdyby live stream pozastavilo něco jiného (systém, tlačítko na ovladači), hned se rozběhne.
  video.addEventListener('pause', function () {
    if (!liveLocked() || document.hidden || video.ended) return;
    setTimeout(function () {
      if (liveLocked() && video.paused && !document.hidden && video.currentSrc) play();
    }, 60);
  });

  var stallTimer = null, stallNudges = 0;
  function clearStallRecovery(){ if(stallTimer){ clearTimeout(stallTimer); stallTimer=null; } }
  function nudgeStalledStream(){ try{
    if($('player')&&$('player').hidden) return;
    if(player.kind==='live') return;
    if(video.ended) return;
    if(player._stallBusy) return;
    if(video.readyState >= 3 && !video.paused) return; // has data/playing enough
    var d = video.duration, t = video.currentTime;
    var resumeAt = (isFinite(t) ? t : 0);
    if(isFinite(d) && d>2) resumeAt = Math.min(d - 1, Math.max(0, resumeAt));
    // plná obnova streamu jako na webu: čerstvý odkaz/zdroj, reload, návrat na stejnou pozici
    if(player.page && typeof apiJson === 'function'){
      player._stallBusy = true;
      setPlayerState('Stream se zasekl – obnovuji přehrávání…');
      apiJson('/api/proxy?url=' + encodeURIComponent(player.page) + '&_=' + Date.now(), 30000).then(function(data){
        if(!$('player')||$('player').hidden||player.kind==='live') return;
        if(!data || !data.success || !data.videoUrl){ player._stallBusy=false; if(player.page && !player.triedRelay) switchToRelay(resumeAt); return; }
        player.cdn = data.videoUrl;
        try { setSubtitles(data.subtitles || []); } catch(_){}
        var isHls = /\.m3u8(\?|$)/i.test(data.videoUrl);
        var src = (!settings.direct && !isHls) ? streamUrl(player.page, false, player.title, data.videoUrl) : data.videoUrl;
        player._resumeApplied = false; player.resumeAt = resumeAt;
        video.addEventListener('loadedmetadata', function(){ try{ applyResumeIfNeeded(); }catch(_){} }, { once: true });
        attachSource(src, isHls, { onFatal: function(){ if(player.page && !player.triedRelay) switchToRelay(resumeAt); } });
      }).catch(function(){
        // fallback: přepnutí přes relay
        if(player.page && !player.triedRelay) switchToRelay(resumeAt);
        else try{ var p=video.play(); if(p&&p.catch) p.catch(function(){}); }catch(_){}
      }).then(function(){ player._stallBusy=false; }, function(){ player._stallBusy=false; });
      return;
    }
    if(player.page && !player.triedRelay) switchToRelay(resumeAt);
  }catch(_){} }
  function scheduleStallRecovery(){ try{
    if(player.kind==='live' || video.ended) return;
    if(stallNudges >= 3) return;
    clearStallRecovery();
    stallTimer = setTimeout(function(){ stallTimer=null; if(player.kind==='live'||video.ended||($('player')&&$('player').hidden)) return; if(video.readyState < 3){ stallNudges++; nudgeStalledStream(); scheduleStallRecovery(); } }, 7000);
  }catch(_){} }

  video.addEventListener('waiting', function () { setPlayerState('Načítám stream…'); scheduleStallRecovery(); });
  video.addEventListener('playing', function () { setPlayerState(null); bumpIdle(); stallNudges=0; clearStallRecovery(); });
  video.addEventListener('canplay', function(){ clearStallRecovery(); if(video.readyState>=3 && player.kind!=='live') setPlayerState(null); });
  video.addEventListener('stalled', function(){ if(player.kind!=='live') scheduleStallRecovery(); });
  video.addEventListener('ended', function () {
    var d = video.duration;
    var finished = isFinite(d) && d > 0 && video.currentTime >= d - 1.5;
    if (finished) {
      // Film dohrál do konce – není to chyba CDN, nic nepřepínáme.
      try { clearVideoProgress(player.resumeKey || player.page); } catch(_){}
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
      if (liveLocked()) { bumpIdle(); return; }
      if (video.paused) play(); else video.pause();
      bumpIdle();
    }
  });

  $('pPlay').addEventListener('click', function () {
    if (liveLocked()) return;
    if (video.ended) { video.currentTime = 0; }
    if (video.paused) play(); else video.pause();
    bumpIdle();
  });
  $('pBack').addEventListener('click', function () { closePlayer(); renderRows(); focusAfterOverlay(); });
  
    var pNextPlay = $('pNextPlay'), pNextCancel = $('pNextCancel');
    if (pNextPlay) pNextPlay.addEventListener('click', function(e){ if(e){e.preventDefault&&e.preventDefault();e.stopPropagation&&e.stopPropagation();} playNextEp(); });
    if (pNextCancel) pNextCancel.addEventListener('click', function(e){ if(e){e.preventDefault&&e.preventDefault();e.stopPropagation&&e.stopPropagation();} player.nextEpDismissed=true; hideNextEpPrompt(); });

    $('pRelay').addEventListener('click', function () { switchToRelay(video.currentTime); });

  // Přehrát na TV: otevře systémové "Přenést obrazovku" (Google Cast / Miracast / Smart View).
  // Video pak hraje dál v aplikaci a zrcadlí se na vybranou TV.
  function canCast() {
    if (!Native || typeof Native.castScreen !== 'function') return false;
    try { if (typeof Native.isTV === 'function' && Native.isTV()) return false; } catch (e) { }
    return true;
  }
  $('pCast').addEventListener('click', function () {
    var ok = false;
    try { ok = !!Native.castScreen(); } catch (e) { }
    toast(ok ? 'Zapni Přenést obrazovku (Smart View, Screen Cast) a vyber TV. U LG televize spusť aplikaci Sdílení obrazovky. Pak se vrať sem.' : 'Tohle zařízení přenos obrazovky nepodporuje. Otevři Wflix v prohlížeči na TV.', 6000);
  });

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
    player.poster = m.thumbnail || '';
    player.title = m.title || 'Video';
    player.resumeKey = m.url || '';
    try { player.resumeAt = getSavedProgress(player.resumeKey); } catch(_){ player.resumeAt = 0; }
    player._resumeApplied = false;
    if (!player._keepNextEp) { player.nextEpInfo = null; player.nextEpDismissed = false; }
    player._keepNextEp = false;
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
      + '    <button class="f btn ghost" type="button" id="setTest">Otestovat</button>'
      + '    <button class="f btn ghost" type="button" id="setHealth">Status</button>'
      + '  </div>'
      + '</div>'
      + '<div class="set-row">'
      + '  <div class="lab"><b>Přímé přehrávání z CDN</b><span>Když vypneš, video jde hned přes server (pomalejší, ale spolehlivější).</span></div>'
      + '  <div class="set-actions"><button class="f btn ghost" type="button" id="setDirect">' + (settings.direct ? 'Zapnuto' : 'Vypnuto') + '</button></div>'
      + '</div>'
      + '<div class="set-row">'
      + '  <div class="lab"><b>Více výsledků</b><span>Experimentální: hledá na Prehraj.to, Sledujteto a Bombuj najednou. Když jeden zdroj selže, použijí se ostatní; chyba jen když selžou všechny.</span></div>'
      + '  <div class="set-actions"><button class="f btn ghost" type="button" id="setSearchMerge">' + (settings.searchMerge ? 'Zapnuto' : 'Vypnuto') + '</button></div>'
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
      + '  <div class="lab"><b>Velikost titulků</b><span>Pro filmy s titulky (WebVTT).</span></div>'
      + '  <div class="set-actions"><button class="f btn ghost" type="button" id="setSubSize">' + esc(subSizeLabel()) + '</button></div>'
      + '</div>'
      + '<div class="set-row">'
      + '  <div class="lab"><b>Pozadí titulků</b><span>Čtecí pruh pod textem titulků.</span></div>'
      + '  <div class="set-actions"><button class="f btn ghost" type="button" id="setSubBg">' + esc(subBgLabel()) + '</button></div>'
      + '</div>'
      + '<div class="set-row">'
      + '  <div class="lab"><b>O aplikaci</b><span>Wflix klient ' + VERSION + ' · ' + (isTV ? 'TV' : 'mobil') + ' · ' + (Native ? 'nativní most' : 'webový režim') + '</span></div>'
      + '  <div class="set-actions"><button class="f btn ghost" type="button" id="setAbout">Co to je?</button></div>'
      + '</div>';
    $('settingsList').innerHTML = html;

    $('setTest').addEventListener('click', function () {
      loading('Testuji server…');
      apiJson('/api/live?country=cz', 20000).then(function (d) {
        loading(null);
        toast(d && d.success ? 'Server odpovídá, ' + ((d.channels || []).length) + ' kanálů' : 'Server odpověděl, ale bez dat.');
      }).catch(function (e) {
        loading(null);
        toast('Server neodpovídá: ' + e.message, 4500);
      });
    });
    var setHealth = $('setHealth');
    if (setHealth) setHealth.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); openHealthOverlay(setHealth); });
    $('setDirect').addEventListener('click', function () {
      settings.direct = !settings.direct;
      saveSettings();
      renderSettings();
      focusEl($('setDirect'));
      toast('Přímé přehrávání: ' + (settings.direct ? 'zapnuto' : 'vypnuto'));
    });
    $('setSearchMerge').addEventListener('click', function () {
      // Experimental: source=all merge (Prehraj.to + Sledujteto + Bombuj), tolerant to single-source failures.
      settings.searchMerge = !settings.searchMerge;
      saveSettings();
      renderSettings();
      focusEl($('setSearchMerge'));
      toast('Více výsledků: ' + (settings.searchMerge ? 'zapnuto' : 'vypnuto'));
    });
    $('setLang').addEventListener('click', function () {
      settings.lang = settings.lang === 'en' ? 'cz' : 'en';
      saveSettings();
      renderSettings();
      focusEl($('setLang'));
      loadHome();
    });
    $('setLive').addEventListener('click', function () {
      var ids = LIVE_SOURCES.map(function (s) { return s.id; });
      var i = ids.indexOf(settings.live);
      settings.live = ids[(i + 1) % ids.length];
      saveSettings();
      renderSettings();
      focusEl($('setLive'));
      state.liveFilter = settings.live;
      state.channels = [];
      renderLiveChips();
    });
    $('setSubSize').addEventListener('click', function () {
      settings.subSize = cycleIn(CUE_SIZES, settings.subSize);
      saveSettings();
      applyCueStyle();
      renderSettings();
      focusEl($('setSubSize'));
      toast('Velikost titulků: ' + subSizeLabel());
    });
    $('setSubBg').addEventListener('click', function () {
      settings.subBg = cycleIn(CUE_BACKGROUNDS, settings.subBg);
      saveSettings();
      applyCueStyle();
      renderSettings();
      focusEl($('setSubBg'));
      toast('Pozadí titulků: ' + subBgLabel());
    });
    $('setAbout').addEventListener('click', function () {
      toast('Wflix hledá na prehraj.to a přehrává přes CDN nebo server. Obsah nehostuje.', 6000);
    });
  }

  function liveLabel(id) {
    for (var i = 0; i < LIVE_SOURCES.length; i++) if (LIVE_SOURCES[i].id === id) return LIVE_SOURCES[i].label;
    return 'Česko';
  }

  /* ------------------------------------------------------------------ *
   *  Klávesy / dálkové ovládání
   * ------------------------------------------------------------------ */
  function showStateError(st, msg) {
    if (!st) return;
    try {
      st.className = 'state show err';
      st.innerHTML = '<div>' + esc(String(msg || 'Chyba')) + '</div><div class="health-inline"><button class="f btn ghost" type="button" data-open-health="1">Status</button></div>';
      var btn = st.querySelector('[data-open-health]');
      if (btn) btn.addEventListener('click', function (e) { if(e){e.preventDefault&&e.preventDefault();e.stopPropagation&&e.stopPropagation();} try{openHealthOverlay(btn);}catch(_){} });
    } catch(e) { try { st.textContent = String(msg||'Chyba'); } catch(_){} }
  }

  function healthFormatRows(items, nameKey) {
    try {
      if (!items || !items.length) return '<div class="health-row"><span class="err">Žádná data.</span></div>';
      var out = '';
      for (var i = 0; i < items.length; i++) {
        var it = items[i] || {};
        var ok = !!(it.ok === true || it.status === 200 || it.note === 'mapped' || it.success === true);
        var name = esc(String(it[nameKey] || it.endpoint || it.name || it.check || it.url || '—'));
        var statusText = it.status != null ? ('HTTP ' + esc(String(it.status))) : (it.note ? esc(String(it.note)) : '');
        var ms = (it.ms != null || it.latency != null) ? (esc(String(it.ms != null ? it.ms : it.latency)) + ' ms') : '';
        var err = it.error ? esc(String(it.error)) : (it.message && !ok ? esc(String(it.message)) : '');
        out += '<div class="health-row"><span class="name">' + name + '</span><span class="st ' + (ok ? 'ok' : 'bad') + '">' + (ok ? 'OK' : 'Chyba') + '</span>'
          + '<span class="meta">' + statusText + (ms ? (' · ' + ms) : '') + '</span><span class="err">' + err + '</span></div>';
      }
      return out;
    } catch(e) { return '<div class="health-row"><span class="err">Chyba formátování.</span></div>'; }
  }
  function renderHealthData(data, httpStatus) {
    try {
      var overall = data && (data.ok === true || data.success === true || data.status === 'ok' || data.healthy === true);
      var html = '<div class="health-summary"><span class="health-badge ' + (overall ? 'ok' : 'bad') + '">' + (overall ? 'OK' : 'Problém') + '</span>'
        + '<span>/api/health' + (httpStatus ? (' · HTTP ' + esc(String(httpStatus))) : '') + '</span></div>';
      var checks = data && (data.checks || data.results || data.probes);
      var endpoints = data && (data.endpoints || data.handlers);
      var upstreams = data && (data.upstreams || data.upstream || data.services);
      if (checks) html += '<div class="health-section"><h3>Kontroly</h3>' + healthFormatRows(checks, 'endpoint') + '</div>';
      if (endpoints && endpoints !== checks) html += '<div class="health-section"><h3>Endpointy</h3>' + healthFormatRows(endpoints, 'endpoint') + '</div>';
      if (upstreams) html += '<div class="health-section"><h3>Upstreamy</h3>' + healthFormatRows(upstreams, 'name') + '</div>';
      if (!checks && !endpoints && !upstreams && data) html += '<div class="health-section"><h3>Odpověď</h3><pre>' + esc(JSON.stringify(data, null, 2)) + '</pre></div>';
      if (!data) html += '<div class="health-section"><pre>Bez dat</pre></div>';
      html += '<details class="health-section"><summary>Raw JSON</summary><pre>' + esc(JSON.stringify(data, null, 2)) + '</pre></details>';
      return html;
    } catch(e) { return '<div class="health-section"><pre>' + esc(String(e && e.message || e)) + '</pre></div>'; }
  }
  function closeHealthOverlay() {
    try {
      var dlg = $('health');
      if (!dlg || dlg.hidden) return;
      dlg.hidden = true; try{dlg.style.display='none';}catch(_){}
      if (typeof hide === 'function') { try { hide(dlg); } catch(_){} }
      if (typeof focusAfterOverlay === 'function') { try { focusAfterOverlay(); } catch(_){} }
    } catch(e) {}
  }
  function openHealthOverlay(fromEl) {
    try {
      var dlg = $('health'), content = $('healthContent');
      if (!dlg || !content) { if (typeof toast==='function') toast('Status overlay není k dispozici.'); return; }
      try { if (fromEl) lastFocus = fromEl; else if (document.activeElement && document.activeElement !== document.body) lastFocus = document.activeElement; } catch(_){}
      content.innerHTML = '<span class="spinner"></span> Načítám /api/health…';
      dlg.hidden = false; try{dlg.style.display='';}catch(_){}
      if (typeof show === 'function') { try { show(dlg); } catch(_){} }
      try { var closeBtn = $('healthClose'); if (closeBtn) { if (typeof focusEl === 'function') focusEl(closeBtn); else if (closeBtn.focus) closeBtn.focus(); } } catch(_){}
      var done = false;
      var finish = function(data, status) { if (done) return; done = true; try { if (!dlg.hidden) content.innerHTML = renderHealthData(data, status); } catch(_){} };
      try {
        var p = apiJson('/api/health?ts=' + Date.now(), 15000);
        if (p && p.then) p.then(function (d) {
          var st = 200; try { if (d && d._httpStatus) st = d._httpStatus; } catch(_){}
          finish(d, st);
        }).catch(function (e) { finish({ ok: false, error: e && e.message ? e.message : String(e) }, 0); });
        else finish({ ok:false, error:'Neočekávaná odpověď apiJson.' }, 0);
      } catch(e) { finish({ ok: false, error: String(e && e.message || e) }, 0); }
      setTimeout(function(){ if(!done) finish({ok:false,error:'Timeout při načítání /api/health.'},0); }, 16000);
    } catch(e) { try { if(typeof toast==='function') toast('Chyba: '+(e&&e.message||e)); } catch(_){} }
  }

  function closeOverlays() {
    var health = $('health');
    if (health && !health.hidden) { closeHealthOverlay(); return true; }
    if (!$('kbd').hidden) { hide($('kbd')); return true; }
    if (!$('player').hidden) { closePlayer(); renderRows(); focusAfterOverlay(); return true; }
    if (!$('detail').hidden) { closeDetail(); focusAfterOverlay(); return true; }
    if (!$('series').hidden) { closeSeries(); focusAfterOverlay(); return true; }
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

  /* Pole, do kterého se píše – tam klávesy patří poli, ne navigaci. */
  function isTextField(el) {
    if (!el || !el.tagName) return false;
    if (el.tagName === 'TEXTAREA' || el.isContentEditable) return true;
    if (el.tagName !== 'INPUT') return false;
    var t = (el.getAttribute('type') || 'text').toLowerCase();
    return ['text', 'search', 'url', 'email', 'tel', 'password', 'number'].indexOf(t) !== -1;
  }

  /* Fyzická klávesnice při otevřené obrazovkové klávesnici: znaky se píší,
     Backspace maže, Enter potvrdí (jen když už se psalo fyzicky). */
  function kbdPhysicalKey(e) {
    var k = e.key;
    if (!k || e.ctrlKey || e.metaKey || e.altKey) return false;
    if (k === 'Backspace') { e.preventDefault(); kbdState.physical = true; kbdPress('__back'); return true; }
    if (k === 'Enter' && kbdState.physical) { e.preventDefault(); kbdPress('__ok'); return true; }
    if (k.length === 1) { e.preventDefault(); kbdState.physical = true; kbdPress(k); return true; }
    return false;
  }

  function onKeyDown(e) {
    var k = e.key;
    var code = e.keyCode;

    // webOS dálkové ovládání
    if (code === 461) { e.preventDefault(); goBack(); return; }

    if (!$('kbd').hidden && kbdPhysicalKey(e)) return;
    var typing = isTextField(e.target) || isTextField(document.activeElement);
    if (liveLocked() && (k === 'MediaPause' || k === 'MediaPlayPause' || k === 'Pause' || code === 19 || code === 179)) {
      e.preventDefault(); bumpIdle(); return;   // živé vysílání nejde pozastavit
    }
    if (code === 415) { e.preventDefault(); if (!$('player').hidden) play(); return; }
    if (code === 19) { e.preventDefault(); if (!$('player').hidden) video.pause(); return; }
    if (code === 412) { e.preventDefault(); if (!$('player').hidden) seekBy(-10); return; }
    if (code === 417) { e.preventDefault(); if (!$('player').hidden) seekBy(10); return; }

    var playerOpen = !$('player').hidden;
    var kbdOpen = !$('kbd').hidden;

    // Na TV v hledání píše i fyzická klávesnice; Backspace maže znak, dokud je co mazat.
    if (state.view === 'search' && !isTouch && !typing && !playerOpen && !kbdOpen
        && $('detail').hidden && $('series').hidden && k && !e.ctrlKey && !e.metaKey && !e.altKey) {
      if (k === 'Backspace' && $('searchInput').value) { e.preventDefault(); searchKey('__back'); return; }
      if (k.length === 1 && k !== ' ') { e.preventDefault(); searchKey(k.toLowerCase()); return; }
    }

    if (k) {
      // Backspace je „zpět“ jen mimo textové pole; v poli maže znaky.
      if (k === 'Escape' || k === 'GoBack' || k === 'BrowserBack' || (k === 'Backspace' && !typing)) {
        e.preventDefault();
        if (typing && document.activeElement && document.activeElement.blur) document.activeElement.blur();
        goBack();
        return;
      }
      if (typing && (k === 'ArrowLeft' || k === 'ArrowRight')) {
        // šipky uvnitř textu posouvají kurzor; z pole se vystoupí až na jeho kraji
        var fld = document.activeElement;
        var pos = fld && typeof fld.selectionStart === 'number' ? fld.selectionStart : 0;
        var end = fld && typeof fld.selectionEnd === 'number' ? fld.selectionEnd : 0;
        var len = fld && fld.value ? fld.value.length : 0;
        if (k === 'ArrowLeft' ? pos > 0 || end > 0 : pos < len || end < len) return;
      }
      if (k === 'ArrowLeft' || k === 'ArrowRight' || k === 'ArrowUp' || k === 'ArrowDown') {
        if (playerOpen) bumpIdle();
        var pFocused = playerOpen ? currentFocus() : null;
        if (playerOpen && pFocused === $('pBar')) {
          e.preventDefault();
          if (k === 'ArrowLeft') seekBy(-10);
          else if (k === 'ArrowRight') seekBy(10);
          else if (k === 'ArrowUp') focusEl($('pBack'));
          else focusEl($('pPlay') || $('pPause'));
          return;
        }
        // explicitní pořadí ovládání přehrávače: Zpět ↑↓ Posuvník ↑↓ Přehrát/Pauza (a další v řadě)
        if (playerOpen && pFocused) {
          if (pFocused === $('pBack') && k === 'ArrowDown') { e.preventDefault(); if($('pBar')&&$('pBar').style.display!=='none') focusEl($('pBar')); else focusEl($('pPlay')); return; }
          if (pFocused === $('pPlay') && k === 'ArrowUp') { e.preventDefault(); if($('pBar')&&$('pBar').style.display!=='none') focusEl($('pBar')); else focusEl($('pBack')); return; }
        }
        var moved;
        if (k === 'ArrowLeft') moved = moveFocus(-1, 0);
        else if (k === 'ArrowRight') moved = moveFocus(1, 0);
        else if (k === 'ArrowUp') moved = moveFocus(0, -1);
        else moved = moveFocus(0, 1);
        if (moved || kbdOpen || playerOpen) { e.preventDefault(); }
        return;
      }
      if (k === 'Enter') {
        var f = currentFocus();
        if (playerOpen && f === $('pBar')) {
          e.preventDefault();
          if (player.kind !== 'live') { if (video.paused) play(); else video.pause(); }
          return;
        }
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

  /* Záložka v detailu – přidá nebo odebere titul z oblíbených. */
  var detailFavBtn = $('detailFav');
  if (detailFavBtn) {
    detailFavBtn.addEventListener('click', function () {
      var item = detailItem();
      if (!item) return;
      var added = toggleFav(item);
      updateDetailFav();
      toast(added ? 'Přidáno do oblíbených' : 'Odebráno z oblíbených');
      focusEl(detailFavBtn);
    });
  }

  /* Android: když appka jde do pozadí, uložíme pozici a video pozastavíme,
     aby zvuk nehrál přes jiné aplikace. */
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) {
      if (liveLocked() && video.paused && video.currentSrc) play();   // live po návratu hned pokračuje
      return;
    }
    if (!$('player').hidden) {
      try { if (!video.paused) video.pause(); } catch (e) { }
    }
  });

  /* ------------------------------------------------------------------ *
   *  Start
   * ------------------------------------------------------------------ */
  /* Levý panel: kategorie skočí na řadu na úvodní stránce. */
  function openCategory(name, btn) {
    setView('home');
    var rows = $('rows').querySelectorAll('.row');
    var target = null;
    for (var i = 0; i < rows.length; i++) {
      var t = rows[i].querySelector('.row-title');
      if (t && t.textContent === name) { target = rows[i]; break; }
    }
    if (!target) {
      toast(name === 'Moje oblíbené' ? 'Zatím nemáš nic v oblíbených.' : 'V téhle kategorii zatím nic není.');
      return;
    }
    var main = $('main');
    main.scrollTop += target.getBoundingClientRect().top - main.getBoundingClientRect().top - 16;
    if (btn) btn.classList.add('active');
    var card = target.querySelector('.f');
    if (card) focusEl(card);
  }

  function startApp() {
    show($('shell'));
    setView('home');
    loadHome();
    renderLiveChips();
    renderSettings();
    if (settings.live) state.liveFilter = settings.live;
  }



  var LS_PROGRESS = 'wflix.progress';
  function progressKey(u){ return String(u||'').trim(); }
  function loadProgressMap(){ try {
    var v = JSON.parse(localStorage.getItem(LS_PROGRESS)||'{}');
    if(!v || typeof v!=='object') return {};
    var now=Date.now(), ttl=30*24*60*60*1000, out={}, changed=false;
    var ks=Object.keys(v); for(var i=0;i<ks.length;i++){ var k=ks[i], it=v[k];
      if(it && typeof it==='object' && isFinite(it.t) && (now-(it.ts||0)) <= ttl) out[k]=it; else changed=true; }
    if(changed) try{ localStorage.setItem(LS_PROGRESS, JSON.stringify(out)); }catch(_){}
    return out;
  } catch(_){ return {}; } }
  function saveProgressMap(m){ try {
    var now=Date.now(), ttl=30*24*60*60*1000, ks=Object.keys(m||{}), clean={};
    for(var j=0;j<ks.length;j++){ var k=ks[j], it=m[k]; if(it && (now-(it.ts||0)) <= ttl && isFinite(it.t)) clean[k]=it; }
    ks=Object.keys(clean);
    if(ks.length>80){ ks.sort(function(a,b){ return (clean[b].ts||0)-(clean[a].ts||0); }); var nm={}; for(var i=0;i<60&&i<ks.length;i++) nm[ks[i]]=clean[ks[i]]; clean=nm; }
    localStorage.setItem(LS_PROGRESS, JSON.stringify(clean));
  } catch(_){} }
  function getSavedProgress(u){ var m=loadProgressMap(), it=m[progressKey(u)]; if(!it||!isFinite(it.t)) return 0; return it.t; }
  function saveVideoProgress(force){ try{ if(!player||player.kind==='live'||!player.resumeKey) return; var d=video.duration, t=video.currentTime; if(!isFinite(d)||d<=0||!isFinite(t)) return; var k=progressKey(player.resumeKey); if(!k) return; if(!force && (t<8 || d-t<20)) return; var m=loadProgressMap(); m[k]={t:Math.floor(t), d:Math.floor(d), ts:Date.now()}; saveProgressMap(m); player._lastProgSave=Date.now(); }catch(_){} }
  function clearVideoProgress(u){ try{ var m=loadProgressMap(); delete m[progressKey(u||player.resumeKey)]; saveProgressMap(m); }catch(_){} }
  function applyResumeIfNeeded(){ try{ if(player.kind==='live'||!player.resumeAt||player._resumeApplied) return; var d=video.duration; if(!isFinite(d)||d<=0) return; var t=Math.max(0, Math.min(player.resumeAt, d-8)); if(t>5 && video.currentTime < Math.max(2, t-1)){ video.currentTime=t; try{ setPlayerState('Pokračuji od ' + formatTime(t) + '…'); }catch(_){} } player._resumeApplied=true; player.resumeAt=0; }catch(_){} }

  // Drag-to-scroll (mouse/pointer/touch drag) so content can be moved without only clicking.
  function addDragScroll(root, opts) {
    if (!root || root.__dragScroll) return;
    root.__dragScroll = true;
    opts = opts || {};
    var threshold = opts.threshold || 6;
    var dragging = false, moved = false, startX = 0, startY = 0, sl = 0, st = 0, pid = null;
    var axis = opts.axis || 'both'; // 'x','y','both'
    function onDown(e) {
      if (!e) return;
      if (e.pointerType === 'touch' && e.isPrimary === false) return;
      if (e.button != null && e.button !== 0 && e.pointerType !== 'touch') return;
      var t = e.target;
      // don't hijack explicit controls/inputs/range interactions
      if (t && t.closest && t.closest('input,textarea,select,.p-bar,[data-no-drag]')) return;
      dragging = true; moved = false; pid = (e.pointerId != null ? e.pointerId : 'mouse');
      startX = e.clientX != null ? e.clientX : (e.touches && e.touches[0] ? e.touches[0].clientX : 0);
      startY = e.clientY != null ? e.clientY : (e.touches && e.touches[0] ? e.touches[0].clientY : 0);
      sl = root.scrollLeft || 0; st = root.scrollTop || 0;
    }
    function onMove(e) {
      if (!dragging) return;
      if (pid !== 'mouse' && e.pointerId != null && e.pointerId !== pid) return;
      var x = e.clientX != null ? e.clientX : (e.touches && e.touches[0] ? e.touches[0].clientX : startX);
      var y = e.clientY != null ? e.clientY : (e.touches && e.touches[0] ? e.touches[0].clientY : startY);
      var dx = x - startX, dy = y - startY;
      if (!moved && (Math.abs(dx) > threshold || Math.abs(dy) > threshold)) {
        moved = true;
        try { root.classList.add('dragging'); } catch(_){}
        try { if (root.setPointerCapture && e.pointerId != null) root.setPointerCapture(e.pointerId); } catch(_){}
      }
      if (!moved) return;
      if (axis !== 'y') root.scrollLeft = sl - dx;
      if (axis !== 'x') root.scrollTop = st - dy;
      if (e.cancelable) try { e.preventDefault(); } catch(_){}
    }
    function onUp(e) {
      if (!dragging) return;
      dragging = false;
      try { root.classList.remove('dragging'); } catch(_){}
      if (moved) {
        // suppress click caused by drag release
        var suppress = function(ev){ if(ev){ev.stopPropagation&&ev.stopPropagation(); ev.preventDefault&&ev.preventDefault();} root.removeEventListener('click', suppress, true); };
        root.addEventListener('click', suppress, true);
        setTimeout(function(){ try{root.removeEventListener('click', suppress, true);}catch(_){ } }, 0);
      }
      moved = false; pid = null;
    }
    if (window.PointerEvent) {
      root.addEventListener('pointerdown', onDown, {passive:true});
      root.addEventListener('pointermove', onMove, {passive:false});
      root.addEventListener('pointerup', onUp, {passive:true});
      root.addEventListener('pointercancel', onUp, {passive:true});
      root.addEventListener('pointerleave', onUp, {passive:true});
    } else {
      root.addEventListener('mousedown', onDown, false);
      window.addEventListener('mousemove', onMove, false);
      window.addEventListener('mouseup', onUp, false);
      root.addEventListener('touchstart', onDown, {passive:true});
      root.addEventListener('touchmove', onMove, {passive:false});
      root.addEventListener('touchend', onUp, {passive:true});
      root.addEventListener('touchcancel', onUp, {passive:true});
    }
  }
  function attachDynamicDragScroll() {
    var els = document.querySelectorAll('.row-scroll,.series-body,.health-content');
    for (var i=0;i<els.length;i++) addDragScroll(els[i], {axis: els[i].classList.contains('row-scroll') ? 'x' : 'y'});
  }
  function initDragScroll() {
    var main = $('main') || document.querySelector('.main');
    if (main) addDragScroll(main, {axis:'y'});
    attachDynamicDragScroll();
    try {
      var mo = new MutationObserver(function(){ attachDynamicDragScroll(); });
      mo.observe(document.body, {childList:true, subtree:true});
    } catch(_){}
  }

  function boot() {
    document.body.classList.toggle('touch', isTouch);
    document.documentElement.classList.toggle('touch', isTouch);
    renderSearchKeys();
    loadSettings();
    applyCueStyle();
    $('verLine').textContent = VERSION;

    var navs = document.querySelectorAll('.navbtn[data-nav]');
    for (var i = 0; i < navs.length; i++) {
      (function (el) {
        el.addEventListener('click', function () {
          var v = el.getAttribute('data-nav');
          setView(v);
          if (v === 'home') {
            var b = $('hero').querySelector('.btn.primary');
            if (b) focusEl(b);
          } else {
            var first = firstVisibleFocusable($('view-' + v));
            if (first) focusEl(first);
          }
        });
      })(navs[i]);
    }

    var cats = document.querySelectorAll('[data-cat]');
    for (var ci = 0; ci < cats.length; ci++) {
      (function (el) {
        el.addEventListener('click', function () { openCategory(el.getAttribute('data-cat'), el); });
      })(cats[ci]);
    }

    // klávesnice vedle výsledků hledání (TV)
    $('skeys').addEventListener('click', function (e) {
      var t = e.target;
      while (t && t !== this && !(t.getAttribute && t.getAttribute('data-sk') !== null)) t = t.parentNode;
      if (t && t !== this) searchKey(t.getAttribute('data-sk'));
    });

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
    $('seriesClose').addEventListener('click', function () { closeSeries(); focusAfterOverlay(); });
    $('series').addEventListener('click', function (e) {
      if (e.target === $('series')) { closeSeries(); focusAfterOverlay(); }
    });
    var healthClose = $('healthClose'), healthDlg = $('health');
    if (healthClose) healthClose.addEventListener('click', function (e) { if(e){e.preventDefault&&e.preventDefault();e.stopPropagation&&e.stopPropagation();} try{closeHealthOverlay();}catch(_){} });
    if (healthDlg) {
      healthDlg.addEventListener('click', function (e) { if (e && e.target === healthDlg) { if(e.preventDefault)e.preventDefault(); if(e.stopPropagation)e.stopPropagation(); try{closeHealthOverlay();}catch(_){} } });
      var hbox = healthDlg.querySelector('.health-box');
      if (hbox) hbox.addEventListener('click', function (e) { if(e&&e.stopPropagation)e.stopPropagation(); });
    }

    document.addEventListener('mousemove', function () { if (!$('player').hidden) bumpIdle(); });

    renderLiveChips();
    renderSettings();
    var _hd=$('health'); if(_hd){_hd.hidden=true; try{_hd.style.display='none';}catch(_){}} 

    try{initDragScroll();}catch(_){}
    startApp();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
