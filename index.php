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
function wtziFail($payload, $upstream = 0) {
    $code = ($upstream >= 400 && $upstream < 600) ? (int)$upstream : 502;
    http_response_code($code);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($payload, JSON_UNESCAPED_UNICODE);
    exit;
}

// Determine action: search, stream, validate or get video
$action = isset($_GET['action']) ? $_GET['action'] : 'video';

if ($action === 'search') {
    handleSearch();
} elseif ($action === 'thumb') {
    handleThumb();
} elseif ($action === 'stream') {
    handleStream();
} elseif ($action === 'validate') {
    handleValidate();
} else {
    handleVideo();
}

/**
 * Handle search request - returns list of movies
 */
function handleSearch() {
    $query = isset($_GET['q']) ? trim($_GET['q']) : '';
    
    if (empty($query)) {
        echo json_encode([
            'success' => false,
            'error' => 'Missing search query (q parameter)',
            'usage' => 'index.php?action=search&q=matrix'
        ]);
        exit;
    }
    
    $r = searchPrehraj($query);
    if ($r['error']) {
        wtziFail(['success' => false, 'error' => $r['error']], $r['status'] ?? 0);
    }

    echo json_encode([
        'success' => true,
        'query' => $query,
        'count' => count($r['movies']),
        'movies' => $r['movies']
    ]);
}

/**
 * Search prehraj.to (shared by search and thumb).
 * Returns ['error' => string|null, 'movies' => [...]]
 */
function searchPrehraj($query) {
    // URL encode the query
    $searchUrl = 'https://prehraj.to/hledej/' . rawurlencode($query);

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
function wtziNorm($s) {
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
function wtziWords($s) {
    static $stop = ['a','i','z','ze','o','u','v','ve','na','do','se','si','k','s','the','of','and','to','in'];
    $w = array_values(array_filter(explode(' ', wtziNorm($s)), 'strlen'));
    $sig = array_values(array_diff($w, $stop));
    return $sig ? $sig : $w;
}

// "query*": každé významné slovo jako začátek slova, pořadí je jedno
function wtziAliasPattern($alias) {
    $w = wtziWords($alias);
    if (!$w) return '';
    $p = '^';
    foreach ($w as $x) $p .= '(?=.*\b' . preg_quote($x, '~') . ')';
    return $p;
}

function wtziFixThumb($u) {
    if ($u === '') return '';
    if (strpos($u, '//') === 0) return 'https:' . $u;
    if ($u[0] === '/') return 'https://prehraj.to' . $u;
    return $u;
}

// Keyless alternativa: iTunes Search API (plakáty filmů, bez API klíče), CZ obchod.
function wtziItunesThumb($term, $pattern, $y) {
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
        if (!@preg_match($pattern, wtziNorm($name))) continue;
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

function wtziSendThumb($data) {
    header('Cache-Control: public, max-age=' . (!empty($data['thumbnail']) ? 86400 : 600));
    echo json_encode($data);
    exit;
}

/**
 * Handle thumbnail lookup - /api/thumb?q=Matrix[&t=Titul][&y=1999][&re=regex]
 * Výchozí regex je "q*" (viz wtziAliasPattern), &re= ho přepíše (aplikuje se na název+slug
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
        $pattern = '~' . implode('|', array_filter([wtziAliasPattern($q), wtziAliasPattern($t)])) . '~i';
    }
    if (strlen($pattern) > 300 || $pattern === '~~i' || @preg_match($pattern, '') === false) {
        echo json_encode(['success' => false, 'error' => 'Invalid or too long regex']);
        exit;
    }

    // cache
    $dir = sys_get_temp_dir() . '/wtzi-thumbs';
    $file = $dir . '/' . md5($src . '|' . wtziNorm($q) . '|' . wtziNorm($t) . '|' . $y . '|' . $re) . '.json';
    if (is_file($file)) {
        $data = json_decode(@file_get_contents($file), true);
        $ttl = (is_array($data) && !empty($data['thumbnail'])) ? 7 * 86400 : 3600;
        if (is_array($data) && time() - filemtime($file) < $ttl) wtziSendThumb($data);
    }

    if ($src === 'itunes') {
        $hit = wtziItunesThumb($t !== '' ? $t : $q, $pattern, $y);
        if ($hit) {
            $data = ['success' => true, 'q' => $q, 'thumbnail' => $hit['thumbnail'], 'title' => $hit['title'], 'url' => $hit['url']];
            @mkdir($dir, 0777, true);
            @file_put_contents($file, json_encode($data));
            wtziSendThumb($data);
        }
        // nenalezeno na iTunes -> záloha přes prehraj.to
    }

    $r = searchPrehraj($q);
    if ($r['error']) {
        wtziFail(['success' => false, 'error' => $r['error']], $r['status'] ?? 0);
    }

    $bad = ['trailer','teaser','ukazka','upoutavka','recenze','review','soundtrack','ost','making',
            'gameplay','hra','parodie','reaction','reakce','rozbor','sestrih','clip'];
    $qLen = count(wtziWords($q));
    $best = null;
    $bestScore = 0.6; // pod tímhle se obrázek nepoužije
    foreach ($r['movies'] as $m) {
        if ($m['thumbnail'] === '') continue;
        $slug = preg_replace('~^https?://prehraj\.to/~', '', $m['url']);
        $text = wtziNorm($m['title'] . ' ' . $slug);
        if (!@preg_match($pattern, $text)) continue;

        $tw = array_values(array_filter(explode(' ', wtziNorm($m['title'])), 'strlen'));
        $sc = 1.0;
        if ($y !== '' && preg_match('/\b' . $y . '\b/', $text)) $sc += 0.5;
        if (array_intersect($tw, $bad)) $sc -= 0.7;
        $sc -= min(0.3, max(0, count($tw) - $qLen) * 0.02);
        if ($sc > $bestScore) { $best = $m; $bestScore = $sc; }
    }

    $data = [
        'success' => true,
        'q' => $q,
        'thumbnail' => $best ? wtziFixThumb($best['thumbnail']) : '',
        'title' => $best ? $best['title'] : '',
        'url' => $best ? $best['url'] : ''
    ];
    @mkdir($dir, 0777, true);
    @file_put_contents($file, json_encode($data));
    wtziSendThumb($data);
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
    
    // Validate URL is from CDN
    if (strpos($url, 'premiumcdn.net') === false && strpos($url, 'cdn') === false) {
        header('Content-Type: application/json');
        echo json_encode(['success' => false, 'error' => 'URL must be from CDN']);
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
 * Handle video validation - check if video URL works (HEAD request)
 * Returns: { "valid": true/false, "status": httpCode }
 */
function handleValidate() {
    $url = isset($_GET['url']) ? $_GET['url'] : '';
    
    if (empty($url)) {
        echo json_encode([
            'valid' => false,
            'error' => 'Missing url parameter'
        ]);
        exit;
    }
    
    // First get video URL from prehraj.to page
    if (strpos($url, 'prehraj.to') !== false) {
        // Fetch the page and extract video URL
        $ch = curl_init();
        curl_setopt($ch, CURLOPT_URL, $url);
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($ch, CURLOPT_FOLLOWLOCATION, true);
        curl_setopt($ch, CURLOPT_USERAGENT, 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
        curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false);
        curl_setopt($ch, CURLOPT_TIMEOUT, 15);
        
        $html = curl_exec($ch);
        $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);
        
        if ($httpCode < 200 || $httpCode >= 300 || empty($html)) {
            // chyba (429/403/...) musí mít ne-2xx kód, jinak závod zdrojů myslí, že je všechno OK
            wtziFail([
                'valid' => false,
                'status' => $httpCode,
                'error' => 'Cannot fetch prehraj.to page'
            ], $httpCode);
        }
        
        // Extract video URL
        $videoUrl = null;
        $patterns = [
            '/["\']?(https?:\/\/[^"\']*premiumcdn\.net[^"\']*\.m3u8[^"\']*)["\']?/i',
            '/["\']?(https?:\/\/[^"\']*premiumcdn\.net[^"\']*\.mp4[^"\']*)["\']?/i',
        ];
        
        foreach ($patterns as $pattern) {
            if (preg_match($pattern, $html, $matches)) {
                $videoUrl = str_replace('\/', '/', $matches[1]);
                break;
            }
        }
        
        if (!$videoUrl) {
            echo json_encode([
                'valid' => false,
                'error' => 'Video URL not found in page'
            ]);
            exit;
        }
        
        $url = $videoUrl;
    }
    
    // Do partial GET request instead of HEAD (HLS streams don't respond to HEAD)
    $ch = curl_init();
    curl_setopt($ch, CURLOPT_URL, $url);
    curl_setopt($ch, CURLOPT_NOBODY, false);  // GET instead of HEAD
    curl_setopt($ch, CURLOPT_RANGE, '0-1024'); // Only first 1KB
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_FOLLOWLOCATION, true);
    curl_setopt($ch, CURLOPT_USERAGENT, 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
    curl_setopt($ch, CURLOPT_REFERER, 'https://prehraj.to/');  // Required by some CDNs
    curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false);
    curl_setopt($ch, CURLOPT_TIMEOUT, 20);  // Increased from 10

    $response = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    // 206 = Partial Content (success for Range request), 200 = OK
    $valid = ($httpCode >= 200 && $httpCode < 400);
    
    echo json_encode([
        'valid' => $valid,
        'status' => $httpCode
    ]);
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
function wtziSubtitles($html) {
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
function handleVideo() {
    // Get URL parameter
    $url = isset($_GET['url']) ? $_GET['url'] : '';
    
    if (empty($url)) {
        echo json_encode([
            'success' => false,
            'error' => 'Missing url parameter',
            'usage' => 'index.php?url=https://prehraj.to/video/...'
        ]);
        exit;
    }
    
    // Validate URL is from prehraj.to
    if (strpos($url, 'prehraj.to') === false) {
        echo json_encode([
            'success' => false,
            'error' => 'URL must be from prehraj.to'
        ]);
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
        wtziFail([
            'success' => false,
            'error' => 'Curl error: ' . $error
        ]);
    }
    
    // 2xx = úspěch; 429/403/5xx atd. jde do fallbacku (další proxy / přímé volání)
    if ($httpCode < 200 || $httpCode >= 300) {
        wtziFail([
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
    
    $subtitles = wtziSubtitles($html);

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
