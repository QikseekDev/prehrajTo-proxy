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
        const csfdMeta = document.getElementById('csfdMeta');
        const dlBtn = document.getElementById('dlBtn');
        const proxyBtn = document.getElementById('proxyBtn');
        const subtitleBar = document.getElementById('subtitleBar');
        const subtitleSelect = document.getElementById('subtitleSelect');
        const subNote = document.getElementById('subNote');
        const playerEnd = document.getElementById('playerEnd');
        const playerEndTitle = document.getElementById('playerEndTitle');
        const placeholder = document.getElementById('placeholder');
        const srcMode = document.getElementById('srcMode');
        const favBtn = document.getElementById('favBtn');
        const pipBtn = document.getElementById('pipBtn');
        // PiP umí Chrome/Edge; tlačítko se ukáže až u načteného videa (viz updateFavBtn).
        const pipSupported = !!(document.pictureInPictureEnabled && HTMLVideoElement.prototype.requestPictureInPicture);
        const castBtn = document.getElementById('castBtn');
        // Odeslání na TV: Chrome/Edge (Chromecast) přes Remote Playback API, Safari přes AirPlay.
        const castSupported = !!(('remote' in HTMLMediaElement.prototype) || window.WebKitPlaybackTargetAvailabilityEvent);

        let currentResults = [];
        // Výsledky hledání po seskupení epizod do seriálů (viz "Seriály" níže).
        let searchEntries = [];
        let activeSeries = null;      // otevřený seriál (pro návrat z přehrávače)
        let seriesReturn = false;     // do přehrávače se šlo z epizody seriálu
        let lastQuery = '';
        let searchToken = 0;
        // Dotahování dalších stránek hledání pro otevřený seriál (klíč = series.key):
        // pages = poslední načtená stránka, done = víc už není, busy = právě běží.
        const seriesLoad = new Map();
        const SERIES_MAX_PAGES = 10;
        // Stránkování hledání: první stránka se ověřuje (mrtvé kusy zmizí), další se jen
        // přidají - ověřování je to pomalé a naráží na 429, a videa většinou fungují i bez něj.

        // Záložní katalog - použije se jen když se nepovede stáhnout /api/catalog (iTunes).
        // Filmy pro homepage jinak chodí ze serveru (iTunes RSS, cache na 1 den) včetně plakátů.
        let CATALOG = [
            // q = hledaný výraz, t = zobrazený název
            { t: 'Matrix', q: 'Matrix', y: 1999, g: ['Sci-fi','Akční'] },
            { t: 'Interstellar', q: 'Interstellar', y: 2014, g: ['Sci-fi','Drama'] },
            { t: 'Počátek', q: 'Počátek Inception', y: 2010, g: ['Sci-fi','Thriller'] },
            { t: 'Duna', q: 'Duna 2021', y: 2021, g: ['Sci-fi'] },
            { t: 'Blade Runner 2049', q: 'Blade Runner 2049', y: 2017, g: ['Sci-fi'] },
            { t: 'Temný rytíř', q: 'Temný rytíř', y: 2008, g: ['Akční','Thriller'] },
            { t: 'Gladiátor', q: 'Gladiátor', y: 2000, g: ['Akční','Drama'] },
            { t: 'Top Gun: Maverick', q: 'Top Gun Maverick', y: 2022, g: ['Akční'] },
            { t: 'John Wick', q: 'John Wick', y: 2014, g: ['Akční','Thriller'] },
            { t: 'Mad Max: Fury Road', q: 'Mad Max Fury Road', y: 2015, g: ['Akční','Sci-fi'] },
            { t: 'Vykoupení z věznice Shawshank', q: 'Vykoupení z věznice Shawshank', y: 1994, g: ['Drama'] },
            { t: 'Forrest Gump', q: 'Forrest Gump', y: 1994, g: ['Drama'] },
            { t: 'Pulp Fiction', q: 'Pulp Fiction', y: 1994, g: ['Thriller','Drama'] },
            { t: 'Klub rváčů', q: 'Klub rváčů', y: 1999, g: ['Drama','Thriller'] },
            { t: 'Mlčení jehňátek', q: 'Mlčení jehňátek', y: 1991, g: ['Thriller'] },
            { t: 'Šestý smysl', q: 'Šestý smysl', y: 1999, g: ['Thriller','Drama'] },
            { t: 'Parazit', q: 'Parazit', y: 2019, g: ['Thriller','Drama'] },
            { t: 'Oppenheimer', q: 'Oppenheimer', y: 2023, g: ['Drama'] },
            { t: 'Pán prstenů: Společenstvo Prstenu', q: 'Pán prstenů Společenstvo Prstenu', y: 2001, g: ['Fantasy','Akční'] },
            { t: 'Harry Potter a Kámen mudrců', q: 'Harry Potter a Kámen mudrců', y: 2001, g: ['Fantasy','Rodinné'] },
            { t: 'Piráti z Karibiku: Prokletí Černé perly', q: 'Piráti z Karibiku Prokletí Černé perly', y: 2003, g: ['Fantasy','Akční'] },
            { t: 'Shrek', q: 'Shrek', y: 2001, g: ['Rodinné','Animované'] },
            { t: 'Toy Story', q: 'Toy Story', y: 1995, g: ['Rodinné','Animované'] },
            { t: 'Lví král', q: 'Lví král', y: 1994, g: ['Rodinné','Animované'] },
            { t: 'Hledá se Nemo', q: 'Hledá se Nemo', y: 2003, g: ['Rodinné','Animované'] },
            { t: 'Ledové království', q: 'Ledové království', y: 2013, g: ['Rodinné','Animované'] },
            { t: 'Coco', q: 'Coco', y: 2017, g: ['Rodinné','Animované'] },
            { t: 'Pelíšky', q: 'Pelíšky', y: 1999, g: ['České','Komedie'] },
            { t: 'Kolja', q: 'Kolja', y: 1996, g: ['České','Drama'] },
            { t: 'Samotáři', q: 'Samotáři', y: 2000, g: ['České','Komedie'] },
            { t: 'Vesničko má středisková', q: 'Vesničko má středisková', y: 1985, g: ['České','Komedie'] },
            { t: 'Tmavomodrý svět', q: 'Tmavomodrý svět', y: 2001, g: ['České','Drama'] },
            { t: 'Anděl Páně', q: 'Anděl Páně', y: 2005, g: ['České','Komedie'] },
            { t: 'Prci, prci, prcičky', q: 'American Pie', y: 1999, g: ['Komedie'] },
            { t: 'Pařba ve Vegas', q: 'Hangover Pařba ve Vegas', y: 2009, g: ['Komedie'] },
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
        const CHIPS = ['Vše','Akční','Drama','Thriller','Horror','Fantasy','Rodinné','České','Komedie'];
        let activeChip = 'Vše';
        let heroOffset = 0;


        // ===== Thumbnails: server je hledá přes /api/thumb (regex "q*", cache na serveru) a zapamatujeme =====
        const THUMB_KEY = 'wflix-thumbs-v3';
        // Volitelný limit souběžných dotazů na náhledy (Nastavení, výchozí: vypnuto)
        // Seznam PHP proxy serverů (Nastavení). Nemazat/needitovat ručně mezi markery -
        // udržuje to scripts/change-proxy-servers.sh (spusť ho, ať to nerozjede ve 3 souborech zvlášť).
        // `let`, protože panel umí seznam změnit za běhu - /api/config pošle aktuální
        // podobu a prohlížeč ji převezme bez nového nasazení (soubor v repu je jen výchozí).
        let DEFAULT_PROXY_SERVERS = [
            // PROXY-SERVERS:BEGIN
            'http://wtzi.borec.cz/index.php',
            'http://wtzi.euweb.cz/index.php',
            'http://wtzi.chytrak.cz/index.php',
            // PROXY-SERVERS:END
        ];
        const SETTINGS_KEY = 'wflix-settings';
        // Knihovna diváka (jen v tomhle prohlížeči): oblíbené.
        const FAVS_KEY = 'wflix-favs';
        let settings = { catLang: 'cz', limitOn: false, limit: 3, direct: true, theme: 'dark', subSize: 'm', subBg: 'dark', searchMerge: false };
        try { Object.assign(settings, JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}')); } catch (e) {}
        // Starší verze ukládaly volby, které už v panelu nejsou (vypnuté náhledy, zdroj
        // náhledů, proxy). Zahodit, ať se v localStorage nevrátí zpátky do oběhu.
        ['thumbsOff', 'thumbSrc', 'proxyOn', 'proxyServers', 'proxyUrl', 'introSound'].forEach(k => delete settings[k]);
        if (typeof settings.searchMerge !== 'boolean') settings.searchMerge = false;
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
        // Stabilní anonymní ID klienta pro přibližný indikátor „kolik lidí je online“.
        const CID_KEY = 'wflix-cid';
        function getClientId() {
            let id = localStorage.getItem(CID_KEY);
            if (!id || id.length < 8) {
                id = (Date.now().toString(36) + Math.random().toString(36).slice(2, 10)).replace(/[^a-z0-9]/gi, '').slice(0, 24);
                try { localStorage.setItem(CID_KEY, id); } catch (e) {}
            }
            return id;
        }
        const CLIENT_ID = getClientId();

        // Proxy servery jsou vždy zapnuté - appka prehraj.to nikdy nevolá přímo. Seznam drží
        // DEFAULT_PROXY_SERVERS (mění ho scripts/change-proxy-servers.sh); backend je zkusí
        // jeden po druhém a vezme první, který odpoví bez chyby.
        const proxyQS = () => DEFAULT_PROXY_SERVERS
            .filter(u => u && u.trim())
            .map(u => '&proxy=' + encodeURIComponent(u.trim()))
            .join('') + '&cid=' + encodeURIComponent(CLIENT_ID);

        let thumbCache = {};
        try { thumbCache = JSON.parse(localStorage.getItem(THUMB_KEY) || '{}'); } catch (e) {}
        const thumbQueue = [];
        const thumbPending = new Map();
        let thumbActive = 0;
        // Než dorazí katalog z iTunes, nemá smysl tahat náhledy pro záložní seznam: každý
        // takový dotaz je hledání na prehraj.to a ta jsou přísně limitovaná (~5 za 10 s).
        // Bez tohohle se při každém studeném startu poslaly desítky hledání jen na plakáty.
        let catalogSettled = false;

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

        // ===== Seriály =====
        // prehraj.to nevede stránku seriálu: každá epizoda je samostatné video a sezónu/díl
        // nese jen název ("Mr. Robot S01E01", "Mr. Robot 1x01", "Mr. Robot 1. série 1. díl").
        // Parser z názvu vytáhne sezónu a díl, zbytek před značkou použije jako název seriálu.
        // Seskupení je heuristika - co se nepodaří rozpoznat, zůstane obyčejnou kartou jako dřív.

        // koncové značky kvality/jazyka, které do názvu seriálu nepatří
        const EP_RELEASE_TAIL = /(?:[\s._-]+(?:cz|sk|en|dabing|titulky|subtitles|tit|sub|1080p|720p|2160p|4k|uhd|full[\s._-]*hd|hdtv|hd|web[\s._-]?dl|webrip|blu[\s._-]?ray|dvdrip|x264|x265|hevc|aac|mkv|mp4|avi))+$/i;

        function stripEpisodeTags(s) {
            let t = String(s || '').replace(/\.[a-z0-9]{2,4}\s*$/i, '');   // přípona souboru
            for (let i = 0; i < 10; i++) {
                const next = t.replace(/[\s._-]+$/, '').replace(EP_RELEASE_TAIL, '').trim();
                if (next === t) break;
                t = next;
            }
            return t.trim();
        }

        // název seriálu = text před značkou epizody, bez roku a koncových značek
        function cleanSeriesBase(s) {
            let b = stripEpisodeTags(s);
            b = b.replace(/\s*[\(\[]\s*(?:19|20)\d{2}\s*(?:[-–]\s*(?:19|20)\d{2})?\s*[\)\]]\s*$/, '');
            const noYear = b.replace(/[\s._-]+(?:19|20)\d{2}\s*$/, '');
            if (noYear.trim().length >= 2 && /[a-zá-ž]/i.test(noYear)) b = noYear;
            return b.replace(/^[\s._\-–—:]+|[\s._\-–—:]+$/g, '').trim();
        }

        // Název pro řádek epizody: bez značky SxxExx, bez přípony souboru a bez názvu seriálu
        // na začátku (ten je v nadpisu stránky). Značky kvality zůstávají - podle nich se
        // poznají varianty téhož dílu.
        function cleanEpisodeName(s, base) {
            let n = String(s || '').replace(/\.[a-z0-9]{2,4}\s*$/i, '').replace(/\s+/g, ' ').trim();
            n = n.replace(/^[\s._\-–—:]+|[\s._\-–—:]+$/g, '').trim();
            if (base && n.toLowerCase().startsWith(base.toLowerCase())) {
                const rest = n.slice(base.length).replace(/^[\s._\-–—:]+/, '').trim();
                if (rest) n = rest;
            }
            return n || base || '';
        }

        // Pořadí je důležité: nejdřív nejspolehlivější tvary, pak české slovní a nakonec
        // samotné číslo dílu (to nezná sezónu, proto season = null).
        const EP_PATTERNS = [
            // S01E01, S01E01-E02, S01E01E02, S1 E1
            { kind: 'sxxexx', re: /(^|[^0-9a-z])s\s*(\d{1,2})\s*[._ -]?\s*e\s*(\d{1,3})(?:\s*[-–—]\s*(?:e\s*)?(\d{1,3})|\s*e\s*(\d{1,3}))?(?![0-9])/i },
            // 1x01, 01x01
            { kind: 'nxnn', re: /(^|[^0-9])(\d{1,2})\s*[x×]\s*(\d{1,3})(?![0-9])/i },
            // 1. série 2. díl / 2. série - 1. díl / Season 1 Episode 2
            { kind: 'worded', re: /(^|[^0-9])(\d{1,2})\s*\.?\s*(?:série|serie|sezóna|sezona|season)\b[^\d]{0,20}?(\d{1,4})\s*\.?\s*(?:díl|diel|epizoda|epizóda|episode|ep\.?|část|časť)\b/i },
            // Season 2 Episode 4 / Série 2 - díl 4 (slovo sezóny je před číslem)
            { kind: 'worded2', re: /(^|[^0-9a-z])(?:série|serie|sezóna|sezona|season)\s*(\d{1,2})\b[\s,;:._-]*(?:díl|diel|epizoda|epizóda|episode|ep\.?|část|časť)\s*(\d{1,4})\b/i },
            // Epizoda 1/8, 3. díl, Episode 5, Ep 12, E01 - bez sezóny
            { kind: 'episode', re: /(^|[^0-9a-z])(?:epizoda|epizóda|díl|diel|episode|ep\.?|e)\s*\.?\s*(\d{1,3})(?:\s*\/\s*\d{1,3})?(?![0-9])/i },
            { kind: 'episode', re: /(^|[^0-9])(\d{1,3})\s*\.\s*(?:díl|diel|epizoda|epizóda|část|časť)(?![a-z])/i },
        ];

        function parseEpisodeTitle(title) {
            const s = String(title || '');
            for (const p of EP_PATTERNS) {
                const m = p.re.exec(s);
                if (!m) continue;

                let season = null;
                let episodes = [];
                if (p.kind === 'sxxexx' || p.kind === 'nxnn' || p.kind === 'worded' || p.kind === 'worded2') {
                    season = Number(m[2]);
                    episodes = [Number(m[3])];
                } else {
                    episodes = [Number(m[2])];
                }
                if (!episodes.length || episodes.some(n => !Number.isFinite(n))) continue;

                const baseStart = m.index + (m[1] ? m[1].length : 0);
                const markerEnd = m.index + m[0].length;
                const base = cleanSeriesBase(s.slice(0, baseStart));
                // bez použitelného názvu seriálu (např. značka na začátku) to nemá cenu
                if (base.length < 2 || !/[a-zá-ž]/i.test(base)) continue;
                // Popisek končí číslem dílu: "S01E04-09" je prostě díl 4, "-09" není
                // rozsah ani jiný díl. Padding z názvu zůstává ("S01E04"), nic se nedopočítává.
                const marker = s.slice(baseStart, markerEnd).replace(/\s+/g, '');
                const label = (p.kind === 'sxxexx') ? `S${m[2]}E${m[3]}`.toUpperCase()
                    : (p.kind === 'nxnn') ? marker
                    : (p.kind === 'worded' || p.kind === 'worded2') ? `S${season}E${episodes[0]}`
                    : `Díl ${episodes[0]}`;
                const name = cleanEpisodeName(s.slice(0, baseStart) + ' ' + s.slice(markerEnd), base);
                return { base, season, episodes, label, name };
            }
            return null;
        }

        const seriesKeyOf = base => tokens(base).join(' ');

        function czCount(n, one, few, many) {
            n = Number(n) || 0;
            return n + ' ' + (n === 1 ? one : (n >= 2 && n <= 4 ? few : many));
        }

        // Z plochých výsledků udělá karty: film zůstane kartou, epizody stejného seriálu
        // se slijí do jedné karty. URL se dedupují, různé uploady téhož dílu jsou varianty.
        function groupSearchResults(movies) {
            const byKey = new Map();
            const entries = [];

            movies.forEach(movie => {
                const parsed = parseEpisodeTitle(movie.title);
                const key = parsed ? seriesKeyOf(parsed.base) : '';
                if (!key) { entries.push({ type: 'movie', movie }); return; }

                let series = byKey.get(key);
                if (!series) {
                    series = { key, title: parsed.base, year: '', poster: '', raw: [] };
                    byKey.set(key, series);
                    entries.push({ type: 'series', series });
                }
                series.raw.push({ movie, parsed });
                if (!series.poster && movie.thumbnail) series.poster = movie.thumbnail;
                if (!series.year && movie.year) series.year = movie.year;
            });

            // jediná epizoda nemá smysl seskupovat - zůstane normální kartou
            const extras = [];
            const flat = entries.flatMap(e => {
                if (e.type !== 'series') return [e];
                const series = finalizeSeries(e.series);
                if (series.episodeCount >= 2) {
                    if (series.extras && series.extras.length) extras.push(...series.extras);
                    return [{ type: 'series', series }];
                }
                return e.series.raw.map(r => ({ type: 'movie', movie: r.movie }));
            });
            const result = groupCollections(flat);
            extras.forEach(m => result.push({ type: 'movie', movie: m }));
            return result;
        }


        // Výběr nejlepší varianty (v celém skriptu je později plná verze se skóre kvality;
        // tento fallback slouží i pro izolované testy parsování).
        function bestVariant(ep) {
            if (ep.variants.length === 1) return ep.variants[0];
            if (typeof variantScore === 'function') {
                let best = ep.variants[0];
                ep.variants.forEach(v => { if (variantScore(v) > variantScore(best)) best = v; });
                return best;
            }
            return ep.variants[0];
        }

        function finalizeSeries(raw) {
            const seasons = new Map();   // klíč sezóny -> Map(číslo dílu -> epizoda)
            raw.raw.forEach(({ movie, parsed }) => {
                parsed.episodes.forEach(epNum => {
                    const sKey = parsed.season == null ? '?' : String(parsed.season);
                    let eps = seasons.get(sKey);
                    if (!eps) { eps = new Map(); seasons.set(sKey, eps); }
                    // řádek = jedno číslo dílu; jiný upload téhož dílu je jen varianta
                    const epKey = 'e' + epNum;
                    let ep = eps.get(epKey);
                    if (!ep) {
                        ep = { season: parsed.season, episode: epNum, label: parsed.label, variants: [], urls: new Set(), titles: new Set() };
                        eps.set(epKey, ep);
                    }
                    // stejný soubor nebo přesně stejný název podruhé = duplikát, ne varianta
                    const titleKey = seriesKeyOf(movie.title);
                    if (ep.urls.has(movie.url) || (titleKey && ep.titles.has(titleKey))) return;
                    ep.urls.add(movie.url);
                    if (titleKey) ep.titles.add(titleKey);
                    ep.variants.push({ ...movie, name: parsed.name });
                });
            });

            const seasonList = [...seasons.entries()].map(([key, eps]) => ({
                key,
                season: key === '?' ? null : Number(key),
                episodes: [...eps.values()].sort((a, b) => a.episode - b.episode),
            })).sort((a, b) => {
                if (a.season == null) return b.season == null ? 0 : 1;
                if (b.season == null) return -1;
                return a.season - b.season;
            });

            // V každém dílu nech jen nejlepší variantu; ostatní varianty vrať jako samostatné
            // výsledky hledání (nezahazovat je).
            const extras = [];
            seasonList.forEach(season => {
                season.episodes.forEach(ep => {
                    if (ep.variants.length > 1) {
                        const best = bestVariant(ep);
                        ep.variants.forEach(v => { if (v !== best) extras.push(v); });
                        ep.variants = [best];
                    }
                });
            });

            const episodeCount = seasonList.reduce((n, s) => n + s.episodes.length, 0);
            return {
                ...raw,
                seasons: seasonList,
                episodeCount,
                seasonCount: seasonList.filter(s => s.season != null).length,
                extras,
            };
        }

        // ===== Série bez číslování dílů (franšízy) =====
        // U franšíz prehraj.to číslo dílu nemá: "Spider-Man: Brand New Day" je jen název,
        // žádné SxxExx. Když víc výsledků začíná stejným názvem, slijeme je do jedné série
        // (kolekce) - otevře se stejně jako seriál a jde z ní přehrát.
        const COLLECTION_STOP = new Set([
            'a','i','k','o','s','u','v','z','ve','ze','do','na','po','pro','se','si','za','je',
            'the','an','and','of','to','in','on','for','la','le','el','de','der','die','das',
        ]);
        // Za těmito značkami název končí - uploader za ně přidává vlastní zkratky
        // ("Spiderman 2004 UHD CZ ned"), které by jinak z každého uploadu udělaly jiný film.
        const COLLECTION_CUT = /(?:^|[\s._,\-(])(?:cz|sk|en|český|česky|cesky|dabing|dab|titulky|subtitles|tit|sub|1080p|720p|2160p|480p|4k|uhd|full|fhd|hd|hdtv|web|webdl|webrip|bluray|brrip|dvdrip|dvd|x264|x265|h264|h265|hevc|aac|ac3|mkv|mp4|avi|topkvalita|kvalita|serial|seriál)(?=$|[\s._\-,;:)\]])/i;

        // Název bez ozdob, přípony, roku a všeho za první značkou kvality/jazyka.
        function collectionCore(title) {
            let t = String(title || '')
                .replace(/_+/g, ' ')
                .replace(/\s+/g, ' ')
                .replace(/^[-–—.\s#~+*:;|/\\]+/, '')
                .replace(/\.[a-z0-9]{2,4}$/i, '')
                .replace(/^(?:seri[aá]l|serial)\s+(?=[A-ZÁ-Ž0-9])/i, '')   // "Seriál Hospoda ..." = Hospoda
                .trim();
            const cut = t.search(COLLECTION_CUT);
            if (cut > 0) t = t.slice(0, cut);
            // Rok u prostřed názvu: za ním už jsou jen značky uploadera ("Matrix 1999 ned").
            const year = /(?:^|[\s._\-–—(\[])(?:19[5-9]\d|20[0-2]\d)(?=$|[\s._\-–—(\[)\].,;:])/.exec(t);
            if (year && year.index > 0) t = t.slice(0, year.index);
            return t.replace(/[,\s._-]+$/, '')
                .replace(/\s*[\(\[]\s*(?:19|20)\d{2}\s*[\)\]]\s*$/, '')
                .replace(/(?:^|[\s._-])(?:19|20)\d{2}$/, '')
                .replace(/[,\s._-]+$/, '')
                .trim();
        }

        // nejdelší společný začátek názvů (po slovech)
        function commonWordPrefix(lists) {
            const min = Math.min(...lists.map(l => l.length));
            let take = 0;
            for (let i = 0; i < min; i++) {
                const w = lists[0][i];
                if (lists.every(l => l[i] === w)) take = i + 1; else break;
            }
            return take;
        }

        // Skupiny výsledků, které začínají stejným názvem a nejsou to díly seriálu.
        function collectionGroups(items) {
            const buckets = new Map();
            items.forEach(item => {
                const first = item.words[0];
                if (!buckets.has(first)) buckets.set(first, []);
                buckets.get(first).push(item);
            });

            const groups = [];
            buckets.forEach((list, first) => {
                if (COLLECTION_STOP.has(first) || first.length < 3) return;
                const keys = [...new Set(list.map(it => it.key))];
                if (keys.length < 2) return;                 // samé uploady jednoho filmu
                const take = commonWordPrefix(list.map(it => it.words));
                if (!take) return;
                const baseTokens = list[0].words.slice(0, take);
                // Jedno slovo jako název série jen když existuje i holý název ("Spiderman")
                // nebo je dost dlouhé - ať se neslijí filmy se stejnou předložkou na začátku.
                if (take === 1 && !keys.includes(baseTokens[0]) && first.length < 6) return;
                const bare = list.find(it => it.key === baseTokens.join(' ')) || list[0];
                const base = bare.core.split(/\s+/).slice(0, take).join(' ');
                groups.push({ base, baseTokens, items: list, order: Math.min(...list.map(it => it.index)) });
            });
            return groups.sort((a, b) => a.order - b.order);
        }

        // Řádky kolekce: jeden název = jeden film, ostatní uploady téhož názvu jsou varianty.
        function collectionRows(items, baseTokens) {
            const rows = new Map();
            items.forEach(item => {
                const movie = item.movie;
                let row = rows.get(item.key);
                if (!row) {
                    row = { key: item.key, core: item.core, year: '', variants: [], urls: new Set(), titles: new Set() };
                    rows.set(item.key, row);
                }
                const titleKey = seriesKeyOf(movie.title);
                if (row.urls.has(movie.url) || (titleKey && row.titles.has(titleKey))) return;
                row.urls.add(movie.url);
                if (titleKey) row.titles.add(titleKey);
                if (!row.year && movie.year) row.year = movie.year;
                row.variants.push(movie);
            });

            return [...rows.values()].map(row => {
                const rest = row.core.split(/\s+/).slice(baseTokens.length).join(' ')
                    .replace(/^[\s._\-–—:,]+|[\s._\-–—:,]+$/g, '').trim();
                // "Bylo nás pět 2 Andělíček policajt" = číslo a za ním název dílu
                const num = /^(\d{1,3})(?:[.)\]]|,|\s)+\s*(\S.*)$/.exec(rest);
                const named = num && !/^[\(\[]/.test(num[2].trim());
                // "žena za pultem 2" = díl 2 i když za číslem nic není
                const sole = /^\d{1,3}$/.test(rest);
                return {
                    row,
                    rest: rest || row.core,
                    episode: named ? Number(num[1]) : (sole ? Number(rest) : null),
                    name: named ? num[2].trim() : '',
                };
            });
        }

        function buildCollection(base, baseTokens, key, items) {
            const rows = collectionRows(items, baseTokens);

            // Číslování bereme jako díly jen když je v názvech opravdu celé (seriál).
            // U franšíz ("Matrix 2 Reloaded") zůstává číslo součástí názvu filmu.
            const numbered = rows.filter(r => r.episode != null).length;
            const episodic = numbered >= 2 && numbered === rows.length;
            rows.forEach(r => { if (!episodic) r.episode = null; });

            rows.sort((a, b) => {
                if ((a.episode == null) !== (b.episode == null)) return a.episode == null ? 1 : -1;
                if (a.episode != null && a.episode !== b.episode) return a.episode - b.episode;
                const ay = Number(a.row.year) || 9999, by = Number(b.row.year) || 9999;
                if (ay !== by) return ay - by;
                return a.row.key < b.row.key ? -1 : (a.row.key > b.row.key ? 1 : 0);
            });

            const episodes = rows.map((r, i) => {
                const num = r.episode != null ? `Díl ${r.episode}` : (r.row.year || '');
                const name = r.episode != null ? (r.name || r.row.core) : r.row.core;
                return {
                    season: null,
                    episode: r.episode != null ? r.episode : i + 1,
                    num,
                    label: num,
                    variants: r.row.variants.map(movie => ({ ...movie, name })),
                };
            });

            // V každém filmu/dílu nech jen nejlepší variantu; ostatní vrať jako samostatné
            // výsledky hledání (nezahazovat je).
            const extras = [];
            episodes.forEach(ep => {
                if (ep.variants.length > 1) {
                    const best = bestVariant(ep);
                    ep.variants.forEach(v => { if (v !== best) extras.push(v); });
                    ep.variants = [best];
                }
            });

            const years = rows.map(r => Number(r.row.year)).filter(y => y > 1900).sort((a, b) => a - b);
            const withThumb = items.find(it => it.movie.thumbnail);
            return {
                key,
                kind: 'collection',
                unit: episodic ? 'dil' : 'film',
                title: base,
                baseTokens,
                year: years.length > 1 ? `${years[0]}–${years[years.length - 1]}` : (years.length ? String(years[0]) : ''),
                poster: withThumb ? (withThumb.movie.thumbnail || '') : '',
                raw: items.map(it => ({ movie: it.movie, parsed: null })),
                seasons: [{ key: '?', season: null, episodes }],
                episodeCount: episodes.length,
                seasonCount: 0,
                extras,
            };
        }

        function groupCollections(entries) {
            const items = [];
            entries.forEach((e, index) => {
                if (e.type !== 'movie') return;
                if (parseEpisodeTitle(e.movie.title)) return;      // díl seriálu, ne franšíza
                const core = collectionCore(e.movie.title);
                const words = tokens(core);
                if (!words.length) return;
                items.push({ index, movie: e.movie, core, words, key: words.join(' ') });
            });
            if (items.length < 2) return entries;

            const groups = collectionGroups(items);
            if (!groups.length) return entries;

            const at = new Map();
            const drop = new Set();
            const extras = [];
            groups.forEach(g => {
                const first = Math.min(...g.items.map(it => it.index));
                const series = buildCollection(g.base, g.baseTokens, 'c:' + g.baseTokens.join(' '), g.items);
                if (series.extras && series.extras.length) extras.push(...series.extras);
                at.set(first, { type: 'series', series });
                g.items.forEach(it => { if (it.index !== first) drop.add(it.index); });
            });
            const result = entries.flatMap((e, i) => drop.has(i) ? [] : [at.get(i) || e]);
            extras.forEach(m => result.push({ type: 'movie', movie: m }));
            return result;
        }

        // Patří film do otevřené série? U kolekce rozhoduje stejný začátek názvu.
        function seriesAccepts(series, movie) {
            if (series.kind === 'collection') {
                if (parseEpisodeTitle(movie.title)) return false;
                const words = tokens(collectionCore(movie.title));
                return series.baseTokens.every((w, i) => words[i] === w);
            }
            const parsed = parseEpisodeTitle(movie.title);
            return !!parsed && seriesKeyOf(parsed.base) === series.key;
        }

        // Stránka 2+ hledání: připojí jen epizody stejného seriálu, ostatní výsledky ignoruje.
        // Vrací nový finalizovaný seriál a nově přidané filmy (kvůli přehrávání z currentResults).
        function mergeSeriesMovies(series, movies) {
            const known = new Set(series.raw.map(r => r.movie.url));
            const addedMovies = [];
            (movies || []).forEach(movie => {
                if (!movie || !movie.url || known.has(movie.url)) return;
                if (!seriesAccepts(series, movie)) return;
                known.add(movie.url);
                series.raw.push({ movie, parsed: parseEpisodeTitle(movie.title) });
                addedMovies.push(movie);
                if (!series.poster && movie.thumbnail) series.poster = movie.thumbnail;
                if (!series.year && movie.year) series.year = movie.year;
            });
            if (!addedMovies.length) return { added: 0, series, addedMovies };
            if (series.kind === 'collection') {
                const items = series.raw.map(r => {
                    const core = collectionCore(r.movie.title);
                    const words = tokens(core);
                    return { index: 0, movie: r.movie, core, words, key: words.join(' ') };
                }).filter(it => it.key);
                return { added: addedMovies.length, series: buildCollection(series.title, series.baseTokens, series.key, items), addedMovies };
            }
            return { added: addedMovies.length, series: finalizeSeries(series), addedMovies };
        }

        function seriesMeta(series) {
            if (series.kind === 'collection') {
                return series.unit === 'dil'
                    ? czCount(series.episodeCount, 'díl', 'díly', 'dílů')
                    : czCount(series.episodeCount, 'film', 'filmy', 'filmů');
            }
            return [czCount(series.seasonCount, 'série', 'série', 'sérií'),
                    czCount(series.episodeCount, 'díl', 'díly', 'dílů')].join(' · ');
        }

        function saveThumbs() {
            try { localStorage.setItem(THUMB_KEY, JSON.stringify(thumbCache)); } catch (e) {}
        }

        function getThumb(q, cb) {
            // Plakát z iTunes katalogu: rovnou z obrázku, žádný dotaz na server ani na prehraj.to
            const fromCatalog = CATALOG.find(m => m.q === q);
            if (fromCatalog && fromCatalog.img) { cb(fromCatalog.img); return; }
            // Záložní seznam bez plakátů: počkat, až loadCatalog doběhne.
            if (!catalogSettled) return;
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
            if (!catalogSettled) return;
            // Jen karty katalogu - osobní řady mají plakát už v sobě a getThumb by hledal 'undefined'.
            document.querySelectorAll('#catalogRows .poster[data-q]').forEach(el => thumbObserver.observe(el));
        }

        // Jemné ztmavené pozadí odvozené z názvu. Záměrně nízká sytost - syté duhové
        // přechody vypadají genericky a perou se s akcentem i s plakáty.
        function posterGradient(title) {
            let h = 0;
            for (const c of title) h = (h * 31 + c.charCodeAt(0)) % 360;
            return `linear-gradient(155deg, hsl(${h}, 15%, 17%), hsl(${(h + 26) % 360}, 11%, 8%))`;
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

        // Ikony jsou inline SVG: emoji se na každém systému kreslí jinak, nedají se obarvit
        // ani sjednotit tloušťku tahu - v UI proto žádné emoji není.
        const ICON = {
            play: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M8 5.4v13.2L19 12z" fill="currentColor"/></svg>',
            replay: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3M19.5 4.5V9h-4.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
            prev: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M14.5 5.5 8 12l6.5 6.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
            next: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M9.5 5.5 16 12l-6.5 6.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
            chevron: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" width="13" height="13"><path d="M9.5 5.5 16 12l-6.5 6.5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
            star: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 4.7l2.32 4.7 5.18.76-3.75 3.66.89 5.16L12 16.54l-4.64 2.44.89-5.16L4.5 10.16l5.18-.76z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>',
            starOn: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 4.7l2.32 4.7 5.18.76-3.75 3.66.89 5.16L12 16.54l-4.64 2.44.89-5.16L4.5 10.16l5.18-.76z" fill="currentColor" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>',
        };

        // Dvousloupcové iniciály titulu - plakát je čitelný i bez náhledu a bez emoji.
        function monogram(title) {
            const words = String(title || '').trim().split(/\s+/).filter(Boolean);
            if (!words.length) return '?';
            return (words.length > 1 ? words[0][0] + words[1][0] : words[0].slice(0, 2)).toUpperCase();
        }

        // Přepíše jen textový štítek tlačítka, ikona zůstane zachovaná.
        function setBtnText(btn, text) {
            if (!btn) return;
            const label = btn.querySelector('.btn-label');
            if (label) label.textContent = text;
            else btn.textContent = text;
        }

        // Fokus nesmí z otevřeného dialogu utéct na stránku pod ním.
        function trapTab(e, root) {
            if (e.key !== 'Tab' || !root) return;
            const items = Array.from(root.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'))
                .filter(el => el.offsetWidth || el.offsetHeight || el.getClientRects().length);
            if (!items.length) return;
            const first = items[0], last = items[items.length - 1];
            if (e.shiftKey && (document.activeElement === first || !root.contains(document.activeElement))) {
                e.preventDefault(); last.focus();
            } else if (!e.shiftKey && document.activeElement === last) {
                e.preventDefault(); first.focus();
            }
        }

        // ===== Knihovna diváka: oblíbené =====
        // Zůstává jen v prohlížeči (localStorage) - stejně jako Nastavení, žádný účet.
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

        let favorites = readList(FAVS_KEY).filter(x => x.key);

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
        const favKeyOf = it => it && it.url ? it.url : (it && it.q ? 'q:' + it.q : '');
        const isFav = key => !!key && favorites.some(f => f.key === key);

        function favItemFromEl(el) {
            return {
                url: el.dataset.favUrl || '',
                q: el.dataset.favQ || '',
                title: el.dataset.favTitle || '',
                poster: el.dataset.favPoster || '',
                skey: el.dataset.favSkey || '',
                type: el.dataset.favType || '',
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
                              poster: item.poster || '', at: Date.now(),
                              skey: item.skey || '', type: item.type || (item.url ? 'video' : 'series') },
                             ...favorites.filter(f => f.key !== key)].slice(0, 200);
            }
            saveFavorites();
            renderCatalog();
            updateFavBtn();
            syncFavButtons();
            notice(had ? 'Odebráno z oblíbených' : 'Přidáno do oblíbených');
        }

        // Sjednotí vzhled a popisky všech záložek na stránce (karty ve výsledcích se
        // nepřekreslují, tak je potřeba projít zvlášť).
        function syncFavButtons() {
            document.querySelectorAll('[data-fav-key]').forEach(el => {
                const on = isFav(el.dataset.favKey);
                el.classList.toggle('on', on);
                el.innerHTML = on ? ICON.starOn : ICON.star;
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
                data-fav-skey="${escapeHtml(it.skey || '')}" data-fav-type="${escapeHtml(it.type || '')}"
                aria-pressed="${on}" aria-label="${label}" title="${label}">${on ? ICON.starOn : ICON.star}</span>`;
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
                    <img class="thumb${m.img ? ' portrait' : ''}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">
                    <span class="mark" aria-hidden="true">${escapeHtml(monogram(m.t))}</span>
                    <span class="shade"></span>
                    <span class="play">${ICON.play}</span>
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
                    <button class="arrow left" data-scroll="-1" aria-label="Posunout doleva">${ICON.prev}</button>
                    <div class="row-scroll">${cards}</div>
                    <button class="arrow right" data-scroll="1" aria-label="Posunout doprava">${ICON.next}</button>
                </div>
            </section>`;
        }

        function rowHtml(title, items, ranked, chip) {
            return carouselHtml(
                title,
                items.map((m, i) => posterHtml(m, ranked ? i + 1 : 0)).join(''),
                chip ? `<button class="row-more" data-chip="${escapeHtml(chip)}">Prozkoumat vše ${ICON.chevron}</button>` : '');
        }

        function renderHero() {
            const day = Math.floor(Date.now() / 86400000);
            const m = CATALOG[(day + heroOffset) % CATALOG.length];
            document.getElementById('hero').innerHTML = `
                <div class="hero" style="--hero-bg:${posterGradient(m.t)}">
                    <div class="hero-mark" aria-hidden="true">${escapeHtml(monogram(m.t))}</div>
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
                            <button class="btn-play" data-q="${escapeHtml(m.q)}">${ICON.play}Přehrát</button>
                            <button class="btn-info" data-next="1">${ICON.replay}Jiný tip</button>
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

            // Historie a oblíbené mají vlastní stránku (Knihovna v liště), takže úvodní
            // stránka zůstává čistě katalog a hledání.
            let html = '';
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
            syncFavButtons();
        }

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


        // Aktivní položka lišty pro čtečky i pro podtržení (aria-current).
        document.addEventListener('click', (e) => {
            const link = e.target && e.target.closest ? e.target.closest('.nav-links .nav-link') : null;
            if (!link) return;
            document.querySelectorAll('.nav-links .nav-link').forEach(el => {
                if (el === link) el.setAttribute('aria-current', 'page');
                else el.removeAttribute('aria-current');
            });
        }, true);
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
            activeSeries = null;
            seriesReturn = false;
            searchEntries = [];
            seriesLoad.clear();
            lastQuery = '';
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
            let applied = false;
            try {
                const { data: d } = await apiJson('/api/catalog?lang=' + (settings.catLang === 'en' ? 'en' : 'cz'), { retries: 2 });
                if (!d || !d.success || !Array.isArray(d.items) || d.items.length === 0) return;
                CATALOG = d.items.concat(BUILTIN_CATALOG.filter(m => (m.g || []).includes('České')));
                heroOffset = 0;
                renderHero();
                renderCatalog();
                applied = true;
            } catch (e) { /* zůstane záložní katalog */ }
            finally {
                // Teprve teď má smysl pouštět náhledy (viz catalogSettled v getThumb).
                catalogSettled = true;
                if (!applied) renderHero();   // záložní seznam: dotáhnout aspoň billboard
                observeThumbs();
                markFirstPaint();
            }
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
                const showKey = params.get('show');
                searchMovies().then(() => { if (showKey) openSeriesByKey(showKey, false); });
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
            const s = Number(data && data.retryAfter) || h || 20;
            return Math.min(20, Math.max(5, s));
        }

        // fetch + JSON s automatickým opakováním při rate limitu.
        // onWait(secs, pokus, max) se zavolá před čekáním, onRetry() těsně před dalším pokusem.
        function withCid(url) {
            return url && url.indexOf('cid=') === -1 ? url + (url.indexOf('?') === -1 ? '?' : '&') + 'cid=' + encodeURIComponent(CLIENT_ID) : url;
        }
        async function apiJson(url, opts) {
            opts = opts || {};
            const max = opts.retries == null ? 1 : opts.retries;
            for (let attempt = 0; ; attempt++) {
                const response = await fetch(withCid(url));
                let data = null;
                try { data = await response.json(); } catch (e) { data = null; }
                if (!isRateLimited(response.status, data)) return { response, data, rateLimited: false };
                if (attempt >= max) return { response, data, rateLimited: true };
                const secs = retryDelaySeconds(response, data);
                if (opts.onWait) opts.onWait(secs, attempt + 1, max, data);
                await sleep(secs * 1000);
                if (opts.onRetry) opts.onRetry();
            }
        }

        function rateLimitHtml(attempt, max, onlineUsers) {
            const n = Number(onlineUsers);
            const who = (n > 0) ? '<div class="rl-text" style="margin-top:.35rem;opacity:.85">Právě online (přibližně): <b>' + n + '</b></div>' : '';
            return '<div class="rl-body"><div class="rl-title">Server chvilku nestíhá</div>'
                + '<div class="rl-text">prehraj.to omezuje počet dotazů, když jich přijde moc najednou. '
                + 'Za pár vteřin to zkusím znovu automaticky (pokus ' + attempt + ' z ' + max + ').</div>'
                + who
                + '<div class="rl-bar"><i></i></div></div>';
        }

        function runRateLimitBar(root, secs) {
            const bar = root.querySelector('.rl-bar > i');
            if (!bar) return;
            void bar.offsetWidth;
            bar.style.transition = 'width ' + secs + 's linear';
            bar.style.width = '100%';
        }

        function resultsRateLimited(secs, attempt, max, data) {
            resultsState.className = 'results-state show ratelimit';
            resultsState.innerHTML = rateLimitHtml(attempt, max, data && data.onlineUsers);
            resultsInfo.textContent = '';
            runRateLimitBar(resultsState, secs);
        }

        function statusRateLimited(secs, attempt, max, data) {
            status.className = 'status ratelimit';
            status.innerHTML = rateLimitHtml(attempt, max, data && data.onlineUsers);
            runRateLimitBar(status, secs);
        }

        function showStatus(message, type) {
            status.className = 'status ' + type;
            if (type === 'error') {
                status.innerHTML = '<span class="status-text">' + esc(String(message || '')) + '</span>'
                    + '<span class="status-action"><button type="button" class="state-btn" data-open-health>Stav služby</button></span>';
            } else {
                status.textContent = message;
            }
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
                + '<div class="status-action"><button type="button" class="state-btn" onclick="retrySearch()">Zkusit znovu</button>'
                + '<button type="button" class="state-btn" data-open-health>Stav služby</button></div>';
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
                    <p>Klávesnicí: <b>mezerník</b> přehrát/pauza, <b>← →</b> posun o 10 sekund, <b>↑ ↓</b> hlasitost, <b>F</b> celá obrazovka. Tlačítko <b>Obraz v obraze</b> pošle video do malého okna nad ostatními aplikacemi (Chrome a Edge; jinde ho najdeš v ovládání videa). Tlačítko <b>Přehrát na TV</b> otevře možnosti: Chromecast (Chrome, Edge), AirPlay (Safari, iPhone, LG webOS) nebo odkaz, který otevřeš v prohlížeči na jakékoli TV. Video se do TV posílá přes Wi-Fi, Bluetooth na to nestačí.</p>
                    <p>Velikost a pozadí titulků se nastavují v Nastavení (avatar vpravo nahoře).</p>
                    <h2>Knihovna: historie a oblíbené</h2>
                    <p>Odkaz <b>Knihovna</b> v liště ukazuje dvě sekce: <b>Pokračovat ve sledování</b> (rozkoukané filmy a díly, odkud se naváže tam, kde jsi skončil) a <b>Oblíbené</b>. Hvězdička na kartě nebo u přehrávače titul přidá či odebere z oblíbených. Rozkoukaný záznam se sám smaže, když je do konce méně než 2 minuty. Vše se ukládá jen v tvém prohlížeči.</p>
                    <h2>Chyba 429 (Too Many Requests)</h2>
                    <p>Prehraj.to limituje počet dotazů. Když se to objeví, dej appce minutu pauzu a v Nastavení (avatar vpravo nahoře) zapni „Omezit souběžné dotazy na náhledy“ – načítání náhledů je nejčastější příčina.</p>
                    <h2>Proxy servery</h2>
                    <p>Appka nikdy nevolá prehraj.to přímo. Dotazy jdou přes PHP proxy servery, které má v sobě nastavené, a používá se první, která odpoví. Když je jeden mrtvý nebo zaplněný, appka ho přeskočí a zkusí další. Který server zrovna odpovídá appka neukazuje; po přepnutí může být první načtení pomalejší, protože se čeká na timeout mrtvého serveru.</p>
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
                    <p>Žádná videa se na serveru neukládají ani nehostují. Appka jen zprostředkuje požadavek a přehraje to, co je veřejně dostupné. Účty ani profily nevedeme; oblíbené si appka pamatuje jen v tvém prohlížeči.</p>
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
                    <p>Logo a ikony jsou vektorové (inline SVG), žádné cizí assety se nenačítají.</p>
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
                    <p>Jen nastavení, cache náhledů a oblíbené (localStorage) – podrobnosti a tlačítko na smazání najdeš v <button type="button" class="f-link" onclick="openPage('cookies')" style="color:#fff;text-decoration:underline">Předvolbách cookies</button>.</p>
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
                    <p>Wflix nepoužívá cookies pro sledování ani reklamu a nemá žádnou přihlášenou relaci. Místo cookies si do prohlížeče ukládá tři věci přes <code>localStorage</code>:</p>
                    <ul>
                        <li><code>${SETTINGS_KEY}</code> – tvoje nastavení (katalog na úvodní stránce, limit náhledů, přímé přehrávání, světlý režim, styl titulků).</li>
                        <li><code>${THUMB_KEY}</code> – cache náhledů, aby se stejné obrázky nenačítaly pořád dokola.</li>
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
            library: {
                title: 'Knihovna',
                body: libraryPageHtml(),
                onOpen: bindLibrary,
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
            activeSeries = null;
            seriesReturn = false;
            searchEntries = [];
            seriesLoad.clear();
            const token = ++searchToken;
            resultsLoading(`Hledám „${query}" …`);

            try {
                const sources = settings.searchMerge ? MERGE_SOURCES_ALL : MERGE_SOURCES_LINE1;
                await searchMerged(query, sources, token);
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
                    <div class="card-play"><i>${ICON.play}</i></div>
                    <img src="${movie.thumbnail || THUMB_PLACEHOLDER}" alt=""
                         width="640" height="360" loading="lazy" decoding="async"
                         onerror="this.onerror=null;this.src='${THUMB_PLACEHOLDER}'">
                    ${favBtnHtml({ url: movie.url, title: movie.title, poster: movie.thumbnail || '' })}
                    <div class="info">
                        <div class="title">${movie.title}</div>
                        ${movie.year ? `<div class="year">${movie.year}</div>` : ''}
                    </div>
                `;
            return card;
        }

        // ===== Seriály: karta a stránka seriálu =====
        // Zástupný plakát: tmavý rámeček s obrysem kamery, žádné emoji ani externí soubor.
        const THUMB_PLACEHOLDER = 'data:image/svg+xml,' + encodeURIComponent(
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 90"><rect width="160" height="90" fill="#1a1a1c"/>' +
            '<g fill="none" stroke="#4a4a4e" stroke-width="2.6" stroke-linejoin="round"><rect x="57" y="31" width="46" height="28" rx="4"/>' +
            '<path d="M57 41h46M57 49h46M68 31v28M92 31v28"/></g></svg>');

        function seriesUrl(key) {
            const p = new URLSearchParams();
            if (lastQuery) p.set('q', lastQuery);
            p.set('show', key);
            return window.location.pathname + '?' + p.toString();
        }

        function findSeries(key) {
            const e = searchEntries.find(x => x.type === 'series' && x.series.key === key);
            return e ? e.series : null;
        }

        function createSeriesCard(series) {
            const card = document.createElement('a');
            card.className = 'movie-card series-card';
            card.href = seriesUrl(series.key);
            card.dataset.seriesKey = series.key;
            card.onclick = (e) => {
                if (e.ctrlKey || e.metaKey || e.button !== 0) return;   // nechat otevřít v nové kartě
                e.preventDefault();
                // podle klíče, ne podle uzavřeného objektu - po dotažení dalších stránek
                // je v searchEntries novější verze seriálu s víc epizodami
                openSeriesByKey(series.key, true);
            };
            card.innerHTML = `
                    <div class="card-play"><i>${ICON.play}</i></div>
                    <div class="series-badge">${series.kind === 'collection' ? 'SÉRIE' : 'SERIÁL'}</div>
                    <img src="${series.poster || THUMB_PLACEHOLDER}" alt="${escapeHtml(series.title)}">
                    <div class="info">
                        <div class="title">${escapeHtml(series.title)}</div>
                        <div class="year">${escapeHtml(seriesMeta(series))}</div>
                    </div>
                    ${favBtnHtml({ q: series.title, title: series.title, poster: series.poster || '', skey: series.key, type: 'series' })}
                `;
            const img = card.querySelector('img');
            img.onerror = () => { img.onerror = null; img.src = THUMB_PLACEHOLDER; };
            return card;
        }

        function openSeriesPage(series, push) {
            if (!series) return;
            activeSeries = series;
            seriesReturn = false;
            pageReturn = 'results';
            stopVideo();
            hideStatus();
            pageTitle.textContent = series.title;
            pageBody.innerHTML = seriesPageHtml(series, seriesLoadNote(series));
            showSection('page');
            if (push !== false) window.history.pushState({}, '', seriesUrl(series.key));
            window.scrollTo({ top: 0, behavior: 'smooth' });
            loadMoreEpisodes(series);
        }

        // ===== Dotahování epizod (stránky 2+) =====
        // Není to stránkování v UI: appka jen dohledá další výsledky hledání pro otevřený
        // seriál, dokud stránka něco vrací (max SERIES_MAX_PAGES kvůli limitu prehraj.to).

        function seriesLoadNote(series) {
            const st = seriesLoad.get(series.key);
            if (!st) return '';
            const what = series.kind === 'collection' ? 'filmy' : 'epizody';
            if (st.busy) return `Načítám další ${what}…`;
            if (st.error) return `Další ${what} se nepodařilo načíst.`;
            if (st.done && st.pages > 1) return 'Načteno vše dostupné.';
            return '';
        }

        function refreshSeriesPage() {
            if (!activeSeries || pageSection.style.display !== 'block') return;
            pageBody.innerHTML = seriesPageHtml(activeSeries, seriesLoadNote(activeSeries));
        }

        function seriesLoadState(key) {
            let st = seriesLoad.get(key);
            if (!st) {
                st = { pages: 1, done: false, busy: false, error: '', emptyStreak: 0 };
                seriesLoad.set(key, st);
            }
            return st;
        }

        function updateSeriesCard(series) {
            const card = Array.from(resultsGrid.querySelectorAll('.series-card'))
                .find(c => c.dataset.seriesKey === series.key);
            const meta = card && card.querySelector('.year');
            if (meta) meta.textContent = seriesMeta(series);
        }

        async function loadMoreEpisodes(startSeries) {
            const st = seriesLoadState(startSeries.key);
            if (st.busy || st.done || !lastQuery) return;
            st.busy = true;
            st.error = '';
            refreshSeriesPage();
            try {
                while (!st.done) {
                    // uživatel odešel jinam (jiný seriál, přehrávač, domovská stránka)
                    if (!activeSeries || activeSeries.key !== startSeries.key) break;
                    if (pageSection.style.display !== 'block') break;
                    if (st.pages >= SERIES_MAX_PAGES) { st.done = true; break; }

                    const page = st.pages + 1;
                    const searchSourceQS = settings.searchMerge ? '&source=all' : '&source=line1';
                    const { data, rateLimited } = await apiJson(
                        `/api/search?q=${encodeURIComponent(lastQuery)}&page=${page}${proxyQS()}${searchSourceQS}`,
                        { retries: 1 });
                    if (rateLimited || !data || !data.success || !Array.isArray(data.movies)) { st.done = true; break; }
                    // prázdná stránka = konec výsledků
                    if (data.movies.length === 0) { st.done = true; break; }
                    st.pages = page;

                    const res = mergeSeriesMovies(activeSeries, data.movies);
                    if (res.added) {
                        st.emptyStreak = 0;
                        currentResults.push(...res.addedMovies);
                        const entry = searchEntries.find(x => x.type === 'series' && x.series.key === res.series.key);
                        if (entry) entry.series = res.series;
                        activeSeries = res.series;
                        updateSeriesCard(res.series);
                        refreshSeriesPage();
                    } else if (++st.emptyStreak >= 2) {
                        // dvě stránky v řadě bez nových epizod = další nemá smysl zkoušet
                        st.done = true;
                    }
                }
            } catch (e) {
                st.error = (e && e.message) ? e.message : 'chyba';
            } finally {
                st.busy = false;
                refreshSeriesPage();
            }
        }

        function seriesPageHtml(series, loadNote) {
            const poster = series.poster
                ? `<div class="series-poster"><img src="${escapeHtml(series.poster)}" alt=""></div>`
                : '';
            return `
                <div class="series-head">
                    ${poster}
                    <div class="series-head-text">
                        <div class="series-sub">${escapeHtml([series.year, seriesMeta(series)].filter(Boolean).join(' · '))}</div>
                        <p class="series-note">${series.kind === 'collection'
                            ? 'Série se skládá z výsledků hledání – prehraj.to nevede stránku série. Appka u otevřené série dotahuje další stránky, dokud něco vrací.'
                            : 'Epizody se skládají z výsledků hledání – prehraj.to nevede stránku seriálu. Appka u otevřeného seriálu dotahuje další stránky, dokud něco vrací.'}</p>
                    </div>
                </div>
                ${loadNote ? `<div class="series-load">${escapeHtml(loadNote)}</div>` : ''}
                ${series.seasons.map(s => seriesSeasonHtml(s, series)).join('')}
            `;
        }

        function seriesSeasonHtml(season, series) {
            const collection = !!series && series.kind === 'collection';
            const title = collection
                ? (series.unit === 'dil' ? 'Díly' : 'Filmy')
                : (season.season == null ? 'Nezařazené epizody' : `${season.season}. série`);
            const count = collection
                ? (series.unit === 'dil' ? czCount(season.episodes.length, 'díl', 'díly', 'dílů')
                                         : czCount(season.episodes.length, 'film', 'filmy', 'filmů'))
                : czCount(season.episodes.length, 'díl', 'díly', 'dílů');
            return `
                <section class="series-season">
                    <h2>${escapeHtml(title)} <span class="season-count">${count}</span></h2>
                    <div class="ep-list">${season.episodes.map(ep => episodeHtml(ep, series)).join('')}</div>
                </section>`;
        }

        // Jeden díl = jedno video: z uploadů téhož dílu vybereme nejlepší (kvalita, pak CZ dabing).
        function variantScore(v) {
            const t = String(v.title || '').toLowerCase();
            let q = 1;
            if (/2160p|\b4k\b|uhd|ultra\s*hd/.test(t)) q = 4;
            else if (/1080p|full\s*hd|\bfhd\b/.test(t)) q = 3;
            else if (/720p/.test(t)) q = 2;
            const cz = /dabing|dab\b|\bcz\b/.test(t) ? 1 : 0;
            return q * 10 + cz;
        }

        function bestVariant(ep) {
            let best = ep.variants[0];
            ep.variants.forEach(v => { if (variantScore(v) > variantScore(best)) best = v; });
            return best;
        }

        function episodeHtml(ep, series) {
            const first = bestVariant(ep);
            // Kolekce nemá čísla dílů - u filmu bez roku se popisek prostě vynechá.
            const collection = !!series && series.kind === 'collection';
            const num = ep.num || (collection ? '' : `Epizoda ${ep.episode}`);
            return `
                <div class="ep-row">
                    <button type="button" class="ep-play" data-ep-url="${escapeHtml(first.url)}" title="${escapeHtml(first.title)}">
                        ${num ? `<span class="ep-num">${escapeHtml(num)}</span>` : ''}
                        <span class="ep-name">${escapeHtml(first.name || first.title)}</span>
                    </button>
                </div>`;
        }

        function variantLabel(movie) {
            const t = String(movie.title || '').replace(/\s+/g, ' ').trim();
            return t.length > 64 ? t.slice(0, 61) + '…' : t;
        }

        // Klik na epizodu a přepnutí zdroje - delegováno, stránka seriálu se překresluje.
        pageBody.addEventListener('click', e => {
            const btn = e.target.closest('[data-ep-url]');
            if (!btn) return;
            e.preventDefault();
            playSeriesEpisode(btn.dataset.epUrl);
        });
        pageBody.addEventListener('change', e => {
            const sel = e.target.closest('select.ep-variant');
            if (!sel) return;
            playSeriesEpisode(sel.value);
        });

        function playSeriesEpisode(url) {
            seriesReturn = true;
            playMovieByUrl(url);
        }

        function openSeriesByKey(key, push) {
            const series = findSeries(key);
            if (!series) return false;
            openSeriesPage(series, push);
            return true;
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

        // Výchozí první linie (bez bombuj a sledujteto); „Více výsledků“ přidá i tyto zdroje.
        const MERGE_SOURCES_LINE1 = ['prehrajto', 'hellspy', 'fastshare', 'sdilej'];
        const MERGE_SOURCES_ALL = ['prehrajto', 'sledujteto', 'bombuj', 'hellspy', 'fastshare', 'sdilej'];

        function movieDedupeKey(m) {
            const url = String((m && m.url) || '');
            if (url) return 'u:' + url.replace(/^https?:\/\//i, '').replace(/\/+$/, '').toLowerCase();
            return 't:' + movieDedupeTitle(m);
        }

        function movieDedupeTitle(m) {
            return String((m && m.title) || '')
                .replace(/\(\d{4}\)\s*$/, '')
                .replace(/\s+/g, ' ')
                .trim()
                .toLowerCase();
        }

        async function searchMerged(query, sources, token) {
            const list = Array.isArray(sources) && sources.length ? sources : MERGE_SOURCES_LINE1;
            const catItem = CATALOG.find(m => m.q === query);
            const seen = new Set();
            let answered = 0;
            let okCount = 0;
            let paintQueued = false;
            const stale = () => token != null && token !== searchToken;

            const paint = () => {
                paintQueued = false;
                if (stale()) return;
                if (!currentResults.length) return;
                const movies = catItem ? rankMovies(catItem, currentResults.slice()) : currentResults.slice();
                displayResults(movies, query);
                const left = list.length - answered;
                if (left > 0) resultsInfo.textContent += ` · načítám další zdroje (${left})…`;
            };

            const queuePaint = () => {
                if (paintQueued || stale()) return;
                paintQueued = true;
                requestAnimationFrame(paint);
            };

            await Promise.all(list.map(async (src) => {
                try {
                    const { data } = await apiJson(
                        `/api/search?q=${encodeURIComponent(query)}&source=${encodeURIComponent(src)}${proxyQS()}`,
                        { retries: 0 });
                    if (!stale() && data && data.success && Array.isArray(data.movies)) {
                        okCount++;
                        data.movies.forEach(movie => {
                            const key = movieDedupeKey(movie);
                            if (seen.has(key)) return;
                            seen.add(key);
                            currentResults.push(movie);
                        });
                        queuePaint();
                    }
                } catch (e) {
                    // zdroj selhal - ignorujeme, ostatní dobíhají
                } finally {
                    answered++;
                    if (!stale()) queuePaint();
                }
            }));

            if (stale()) return;
            paint();
            if (!currentResults.length) {
                if (!okCount) resultsError('Zdroje teď nevydaly žádnou odpověď (pravděpodobně 429). Zkus to za chvíli.');
                else resultsEmpty(`Nic jsme nenašli pro „${query}". Zkus jiný název nebo jiný pravopis.`, query);
            }
        }

        function displayResults(movies, query) {
            resultsClear();
            lastQuery = query;
            searchEntries = groupSearchResults(movies);

            const seriesCount = searchEntries.filter(e => e.type === 'series').length;
            resultsInfo.textContent = `Nalezeno ${movies.length} výsledků pro „${query}"`
                + (seriesCount ? ` · ${czCount(seriesCount, 'seriál', 'seriály', 'seriálů')} seskupeno` : '');
            resultsGrid.innerHTML = '';

            searchEntries.forEach(entry => {
                resultsGrid.appendChild(entry.type === 'series'
                    ? createSeriesCard(entry.series)
                    : createResultCard(entry.movie));
            });

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

        // ===== Pokračování ve sledování (localStorage, ~30 dní) =====
        // Ukládá se každý rozkoukaný film i díl seriálu zvlášť (klíč = URL stránky). <=2 min
        // před koncem se záznam bere jako dohraný a maže se.
        const PROGRESS_KEY = 'wflix.progress';
        const PROGRESS_TTL = 30 * 24 * 60 * 60 * 1000;
        function pKey(u) { return String(u || '').trim(); }
        function loadProgressMap() {
            try {
                const v = JSON.parse(localStorage.getItem(PROGRESS_KEY) || '{}');
                if (!v || typeof v !== 'object') return {};
                const now = Date.now(), out = {};
                let changed = false;
                Object.keys(v).forEach(k => {
                    const it = v[k];
                    if (it && typeof it === 'object' && isFinite(it.t) && (now - (it.ts || 0)) <= PROGRESS_TTL) out[k] = it;
                    else changed = true;
                });
                if (changed) try { localStorage.setItem(PROGRESS_KEY, JSON.stringify(out)); } catch (e) {}
                return out;
            } catch (e) { return {}; }
        }
        function saveProgressMap(m) {
            try {
                const now = Date.now(), clean = {};
                Object.keys(m || {}).forEach(k => {
                    const it = m[k];
                    if (it && isFinite(it.t) && (now - (it.ts || 0)) <= PROGRESS_TTL) clean[k] = it;
                });
                const ks = Object.keys(clean);
                if (ks.length > 80) {
                    ks.sort((a, b) => (clean[b].ts || 0) - (clean[a].ts || 0));
                    const trimmed = {};
                    ks.slice(0, 60).forEach(k => { trimmed[k] = clean[k]; });
                    localStorage.setItem(PROGRESS_KEY, JSON.stringify(trimmed));
                    return;
                }
                localStorage.setItem(PROGRESS_KEY, JSON.stringify(clean));
            } catch (e) {}
        }
        function progressGet(u) { const it = loadProgressMap()[pKey(u)]; return it && isFinite(it.t) ? it.t : 0; }
        function progressClear(u) { try { const m = loadProgressMap(); delete m[pKey(u)]; saveProgressMap(m); } catch (e) {} }

        function getWebContinueItems() {
            try {
                const m = loadProgressMap();
                const out = [];
                Object.keys(m).forEach(k => {
                    const it = m[k];
                    if (!it || !isFinite(it.t) || it.t < 8) return;
                    const url = it.url || k, title = it.title || '';
                    if (!url || !title) return;
                    const d = it.d;
                    if (isFinite(d) && d > 0 && (d - it.t) <= 120) return;
                    const pctLeft = (isFinite(d) && d > 0) ? Math.max(1, Math.floor((1 - it.t / d) * 100)) : 0;
                    out.push({ url, title, poster: it.thumb || '', _continue: true, _ts: it.ts || 0, _t: it.t, _d: isFinite(d) ? d : 0, note: pctLeft ? ('Zbývá ' + pctLeft + '%') : 'Rozkoukané' });
                });
                out.sort((a, b) => (b._ts || 0) - (a._ts || 0));
                return out.slice(0, 20);
            } catch (e) { return []; }
        }
        function saveWebProgress(force) {
            try {
                if (!player.page) return;
                const d = videoPlayer.duration, t = videoPlayer.currentTime;
                if (!isFinite(d) || d <= 0 || !isFinite(t)) return;
                if ((d - t) <= 120) { progressClear(player.page); return; }
                if (t < 5) return;
                if (!force && player._lastProgSave && Date.now() - player._lastProgSave < 5000) return;
                const m = loadProgressMap();
                const pk = pKey(player.page);
                const prev = m[pk] || {};
                m[pk] = { t: Math.floor(t), d: Math.floor(d), ts: Date.now(), title: player.title || prev.title || '', thumb: player.poster || prev.thumb || '', url: player.page };
                saveProgressMap(m);
                player._lastProgSave = Date.now();
            } catch (e) {}
        }
        function applyWebResume() {
            try {
                if (player.resumeApplied) return;
                const want = player.resumeAt || 0;
                if (!want) { player.resumeApplied = true; return; }
                const d = videoPlayer.duration;
                if (!isFinite(d) || d <= 0) { scheduleWebResume(); return; }   // HLS: délka ještě není známá
                const t = Math.max(0, Math.min(want, d - 6));
                if (t > 3 && Math.abs(videoPlayer.currentTime - t) > 2) {
                    try { videoPlayer.currentTime = t; } catch (e) { scheduleWebResume(); return; }
                }
                player.resumeApplied = true;
                player.resumeAt = 0;
                player._resumeTries = 0;
            } catch (e) {}
        }
        function scheduleWebResume() {
            if (player.resumeApplied || (player._resumeTries || 0) >= 25) return;
            player._resumeTries = (player._resumeTries || 0) + 1;
            setTimeout(() => { if (!player.resumeApplied) applyWebResume(); }, 400);
        }

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
                videoPlayer.appendChild(track);
                els.push(track);
                subtitleSelect.appendChild(new Option(track.label, String(i)));
            });
            player.subEls = els;

            // Titulky jsou vždy defaultně vypnuté - i když je zdroj označí jako výchozí
            // nebo má českou stopu. Divák si je zapne ručně ve výběru titulků.
            player.subLang = null;
            player.subOff = true;
            applySubtitle(-1);
            setTimeout(() => { if (player.subSig === sig) applySubtitle(-1); }, 0);
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
        async function loadAndPlay(page, title, beforePlay, poster) {
            const useDirect = directPreferred();
            player.page = page; player.cdn = ''; player.title = title || 'video';
            player.mode = useDirect ? 'direct' : 'relay';
            player.lastTime = 0; player.poster = poster || '';
            player.resumeKey = page; player.resumeAt = progressGet(page);
            player.resumeApplied = false; player._resumeTries = 0; player._lastProgSave = 0;
            player.fixes = 0; player.busy = false;
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
            if (beforePlay) beforePlay();
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
            const resumeAt = player.lastTime || 0;
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
            showStatus((reason === 'stall' || reason === 'predcasny konec')
                ? '🔄 Stream se zasekl – obnovuji přehrávání…'
                : (player.mode === 'relay' ? '🔄 Přímé přehrávání selhalo, pokračuji přes server…' : '🔄 Obnovuju přehrávání…'), 'loading');
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

        // Pozici zkoušet obnovit při každé změně stavu média (HLS hlásí délku později).
        ['loadedmetadata', 'durationchange', 'canplay', 'playing'].forEach(ev =>
            videoPlayer.addEventListener(ev, applyWebResume));
        videoPlayer.addEventListener('pause', () => saveWebProgress(true));
        window.addEventListener('pagehide', () => saveWebProgress(true));
        window.addEventListener('beforeunload', () => saveWebProgress(true));

        videoPlayer.addEventListener('timeupdate', () => {
            clearTimeout(player.stallTimer);
            if (!videoPlayer.seeking && videoPlayer.currentTime > 0) player.lastTime = videoPlayer.currentTime;
            if (!videoPlayer.seeking) saveWebProgress(false);
            // po minutě a půl bez problému počítadlo pokusů vynulujeme (odkaz vyprší klidně víckrát)
            if (player.fixes > 0 && videoPlayer.currentTime - player.resumeAt > 90) player.fixes = 0;
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
        // spojení, co se utrhlo uprostřed, se občas tváří jako "konec" videa
        videoPlayer.addEventListener('ended', () => {
            if (player.page && isFinite(videoPlayer.duration) && videoPlayer.duration - videoPlayer.currentTime > 10) {
                recoverPlayback('predcasny konec');
                return;
            }
            msSetState('paused');
            if (player.page) { progressClear(player.page); showPlayerEnd(); }
        });

        // ===== Živé vysílání (IPTV) =====
        // Seznam kanálů tahá server (/api/live) z iptv-org, protože playlisty jsou velké a část
        // z nich neposílá CORS. hls.js se načítá až při prvním kliknutí na kanál, aby úvodní
        // stránka nenačítala 400 kB navíc.
        let liveChannels = [];
        let liveShown = 0;
        // Program kanálů pro časovou osu: mapa "název kanálu" -> [{ t, s, e }].
        let liveGuide = {};
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
            liveGrid.hidden = true;
            try {
                // epg=1: server ke kanálům přidá program pro časovou osu a sám je spáruje
                // s průvodcem, takže prohlížeč nemusí znát žádná pravidla párování.
                const r = await fetch('/api/live?' + liveQuery() + '&epg=1');
                const d = await r.json();
                if (!d.success) throw new Error(d.error || 'Seznam kanálů se nepodařilo načíst');
                liveChannels = Array.isArray(d.channels) ? d.channels : [];
                liveGuide = d.guide && typeof d.guide === 'object' ? d.guide : {};
                if (!liveChannels.length) throw new Error('Seznam je prázdný');
                renderLive(true);
            } catch (e) {
                liveChannels = [];
                liveState.className = 'results-state show error';
                liveState.innerHTML = `<span class="state-text">${escapeHtml(e.message)}</span>`;
            }
        }

        // Seznamy jako USA mají přes tisíc kanálů - vykreslujeme po dávkách, ať se telefon
        // nezadusí. Český seznam (~110 kanálů) se vejde celý, takže se otevře najednou.
        const LIVE_PAGE = 400;

        // ===== Časová osa programu =====
        // Kanály jsou řádky, pořady bloky na ose 00:00-24:00 místního času. Program posílá
        // server u /api/live?epg=1 a páruje ho s průvodcem sám, takže tady se jen kreslí.
        // Kanál bez programu dostane blok "Data o programu nejsou k dispozici" - neztratí
        // se a pořád se na něj dá kliknout.
        const LG_PPM = 2.4;          // pixelů na minutu: celý den má 3456 px
        const LG_DAY = 1440;         // minut na ose
        let lgDayStart = 0;          // lokální půlnoc (ms) pro převod ISO času na minuty osy

        function lgTime(min) {
            const m = Math.max(0, Math.round(min));
            return String(Math.floor(m / 60) % 24).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
        }

        function lgOffset(iso) {
            const d = new Date(iso);
            return Number.isNaN(d.getTime()) ? null : (d.getTime() - lgDayStart) / 60000;
        }

        // Pořady kanálu oříznuté na dnešní den (přes půlnoc jde blok jen po okraj osy).
        function lgProgrammes(channel) {
            const list = liveGuide[channel.name];
            if (!Array.isArray(list)) return [];
            const out = [];
            for (const p of list) {
                const from = lgOffset(p.s);
                const to = lgOffset(p.e);
                if (from == null || to == null || to <= from) continue;
                const a = Math.max(0, from);
                const b = Math.min(LG_DAY, to);
                if (b - a < 1) continue;
                out.push({ title: p.t || 'Bez názvu', from, to, a, b });
            }
            return out;
        }

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
            liveGrid.hidden = items.length === 0;
            if (!items.length) { liveGrid.innerHTML = ''; return; }

            if (!lgDayStart) {
                const day = new Date();
                day.setHours(0, 0, 0, 0);
                lgDayStart = day.getTime();
            }
            const clock = new Date();
            const nowMin = clock.getHours() * 60 + clock.getMinutes() + clock.getSeconds() / 60;
            const width = LG_DAY * LG_PPM;

            let ticks = '';
            for (let m = 0; m < LG_DAY; m += 30)
                ticks += `<span class="lg-tick${m % 60 === 0 ? ' hour' : ''}" style="left:${m * LG_PPM}px">${lgTime(m)}</span>`;

            const rest = Math.max(0, items.length - liveShown);
            const rows = items.slice(0, liveShown).map(({ c, i }) => {
                const programmes = lgProgrammes(c);
                const blocks = programmes.length
                    ? programmes.map(p => {
                        const running = p.from <= nowMin && nowMin < p.to;
                        const state = running ? 'run' : p.to <= nowMin ? 'past' : 'fut';
                        const done = running ? Math.round((nowMin - p.from) / (p.to - p.from) * 100) : 0;
                        return `<button type="button" class="lg-pg ${state}" data-live="${i}"
                            style="left:${p.a * LG_PPM}px;width:${Math.max(16, (p.b - p.a) * LG_PPM - 2)}px"
                            title="${escapeHtml(p.title)} · ${lgTime(p.from)}–${lgTime(p.to)}"><b>${escapeHtml(p.title)}</b><small>${lgTime(p.from)}–${lgTime(p.to)}</small>${done ? `<i class="lg-prog" style="width:${Math.min(100, done)}%"></i>` : ''}</button>`;
                    }).join('')
                    : `<button type="button" class="lg-pg empty" data-live="${i}" style="left:0;width:${width}px"
                        title="${escapeHtml(c.name)} – program neznáme"><b>Data o programu nejsou k dispozici</b><small>klikni a hraj živě</small></button>`;
                return `<div class="lg-row">
                    <div class="lg-chan"><button type="button" class="lg-chan-btn" data-live="${i}" title="${escapeHtml(c.name)}">
                        <span class="lg-logo">${c.logo ? `<img src="${escapeHtml(c.logo)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">` : ''}<span class="lg-init">${escapeHtml(initials(c.name))}</span></span>
                        <span class="lg-name">${escapeHtml(c.name)}</span>
                    </button></div>
                    <div class="lg-track">${blocks}</div>
                </div>`;
            }).join('');

            const scrollBox = liveGrid.querySelector('.lg-scroll');
            const keepLeft = scrollBox ? scrollBox.scrollLeft : 0;
            const keepTop = scrollBox ? scrollBox.scrollTop : 0;

            liveGrid.innerHTML = `<div class="lg-scroll"><div class="lg-canvas" style="width:calc(var(--lg-cw) + ${width}px)">
                <div class="lg-head"><div class="lg-corner">Kanál</div><div class="lg-ticks" style="width:${width}px">${ticks}</div></div>
                <div class="lg-rows">${rows}</div>
                <div class="lg-now" style="left:calc(var(--lg-cw) + ${nowMin * LG_PPM}px)"></div>
            </div></div>`
                + (rest ? `<button type="button" class="live-more" id="liveMore">Zobrazit další (${rest})</button>` : '');

            if (reset) {
                // Až po layoutu: v tu chvíli už .lg-scroll zná svou šířku. Když se sekce
                // zrovna zobrazuje, první pokus ještě nemusí mít co posouvat - proto se
                // po chvíli zopakuje (podruhé už je to no-op).
                requestAnimationFrame(() => {
                    liveScrollToNow(false);
                    setTimeout(() => liveScrollToNow(false), 150);
                });
            } else {
                const box = liveGrid.querySelector('.lg-scroll');
                if (box) { box.scrollLeft = keepLeft; box.scrollTop = keepTop; }
            }
        }

        // Posune osu tak, aby "teď" bylo zhruba ve třetině šířky - otevíráš to na aktuálním programu.
        function liveScrollToNow(smooth) {
            const box = liveGrid.querySelector('.lg-scroll');
            if (!box) return;
            const d = new Date();
            const nowMin = d.getHours() * 60 + d.getMinutes();
            const max = Math.max(0, box.scrollWidth - box.clientWidth);
            const left = Math.min(max, Math.max(0, nowMin * LG_PPM - box.clientWidth * 0.32));
            box.scrollTo({ left, behavior: smooth ? 'smooth' : 'auto' });
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

        // Metadata titulu z ČSFD (volitelná integrace node-csfd-api). Když server nic
        // nevrátí, řádek zůstane skrytý - přehrávač tím netrpí.
        let metaFor = '';
        async function loadMeta(title) {
            if (!csfdMeta) return;
            const clean = safeDecode(title || '')
                .replace(/\s*\(\d{4}\)\s*$/, '')
                .replace(/\s*\|.*$/, '')
                .trim();
            metaFor = clean;
            csfdMeta.hidden = true;
            csfdMeta.innerHTML = '';
            if (clean.length < 2) return;
            try {
                const r = await fetch('/api/meta?q=' + encodeURIComponent(clean));
                const d = await r.json();
                // Odpověď mohla dorazit pozdě, kdy už hraje jiné video.
                if (!d.success || !d.info || metaFor !== clean) return;
                const m = d.info;
                const parts = [];
                if (m.rating) parts.push(`<span class="cm-rating">${escapeHtml(String(m.rating))} %</span>`);
                const bits = [m.year, (m.genres || []).slice(0, 2).join(', '),
                    m.ratingCount ? `${m.ratingCount} hodnocení` : ''].filter(Boolean);
                if (bits.length) parts.push(`<span class="cm-info">${escapeHtml(bits.join(' · '))}</span>`);
                if (m.url) parts.push(`<a class="cm-link" href="${escapeHtml(m.url)}" target="_blank" rel="noopener noreferrer">ČSFD ↗</a>`);
                if (!parts.length) return;
                csfdMeta.innerHTML = parts.join('');
                csfdMeta.hidden = false;
            } catch (e) {
                console.debug('Metadata ČSFD nejsou k dispozici:', e.message);
            }
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
                if (castBtn) castBtn.hidden = true;
                return;
            }
            const on = isFav(player.page);
            favBtn.hidden = false;
            if (pipBtn && pipSupported) pipBtn.hidden = false;
            if (castBtn) castBtn.hidden = false;   // okno s možnostmi se hodí v každém prohlížeči
            favBtn.innerHTML = (on ? ICON.starOn : ICON.star) + '<span class="btn-label">' + (on ? 'V oblíbených' : 'Do oblíbených') + '</span>';
            favBtn.setAttribute('aria-pressed', String(on));
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

        // ===== Obraz v obraze (Picture-in-Picture) =====
        // <video> je obyčejný HTML5 prvek, takže stačí requestPictureInPicture(). Tlačítko se
        // ukáže, jen když to prohlížeč umí (Chrome/Edge; Safari má vlastní PiP v ovládání videa).
        // Tlačítko se ukáže až ve chvíli, kdy je v přehrávači video (viz updateFavBtn).
        if (pipBtn) pipBtn.addEventListener('click', async () => {
            try {
                if (document.pictureInPictureElement) await document.exitPictureInPicture();
                else await videoPlayer.requestPictureInPicture();
            } catch (err) {
                notice('Obraz v obraze se nepodařilo zapnout.', 'error', 4000);
            }
        });
        videoPlayer.addEventListener('enterpictureinpicture', () => { setBtnText(pipBtn, 'Zavřít obraz v obraze'); });
        videoPlayer.addEventListener('leavepictureinpicture', () => { setBtnText(pipBtn, 'Obraz v obraze'); });

        // ===== Přehrát na TV =====
        // Žádný jediný způsob nefunguje všude, proto tlačítko otevře okno s možnostmi:
        //  1) zařízení v síti: Chrome/Edge (Chromecast, Google TV) přes Remote Playback API,
        //     Safari/iOS přes AirPlay (umí ho i LG webOS 2019+),
        //  2) odkaz na video: otevře se v prohlížeči nebo aplikaci na TV (funguje všude),
        //  3) návod na zrcadlení obrazovky (Miracast / Smart View).
        // Video se do TV posílá přes Wi-Fi - Bluetooth na přenos videa nestačí.
        if (castBtn) {
            const castDlg = document.getElementById('castDlg');
            const castNative = document.getElementById('castNative');
            const castShare = document.getElementById('castShare');
            const castCopy = document.getElementById('castCopy');
            const castLink = document.getElementById('castLink');
            const castMsg = document.getElementById('castMsg');
            const castClose = document.getElementById('castClose');
            const castLabel = (on) => { setBtnText(castBtn, on ? 'Přehrává se na TV' : 'Přehrát na TV'); castBtn.classList.toggle('on', !!on); };

            const tvLink = () => `${location.origin}${location.pathname}?watch=${encodeURIComponent(player.page)}&title=${encodeURIComponent(player.title || 'Video')}`;
            const setMsg = (text) => { castMsg.textContent = text || ''; };
            const closeCast = () => {
                castDlg.hidden = true;
                castBtn.focus();
            };

            castBtn.addEventListener('click', () => {
                if (!player.page) return;
                castLink.value = tvLink();
                setMsg('');
                castNative.disabled = !castSupported;
                setBtnText(castNative, castSupported
                    ? 'Najít zařízení v síti (Chromecast, AirPlay)'
                    : 'Zařízení v síti (tenhle prohlížeč to neumí)');
                castShare.hidden = typeof navigator.share !== 'function';
                castDlg.hidden = false;
                (castSupported ? castNative : castCopy).focus();
            });

            castNative.addEventListener('click', async () => {
                setMsg('');
                try {
                    if (videoPlayer.remote && typeof videoPlayer.remote.prompt === 'function') {
                        await videoPlayer.remote.prompt();
                        closeCast();
                    } else if (typeof videoPlayer.webkitShowPlaybackTargetPicker === 'function') {
                        videoPlayer.webkitShowPlaybackTargetPicker();
                        closeCast();
                    }
                } catch (err) {
                    if (err && err.name === 'NotAllowedError') return;   // výběr zařízení jen zavřel
                    setMsg(err && err.name === 'NotFoundError'
                        ? 'V síti se nenašel Chromecast ani AirPlay. LG televize Chromecast nemají - použij AirPlay (iPhone, Mac) nebo odkaz pro TV níže.'
                        : 'Video se nepodařilo odeslat. Zkus odkaz pro TV níže.');
                }
            });

            castShare.addEventListener('click', async () => {
                try {
                    await navigator.share({ title: player.title || 'Wflix', url: castLink.value });
                } catch (err) {
                    if (!err || err.name !== 'AbortError') setMsg('Sdílení se nepodařilo. Zkopíruj odkaz.');
                }
            });

            castCopy.addEventListener('click', async () => {
                const link = castLink.value;
                try {
                    await navigator.clipboard.writeText(link);
                    setMsg('Odkaz je zkopírovaný. Otevři ho v prohlížeči na TV.');
                } catch (err) {
                    castLink.focus();
                    castLink.select();
                    let ok = false;
                    try { ok = document.execCommand('copy'); } catch (e2) {}
                    setMsg(ok ? 'Odkaz je zkopírovaný. Otevři ho v prohlížeči na TV.' : 'Označ odkaz výše a zkopíruj ho ručně.');
                }
            });
            castLink.addEventListener('focus', () => castLink.select());

            castClose.addEventListener('click', closeCast);
            castDlg.addEventListener('click', (e) => { if (e.target === castDlg) closeCast(); });
            // Klávesy v okně nesmí ovládat přehrávač (mezerník, šipky).
            castDlg.addEventListener('keydown', (e) => {
                e.stopPropagation();
                if (e.key === 'Escape') { e.preventDefault(); closeCast(); return; }
                trapTab(e, castDlg);
            });

            if (videoPlayer.remote && typeof videoPlayer.remote.addEventListener === 'function') {
                videoPlayer.remote.addEventListener('connect', () => castLabel(true));
                videoPlayer.remote.addEventListener('disconnect', () => castLabel(false));
            }
            videoPlayer.addEventListener('webkitcurrentplaybacktargetiswirelesschanged', () => castLabel(!!videoPlayer.webkitCurrentPlaybackTargetIsWireless));
        }

        // ===== Klávesové zkratky přehrávače =====
        // Jen když je otevřený přehrávač a fokus není ve formulářovém prvku - jinak by
        // mezerník a šipky kradly psaní do hledání i Enter na tlačítkách.
        const playerKeysActive = () => playerSection.style.display === 'block' && !!player.page;

        function seekBy(delta) {
            if (!isFinite(videoPlayer.duration) || videoPlayer.duration <= 0) return;
            try { if (player && player.page) videoPlayer.pause(); } catch(_){}
            const t = Math.min(videoPlayer.duration - 1, Math.max(0, videoPlayer.currentTime + delta));
            videoPlayer.currentTime = t;
            notice((delta > 0 ? 'Posun vpřed na ' : 'Posun zpět na ') + fmtClock(t), 'success', 1500);
        }

        function volumeBy(delta) {
            const v = Math.min(1, Math.max(0, videoPlayer.volume + delta));
            videoPlayer.volume = v;
            videoPlayer.muted = v === 0;
            notice('Hlasitost ' + Math.round(v * 100) + ' %', 'success', 1500);
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
            loadMeta(nowPlaying.textContent);

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
                    loadMeta(movie.title);
                    showSection('player');
                }, movie.thumbnail);
            } catch (error) {
                console.error('Play error:', error);
                showStatus(`❌ ${error.message || 'Video se nepodařilo načíst'}`, 'error');
            }
        }

        // Přehrání z osobní řady: adresa na prehraj.to je uložená, takže se nehledá znovu.
        function playFromLibrary(url) {
            const h = favorites.find(x => x.url === url);
            const title = h ? h.title : 'Video';
            window.history.pushState({}, '', `?watch=${encodeURIComponent(url)}&title=${encodeURIComponent(title)}`);
            showStatus('🔄 Načítám video...', 'loading');
            showSection('player');
            nowPlaying.textContent = title;
            loadMeta(title);
            loadAndPlay(url, title, hideStatus, (h && h.poster) || posterFor(title)).catch(error => {
                console.error('Play error:', error);
                showStatus(`❌ ${error.message || 'Video se nepodařilo načíst'}`, 'error');
            });
        }

        function goBack() {
            stopVideo();
            hideStatus();

            // Z přehrávače zpět na stránku seriálu, ze které se epizoda pustila.
            if (seriesReturn && activeSeries) {
                seriesReturn = false;
                openSeriesPage(activeSeries, false);
                window.history.replaceState({}, '', seriesUrl(activeSeries.key));
                return;
            }

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
            const showKey = params.get('show');
            const liveParam = params.get('live');

            // Always stop video first when navigating
            stopVideo();

            if (videoUrl) {
                playVideoDirectly(videoUrl, title || 'Video');
            } else if (liveParam) {
                showSection('live');
                if (!liveChannels.length) loadLive();
            } else if (showKey && openSeriesByKey(showKey, false)) {
                // stránka seriálu - výsledky hledání už máme v paměti
            } else if (searchQuery) {
                searchInput.value = searchQuery;
                if (currentResults.length > 0) {
                    showSection('results');
                } else {
                    searchMovies().then(() => { if (showKey) openSeriesByKey(showKey, false); });
                }
            } else {
                hideStatus();
                showSection('placeholder');
            }
        });

        // Stop and cleanup video player
        function stopVideo() {
            if (videoPlayer) {
                saveWebProgress(true);
                player.page = ''; player.cdn = '';
                proxyBtn.hidden = true;
                if (favBtn) favBtn.hidden = true;
                if (pipBtn) pipBtn.hidden = true;
                if (castBtn) castBtn.hidden = true;
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
        const liveNowBtn = document.getElementById('liveNowBtn');
        if (liveNowBtn) liveNowBtn.addEventListener('click', () => liveScrollToNow(true));

        // ===== Stav služby (/api/health) overlay =====
        function formatHealthValue(v) {
            if (v == null) return '';
            if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return String(v);
            try { return JSON.stringify(v); } catch (e) { return String(v); }
        }
        function renderHealthRows(items, nameKey) {
            if (!Array.isArray(items) || !items.length) return '<div class="health-row"><span class="err">Žádná data.</span></div>';
            return items.map(function (it) {
                var ok = !!(it && (it.ok === true || it.status === 200 || it.note === 'mapped'));
                var name = esc(formatHealthValue(it && (it[nameKey] || it.endpoint || it.name || it.check || '—')));
                var statusText = it && it.status != null ? ('HTTP ' + esc(formatHealthValue(it.status))) : (it && it.note ? esc(formatHealthValue(it.note)) : '');
                var ms = it && it.ms != null ? (esc(formatHealthValue(it.ms)) + ' ms') : '';
                var err = it && it.error ? esc(formatHealthValue(it.error)) : '';
                return '<div class="health-row"><span class="name">' + name + '</span>'
                    + '<span class="st ' + (ok ? 'ok' : 'bad') + '">' + (ok ? 'OK' : 'Chyba') + '</span>'
                    + '<span class="meta">' + statusText + (ms ? (' · ' + ms) : '') + '</span>'
                    + '<span class="err">' + err + '</span></div>';
            }).join('');
        }
        function renderHealth(data, httpStatus) {
            var overall = data && (data.ok === true || data.success === true || data.status === 'ok');
            var html = '<div class="health-summary"><span class="health-badge ' + (overall ? 'ok' : 'bad') + '">' + (overall ? 'OK' : 'Problém') + '</span>'
                + '<span>/api/health' + (httpStatus ? (' · HTTP ' + esc(String(httpStatus))) : '') + '</span></div>';
            var checks = data && (data.checks || data.results || data.probes);
            var endpoints = data && (data.endpoints || data.handlers);
            var upstreams = data && (data.upstreams || data.upstream);
            if (checks) html += '<div class="health-section"><h3>Kontroly</h3>' + renderHealthRows(checks, 'endpoint') + '</div>';
            if (endpoints && endpoints !== checks) html += '<div class="health-section"><h3>Endpointy</h3>' + renderHealthRows(endpoints, 'endpoint') + '</div>';
            if (upstreams) html += '<div class="health-section"><h3>Upstreamy</h3>' + renderHealthRows(upstreams, 'name') + '</div>';
            if (!checks && !endpoints && !upstreams && data && typeof data === 'object') {
                html += '<div class="health-section"><h3>Odpověď</h3><pre>' + esc(JSON.stringify(data, null, 2)) + '</pre></div>';
            }
            if (!data) html += '<div class="health-section"><pre>' + esc('Bez dat') + '</pre></div>';
            html += '<details class="health-section"><summary>Raw JSON</summary><pre>' + esc(JSON.stringify(data, null, 2)) + '</pre></details>';
            return html;
        }
        var healthReturnFocus = null;
        function closeHealthOverlay() {
            var dlg = document.getElementById('healthDlg');
            if (!dlg) return;
            dlg.hidden = true;
            dlg.setAttribute('aria-hidden', 'true');
            document.removeEventListener('keydown', onHealthKeydown, true);
            var rf = healthReturnFocus;
            healthReturnFocus = null;
            if (rf && typeof rf.focus === 'function') try { rf.focus(); } catch (e) {}
        }
        function onHealthKeydown(e) {
            if (e.key === 'Escape' || e.key === 'Esc') { e.preventDefault(); e.stopPropagation(); closeHealthOverlay(); return; }
            trapTab(e, document.getElementById('healthDlg'));
        }
        async function openHealthOverlay() {
            var dlg = document.getElementById('healthDlg');
            var content = document.getElementById('healthContent');
            if (!dlg || !content) return;
            healthReturnFocus = document.activeElement;
            dlg.hidden = false;
            dlg.removeAttribute('aria-hidden');
            content.innerHTML = '<span class="spinner"></span><span class="state-text">Načítám /api/health…</span>';
            document.addEventListener('keydown', onHealthKeydown, true);
            var closeBtn = document.getElementById('healthClose');
            if (closeBtn) try { closeBtn.focus(); } catch (e) {}
            try {
                var r = await fetch('/api/health?ts=' + Date.now(), { cache: 'no-store', credentials: 'same-origin' });
                var data = null;
                try { data = await r.json(); } catch (e) { data = { ok: false, error: 'Neplatná JSON odpověď', status: r.status }; }
                if (!dlg.hidden) content.innerHTML = renderHealth(data, r.status);
            } catch (e) {
                if (!dlg.hidden) content.innerHTML = renderHealth({ ok: false, error: (e && e.message) ? e.message : String(e) }, 0);
            }
        }
        document.addEventListener('click', function (e) {
            var t = e.target;
            if (!t) return;
            if (t.closest && t.closest('[data-open-health]')) { e.preventDefault(); e.stopPropagation(); openHealthOverlay(); return; }
            if (t.id === 'healthClose') { e.preventDefault(); e.stopPropagation(); closeHealthOverlay(); return; }
            var dlg = document.getElementById('healthDlg');
            if (dlg && !dlg.hidden && t === dlg) { e.preventDefault(); e.stopPropagation(); closeHealthOverlay(); }
        }, true);

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

                    <h2>Vyhledávání</h2>
                    <div class="set-row">
                        <label for="searchMergeToggle">Více výsledků</label>
                        <label class="switch"><input type="checkbox" id="searchMergeToggle"><span></span></label>
                    </div>
                    <div class="set-hint">Vypnuto (výchozí): hledá se na Prehraj.to, HellSpy, FastShare a Sdílej najednou (bez Bombuj a Sledujteto). Zapnuto: přidají se i Bombuj a Sledujteto. Když jeden zdroj selže, použijí se ostatní; chyba se zobrazí jen když selžou všechny.</div>

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

                    <h2>Provoz</h2>
                    <div class="set-row">
                        <label>Právě online (přibližně)</label>
                        <span id="onlineCountValue" style="opacity:.9">…</span>
                    </div>
                    <div class="set-hint">Orientační počet aktivních klientů za poslední chvíli. Hodí se jako indikátor, když hledání naráží na limit.</div>
                    <div class="set-row">
                        <label>Stav služby</label>
                        <button type="button" class="state-btn" id="openHealthBtn">Status</button>
                    </div>
                    <div class="set-hint">Zobrazí formátovaný výstup <code>/api/health</code> (endpointy a upstreamy).</div>

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

                    <h2>Data v prohlížeči</h2>
                    <p>Nastavení, rozehrané filmy i oblíbené zůstávají jen v tomhle prohlížeči. Co přesně se ukládá a jak to smazat najdeš v <button type="button" class="f-link" onclick="openPage('cookies')" style="color:#fff;text-decoration:underline">Předvolbách cookies</button>.</p>
            `;
        }

        // Napojení ovládacích prvků po každém vykreslení stránky (prvky jsou nové).
        let onlinePingTimer = null;
        async function refreshOnlineCount(root) {
            const el = root && root.querySelector ? root.querySelector('#onlineCountValue') : document.getElementById('onlineCountValue');
            if (!el) { clearInterval(onlinePingTimer); onlinePingTimer = null; return; }
            try {
                const r = await fetch(withCid('/api/ping'));
                const d = await r.json();
                if (document.getElementById('onlineCountValue') === el) el.textContent = (d && typeof d.onlineUsers === 'number') ? String(d.onlineUsers) : '–';
            } catch (e) { if (document.getElementById('onlineCountValue') === el) el.textContent = '–'; }
        }
        function bindSettings(root) {
            clearInterval(onlinePingTimer);
            refreshOnlineCount(root);
            onlinePingTimer = setInterval(() => refreshOnlineCount(root), 15000);

            const q = id => root.querySelector('#' + id);
            const healthBtn = q('openHealthBtn');
            if (healthBtn) healthBtn.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); openHealthOverlay(); });

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

            // Experimental: "Více výsledků" merges supported sources (source=all). Individual failures are tolerated.
            const searchMergeTog = q('searchMergeToggle');
            if (searchMergeTog) {
                searchMergeTog.checked = !!settings.searchMerge;
                searchMergeTog.addEventListener('change', () => {
                    settings.searchMerge = !!searchMergeTog.checked;
                    saveSettings();
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

        }

        // ===== Knihovna: oblíbené na vlastní stránce =====
        // Klikací atributy nesou jen číslo - pořadí se po každé změně překreslí, takže
        // se do onclick nedostane adresa s apostrofem nebo ampersandem.
        let libOrder = [];
        let libFilterText = '';

        function libRowHtml(entry, i) {
            const it = entry.item;
            const isCont = entry.kind === 'continue';
            const title = escapeHtml(it.title || 'Video');
            const img = it.poster || '';
            const art = img
                ? `<img alt="" loading="lazy" referrerpolicy="no-referrer" src="${escapeHtml(img)}" onerror="this.remove()">`
                : '<span class="mark" aria-hidden="true">' + escapeHtml(monogram(it.title)) + '</span>';
            const pct = (isCont && it._d > 0) ? Math.max(0, Math.min(100, (it._t / it._d) * 100)) : 0;
            const prog = pct ? `<span class="progress"><i style="width:${pct}%"></i></span>` : '';
            const meta = isCont
                ? escapeHtml(it.note || 'Rozkoukané')
                : (it.type === 'series' ? 'Seriál' : 'Oblíbené');
            const del = isCont
                ? ''
                : `<button class="lib-del star" type="button" onclick="libDelFav(${i})" aria-label="Odebrat z oblíbených" title="Odebrat z oblíbených">${ICON.starOn}</button>`;
            return `<div class="lib-item" data-name="${escapeHtml(norm(it.title))}">
                <button class="lib-open" type="button" onclick="libPlay(${i})" aria-label="Přehrát ${title}">
                    <span class="lib-art" style="background:${posterGradient(it.title || '')}">
                        ${art}${prog}
                    </span>
                    <span class="lib-info">
                        <b>${title}</b>
                        <span class="lib-meta">${meta}</span>
                    </span>
                </button>
                ${del}
            </div>`;
        }

        function libraryPageHtml() {
            return `
                    <input class="row-filter lib-filter" id="libFilter" type="search" autocomplete="off"
                        placeholder="Filtrovat knihovnu…" aria-label="Filtrovat knihovnu">
                    <h2>Pokračovat ve sledování</h2>
                    <div class="lib-list" id="libHistList"></div>
                    <h2 class="lib-h2-second">Oblíbené</h2>
                    <div class="lib-list" id="libFavList"></div>
                    <div class="set-hint">Historie i oblíbené jsou jen v tomhle prohlížeči - nikam se neposílají. Hvězdička titul přidá/odebere z oblíbených, rozkoukané se maže samo po dohrání.</div>
            `;
        }

        function applyLibFilter() {
            const q = norm(libFilterText.trim());
            document.querySelectorAll('#pageBody .lib-item').forEach(el => {
                el.hidden = !!q && !(el.dataset.name || '').includes(q);
            });
        }

        function renderLibraryBody() {
            const favEl = document.getElementById('libFavList');
            const histEl = document.getElementById('libHistList');
            if (!favEl) return;
            const cont = (typeof getWebContinueItems === 'function') ? getWebContinueItems() : [];
            libOrder = [];
            cont.forEach(it => libOrder.push({ kind: 'continue', item: it }));
            favorites.forEach(f => libOrder.push({ kind: 'fav', item: f }));

            const histRows = [], favRows = [];
            libOrder.forEach((entry, i) => {
                if (entry.kind === 'continue') histRows.push(libRowHtml(entry, i));
                else favRows.push(libRowHtml(entry, i));
            });
            if (histEl) {
                histEl.innerHTML = histRows.length
                    ? histRows.join('')
                    : '<div class="lib-empty">Zatím nic rozkoukaného. Pusť si film nebo díl a objeví se tady.</div>';
            }
            favEl.innerHTML = favRows.length
                ? favRows.join('')
                : '<div class="lib-empty">Zatím žádné oblíbené. Hvězdička na kartě filmu ho přidá sem.</div>';
            applyLibFilter();
        }

        function bindLibrary(root) {
            const filter = root.querySelector('#libFilter');
            if (filter) {
                filter.value = libFilterText;
                filter.addEventListener('input', () => { libFilterText = filter.value; applyLibFilter(); });
            }
            renderLibraryBody();
        }

        // Uložený seriál nemá přímý odkaz na soubor - najde se podle názvu a otevře
        // se jeho stránka se seznamem dílů.
        let pendingSeriesKey = null;
        async function openLibrarySeries(key, title) {
            pendingSeriesKey = key || null;
            searchInput.value = title || '';
            await searchMovies();
            const want = pendingSeriesKey;
            pendingSeriesKey = null;
            if (want && openSeriesByKey(want, true)) return;
            notice('Seriál se nepodařilo otevřít. Zkus ho najít hledáním.', 'error');
        }

        function libPlay(i) {
            const e = libOrder[i];
            if (!e) return;
            if (e.item.skey) { openLibrarySeries(e.item.skey, e.item.title); return; }
            if (e.item.url) { playFromLibrary(e.item.url); return; }
            if (e.item.q) { goHome(); openFromCatalog(e.item.q); return; }
            notice('Tenhle titul nemá odkaz - zkus ho najít hledáním.', 'error');
        }

        function libDelFav(i) {
            const e = libOrder[i];
            if (!e || e.kind !== 'fav') return;
            favorites = favorites.filter(f => f.key !== e.item.key);
            saveFavorites();
            renderCatalog();   // hvězdičky na kartách katalogu musí odpovídat
            renderLibraryBody();
            notice('Odebráno z oblíbených');
        }

        function openLibrary() { openPage('library'); }
        window.openLibrary = openLibrary;
        window.libPlay = libPlay;
        window.libDelFav = libDelFav;

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

        // ===== Admin: /api/config (co je zrovna vypnuté) =====
        // Server to vynucuje sám (403/503); tenhle blok jen ukáže srozumitelnou hlášku
        // a schová tlačítko, které by stejně skončilo chybou. Když endpoint není
        // (PHP self-host bez adminu), tiše se nic neděje.
        (function adminConfig() {
            const banner = document.createElement('div');
            banner.id = 'adminBanner';
            banner.hidden = true;
            banner.style.cssText = 'position:fixed;left:0;right:0;top:0;z-index:9999;padding:10px 16px;'
                + 'font:14px/1.4 Helvetica,Arial,sans-serif;text-align:center;background:#b20710;color:#fff;'
                + 'box-shadow:0 2px 12px rgba(0,0,0,.6)';
            document.body.appendChild(banner);

            function apply(cfg) {
                if (!cfg || !cfg.success) return;

                // Proxy servery spravuje admin panel; seznam z /api/config přebíjí ten
                // z buildu, takže přidání/ubrání proxy platí bez nasazení.
                if (Array.isArray(cfg.proxies)) {
                    const live = cfg.proxies.filter(u => typeof u === 'string' && /^https?:\/\//i.test(u.trim()));
                    if (live.length || cfg.proxies.length === 0) DEFAULT_PROXY_SERVERS = live;
                }

                if (cfg.shutdown) {
                    banner.textContent = '⏻ Wflix je mimo provoz.';
                    banner.hidden = false;
                } else if (cfg.fullMaintenance) {
                    banner.textContent = '🔒 ' + (cfg.message || 'Wflix je dočasně uzamčený.');
                    banner.hidden = false;
                } else if (cfg.maintenance) {
                    banner.textContent = '🛠 ' + (cfg.message || 'Wflix je dočasně mimo provoz.');
                    banner.hidden = false;
                } else {
                    banner.hidden = true;
                }
                if (cfg.flags && cfg.flags.downloads === false) dlBtn.hidden = true;
            }

            fetch('/api/config', { cache: 'no-store' })
                .then(r => r.ok ? r.json() : null)
                .then(apply)
                .catch(() => { /* self-host bez /api/config */ });
        })();
