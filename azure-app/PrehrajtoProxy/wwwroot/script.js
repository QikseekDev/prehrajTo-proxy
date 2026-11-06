        const searchInput = document.getElementById('searchInput');
        const searchBtn = document.getElementById('searchBtn');
        const status = document.getElementById('status');
        const resultsSection = document.getElementById('resultsSection');
        const resultsGrid = document.getElementById('resultsGrid');
        const resultsInfo = document.getElementById('resultsInfo');
        const playerSection = document.getElementById('playerSection');
        const videoPlayer = document.getElementById('videoPlayer');
        const pageSection = document.getElementById('pageSection');
        const pageTitle = document.getElementById('pageTitle');
        const pageBody = document.getElementById('pageBody');
        const liveSection = document.getElementById('liveSection');
        const livePlayerSection = document.getElementById('livePlayerSection');
        const liveGrid = document.getElementById('liveGrid');
        const liveState = document.getElementById('liveState');
        const liveSource = document.getElementById('liveSource');
        const liveFilter = document.getElementById('liveFilter');
        const liveVideo = document.getElementById('liveVideo');
        const liveNow = document.getElementById('liveNow');
        const liveError = document.getElementById('liveError');
        const liveBtn = document.getElementById('liveBtn');
        const nowPlaying = document.getElementById('nowPlaying');
        const dlBtn = document.getElementById('dlBtn');
        const proxyBtn = document.getElementById('proxyBtn');
        const subtitleBar = document.getElementById('subtitleBar');
        const subtitleSelect = document.getElementById('subtitleSelect');
        const subNote = document.getElementById('subNote');
        const playerEnd = document.getElementById('playerEnd');
        const playerEndTitle = document.getElementById('playerEndTitle');
        const placeholder = document.getElementById('placeholder');
        const srcBadge = document.getElementById('srcBadge');
        const srcBadgeName = document.getElementById('srcBadgeName');
        const srcMode = document.getElementById('srcMode');
        const favBtn = document.getElementById('favBtn');
        const pipBtn = document.getElementById('pipBtn');
        // PiP umí Chrome/Edge; tlačítko se ukáže až u načteného videa (viz updateFavBtn).
        const pipSupported = !!(document.pictureInPictureEnabled && HTMLVideoElement.prototype.requestPictureInPicture);

        let currentResults = [];
        // Stránkování hledání: první stránka se ověřuje (mrtvé kusy zmizí), další se jen
        // přidají - ověřování je to pomalé a naráží na 429, a videa většinou fungují i bez něj.

        // Záložní katalog - použije se jen když se nepovede stáhnout /api/catalog (iTunes).
        // Filmy pro homepage jinak chodí ze serveru (iTunes RSS, cache na 1 den) včetně plakátů.
        let CATALOG = [
            // q = hledaný výraz, t = zobrazený název
            { t: 'Matrix', q: 'Matrix', y: 1999, g: ['Sci-fi','Akční'], e: '🕶️' },
            { t: 'Interstellar', q: 'Interstellar', y: 2014, g: ['Sci-fi','Drama'], e: '🚀' },
            { t: 'Počátek', q: 'Počátek Inception', y: 2010, g: ['Sci-fi','Thriller'], e: '🌀' },
            { t: 'Duna', q: 'Duna 2021', y: 2021, g: ['Sci-fi'], e: '🏜️' },
            { t: 'Blade Runner 2049', q: 'Blade Runner 2049', y: 2017, g: ['Sci-fi'], e: '🌆' },
            { t: 'Temný rytíř', q: 'Temný rytíř', y: 2008, g: ['Akční','Thriller'], e: '🦇' },
            { t: 'Gladiátor', q: 'Gladiátor', y: 2000, g: ['Akční','Drama'], e: '⚔️' },
            { t: 'Top Gun: Maverick', q: 'Top Gun Maverick', y: 2022, g: ['Akční'], e: '✈️' },
            { t: 'John Wick', q: 'John Wick', y: 2014, g: ['Akční','Thriller'], e: '🔫' },
            { t: 'Mad Max: Fury Road', q: 'Mad Max Fury Road', y: 2015, g: ['Akční','Sci-fi'], e: '🔥' },
            { t: 'Vykoupení z věznice Shawshank', q: 'Vykoupení z věznice Shawshank', y: 1994, g: ['Drama'], e: '⛓️' },
            { t: 'Forrest Gump', q: 'Forrest Gump', y: 1994, g: ['Drama'], e: '🍫' },
            { t: 'Pulp Fiction', q: 'Pulp Fiction', y: 1994, g: ['Thriller','Drama'], e: '💼' },
            { t: 'Klub rváčů', q: 'Klub rváčů', y: 1999, g: ['Drama','Thriller'], e: '🧼' },
            { t: 'Mlčení jehňátek', q: 'Mlčení jehňátek', y: 1991, g: ['Thriller'], e: '🦋' },
            { t: 'Šestý smysl', q: 'Šestý smysl', y: 1999, g: ['Thriller','Drama'], e: '👻' },
            { t: 'Parazit', q: 'Parazit', y: 2019, g: ['Thriller','Drama'], e: '🏠' },
            { t: 'Oppenheimer', q: 'Oppenheimer', y: 2023, g: ['Drama'], e: '💥' },
            { t: 'Pán prstenů: Společenstvo Prstenu', q: 'Pán prstenů Společenstvo Prstenu', y: 2001, g: ['Fantasy','Akční'], e: '💍' },
            { t: 'Harry Potter a Kámen mudrců', q: 'Harry Potter a Kámen mudrců', y: 2001, g: ['Fantasy','Rodinné'], e: '⚡' },
            { t: 'Piráti z Karibiku: Prokletí Černé perly', q: 'Piráti z Karibiku Prokletí Černé perly', y: 2003, g: ['Fantasy','Akční'], e: '🏴‍☠️' },
            { t: 'Shrek', q: 'Shrek', y: 2001, g: ['Rodinné','Animované'], e: '👹' },
            { t: 'Toy Story', q: 'Toy Story', y: 1995, g: ['Rodinné','Animované'], e: '🤠' },
            { t: 'Lví král', q: 'Lví král', y: 1994, g: ['Rodinné','Animované'], e: '🦁' },
            { t: 'Hledá se Nemo', q: 'Hledá se Nemo', y: 2003, g: ['Rodinné','Animované'], e: '🐠' },
            { t: 'Ledové království', q: 'Ledové království', y: 2013, g: ['Rodinné','Animované'], e: '❄️' },
            { t: 'Coco', q: 'Coco', y: 2017, g: ['Rodinné','Animované'], e: '💀' },
            { t: 'Pelíšky', q: 'Pelíšky', y: 1999, g: ['České','Komedie'], e: '🏡' },
            { t: 'Kolja', q: 'Kolja', y: 1996, g: ['České','Drama'], e: '🎻' },
            { t: 'Samotáři', q: 'Samotáři', y: 2000, g: ['České','Komedie'], e: '💑' },
            { t: 'Vesničko má středisková', q: 'Vesničko má středisková', y: 1985, g: ['České','Komedie'], e: '🌾' },
            { t: 'Tmavomodrý svět', q: 'Tmavomodrý svět', y: 2001, g: ['České','Drama'], e: '🛩️' },
            { t: 'Anděl Páně', q: 'Anděl Páně', y: 2005, g: ['České','Komedie'], e: '😇' },
            { t: 'Prci, prci, prcičky', q: 'American Pie', y: 1999, g: ['Komedie'], e: '🥧' },
            { t: 'Pařba ve Vegas', q: 'Hangover Pařba ve Vegas', y: 2009, g: ['Komedie'], e: '🎰' },
        ];
        const BUILTIN_CATALOG = CATALOG;   // pořád tenhle seznam - a zdroj českých klasik


        const ROWS = [
            { name: 'Sci-fi a akce', genres: ['Sci-fi','Akční'] },
            { name: 'Drama a thrillery', genres: ['Drama','Thriller'] },
            { name: 'Horror', genres: ['Horror'] },
            { name: 'Fantasy', genres: ['Fantasy'] },
            { name: 'Pro celou rodinu', genres: ['Rodinné','Animované'] },
            { name: 'České klasiky', genres: ['České'] },
            { name: 'Komedie', genres: ['Komedie'] },
        ];
        const CHIPS = ['Vše','Sci-fi','Akční','Drama','Thriller','Horror','Fantasy','Rodinné','České','Komedie'];
        let activeChip = 'Vše';
        let heroOffset = 0;


        // ===== Thumbnails: server je hledá přes /api/thumb (regex "q*", cache na serveru) a zapamatujeme =====
        const THUMB_KEY = 'wflix-thumbs-v3';
        // Volitelný limit souběžných dotazů na náhledy (Nastavení, výchozí: vypnuto)
        // Seznam PHP proxy serverů (Nastavení). Nemazat/needitovat ručně mezi markery -
        // udržuje to scripts/change-proxy-servers.sh (spusť ho, ať to nerozjede ve 3 souborech zvlášť).
        const DEFAULT_PROXY_SERVERS = [
            // PROXY-SERVERS:BEGIN
            'http://wtzi.borec.cz/index.php',
            'http://wtzi.euweb.cz/index.php',
            'http://wtzi.chytrak.cz/index.php',
            // PROXY-SERVERS:END
        ];
        const SETTINGS_KEY = 'wflix-settings';
        // Knihovna diváka (jen v tomhle prohlížeči): rozehrané filmy a oblíbené.
        const HISTORY_KEY = 'wflix-history';
        const FAVS_KEY = 'wflix-favs';
        const HISTORY_MAX = 40;
        let settings = { catLang: 'cz', limitOn: false, limit: 3, direct: true, theme: 'dark', subSize: 'm', subBg: 'dark' };
        try { Object.assign(settings, JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}')); } catch (e) {}
        // Starší verze ukládaly volby, které už v panelu nejsou (vypnuté náhledy, zdroj
        // náhledů, proxy). Zahodit, ať se v localStorage nevrátí zpátky do oběhu.
        ['thumbsOff', 'thumbSrc', 'proxyOn', 'proxyServers', 'proxyUrl', 'introSound'].forEach(k => delete settings[k]);
        const saveSettings = () => { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch (e) {} };

        // ===== Vzhled: světlý režim a styl titulků =====
        // Obojí jde do stejného wflix-settings jako ostatní volby. Titulky se barví přes
        // CSS proměnné (video::cue), takže se stopa nemusí znovu načítat.
        const CUE_SIZES = { m: '1.05em', l: '1.35em', xl: '1.7em' };
        const CUE_BACKGROUNDS = {
            dark: { bg: 'rgba(0,0,0,0.78)', fg: '#fff', shadow: '0 1px 2px #000' },
            light: { bg: 'rgba(255,255,255,0.92)', fg: '#000', shadow: 'none' },
            none: { bg: 'transparent', fg: '#fff', shadow: '0 1px 3px #000, 0 0 6px rgba(0,0,0,0.9)' },
        };

        function applyTheme() {
            const light = settings.theme === 'light';
            document.documentElement.dataset.theme = light ? 'light' : 'dark';
            const meta = document.querySelector('meta[name="theme-color"]');
            if (meta) meta.setAttribute('content', light ? '#f5f5f5' : '#141414');
        }

        function applyCueStyle() {
            const size = CUE_SIZES[settings.subSize] || CUE_SIZES.m;
            const bg = CUE_BACKGROUNDS[settings.subBg] || CUE_BACKGROUNDS.dark;
            const style = document.documentElement.style;
            style.setProperty('--cue-size', size);
            style.setProperty('--cue-bg', bg.bg);
            style.setProperty('--cue-fg', bg.fg);
            style.setProperty('--cue-shadow', bg.shadow);
        }

        applyTheme();
        applyCueStyle();
        const thumbLimit = () => settings.limitOn ? Math.max(1, settings.limit | 0) : Infinity;
        // Přímé přehrávání z CDN (Nastavení, výchozí: zapnuto). Zapnuto = video i HLS jdou
        // přímo ze zdroje; po opakovaných chybách se pro TO jedno přehrávání dočasně použije
        // server a nastavení zůstane zapnuté, takže další přehrávání zkusí CDN znovu.
        const directPreferred = () => settings.direct === true;
        // Proxy servery jsou vždy zapnuté - appka prehraj.to nikdy nevolá přímo. Seznam drží
        // DEFAULT_PROXY_SERVERS (mění ho scripts/change-proxy-servers.sh); backend je zkusí
        // jeden po druhém a vezme první, který odpoví bez chyby.
        const proxyQS = () => DEFAULT_PROXY_SERVERS
            .filter(u => u && u.trim())
            .map(u => '&proxy=' + encodeURIComponent(u.trim()))
            .join('');

        // ===== Aktivní proxy server (odznak v liště, řádek v Nastavení) =====
        // Backend zkouší servery jeden po druhém a v hlavičce X-Wflix-Proxy posílá ten, který
        // odpověděl. Změna znamená failover - proto odznak krátce zjantaroví a vysvětlí to v tooltipu.
        let activeProxy = '';
        function proxyLabel(src) {
            if (!src) return '';
            if (src === 'direct') return 'přímo';
            try { return new URL(src).hostname.replace(/^www\./, ''); } catch (e) { return src; }
        }
        function noteActiveProxy(src) {
            if (!src || src === activeProxy || !srcBadge || !srcBadgeName) return;
            const switched = !!activeProxy;
            activeProxy = src;
            const label = proxyLabel(src);
            srcBadgeName.textContent = label;
            srcBadge.hidden = false;
            srcBadge.title = 'Aktivní proxy server: ' + (src === 'direct' ? 'přímé volání' : src)
                + (switched ? ' (po výpadku předchozího serveru)' : '');
            srcBadge.classList.toggle('changed', switched);
            clearTimeout(noteActiveProxy.timer);
            if (switched) noteActiveProxy.timer = setTimeout(() => srcBadge.classList.remove('changed'), 4000);
            // Nastavení je stránka, která se vykresluje až při otevření - prvek
            // proto hledáme pokaždé znovu, ne jednou při startu.
            const proxyEl = document.getElementById('proxyStatus');
            if (proxyEl) {
                proxyEl.textContent = label;
                proxyEl.title = src === 'direct' ? 'prehraj.to volá server přímo' : src;
            }
        }
        let thumbCache = {};
        try { thumbCache = JSON.parse(localStorage.getItem(THUMB_KEY) || '{}'); } catch (e) {}
        const thumbQueue = [];
        const thumbPending = new Map();
        let thumbActive = 0;

        const norm = s => (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

        function fixThumbUrl(u) {
            if (!u) return '';
            if (u.startsWith('//')) return 'https:' + u;
            if (u.startsWith('/')) return 'https://prehraj.to' + u;
            return u;
        }

        // ----- párování názvů: všechna významná slova z názvu musí být ve výsledku -----
        const STOP = new Set(['a','i','z','ze','o','u','v','ve','na','do','se','si','k','s','the','of','and','to','in']);
        const BAD = new Set(['trailer','teaser','ukazka','upoutavka','recenze','review','soundtrack','ost','making',
                             'gameplay','hra','parodie','reaction','reakce','rozbor','sestrih','clip']);

        function tokens(str) {
            return norm(str).replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean);
        }

        // >= 1 = všechna slova sedí; < 0.6 = nepoužít jako obrázek
        function matchScore(item, title, url) {
            const titleTokens = tokens(title);
            const slug = (url || '').replace(/^https?:\/\/prehraj\.to\//, '');
            const have = new Set([...titleTokens, ...tokens(slug)]);

            let best = 0, bestLen = 1;
            for (const alias of [item.t, item.q]) {
                let a = tokens(alias).filter(t => !STOP.has(t));
                if (!a.length) a = tokens(alias);
                if (!a.length) continue;
                const cov = a.filter(t => have.has(t)).length / a.length;
                if (cov > best) { best = cov; bestLen = a.length; }
            }
            if (best < 1) return best * 0.5;

            let score = 1;
            if (item.y && have.has(String(item.y))) score += 0.5;
            if (titleTokens.some(t => BAD.has(t))) score -= 0.7;
            score -= Math.min(0.3, Math.max(0, titleTokens.length - bestLen) * 0.02);
            return score;
        }

        // seřadí výsledky podle shody s názvem filmu (stabilně)
        function rankMovies(item, movies) {
            return movies.map((m, i) => ({ m, i, sc: matchScore(item, m.title, m.url) }))
                         .sort((x, y) => (y.sc - x.sc) || (x.i - y.i))
                         .map(x => x.m);
        }

        function saveThumbs() {
            try { localStorage.setItem(THUMB_KEY, JSON.stringify(thumbCache)); } catch (e) {}
        }

        function getThumb(q, cb) {
            // Plakát z iTunes katalogu: rovnou z obrázku, žádný dotaz na server ani na prehraj.to
            const fromCatalog = CATALOG.find(m => m.q === q);
            if (fromCatalog && fromCatalog.img) { cb(fromCatalog.img); return; }
            const c = thumbCache[q];
            // nalezené držíme napořád, nenalezené zkusíme znovu po 24 h
            if (c && (c.u || Date.now() - c.t < 86400000)) { cb(c.u); return; }
            if (thumbPending.has(q)) { thumbPending.get(q).push(cb); return; }
            thumbPending.set(q, [cb]);
            thumbQueue.push(q);
            pumpThumbs();
        }

        function pumpThumbs() {
            while (thumbActive < thumbLimit() && thumbQueue.length) {
                const q = thumbQueue.shift();
                thumbActive++;
                (async () => {
                    let u = '';
                    try {
                        const item = CATALOG.find(m => m.q === q) || { t: q, q };
                        const p = new URLSearchParams({ q: item.q, t: item.t });
                        if (item.y) p.set('y', item.y);
                        const { data: d } = await apiJson('/api/thumb?' + p + proxyQS(), { retries: 2 });
                        if (d && d.success) {
                            u = d.thumbnail || '';
                            thumbCache[q] = { u, t: Date.now() };
                            saveThumbs();
                        }
                    } catch (e) { /* zkusí se příště */ }
                    (thumbPending.get(q) || []).forEach(cb => cb(u));
                    thumbPending.delete(q);
                    thumbActive--;
                    pumpThumbs();
                })();
            }
        }

        const thumbObserver = new IntersectionObserver(entries => {
            entries.forEach(en => {
                if (!en.isIntersecting) return;
                thumbObserver.unobserve(en.target);
                const el = en.target;
                const art = el.querySelector('.art');
                const img = el.querySelector('.thumb');
                getThumb(el.dataset.q, u => {
                    if (!u || !img || !img.isConnected) return;
                    img.onload = () => art.classList.add('has-img');
                    img.onerror = () => img.remove();
                    img.src = u;
                });
            });
        }, { rootMargin: '200px' });

        function observeThumbs() {
            // Jen karty katalogu - osobní řady mají plakát už v sobě a getThumb by hledal 'undefined'.
            document.querySelectorAll('#catalogRows .poster[data-q]').forEach(el => thumbObserver.observe(el));
        }

        function posterGradient(title) {
            let h = 0;
            for (const c of title) h = (h * 31 + c.charCodeAt(0)) % 360;
            return `linear-gradient(150deg, hsl(${h},60%,38%), hsl(${(h + 45) % 360},65%,16%))`;
        }

        // "Procenta doporučení" a věkový rating po vzoru Netflixu - stabilně odvozené
        // z názvu, čistě vzhled, žádná logika za tím nestojí.
        function hashStr(s) {
            let h = 0;
            for (const c of norm(s || '')) h = (h * 31 + c.charCodeAt(0)) % 100000;
            return h;
        }
        function matchPct(title) { return 88 + (hashStr(title) % 12); }   // 88–99 %
        function ageRating(title) { return ['7+', '12+', '15+', '18+'][hashStr(title) % 4]; }
        // Popis pod metařádkem billboardu (katalog z iTunes žádné synopsy nemá)
        function heroDesc(m) {
            const g = (m.g && m.g.length) ? m.g.slice(0, 2).join(' a ') : 'Film';
            return `${g} · ${m.y || ''}`.trim() + ' – příběh, který vás od prvního záběru nepustí od obrazovky.';
        }

        function escapeHtml(str) {
            return String(str ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
        }

        // ===== Knihovna diváka: rozehrané, nedávno sledované a oblíbené =====
        // Všechno zůstává jen v prohlížeči (localStorage) - stejně jako Nastavení, žádný účet.
        // Klíčem je adresa stránky na prehraj.to; katalog bez odkazu se drží jako 'q:<dotaz>'.
        function readList(key) {
            try {
                const v = JSON.parse(localStorage.getItem(key) || '[]');
                return Array.isArray(v) ? v.filter(x => x && typeof x === 'object') : [];
            } catch (e) { return []; }
        }
        function writeList(key, list) {
            try { localStorage.setItem(key, JSON.stringify(list)); } catch (e) {}
        }

        let history = readList(HISTORY_KEY).filter(x => x.url);
        let favorites = readList(FAVS_KEY).filter(x => x.key);
        let favFilterText = '';
        let lastHistoryWrite = 0;

        const saveHistory = () => writeList(HISTORY_KEY, history);
        const saveFavorites = () => writeList(FAVS_KEY, favorites);

        const fmtClock = secs => {
            const s = Math.max(0, Math.round(secs || 0));
            const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
            return h ? `${h}:${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
                     : `${m}:${String(s % 60).padStart(2, '0')}`;
        };
        // "Zbývá 1 h 12 min" je u rozehraného filmu užitečnější než procenta.
        function fmtRemain(secs) {
            const min = Math.round(Math.max(0, secs) / 60);
            if (min < 1) return 'méně než minuta';
            if (min < 60) return `${min} min`;
            return `${Math.floor(min / 60)} h ${min % 60} min`;
        }
        const histDone = h => h.d > 0 && h.t >= h.d - 30;

        // Uloží pozici přehrávání. Během hraní se volá nejvýš každé 4 s, na pauze/odchodu
        // hned - localStorage se tak nezapisuje po každé vteřině.
        function historySave(force) {
            const page = player.page;
            if (!page) return;
            const now = Date.now();
            if (!force && now - lastHistoryWrite < 4000) return;
            const dur = isFinite(videoPlayer.duration) && videoPlayer.duration > 0 ? Math.round(videoPlayer.duration) : 0;
            const t = Math.round(videoPlayer.currentTime || 0);
            if (t < 2) return;   // začátek nemá smysl ukládat a nesmí přepsat uloženou pozici
            const rec = history.find(x => x.url === page) || { url: page };
            rec.title = player.title || rec.title || 'Video';
            rec.poster = player.poster || rec.poster || '';
            rec.t = t;
            rec.d = dur || rec.d || 0;
            rec.at = now;
            history = [rec, ...history.filter(x => x.url !== page)].slice(0, HISTORY_MAX);
            lastHistoryWrite = now;
            saveHistory();
        }

        // Kde navázat. První půlminuta ani poslední půlminuta nemá smysl.
        function historyResume(page) {
            const h = history.find(x => x.url === page);
            if (!h || !h.t) return 0;
            if (histDone(h)) return 0;
            if (h.t < 30) return 0;
            if (h.d > 0 && h.d - h.t < 30) return 0;
            return h.t;
        }

        const favKeyOf = it => it && it.url ? it.url : (it && it.q ? 'q:' + it.q : '');
        const isFav = key => !!key && favorites.some(f => f.key === key);

        function favItemFromEl(el) {
            return {
                url: el.dataset.favUrl || '',
                q: el.dataset.favQ || '',
                title: el.dataset.favTitle || '',
                poster: el.dataset.favPoster || '',
            };
        }

        // Oblíbené jen označí/odznačí - řada se překreslí rovnou, ať je změna hned vidět.
        function toggleFavorite(item) {
            const key = favKeyOf(item);
            if (!key) return;
            const had = isFav(key);
            if (had) {
                favorites = favorites.filter(f => f.key !== key);
            } else {
                favorites = [{ key, url: item.url || '', q: item.q || '', title: item.title || '',
                              poster: item.poster || '', at: Date.now() },
                             ...favorites.filter(f => f.key !== key)].slice(0, 200);
            }
            saveFavorites();
            renderCatalog();
            updateFavBtn();
            syncFavButtons();
            notice(had ? 'Odebráno z oblíbených' : '★ Přidáno do oblíbených');
        }

        // Sjednotí vzhled a popisky všech záložek na stránce (karty ve výsledcích se
        // nepřekreslují, tak je potřeba projít zvlášť).
        function syncFavButtons() {
            document.querySelectorAll('[data-fav-key]').forEach(el => {
                const on = isFav(el.dataset.favKey);
                el.classList.toggle('on', on);
                el.textContent = on ? '★' : '☆';
                el.setAttribute('aria-pressed', String(on));
                el.setAttribute('aria-label', on ? 'Odebrat z oblíbených' : 'Přidat do oblíbených');
                el.setAttribute('title', on ? 'Odebrat z oblíbených' : 'Přidat do oblíbených');
            });
        }

        function favBtnHtml(it) {
            const key = favKeyOf(it);
            if (!key) return '';
            const on = isFav(key);
            const label = on ? 'Odebrat z oblíbených' : 'Přidat do oblíbených';
            return `<span class="fav-btn${on ? ' on' : ''}" role="button" tabindex="0" data-fav-key="${escapeHtml(key)}"
                data-fav-url="${escapeHtml(it.url || '')}" data-fav-q="${escapeHtml(it.q || '')}"
                data-fav-title="${escapeHtml(it.title || '')}" data-fav-poster="${escapeHtml(it.poster || '')}"
                aria-pressed="${on}" aria-label="${label}" title="${label}">${on ? '★' : '☆'}</span>`;
        }

        // Karta v osobní řadě: plakát, název a buď zbytek stopáže, nebo "Dohráno".
        function libCardHtml(it) {
            const played = it.t > 0 && it.d > 0;
            const pct = played ? Math.min(100, Math.max(2, Math.round((it.t / it.d) * 100))) : 0;
            const meta = played
                ? (histDone(it) ? 'Dohráno' : `Zbývá ${fmtRemain(it.d - it.t)}`)
                : 'Oblíbené';
            const action = it.url ? `data-hist="${escapeHtml(it.url)}"` : `data-catq="${escapeHtml(it.q || '')}"`;
            const img = it.poster
                ? `<img class="thumb portrait" alt="" loading="lazy" referrerpolicy="no-referrer" src="${escapeHtml(it.poster)}"
                        onerror="this.parentElement.classList.remove('has-img');this.remove()">`
                : '';
            return `<button class="poster" ${action} data-name="${escapeHtml(norm(it.title))}" aria-label="${escapeHtml(it.title)}">
                <span class="art${it.poster ? ' has-img' : ''}" style="background:${posterGradient(it.title || '')}">
                    ${img}
                    <span class="emoji">🎬</span>
                    <span class="shade"></span>
                    <span class="play">▶</span>
                    <span class="p-title">${escapeHtml(it.title || 'Video')}</span>
                    <span class="p-meta">${escapeHtml(meta)}</span>
                    ${pct ? `<span class="progress"><i style="width:${pct}%"></i></span>` : ''}
                </span>
                ${favBtnHtml({ url: it.url || '', q: it.q || '', title: it.title || '', poster: it.poster || '' })}
            </button>`;
        }

        // Filtr v řadě oblíbených filtruje už vykreslené karty, takže neztrácí fokus
        // při psaní (řada se kvůli tomu nepřekresluje).
        function applyFavFilter() {
            const row = document.querySelector('.cat-row.fav-row');
            if (!row) return;
            const q = norm(favFilterText.trim());
            row.querySelectorAll('.poster[data-name]').forEach(el => {
                el.style.display = (!q || (el.dataset.name || '').includes(q)) ? '' : 'none';
            });
        }

        function renderLibraryRows() {
            const rows = [];
            const cont = history.filter(h => h.t > 30 && !histDone(h)).slice(0, 12);
            if (cont.length) rows.push(carouselHtml('Pokračovat ve sledování', cont.map(libCardHtml).join('')));
            const recent = history.slice(0, 12);
            if (recent.length) rows.push(carouselHtml('Nedávno sledované', recent.map(libCardHtml).join('')));
            if (favorites.length) {
                const head = `<input class="row-filter" id="favFilter" type="search" autocomplete="off"
                    placeholder="Filtrovat oblíbené…" aria-label="Filtrovat oblíbené" value="${escapeHtml(favFilterText)}">`;
                rows.push(carouselHtml('Moje oblíbené', favorites.map(libCardHtml).join(''), head, 'fav-row'));
            }
            return rows.join('');
        }

        function openFromCatalog(q) {
            searchInput.value = q;
            window.scrollTo({ top: 0, behavior: 'smooth' });
            searchMovies();
        }

        function posterHtml(m, rank) {
            return `<button class="poster ${rank ? 'ranked' : ''}" data-q="${escapeHtml(m.q)}" aria-label="${escapeHtml(m.t)}">
                ${rank ? `<span class="rank">${rank}</span>` : ''}
                <span class="art" style="background:${posterGradient(m.t)}">
                    <img class="thumb${m.img ? ' portrait' : ''}" alt="" loading="lazy" referrerpolicy="no-referrer">
                    <span class="emoji">${m.e || '🎬'}</span>
                    <span class="shade"></span>
                    <span class="play">▶</span>
                    <span class="p-title">${escapeHtml(m.t)}</span>
                    <span class="p-meta"><b>${matchPct(m.t)} % Doporučeno</b> · ${m.y} · ${ageRating(m.t)}</span>
                </span>
                ${favBtnHtml({ q: m.q, title: m.t, poster: m.img || '' })}
            </button>`;
        }

        function carouselHtml(title, cards, headExtra, cls) {
            return `<section class="cat-row${cls ? ' ' + cls : ''}">
                <h3>${title}${headExtra || ''}</h3>
                <div class="row-wrap">
                    <button class="arrow left" data-scroll="-1" aria-label="Doleva">‹</button>
                    <div class="row-scroll">${cards}</div>
                    <button class="arrow right" data-scroll="1" aria-label="Doprava">›</button>
                </div>
            </section>`;
        }

        function rowHtml(title, items, ranked, chip) {
            return carouselHtml(
                title,
                items.map((m, i) => posterHtml(m, ranked ? i + 1 : 0)).join(''),
                chip ? `<button class="row-more" data-chip="${escapeHtml(chip)}">Prozkoumat vše ›</button>` : '');
        }

        function renderHero() {
            const day = Math.floor(Date.now() / 86400000);
            const m = CATALOG[(day + heroOffset) % CATALOG.length];
            document.getElementById('hero').innerHTML = `
                <div class="hero" style="--hero-bg:${posterGradient(m.t)}">
                    <div class="hero-emoji">${m.e || '🎬'}</div>
                    <div class="hero-content">
                        <div class="hero-tag"><span class="w">W</span> TIP DNE</div>
                        <h2>${escapeHtml(m.t)}</h2>
                        <div class="meta">
                            <span class="match">${matchPct(m.t)} % Doporučeno</span>
                            <span class="year">${m.y}</span>
                            <span class="hd">HD</span>
                            <span class="genres">${m.g.join(' · ')}</span>
                        </div>
                        <p class="hero-desc">${escapeHtml(heroDesc(m))}</p>
                        <div class="hero-actions">
                            <button class="btn-play" data-q="${escapeHtml(m.q)}">▶ Přehrát</button>
                            <button class="btn-info" data-next="1">↻ Jiný tip</button>
                        </div>
                    </div>
                    <div class="hero-rating">${ageRating(m.t)}</div>
                </div>`;
            const heroEl = document.querySelector('#hero .hero');
            getThumb(m.q, u => {
                if (!u || !heroEl.isConnected) return;
                const im = new Image();
                im.className = 'hero-img' + (m.img ? ' portrait' : '');
                im.referrerPolicy = 'no-referrer';
                im.onload = () => {
                    if (!heroEl.isConnected) return;
                    heroEl.prepend(im);
                    heroEl.classList.add('has-img');
                    requestAnimationFrame(() => im.classList.add('on'));
                };
                im.src = u;
            });
        }

        // Intro overlay nemá zmizet nad prázdnou stránkou: záložní katalog se vykreslí hned,
        // ale skutečný (iTunes) dorazí až z /api/catalog. Intro proto čeká na tenhle signál.
        const firstPaint = { done: false, waiters: [] };
        function markFirstPaint() {
            if (firstPaint.done) return;
            firstPaint.done = true;
            firstPaint.waiters.splice(0).forEach(fn => { try { fn(); } catch (e) {} });
        }
        function whenFirstPaint(fn) {
            if (firstPaint.done) fn(); else firstPaint.waiters.push(fn);
        }

        function renderCatalog() {
            document.getElementById('chips').innerHTML = CHIPS.map(c =>
                `<button class="chip ${c === activeChip ? 'active' : ''}" data-chip="${c}">${c}</button>`).join('');

            // Osobní řady jdou nahoru, nad katalog: rozehrané a oblíbené jsou to první,
            // co divák hledá. Filtry žánrů se jich netýkají.
            let html = renderLibraryRows();
            if (activeChip === 'Vše') {
                const day = Math.floor(Date.now() / 86400000);
                const top = Array.from({ length: 10 }, (_, i) => CATALOG[(day * 7 + i * 3) % CATALOG.length]);
                const uniq = [...new Map(top.map(m => [m.t, m])).values()];
                html += rowHtml('Top 10 dnes', uniq, true);
            }
            html += ROWS.map(r => {
                const items = CATALOG.filter(m => m.g.some(g => r.genres.includes(g)))
                                     .filter(m => activeChip === 'Vše' || m.g.includes(activeChip));
                return items.length ? rowHtml(r.name, items, false, r.genres[0]) : '';
            }).join('');
            document.getElementById('catalogRows').innerHTML = html;
            observeThumbs();
            applyFavFilter();
            syncFavButtons();
        }

        // Filtr v řadě oblíbených (posluchač drží na kontejneru, řady se překreslují).
        document.getElementById('catalogRows').addEventListener('input', e => {
            if (e.target.id !== 'favFilter') return;
            favFilterText = e.target.value;
            applyFavFilter();
        });

        document.getElementById('placeholder').addEventListener('click', (e) => {
            // Záložka oblíbených leží uvnitř karty, takže musí být dřív než otevření titulu.
            const fav = e.target.closest('[data-fav-key]');
            if (fav) { e.preventDefault(); e.stopPropagation(); toggleFavorite(favItemFromEl(fav)); return; }
            const arrow = e.target.closest('[data-scroll]');
            if (arrow) {
                const sc = arrow.parentElement.querySelector('.row-scroll');
                sc.scrollBy({ left: Number(arrow.dataset.scroll) * sc.clientWidth * 0.85, behavior: 'smooth' });
                return;
            }
            if (e.target.closest('[data-next]')) { heroOffset++; renderHero(); return; }
            const chip = e.target.closest('[data-chip]');
            if (chip) { activeChip = chip.dataset.chip; renderCatalog(); return; }
            // Karta z osobní řady: rozehraný film jde rovnou přehrát, oblíbený z katalogu
            // (bez odkazu na prehraj.to) otevře hledání jako karta v katalogu.
            const hist = e.target.closest('[data-hist]');
            if (hist) { playFromLibrary(hist.dataset.hist); return; }
            const catq = e.target.closest('[data-catq]');
            if (catq) { openFromCatalog(catq.dataset.catq); return; }
            const item = e.target.closest('[data-q]');
            if (item) openFromCatalog(item.dataset.q);
        });

        // Záložka je <span role="button"> (karta je <button>/<a>), takže Enter a mezerník
        // musí obsluhovat sama - prohlížeč je u ne-tlačítek sám neaktivuje.
        document.addEventListener('keydown', (e) => {
            if (e.key !== 'Enter' && e.key !== ' ') return;
            const el = e.target && e.target.closest ? e.target.closest('[data-fav-key]') : null;
            if (!el || !el.classList.contains('fav-btn')) return;
            e.preventDefault();
            e.stopPropagation();
            toggleFavorite(favItemFromEl(el));
        });

        function goHome() {
            stopVideo();
            hideStatus();
            currentResults = [];
            searchInput.value = '';
            // Vždy překreslit: osobní řady se mezitím mohly změnit (dozrál postup, přibyl oblíbený).
            activeChip = 'Vše';
            renderCatalog();
            window.history.pushState({}, '', window.location.pathname);
            showSection('placeholder');
        }

        renderHero();
        renderCatalog();

        // ===== Katalog z iTunes: stáhne ho server (/api/catalog, cache na 1 den) a překreslí stránku.
        // Když se ho nepodaří stáhnout, zůstane záložní CATALOG výše (české klasiky se přidávají vždy).
        async function loadCatalog() {
            try {
                const { data: d } = await apiJson('/api/catalog?lang=' + (settings.catLang === 'en' ? 'en' : 'cz'), { retries: 2 });
                if (!d || !d.success || !Array.isArray(d.items) || d.items.length === 0) return;
                CATALOG = d.items.concat(BUILTIN_CATALOG.filter(m => (m.g || []).includes('České')));
                heroOffset = 0;
                renderHero();
                renderCatalog();
            } catch (e) { /* zůstane záložní katalog */ }
            finally { markFirstPaint(); }
        }
        loadCatalog();

        // Check URL params on load - for direct video links
        window.addEventListener('DOMContentLoaded', () => {
            const params = new URLSearchParams(window.location.search);
            const videoUrl = params.get('watch');
            const title = params.get('title') || 'Video';
            const searchQuery = params.get('q');

            if (videoUrl) {
                // Direct video link - load and play
                playVideoDirectly(videoUrl, title);
            } else if (searchQuery) {
                // Search query in URL
                searchInput.value = searchQuery;
                searchMovies();
            }
        });

        // Enter key to search
        searchInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') searchMovies();
        });

        // ===== Rate limit (429) =====
        // prehraj.to (i naše vlastní omezení) při přetížení nevrací jen kód - proto se pozná i podle textu
        // chyby. Místo holé chyby ukážeme krátké vysvětlení s ukazatelem do dalšího pokusu a zkusíme to
        // samo znovu (5-10 s, max. 3x).
        function isRateLimited(status, data) {
            if (status === 429) return true;
            if (!data || typeof data !== 'object') return false;
            if (data.rateLimited) return true;
            return data.success === false && /429|příliš mnoho|too many|rate.?limit/i.test(String(data.error || ''));
        }

        function sleep(ms) { return new Promise(res => setTimeout(res, ms)); }

        function retryDelaySeconds(response, data) {
            const h = response && response.headers ? Number(response.headers.get('Retry-After')) : 0;
            const s = Number(data && data.retryAfter) || h || 5;
            return Math.min(10, Math.max(5, s));
        }

        // fetch + JSON s automatickým opakováním při rate limitu.
        // onWait(secs, pokus, max) se zavolá před čekáním, onRetry() těsně před dalším pokusem.
        async function apiJson(url, opts) {
            opts = opts || {};
            const max = opts.retries == null ? 3 : opts.retries;
            for (let attempt = 0; ; attempt++) {
                const response = await fetch(url);
                // Backend hlásí, který proxy server dotaz obsloužil (po failoveru jiný).
                noteActiveProxy(response.headers.get('X-Wflix-Proxy'));
                let data = null;
                try { data = await response.json(); } catch (e) { data = null; }
                if (!isRateLimited(response.status, data)) return { response, data, rateLimited: false };
                if (attempt >= max) return { response, data, rateLimited: true };
                const secs = retryDelaySeconds(response, data);
                if (opts.onWait) opts.onWait(secs, attempt + 1, max);
                await sleep(secs * 1000);
                if (opts.onRetry) opts.onRetry();
            }
        }

        function rateLimitHtml(attempt, max) {
            return '<div class="rl-body"><div class="rl-title">Server chvilku nestíhá</div>'
                + '<div class="rl-text">prehraj.to omezuje počet dotazů, když jich přijde moc najednou. '
                + 'Za pár vteřin to zkusím znovu automaticky (pokus ' + attempt + ' z ' + max + ').</div>'
                + '<div class="rl-bar"><i></i></div></div>';
        }

        function runRateLimitBar(root, secs) {
            const bar = root.querySelector('.rl-bar > i');
            if (!bar) return;
            void bar.offsetWidth;
            bar.style.transition = 'width ' + secs + 's linear';
            bar.style.width = '100%';
        }

        function resultsRateLimited(secs, attempt, max) {
            resultsState.className = 'results-state show ratelimit';
            resultsState.innerHTML = rateLimitHtml(attempt, max);
            resultsInfo.textContent = '';
            runRateLimitBar(resultsState, secs);
        }

        function statusRateLimited(secs, attempt, max) {
            status.className = 'status ratelimit';
            status.innerHTML = rateLimitHtml(attempt, max);
            runRateLimitBar(status, secs);
        }

        function showStatus(message, type) {
            status.className = 'status ' + type;
            status.textContent = message;
        }

        function hideStatus() {
            status.className = 'status';
            status.textContent = '';
        }

        // Krátká hláška, která sama zmizí - na potvrzení (oblíbené, hlasitost, navázání).
        let noticeTimer = null;
        function notice(message, type = 'success', ms = 4000) {
            showStatus(message, type);
            clearTimeout(noticeTimer);
            noticeTimer = setTimeout(() => { if (status.textContent === message) hideStatus(); }, ms);
        }

        // ===== Stav hledání =====
        // Načítání / chyba / prázdný výsledek patří přímo do stránky s výsledky, ne do plovoucí
        // hlášky v rohu - hledání tak vždy skončí na stránce s výsledky, i když se nic nenašlo.
        function esc(s) {
            return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
        }

        function resultsClear() {
            resultsState.className = 'results-state';
            resultsState.innerHTML = '';
        }

        function resultsLoading(message) {
            resultsState.className = 'results-state show';
            resultsState.innerHTML = `<span class="spinner"></span><span class="state-text">${esc(message)}</span>`;
            resultsInfo.textContent = '';
            // kostry karet, ať je vidět, že se načítá
            resultsGrid.innerHTML = Array.from({ length: 8 }, () => '<div class="skel-card"></div>').join('');
        }

        function resultsError(message) {
            resultsState.className = 'results-state show error';
            resultsState.innerHTML = `<span class="state-text">${esc(message)}</span>`
                + '<button type="button" class="state-btn" onclick="retrySearch()">Zkusit znovu</button>';
            resultsInfo.textContent = '';
            resultsGrid.innerHTML = '';
        }

        function resultsEmpty(message, query) {
            resultsState.className = 'results-state show empty';
            resultsState.innerHTML = `<span class="state-text">${esc(message)}</span>`;
            resultsInfo.textContent = query ? `0 výsledků pro „${query}"` : '';
            resultsGrid.innerHTML = '';
        }

        function retrySearch() { searchMovies(); }

        function showSection(section) {
            placeholder.style.display = 'none';
            resultsSection.style.display = 'none';
            playerSection.style.display = 'none';
            pageSection.style.display = 'none';
            liveSection.style.display = 'none';
            livePlayerSection.style.display = 'none';
            // živé vysílání nesmí hrát na pozadí, když se přepne jinam
            if (section !== 'livePlayer') stopLive();
            liveBtn.classList.toggle('active', section === 'live' || section === 'livePlayer');

            if (section === 'results') {
                resultsSection.style.display = 'block';
            } else if (section === 'player') {
                playerSection.style.display = 'block';
            } else if (section === 'page') {
                pageSection.style.display = 'block';
            } else if (section === 'live') {
                liveSection.style.display = 'block';
            } else if (section === 'livePlayer') {
                livePlayerSection.style.display = 'block';
            } else {
                placeholder.style.display = 'block';
            }
        }

        // ===== Statické stránky z patičky (všechno je součástí jedné stránky) =====
        const CONTACT_MAIL = 'contact@qikseek.qzz.io';
        const PAGES = {
            help: {
                title: 'Centrum nápovědy',
                body: `
                    <h2>Hledání</h2>
                    <p>Napiš název do vyhledávání a zmáčkni Enter. Hledá se přes prehraj.to, takže se vyplácí zkusit i jiný tvar názvu – bez roku, bez diakritiky, nebo naopak anglický originál.</p>
                    <p>Když se nic nenajde, zkus kratší část názvu (např. jen první slovo). Čím kratší dotaz, tím víc výsledků – a naopak.</p>
                    <h2>Video se nespustí nebo je černé</h2>
                    <ul>
                        <li>Zkus jiný výsledek – každý záznam je jiný rip a některé už na CDN nejsou.</li>
                        <li>Tlačítko „Stáhnout video“ použij hned: odkaz na CDN je podepsaný a po chvíli přestane platit.</li>
                        <li>Některé soubory nejdou přehrát v prohlížeči (jiný kontejner/kodek) – tehdy pomůže stažení.</li>
                    </ul>
                    <h2>Titulky</h2>
                    <p>Když má soubor titulky, objeví se pod přehrávačem nabídka „Titulky“ s volbami Vypnuto a jazyky. Načítá je server, takže fungují i u zdrojů, které je prohlížeči přímo nedovolí. Ne každý soubor titulky má – český dabing bývá bez nich.</p>
                    <h2>Přehrávač a klávesy</h2>
                    <p>Klávesnicí: <b>mezerník</b> přehrát/pauza, <b>← →</b> posun o 10 sekund, <b>↑ ↓</b> hlasitost, <b>F</b> celá obrazovka. Tlačítko <b>⧉ PiP</b> pošle video do malého okna nad ostatními aplikacemi (Chrome a Edge; jinde ho najdeš v ovládání videa).</p>
                    <p>Velikost a pozadí titulků se nastavují v Nastavení (avatar vpravo nahoře).</p>
                    <h2>Oblíbené a rozehrané filmy</h2>
                    <p>Hvězdička na kartě přidá titul do oblíbených, stejně jako tlačítko u přehrávače. Úvodní stránka pak nahoře ukazuje řady <b>Pokračovat ve sledování</b>, <b>Moje oblíbené</b> a <b>Nedávno sledované</b>. Filmy se po otevření samy pustí od místa, kde jsi skončil. Vše se ukládá jen v tvém prohlížeči.</p>
                    <h2>Chyba 429 (Too Many Requests)</h2>
                    <p>Prehraj.to limituje počet dotazů. Když se to objeví, dej appce minutu pauzu a v Nastavení (avatar vpravo nahoře) zapni „Omezit souběžné dotazy na náhledy“ – načítání náhledů je nejčastější příčina.</p>
                    <h2>Proxy servery</h2>
                    <p>Appka nikdy nevolá prehraj.to přímo. Dotazy jdou přes PHP proxy servery, které má v sobě nastavené, a používá se první, která odpoví. Když je jeden mrtvý nebo zaplněný, appka ho přeskočí a zkusí další. Který server právě odpovídá, ukazuje malý odznak v liště (a řádek v Nastavení) – po přepnutí může být první načtení pomalejší, protože se čeká na timeout mrtvého serveru.</p>
                    <h2>Náhledy a nastavení</h2>
                    <p>V Nastavení (avatar vpravo nahoře) jde změnit katalog na úvodní stránce, omezit počet souběžných dotazů na náhledy a vypnout nebo zapnout Přímé přehrávání z CDN (výchozí: zapnuto). Vše se ukládá jen do tvého prohlížeče.</p>
                    <h2>Přímé přehrávání z CDN</h2>
                    <p>Zapnuto (výchozí): video i IPTV se přehrávají přímo z CDN. Když přímé přehrávání opakovaně selže, appka pro to jedno přehrávání dočasně přejde na server a příště zkusí CDN znovu – nastavení se nemění. Vypnuto: přehrává se rovnou přes server. Server se tak používá jen tam, kde je opravdu potřeba (zdroje bez CORS, s požadavkem na Referer/User-Agent nebo s tokenem v každém segmentu).</p>
                `,
            },
            about: {
                title: 'O projektu',
                body: `
                    <p>Wflix je malý hobby projekt: webové rozhraní ve stylu streamovacích služeb pro filmy, které jsou veřejně dostupné na prehraj.to. Bez registrace, bez reklam, zdarma.</p>
                    <h2>Jak to funguje</h2>
                    <ul>
                        <li>Server je ASP.NET Core (.NET 9) běžící na Azure App Service.</li>
                        <li>Katalog na úvodní stránce bere server z žebříčků iTunes (CZ nebo EN) a cachuje ho na den.</li>
                        <li>Hledání a náhledy jdou přes PHP proxy servery, které požadavek na prehraj.to udělají za server.</li>
                        <li>Přehrávání zajišťuje HTML5 přehrávač. Video se primárně přehrává přímo z CDN; server přes <code>/api/stream</code> nastupuje při chybách (nebo ručně tlačítkem) a vždy při stahování.</li>
                    </ul>
                    <h2>Co tady nenajdeš</h2>
                    <p>Žádná videa se na serveru neukládají ani nehostují. Appka jen zprostředkuje požadavek a přehraje to, co je veřejně dostupné. Účty ani profily nevedeme; rozehrané filmy a oblíbené si appka pamatuje jen v tvém prohlížeči.</p>
                    <p>Nápady a chyby posílej na <a href="mailto:${CONTACT_MAIL}">${CONTACT_MAIL}</a>.</p>
                `,
            },
            sources: {
                title: 'Zdroje a technologie',
                body: `
                    <h2>Odkud se berou data</h2>
                    <ul>
                        <li><strong>Katalog:</strong> iTunes RSS (topmovies, CZ/EN) – bez API klíče, stahuje ho server.</li>
                        <li><strong>Plakáty:</strong> prehraj.to náhledy, volitelně iTunes Search API.</li>
                        <li><strong>Vyhledávání a přehrávání:</strong> prehraj.to, přes vlastní PHP proxy skripty.</li>
                        <li><strong>Titulky:</strong> WebVTT stopy z prehraj.to, přes server.</li>
                    </ul>
                    <h2>Použité technologie</h2>
                    <ul>
                        <li>ASP.NET Core / .NET 9 (MIT) – backend a API.</li>
                        <li>Čisté HTML, CSS a JavaScript – frontend bez frameworku a bez externích fontů.</li>
                        <li>PHP proxy skripty – vlastní, běží na běžném CZ hostingu.</li>
                    </ul>
                    <p>Logo a ikony jsou textové/emoji, žádné cizí assety se nenačítají.</p>
                `,
            },
            terms: {
                title: 'Podmínky užití',
                body: `
                    <p>Wflix je nekomerční hobby služba dostupná tak, jak je, bez jakékoli záruky dostupnosti nebo funkčnosti.</p>
                    <h2>Co appka dělá</h2>
                    <p>Jen zprostředkovává vyhledání a přehrání obsahu, který je veřejně dostupný na prehraj.to. Videa nehostujeme, neukládáme je a nevlastníme. Za obsah odpovídají jeho původní autoři a provozovatel prehraj.to.</p>
                    <h2>Odpovědnost uživatele</h2>
                    <ul>
                        <li>Za legálnost sledování v tvé zemi odpovídáš ty; Wflix není právní ani hostingová služba.</li>
                        <li>Nepoužívej appku k hromadnému automatizovanému stahování ani k přetěžování proxy serverů.</li>
                        <li>Nepokoušej se službu zneužít k šíření obsahu dál pod vlastní hlavičkou.</li>
                    </ul>
                    <h2>Změny</h2>
                    <p>Provozovatel může službu kdykoli omezit, přerušit nebo ukončit, stejně jako zablokovat přístup. Aktuální verze těchto podmínek je vždy tady na stránce.</p>
                    <p>Dotazy k podmínkám: <a href="mailto:${CONTACT_MAIL}">${CONTACT_MAIL}</a>.</p>
                `,
            },
            privacy: {
                title: 'Ochrana soukromí',
                body: `
                    <p>Wflix nemá registraci, přihlášení ani uživatelské účty. Žádná analytika, reklamní skripty ani sledovací cookies.</p>
                    <h2>Co se ukládá u tebe v prohlížeči</h2>
                    <p>Jen nastavení, cache náhledů, rozehrané filmy a oblíbené (localStorage) – podrobnosti a tlačítko na smazání najdeš v <button type="button" class="f-link" onclick="openPage('cookies')" style="color:#fff;text-decoration:underline">Předvolbách cookies</button>.</p>
                    <h2>Co projde serverem</h2>
                    <ul>
                        <li>Hledání a náhledy jdou z našeho serveru na PHP proxy a odtud na prehraj.to – prehraj.to vidí adresu proxy serveru, ne tvou.</li>
                        <li>Při přímém přehrávání jde video z CDN přímo do tvého prohlížeče, takže CDN vidí tvoji IP. Když se přehrává přes server (výchozí chování po chybách nebo tlačítko „Přehrát přes server“), CDN vidí adresu serveru.</li>
                        <li>Hosting (Azure App Service) vede běžné přístupové logy (IP, čas, URL) po dobu danou provozovatelem hostingu.</li>
                        <li>Katalog stahuje server, ne tvůj prohlížeč.</li>
                    </ul>
                    <h2>Tvá práva</h2>
                    <p>Nic o tobě dohledat nelze, protože nic o tobě neukládáme. Případné dotazy piš na <a href="mailto:${CONTACT_MAIL}">${CONTACT_MAIL}</a>.</p>
                `,
            },
            cookies: {
                title: 'Předvolby cookies',
                body: `
                    <p>Wflix nepoužívá cookies pro sledování ani reklamu a nemá žádnou přihlášenou relaci. Místo cookies si do prohlížeče ukládá čtyři věci přes <code>localStorage</code>:</p>
                    <ul>
                        <li><code>${SETTINGS_KEY}</code> – tvoje nastavení (katalog na úvodní stránce, limit náhledů, přímé přehrávání, světlý režim, styl titulků).</li>
                        <li><code>${THUMB_KEY}</code> – cache náhledů, aby se stejné obrázky nenačítaly pořád dokola.</li>
                        <li><code>${HISTORY_KEY}</code> – rozehrané a nedávno sledované filmy (název, pozice, čas).</li>
                        <li><code>${FAVS_KEY}</code> – oblíbené filmy (název a odkaz).</li>
                    </ul>
                    <p>Obě položky zůstávají jen v tvém prohlížeči, na server se neposílají. Smazat je můžeš tlačítkem níž nebo v prohlížeči (Nastavení → Ochrana soukromí → Data stránek).</p>
                    <button type="button" class="btn-play" onclick="clearStoredData()">Vymazat uložená data</button>
                `,
            },
            contact: {
                title: 'Kontakt',
                body: `
                    <p>Wflix je hobby projekt, takže odpověď může chvíli trvat – ale každý mail si přečtu.</p>
                    <p>Piš na <a href="mailto:${CONTACT_MAIL}">${CONTACT_MAIL}</a>.</p>
                    <h2>Ať to můžu vyřešit rychle</h2>
                    <ul>
                        <li>U chyby přilož název filmu a přesný text hlášky (nebo screenshot).</li>
                        <li>U nesprávného výsledku napiš, co jsi hledal a co přišlo.</li>
                        <li>U nedostupného videa pošli odkaz na stránku prehraj.to, kterou výsledek otevírá.</li>
                    </ul>
                    <p>Než napíšeš, koukni do <button type="button" class="f-link" onclick="openPage('help')" style="color:#fff;text-decoration:underline">Centra nápovědy</button> – většina problémů je limit prehraj.to (429) nebo mrtvý rip.</p>
                `,
            },
            settings: {
                title: 'Nastavení',
                body: settingsPageHtml(),
                onOpen: bindSettings,
            },
        };

        // Odkud se na stránku v patičce přišlo, abychom se vrátili na stejné místo.
        let pageReturn = 'placeholder';

        function openPage(key) {
            const page = PAGES[key];
            if (!page) return;
            if (pageSection.style.display !== 'block') {
                pageReturn = resultsSection.style.display === 'block' ? 'results' : 'placeholder';
            }
            stopVideo();
            hideStatus();
            pageTitle.textContent = page.title;
            pageBody.innerHTML = page.body;
            if (typeof page.onOpen === 'function') page.onOpen(pageBody);
            showSection('page');
            window.scrollTo({ top: 0, behavior: 'smooth' });
        }

        function closePage() {
            if (pageReturn === 'results' && currentResults.length > 0) {
                showSection('results');
            } else {
                goHome();
            }
            window.scrollTo({ top: 0, behavior: 'smooth' });
        }

        function clearStoredData() {
            try {
                localStorage.removeItem(SETTINGS_KEY);
                localStorage.removeItem(THUMB_KEY);
                localStorage.removeItem(HISTORY_KEY);
                localStorage.removeItem(FAVS_KEY);
            } catch (e) {}
            thumbCache = {};
            window.location.href = window.location.pathname;
        }

        async function searchMovies() {
            const query = searchInput.value.trim();
            searchBox.classList.toggle('has-text', query.length > 0);

            // Stop any playing video before searching
            stopVideo();

            // Rovnou na stránku s výsledky - stav hledání je její součást.
            showSection('results');
            window.scrollTo({ top: 0, behavior: 'smooth' });

            if (!query) {
                resultsError('Zadej název filmu nebo seriálu.');
                searchInput.focus();
                return;
            }

            // Update URL with search query
            const newUrl = `${window.location.pathname}?q=${encodeURIComponent(query)}`;
            window.history.pushState({}, '', newUrl);

            searchBtn.disabled = true;
            searchBtn.classList.add('busy');
            currentResults = [];
            resultsLoading(`Hledám „${query}" …`);

            try {
                const { response, data, rateLimited } = await apiJson(
                    `/api/search?q=${encodeURIComponent(query)}${proxyQS()}`,
                    { onWait: resultsRateLimited, onRetry: () => resultsLoading(`Hledám „${query}" …`) });

                if (rateLimited) {
                    resultsError('Server pořád hlásí příliš mnoho dotazů. Zkus to prosím za chvilku znovu.');
                } else if (!data) {
                    resultsError(`Server nevrátil platnou odpověď (HTTP ${response.status}).`);
                } else if (data.success && data.movies && data.movies.length > 0) {
                    const catItem = CATALOG.find(m => m.q === query);
                    if (catItem) data.movies = rankMovies(catItem, data.movies);
                    currentResults = data.movies;
                    displayResults(data.movies, query);
                } else if (data.success) {
                    resultsEmpty(`Nic jsme nenašli pro „${query}". Zkus jiný název nebo jiný pravopis.`, query);
                } else {
                    resultsError(data.error || 'Chyba při vyhledávání.');
                }
            } catch (error) {
                console.error('Search error:', error);
                resultsError(`Chyba připojení: ${error.message}`);
            } finally {
                searchBtn.disabled = false;
                searchBtn.classList.remove('busy');
            }
        }

        function createResultCard(movie) {
            const card = document.createElement('a');
            card.className = 'movie-card';
            card.dataset.url = movie.url;
            card.href = `?watch=${encodeURIComponent(movie.url)}&title=${encodeURIComponent(movie.title)}`;
            // Allow middle-click / ctrl+click to open in new tab
            card.onclick = (e) => {
                if (!e.ctrlKey && !e.metaKey && e.button === 0) {
                    e.preventDefault();
                    playMovieByUrl(movie.url);
                }
            };

            card.innerHTML = `
                    <div class="card-play"><i>▶</i></div>
                    <img src="${movie.thumbnail || 'data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 16 9%22><rect fill=%22%23333%22 width=%2216%22 height=%229%22/><text x=%228%22 y=%225%22 fill=%22%23666%22 text-anchor=%22middle%22 font-size=%222%22>🎬</text></svg>'}"
                         alt="${movie.title}"
                         onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 16 9%22><rect fill=%22%23333%22 width=%2216%22 height=%229%22/><text x=%228%22 y=%225%22 fill=%22%23666%22 text-anchor=%22middle%22 font-size=%222%22>🎬</text></svg>'">
                    ${favBtnHtml({ url: movie.url, title: movie.title, poster: movie.thumbnail || '' })}
                    <div class="info">
                        <div class="title">${movie.title}</div>
                        ${movie.year ? `<div class="year">${movie.year}</div>` : ''}
                    </div>
                `;
            return card;
        }

        // Záložka ve výsledcích hledání: karta je <a>, takže klik musíme vzít dřív, než
        // se stihne otevřít přehrávač (capture fáze).
        resultsGrid.addEventListener('click', e => {
            const fav = e.target.closest('[data-fav-key]');
            if (!fav) return;
            e.preventDefault();
            e.stopPropagation();
            toggleFavorite(favItemFromEl(fav));
        }, true);

        function displayResults(movies, query) {
            resultsClear();
            resultsInfo.textContent = `Nalezeno ${movies.length} výsledků pro „${query}"`;
            resultsGrid.innerHTML = '';

            movies.forEach(movie => resultsGrid.appendChild(createResultCard(movie)));

            showSection('results');
        }

        // ===== Přehrávání =====
        // Odkaz na video z CDN je podepsaný a po pár minutách přestane fungovat - prohlížeč pak při
        // dalším dotahování (buffer dojde za ~3-5 min) dostane chybu a video se zasekne. Proto:
        //  1) při chybě/zaseknutí si vezmeme čerstvý odkaz a navážeme od místa, kde video skončilo,
        //  2) když ani to nepomůže, přepneme na /api/stream (server video přeposílá a odkaz si
        //     sám obnovuje). To platí i pro přímé přehrávání: po opakovaných chybách se pro
        //     tohle přehrávání dočasně použije server, nastavení se nemění,
        //  3) tlačítko Stáhnout jde vždy přes /api/stream (CDN odkaz napřímo se stáhnout nedá).
        const player = { page: '', cdn: '', title: '', poster: '', mode: 'direct', lastTime: 0, resumeAt: 0, fixes: 0, busy: false, stallTimer: null, subs: [], subSig: '', subLang: null, subOff: false, subIndex: -1, subEls: [] };

        // ===== Titulky (WebVTT z prehraj.to) =====
        // PHP proxy vytáhne stopy z inicializace přehrávače do "subtitles". Prohlížeč je
        // načítá přes /api/subtitles: CDN nemusí posílat CORS a token v odkazu vyprší.
        const SUB_LANG_NAMES = {
            cs: 'Čeština', ces: 'Čeština', cze: 'Čeština',
            sk: 'Slovenština', slk: 'Slovenština', slo: 'Slovenština',
            en: 'Angličtina', eng: 'Angličtina',
            de: 'Němčina', deu: 'Němčina', ger: 'Němčina',
        };

        function subtitleLabel(s) {
            // JWPlayer: "ENG - 8175377 - eng" -> "ENG"
            let label = String(s.label || '').replace(/\s*-\s*\d+\s*-\s*[a-z]{2,3}\s*$/i, '').trim();
            if (!label) {
                const lang = String(s.lang || '').toLowerCase();
                label = SUB_LANG_NAMES[lang] || (lang ? lang.toUpperCase() : 'Titulky');
            }
            return label;
        }

        // Stopu zapínáme na objektu z konkrétního <track> elementu, ne podle pořadí v
        // videoPlayer.textTracks: prohlížeč tam staré stopy po přepnutí filmu chvíli
        // nechává, takže indexy přestanou sedět a titulky se pak nevykreslí vůbec.
        function applySubtitle(index, force = false) {
            player.subIndex = index;
            const own = player.subEls;
            const chosen = index >= 0 && own[index] ? own[index].track : null;
            own.forEach((el, i) => {
                const track = el.track;
                if (track) track.mode = i === index ? 'showing' : 'disabled';
            });
            const live = videoPlayer.textTracks;
            for (let i = 0; i < live.length; i++) {
                if (live[i] !== chosen) live[i].mode = 'disabled';
            }
            // Fullscreen někdy stopu nechá jako "showing", ale přestane vykreslovat cue.
            // Přepnutí hidden -> showing ji donutí znovu načíst/vykreslit.
            if (force && chosen) {
                chosen.mode = 'hidden';
                chosen.mode = 'showing';
            }
            subtitleSelect.value = index >= 0 ? String(index) : '';
        }

        function clearSubtitles() {
            player.subs = [];
            player.subSig = '';
            player.subLang = null;
            player.subOff = false;
            player.subIndex = -1;
            player.subEls = [];
            videoPlayer.querySelectorAll('track[data-wflix-sub]').forEach(t => t.remove());
            subtitleSelect.innerHTML = '';
            subNote.hidden = true;
            subtitleBar.hidden = true;
        }

        function setSubtitles(list) {
            const subs = (Array.isArray(list) ? list : []).filter(s => s && typeof s.url === 'string' && s.url);
            const sig = JSON.stringify(subs.map(s => [s.url, s.lang || '', s.label || '', s.default === true]));
            if (sig === player.subSig) return;   // stejná sada (obnova přehrávání) - výběr zůstane

            player.subSig = sig;
            player.subs = subs;
            player.subEls = [];
            videoPlayer.querySelectorAll('track[data-wflix-sub]').forEach(t => t.remove());
            subtitleSelect.innerHTML = '';
            subNote.hidden = true;
            subtitleBar.hidden = subs.length === 0;
            if (!subs.length) {
                player.subLang = null;
                player.subOff = false;
                player.subIndex = -1;
                return;
            }

            subtitleSelect.appendChild(new Option('Vypnuto', ''));
            const els = [];
            let defaultIndex = -1;
            subs.forEach((s, i) => {
                const track = document.createElement('track');
                track.kind = 'subtitles';
                track.label = subtitleLabel(s);
                track.srclang = s.lang || 'und';
                track.src = '/api/subtitles?url=' + encodeURIComponent(s.url);
                track.setAttribute('data-wflix-sub', '1');
                // Když relay VTT nevydá, ať je to vidět - jinak titulky chybí bez vysvětlení.
                track.addEventListener('error', () => {
                    if (player.subEls[i] === track && player.subIndex === i) subNote.hidden = false;
                });
                if (s.default) {
                    track.default = true;
                    defaultIndex = i;
                }
                videoPlayer.appendChild(track);
                els.push(track);
                subtitleSelect.appendChild(new Option(track.label, String(i)));
            });
            player.subEls = els;

            // Zachovat volbu diváka; jinak výchozí stopa z přehrávače, a když ji web
            // neoznačí, vzít první českou (jinak by titulky zůstaly rovnou vypnuté).
            let index = -1;
            if (!player.subOff) {
                if (player.subLang) index = subs.findIndex(s => (s.lang || '') === player.subLang);
                if (index < 0) index = defaultIndex;
                if (index < 0) index = subs.findIndex(s => /^(cs|ces|cze)$/i.test(s.lang || '') || /^cze/i.test(s.label || ''));
            }
            // Stopu zapneme hned a ještě jednou po chvíli, až prohlížeč <track> zařadí.
            applySubtitle(index);
            setTimeout(() => { if (player.subSig === sig) applySubtitle(index); }, 0);
            setTimeout(() => { if (player.subSig === sig) applySubtitle(index, true); }, 700);
        }

        function selectSubtitle(index) {
            if (index >= 0 && player.subs[index]) {
                player.subLang = player.subs[index].lang || '';
                player.subOff = false;
            } else {
                player.subLang = null;
                player.subOff = true;
            }
            applySubtitle(index);
        }

        subtitleSelect.addEventListener('change', () => {
            const v = subtitleSelect.value;
            selectSubtitle(v === '' ? -1 : parseInt(v, 10));
        });

        // Při přechodu do/z celé obrazovky některé prohlížeče resetují režim textové stopy.
        // Znovu zapneme stejnou volbu; když divák mezitím zvolil jinou, nic nepřepisujeme.
        function restoreSubtitleAfterFullscreen() {
            const subs = player.subs;
            const index = player.subIndex;
            if (!subs.length) return;
            const restore = () => {
                if (player.subs === subs && player.subIndex === index) applySubtitle(index, true);
            };
            restore();
            requestAnimationFrame(restore);
            setTimeout(restore, 100);
            setTimeout(restore, 400);
        }
        document.addEventListener('fullscreenchange', restoreSubtitleAfterFullscreen);
        document.addEventListener('webkitfullscreenchange', restoreSubtitleAfterFullscreen);
        videoPlayer.addEventListener('webkitbeginfullscreen', restoreSubtitleAfterFullscreen);
        videoPlayer.addEventListener('webkitendfullscreen', restoreSubtitleAfterFullscreen);

        // v = přesný CDN odkaz, který právě hraje: server stáhne/přepošle ten samý soubor
        // (a při vypršení ho najde na stránce podle cesty), takže se nemůže splést s jiným videem.
        function streamUrl(page, download, cdn) {
            return `/api/stream?url=${encodeURIComponent(page)}`
                + (cdn ? `&v=${encodeURIComponent(cdn)}` : '')
                + (download ? `&download=1&name=${encodeURIComponent(player.title || 'video')}` : '');
        }

        // Odkaz tlačítka Stáhnout se skládá z aktuálního stavu přehrávače, ne z toho, co bylo dřív.
        function refreshDl() {
            dlBtn.href = player.page ? streamUrl(player.page, true, player.cdn) : '#';
        }
        dlBtn.addEventListener('click', (e) => {
            if (!player.page) { e.preventDefault(); return; }
            refreshDl();
        });

        async function fetchVideoData(page) {
            const { data: d, rateLimited } = await apiJson(
                `/api/proxy?url=${encodeURIComponent(page)}${proxyQS()}&_=${Date.now()}`,
                { onWait: statusRateLimited, onRetry: hideStatus });
            if (rateLimited) throw new Error('Server pořád hlásí příliš mnoho dotazů. Zkus to prosím za chvilku znovu.');
            if (!d || !d.success || !d.videoUrl) throw new Error((d && d.error) || 'Video se nepodařilo načíst');
            return d;
        }

        // Načte video a spustí ho. Přímé přehrávání (výchozí) zkusí CDN; když je vypnuté,
        // jde rovnou přes server. beforePlay se zavolá, jakmile je možné pustit přehrávač.
        // Když má film v prohlížeči uloženou pozici (Watch history), naváže se tam.
        async function loadAndPlay(page, title, beforePlay, poster) {
            const useDirect = directPreferred();
            player.page = page; player.cdn = ''; player.title = title || 'video';
            player.mode = useDirect ? 'direct' : 'relay';
            player.lastTime = 0; player.resumeAt = 0; player.fixes = 0; player.busy = false;
            proxyBtn.hidden = true;
            clearTimeout(player.stallTimer);
            refreshDl();
            hidePlayerEnd();
            setNowPlaying(title, poster || posterFor(title));
            clearSubtitles();

            const data = await fetchVideoData(page);
            if (player.page !== page) return; // mezitím se přepnulo na jiné video
            setSubtitles(data.subtitles);
            const url = data.videoUrl;
            player.cdn = url;
            refreshDl();
            // Vypnuté přímé přehrávání = server od začátku. Výjimka je HLS: /api/stream
            // ho přeposílat neumí, takže takový zdroj přehrajeme přímo (Safari nativně).
            const isHls = /\.m3u8(\?|$)/i.test(url);
            const src = useDirect || isHls ? url : streamUrl(page, false, url);
            // Skutečný zdroj (ne jen nastavení) - HLS jde přímo i při vypnutém CDN.
            player.mode = src === url ? 'direct' : 'relay';
            setPlayerSource(player.mode);
            updateFavBtn();
            const resume = historyResume(page);
            if (beforePlay) beforePlay();
            if (resume > 1) {
                videoPlayer.addEventListener('loadedmetadata', () => {
                    if (player.page !== page) return;
                    try { videoPlayer.currentTime = resume; } catch (e) {}
                    notice('⏱ Pokračuji od ' + fmtClock(resume));
                }, { once: true });
            }
            videoPlayer.src = src;
            try {
                await videoPlayer.play();
            } catch (playError) {
                showStatus('✅ Video připraveno. Klikni na přehrávač pro spuštění.', 'success');
            }
        }

        async function recoverPlayback(reason) {
            if (!player.page || player.busy) return;
            if (player.fixes >= 6) {
                showStatus('❌ Video se nepodařilo obnovit. Zkus stránku načíst znovu nebo použij Stáhnout.', 'error');
                return;
            }
            player.busy = true;
            player.fixes++;
            const page = player.page;
            const resumeAt = player.lastTime;
            player.resumeAt = resumeAt;
            // Po dvou neúspěšných pokusech s čerstvým CDN odkazem zkusíme server. Je to jen
            // pro tohle přehrávání: nastavení zůstává zapnuté a další video zkusí CDN znovu,
            // takže server se nepoužívá, dokud přímá cesta opravdu nefunguje.
            if (player.mode === 'direct' && player.fixes > 2) {
                player.mode = 'relay';
                proxyBtn.hidden = true;
            }
            setPlayerSource(player.mode);
            // Ruční nabídka serveru dřív, než na něj appka přejde sama.
            if (player.mode === 'direct' && player.fixes >= 2) proxyBtn.hidden = false;
            console.warn('Obnova přehrávání:', reason, 'mode=' + player.mode, 'od', resumeAt);
            showStatus(player.mode === 'relay'
                ? '🔄 Přímé přehrávání selhalo, pokračuji přes server…'
                : '🔄 Obnovuju přehrávání…', 'loading');
            try {
                let src;
                if (player.mode === 'relay') {
                    src = streamUrl(page, false, player.cdn);
                } else {
                    const data = await fetchVideoData(page);
                    if (player.page !== page) return; // mezitím se přepnulo na jiné video
                    setSubtitles(data.subtitles);
                    src = data.videoUrl;
                    player.cdn = src;
                    refreshDl();
                }
                videoPlayer.addEventListener('loadedmetadata', () => {
                    if (resumeAt > 1) videoPlayer.currentTime = resumeAt;
                    videoPlayer.play().catch(() => {});
                    hideStatus();
                }, { once: true });
                videoPlayer.src = src;
            } catch (e) {
                console.error('Recover error:', e);
                // Když ani získání čerstvého odkazu nevyjde, nabídneme server ručně.
                if (player.mode === 'direct') proxyBtn.hidden = false;
                showStatus(`❌ ${e.message}`, 'error');
            } finally {
                player.busy = false;
            }
        }

        // Ruční přepnutí na server (tlačítko „Přehrát přes server“). Používá se jen když
        // přímé přehrávání selhalo - výchozí chování se přepíná samo jako dřív.
        function playThroughServer() {
            if (!player.page) return;
            const page = player.page;
            const resumeAt = player.lastTime;
            player.mode = 'relay';
            player.fixes = 0;
            proxyBtn.hidden = true;
            setPlayerSource('relay');
            showStatus('🔄 Přepínám na přehrávání přes server…', 'loading');
            videoPlayer.addEventListener('loadedmetadata', () => {
                if (player.page !== page) return;   // mezitím se přeplo na jiné video
                if (resumeAt > 1) videoPlayer.currentTime = resumeAt;
                videoPlayer.play().catch(() => {});
                hideStatus();
            }, { once: true });
            videoPlayer.src = streamUrl(page, false, player.cdn);
        }
        proxyBtn.addEventListener('click', playThroughServer);

        videoPlayer.addEventListener('timeupdate', () => {
            clearTimeout(player.stallTimer);
            if (!videoPlayer.seeking && videoPlayer.currentTime > 0) player.lastTime = videoPlayer.currentTime;
            // po minutě a půl bez problému počítadlo pokusů vynulujeme (odkaz vyprší klidně víckrát)
            if (player.fixes > 0 && videoPlayer.currentTime - player.resumeAt > 90) player.fixes = 0;
            historySave(false);   // pozice pro "Pokračovat ve sledování" (nejvýš 1× za 4 s)
        });
        videoPlayer.addEventListener('error', () => {
            if (!player.page || !videoPlayer.getAttribute('src')) return;
            recoverPlayback('error ' + (videoPlayer.error ? videoPlayer.error.code : '?'));
        });
        ['waiting', 'stalled'].forEach(ev => videoPlayer.addEventListener(ev, () => {
            if (!player.page || player.stallTimer) return;
            player.stallTimer = setTimeout(() => {
                player.stallTimer = null;
                if (!videoPlayer.paused && !videoPlayer.ended && videoPlayer.readyState < 3) recoverPlayback('stall');
            }, 12000);
        }));
        ['playing', 'pause', 'seeking'].forEach(ev => videoPlayer.addEventListener(ev, () => {
            clearTimeout(player.stallTimer); player.stallTimer = null;
        }));
        // Na pauze a po přetočení se pozice uloží hned - kdyby divák odešel, nesmí se ztratit.
        videoPlayer.addEventListener('pause', () => historySave(true));
        videoPlayer.addEventListener('seeked', () => historySave(true));
        // spojení, co se utrhlo uprostřed, se občas tváří jako "konec" videa
        videoPlayer.addEventListener('ended', () => {
            if (player.page && isFinite(videoPlayer.duration) && videoPlayer.duration - videoPlayer.currentTime > 10) {
                recoverPlayback('predcasny konec');
                return;
            }
            msSetState('paused');
            historySave(true);   // dohrané = z "Pokračovat ve sledování" zmizí, v "Nedávno" zůstane
            if (player.page) showPlayerEnd();
        });

        // ===== Živé vysílání (IPTV) =====
        // Seznam kanálů tahá server (/api/live) z iptv-org, protože playlisty jsou velké a část
        // z nich neposílá CORS. hls.js se načítá až při prvním kliknutí na kanál, aby úvodní
        // stránka nenačítala 400 kB navíc.
        let liveChannels = [];
        let liveShown = 0;
        let liveHls = null;
        let liveHlsPromise = null;
        let liveChannel = null;   // kanál, který právě hraje
        let liveNativeErrorHandler = null;   // Safari/iOS: přepnutí na server po chybě

        // Filtry podle tagů: "hd" = 1080p/4K, "noGeo" skryje geo-blokované, "only24" skryje ty,
        // co nejedou 24/7. Vzájemně se násobí, "Vše" je zruší.
        const liveFlags = { hd: false, noGeo: false, only24: false };

        function liveQuery() {
            const v = liveSource.value || 'cz';
            if (v.startsWith('lang:')) return 'lang=' + encodeURIComponent(v.slice(5));
            return 'country=' + encodeURIComponent(v);
        }

        function initials(name) {
            return (name || '?').split(/\s+/).slice(0, 2).map(w => w.charAt(0)).join('').toUpperCase();
        }

        function openLive(push = true) {
            stopVideo();
            hideStatus();
            showSection('live');
            window.scrollTo({ top: 0, behavior: 'smooth' });
            if (push) window.history.pushState({}, '', '?live=' + encodeURIComponent(liveSource.value));
            if (!liveChannels.length) loadLive();
        }

        async function loadLive() {
            liveState.className = 'results-state show';
            liveState.innerHTML = '<span class="spinner"></span><span class="state-text">Načítám kanály…</span>';
            liveGrid.innerHTML = '';
            try {
                const r = await fetch('/api/live?' + liveQuery());
                const d = await r.json();
                if (!d.success) throw new Error(d.error || 'Seznam kanálů se nepodařilo načíst');
                liveChannels = Array.isArray(d.channels) ? d.channels : [];
                if (!liveChannels.length) throw new Error('Seznam je prázdný');
                renderLive(true);
            } catch (e) {
                liveChannels = [];
                liveState.className = 'results-state show error';
                liveState.innerHTML = `<span class="state-text">${escapeHtml(e.message)}</span>`;
            }
        }

        // Seznamy jako USA mají přes tisíc kanálů - vykreslujeme po dávkách, ať se telefon nezadusí.
        const LIVE_PAGE = 300;

        function renderLive(reset) {
            if (reset) liveShown = LIVE_PAGE;
            const q = liveFilter.value.trim().toLowerCase();
            const items = liveChannels
                .map((c, i) => ({ c, i }))
                .filter(o => !q || o.c.name.toLowerCase().includes(q) || (o.c.group || '').toLowerCase().includes(q))
                .filter(o => {
                    const tags = o.c.tags || [];
                    if (liveFlags.hd && !(o.c.quality === '1080p' || o.c.quality === '4k')) return false;
                    if (liveFlags.noGeo && tags.includes('geo')) return false;
                    if (liveFlags.only24 && tags.includes('not24')) return false;
                    return true;
                });

            liveState.className = 'results-state' + (items.length ? '' : ' show empty');
            liveState.innerHTML = items.length ? '' : '<span class="state-text">Takový kanál tu není. Zkus jiný název nebo jiný zdroj.</span>';

            const rest = Math.max(0, items.length - liveShown);
            liveGrid.innerHTML = items.slice(0, liveShown).map(({ c, i }) => `
                <button class="live-card" data-live="${i}" title="${escapeHtml(c.name)}">
                    <span class="lc-logo">${c.logo
                        ? `<img src="${escapeHtml(c.logo)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">`
                        : `<span class="lc-init">${escapeHtml(initials(c.name))}</span>`}</span>
                    <span class="lc-name">${escapeHtml(c.name)}</span>
                    ${(c.quality || (c.tags || []).length) ? `<span class="lc-badges">
                        ${c.quality ? `<span class="lc-badge q">${escapeHtml(c.quality)}</span>` : ''}
                        ${(c.tags || []).includes('geo') ? '<span class="lc-badge geo">geo blok</span>' : ''}
                        ${(c.tags || []).includes('not24') ? '<span class="lc-badge not24">ne 24/7</span>' : ''}
                    </span>` : ''}
                    ${c.group ? `<span class="lc-group">${escapeHtml(c.group)}</span>` : ''}
                </button>`).join('')
                + (rest ? `<button class="live-more" id="liveMore">Zobrazit další (${rest})</button>` : '');
        }

        function ensureHls() {
            if (window.Hls) return Promise.resolve(window.Hls);
            if (!liveHlsPromise) {
                liveHlsPromise = new Promise((resolve, reject) => {
                    const sc = document.createElement('script');
                    sc.src = '/hls.min.js';
                    sc.async = true;
                    sc.onload = () => resolve(window.Hls);
                    sc.onerror = () => reject(new Error('Přehrávač HLS se nepodařilo načíst'));
                    document.head.appendChild(sc);
                });
            }
            return liveHlsPromise;
        }

        // Relay URL pro kanál, který chce vlastní User-Agent / Referer (#EXTVLCOPT v playlistu).
        function liveRelayUrl(ch) {
            let url = '/api/live/hls?url=' + encodeURIComponent(ch.url);
            if (ch.ua) url += '&ua=' + encodeURIComponent(ch.ua);
            if (ch.referrer) url += '&referrer=' + encodeURIComponent(ch.referrer);
            return url;
        }

        function showLiveError(msg) {
            liveError.textContent = msg;
            liveError.hidden = false;
        }

        async function playLive(ch) {
            if (!ch) return;
            liveNow.textContent = ch.name;
            liveError.hidden = true;
            liveVideo.poster = ch.logo || '';
            showSection('livePlayer');
            window.scrollTo({ top: 0, behavior: 'smooth' });
            window.history.pushState({}, '', '?live=' + encodeURIComponent(liveSource.value) + '&ch=' + encodeURIComponent(ch.name));
            stopLive();
            liveChannel = ch;
            setNowPlayingLive(ch);

            // Kanál, který vyžaduje konkrétní User-Agent nebo Referer (#EXTVLCOPT), prohlížeč
            // napřímo nepřehraje - hlavičky u <video> nastavit nelze. Takový jde vždy přes relay.
            const needsHeaders = !!(ch.ua || ch.referrer);
            const relayUrl = liveRelayUrl(ch);

            // Safari/iOS umí HLS nativně a CORS u videa neřeší - tam je přímé přehrání nejlepší.
            // Vypnuté přímé přehrávání znamená server od začátku.
            const useRelay = needsHeaders || !directPreferred();
            if (!useRelay && liveVideo.canPlayType('application/vnd.apple.mpegurl')) {
                liveVideo.src = ch.url;
                liveVideo.play().catch(() => {});
                // Když nativní přímé přehrání selže, přepneme pro tenhle kanál na server.
                // Nastavení se nemění, další kanál zkusí CDN znovu.
                liveNativeErrorHandler = () => {
                    if (liveChannel !== ch || liveVideo.getAttribute('src') !== ch.url) return;
                    liveVideo.removeEventListener('error', liveNativeErrorHandler);
                    liveNativeErrorHandler = null;
                    liveVideo.src = relayUrl;
                    liveVideo.play().catch(() => {});
                    showLiveError('Přímé přehrávání selhalo, přepínám na server…');
                    liveVideo.addEventListener('playing', () => {
                        if (liveChannel === ch) liveError.hidden = true;
                    }, { once: true });
                    liveVideo.addEventListener('error', () => {
                        if (liveChannel === ch && liveVideo.getAttribute('src') === relayUrl)
                            showLiveError('Kanál teď nejde přehrát – může být geoblokovaný, dočasně mimo provoz nebo změnil adresu. Zkus jiný kanál.');
                    }, { once: true });
                };
                liveVideo.addEventListener('error', liveNativeErrorHandler);
                return;
            }

            let Hls;
            try { Hls = await ensureHls(); }
            catch (e) { showLiveError(e.message); return; }
            if (!Hls || !Hls.isSupported()) {
                showLiveError('Tenhle prohlížeč neumí HLS. Zkus to v jiném prohlížeči.');
                return;
            }

            let relayed = useRelay;
            let directRetries = 0;
            const hls = new Hls({ enableWorker: true });
            liveHls = hls;
            hls.on(Hls.Events.ERROR, (_ev, data) => {
                if (!data.fatal) return;
                // CORS nebo zdroj, který prohlížeči nevrátí playlist. Nejdřív zkusíme přímé
                // přehrání jednou znovu; když selže i to, přepneme pro tenhle kanál na server.
                // Nastavení zůstává zapnuté, další kanál zkusí CDN znovu.
                if (data.type === Hls.ErrorTypes.NETWORK_ERROR && !relayed) {
                    if (directRetries++ < 1) { hls.startLoad(); return; }
                    relayed = true;
                    showLiveError('Přímé přehrávání selhalo, přepínám na server…');
                    hls.loadSource(relayUrl);
                    hls.startLoad();
                    return;
                }
                showLiveError('Kanál teď nejde přehrát – může být geoblokovaný, dočasně mimo provoz nebo změnil adresu. Zkus jiný kanál.');
                hls.destroy();
                if (liveHls === hls) liveHls = null;
            });
            hls.on(Hls.Events.MANIFEST_PARSED, () => {
                liveError.hidden = true;   // schová i hlášku o dočasném přepnutí na server
                liveVideo.play().catch(() => {});
            });
            hls.loadSource(useRelay ? relayUrl : ch.url);
            hls.attachMedia(liveVideo);
        }

        function stopLive() {
            liveChannel = null;
            if (liveNativeErrorHandler) {
                liveVideo.removeEventListener('error', liveNativeErrorHandler);
                liveNativeErrorHandler = null;
            }
            if (liveHls) { liveHls.destroy(); liveHls = null; }
            if (liveVideo) {
                liveVideo.pause();
                liveVideo.removeAttribute('src');
                liveVideo.load();
            }
            msClear(liveVideo);
        }

        function backToLive() {
            stopLive();
            showSection('live');
            window.history.pushState({}, '', '?live=' + encodeURIComponent(liveSource.value));
        }

        // ===== Media Session: název, plakát a posuvník na uzamčené obrazovce / v notifikaci / ve sluchátkách =====
        // Platí pro film i pro živý kanál: msTarget je <video>, který právě „hraje“.
        const msSupported = 'mediaSession' in navigator;
        var msTarget = null, msLive = false, msLastPos = 0;
        var BASE_TITLE = document.title;

        function msSetState(state) {
            if (!msSupported) return;
            try { navigator.mediaSession.playbackState = state; } catch (e) {}
        }

        function safeDecode(s) {
            try { return decodeURIComponent(s); } catch (e) { return String(s || ''); }
        }
        // Do notifikace patří název filmu, ne soubor: bez přípony a bez okolních mezer.
        function cleanTitle(t) {
            return String(t || '').trim().replace(/\.(mp4|mkv|avi|mov|wmv|webm|m4v|ts)$/i, '').trim();
        }

        // Okno, ve kterém se dá posouvat. Film: 0..délka. Živě: seekable (okno, které kanál nabízí).
        function msWindow() {
            const v = msTarget;
            if (!v) return null;
            if (msLive) {
                const s = v.seekable;
                if (!s || !s.length) return null;
                const start = s.start(0), end = s.end(s.length - 1);
                return end - start >= 15 ? [start, end] : null;   // kratší okno nemá smysl jako posuvník
            }
            return isFinite(v.duration) && v.duration > 0 ? [0, v.duration] : null;
        }

        // Posuvník času na zamykací obrazovce (Chrome/Android, iOS, hardwarové ovládání).
        function msPosition() {
            if (!msSupported || !msTarget || !navigator.mediaSession.setPositionState) return;
            try {
                const w = msWindow();
                if (!w) { navigator.mediaSession.setPositionState(); return; }   // bez posuvníku
                const duration = w[1] - w[0];
                const position = Math.min(duration, Math.max(0, msTarget.currentTime - w[0]));
                navigator.mediaSession.setPositionState({ duration, position, playbackRate: msTarget.playbackRate || 1 });
            } catch (e) {}
        }

        function msSetMetadata(target, live, title, artist, poster) {
            msTarget = target; msLive = live;
            document.title = title ? title + ' – ' + BASE_TITLE : BASE_TITLE;
            if (!msSupported) return;
            try {
                let art = [];
                if (poster) {
                    let src = poster;
                    try { src = new URL(poster, location.href).href; } catch (e) {}
                    art = [{ src, sizes: '512x512' }];
                }
                navigator.mediaSession.metadata = new MediaMetadata({
                    title: title || '', artist: artist || '', album: 'Wflix', artwork: art,
                });
            } catch (e) {}
            msPosition();
        }

        function msClear(target) {
            if (!msTarget || (target && msTarget !== target)) return;
            msTarget = null; msLive = false;
            document.title = BASE_TITLE;
            if (!msSupported) return;
            try { navigator.mediaSession.metadata = null; navigator.mediaSession.playbackState = 'none'; } catch (e) {}
            try { navigator.mediaSession.setPositionState(); } catch (e) {}
        }

        if (msSupported) {
            const setHandler = (action, fn) => { try { navigator.mediaSession.setActionHandler(action, fn); } catch (e) {} };
            const seekTo = t => {
                const w = msWindow();
                if (!msTarget) return;
                msTarget.currentTime = w ? Math.min(w[1], Math.max(w[0], t)) : Math.max(0, t);
            };
            setHandler('play', () => { if (msTarget) msTarget.play().catch(() => {}); });
            setHandler('pause', () => { if (msTarget) msTarget.pause(); });
            setHandler('seekbackward', d => { if (msTarget) seekTo(msTarget.currentTime - (d.seekOffset || 10)); });
            setHandler('seekforward', d => { if (msTarget) seekTo(msTarget.currentTime + (d.seekOffset || 10)); });
            setHandler('seekto', d => {
                if (!msTarget || typeof d.seekTime !== 'number') return;
                const w = msWindow();
                seekTo(msLive && w ? w[0] + d.seekTime : d.seekTime);   // živě je čas relativní k oknu
            });
        }

        [videoPlayer, liveVideo].forEach(el => {
            el.addEventListener('play', () => { if (el === msTarget) { msSetState('playing'); msPosition(); } });
            el.addEventListener('pause', () => { if (el === msTarget && !el.ended) { msSetState('paused'); msPosition(); } });
            ['loadedmetadata', 'durationchange', 'seeked', 'ratechange', 'playing'].forEach(ev =>
                el.addEventListener(ev, () => { if (el === msTarget) msPosition(); }));
            el.addEventListener('timeupdate', () => {
                if (el !== msTarget) return;
                const now = Date.now();
                if (now - msLastPos > 1000) { msLastPos = now; msPosition(); }
            });
        });
        videoPlayer.addEventListener('playing', hidePlayerEnd);

        // Plakát k titulu: z výsledků, z katalogu, nebo z cache náhledů (klíčem je dotaz).
        function posterFor(title) {
            const t = (title || '').trim();
            if (!t) return '';
            const cat = CATALOG.find(m => m.t === t || m.q === t);
            if (cat && cat.img) return cat.img;
            const cached = thumbCache[t];
            return cached && cached.u ? cached.u : '';
        }

        // Jeden zdroj pravdy pro „co právě hraje“: plakát přehrávače + media session.
        function setNowPlaying(title, poster) {
            player.title = title || 'video';
            player.poster = poster || '';
            if (poster) videoPlayer.poster = poster;
            else videoPlayer.removeAttribute('poster');
            msSetMetadata(videoPlayer, false, title ? cleanTitle(title) : '', 'Wflix', poster);
        }

        // Živý kanál: název kanálu + logo, posuvník podle okna, které kanál nabízí.
        function setNowPlayingLive(ch) {
            msSetMetadata(liveVideo, true, ch.name || '', 'Živě', ch.logo || '');
        }

        // Zdroj aktuálního přehrávání (CDN vs server) - malý štítek u tlačítek přehrávače.
        function setPlayerSource(mode) {
            if (!srcMode) return;
            if (!player.page) { srcMode.hidden = true; return; }
            const relay = mode === 'relay';
            srcMode.hidden = false;
            srcMode.textContent = relay ? 'Zdroj: server' : 'Zdroj: CDN';
            srcMode.classList.toggle('relay', relay);
            srcMode.title = relay
                ? 'Přímé přehrávání z CDN selhalo, takže video jde přes server. Proto může být pomalejší.'
                : 'Video hraje přímo z CDN zdroje (nejrychlejší cesta).';
        }

        // Záložka u přehrávače - stejná položka jako na kartách, jen pro právě hraný titul.
        function updateFavBtn() {
            if (!favBtn) return;
            if (!player.page) {
                favBtn.hidden = true;
                if (pipBtn) pipBtn.hidden = true;   // PiP nemá smysl bez videa
                return;
            }
            const on = isFav(player.page);
            favBtn.hidden = false;
            if (pipBtn && pipSupported) pipBtn.hidden = false;
            favBtn.textContent = on ? '★ V oblíbených' : '☆ Do oblíbených';
            favBtn.classList.toggle('on', on);
            favBtn.title = on ? 'Odebrat z oblíbených' : 'Přidat do oblíbených';
        }
        if (favBtn) favBtn.addEventListener('click', () => {
            if (!player.page) return;
            toggleFavorite({ url: player.page, title: player.title, poster: player.poster });
        });

        // ===== Konec videa: co dál =====
        function showPlayerEnd() {
            playerEndTitle.textContent = player.title && player.title !== 'video' ? player.title : 'Dohráno';
            playerEnd.hidden = false;
            msSetState('paused');
        }
        function hidePlayerEnd() { playerEnd.hidden = true; }

        async function replayVideo() {
            hidePlayerEnd();
            if (!player.page) { goHome(); return; }
            player.lastTime = 0; player.resumeAt = 0; player.fixes = 0;
            try {
                videoPlayer.currentTime = 0;
                await videoPlayer.play();
            } catch (e) {
                recoverPlayback('replay'); // odkaz na CDN mezitím vypršel -> čerstvý, od začátku
            }
        }

        function searchAnother() {
            stopVideo();
            showSection(currentResults.length > 0 ? 'results' : 'placeholder');
            window.scrollTo({ top: 0, behavior: 'smooth' });
            searchInput.focus();
            searchInput.select(); // starý dotaz rovnou přepíšeš novým
        }

        document.getElementById('endReplayBtn').addEventListener('click', replayVideo);
        document.getElementById('endHomeBtn').addEventListener('click', goHome);
        document.getElementById('endSearchBtn').addEventListener('click', searchAnother);

        // ===== Obrázek v obraze (Picture-in-Picture) =====
        // <video> je obyčejný HTML5 prvek, takže stačí requestPictureInPicture(). Tlačítko se
        // ukáže, jen když to prohlížeč umí (Chrome/Edge; Safari má vlastní PiP v ovládání videa).
        // Tlačítko se ukáže až ve chvíli, kdy je v přehrávači video (viz updateFavBtn).
        if (pipBtn) pipBtn.addEventListener('click', async () => {
            try {
                if (document.pictureInPictureElement) await document.exitPictureInPicture();
                else await videoPlayer.requestPictureInPicture();
            } catch (err) {
                notice('Obrázek v obraze se nepodařilo zapnout.', 'error', 4000);
            }
        });
        videoPlayer.addEventListener('enterpictureinpicture', () => { pipBtn.textContent = '⧉ Zavřít PiP'; });
        videoPlayer.addEventListener('leavepictureinpicture', () => { pipBtn.textContent = '⧉ PiP'; });

        // Pozice se uloží hned i při zavření tabu / přepnutí appky, ne až při pauze.
        window.addEventListener('pagehide', () => historySave(true));
        document.addEventListener('visibilitychange', () => { if (document.hidden) historySave(true); });

        // ===== Klávesové zkratky přehrávače =====
        // Jen když je otevřený přehrávač a fokus není ve formulářovém prvku - jinak by
        // mezerník a šipky kradly psaní do hledání i Enter na tlačítkách.
        const playerKeysActive = () => playerSection.style.display === 'block' && !!player.page;

        function seekBy(delta) {
            if (!isFinite(videoPlayer.duration) || videoPlayer.duration <= 0) return;
            const t = Math.min(videoPlayer.duration - 1, Math.max(0, videoPlayer.currentTime + delta));
            videoPlayer.currentTime = t;
            notice((delta > 0 ? '⏩ ' : '⏪ ') + fmtClock(t), 'success', 1500);
        }

        function volumeBy(delta) {
            const v = Math.min(1, Math.max(0, videoPlayer.volume + delta));
            videoPlayer.volume = v;
            videoPlayer.muted = v === 0;
            notice('🔊 Hlasitost ' + Math.round(v * 100) + ' %', 'success', 1500);
        }

        function toggleFullscreen() {
            const fsEl = document.fullscreenElement || document.webkitFullscreenElement;
            if (fsEl) {
                const exit = document.exitFullscreen || document.webkitExitFullscreen;
                if (exit) exit.call(document);
            } else if (videoPlayer.requestFullscreen) {
                videoPlayer.requestFullscreen().catch(() => {});
            } else if (videoPlayer.webkitEnterFullscreen) {
                videoPlayer.webkitEnterFullscreen();   // iOS Safari
            }
        }

        // Mezerník = přehrát/pauza, šipky = posun a hlasitost, F = celá obrazovka.
        document.addEventListener('keydown', (e) => {
            if (!playerKeysActive() || e.ctrlKey || e.metaKey || e.altKey) return;
            const el = document.activeElement;
            if (el && (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
            if (document.pictureInPictureElement) return;   // v PiP okně patří klávesy jemu
            if (e.key === ' ') {
                // Mezerník na tlačítku má aktivovat to tlačítko, ne přehrávání.
                if (el && (el.tagName === 'BUTTON' || el.tagName === 'A')) return;
                e.preventDefault();
                if (videoPlayer.paused) videoPlayer.play().catch(() => {});
                else videoPlayer.pause();
            } else if (e.key === 'ArrowLeft') {
                e.preventDefault(); seekBy(-10);
            } else if (e.key === 'ArrowRight') {
                e.preventDefault(); seekBy(10);
            } else if (e.key === 'ArrowUp') {
                e.preventDefault(); volumeBy(0.1);
            } else if (e.key === 'ArrowDown') {
                e.preventDefault(); volumeBy(-0.1);
            } else if (e.key === 'f' || e.key === 'F') {
                e.preventDefault(); toggleFullscreen();
            }
        });

        async function playVideoDirectly(prehrajtoUrl, title) {
            showStatus('🔄 Načítám video...', 'loading');
            showSection('player');
            nowPlaying.textContent = safeDecode(title);

            try {
                await loadAndPlay(prehrajtoUrl, nowPlaying.textContent, hideStatus);
            } catch (error) {
                console.error('Play error:', error);
                showStatus(`❌ ${error.message || 'Video se nepodařilo načíst'}`, 'error');
            }
        }

        async function playMovieByUrl(url) {
            const movie = currentResults.find(m => m.url === url);

            if (!movie) {
                showStatus('❌ Video nenalezeno v aktuálních výsledcích', 'error');
                return;
            }

            // Update URL to video page
            const newUrl = `?watch=${encodeURIComponent(movie.url)}&title=${encodeURIComponent(movie.title)}`;
            window.history.pushState({}, '', newUrl);

            showStatus('🔄 Načítám video...', 'loading');

            try {
                await loadAndPlay(movie.url, movie.title, () => {
                    hideStatus();
                    nowPlaying.textContent = movie.title;
                    showSection('player');
                }, movie.thumbnail);
            } catch (error) {
                console.error('Play error:', error);
                showStatus(`❌ ${error.message || 'Video se nepodařilo načíst'}`, 'error');
            }
        }

        // Přehrání z osobní řady: adresa na prehraj.to je uložená, takže se nehledá znovu.
        function playFromLibrary(url) {
            const h = history.find(x => x.url === url);
            const title = h ? h.title : 'Video';
            window.history.pushState({}, '', `?watch=${encodeURIComponent(url)}&title=${encodeURIComponent(title)}`);
            showStatus('🔄 Načítám video...', 'loading');
            showSection('player');
            nowPlaying.textContent = title;
            loadAndPlay(url, title, hideStatus, (h && h.poster) || posterFor(title)).catch(error => {
                console.error('Play error:', error);
                showStatus(`❌ ${error.message || 'Video se nepodařilo načíst'}`, 'error');
            });
        }

        function goBack() {
            stopVideo();
            hideStatus();

            // Go back to search results if we have them
            if (currentResults.length > 0) {
                const query = searchInput.value.trim();
                const newUrl = query ? `?q=${encodeURIComponent(query)}` : window.location.pathname;
                window.history.pushState({}, '', newUrl);
                showSection('results');
            } else {
                window.history.pushState({}, '', window.location.pathname);
                showSection('placeholder');
            }
        }

        // Handle browser back/forward
        window.addEventListener('popstate', () => {
            const params = new URLSearchParams(window.location.search);
            const videoUrl = params.get('watch');
            const title = params.get('title');
            const searchQuery = params.get('q');
            const liveParam = params.get('live');

            // Always stop video first when navigating
            stopVideo();

            if (videoUrl) {
                playVideoDirectly(videoUrl, title || 'Video');
            } else if (liveParam) {
                showSection('live');
                if (!liveChannels.length) loadLive();
            } else if (searchQuery) {
                searchInput.value = searchQuery;
                if (currentResults.length > 0) {
                    showSection('results');
                } else {
                    searchMovies();
                }
            } else {
                hideStatus();
                showSection('placeholder');
            }
        });

        // Stop and cleanup video player
        function stopVideo() {
            if (videoPlayer) {
                historySave(true);   // poslední pozice před odchodem z přehrávače
                player.page = ''; player.cdn = '';
                proxyBtn.hidden = true;
                if (favBtn) favBtn.hidden = true;
                if (pipBtn) pipBtn.hidden = true;
                if (srcMode) srcMode.hidden = true;
                clearSubtitles();
                refreshDl();
                clearTimeout(player.stallTimer); player.stallTimer = null;
                hidePlayerEnd();
                videoPlayer.pause();
                videoPlayer.removeAttribute('src');
                videoPlayer.load(); // Force release of media resources
            }
            msClear(videoPlayer);
        }

        // Klávesnice a TV ovladač: šipky vlevo/vpravo přesouvají fokus po kartách v řadě,
        // Enter/Space kartu otevře (to umí <button> sám). Bez toho se dálkovým ovladačem
        // nedá v řadách pohybovat.
        document.addEventListener('keydown', (e) => {
            if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
            const el = document.activeElement;
            const isLiveCard = el && el.classList.contains('live-card');
            if (!el || (!el.classList.contains('poster') && !isLiveCard)) return;
            const cards = Array.from(el.parentElement.querySelectorAll(isLiveCard ? '.live-card' : '.poster'));
            const next = cards[cards.indexOf(el) + (e.key === 'ArrowRight' ? 1 : -1)];
            if (!next) return;
            e.preventDefault();
            next.focus();
            next.scrollIntoView({ block: 'nearest', inline: 'center' });
        });

        // ===== Netflix-style nav behaviour =====
        const navEl = document.getElementById('nav');
        const searchBox = document.getElementById('searchBox');
        window.addEventListener('scroll', () => navEl.classList.toggle('solid', window.scrollY > 40));
        searchInput.addEventListener('input', () => searchBox.classList.toggle('has-text', searchInput.value.length > 0));
        function setChip(c) { activeChip = c; renderCatalog(); }
        // fill search box state when opening ?q= links
        if (searchInput.value) searchBox.classList.add('has-text');

        // ===== Živé vysílání: události =====
        liveBtn.addEventListener('click', () => openLive());
        liveBackBtn.addEventListener('click', backToLive);
        liveSource.addEventListener('change', () => { liveChannels = []; loadLive(); });

        // ===== Živé vysílání: vlastní výběr zdroje (Doporučené / Ostatní) =====
        // Doporučené jsou napevno, Ostatní se samo dotáhne ze serveru (/api/live/countries) při
        // prvním otevření a doporučené země z něj vynechá. #liveSource je skrytý input s kódem
        // zdroje (cz, sk, ...), takže zbytek stránky s ním pracuje jako dřív.
        const LIVE_RECOMMENDED = [
            { v: 'cz', n: 'Česko' },
            { v: 'sk', n: 'Slovensko' },
            { v: 'us', n: 'USA' },
            { v: 'uk', n: 'Anglie (VB)' },
        ];
        const liveSrc = document.getElementById('liveSrc');
        const liveSrcBtn = document.getElementById('liveSrcBtn');
        const liveSrcLabel = document.getElementById('liveSrcLabel');
        const liveSrcSearch = document.getElementById('liveSrcSearch');
        const liveSrcList = document.getElementById('liveSrcList');
        let liveOthers = [];
        let liveOthersState = 'idle'; // idle | loading | ready | error

        function liveNorm(s) {
            return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        }

        function liveSourceName(v) {
            const all = LIVE_RECOMMENDED.concat(liveOthers);
            const hit = all.find(x => x.v === v);
            return hit ? hit.n : String(v).toUpperCase();
        }

        function updateLiveSrcLabel() {
            liveSrcLabel.textContent = liveSourceName(liveSource.value);
        }

        function renderLiveSrc() {
            const q = liveNorm(liveSrcSearch.value.trim());
            const cur = liveSource.value;
            const match = it => !q || liveNorm(it.n).includes(q) || (it.en && liveNorm(it.en).includes(q)) || it.v === q;
            const item = it => `<button type="button" class="lsrc-item${it.v === cur ? ' active' : ''}" role="option" aria-selected="${it.v === cur}" data-v="${escapeHtml(it.v)}">${escapeHtml(it.n)}</button>`;
            let html = '';
            const rec = LIVE_RECOMMENDED.filter(match);
            if (rec.length) html += '<div class="lsrc-group">Doporučené</div>' + rec.map(item).join('');
            html += '<div class="lsrc-group">Ostatní</div>';
            if (liveOthersState === 'loading') {
                html += '<div class="lsrc-note">Načítám seznam zemí…</div>';
            } else if (liveOthersState === 'error') {
                html += '<button type="button" class="lsrc-item" data-retry="1">Seznam se nepodařilo načíst – zkusit znovu</button>';
            } else if (liveOthersState === 'ready') {
                const oth = liveOthers.filter(match);
                html += oth.length ? oth.map(item).join('') : '<div class="lsrc-note">Nic nenalezeno</div>';
            }
            liveSrcList.innerHTML = html;
        }

        async function loadLiveOthers() {
            if (liveOthersState === 'loading' || liveOthersState === 'ready') return;
            liveOthersState = 'loading';
            renderLiveSrc();
            try {
                const r = await fetch('/api/live/countries');
                const d = await r.json();
                if (!d.success || !Array.isArray(d.countries)) throw new Error(d.error || 'Seznam zemí se nepodařilo načíst');
                const skip = new Set(LIVE_RECOMMENDED.map(x => x.v));
                let names = null;
                try { names = new Intl.DisplayNames(['cs'], { type: 'region' }); } catch (e) { /* starší prohlížeč */ }
                liveOthers = d.countries
                    .filter(c => c && c.code && !skip.has(String(c.code).toLowerCase()))
                    .map(c => {
                        const code = String(c.code).toUpperCase();
                        let n = c.name || code;
                        try {
                            const cs = names && names.of(code);
                            if (cs && cs !== code) n = cs;
                        } catch (e) { /* neplatný kód - zůstane anglický název */ }
                        return { v: code.toLowerCase(), n, en: c.name || '' };
                    })
                    .sort((a, b) => a.n.localeCompare(b.n, 'cs'));
                liveOthersState = 'ready';
            } catch (e) {
                liveOthers = [];
                liveOthersState = 'error';
            }
            renderLiveSrc();
            updateLiveSrcLabel();
        }

        function toggleLiveSrc(open) {
            const willOpen = open === undefined ? !liveSrc.classList.contains('open') : open;
            liveSrc.classList.toggle('open', willOpen);
            liveSrcBtn.setAttribute('aria-expanded', String(willOpen));
            if (!willOpen) return;
            liveSrcSearch.value = '';
            renderLiveSrc();
            loadLiveOthers();
            if (window.matchMedia('(hover: hover)').matches) liveSrcSearch.focus();
        }

        function setLiveSource(v) {
            toggleLiveSrc(false);
            if (!v || v === liveSource.value) return;
            liveSource.value = v;
            updateLiveSrcLabel();
            liveSource.dispatchEvent(new Event('change'));
        }

        liveSrcBtn.addEventListener('click', () => toggleLiveSrc());
        liveSrcSearch.addEventListener('input', renderLiveSrc);
        liveSrcList.addEventListener('click', e => {
            if (e.target.closest('[data-retry]')) {
                liveOthersState = 'idle';
                loadLiveOthers();
                return;
            }
            const it = e.target.closest('[data-v]');
            if (it) setLiveSource(it.dataset.v);
        });
        document.addEventListener('click', e => {
            if (liveSrc.classList.contains('open') && !liveSrc.contains(e.target)) toggleLiveSrc(false);
        });
        document.addEventListener('keydown', e => {
            if (e.key === 'Escape' && liveSrc.classList.contains('open')) {
                toggleLiveSrc(false);
                liveSrcBtn.focus();
            }
        });
        liveFilter.addEventListener('input', () => { if (liveChannels.length) renderLive(true); });
        document.getElementById('liveTags').addEventListener('click', e => {
            const chip = e.target.closest('[data-flag]');
            if (!chip) return;
            const flag = chip.dataset.flag;
            if (flag === 'all') {
                liveFlags.hd = liveFlags.noGeo = liveFlags.only24 = false;
            } else {
                liveFlags[flag] = !liveFlags[flag];
            }
            document.querySelectorAll('#liveTags .lchip').forEach(c => {
                const f = c.dataset.flag;
                c.classList.toggle('active', f === 'all'
                    ? (!liveFlags.hd && !liveFlags.noGeo && !liveFlags.only24)
                    : !!liveFlags[f]);
            });
            if (liveChannels.length) renderLive(true);
        });
        liveGrid.addEventListener('click', e => {
            if (e.target.closest('#liveMore')) {
                liveShown += LIVE_PAGE;
                renderLive(false);
                return;
            }
            const card = e.target.closest('[data-live]');
            if (!card) return;
            playLive(liveChannels[Number(card.dataset.live)]);
        });

        // ===== Nastavení: samostatná stránka (avatar vpravo nahoře) =====
        // Volby se do rozbalovacího panelu nevešly, takže je Nastavení stránka jako odkazy
        // v patičce - otevírá ji avatar a chová se stejně jako nápověda nebo o projektu.
        function settingsPageHtml() {
            return `
                    <h2>Vzhled</h2>
                    <div class="set-row">
                        <label for="themeToggle">Světlý režim</label>
                        <label class="switch"><input type="checkbox" id="themeToggle"><span></span></label>
                    </div>
                    <div class="set-hint">Vypnuto = tmavý režim (výchozí). Přepínač mění jen vzhled a uloží se v prohlížeči.</div>

                    <h2>Přehrávač</h2>
                    <div class="set-row">
                        <label for="directToggle">Přímé přehrávání z CDN</label>
                        <label class="switch"><input type="checkbox" id="directToggle"><span></span></label>
                    </div>
                    <div class="set-hint">Zapnuto (výchozí): video i IPTV jdou přímo ze zdroje. Když přímé přehrávání opakovaně selže, appka pro tohle přehrávání dočasně přejde na server a příště zkusí CDN znovu – server se používá, jen když je opravdu potřeba. Vypnuto: hned přes server.</div>

                    <h2>Titulky</h2>
                    <div class="set-row">
                        <label for="subSizeSelect">Velikost</label>
                        <select class="set-select" id="subSizeSelect">
                            <option value="m">Normální</option>
                            <option value="l">Velké</option>
                            <option value="xl">Extra velké</option>
                        </select>
                    </div>
                    <div class="set-row">
                        <label for="subBgSelect">Pozadí</label>
                        <select class="set-select" id="subBgSelect">
                            <option value="dark">Tmavé</option>
                            <option value="light">Světlé</option>
                            <option value="none">Bez pozadí</option>
                        </select>
                    </div>
                    <div class="set-hint">Týká se titulků u filmů (WebVTT). Změna je vidět hned, stopa se nenačítá znovu.</div>

                    <h2>Úvodní stránka</h2>
                    <div class="set-row">
                        <label for="catLangSelect">Katalog</label>
                        <select class="set-select" id="catLangSelect">
                            <option value="cz">iTunes CZ (výchozí)</option>
                            <option value="en">iTunes EN</option>
                        </select>
                    </div>
                    <div class="set-hint">Odkud se berou filmy na úvodní stránce: žebříček iTunes CZ, nebo anglický iTunes US. Seznam i s plakáty stáhne server a cacheuje na 1 den.</div>

                    <h2>Náhledy</h2>
                    <div class="set-row">
                        <label for="limitToggle">Omezit souběžné dotazy na náhledy</label>
                        <label class="switch"><input type="checkbox" id="limitToggle"><span></span></label>
                    </div>
                    <div class="set-sub" id="limitSub">
                        <label for="limitValue">Max. najednou</label>
                        <input type="number" id="limitValue" min="1" max="20" step="1">
                    </div>
                    <div class="set-hint">Vypnuto (výchozí): náhledy se načítají všechny naráz. Zapni, pokud prehraj.to vrací chybu 429.</div>

                    <h2>Připojení</h2>
                    <div class="set-row">
                        <span>Aktivní proxy server</span>
                        <span class="set-val" id="proxyStatus">–</span>
                    </div>
                    <div class="set-hint">Když server neodpovídá, appka sama přepne na další. První dotaz po přepnutí může být pomalejší, protože se čeká na timeout mrtvého serveru.</div>

                    <h2>Data v prohlížeči</h2>
                    <p>Nastavení, rozehrané filmy i oblíbené zůstávají jen v tomhle prohlížeči. Co přesně se ukládá a jak to smazat najdeš v <button type="button" class="f-link" onclick="openPage('cookies')" style="color:#fff;text-decoration:underline">Předvolbách cookies</button>.</p>
            `;
        }

        // Napojení ovládacích prvků po každém vykreslení stránky (prvky jsou nové).
        function bindSettings(root) {
            const q = id => root.querySelector('#' + id);

            const themeTog = q('themeToggle');
            if (themeTog) {
                themeTog.checked = settings.theme === 'light';
                themeTog.addEventListener('change', () => {
                    settings.theme = themeTog.checked ? 'light' : 'dark';
                    saveSettings();
                    applyTheme();
                });
            }

            const directTog = q('directToggle');
            if (directTog) {
                directTog.checked = directPreferred();
                directTog.addEventListener('change', () => {
                    settings.direct = directTog.checked;
                    saveSettings();
                    // Vypnutí přímého přehrávání schová ruční nabídku serveru; aktuální
                    // přehrávání se nemění, aby se video zbytečně nepřerušilo.
                    if (!settings.direct) proxyBtn.hidden = true;
                });
            }

            const subSizeSel = q('subSizeSelect');
            if (subSizeSel) {
                subSizeSel.value = CUE_SIZES[settings.subSize] ? settings.subSize : 'm';
                subSizeSel.addEventListener('change', () => {
                    settings.subSize = subSizeSel.value;
                    saveSettings();
                    applyCueStyle();
                });
            }

            const subBgSel = q('subBgSelect');
            if (subBgSel) {
                subBgSel.value = CUE_BACKGROUNDS[settings.subBg] ? settings.subBg : 'dark';
                subBgSel.addEventListener('change', () => {
                    settings.subBg = subBgSel.value;
                    saveSettings();
                    applyCueStyle();
                });
            }

            const catSel = q('catLangSelect');
            if (catSel) {
                catSel.value = settings.catLang === 'en' ? 'en' : 'cz';
                catSel.addEventListener('change', () => {
                    settings.catLang = catSel.value === 'en' ? 'en' : 'cz';
                    saveSettings();
                    loadCatalog();   // jiný žebříček = jiný seznam filmů (server má oba v cache)
                });
            }

            const tog = q('limitToggle');
            const val = q('limitValue');
            const sub = q('limitSub');
            if (tog) {
                tog.checked = !!settings.limitOn;
                if (val) val.value = settings.limit;
                if (sub) sub.classList.toggle('show', tog.checked);
                tog.addEventListener('change', () => {
                    settings.limitOn = tog.checked;
                    if (sub) sub.classList.toggle('show', tog.checked);
                    saveSettings();
                    pumpThumbs();
                });
            }
            if (val) {
                val.addEventListener('change', () => {
                    settings.limit = Math.min(20, Math.max(1, parseInt(val.value, 10) || 3));
                    val.value = settings.limit;
                    saveSettings();
                });
            }

            const proxyEl = q('proxyStatus');
            if (proxyEl) {
                if (activeProxy) {
                    proxyEl.textContent = proxyLabel(activeProxy);
                    proxyEl.title = activeProxy === 'direct' ? 'prehraj.to volá server přímo' : activeProxy;
                } else {
                    proxyEl.textContent = '–';
                    proxyEl.title = 'Zatím žádný požadavek – server se ukáže po prvním hledání.';
                }
            }
        }

        function openSettings() { openPage('settings'); }
        window.openSettings = openSettings;

        // ===== Wflix intro: krátký filmový podpis =====
        // Bez tlačítek a bez interakce: overlay se sám zavře.
        // Zvuk hraje jen tehdy, když ho prohlížeč povolí bez gesta.
        (() => {
            const intro = document.getElementById('intro');
            if (!intro) return;

            const reduceMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
            // Animace intra (intro.css): stetce 0.2-1.0 s, zoom 0.3-3.0 s.
            const duration = reduceMotion ? 1000 : 3000;
            const AudioCtor = window.AudioContext || window.webkitAudioContext;
            const state = { active: true, finishing: false, audioStarted: false };

            const audio = {
                ctx: null,
                master: null,
                sources: [],
                init() {
                    if (this.ctx || !AudioCtor) return;
                    try {
                        this.ctx = new AudioCtor();
                        this.master = this.ctx.createGain();
                        this.master.gain.value = 0.55;
                        this.master.connect(this.ctx.destination);
                    } catch (e) {
                        this.ctx = null;
                        this.master = null;
                    }
                },
                running() { return !!(this.ctx && this.ctx.state === 'running'); },
                stop(fade = 0.4) {
                    if (!this.ctx || !this.master) return;
                    const now = this.ctx.currentTime;
                    try {
                        this.master.gain.cancelScheduledValues(now);
                        this.master.gain.setValueAtTime(Math.max(0.0001, this.master.gain.value), now);
                        this.master.gain.exponentialRampToValueAtTime(0.0001, now + fade);
                    } catch (e) {}
                },
                dispose() {
                    if (!this.ctx) return;
                    const ctx = this.ctx;
                    this.ctx = null;
                    this.master = null;
                    this.sources.length = 0;
                    setTimeout(() => { try { ctx.close(); } catch (e) {} }, 700);
                },
            };

            function tone({ freq, endFreq, type = 'sine', at = 0, dur = 1, gain = 0.15, attack = 0.012, filter = 0 }) {
                if (!audio.running() || !audio.master) return;
                const ctx = audio.ctx;
                const t0 = ctx.currentTime + at;
                const osc = ctx.createOscillator();
                const g = ctx.createGain();
                osc.type = type;
                osc.frequency.setValueAtTime(Math.max(1, freq), t0);
                if (endFreq) osc.frequency.exponentialRampToValueAtTime(Math.max(1, endFreq), t0 + dur);
                g.gain.setValueAtTime(0.0001, t0);
                g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t0 + Math.min(attack, dur * 0.4));
                g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

                let node = osc;
                if (filter) {
                    const f = ctx.createBiquadFilter();
                    f.type = 'lowpass';
                    f.Q.value = 0.8;
                    f.frequency.setValueAtTime(filter, t0);
                    node.connect(f);
                    node = f;
                }
                node.connect(g);
                g.connect(audio.master);
                audio.sources.push(osc);
                try { osc.start(t0); osc.stop(t0 + dur + 0.05); } catch (e) {}
            }

            function noise({ at = 0, dur = 1.0, gain = 0.02, from = 180, to = 1600 } = {}) {
                if (!audio.running() || !audio.master) return;
                const ctx = audio.ctx;
                const t0 = ctx.currentTime + at;
                const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
                const buf = ctx.createBuffer(1, len, ctx.sampleRate);
                const data = buf.getChannelData(0);
                for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
                const src = ctx.createBufferSource();
                src.buffer = buf;
                const f = ctx.createBiquadFilter();
                f.type = 'bandpass';
                f.Q.value = 0.9;
                f.frequency.setValueAtTime(from, t0);
                f.frequency.exponentialRampToValueAtTime(to, t0 + dur);
                const g = ctx.createGain();
                g.gain.setValueAtTime(0.0001, t0);
                g.gain.exponentialRampToValueAtTime(gain, t0 + 0.08);
                g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
                src.connect(f);
                f.connect(g);
                g.connect(audio.master);
                audio.sources.push(src);
                try { src.start(t0); src.stop(t0 + dur + 0.05); } catch (e) {}
            }

            function playScore() {
                if (state.audioStarted || !state.active) return;
                state.audioStarted = true;
                if (reduceMotion) {
                    tone({ freq: 64, endFreq: 32, dur: 0.4, gain: 0.32, filter: 180, at: 0.02 });
                    tone({ freq: 176, endFreq: 96, type: 'triangle', dur: 0.14, gain: 0.05, at: 0.02 });
                    return;
                }
                // čtyři tahy za sebou: 0.2 / 0.75 / 1.3 / 1.85 s (stejné doby jako v intro.css)
                tone({ freq: 58, endFreq: 32, dur: 0.7, gain: 0.3, filter: 160, at: 0.2 });
                tone({ freq: 176, endFreq: 88, type: 'triangle', dur: 0.14, gain: 0.05, at: 0.22 });
                noise({ at: 0.2, dur: 0.5, gain: 0.018, from: 190, to: 1200 });
                noise({ at: 0.75, dur: 0.5, gain: 0.014, from: 240, to: 950 });
                noise({ at: 1.3, dur: 0.5, gain: 0.014, from: 210, to: 1100 });
                noise({ at: 1.85, dur: 0.55, gain: 0.017, from: 230, to: 1300 });
                // lampy naskočí a kamera dojede
                tone({ freq: 92, endFreq: 64, dur: 0.5, gain: 0.12, filter: 300, at: 2.15 });
                tone({ freq: 210, endFreq: 104, type: 'triangle', dur: 0.2, gain: 0.035, at: 2.18 });
                tone({ freq: 138, dur: 0.25, gain: 0.04, at: 2.2 });
            }

            if (AudioCtor) {
                audio.init();
                if (audio.running()) playScore();
            }

            function finish() {
                if (!state.active || state.finishing) return;
                state.finishing = true;
                state.active = false;
                document.body.classList.remove('intro-lock');
                intro.classList.add('is-leaving');
                audio.stop(0.4);
                setTimeout(() => {
                    intro.hidden = true;
                    audio.dispose();
                }, reduceMotion ? 60 : 380);
            }

            // Zavírá se až ve chvíli, kdy je pod overlayem co vidět: čeká na první vykreslení
            // katalogu, ale animace vždy dohraje (min. `duration`) a když katalog nedorazí,
            // overlay se zavře po stropu, aby stránku neblokoval.
            const now = () => ((window.performance && performance.now) ? performance.now() : Date.now());
            const startedAt = now();

            document.body.classList.add('intro-lock');
            whenFirstPaint(() => {
                const held = now() - startedAt;
                if (held >= duration) finish();
                else setTimeout(finish, duration - held);
            });
            setTimeout(finish, duration + 2300);
        })();
