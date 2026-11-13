import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const scriptPath = join(root, 'azure-app/PrehrajtoProxy/wwwroot/script.js');
const cssPath = join(root, 'azure-app/PrehrajtoProxy/wwwroot/styles.css');
const src = readFileSync(scriptPath, 'utf8');
const appPath = join(root, 'ipk/app/app.js');
const appSrc = readFileSync(appPath, 'utf8');

// Stejné skládání názvů jako norm()/tokens() v script.js - testy si je definují samy,
// aby nezávisely na zbytku prohlížečového kódu.
const norm = s => (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const tokens = str => norm(str).replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean);

function slice(startMarker, endMarker, what) {
    const start = src.indexOf(startMarker);
    const end = src.indexOf(endMarker, start + 1);
    if (start < 0 || end < 0) throw new Error(`blok "${what}" nenalezen v script.js`);
    return src.slice(start, end);
}

function loadParser() {
    const block = slice('// ===== Seriály =====', '        function saveThumbs() {', 'parser');
    return new Function('norm', 'tokens', block + '\nreturn { parseEpisodeTitle, groupSearchResults, mergeSeriesMovies, seriesMeta, czCount };')(norm, tokens);
}

function loadSeriesPage() {
    const block = slice('        function seriesPageHtml(', '        // Klik na epizodu', 'stránka seriálu');
    const parser = loadParser();
    const escapeHtml = str => String(str ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    return new Function('escapeHtml', 'czCount', 'seriesMeta', block + '\nreturn { seriesPageHtml };')(escapeHtml, parser.czCount, parser.seriesMeta);
}

// Klientská appka (ipk/app = webOS i APK) má vlastní kopii parseru; testy ji načtou
// ze stejných značek, aby se obě implementace nerozešly.
function appNormText(str) {
    return norm(str).replace(/[^a-z0-9]+/g, ' ').trim();
}

function loadAppParser() {
    const start = appSrc.indexOf('// ===== Seriály =====');
    const end = appSrc.indexOf('// ===== Konec seriálů =====', start + 1);
    if (start < 0 || end < 0) throw new Error('blok seriálů v ipk/app/app.js nenalezen');
    return new Function('normText', appSrc.slice(start, end)
        + '\nreturn { parseEpisodeTitle, groupSearchResults, seriesMeta };')(appNormText);
}

const { parseEpisodeTitle, groupSearchResults, mergeSeriesMovies, seriesMeta, czCount } = loadParser();

// [název, očekávaný seriál, sezóna, první díl, popisek = SxxExx bez čísla za pomlčkou]
const parsed = [
    ['Mr. Robot S01E01', 'Mr. Robot', 1, 1, 'S01E01'],
    ['Mr. Robot - S01E02 CZ tit', 'Mr. Robot', 1, 2, 'S01E02'],
    ['Mr. Robot 1x03', 'Mr. Robot', 1, 3, '1x03'],
    ['Mr. Robot (2015) 1. série 2. díl', 'Mr. Robot', 1, 2, 'S1E2'],
    ['Mr. Robot 2. série - 1. díl CZ dabing', 'Mr. Robot', 2, 1, 'S2E1'],
    ['Rodina Sopránů S01E01 CZ tit', 'Rodina Sopránů', 1, 1, 'S01E01'],
    ['Pobřežní Hlídka - S01E01', 'Pobřežní Hlídka', 1, 1, 'S01E01'],
    // číslo za pomlčkou není jiný díl ani konec rozsahu, je to pořád díl 2
    ['Mr. Robot S02E02-12 2016 CZ dab - d2.0_odkr7ti2.tc', 'Mr. Robot', 2, 2, 'S02E02'],
    ['Mr. Robot S01E04-09 CZ dab', 'Mr. Robot', 1, 4, 'S01E04'],
    ['Mr. Robot Epizoda 5', 'Mr. Robot', null, 5, 'Díl 5'],
    ['Mr. Robot 3. díl', 'Mr. Robot', null, 3, 'Díl 3'],
    ['Na vejšce (Off Campus) S01E01 CZ TITULKY.mkv', 'Na vejšce (Off Campus)', 1, 1, 'S01E01'],
    ['The Office US S02E06 1080p WEB-DL', 'The Office US', 2, 6, 'S02E06'],
    ['Mr.Robot.S01E05.1080p', 'Mr.Robot', 1, 5, 'S01E05'],
    ['Mr. Robot S1 E1', 'Mr. Robot', 1, 1, 'S1E1'],
    ['Mr. Robot Season 2 Episode 4', 'Mr. Robot', 2, 4, 'S2E4'],
];

test('parser si vezme jen číslo dílu ze značky SxxExx', async t => {
    for (const [title, base, season, episode, label] of parsed) {
        await t.test(title, () => {
            const got = parseEpisodeTitle(title);
            assert.ok(got, 'mělo se parsovat');
            assert.equal(got.base, base);
            assert.equal(got.season, season);
            assert.deepEqual(got.episodes, [episode]);
            assert.equal(got.label, label);
        });
    }
});

test('číslo před SxxExx ani za ním popisek nerozhodí', () => {
    assert.equal(parseEpisodeTitle('Mr. Robot 2016 S02E05 CZ').label, 'S02E05');
    assert.equal(parseEpisodeTitle('Mr. Robot S02E05 (1080p) 2016 CZ').label, 'S02E05');
    assert.equal(parseEpisodeTitle('Mr. Robot 2016 S02E05 1080p CZ').label, 'S02E05');
    assert.equal(parseEpisodeTitle('Mr. Robot 2016 S02E05 1080p CZ').name, '2016 1080p CZ');
});

test('název pro řádek epizody je bez značky a bez názvu seriálu', () => {
    assert.equal(parseEpisodeTitle('Mr Robot S01E01 (1080p) CZ').name, '(1080p) CZ');
    assert.equal(parseEpisodeTitle('Mr.Robot S01E03 CZ Dab 1080p Full HD').name, 'CZ Dab 1080p Full HD');
});

test('filmy a názvy bez epizody zůstanou kartou', () => {
    for (const title of ['Blade Runner 2049', 'Duna 2', 'Matrix', 'Part 1', 'CD1', 'Sicario 2', 'The 100', "Ocean's 11", '1920x1080']) {
        assert.equal(parseEpisodeTitle(title), null, `nemělo se parsovat: ${title}`);
    }
});

const m = (title, url, year = '2015') => ({ title, url, thumbnail: '', year });

test('seskupení slije epizody, dedupuje URL i stejné názvy a nechá filmy', () => {
    const movies = [
        m('Mr. Robot S01E01', 'https://prehraj.to/mr-robot-s01e01/1'),
        m('Mr. Robot S01E01 CZ dabing', 'https://prehraj.to/mr-robot-s01e01-cz/2'),
        m('Mr. Robot S01E01 CZ dabing', 'https://prehraj.to/mr-robot-s01e01-cz/2'),          // stejná URL
        m('Mr. Robot S01E01 CZ dabing', 'https://prehraj.to/mr-robot-s01e01-cz-druhy/22'),  // stejný název, jiná URL
        m('Mr. Robot S01E02', 'https://prehraj.to/mr-robot-s01e02/3'),
        m('Mr. Robot S02E01', 'https://prehraj.to/mr-robot-s02e01/4', '2016'),
        m('Matrix', 'https://prehraj.to/matrix/5', '1999'),
        m('Mr. Robot S01E03', 'https://prehraj.to/mr-robot-s01e03/6'),
    ];

    const entries = groupSearchResults(movies);
    const shows = entries.filter(e => e.type === 'series');
    const films = entries.filter(e => e.type === 'movie');
    assert.equal(shows.length, 1);
    assert.equal(films.length, 2, 'Matrix + nevybraná varianta dílu zůstane ve výsledcích');
    assert.ok(films.some(f => f.movie.title === 'Matrix'));
    assert.ok(films.some(f => f.movie.url === 'https://prehraj.to/mr-robot-s01e01-cz/2'),
        'druhý zdroj téhož dílu se nesmí zahodit');

    const show = shows[0].series;
    assert.equal(show.title, 'Mr. Robot');
    assert.equal(show.seasonCount, 2);
    assert.equal(show.episodeCount, 4);
    assert.deepEqual(show.seasons.map(s => s.season), [1, 2]);
    assert.equal(show.seasons[0].episodes.length, 3);
    assert.equal(show.seasons[0].episodes[0].variants.length, 1, 'v kartě seriálu zůstane nejlepší varianta');
    assert.equal(show.seasons[0].episodes[0].variants[0].url, 'https://prehraj.to/mr-robot-s01e01/1');
    assert.equal(seriesMeta(show), '2 série · 4 díly');
});

test('S02E02-12 je jen díl 2, ne rozsah ani kopie pro každý díl', () => {
    const entries = groupSearchResults([
        m('Mr. Robot S02E01', 'u1', '2016'),
        m('Mr. Robot S02E02-12 2016 CZ dab - d2.0_odkr7ti2.tc', 'u2', '2016'),
        m('Mr. Robot S02E02-12 2016 CZ dab - d2.0_odkr7ti2.tc', 'u2', '2016'),   // stejná URL
        m('Mr. Robot S02E02 ULTRA HD', 'u4', '2016'),                            // jiný zdroj téhož dílu
        m('Mr. Robot S02E03', 'u3', '2016'),
    ]);
    const show = entries.find(e => e.type === 'series').series;

    const season = show.seasons[0];
    assert.equal(season.episodes.length, 3, 'E01, E02, E03');
    assert.deepEqual(season.episodes.map(e => e.label), ['S02E01', 'S02E02', 'S02E03']);
    assert.equal(season.episodes[1].variants.length, 1, 'v kartě seriálu zůstane nejlepší varianta dílu 2');
    assert.ok(entries.some(e => e.type === 'movie' && e.movie.url === 'u4'),
        'další zdroj dílu 2 zůstane ve výsledcích hledání');
    assert.equal(show.episodeCount, 3, 'počítají se skutečné díly');
    assert.ok(!season.episodes.some(e => e.label === 'S02E12'), 'číslo za pomlčkou není díl');
    assert.ok(!season.episodes.some(e => e.label === 'S02E05'), 'žádné rozkopírování');
});

test('klientská appka parsuje díly stejně jako web', () => {
    const app = loadAppParser();
    for (const [title, base, season, episode, label] of parsed) {
        const got = app.parseEpisodeTitle(title);
        assert.ok(got, `appka neparsovala: ${title}`);
        assert.equal(got.base, base, title);
        assert.equal(got.season, season, title);
        assert.deepEqual(got.episodes, [episode], title);
        assert.equal(got.label, label, title);
    }
});

test('appka slije S01E02-09 s dílem 2 a neudělá z něj rozsah', () => {
    const app = loadAppParser();
    const mm = (title, url) => ({ title, url, thumbnail: '', year: '2025' });
    const entries = app.groupSearchResults([
        mm('TO Vítejte v Derry S01E01 CZ dabing 2025', 'a1'),
        mm('TO Vítejte v Derry S01E02 ULTRA HD KVALITA', 'a2'),
        mm('TO - Vítejte v Derry S01E03 2160p CZ SK Dabing', 'a3'),
        mm('TO - Vítejte v Derry S01E02-09 2025 CZ dabing 1080p FHD - Věc ve tmě', 'a4'),
    ]);
    const show = entries.find(e => e.type === 'series').series;
    const season = show.seasons[0];
    assert.deepEqual(season.episodes.map(e => e.label), ['S01E01', 'S01E02', 'S01E03']);
    assert.equal(season.episodes[1].variants.length, 1, 'v kartě seriálu zůstane nejlepší varianta dílu 2');
    assert.ok(entries.some(e => e.type === 'movie' && e.movie && e.movie.url === 'a4'),
        'upload s -09 je další zdroj dílu 2 a zůstane ve výsledcích hledání');
    assert.equal(app.seriesMeta(show), '1 série · 3 díly');
});

test('klient v APK assets je synchronní s ipk/app', () => {
    for (const f of ['app.js', 'index.html', 'styles.css', 'hls.min.js']) {
        const a = readFileSync(join(root, 'ipk/app', f));
        const b = readFileSync(join(root, 'apk/app/src/main/assets/www', f));
        assert.ok(a.equals(b), `${f} v apk/app/src/main/assets/www není kopie z ipk/app`);
    }
});

test('stránka 2+ přidá jen epizody stejného seriálu a zbytek ignoruje', () => {
    const page1 = [
        m('Mr. Robot S01E01', 'u1'),
        m('Mr. Robot S01E02', 'u2'),
    ];
    const show = groupSearchResults(page1).find(e => e.type === 'series').series;
    const page2 = [
        m('Mr. Robot S01E01', 'u1'),                       // už známá URL
        m('Mr. Robot S02E01', 'u9', '2016'),               // nová epizoda
        m('Mr. Robot S02E02-12 CZ dab', 'u10', '2016'),    // nový díl 2 (jiný upload)
        m('Duna 2', 'u5', '2024'),                         // jiný titul -> ignorovat
    ];

    const res = mergeSeriesMovies(show, page2);
    assert.equal(res.added, 2);
    assert.equal(res.addedMovies.length, 2);
    assert.deepEqual(res.series.seasons.map(s => s.season), [1, 2]);
    assert.equal(res.series.seasonCount, 2);
    assert.equal(res.series.episodeCount, 4, '2 řádky z první stránky + 2 z druhé');

    const again = mergeSeriesMovies(res.series, page2);
    assert.equal(again.added, 0, 'stejná stránka podruhé nic nepřidá');
    assert.equal(again.series.episodeCount, 4);
});

test('jediná epizoda se neseskupuje', () => {
    const entries = groupSearchResults([m('Mr. Robot S01E01', 'u1')]);
    assert.deepEqual(entries.map(e => e.type), ['movie']);
});

test('číslování dílů česky', () => {
    assert.equal(czCount(1, 'díl', 'díly', 'dílů'), '1 díl');
    assert.equal(czCount(3, 'díl', 'díly', 'dílů'), '3 díly');
    assert.equal(czCount(9, 'díl', 'díly', 'dílů'), '9 dílů');
});

test('stránka seriálu: popisek = číslo dílu, jedna řada na díl, escapování', () => {
    const { seriesPageHtml } = loadSeriesPage();
    const v = (title, url, name) => ({ title, url, thumbnail: '', year: '2015', name });
    const ep = (season, episode, label, variants) => ({ season, episode, label, variants });
    const series = {
        key: 'mr robot', title: 'Mr. Robot & <b>', year: '2015', poster: 'https://x/y.jpg?a=1&b=2',
        episodeCount: 3, seasonCount: 2,
        seasons: [
            {
                season: 1,
                episodes: [
                    ep(1, 1, 'S01E01', [v('Mr. Robot S01E01 <b>&</b>', 'https://prehraj.to/a/1', '1080p CZ'), v('Mr. Robot S01E01 druhý zdroj', 'https://prehraj.to/b/2', 'CZ dab')]),
                    ep(1, 2, 'S01E02', [v('Mr. Robot S01E02', 'https://prehraj.to/c/3', 'CZ dab')]),
                ],
            },
            { season: 2, episodes: [ep(2, 2, 'S02E02', [v('Mr. Robot S02E02-12 CZ dab', 'https://prehraj.to/d/4', '2016 CZ dab')])] },
        ],
    };

    const html = seriesPageHtml(series);
    assert.equal((html.match(/class="ep-row"/g) || []).length, 3);
    assert.equal((html.match(/class="ep-variant"/g) || []).length, 0, 'žádný výběr zdroje - jeden díl = jedno video');
    assert.match(html, /S01E01/);
    assert.match(html, /ep-num">Epizoda 2</, 'popisek je číslo dílu');
    assert.ok(!html.includes('S02E12'), 'číslo za pomlčkou není díl');
    assert.ok(!html.includes('S02E05'), 'soubor s více díly se nesmí rozkopírovat');
    assert.ok(!html.includes('ep-flag'), 'žádný štítek o více dílech');
    assert.match(html, /1\. série/);
    assert.match(html, /2 díly/);
    assert.match(html, /1 díl/);
    assert.match(html, /1080p CZ/, 'řádek používá očištěný název');
    assert.ok(!html.includes('<b>&</b>'), 'název musí být escapovaný');
    assert.match(html, /&lt;b&gt;&amp;&lt;\/b&gt;/);
    assert.match(html, /a=1&amp;b=2/, 'URL plakátu musí být escapovaná');
});

test('klientská appka má obrazovku seriálu a styly', () => {
    const html = readFileSync(join(root, 'ipk/app/index.html'), 'utf8');
    for (const id of ['series', 'seriesBg', 'seriesTitle', 'seriesMeta', 'seriesPoster', 'seriesBody', 'seriesNote', 'seriesClose']) {
        assert.ok(html.includes('id="' + id + '"'), `chybí #${id} v ipk/app/index.html`);
    }
    const css = readFileSync(join(root, 'ipk/app/styles.css'), 'utf8');
    let depth = 0;
    for (const ch of css) {
        if (ch === '{') depth++;
        else if (ch === '}') depth--;
        assert.ok(depth >= 0, 'CSS appky má uzavírací závorku navíc');
    }
    assert.equal(depth, 0, 'CSS appky nemá vyvážené závorky');
    for (const sel of ['.series-panel', '.series-body', '.ep-row', '.ep-src', '.ep-num']) {
        assert.ok(css.includes(sel), `chybí styl ${sel} v ipk/app/styles.css`);
    }
});

test('styly pro seriály existují a CSS je vyvážené', () => {
    const css = readFileSync(cssPath, 'utf8');
    let depth = 0;
    for (const ch of css) {
        if (ch === '{') depth++;
        else if (ch === '}') depth--;
        assert.ok(depth >= 0, 'CSS má uzavírací závorku navíc');
    }
    assert.equal(depth, 0, 'CSS nemá vyvážené závorky');
    for (const sel of ['.series-card', '.series-badge', '.ep-row', '.ep-play', '.ep-variant']) {
        assert.ok(css.includes(sel), `chybí styl ${sel}`);
    }
});

test('appka: živé vysílání nejde pozastavit', () => {
    assert.match(appSrc, /function liveLocked\(\)/);
    // klik do obrazu, tlačítko, klávesy i systémové pozastavení kontrolují zámek
    const uses = (appSrc.match(/liveLocked\(\)/g) || []).length;
    assert.ok(uses >= 6, 'liveLocked se používá u všech cest k pauze: ' + uses);
    assert.match(appSrc, /MediaPlayPause/);
    assert.match(appSrc, /pPlay'\)\.style\.display = kind === 'live'/);
});

test('appka: levý panel s kategoriemi a hledání s klávesnicí vedle výsledků', () => {
    const html = readFileSync(join(root, 'ipk/app/index.html'), 'utf8');
    const rail = html.slice(html.indexOf('id="rail"'), html.indexOf('</nav>'));
    for (const n of ['data-nav="search"', 'data-nav="home"', 'data-nav="live"', 'data-cat="České"', 'data-nav="settings"']) {
        assert.ok(rail.includes(n), 'v panelu chybí ' + n);
    }
    assert.ok(html.includes('id="skeys"') && html.includes('id="searchField"') && html.includes('id="searchHint"'));
    assert.match(appSrc, /function searchKey\(/);
    assert.match(appSrc, /function scheduleSearch\(/);
    const css = readFileSync(join(root, 'ipk/app/styles.css'), 'utf8');
    assert.match(css, /\.skeys\{/);
    assert.match(css, /body:not\(\.touch\) \.navbtn/);
});

// Franšízy bez SxxExx: "Spider-Man: Brand New Day" je jen název, žádné číslo dílu.
const franchise = [
    'SpiderMan Zbrusu nový den (2026) CZ DABING',
    'SpiderMan - Zbrusu nový den 2026 CZ DAB 2160p',   // jiný upload téhož filmu
    'Spiderman 2 (2004) 1080p, cz',
    'Spiderman 3 (2007) 1080p, cz',
    'Spiderman 2004 UHD CZ ned',                       // holý název + značka uploadera
    'Spiderman Daleko od domova CZ',
];

test('franšíza bez SxxExx se slije do jedné série a jde otevřít', () => {
    const entries = groupSearchResults(franchise.map((t, i) => m(t, 'f' + i, i === 5 ? '' : '')));
    assert.equal(entries.filter(e => e.type === 'series').length, 1, 'jedna karta pro celou sérii');
    assert.equal(entries.filter(e => e.type === 'movie').length, 1, 'nevybraná varianta filmu zůstane ve výsledcích');
    assert.ok(entries.some(e => e.type === 'movie' && e.movie.url === 'f1'),
        'druhý upload téhož filmu se nesmí zahodit');

    const show = entries.find(e => e.type === 'series').series;
    assert.equal(show.kind, 'collection');
    assert.equal(show.title, 'Spiderman');
    const rows = show.seasons[0].episodes;
    assert.deepEqual(rows.map(r => r.variants[0].name), [
        'Spiderman', 'Spiderman 2', 'Spiderman 3', 'Spiderman Daleko od domova', 'SpiderMan Zbrusu nový den',
    ]);
    assert.equal(rows[4].variants.length, 1, 'v kolekci zůstane nejlepší varianta filmu');
    assert.equal(seriesMeta(show), '5 filmů');
    assert.ok(rows.every(r => r.variants[0].url), 'každý řádek má video k přehrání');
});

test('kolekce bere číslo v názvu jako díl jen když je číslování celé', () => {
    const show = groupSearchResults([
        m('Bylo nás pět 1 Pěkné vysvědčení český seriál', 'b1', ''),
        m('Bylo nás pět 2 Andělíček policajt český seriál', 'b2', ''),
        m('Bylo nás pět 3 Vypouštění draka český seriál', 'b3', ''),
    ]).find(e => e.type === 'series').series;
    assert.equal(show.kind, 'collection');
    assert.equal(show.unit, 'dil');
    assert.deepEqual(show.seasons[0].episodes.map(e => e.label), ['Díl 1', 'Díl 2', 'Díl 3']);
    assert.equal(seriesMeta(show), '3 díly');
});

test('jeden film s více uploady zůstane kartami, ne sérií', () => {
    const entries = groupSearchResults([
        m('Matrix (1999)', 'm1', '1999'),
        m('Matrix 1999 CZ dabing', 'm2', '1999'),
    ]);
    assert.deepEqual(entries.map(e => e.type), ['movie', 'movie']);
});

test('kolekce dotáhne další filmy z druhé stránky a cizí tituly ignoruje', () => {
    const show = groupSearchResults([
        m('Spiderman 2 (2004) 1080p, cz', 'a1', '2004'),
        m('Spiderman 3 (2007) 1080p, cz', 'a2', '2007'),
    ]).find(e => e.type === 'series').series;

    const res = mergeSeriesMovies(show, [
        m('Spiderman Bez Domova 2021 2160p CZ Dabing SiC', 'a3', '2021'),
        m('Spiderman 3 (2007) 1080p, cz', 'a2', '2007'),   // už známá URL
        m('Duna 2', 'a4', '2024'),                         // jiný titul
    ]);
    assert.equal(res.added, 1);
    assert.equal(res.series.kind, 'collection');
    assert.equal(res.series.episodeCount, 3);
    assert.equal(res.series.seasonCount, 0, 'kolekce nemá série');
    assert.ok(res.series.seasons[0].episodes.some(e => e.variants[0].url === 'a3'));
    assert.ok(!res.series.seasons[0].episodes.some(e => e.variants[0].url === 'a4'));
});

test('klientská appka seskupí franšízu stejně jako web', () => {
    const app = loadAppParser();
    const asMovies = titles => titles.map((t, i) => ({ title: t, url: 'u' + i, thumbnail: '', year: '' }));
    const webShow = groupSearchResults(asMovies(franchise)).find(e => e.type === 'series').series;
    const appShow = app.groupSearchResults(asMovies(franchise)).find(e => e.type === 'series').series;

    assert.equal(appShow.title, webShow.title);
    assert.equal(appShow.kind, 'collection');
    assert.equal(appShow.episodeCount, webShow.episodeCount);
    assert.deepEqual(
        appShow.seasons[0].episodes.map(e => e.variants[0].name),
        webShow.seasons[0].episodes.map(e => e.variants[0].name));
    assert.equal(app.seriesMeta(appShow), seriesMeta(webShow));
});

test('stránka kolekce vypíše filmy s rokem, ne Epizoda N', () => {
    const { seriesPageHtml } = loadSeriesPage();
    const show = groupSearchResults([
        m('Spiderman 2 (2004) 1080p, cz', 'c1', '2004'),
        m('Spiderman Zbrusu nový den (2026) CZ DABING', 'c2', '2026'),
    ]).find(e => e.type === 'series').series;

    const html = seriesPageHtml(show);
    assert.equal((html.match(/class="ep-row"/g) || []).length, 2);
    assert.match(html, /Filmy/);
    assert.ok(!/Epizoda 1/.test(html));
    assert.match(html, /ep-num">2004</);
    assert.match(html, /Spiderman Zbrusu nový den/);
    assert.match(html, /Spiderman 2/);
});

test('diakritika a české slovo „seriál“ v názvu nerozbijí název série', () => {
    const show = groupSearchResults([
        m('žena za pultem 2 český seriál', 'z2', ''),
        m('žena za pultem 6 český seriál', 'z6', ''),
    ]).find(e => e.type === 'series').series;
    assert.equal(show.title, 'žena za pultem');
    assert.equal(show.unit, 'dil');
    assert.deepEqual(show.seasons[0].episodes.map(e => e.label), ['Díl 2', 'Díl 6']);
    assert.equal(seriesMeta(show), '2 díly');
});
