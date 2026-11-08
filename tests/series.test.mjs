import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const scriptPath = join(root, 'azure-app/PrehrajtoProxy/wwwroot/script.js');
const cssPath = join(root, 'azure-app/PrehrajtoProxy/wwwroot/styles.css');
const src = readFileSync(scriptPath, 'utf8');

// Normální odstranění diakritiky odpovídá norm() v script.js - testy si ho definují samy,
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
    return new Function('norm', 'tokens', block + '\nreturn { parseEpisodeTitle, groupSearchResults, seriesMeta, czCount };')(norm, tokens);
}

function loadSeriesPage() {
    const block = slice('        function seriesPageHtml(series) {', '        // Klik na epizodu', 'stránka seriálu');
    const parser = loadParser();
    const escapeHtml = str => String(str ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    return new Function('escapeHtml', 'czCount', 'seriesMeta', block + '\nreturn { seriesPageHtml };')(escapeHtml, parser.czCount, parser.seriesMeta);
}

const { parseEpisodeTitle, groupSearchResults, seriesMeta, czCount } = loadParser();

const parsed = [
    ['Mr. Robot S01E01', 'Mr. Robot', 1, [1]],
    ['Mr. Robot - S01E02 CZ tit', 'Mr. Robot', 1, [2]],
    ['Mr. Robot 1x03', 'Mr. Robot', 1, [3]],
    ['Mr. Robot (2015) 1. série 2. díl', 'Mr. Robot', 1, [2]],
    ['Mr. Robot 2. série - 1. díl CZ dabing', 'Mr. Robot', 2, [1]],
    ['Rodina Sopránů S01E01 CZ tit', 'Rodina Sopránů', 1, [1]],
    ['Pobřežní Hlídka - S01E01', 'Pobřežní Hlídka', 1, [1]],
    ['Mr. Robot S01E01-E02', 'Mr. Robot', 1, [1, 2]],
    ['Mr. Robot Epizoda 5', 'Mr. Robot', null, [5]],
    ['Mr. Robot 3. díl', 'Mr. Robot', null, [3]],
    ['Na vejšce (Off Campus) S01E01 CZ TITULKY.mkv', 'Na vejšce (Off Campus)', 1, [1]],
    ['The Office US S02E06 1080p WEB-DL', 'The Office US', 2, [6]],
    ['Mr.Robot.S01E05.1080p', 'Mr.Robot', 1, [5]],
    ['Mr. Robot S1 E1', 'Mr. Robot', 1, [1]],
    ['Mr. Robot Season 2 Episode 4', 'Mr. Robot', 2, [4]],
];

test('parser rozpozná sezónu a díl z názvů', async t => {
    for (const [title, base, season, episodes] of parsed) {
        await t.test(title, () => {
            assert.deepEqual(parseEpisodeTitle(title), { base, season, episodes });
        });
    }
});

test('filmy a názvy bez epizody zůstanou kartou', () => {
    for (const title of ['Blade Runner 2049', 'Duna 2', 'Matrix', 'Part 1', 'CD1', 'Sicario 2', 'The 100', "Ocean's 11", '1920x1080']) {
        assert.equal(parseEpisodeTitle(title), null, `nemělo se parsovat: ${title}`);
    }
});

test('seskupení slije epizody, dedupuje URL a nechá filmy', () => {
    const m = (title, url, year = '2015') => ({ title, url, thumbnail: '', year });
    const movies = [
        m('Mr. Robot S01E01', 'https://prehraj.to/mr-robot-s01e01/1'),
        m('Mr. Robot S01E01 CZ dabing', 'https://prehraj.to/mr-robot-s01e01-cz/2'),
        m('Mr. Robot S01E01 CZ dabing', 'https://prehraj.to/mr-robot-s01e01-cz/2'),   // stejná URL
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
    assert.equal(show.seasons[0].episodes[0].variants.length, 2, 'dva různé uploady dílu = varianty');
    assert.equal(seriesMeta(show), '2 série · 4 díly');
});

test('jediná epizoda se neseskupuje', () => {
    const entries = groupSearchResults([{ title: 'Mr. Robot S01E01', url: 'u1', thumbnail: '', year: '' }]);
    assert.deepEqual(entries.map(e => e.type), ['movie']);
});

test('číslování dílů česky', () => {
    assert.equal(czCount(1, 'díl', 'díly', 'dílů'), '1 díl');
    assert.equal(czCount(3, 'díl', 'díly', 'dílů'), '3 díly');
    assert.equal(czCount(9, 'díl', 'díly', 'dílů'), '9 dílů');
});

test('stránka seriálu: jedna řada na díl, escapování, výběr zdroje', () => {
    const { seriesPageHtml } = loadSeriesPage();
    const v = (title, url) => ({ title, url, thumbnail: '', year: '2015' });
    const ep = (season, episode, variants) => ({ season, episode, variants });
    const series = {
        key: 'mr robot', title: 'Mr. Robot & <b>', year: '2015', poster: 'https://x/y.jpg?a=1&b=2',
        episodeCount: 3, seasonCount: 2,
        seasons: [
            {
                season: 1,
                episodes: [
                    ep(1, 1, [v('Mr. Robot S01E01 <b>&</b>', 'https://prehraj.to/a/1'), v('Mr. Robot S01E01 CZ dabing', 'https://prehraj.to/b/2')]),
                    ep(1, 2, [v('Mr. Robot S01E02', 'https://prehraj.to/c/3')]),
                ],
            },
            { season: 2, episodes: [ep(2, 1, [v('Mr. Robot S02E01', 'https://prehraj.to/d/4')])] },
        ],
    };

    const html = seriesPageHtml(series);
    assert.equal((html.match(/class="ep-row"/g) || []).length, 3);
    assert.equal((html.match(/class="ep-variant"/g) || []).length, 1, 'select jen u dílu s více zdroji');
    assert.match(html, /S01E01/);
    assert.match(html, /S02E01/);
    assert.match(html, /1\. série/);
    assert.match(html, /2 série · 3 díly/);
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
    for (const sel of ['.series-card', '.series-badge', '.ep-row', '.ep-play', '.ep-variant']) {
        assert.ok(css.includes(sel), `chybí styl ${sel}`);
    }
});
