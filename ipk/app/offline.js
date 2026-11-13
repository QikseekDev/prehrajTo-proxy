/* ==========================================================================
   Wflix – offline knihovna (videa stažená do aplikace)

   Dva režimy podle toho, kde appka běží:
     - Android (APK): stahuje nativní část do soukromého úložiště aplikace
       (window.WflixNative.offlineStart) a přehrává se z file:// cesty,
     - webOS / prohlížeč (IPK): stáhne se přes fetch a uloží do IndexedDB,
       přehrává se z blob: URL.

   Metadata (název, plakát, velikost) drží localStorage 'wflix.offline', takže
   se seznam stažených videí zobrazí i bez internetu. Když soubor zmizí
   (uživatel smazal data, přeinstaloval appku), reconcile() záznam uklidí.
   ========================================================================== */
(function () {
  'use strict';

  var LS_OFFLINE = 'wflix.offline';
  var DB_NAME = 'wflix-offline';
  var DB_STORE = 'files';
  var DB_VER = 1;

  var jobs = {};          // key -> { cb, key, page, title, poster, bytes, total, abort }
  var blobUrls = {};      // key -> blob: URL (aby se nevytvářela pořád nová)
  var bridge;             // undefined = nezjištěno, null = není

  function nativeBridge() {
    if (bridge === undefined) {
      var b = null;
      try { b = window.WflixNative || null; } catch (_) { b = null; }
      bridge = (b && typeof b.offlineStart === 'function') ? b : null;
    }
    return bridge;
  }

  function idbOk() {
    try { return !!window.indexedDB; } catch (_) { return false; }
  }

  function available() { return !!(nativeBridge() || idbOk()); }
  function mode() { return nativeBridge() ? 'native' : (idbOk() ? 'web' : ''); }

  /* Klíč videa z adresy stránky – stejný film má vždy stejný klíč, takže se
     stažené video nezdvojí a jde ho najít i po restartu appky. */
  function keyFor(url) {
    var s = String(url || '');
    var h = 5381;
    for (var i = 0; i < s.length; i++) h = (((h << 5) + h) ^ s.charCodeAt(i)) >>> 0;
    return 'v' + h.toString(36) + s.length.toString(36);
  }

  function readAll() {
    var v = null;
    try { v = JSON.parse(localStorage.getItem(LS_OFFLINE) || '[]'); } catch (_) { v = null; }
    if (!v || !v.length) return [];
    var out = [];
    for (var i = 0; i < v.length; i++) {
      var it = v[i];
      if (!it || !it.key || !it.url) continue;
      out.push(it);
    }
    return out;
  }

  function writeAll(list) {
    try {
      localStorage.setItem(LS_OFFLINE, JSON.stringify(list || []));
      return true;
    } catch (_) { return false; }
  }

  function putEntry(rec) {
    var all = readAll();
    var out = [];
    for (var i = 0; i < all.length; i++) if (all[i].key !== rec.key) out.push(all[i]);
    out.push(rec);
    writeAll(out);
  }

  function list() {
    var all = readAll();
    all.sort(function (a, b) { return (b.at || 0) - (a.at || 0); });
    return all;
  }

  function find(url) {
    var key = keyFor(url), all = readAll();
    for (var i = 0; i < all.length; i++) if (all[i].key === key) return all[i];
    return null;
  }

  function byKey(key) {
    var all = readAll();
    for (var i = 0; i < all.length; i++) if (all[i].key === key) return all[i];
    return null;
  }

  function formatBytes(n) {
    n = +n || 0;
    if (n <= 0) return '';
    var mb = n / (1024 * 1024);
    if (mb < 1) return Math.max(1, Math.round(n / 1024)) + ' kB';
    if (mb < 1000) return (mb < 10 ? mb.toFixed(1) : String(Math.round(mb))) + ' MB';
    return (mb / 1024).toFixed(mb / 1024 < 10 ? 1 : 0) + ' GB';
  }

  /* ------------------------------------------------------------------ *
   *  IndexedDB (webOS / prohlížeč)
   * ------------------------------------------------------------------ */
  function dbOpen() {
    return new Promise(function (resolve, reject) {
      var req;
      try { req = window.indexedDB.open(DB_NAME, DB_VER); }
      catch (e) { reject(e); return; }
      req.onupgradeneeded = function () {
        var db = req.result;
        try { if (!db.objectStoreNames.contains(DB_STORE)) db.createObjectStore(DB_STORE); } catch (_) {}
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error || new Error('Úložiště není dostupné')); };
    });
  }

  function idbRun(modeName, fn) {
    return dbOpen().then(function (db) {
      return new Promise(function (resolve, reject) {
        var out;
        var tx, req;
        try {
          tx = db.transaction(DB_STORE, modeName);
          req = fn(tx.objectStore(DB_STORE));
        } catch (e) {
          try { db.close(); } catch (_) {}
          reject(e);
          return;
        }
        if (req) req.onsuccess = function () { out = req.result; };
        tx.oncomplete = function () {
          try { db.close(); } catch (_) {}
          resolve(out);
        };
        tx.onerror = function () {
          try { db.close(); } catch (_) {}
          reject(tx.error || new Error('Úložiště selhalo'));
        };
        tx.onabort = function () {
          try { db.close(); } catch (_) {}
          reject(tx.error || new Error('Ukládání se nepovedlo (málo místa?)'));
        };
      });
    });
  }

  function idbKeys() {
    return idbRun('readonly', function (store) { return store.getAllKeys(); }).then(function (keys) {
      var out = {};
      for (var i = 0; i < (keys || []).length; i++) out[String(keys[i])] = true;
      return out;
    }).catch(function () { return null; });
  }

  /* ------------------------------------------------------------------ *
   *  Stahování
   * ------------------------------------------------------------------ */
  function emit(key, ev) {
    var job = jobs[key];
    if (!job) return;
    if (ev.type === 'progress') {
      job.bytes = ev.bytes || 0;
      job.total = ev.total || 0;
    }
    try { job.cb(ev); } catch (_) {}
  }

  function progress(url) {
    var job = jobs[keyFor(url)];
    if (!job) return null;
    return { bytes: job.bytes || 0, total: job.total || 0 };
  }

  function start(item, cb) {
    item = item || {};
    var page = String(item.url || '');
    var src = String(item.src || '');
    cb = cb || function () {};
    if (!page || !src) { cb({ type: 'error', message: 'Chybí adresa videa' }); return null; }

    var key = keyFor(page);
    var existing = byKey(key);
    if (existing) { cb({ type: 'done', entry: existing, existing: true }); return key; }
    if (jobs[key]) return key;

    var store = mode();
    if (!store) { cb({ type: 'error', message: 'Aplikace neumí ukládat soubory' }); return null; }

    jobs[key] = {
      key: key, cb: cb, page: page, bytes: 0, total: 0,
      title: String(item.title || 'Video'), poster: String(item.poster || '')
    };
    if (store === 'native') startNative(key, src);
    else startWeb(key, src);
    return key;
  }

  function startNative(key, src) {
    var job = jobs[key];
    var b = nativeBridge();
    var started = false;
    try { started = b ? !!b.offlineStart(key, src, job.title) : false; } catch (_) { started = false; }
    if (started) return;
    delete jobs[key];
    if (job) job.cb({ type: 'error', message: 'Stahování se nepodařilo spustit' });
  }

  function startWeb(key, src) {
    var job = jobs[key];
    var ctrl = null;
    try { if (typeof AbortController === 'function') ctrl = new AbortController(); } catch (_) { ctrl = null; }
    job.abort = ctrl;

    var opts = { cache: 'no-store' };
    if (ctrl) opts.signal = ctrl.signal;

    fetch(src, opts).then(function (res) {
      if (!res.ok) {
        // Server posílá důvod v JSONu ("URL must be from a supported source",
        // "Stahování je dočasně vypnuté."), tak ho ukaž místo holého kódu.
        return res.text().then(function (t) {
          var detail = '';
          try { var j = JSON.parse(t); detail = (j && (j.error || j.message)) || ''; } catch (_) { detail = ''; }
          throw new Error('HTTP ' + res.status + (detail ? ': ' + detail : ''));
        }, function () { throw new Error('HTTP ' + res.status); });
      }
      var total = 0;
      try { total = +res.headers.get('Content-Length') || 0; } catch (_) { total = 0; }
      job.total = total;
      var ctype = 'video/mp4';
      try {
        var ct = String(res.headers.get('Content-Type') || '').split(';')[0].trim().toLowerCase();
        if (ct.indexOf('video/') === 0 || ct.indexOf('audio/') === 0) ctype = ct;
      } catch (_) {}
      if (res.body && typeof res.body.getReader === 'function') {
        return readStream(key, res.body).then(function (chunks) {
          return new Blob(chunks, { type: ctype });
        });
      }
      return res.blob();          // starší prohlížeč: bez průběhu, ale uloží se
    }).then(function (blob) {
      job.bytes = blob.size;
      job.total = blob.size;
      return idbRun('readwrite', function (store) { return store.put(blob, key); }).then(function () {
        return blob;
      });
    }).then(function (blob) {
      var rec = {
        key: key, url: job.page, title: job.title, poster: job.poster,
        bytes: blob.size, at: Date.now(), store: 'web'
      };
      putEntry(rec);
      delete jobs[key];
      job.cb({ type: 'done', entry: rec });
    }).catch(function (e) {
      delete jobs[key];
      var msg = (e && e.name === 'AbortError') ? 'Stažení zrušeno' : ((e && e.message) || 'Stažení selhalo');
      job.cb({ type: 'error', message: msg });
    });
  }

  function readStream(key, body) {
    var reader = body.getReader();
    var chunks = [];
    var last = 0;
    function pump() {
      return reader.read().then(function (r) {
        if (r.done) return chunks;
        if (r.value) chunks.push(r.value);
        var job = jobs[key];
        if (!job) { try { reader.cancel(); } catch (_) {} throw new Error('Stažení zrušeno'); }
        if (r.value) job.bytes += r.value.length;
        var now = Date.now();
        if (now - last > 400) {
          last = now;
          job.cb({ type: 'progress', bytes: job.bytes, total: job.total });
        }
        return pump();
      });
    }
    return pump();
  }

  /* Události z nativního stahování (Android) – viz MainActivity.OfflineDownload. */
  window.__wflixOfflineEvent = function (id, type, payload) {
    var key = String(id || '');
    var job = jobs[key];
    if (!job) return;
    var d = {};
    try { d = JSON.parse(String(payload || '{}')) || {}; } catch (_) { d = {}; }
    type = String(type || '');

    if (type === 'progress') {
      emit(key, { type: 'progress', bytes: +d.bytes || 0, total: +d.total || 0 });
      return;
    }
    if (type === 'done') {
      var rec = {
        key: key, url: job.page, title: d.title || job.title, poster: job.poster,
        bytes: +d.bytes || 0, at: Date.now(), store: 'native', path: String(d.path || '')
      };
      putEntry(rec);
      delete jobs[key];
      job.cb({ type: 'done', entry: rec });
      return;
    }
    delete jobs[key];
    job.cb({ type: 'error', message: String(d.message || 'Stažení selhalo') });
  };

  function cancel(url) {
    var key = keyFor(url);
    var job = jobs[key];
    if (!job) return false;
    var b = nativeBridge();
    if (b) { try { b.offlineCancel(key); } catch (_) {} }
    else if (job.abort) { try { job.abort.abort(); } catch (_) {} }
    delete jobs[key];
    job.cb({ type: 'error', message: 'Stažení zrušeno' });
    return true;
  }

  function remove(entry, cb) {
    entry = entry || {};
    var key = entry.key || keyFor(entry.url);
    var store = entry.store || mode();

    function done() {
      writeAll(readAll().filter(function (x) { return x.key !== key; }));
      var u = blobUrls[key];
      if (u) {
        try { URL.revokeObjectURL(u); } catch (_) {}
        delete blobUrls[key];
      }
      var job = jobs[key];
      if (job) {
        delete jobs[key];
        try { if (job.abort) job.abort.abort(); } catch (_) {}
      }
      if (cb) cb(null);
    }

    if (store === 'native') {
      var b = nativeBridge();
      try { if (b) b.offlineDelete(key); } catch (_) {}
      done();
      return;
    }
    if (!idbOk()) { done(); return; }
    idbRun('readwrite', function (s) { return s.delete(key); }).then(done, done);
  }

  function playUrl(entry) {
    return new Promise(function (resolve, reject) {
      entry = entry || {};
      var key = entry.key || keyFor(entry.url);
      if (entry.store === 'native') {
        var b = nativeBridge();
        var path = '';
        try { path = b ? String(b.offlinePath(key) || '') : ''; } catch (_) { path = ''; }
        if (!path) { reject(new Error('Stažené video v aplikaci chybí')); return; }
        resolve(path);
        return;
      }
      if (blobUrls[key]) { resolve(blobUrls[key]); return; }
      idbRun('readonly', function (s) { return s.get(key); }).then(function (blob) {
        if (!blob) { reject(new Error('Stažené video v aplikaci chybí')); return; }
        var u = '';
        try { u = URL.createObjectURL(blob); } catch (e) { reject(e); return; }
        blobUrls[key] = u;
        resolve(u);
      }).catch(function () { reject(new Error('Stažené video v aplikaci chybí')); });
    });
  }

  /* Po startu appky: záznamy bez souboru (smazaná data, přeinstalace) uklidit,
     ať knihovna neukazuje videa, která nejdou přehrát. */
  function reconcile() {
    var all = readAll();
    if (!all.length) return Promise.resolve(false);

    var valid = { native: null, web: null };
    var b = nativeBridge();
    if (b) {
      valid.native = {};
      try {
        var arr = JSON.parse(String(b.offlineFiles() || '[]')) || [];
        for (var i = 0; i < arr.length; i++) if (arr[i] && arr[i].id) valid.native[String(arr[i].id)] = true;
      } catch (_) { valid.native = null; }      // bez odpovědi radši nic nemazat
    }

    var ready = idbOk() ? idbKeys().then(function (keys) { valid.web = keys; }) : Promise.resolve();
    return ready.then(function () {
      var keep = [], changed = false;
      for (var i = 0; i < all.length; i++) {
        var it = all[i];
        var alive = true;
        if (it.store === 'native') {
          if (valid.native) alive = !!valid.native[it.key];
        } else if (valid.web) {
          alive = !!valid.web[it.key];
        }
        if (alive) keep.push(it); else changed = true;
      }
      if (changed) writeAll(keep);
      return changed;
    });
  }

  window.WflixOffline = {
    available: available,
    mode: mode,
    keyFor: keyFor,
    list: list,
    find: find,
    sizeText: formatBytes,
    progress: progress,
    start: start,
    cancel: cancel,
    remove: remove,
    playUrl: playUrl,
    reconcile: reconcile
  };
})();
