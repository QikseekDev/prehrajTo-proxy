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
    return new Function('norm', 'tokens', block + '\nreturn { parseEpisodeTitle, groupSearchResults, seriesMeta, czCount, episodeSpanCount };')(norm, tokens);
}

function loadSeriesPage() {
    const block = slice('        function seriesPageHtml(series) {', '        // Klik na epizodu', 'stránka seriálu');
    const parser = loadParser();
    const escapeHtml = str => String(str ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    return new Function('escapeHtml', 'czCount', 'seriesMeta', 'episodeSpanCount', block + '\nreturn { seriesPageHtml };')(escapeHtml, parser.czCount, parser.seriesMeta, parser.episodeSpanCount);
}

const { parseEpisodeTitle, groupSearchResults, seriesMeta, czCount } = loadParser();

// [název, base, sezóna, první díl, koncový díl (null = jeden díl)]
const parsed = [
    ['Mr. Robot S01E01', 'Mr. Robot', 1, 1, null],
    ['Mr. Robot - S01E02 CZ tit', 'Mr. Robot', 1, 2, null],
    ['Mr. Robot 1x03', 'Mr. Robot', 1, 3, null],
    ['Mr. Robot (2015) 1. série 2. díl', 'Mr. Robot', 1, 2, null],
    ['Mr. Robot 2. série - 1. díl CZ dabing', 'Mr. Robot', 2, 1, null],
    ['Rodina Sopránů S01E01 CZ tit', 'Rodina Sopránů', 1, 1, null],
    ['Pobřežní Hlídka - S01E01', 'Pobřežní Hlídka', 1, 1, null],
    ['Mr. Robot S01E01-E02', 'Mr. Robot', 1, 1, 2],
    ['Mr. Robot S02E02-12 2016 CZ dab - d2.0_odkr7ti2.tc', 'Mr. Robot', 2, 2, 12],
    ['Mr. Robot Epizoda 5', 'Mr. Robot', null, 5, null],
    ['Mr. Robot 3. díl', 'Mr. Robot', null, 3, null],
    ['Na vejšce (Off Campus) S01E01 CZ TITULKY.mkv', 'Na vejšce (Off Campus)', 1, 1, null],
    ['The Office US S02E06 1080p WEB-DL', 'The Office US', 2, 6, null],
    ['Mr.Robot.S01E05.1080p', 'Mr.Robot', 1, 5, null],
    ['Mr. Robot S1 E1', 'Mr. Robot', 1, 1, null],
    ['Mr. Robot Season 2 Episode 4', 'Mr. Robot', 2, 4, null],
];

test('parser rozpozná sezónu a díl z názvů', async t => {
    for (const [title, base, season, episode, episodeEnd] of parsed) {
        await t.test(title, () => {
            const got = parseEpisodeTitle(title);
            assert.ok(got, 'mělo se parsovat');
            assert.equal(got.base, base);
            assert.equal(got.season, season);
            assert.deepEqual(got.episodes, [episode]);
            assert.equal(got.episodeEnd, episodeEnd);
        });
    }
});

test('název pro řádek epizody je bez značky a bez názvu seriálu', () => {
    assert.equal(parseEpisodeTitle('Mr Robot S01E01 (1080p) CZ').name, '(1080p) CZ');
    assert.equal(parseEpisodeTitle('Mr.Robot S01E03 CZ Dab 1080p Full HD').name, 'CZ Dab 1080p Full HD');
    assert.equal(parseEpisodeTitle('Mr. Robot S02E02-12 2016 CZ dab - d2.0_odkr7ti2.tc').name, '2016 CZ dab - d2.0_odkr7ti2');
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

test('soubor S02E02-12 je jeden řádek, ne kopie pro každý díl', () => {
    const show = groupSearchResults([
        m('Mr. Robot S02E01', 'u1', '2016'),
        m('Mr. Robot S02E02-12 2016 CZ dab - d2.0_odkr7ti2.tc', 'u2', '2016'),
        m('Mr. Robot S02E02-12 2016 CZ dab - d2.0_odkr7ti2.tc', 'u2', '2016'),   // stejná URL
        m('Mr. Robot S02E03', 'u3', '2016'),
    ]).find(e => e.type === 'series').series;

    const season = show.seasons[0];
    assert.equal(season.episodes.length, 3, 'E01, kompilace E02-E12, E03');
    const pack = season.episodes.find(e => e.episodeEnd);
    assert.deepEqual({ episode: pack.episode, episodeEnd: pack.episodeEnd }, { episode: 2, episodeEnd: 12 });
    assert.equal(pack.variants.length, 1, 'duplicitní upload se nesmí přidat dvakrát');
    assert.equal(show.episodeCount, 12, 'pokryté díly: 1 + 2-12');
    assert.equal(season.episodes.filter(e => e.episodeEnd).length, 1, 'žádné rozkopírování');
});

test('jediná epizoda se neseskupuje', () => {
    const entries = groupSearchResults([m('Mr. Robot S01E01', 'u1')]);
    assert.deepEqual(entries.map(e => e.type), ['movie']);
});

test('číslování dílů česky', () => {
    assert.equal(czCount(1, 'díl', 'díly', 'dílů'), '1 díl');
    assert.equal(czCount(3, 'díl', 'díly', 'dílů'), '3 díly');
    assert.equal(czCount(9, 'díl', 'díly', 'dílů'), '9 dílů');
    assert.equal(czCount(2, 'soubor', 'soubory', 'souborů'), '2 soubory');
});

test('stránka seriálu: jedna řada na soubor, kompilace označená, escapování', () => {
    const { seriesPageHtml } = loadSeriesPage();
    const v = (title, url, name) => ({ title, url, thumbnail: '', year: '2015', name });
    const ep = (season, episode, variants, episodeEnd = null) => ({ season, episode, episodeEnd, variants });
    const series = {
        key: 'mr robot', title: 'Mr. Robot & <b>', year: '2015', poster: 'https://x/y.jpg?a=1&b=2',
        episodeCount: 13, seasonCount: 2,
        seasons: [
            {
                season: 1,
                episodes: [
                    ep(1, 1, [v('Mr. Robot S01E01 <b>&</b>', 'https://prehraj.to/a/1', '1080p CZ'), v('Mr. Robot S01E01 druhý zdroj', 'https://prehraj.to/b/2', 'CZ dab')]),
                    ep(1, 2, [v('Mr. Robot S01E02', 'https://prehraj.to/c/3', 'CZ dab')]),
                ],
            },
            { season: 2, episodes: [ep(2, 2, [v('Mr. Robot S02E02-12 CZ dab', 'https://prehraj.to/d/4', '2016 CZ dab')], 12)] },
        ],
    };

    const html = seriesPageHtml(series);
    assert.equal((html.match(/class="ep-row"/g) || []).length, 3);
    assert.equal((html.match(/class="ep-variant"/g) || []).length, 1, 'select jen u dílu s více zdroji');
    assert.match(html, /S01E01/);
    assert.match(html, /S02E02–E12/, 'kompilace má rozsah, ne jeden díl');
    assert.ok(!html.includes('S02E05'), 'kompilace se nesmí rozkopírovat na jednotlivé díly');
    assert.match(html, /soubor s více díly/);
    assert.match(html, /1\. série/);
    assert.match(html, /2 díly/);
    assert.match(html, /1 soubor · 11 dílů/, 'počet souborů vs. pokrytých dílů');
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
