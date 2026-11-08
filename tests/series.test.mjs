import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const scriptPath = join(root, 'azure-app/PrehrajtoProxy/wwwroot/script.js');
const cssPath = join(root, 'azure-app/PrehrajtoProxy/wwwroot/styles.css');
const src = readFileSync(scriptPath, 'utf8');

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

const { parseEpisodeTitle, groupSearchResults, mergeSeriesMovies, seriesMeta, czCount } = loadParser();

// [název, očekávaný seriál, sezóna, první díl, popisek přesně z názvu]
const parsed = [
    ['Mr. Robot S01E01', 'Mr. Robot', 1, 1, 'S01E01'],
    ['Mr. Robot - S01E02 CZ tit', 'Mr. Robot', 1, 2, 'S01E02'],
    ['Mr. Robot 1x03', 'Mr. Robot', 1, 3, '1x03'],
    ['Mr. Robot (2015) 1. série 2. díl', 'Mr. Robot', 1, 2, 'S1E2'],
    ['Mr. Robot 2. série - 1. díl CZ dabing', 'Mr. Robot', 2, 1, 'S2E1'],
    ['Rodina Sopránů S01E01 CZ tit', 'Rodina Sopránů', 1, 1, 'S01E01'],
    ['Pobřežní Hlídka - S01E01', 'Pobřežní Hlídka', 1, 1, 'S01E01'],
    // tady je číslo za pomlčkou součástí názvu, ne "poslední díl"
    ['Mr. Robot S02E02-12 2016 CZ dab - d2.0_odkr7ti2.tc', 'Mr. Robot', 2, 2, 'S02E02-12'],
    ['Mr. Robot Epizoda 5', 'Mr. Robot', null, 5, 'Díl 5'],
    ['Mr. Robot 3. díl', 'Mr. Robot', null, 3, 'Díl 3'],
    ['Na vejšce (Off Campus) S01E01 CZ TITULKY.mkv', 'Na vejšce (Off Campus)', 1, 1, 'S01E01'],
    ['The Office US S02E06 1080p WEB-DL', 'The Office US', 2, 6, 'S02E06'],
    ['Mr.Robot.S01E05.1080p', 'Mr.Robot', 1, 5, 'S01E05'],
    ['Mr. Robot S1 E1', 'Mr. Robot', 1, 1, 'S1E1'],
    ['Mr. Robot Season 2 Episode 4', 'Mr. Robot', 2, 4, 'S2E4'],
];

test('parser vezme popisek přímo z názvu', async t => {
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
    assert.equal(films.length, 1);
    assert.equal(films[0].movie.title, 'Matrix');

    const show = shows[0].series;
    assert.equal(show.title, 'Mr. Robot');
    assert.equal(show.seasonCount, 2);
    assert.equal(show.episodeCount, 4);
    assert.deepEqual(show.seasons.map(s => s.season), [1, 2]);
    assert.equal(show.seasons[0].episodes.length, 3);
    assert.equal(show.seasons[0].episodes[0].variants.length, 2, 'dva různé zdroje = varianty');
    assert.equal(seriesMeta(show), '2 série · 4 díly');
});

test('S02E02-12 je jeden řádek s popiskem z názvu, ne kopie pro každý díl', () => {
    const show = groupSearchResults([
        m('Mr. Robot S02E01', 'u1', '2016'),
        m('Mr. Robot S02E02-12 2016 CZ dab - d2.0_odkr7ti2.tc', 'u2', '2016'),
        m('Mr. Robot S02E02-12 2016 CZ dab - d2.0_odkr7ti2.tc', 'u2', '2016'),   // stejná URL
        m('Mr. Robot S02E03', 'u3', '2016'),
    ]).find(e => e.type === 'series').series;

    const season = show.seasons[0];
    assert.equal(season.episodes.length, 3, 'E01, soubor E02-12, E03');
    const pack = season.episodes.find(e => e.label === 'S02E02-12');
    assert.ok(pack, 'popisek musí zůstat S02E02-12');
    assert.equal(pack.variants.length, 1, 'duplicitní upload se nesmí přidat dvakrát');
    assert.equal(show.episodeCount, 3, 'počítají se řádky, ne čísla za pomlčkou');
    assert.ok(!season.episodes.some(e => e.label === 'S02E05'), 'žádné rozkopírování');
    assert.equal(season.episodes[season.episodes.length - 1].label, 'S02E02-12', 'balík patří na konec sezóny');
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
        m('Mr. Robot S02E02-12 CZ dab', 'u10', '2016'),    // nový soubor s více díly
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

test('stránka seriálu: popisek z názvu, jedna řada na soubor, escapování', () => {
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
            { season: 2, episodes: [ep(2, 2, 'S02E02-12', [v('Mr. Robot S02E02-12 CZ dab', 'https://prehraj.to/d/4', '2016 CZ dab')])] },
        ],
    };

    const html = seriesPageHtml(series);
    assert.equal((html.match(/class="ep-row"/g) || []).length, 3);
    assert.equal((html.match(/class="ep-variant"/g) || []).length, 1, 'select jen u dílu s více zdroji');
    assert.match(html, /S01E01/);
    assert.match(html, /S02E02-12/, 'popisek přesně jako v názvu');
    assert.ok(!html.includes('S02E05'), 'soubor s více díly se nesmí rozkopírovat');
    assert.match(html, /soubor s více díly/);
    assert.match(html, /1\. série/);
    assert.match(html, /2 díly/);
    assert.match(html, /1 díl/);
    assert.match(html, /1080p CZ/, 'řádek používá očištěný název');
    assert.ok(!html.includes('<b>&</b>'), 'název musí být escapovaný');
    assert.match(html, /&lt;b&gt;&amp;&lt;\/b&gt;/);
    assert.match(html, /a=1&amp;b=2/, 'URL plakátu musí být escapovaná');
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
    for (const sel of ['.series-card', '.series-badge', '.ep-row', '.ep-play', '.ep-variant', '.ep-flag']) {
        assert.ok(css.includes(sel), `chybí styl ${sel}`);
    }
});
