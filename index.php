<?php
/**
 * Prehraj.to Proxy - extrahuje video URL a vyhledává filmy z české IP
 * Určeno pro tumarsrobot.unas.cz (Webzdarma.cz)
 */

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

// Handle preflight
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit;
}

/**
 * Chybová odpověď s pořádným HTTP kódem. Závod zdrojů (Azure Program.cs / router.php) bere
 * jen 2xx - odpověď s HTTP 200 + {"success":false} by přebila fungující zdroj a chyba jako
 * 429 by se nikdy nepřeskočila na další server. Kód z prehraj.to necháme plavat (429/403/...),
 * jinak dáme 502.
 */
function wflixFail($payload, $upstream = 0) {
    $code = ($upstream >= 400 && $upstream < 600) ? (int)$upstream : 502;
    http_response_code($code);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($payload, JSON_UNESCAPED_UNICODE);
    exit;
}

// Determine action: search, stream or get video
$action = isset($_GET['action']) ? $_GET['action'] : 'video';
$source = wflixSource(isset($_GET['source']) ? $_GET['source'] : 'prehrajto');

if ($action === 'search') {
    handleSearch($source);
} elseif ($action === 'thumb') {
    handleThumb();
} elseif ($action === 'purge') {
    handlePurge();
} elseif ($action === 'health') {
    handleHealth();
} elseif ($action === 'stream') {
    handleStream();
} else {
    handleVideo($source);
}

/**
 * Smazání cache na tomhle hostingu. Volá to admin panel (.NET backend) na každou proxy,
 * protože cache je v sys_get_temp_dir() a každý hosting má svou vlastní.
 *
 * Token se bere z prostředí (WFLIX_PURGE_TOKEN), nikdy z repa. Když nastavený není, purge
 * zůstane vypnutý - je to jen cache, ale i tak to nemá být otevřené komukoli.
 */
function handlePurge() {
    $expected = getenv('WFLIX_PURGE_TOKEN');
    $given = isset($_GET['token']) ? (string)$_GET['token'] : '';
    if (!$expected) {
        wflixFail(['success' => false, 'error' => 'Purge je na téhle proxy vypnutý (chybí WFLIX_PURGE_TOKEN).'], 403);
    }
    if ($given === '' || !hash_equals($expected, $given)) {
        wflixFail(['success' => false, 'error' => 'Neplatný token.'], 403);
    }

    $scope = isset($_GET['scope']) ? strtolower(trim((string)$_GET['scope'])) : 'all';
    if (!in_array($scope, ['all', 'search', 'thumb'], true)) $scope = 'all';

    $purged = 0;
    if ($scope === 'all' || $scope === 'search') $purged += wflixPurgeDir(sys_get_temp_dir() . '/wflix-search');
    if ($scope === 'all' || $scope === 'thumb') $purged += wflixPurgeDir(sys_get_temp_dir() . '/wflix-thumbs');

    header('Cache-Control: no-store, max-age=0');
    echo json_encode(['success' => true, 'scope' => $scope, 'purged' => $purged], JSON_UNESCAPED_UNICODE);
    exit;
}

function wflixPurgeDir($dir) {
    if (!is_dir($dir)) return 0;
    $items = @scandir($dir);
    if (!is_array($items)) return 0;
    $count = 0;
    foreach ($items as $item) {
        if ($item === '.' || $item === '..') continue;
        $path = $dir . DIRECTORY_SEPARATOR . $item;
        if (is_file($path) && @unlink($path)) $count++;
    }
    return $count;
}

function wflixSource($s) {
    $s = strtolower(trim((string)$s));
    $map = [
        'prehraj' => 'prehrajto', 'prehrajto' => 'prehrajto', 'prehraj.to' => 'prehrajto',
        'bombuj' => 'bombuj', 'bombuj.si' => 'bombuj',
        'sledujteto' => 'sledujteto', 'sledujteto.cz' => 'sledujteto', 'old.sledujteto.cz' => 'sledujteto',
        'hellspy' => 'hellspy', 'hellspy.to' => 'hellspy',
        'fastshare' => 'fastshare', 'fastshare.cz' => 'fastshare', 'fastshare.cloud' => 'fastshare',
        'sdilej' => 'sdilej', 'sdilej.cz' => 'sdilej',
        'all' => 'all', 'merge' => 'all', 'both' => 'all', 'prehrajto+sledujteto' => 'all',
    ];
    return isset($map[$s]) ? $map[$s] : 'prehrajto';
}

function wflixAllowedSourceUrl($source, $url) {
    $host = strtolower((string)parse_url((string)$url, PHP_URL_HOST));
    $scheme = strtolower((string)parse_url((string)$url, PHP_URL_SCHEME));
    if (!in_array($scheme, ['http', 'https'], true) || $host === '') return false;
    if ($source === 'prehrajto') return $host === 'prehraj.to' || substr($host, -11) === '.prehraj.to';
    if ($source === 'bombuj') return $host === 'bombuj.si' || substr($host, -9) === '.bombuj.si';
    if ($source === 'sledujteto') return $host === 'sledujteto.cz' || substr($host, -14) === '.sledujteto.cz';
    if ($source === 'hellspy') return $host === 'hellspy.to' || substr($host, -11) === '.hellspy.to';
    if ($source === 'fastshare') return $host === 'fastshare.cz' || substr($host, -13) === '.fastshare.cz' || $host === 'fastshare.cloud' || substr($host, -16) === '.fastshare.cloud';
    if ($source === 'sdilej') return $host === 'sdilej.cz' || substr($host, -10) === '.sdilej.cz';
    return false;
}

/**
 * Cíl přesměrování bez jeho následování. HellSpy vydává odkaz na soubor právě takhle:
 * gw/video/<id>/<hash>/download odpoví 302 na podepsanou CDN adresu.
 */
function wflixRedirectUrl($url, $timeout = 25) {
    $ch = curl_init();
    curl_setopt_array($ch, [
        CURLOPT_URL => $url,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_FOLLOWLOCATION => false,
        CURLOPT_TIMEOUT => $timeout,
        CURLOPT_CONNECTTIMEOUT => 10,
        CURLOPT_USERAGENT => 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        CURLOPT_SSL_VERIFYPEER => false,
    ]);
    curl_exec($ch);
    $loc = (string) curl_getinfo($ch, CURLINFO_REDIRECT_URL);
    curl_close($ch);
    $loc = trim($loc);
    return ($loc === '' || !preg_match('#^https?://#i', $loc)) ? null : $loc;
}

function wflixHttpGet($url, $timeout = 30, $headers = []) {
    $ch = curl_init();
    $base = [
        'Accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language: cs-CZ,cs;q=0.9,sk;q=0.8,en;q=0.5',
    ];
    curl_setopt_array($ch, [
        CURLOPT_URL => $url,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_USERAGENT => 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        CURLOPT_SSL_VERIFYPEER => false,
        CURLOPT_TIMEOUT => $timeout,
        CURLOPT_HTTPHEADER => array_merge($base, $headers),
        CURLOPT_ENCODING => '',
    ]);
    $body = curl_exec($ch);
    $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $err = curl_error($ch);
    curl_close($ch);

    if (wflixLooksBlocked($code, $body)) {
        $solved = wflixFlareSolverrGet($url, $timeout);
        if ($solved !== null && $solved[0] >= 200 && $solved[0] < 400 && $solved[1] !== '') {
            return [$solved[0], $solved[1], ''];
        }
    }

    return [$code, is_string($body) ? $body : '', $err];
}

function wflixHttpPost($url, $data, $timeout = 30, $headers = []) {
    $ch = curl_init();
    $base = [
        'Accept: */*',
        'Accept-Language: cs-CZ,cs;q=0.9,sk;q=0.8,en;q=0.5',
        'Content-Type: application/x-www-form-urlencoded',
    ];
    curl_setopt_array($ch, [
        CURLOPT_URL => $url,
        CURLOPT_POST => true,
        CURLOPT_POSTFIELDS => http_build_query($data),
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_USERAGENT => 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        CURLOPT_SSL_VERIFYPEER => false,
        CURLOPT_TIMEOUT => $timeout,
        CURLOPT_HTTPHEADER => array_merge($base, $headers),
        CURLOPT_ENCODING => '',
    ]);
    $body = curl_exec($ch);
    $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $err = curl_error($ch);
    curl_close($ch);
    return [$code, is_string($body) ? $body : '', $err];
}

// FlareSolverr (github.com/FlareSolverr/FlareSolverr, MIT) je samostatná služba, která
// stránku načte skutečným prohlížečem a vrátí její HTML. Používá se jen jako fallback,
// když zdroj odpoví Cloudflare výzvou (403/503 nebo "Just a moment"), takže běžné
// požadavky to nezdrží. Zapíná se přes FLARESOLVERR_URL (např. http://127.0.0.1:8191).
function wflixFlareSolverrUrl() {
    $url = getenv('FLARESOLVERR_URL');
    return is_string($url) ? rtrim(trim($url), '/') : '';
}

function wflixLooksBlocked($code, $body) {
    if ($code === 403 || $code === 503) return true;
    $b = is_string($body) ? $body : '';
    return stripos($b, 'Just a moment') !== false
        || stripos($b, 'cf-challenge') !== false
        || stripos($b, 'Attention Required! | Cloudflare') !== false;
}

// Vrací [kód, html] nebo null, když FlareSolverr není nastavený nebo selhal.
function wflixFlareSolverrGet($url, $timeout = 45) {
    $base = wflixFlareSolverrUrl();
    if ($base === '' || !function_exists('curl_init')) return null;

    $ch = curl_init($base . '/v1');
    curl_setopt_array($ch, [
        CURLOPT_POST => true,
        CURLOPT_POSTFIELDS => json_encode([
            'cmd' => 'request.get',
            'url' => $url,
            'maxTimeout' => max(5000, ((int)$timeout) * 1000),
        ]),
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => ((int)$timeout) + 10,
        CURLOPT_HTTPHEADER => ['Content-Type: application/json'],
    ]);
    $raw = curl_exec($ch);
    $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    if ($code < 200 || $code >= 300 || !is_string($raw)) return null;
    $json = json_decode($raw, true);
    if (!is_array($json) || (isset($json['status']) ? $json['status'] : '') !== 'ok') return null;
    $solution = isset($json['solution']) && is_array($json['solution']) ? $json['solution'] : null;
    if ($solution === null || !isset($solution['response'])) return null;

    return [(int)(isset($solution['status']) ? $solution['status'] : 0), (string)$solution['response']];
}

function wflixFixUrl($url, $baseHost) {
    $url = html_entity_decode((string)$url, ENT_QUOTES, 'UTF-8');
    if ($url === '') return '';
    if (strpos($url, '//') === 0) return 'https:' . $url;
    if ($url[0] === '/') return 'https://' . $baseHost . $url;
    if (preg_match('#^https?://#i', $url)) return $url;
    return 'https://' . $baseHost . '/' . ltrim($url, '/');
}

function searchBombuj($query) {
    list($hc, $home, $he) = wflixHttpGet('https://www.bombuj.si/uvod.php', 20, ['Referer: https://www.bombuj.si/']);
    if ($hc < 200 || $hc >= 300 || $home === '') return ['error' => 'Bombuj: nelze načíst vyhledávání' . ($he ? ' (' . $he . ')' : ''), 'status' => $hc, 'movies' => []];
    $endpoint = 'https://www.bombuj.si/4154q37rpc4dsvbp.php';
    if (preg_match('#xhr\.open\(\s*[\'"]POST[\'"]\s*,\s*[\'"](//www\.bombuj\.si/[^\'\"]+\.php)[\'"]#i', $home, $m)) {
        $endpoint = wflixFixUrl($m[1], 'www.bombuj.si');
    }
    list($sc, $html, $se) = wflixHttpPost($endpoint, ['queryString' => $query], 25, [
        'Referer: https://www.bombuj.si/uvod.php',
        'X-Requested-With: XMLHttpRequest',
        'Origin: https://www.bombuj.si',
    ]);
    if ($se) return ['error' => 'Bombuj: ' . $se, 'status' => 0, 'movies' => []];
    if ($sc < 200 || $sc >= 300) return ['error' => 'Bombuj HTTP: ' . $sc, 'status' => $sc, 'movies' => []];
    $movies = []; $seen = [];
    if (preg_match_all('#<a\s+href="(//www\.bombuj\.si/online-film[^"]+)"[^>]*>.*?<span class="nazov">([^<]+)</span>.*?(?:<img[^>]+src="([^"]+)")?#is', $html, $ms, PREG_SET_ORDER)) {
        foreach ($ms as $m) {
            $u = wflixFixUrl($m[1], 'www.bombuj.si');
            if (isset($seen[$u])) continue; $seen[$u] = true;
            $title = trim(html_entity_decode($m[2], ENT_QUOTES, 'UTF-8'));
            $year = '';
            if (preg_match('/\((\d{4})\)\s*$/u', $title, $ym)) $year = $ym[1];
            $thumb = isset($m[3]) ? wflixFixUrl($m[3], 'www.bombuj.si') : '';
            $movies[] = ['url' => $u, 'title' => $title, 'thumbnail' => $thumb, 'year' => $year, 'source' => 'bombuj'];
        }
    }
    if (empty($movies) && preg_match_all('#href="(//www\.bombuj\.si/online-film[^"]+)"#i', $html, $ls)) {
        foreach (array_unique($ls[1]) as $u) {
            $u = wflixFixUrl($u, 'www.bombuj.si');
            $slug = preg_replace('#^.*/online-film-#', '', $u);
            $title = trim(ucwords(str_replace('-', ' ', $slug)));
            $movies[] = ['url' => $u, 'title' => $title, 'thumbnail' => '', 'year' => '', 'source' => 'bombuj'];
            if (count($movies) >= 30) break;
        }
    }
    return ['error' => null, 'movies' => array_slice($movies, 0, 30)];
}

function wflixDedupMovies($movies) {
    $out = []; $seen = [];
    foreach ((array)$movies as $m) {
        if (!is_array($m)) continue;
        $url = isset($m['url']) ? (string)$m['url'] : '';
        $title = isset($m['title']) ? (string)$m['title'] : '';
        $normTitle = preg_replace('/\s+/u', ' ', wflixNorm(preg_replace('/\(\d{4}\)\s*$/u', '', $title)));
        $key = $url !== '' ? ('u:' . preg_replace('#^https?://#i', '', rtrim(strtolower($url), '/'))) : ('t:' . $normTitle);
        if ($key === 'u:' || $key === 't:') $key = 't:' . $normTitle . '|' . (isset($m['year']) ? $m['year'] : '');
        if (isset($seen[$key])) continue;
        // also dedup by normalized title when URLs differ across sources
        if ($normTitle !== '' && isset($seen['t:' . $normTitle])) continue;
        $seen[$key] = true;
        if ($normTitle !== '') $seen['t:' . $normTitle] = true;
        $out[] = $m;
    }
    return $out;
}

function sledujtetoApis($query, $page = 1) {
    $page = max(1, (int)$page);
    return [
        ['url' => 'https://www.sledujteto.cz/api/web/videos?query=' . rawurlencode($query) . '&limit=30&page=' . $page . '&sort=relevance', 'host' => 'www.sledujteto.cz'],
        ['url' => 'https://sledujteto.cz/api/web/videos?query=' . rawurlencode($query) . '&limit=30&page=' . $page . '&sort=relevance', 'host' => 'sledujteto.cz'],
        ['url' => 'https://old.sledujteto.cz/api/web/videos?query=' . rawurlencode($query) . '&limit=30&page=' . $page . '&sort=relevance', 'host' => 'old.sledujteto.cz'],
    ];
}

function parseSledujtetoApiResponse($body, $host) {
    $d = json_decode((string)$body, true);
    if (!is_array($d)) return ['error' => 'Sledujteto: neplatná odpověď', 'movies' => []];
    $files = isset($d['data']['files']) && is_array($d['data']['files']) ? $d['data']['files'] : (isset($d['files']) && is_array($d['files']) ? $d['files'] : []);
    $movies = [];
    foreach ($files as $f) {
        if (!is_array($f)) continue;
        $id = isset($f['id']) ? $f['id'] : (isset($f['file_id']) ? $f['file_id'] : (isset($f['files_id']) ? $f['files_id'] : ''));
        $title = isset($f['filename']) ? $f['filename'] : (isset($f['name']) ? $f['name'] : (isset($f['title']) ? $f['title'] : ''));
        $title = trim(html_entity_decode((string)$title, ENT_QUOTES, 'UTF-8'));
        $url = '';
        foreach (['url', 'link', 'permalink', 'href'] as $k) if (!empty($f[$k])) { $url = wflixFixUrl($f[$k], $host); break; }
        if ($url === '' && $id !== '') $url = 'https://' . $host . '/video/' . rawurlencode((string)$id);
        if ($url === '' || $title === '') continue;
        $thumb = '';
        foreach (['thumb', 'thumbnail', 'image', 'poster', 'img', 'preview', 'cover'] as $k) if (!empty($f[$k])) { $thumb = wflixFixUrl($f[$k], $host); break; }
        $year = '';
        if (preg_match('/[-(](\d{4})[)-]/u', $title, $ym)) $year = $ym[1];
        $movies[] = ['url' => $url, 'title' => $title, 'thumbnail' => $thumb, 'year' => $year, 'source' => 'sledujteto'];
        if (count($movies) >= 30) break;
    }
    return ['error' => null, 'movies' => $movies];
}

function searchSledujteto($query, $page = 1) {
    $page = max(1, (int)$page);
    // Primary/backup API endpoints (must be called from Czech IP in production; PHP proxy handles that).
    $apis = sledujtetoApis($query, $page);
    $lastErr = 'Sledujteto: žádná odpověď'; $lastStatus = 0;
    foreach ($apis as $api) {
        list($c, $body, $e) = wflixHttpGet($api['url'], 25, [
            'Accept: application/json, text/plain, */*',
            'X-Requested-With: XMLHttpRequest',
            'Referer: https://' . $api['host'] . '/vyhledat/?search=' . rawurlencode($query) . '&page=' . $page,
            'Origin: https://' . $api['host'],
        ]);
        if ($e) { $lastErr = 'Sledujteto: ' . $e; $lastStatus = 0; continue; }
        if ($c < 200 || $c >= 300) { $lastErr = 'Sledujteto HTTP: ' . $c; $lastStatus = $c; continue; }
        $parsed = parseSledujtetoApiResponse($body, $api['host']);
        if (!empty($parsed['movies'])) return ['error' => null, 'movies' => $parsed['movies'], 'endpoint' => $api['url']];
        $lastErr = null; $lastStatus = $c; // successful but empty: try other bases
    }
    return ['error' => $lastErr, 'status' => $lastStatus, 'movies' => []];
}

// Experimental: "Více výsledků" merge mode. Fetches supported sources in parallel/bounded
// fashion and deduplicates. Individual source failures are ignored; an error is returned only
// when all sources fail or produce no usable results.
/**
 * HellSpy - veřejné rozhraní api.hellspy.to/gw/ (bez účtu a bez tokenu). Berou se jen
 * objekty typu GWSearchVideo; odkaz na soubor je přesměrování na podepsanou CDN adresu,
 * takže skutečná URL se dohrává až v resolveSourceVideo().
 */
function parseHellspyBody($body) {
    $d = json_decode((string)$body, true);
    if (!is_array($d)) return ['error' => 'HellSpy: neplatná odpověď', 'movies' => []];
    $items = isset($d['items']) && is_array($d['items']) ? $d['items'] : [];
    $movies = [];
    foreach ($items as $it) {
        if (!is_array($it)) continue;
        if (isset($it['objectType']) && $it['objectType'] !== 'GWSearchVideo') continue;
        $hash = isset($it['fileHash']) ? trim((string)$it['fileHash']) : '';
        $id = isset($it['id']) ? trim((string)$it['id']) : '';
        if ($hash === '' || $id === '') continue;
        $title = trim(html_entity_decode((string)(isset($it['title']) ? $it['title'] : ''), ENT_QUOTES, 'UTF-8'));
        if ($title === '') continue;
        $thumb = '';
        if (!empty($it['thumbs']) && is_array($it['thumbs'])) {
            foreach ($it['thumbs'] as $t) {
                if (is_string($t) && $t !== '') { $thumb = $t; break; }
            }
        }
        $year = '';
        if (preg_match('/[-(](\d{4})[)-]/u', $title, $ym)) $year = $ym[1];
        $movies[] = [
            'url' => 'https://api.hellspy.to/gw/video/' . rawurlencode($id) . '/' . rawurlencode($hash) . '/download',
            'title' => $title,
            'thumbnail' => $thumb,
            'year' => $year,
            'source' => 'hellspy',
        ];
        if (count($movies) >= 30) break;
    }
    return ['error' => null, 'movies' => $movies];
}

function searchHellspy($query, $page = 1) {
    $limit = 40;
    $offset = (max(1, (int)$page) - 1) * $limit;
    $url = 'https://api.hellspy.to/gw/search?query=' . rawurlencode($query) . '&limit=' . $limit . '&offset=' . $offset;
    list($c, $body, $e) = wflixHttpGet($url, 15, ['Accept: application/json']);
    if ($e) return ['error' => 'HellSpy: ' . $e, 'movies' => []];
    if ($c === 429) return ['error' => 'HellSpy: dočasně omezuje požadavky (HTTP 429)', 'status' => 429, 'movies' => []];
    if ($c < 200 || $c >= 300) return ['error' => 'HellSpy HTTP: ' . $c, 'status' => $c, 'movies' => []];
    return parseHellspyBody($body);
}

/**
 * FastShare a Sdilej.cz - stejné `api_kodi.php` a stejný katalog pod dvěma značkami.
 * Hledání je veřejné (bez účtu), stahování může účet vyžadovat. `download_url` vede
 * přímo na soubor (fastshare: *.fastshare.cloud, sdilej: sdilej_profi.php), takže
 * resolveSourceVideo() nic dalšího scrapovat nemusí.
 */
function fastshareSearchUrl($query, $page, $provider) {
    $host = ($provider === 'sdilej') ? 'sdilej.cz' : 'fastshare.cz';
    return 'https://' . $host . '/api/api_kodi.php?process=search&term=' . rawurlencode($query)
        . '&pagination=' . max(1, (int)$page) . '&adult=false';
}

function parseFastshareBody($body, $provider) {
    $d = json_decode((string)$body, true);
    if (!is_array($d)) return ['error' => wflixSourceLabel($provider) . ': neplatná odpověď', 'movies' => []];
    $files = (isset($d['search']['file']) && is_array($d['search']['file'])) ? $d['search']['file'] : [];
    $movies = [];
    foreach ($files as $f) {
        if (!is_array($f)) continue;
        $url = isset($f['download_url']) ? trim((string)$f['download_url']) : '';
        $title = isset($f['filename']) ? trim(html_entity_decode((string)$f['filename'], ENT_QUOTES, 'UTF-8')) : '';
        if ($url === '' || $title === '') continue;
        $title = preg_replace('/\.(mp4|mkv|avi|wmv|mov|m4v|mpg|mpeg|ts|rar|zip)$/i', '', $title);
        $title = trim(preg_replace('/\s+/u', ' ', str_replace(['.', '_'], ' ', (string)$title)));
        if ($title === '') continue;
        $year = '';
        if (preg_match('/[-(](\d{4})[)-]/u', $title, $ym)) $year = $ym[1];
        $movies[] = [
            'url' => $url,
            'title' => $title,
            'thumbnail' => isset($f['thumbnail']) ? trim((string)$f['thumbnail']) : '',
            'year' => $year,
            'source' => $provider,
        ];
        if (count($movies) >= 30) break;
    }
    return ['error' => null, 'movies' => $movies];
}

function wflixSourceLabel($source) {
    $labels = ['prehrajto' => 'Prehraj.to', 'sledujteto' => 'Sledujteto', 'bombuj' => 'Bombuj', 'hellspy' => 'HellSpy', 'fastshare' => 'FastShare', 'sdilej' => 'Sdilej.cz'];
    return isset($labels[$source]) ? $labels[$source] : $source;
}

function searchFastshare($query, $page = 1, $provider = 'fastshare') {
    $host = ($provider === 'sdilej') ? 'sdilej.cz' : 'fastshare.cz';
    list($c, $body, $e) = wflixHttpGet(fastshareSearchUrl($query, $page, $provider), 15, [
        'Accept: application/json, text/plain, */*',
        'Referer: https://' . $host . '/',
    ]);
    if ($e) return ['error' => wflixSourceLabel($provider) . ': ' . $e, 'movies' => []];
    if ($c < 200 || $c >= 300) return ['error' => wflixSourceLabel($provider) . ' HTTP: ' . $c, 'status' => $c, 'movies' => []];
    return parseFastshareBody($body, $provider);
}

function searchAll($query, $page = 1) {
    $page = max(1, (int)$page);
    $apis = sledujtetoApis($query, $page);
    $st = $apis[0];
    $prehrajUrl = 'https://prehraj.to/hledej/' . rawurlencode($query);
    if ($page > 1) $prehrajUrl .= '?videoListing-visualPaginator-page=' . (int)$page;
    $ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

    // Admin posílá u source=all seznam povolených zdrojů (only=...), aby vypnutý zdroj
    // nepřispíval do sloučených výsledků. Bez seznamu jedou všechny.
    $onlyParam = isset($_GET['only']) ? strtolower((string)$_GET['only']) : '';
    $onlyList = $onlyParam === '' ? [] : array_values(array_filter(array_map('trim', explode(',', $onlyParam))));
    $wantSource = function ($key) use ($onlyList) {
        return empty($onlyList) || in_array($key, $onlyList, true);
    };

    $mh = curl_multi_init();
    $ch1 = curl_init($prehrajUrl);
    curl_setopt_array($ch1, [
        CURLOPT_RETURNTRANSFER => true, CURLOPT_FOLLOWLOCATION => true, CURLOPT_TIMEOUT => 25,
        CURLOPT_USERAGENT => $ua, CURLOPT_SSL_VERIFYPEER => false,
        CURLOPT_HTTPHEADER => ['Accept-Language: cs-CZ,cs;q=0.9,en;q=0.5'],
    ]);
    $ch2 = curl_init($st['url']);
    curl_setopt_array($ch2, [
        CURLOPT_RETURNTRANSFER => true, CURLOPT_FOLLOWLOCATION => true, CURLOPT_TIMEOUT => 20,
        CURLOPT_USERAGENT => $ua, CURLOPT_SSL_VERIFYPEER => false,
        CURLOPT_HTTPHEADER => [
            'Accept: application/json, text/plain, */*',
            'Accept-Language: cs-CZ,cs;q=0.9,sk;q=0.8,en;q=0.5',
            'X-Requested-With: XMLHttpRequest',
            'Referer: https://' . $st['host'] . '/vyhledat/?search=' . rawurlencode($query) . '&page=' . $page,
            'Origin: https://' . $st['host'],
        ],
    ]);
    $ch3 = curl_init('https://www.bombuj.si/uvod.php');
    curl_setopt_array($ch3, [
        CURLOPT_RETURNTRANSFER => true, CURLOPT_FOLLOWLOCATION => true, CURLOPT_TIMEOUT => 20,
        CURLOPT_USERAGENT => $ua, CURLOPT_SSL_VERIFYPEER => false,
        CURLOPT_HTTPHEADER => ['Accept-Language: cs-CZ,cs;q=0.9,sk;q=0.8,en;q=0.5'],
    ]);
    // Vrstva jedna: veřejná JSON rozhraní dalších katalogů. Bez účtu, takže jdou vždy.
    $extra = [
        'hellspy' => 'https://api.hellspy.to/gw/search?query=' . rawurlencode($query) . '&limit=40',
        'fastshare' => fastshareSearchUrl($query, $page, 'fastshare'),
        'sdilej' => fastshareSearchUrl($query, $page, 'sdilej'),
    ];
    $extraHandles = [];
    foreach ($extra as $key => $extraUrl) {
        $chx = curl_init($extraUrl);
        curl_setopt_array($chx, [
            CURLOPT_RETURNTRANSFER => true, CURLOPT_FOLLOWLOCATION => true, CURLOPT_TIMEOUT => 15,
            CURLOPT_USERAGENT => $ua, CURLOPT_SSL_VERIFYPEER => false,
            CURLOPT_HTTPHEADER => ['Accept: application/json, text/plain, */*', 'Accept-Language: cs-CZ,cs;q=0.9,sk;q=0.8,en;q=0.5'],
        ]);
        curl_multi_add_handle($mh, $chx);
        $extraHandles[$key] = $chx;
    }
    curl_multi_add_handle($mh, $ch1);
    curl_multi_add_handle($mh, $ch2);
    curl_multi_add_handle($mh, $ch3);
    do { curl_multi_exec($mh, $running); if ($running) curl_multi_select($mh, 0.2); } while ($running > 0);
    $prehrajBody = curl_multi_getcontent($ch1); $prehrajCode = (int)curl_getinfo($ch1, CURLINFO_HTTP_CODE); $prehrajErr = curl_error($ch1);
    $stBody = curl_multi_getcontent($ch2); $stCode = (int)curl_getinfo($ch2, CURLINFO_HTTP_CODE); $stErr = curl_error($ch2);
    $bombujHome = curl_multi_getcontent($ch3); $bombujHomeCode = (int)curl_getinfo($ch3, CURLINFO_HTTP_CODE); $bombujHomeErr = curl_error($ch3);
    curl_multi_remove_handle($mh, $ch1); curl_multi_remove_handle($mh, $ch2); curl_multi_remove_handle($mh, $ch3);
    $extraResults = [];
    foreach ($extraHandles as $key => $chx) {
        $extraBody = curl_multi_getcontent($chx);
        $extraCode = (int)curl_getinfo($chx, CURLINFO_HTTP_CODE);
        $extraErr = curl_error($chx);
        curl_multi_remove_handle($mh, $chx);
        curl_close($chx);
        if ($extraErr) $extraResults[$key] = ['error' => wflixSourceLabel($key) . ': ' . $extraErr, 'movies' => []];
        elseif ($extraCode === 429) $extraResults[$key] = ['error' => wflixSourceLabel($key) . ': HTTP 429', 'status' => 429, 'movies' => []];
        elseif ($extraCode < 200 || $extraCode >= 300) $extraResults[$key] = ['error' => wflixSourceLabel($key) . ' HTTP: ' . $extraCode, 'status' => $extraCode, 'movies' => []];
        elseif ($key === 'hellspy') $extraResults[$key] = parseHellspyBody($extraBody);
        else $extraResults[$key] = parseFastshareBody($extraBody, $key);
    }
    curl_close($ch1); curl_close($ch2); curl_close($ch3); curl_multi_close($mh);

    $r1 = ['error' => null, 'movies' => []];
    if ($prehrajErr) $r1 = ['error' => 'Prehraj.to: ' . $prehrajErr, 'movies' => []];
    elseif ($prehrajCode < 200 || $prehrajCode >= 300) $r1 = ['error' => 'Prehraj.to HTTP: ' . $prehrajCode, 'status' => $prehrajCode, 'movies' => []];
    else {
        $movies = [];
        if (preg_match_all('/<a[^>]*class="[^"]*video[^"]*"[^>]*href="(\/[a-z0-9+-]+\/[a-z0-9]+)"[^>]*title="([^"]+)"[^>]*>/i', (string)$prehrajBody, $matches, PREG_SET_ORDER)) {
            foreach ($matches as $match) {
                $url = 'https://prehraj.to' . $match[1]; $title = html_entity_decode($match[2], ENT_QUOTES, 'UTF-8');
                $exists = false; foreach ($movies as $m) { if ($m['url'] === $url) { $exists = true; break; } }
                if ($exists) continue;
                $thumbnail = ''; $urlEscaped = preg_quote($match[1], '/');
                if (preg_match('/href="' . $urlEscaped . '".*?<img[^>]*src="([^"]+thumb[^"]*\.jpg)"/s', (string)$prehrajBody, $tm)) $thumbnail = $tm[1];
                $year = ''; if (preg_match('/[-(](\d{4})[)-]/', $title, $ym)) $year = $ym[1]; elseif (preg_match('/-(\d{4})[-\/]/', $match[1], $ym)) $year = $ym[1];
                $movies[] = ['url' => $url, 'title' => $title, 'thumbnail' => $thumbnail, 'year' => $year, 'source' => 'prehrajto'];
            }
        }
        $r1 = ['error' => null, 'movies' => array_slice($movies, 0, 30)];
    }

    $r2 = ['error' => null, 'movies' => []];
    if (!$stErr && $stCode >= 200 && $stCode < 300) {
        $parsed = parseSledujtetoApiResponse($stBody, $st['host']);
        $r2 = ['error' => null, 'movies' => $parsed['movies']];
    }
    if (empty($r2['movies'])) $r2 = searchSledujteto($query, $page); // bounded fallback across other API bases

    $r3 = ['error' => null, 'movies' => []];
    $bombujPostUrl = '';
    if (!$bombujHomeErr && $bombujHomeCode >= 200 && $bombujHomeCode < 300) {
        if (preg_match('/xhr\.open\(\s*[\'\"]POST[\'\"]\s*,\s*[\'\"](\/\/www\.bombuj\.si\/[^\'\"]+?\.php)[\'\"]/i', (string)$bombujHome, $m)) {
            $bombujPostUrl = wflixFixUrl($m[1], 'www.bombuj.si');
        } elseif (preg_match('/[\'\"](https?:\/\/www\.bombuj\.si\/[a-z0-9_-]+\.php)[\'\"]/i', (string)$bombujHome, $m)) {
            $bombujPostUrl = $m[1];
        }
    }
    if ($bombujPostUrl !== '') {
        list($bc, $bb, $be) = wflixHttpPost($bombujPostUrl, ['queryString' => $query], 20, [
            'Accept: application/json, text/plain, */*',
            'Origin: https://www.bombuj.si',
            'Referer: https://www.bombuj.si/',
            'X-Requested-With: XMLHttpRequest',
        ]);
        if (!$be && $bc >= 200 && $bc < 300) {
            $bd = json_decode((string)$bb, true);
            $list = is_array($bd) ? (isset($bd['data']) && is_array($bd['data']) ? $bd['data'] : (array_values($bd) === $bd ? $bd : [])) : [];
            $movies = [];
            foreach ($list as $it) {
                if (!is_array($it)) continue;
                $url = wflixFixUrl($it['url'] ?? ($it['link'] ?? ''), 'www.bombuj.si');
                $name = trim(html_entity_decode((string)($it['name'] ?? ($it['title'] ?? '')), ENT_QUOTES, 'UTF-8'));
                if ($url === '' || $name === '' || strpos($url, '/online-film') === false) continue;
                $movies[] = ['url' => $url, 'title' => $name, 'thumbnail' => wflixFixUrl($it['img'] ?? ($it['image'] ?? ''), 'www.bombuj.si'), 'year' => '', 'source' => 'bombuj'];
                if (count($movies) >= 20) break;
            }
            $r3 = ['error' => null, 'movies' => $movies];
        } else {
            $r3 = ['error' => 'Bombuj: ' . ($be ?: ('HTTP ' . $bc)), 'movies' => []];
        }
    } elseif ($bombujHomeErr || $bombujHomeCode < 200 || $bombujHomeCode >= 300) {
        $r3 = ['error' => 'Bombuj: ' . ($bombujHomeErr ?: ('HTTP ' . $bombujHomeCode)), 'movies' => []];
    } else {
        $r3 = ['error' => 'Bombuj: endpoint nenalezen', 'movies' => []];
    }

    if (!$wantSource('prehrajto')) $r1 = ['error' => null, 'movies' => []];
    if (!$wantSource('sledujteto')) $r2 = ['error' => null, 'movies' => []];
    if (!$wantSource('bombuj')) $r3 = ['error' => null, 'movies' => []];
    foreach (array_keys($extraResults) as $key) {
        if (!$wantSource($key)) unset($extraResults[$key]);
    }

    $allMovies = array_merge(
        is_array($r1['movies']) ? $r1['movies'] : [],
        is_array($r2['movies']) ? $r2['movies'] : [],
        is_array($r3['movies']) ? $r3['movies'] : []
    );
    $errs = [];
    if (empty($r1['movies']) && !empty($r1['error'])) $errs[] = $r1['error'];
    if (empty($r2['movies']) && !empty($r2['error'])) $errs[] = $r2['error'];
    if (empty($r3['movies']) && !empty($r3['error'])) $errs[] = $r3['error'];
    foreach ($extraResults as $key => $extraResult) {
        if (!empty($extraResult['movies'])) $allMovies = array_merge($allMovies, $extraResult['movies']);
        elseif (!empty($extraResult['error'])) $errs[] = $extraResult['error'];
    }
    $merged = wflixDedupMovies($allMovies);
    $err = (!empty($merged) || empty($errs)) ? null : implode(' | ', $errs);
    return ['error' => $err, 'status' => $r1['status'] ?? 0, 'movies' => $merged, 'sources' => ['prehrajto', 'sledujteto', 'bombuj', 'hellspy', 'fastshare', 'sdilej']];
}

function resolveSourceVideo($source, $url) {
    if ($source === 'bombuj') {
        list($c, $html, $e) = wflixHttpGet($url, 30, ['Referer: https://www.bombuj.si/']);
        if ($e || $c < 200 || $c >= 300) return ['success' => false, 'error' => 'Bombuj: nelze načíst stránku videa' . ($e ? " ($e)" : " (HTTP $c)"), 'source' => 'bombuj'];
        $all = []; $videoUrl = null;
        if (preg_match_all('#https?://[^"\'<>\s]+\.(?:m3u8|mp4)[^"\'<>\s]*#i', $html, $am)) $all = array_values(array_unique($am[0]));
        if (preg_match_all('#<iframe[^>]+(?:data-src|src)=["\']([^"\']+)["\']#i', $html, $im)) {
            foreach ($im[1] as $u) { $u = wflixFixUrl($u, 'www.bombuj.si'); if (strpos($u, 'about:blank') === false) $all[] = $u; }
            $all = array_values(array_unique($all));
        }
        foreach ($all as $u) if (preg_match('/\.(m3u8|mp4)/i', $u)) { $videoUrl = $u; break; }
        return [
            'success' => $videoUrl !== null,
            'videoUrl' => $videoUrl ?: $url,
            'pageUrl' => $url,
            'allUrls' => $all,
            'subtitles' => wflixSubtitles($html),
            'source' => 'bombuj',
            'hint' => $videoUrl ? null : 'Bombuj často používá vložené přehrávače; přímá URL streamu nebyla v HTML nalezena. Zkuste otevřít stránku zdroje.',
        ];
    }
    if ($source === 'sledujteto') {
        $base = (strpos($url, 'old.sledujteto.cz') !== false) ? 'old.sledujteto.cz' : 'www.sledujteto.cz';
        list($c, $html, $e) = wflixHttpGet($url, 30, ['Referer: https://' . $base . '/']);
        if ($e || $c < 200 || $c >= 300) return ['success' => false, 'error' => 'Sledujteto: nelze načíst stránku videa' . ($e ? " ($e)" : " (HTTP $c)"), 'source' => 'sledujteto'];
        $all = [];
        if (preg_match_all('#https?://[^"\'<>\s]+\.(?:m3u8|mp4)[^"\'<>\s]*#i', $html, $am)) $all = array_values(array_unique($am[0]));
        $videoUrl = !empty($all) ? $all[0] : null;
        return [
            'success' => $videoUrl !== null,
            'videoUrl' => $videoUrl ?: $url,
            'pageUrl' => $url,
            'allUrls' => $all,
            'subtitles' => wflixSubtitles($html),
            'source' => 'sledujteto',
            'hint' => $videoUrl ? null : 'Sledujteto může vyžadovat přihlášení/premium nebo načítat stream přes JavaScript; přímá URL nebyla nalezena.',
        ];
    }
    if ($source === 'hellspy') {
        $link = wflixRedirectUrl($url, 25);
        return [
            'success' => $link !== null,
            'videoUrl' => $link ? $link : $url,
            'pageUrl' => $url,
            'allUrls' => $link ? [$link] : [],
            'subtitles' => [],
            'source' => 'hellspy',
            'hint' => $link ? null : 'HellSpy nevrátil odkaz na soubor (může být 429, smazaný soubor nebo změna API).',
        ];
    }
    if ($source === 'fastshare' || $source === 'sdilej') {
        // api_kodi.php vrací download_url rovnou na soubor; u některých souborů ale
        // přehrání vyžaduje přihlášený účet, pak se místo dat načte přihlašovací stránka.
        return [
            'success' => true,
            'videoUrl' => $url,
            'pageUrl' => $url,
            'allUrls' => [$url],
            'subtitles' => [],
            'source' => $source,
            'hint' => null,
        ];
    }
    return ['success' => false, 'error' => 'Neznámý zdroj', 'source' => $source];
}

/**
 * Cache hledání. prehraj.to pustí z jedné IP jen pár dotazů za deset vteřin, takže stejný
 * dotaz nesmí na prehraj.to chodit pro každou instanci appky (a po restartu) znovu.
 */
function wflixSearchCacheFile($query, $page) {
    $key = strtolower(trim(preg_replace('/\s+/u', ' ', (string) $query))) . '|' . (int) $page;
    return sys_get_temp_dir() . '/wflix-search/' . md5($key) . '.json';
}

function wflixSearchCacheRead($file, $ignoreTtl = false) {
    if (!is_file($file)) return null;
    $data = json_decode((string) @file_get_contents($file), true);
    if (!is_array($data)) return null;
    if ($ignoreTtl) return $data;
    $ttl = !empty($data['movies']) ? 1800 : 300;   // s nálezy 30 min, prázdné 5 min
    return (time() - filemtime($file) < $ttl) ? $data : null;
}

function wflixSearchCacheWrite($file, $data) {
    @mkdir(dirname($file), 0777, true);
    @file_put_contents($file, json_encode($data, JSON_UNESCAPED_UNICODE), LOCK_EX);
}

/**
 * Handle search request - returns list of movies
 */
function handleSearch($source = 'prehrajto') {
    $query = isset($_GET['q']) ? trim($_GET['q']) : '';
    // Stránkování: 1 = první stránka, 2+ = další výsledky (appka si je dotahuje u seriálů)
    $page = isset($_GET['page']) ? (int)$_GET['page'] : 1;
    if ($page < 1) $page = 1;
    if ($page > 50) $page = 50;

    if (empty($query)) {
        echo json_encode([
            'success' => false,
            'error' => 'Missing search query (q parameter)',
            'usage' => 'index.php?action=search&q=matrix&source=prehrajto|bombuj|sledujteto|hellspy|fastshare|sdilej|all'
        ], JSON_UNESCAPED_UNICODE);
        exit;
    }

    $cacheFile = wflixSearchCacheFile($source . '|' . $query, $page);
    $hit = wflixSearchCacheRead($cacheFile);
    if ($hit !== null) {
        echo json_encode($hit, JSON_UNESCAPED_UNICODE);
        exit;
    }

    $fallbackUsed = null;
    if ($source === 'bombuj') {
        $r = searchBombuj($query);
    } elseif ($source === 'sledujteto') {
        $r = searchSledujteto($query, $page);
    } elseif ($source === 'hellspy') {
        $r = searchHellspy($query, $page);
    } elseif ($source === 'fastshare' || $source === 'sdilej') {
        $r = searchFastshare($query, $page, $source);
    } elseif ($source === 'all') {
        $r = searchAll($query, $page);
        $fallbackUsed = 'all';
    } else {
        $r = searchPrehraj($query, $page);
        // Sledujteto jako fallback pro prehraj.to (duplication prevention při sloučení).
        // Zapne se při chybě/prázdném výsledku; pro explicitní "jen prehrajto" lze poslat fallback=0.
        $allowFallback = !isset($_GET['fallback']) || $_GET['fallback'] === '' || $_GET['fallback'] === '1' || $_GET['fallback'] === 'true';
        $needFallback = $allowFallback && (!empty($r['error']) || empty($r['movies']));
        if ($needFallback) {
            $fb = searchSledujteto($query, $page);
            if (empty($fb['error']) && !empty($fb['movies'])) {
                $r['movies'] = wflixDedupMovies(array_merge(is_array($r['movies'] ?? null) ? $r['movies'] : [], $fb['movies']));
                $r['error'] = null;
                $fallbackUsed = 'sledujteto';
            } elseif (!empty($r['error']) && !empty($fb['error'])) {
                $r['error'] = $r['error'] . ' | fallback sledujteto: ' . $fb['error'];
                $r['status'] = $r['status'] ?? ($fb['status'] ?? 0);
            } elseif (!empty($r['error']) && empty($fb['movies'])) {
                $r['error'] = $r['error'] . ' | fallback sledujteto: žádné výsledky';
            }
        }
    }

    $movies = wflixDedupMovies(is_array($r['movies'] ?? null) ? $r['movies'] : []);

    if (!empty($r['error']) && empty($movies)) {
        // 429/temporary: když máme starší kopii, vrátíme ji.
        $stale = wflixSearchCacheRead($cacheFile, true);
        if ($stale !== null) {
            echo json_encode($stale, JSON_UNESCAPED_UNICODE);
            exit;
        }
        wflixFail(['success' => false, 'error' => $r['error'], 'source' => $source], $r['status'] ?? 0);
    }

    $out = [
        'success' => true,
        'source' => $source,
        'query' => $query,
        'page' => $page,
        'count' => count($movies),
        'movies' => $movies
    ];
    if ($fallbackUsed) $out['fallback'] = $fallbackUsed;
    wflixSearchCacheWrite($cacheFile, $out);
    echo json_encode($out, JSON_UNESCAPED_UNICODE);
}

/**
 * Search prehraj.to (shared by search and thumb).
 * $page > 1 používá stejný parametr, kterým stránkuje ArchivCZSK doplněk
 * (videoListing-visualPaginator-page). Šablona stránky je stejná jako u první strany.
 * Returns ['error' => string|null, 'movies' => [...]]
 */
function searchPrehraj($query, $page = 1) {
    // URL encode the query.
    $searchUrl = 'https://prehraj.to/hledej/' . rawurlencode($query);
    if ($page > 1) $searchUrl .= '?videoListing-visualPaginator-page=' . (int)$page;

    // Fetch search results
    $ch = curl_init();
    curl_setopt($ch, CURLOPT_URL, $searchUrl);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_FOLLOWLOCATION, true);
    curl_setopt($ch, CURLOPT_USERAGENT, 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false);
    curl_setopt($ch, CURLOPT_TIMEOUT, 30);

    $html = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $error = curl_error($ch);
    curl_close($ch);

    if ($error) return ['error' => 'Curl error: ' . $error, 'status' => 0, 'movies' => []];
    // 2xx (200 range) = úspěch; cokoli jiného (429, 403, 5xx...) je chyba a má se přeskočit
    if ($httpCode < 200 || $httpCode >= 300)
        return ['error' => 'HTTP error: ' . $httpCode, 'status' => (int)$httpCode, 'movies' => []];
    if ($html === '' || $html === false)
        return ['error' => 'Empty response', 'status' => (int)$httpCode, 'movies' => []];

    // Parse movie results
    $movies = [];

    // Find all video links with class="video" - this is the main pattern on prehraj.to
    // Pattern: <a class="video..." href="/movie-name/id" title="Movie Title"
    if (preg_match_all('/<a[^>]*class="[^"]*video[^"]*"[^>]*href="(\/[a-z0-9+-]+\/[a-z0-9]+)"[^>]*title="([^"]+)"[^>]*>/i', $html, $matches, PREG_SET_ORDER)) {
        foreach ($matches as $match) {
            $url = $match[1];
            $title = html_entity_decode($match[2], ENT_QUOTES, 'UTF-8');

            // Skip duplicates
            $exists = false;
            foreach ($movies as $m) {
                if ($m['url'] === 'https://prehraj.to' . $url) {
                    $exists = true;
                    break;
                }
            }
            if ($exists) continue;

            // Extract thumbnail - look for img near this URL
            $thumbnail = '';
            $urlEscaped = preg_quote($url, '/');
            if (preg_match('/href="' . $urlEscaped . '".*?<img[^>]*src="([^"]+thumb[^"]*\.jpg)"/s', $html, $thumbMatch)) {
                $thumbnail = $thumbMatch[1];
            }

            // Extract year from URL or title
            $year = '';
            if (preg_match('/[-(](\d{4})[)-]/', $title, $yearMatch)) {
                $year = $yearMatch[1];
            } elseif (preg_match('/-(\d{4})[-\/]/', $url, $yearMatch)) {
                $year = $yearMatch[1];
            }

            $movies[] = [
                'url' => 'https://prehraj.to' . $url,
                'title' => $title,
                'thumbnail' => $thumbnail,
                'year' => $year
            ];
        }
    }

    // Alternative pattern - find thumbnails first and extract URLs
    if (empty($movies)) {
        // Look for video containers with data-video-id
        if (preg_match_all('/data-video-id="[^"]*".*?href="(\/[^"]+)"[^>]*title="([^"]+)".*?src="([^"]+\.jpg)"/s', $html, $matches, PREG_SET_ORDER)) {
            foreach ($matches as $match) {
                $movies[] = [
                    'url' => 'https://prehraj.to' . $match[1],
                    'title' => html_entity_decode($match[2], ENT_QUOTES, 'UTF-8'),
                    'thumbnail' => $match[3],
                    'year' => ''
                ];
            }
        }
    }

    // Limit results
    return ['error' => null, 'movies' => array_slice($movies, 0, 30)];
}

/**
 * Thumbnail helpers (/api/thumb)
 */
function wflixNorm($s) {
    static $map = [
        'á'=>'a','ä'=>'a','à'=>'a','â'=>'a','ã'=>'a','å'=>'a','ć'=>'c','č'=>'c','ç'=>'c','ď'=>'d',
        'é'=>'e','ě'=>'e','ë'=>'e','è'=>'e','ê'=>'e','í'=>'i','î'=>'i','ì'=>'i','ï'=>'i',
        'ľ'=>'l','ĺ'=>'l','ł'=>'l','ň'=>'n','ń'=>'n','ñ'=>'n','ó'=>'o','ö'=>'o','ô'=>'o','ò'=>'o','õ'=>'o','ø'=>'o',
        'ř'=>'r','ŕ'=>'r','š'=>'s','ś'=>'s','ť'=>'t','ú'=>'u','ů'=>'u','ü'=>'u','û'=>'u','ù'=>'u',
        'ý'=>'y','ÿ'=>'y','ž'=>'z','ź'=>'z','ż'=>'z',
        'Á'=>'a','Ä'=>'a','Č'=>'c','Ď'=>'d','É'=>'e','Ě'=>'e','Ë'=>'e','Í'=>'i','Ľ'=>'l','Ł'=>'l','Ň'=>'n',
        'Ó'=>'o','Ö'=>'o','Ř'=>'r','Š'=>'s','Ť'=>'t','Ú'=>'u','Ů'=>'u','Ü'=>'u','Ý'=>'y','Ž'=>'z',
    ];
    $s = strtolower(strtr((string)$s, $map));
    return trim(preg_replace('/[^a-z0-9]+/', ' ', $s));
}

// významná slova (bez předložek a pod.); když by nezbylo nic, vrátí všechna
function wflixWords($s) {
    static $stop = ['a','i','z','ze','o','u','v','ve','na','do','se','si','k','s','the','of','and','to','in'];
    $w = array_values(array_filter(explode(' ', wflixNorm($s)), 'strlen'));
    $sig = array_values(array_diff($w, $stop));
    return $sig ? $sig : $w;
}

// "query*": každé významné slovo jako začátek slova, pořadí je jedno
function wflixAliasPattern($alias) {
    $w = wflixWords($alias);
    if (!$w) return '';
    $p = '^';
    foreach ($w as $x) $p .= '(?=.*\b' . preg_quote($x, '~') . ')';
    return $p;
}

function wflixFixThumb($u) {
    if ($u === '') return '';
    if (strpos($u, '//') === 0) return 'https:' . $u;
    if ($u[0] === '/') return 'https://prehraj.to' . $u;
    return $u;
}

// Keyless alternativa: iTunes Search API (plakáty filmů, bez API klíče), CZ obchod.
function wflixItunesThumb($term, $pattern, $y) {
    $ch = curl_init('https://itunes.apple.com/search?media=movie&entity=movie&country=cz&limit=15&term=' . rawurlencode($term));
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_FOLLOWLOCATION, true);
    curl_setopt($ch, CURLOPT_USERAGENT, 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
    curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false);
    curl_setopt($ch, CURLOPT_TIMEOUT, 15);
    $body = curl_exec($ch);
    $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    if ($code < 200 || $code >= 300 || !$body) return null;
    $d = json_decode($body, true);
    if (empty($d['results'])) return null;

    $best = null;
    $bestScore = 0.6;
    foreach ($d['results'] as $it) {
        $name = isset($it['trackName']) ? $it['trackName'] : '';
        $art = isset($it['artworkUrl100']) ? $it['artworkUrl100'] : '';
        if ($name === '' || $art === '') continue;
        if (!@preg_match($pattern, wflixNorm($name))) continue;
        $sc = 1.0;
        if ($y !== '' && isset($it['releaseDate']) && strpos($it['releaseDate'], $y) === 0) $sc += 0.5;
        if ($sc > $bestScore) {
            $best = [
                'thumbnail' => str_replace('100x100bb', '600x600bb', $art),
                'title' => $name,
                'url' => isset($it['trackViewUrl']) ? $it['trackViewUrl'] : ''
            ];
            $bestScore = $sc;
        }
    }
    return $best;
}

function wflixSendThumb($data) {
    header('Cache-Control: public, max-age=' . (!empty($data['thumbnail']) ? 86400 : 600));
    echo json_encode($data);
    exit;
}

/**
 * Handle thumbnail lookup - /api/thumb?q=Matrix[&t=Titul][&y=1999][&re=regex]
 * Výchozí regex je "q*" (viz wflixAliasPattern), &re= ho přepíše (aplikuje se na název+slug
 * bez diakritiky, malými písmeny). Výsledek se cachuje do temp adresáře.
 */
function handleThumb() {
    $q = isset($_GET['q']) ? trim(str_replace('*', ' ', $_GET['q'])) : '';
    $t = isset($_GET['t']) ? trim(str_replace('*', ' ', $_GET['t'])) : '';
    $y = isset($_GET['y']) ? preg_replace('/\D/', '', $_GET['y']) : '';
    $re = isset($_GET['re']) ? trim($_GET['re']) : '';
    $src = (isset($_GET['src']) && $_GET['src'] === 'itunes') ? 'itunes' : 'prehraj';

    if ($q === '') {
        echo json_encode(['success' => false, 'error' => 'Missing q parameter', 'usage' => '/api/thumb?q=Matrix&y=1999']);
        exit;
    }

    if ($re !== '') {
        $pattern = '~' . str_replace('~', '\~', $re) . '~iu';
    } else {
        $pattern = '~' . implode('|', array_filter([wflixAliasPattern($q), wflixAliasPattern($t)])) . '~i';
    }
    if (strlen($pattern) > 300 || $pattern === '~~i' || @preg_match($pattern, '') === false) {
        echo json_encode(['success' => false, 'error' => 'Invalid or too long regex']);
        exit;
    }

    // cache
    $dir = sys_get_temp_dir() . '/wflix-thumbs';
    $file = $dir . '/' . md5($src . '|' . wflixNorm($q) . '|' . wflixNorm($t) . '|' . $y . '|' . $re) . '.json';
    if (is_file($file)) {
        $data = json_decode(@file_get_contents($file), true);
        $ttl = (is_array($data) && !empty($data['thumbnail'])) ? 7 * 86400 : 3600;
        if (is_array($data) && time() - filemtime($file) < $ttl) wflixSendThumb($data);
    }

    if ($src === 'itunes') {
        $hit = wflixItunesThumb($t !== '' ? $t : $q, $pattern, $y);
        if ($hit) {
            $data = ['success' => true, 'q' => $q, 'thumbnail' => $hit['thumbnail'], 'title' => $hit['title'], 'url' => $hit['url']];
            @mkdir($dir, 0777, true);
            @file_put_contents($file, json_encode($data));
            wflixSendThumb($data);
        }
        // nenalezeno na iTunes -> záloha přes prehraj.to
    }

    $r = searchPrehraj($q);
    if ($r['error']) {
        wflixFail(['success' => false, 'error' => $r['error']], $r['status'] ?? 0);
    }

    $bad = ['trailer','teaser','ukazka','upoutavka','recenze','review','soundtrack','ost','making',
            'gameplay','hra','parodie','reaction','reakce','rozbor','sestrih','clip'];
    $qLen = count(wflixWords($q));
    $best = null;
    $bestScore = 0.6; // pod tímhle se obrázek nepoužije
    foreach ($r['movies'] as $m) {
        if ($m['thumbnail'] === '') continue;
        $slug = preg_replace('~^https?://prehraj\.to/~', '', $m['url']);
        $text = wflixNorm($m['title'] . ' ' . $slug);
        if (!@preg_match($pattern, $text)) continue;

        $tw = array_values(array_filter(explode(' ', wflixNorm($m['title'])), 'strlen'));
        $sc = 1.0;
        if ($y !== '' && preg_match('/\b' . $y . '\b/', $text)) $sc += 0.5;
        if (array_intersect($tw, $bad)) $sc -= 0.7;
        $sc -= min(0.3, max(0, count($tw) - $qLen) * 0.02);
        if ($sc > $bestScore) { $best = $m; $bestScore = $sc; }
    }

    $data = [
        'success' => true,
        'q' => $q,
        'thumbnail' => $best ? wflixFixThumb($best['thumbnail']) : '',
        'title' => $best ? $best['title'] : '',
        'url' => $best ? $best['url'] : ''
    ];
    @mkdir($dir, 0777, true);
    @file_put_contents($file, json_encode($data));
    wflixSendThumb($data);
}

/**
 * Handle video streaming - proxy video content from CDN
 */
function handleStream() {
    $url = isset($_GET['url']) ? $_GET['url'] : '';
    
    if (empty($url)) {
        header('Content-Type: application/json');
        echo json_encode(['success' => false, 'error' => 'Missing url parameter']);
        exit;
    }
    
    // Validate URL looks like a media/CDN URL (kept permissive for known CDNs but requires media-like targets)
    $isCdnHost = (strpos($url, 'premiumcdn.net') !== false || strpos($url, 'cdn') !== false);
    $isMediaUrl = (bool)preg_match('#^https?://#i', $url) && (bool)preg_match('/\.(m3u8|mp4|ts)(\?|$)/i', $url);
    if (!$isCdnHost && !$isMediaUrl) {
        header('Content-Type: application/json');
        echo json_encode(['success' => false, 'error' => 'URL must be from a supported CDN/media source']);
        exit;
    }
    
    // Get Range header if present (for video seeking)
    $range = isset($_SERVER['HTTP_RANGE']) ? $_SERVER['HTTP_RANGE'] : null;
    
    // Setup curl for streaming
    $ch = curl_init();
    curl_setopt($ch, CURLOPT_URL, $url);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, false);
    curl_setopt($ch, CURLOPT_FOLLOWLOCATION, true);
    curl_setopt($ch, CURLOPT_USERAGENT, 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
    curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false);
    curl_setopt($ch, CURLOPT_TIMEOUT, 0); // No timeout for streaming
    curl_setopt($ch, CURLOPT_BUFFERSIZE, 8192);
    
    // Forward Range header
    if ($range) {
        curl_setopt($ch, CURLOPT_HTTPHEADER, ['Range: ' . $range]);
    }
    
    // First, get headers to determine content type and length
    curl_setopt($ch, CURLOPT_HEADER, true);
    curl_setopt($ch, CURLOPT_NOBODY, true);
    $headerResponse = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $curlError = curl_error($ch);
    $contentType = curl_getinfo($ch, CURLINFO_CONTENT_TYPE);
    $contentLength = curl_getinfo($ch, CURLINFO_CONTENT_LENGTH_DOWNLOAD);
    
    // 2xx (vč. 206 při Range) = OK; 429/403/5xx nebo spadlé curl připojení = chyba
    if ($httpCode < 200 || $httpCode >= 300) {
        http_response_code($httpCode >= 400 && $httpCode < 600 ? (int)$httpCode : 502);
        header('Content-Type: application/json');
        echo json_encode(['success' => false, 'error' => 'CDN returned HTTP ' . $httpCode
            . ($curlError !== '' ? ' (' . $curlError . ')' : '')]);
        exit;
    }
    
    // Set appropriate headers
    header('Content-Type: ' . ($contentType ?: 'video/mp4'));
    header('Accept-Ranges: bytes');
    header('Access-Control-Allow-Origin: *');
    
    if ($contentLength > 0) {
        header('Content-Length: ' . $contentLength);
    }
    
    if ($httpCode === 206) {
        http_response_code(206);
    }
    
    // Now stream the actual content
    curl_setopt($ch, CURLOPT_HEADER, false);
    curl_setopt($ch, CURLOPT_NOBODY, false);
    curl_setopt($ch, CURLOPT_WRITEFUNCTION, function($ch, $data) {
        echo $data;
        flush();
        return strlen($data);
    });
    
    curl_exec($ch);
    curl_close($ch);
    exit;
}

/**
 * Vytáhne WebVTT titulky z HTML stránky videa.
 *
 * prehraj.to je vkládá do inicializace přehrávače, ne do <track>:
 *   Video.js: { src: "...vtt...", srclang: "eng", label: "...", kind: "captions", default: true }
 *   JWPlayer: { file: "...vtt...", label: "ENG - 8175377 - eng", kind: "captions", default: true }
 * Odkazy jsou podepsané na CDN (token + expires), takže se nikde dlouho necachují.
 */
function wflixSubtitles($html) {
    $out = [];
    $seen = [];
    if (preg_match_all('/\{[^{}]*\.vtt[^{}]*\}/i', $html, $blocks)) {
        foreach ($blocks[0] as $block) {
            // Bereme jen caption stopy. Když chybí kind, poznáme je podle srclang.
            if (!preg_match('/kind\s*:\s*["\']captions["\']/i', $block)
                && !preg_match('/srclang\s*:/i', $block)) continue;
            if (!preg_match('/(?:src|file)\s*:\s*["\']([^"\']+\.vtt[^"\']*)["\']/i', $block, $m)) continue;

            $url = str_replace(['\/', '\u0026'], ['/', '&'], $m[1]);
            $url = html_entity_decode($url, ENT_QUOTES, 'UTF-8');
            if (!preg_match('#^https?://#i', $url)) continue;

            $lang = '';
            if (preg_match('/srclang\s*:\s*["\']([^"\']*)["\']/i', $block, $l)) $lang = trim($l[1]);
            $label = '';
            if (preg_match('/label\s*:\s*["\']([^"\']*)["\']/i', $block, $l)) $label = trim($l[1]);
            // JWPlayer nemá srclang; jazyk je na konci labelu ("ENG - 8175377 - eng").
            if ($lang === '' && preg_match('/-\s*([a-z]{2,3})\s*$/i', $label, $l)) $lang = strtolower($l[1]);
            if ($label === '') $label = $lang !== '' ? strtoupper($lang) : 'Titulky';

            // Stejný soubor může být na stránce víckrát; token v query ignorujeme.
            $key = strtolower(preg_replace('/[?#].*$/', '', $url));
            if (isset($seen[$key])) continue;
            $seen[$key] = true;

            $out[] = [
                'url' => $url,
                'lang' => strtolower($lang),
                'label' => $label,
                'default' => (bool) preg_match('/\bdefault\s*:\s*true\b/i', $block),
            ];
        }
    }
    return $out;
}

/**
 * Handle video URL extraction
 */
function handleVideo($source = 'prehrajto') {
    // Get URL parameter
    $url = isset($_GET['url']) ? $_GET['url'] : '';

    if (empty($url)) {
        echo json_encode([
            'success' => false,
            'error' => 'Missing url parameter',
            'usage' => 'index.php?url=https://prehraj.to/video/...&source=prehrajto|bombuj|sledujteto|hellspy|fastshare|sdilej'
        ], JSON_UNESCAPED_UNICODE);
        exit;
    }

    // Validate URL by source (default prehraj.to for backward compatibility)
    if (!wflixAllowedSourceUrl($source, $url)) {
        // If an explicit source wasn't meaningful, try to infer from URL host for convenience.
        $host = strtolower((string)parse_url($url, PHP_URL_HOST));
        $inferred = $source;
        if ($host === 'bombuj.si' || substr($host, -9) === '.bombuj.si') $inferred = 'bombuj';
        elseif ($host === 'sledujteto.cz' || substr($host, -14) === '.sledujteto.cz') $inferred = 'sledujteto';
        elseif ($host === 'hellspy.to' || substr($host, -11) === '.hellspy.to') $inferred = 'hellspy';
        elseif ($host === 'fastshare.cz' || substr($host, -13) === '.fastshare.cz' || substr($host, -16) === '.fastshare.cloud') $inferred = 'fastshare';
        elseif ($host === 'sdilej.cz' || substr($host, -10) === '.sdilej.cz') $inferred = 'sdilej';
        elseif ($host === 'prehraj.to' || substr($host, -11) === '.prehraj.to') $inferred = 'prehrajto';
        if (!wflixAllowedSourceUrl($inferred, $url)) {
            echo json_encode([
                'success' => false,
                'error' => 'URL is not allowed for source ' . $source
            ], JSON_UNESCAPED_UNICODE);
            exit;
        }
        $source = $inferred;
    }

    if ($source !== 'prehrajto') {
        echo json_encode(resolveSourceVideo($source, $url), JSON_UNESCAPED_UNICODE);
        exit;
    }
    
    // Fetch the page
    $ch = curl_init();
    curl_setopt($ch, CURLOPT_URL, $url);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_FOLLOWLOCATION, true);
    curl_setopt($ch, CURLOPT_USERAGENT, 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false);
    curl_setopt($ch, CURLOPT_TIMEOUT, 30);
    
    $html = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $error = curl_error($ch);
    curl_close($ch);
    
    if ($error) {
        wflixFail([
            'success' => false,
            'error' => 'Curl error: ' . $error
        ]);
    }
    
    // 2xx = úspěch; 429/403/5xx atd. jde do fallbacku (další proxy / přímé volání)
    if ($httpCode < 200 || $httpCode >= 300) {
        wflixFail([
            'success' => false,
            'error' => 'HTTP error: ' . $httpCode
        ], $httpCode);
    }
    
    // Try to find video URL in various formats
    $videoUrl = null;
    $patterns = [
        // HLS playlist
        '/["\']?(https?:\/\/[^"\']*premiumcdn\.net[^"\']*\.m3u8[^"\']*)["\']?/i',
        // MP4 direct
        '/["\']?(https?:\/\/[^"\']*premiumcdn\.net[^"\']*\.mp4[^"\']*)["\']?/i',
        // Generic CDN URL
        '/["\']?(https?:\/\/[^"\']*cdn[^"\']*\.(m3u8|mp4)[^"\']*)["\']?/i',
        // Source tag
        '/<source[^>]+src=["\']([^"\']+)["\'][^>]*>/i',
        // Video tag
        '/<video[^>]+src=["\']([^"\']+)["\'][^>]*>/i',
        // JSON data
        '/"file"\s*:\s*"([^"]+)"/i',
        '/"src"\s*:\s*"([^"]+)"/i',
        '/"url"\s*:\s*"([^"]+\.m3u8[^"]*)"/i',
    ];
    
    foreach ($patterns as $pattern) {
        if (preg_match($pattern, $html, $matches)) {
            $candidate = $matches[1];
            // Check if it looks like a video URL
            if (preg_match('/\.(m3u8|mp4)/i', $candidate)) {
                $videoUrl = $candidate;
                break;
            }
        }
    }
    
    // Also try to find all potential video URLs
    $allUrls = [];
    if (preg_match_all('/https?:\/\/[^"\'<>\s]+\.(m3u8|mp4)[^"\'<>\s]*/i', $html, $allMatches)) {
        $allUrls = array_unique($allMatches[0]);
    }
    
    $subtitles = wflixSubtitles($html);

    if ($videoUrl) {
        // Unescape if needed
        $videoUrl = str_replace('\/', '/', $videoUrl);
        
        echo json_encode([
            'success' => true,
            'videoUrl' => $videoUrl,
            'allUrls' => array_values($allUrls),
            'subtitles' => $subtitles,
            'source' => 'prehraj.to proxy'
        ]);
    } else {
        echo json_encode([
            'success' => false,
            'error' => 'Video URL not found in page',
            'allUrls' => array_values($allUrls),
            'hint' => 'Page might require JavaScript or different parsing'
        ]);
    }
}


function wflixHealthProbe($url, $timeout = 8, $headers = [], $post = null) {
    $t0 = microtime(true);
    $ch = curl_init($url);
    $base = ['Accept: */*', 'Accept-Language: cs-CZ,cs;q=0.9,en;q=0.5'];
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_USERAGENT => 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        CURLOPT_SSL_VERIFYPEER => false,
        CURLOPT_TIMEOUT => $timeout,
        CURLOPT_CONNECTTIMEOUT => min(5, $timeout),
        CURLOPT_HTTPHEADER => array_merge($base, $headers),
        CURLOPT_ENCODING => '',
    ]);
    if ($post !== null) {
        curl_setopt($ch, CURLOPT_POST, true);
        curl_setopt($ch, CURLOPT_POSTFIELDS, is_array($post) ? http_build_query($post) : $post);
    }
    $body = curl_exec($ch);
    $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $err = curl_error($ch);
    curl_close($ch);
    $ms = (int)round((microtime(true) - $t0) * 1000);
    $ok = !$err && $code >= 200 && $code < 400 && $body !== false && $body !== '';
    return ['ok' => $ok, 'status' => $code, 'ms' => $ms, 'error' => $err ?: ($ok ? null : ($code ? 'HTTP ' . $code : 'empty response'))];
}

function handleHealth() {
    header('Cache-Control: no-store, max-age=0');
    $checks = [
        ['name' => 'prehraj.to', 'type' => 'upstream', 'url' => 'https://prehraj.to/'],
        ['name' => 'sledujteto.cz api', 'type' => 'upstream', 'url' => 'https://www.sledujteto.cz/api/web/videos?query=test&limit=1&page=1&sort=relevance',
         'headers' => ['Accept: application/json', 'X-Requested-With: XMLHttpRequest', 'Referer: https://www.sledujteto.cz/vyhledat/?search=test&page=1', 'Origin: https://www.sledujteto.cz']],
        ['name' => 'bombuj.si', 'type' => 'upstream', 'url' => 'https://www.bombuj.si/uvod.php'],
        ['name' => 'itunes catalog', 'type' => 'upstream', 'url' => 'https://itunes.apple.com/search?media=movie&entity=movie&country=cz&limit=1&term=matrix'],
    ];
    $mh = curl_multi_init();
    $chs = [];
    foreach ($checks as $i => $c) {
        $t0 = microtime(true);
        $ch = curl_init($c['url']);
        $base = ['Accept: */*', 'Accept-Language: cs-CZ,cs;q=0.9,en;q=0.5'];
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true, CURLOPT_FOLLOWLOCATION => true, CURLOPT_TIMEOUT => 8, CURLOPT_CONNECTTIMEOUT => 5,
            CURLOPT_USERAGENT => 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            CURLOPT_SSL_VERIFYPEER => false, CURLOPT_HTTPHEADER => array_merge($base, isset($c['headers']) ? $c['headers'] : []), CURLOPT_ENCODING => '',
        ]);
        curl_multi_add_handle($mh, $ch);
        $chs[$i] = ['ch' => $ch, 't0' => $t0, 'meta' => $c];
    }
    do { curl_multi_exec($mh, $running); if ($running) curl_multi_select($mh, 0.2); } while ($running > 0);
    $upstreams = [];
    $allOk = true;
    foreach ($chs as $i => $x) {
        $body = curl_multi_getcontent($x['ch']);
        $code = (int)curl_getinfo($x['ch'], CURLINFO_HTTP_CODE);
        $err = curl_error($x['ch']);
        $ms = (int)round((microtime(true) - $x['t0']) * 1000);
        curl_multi_remove_handle($mh, $x['ch']);
        curl_close($x['ch']);
        $ok = !$err && $code >= 200 && $code < 400 && $body !== false && $body !== '';
        if (!$ok) $allOk = false;
        $upstreams[] = ['name' => $x['meta']['name'], 'type' => $x['meta']['type'], 'ok' => $ok, 'status' => $code, 'ms' => $ms, 'error' => $err ?: ($ok ? null : ($code ? 'HTTP ' . $code : 'empty response'))];
    }
    curl_multi_close($mh);

    $endpoints = [
        ['endpoint' => 'action=search', 'ok' => true, 'note' => 'handler available (prehrajto/bombuj/sledujteto/all)'],
        ['endpoint' => 'action=thumb', 'ok' => true, 'note' => 'handler available'],
        ['endpoint' => 'action=health', 'ok' => true, 'note' => 'handler available'],
        ['endpoint' => 'action=stream', 'ok' => true, 'note' => 'handler available'],
        ['endpoint' => 'action=video/proxy resolve', 'ok' => true, 'note' => 'handler available'],
    ];

    echo json_encode([
        'success' => $allOk,
        'status' => $allOk ? 'ok' : 'degraded',
        'service' => 'prehrajto-proxy (php)',
        'time' => gmdate('c'),
        'endpoints' => $endpoints,
        'upstreams' => $upstreams,
    ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}
