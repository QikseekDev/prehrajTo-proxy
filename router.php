<?php
/**
 * WTZI - self-host router (Termux / jakýkoli server s PHP, bez Azure a bez .NET)
 *
 * Spouští se přes vestavěný PHP server:
 *   php -S 127.0.0.1:8080 -t azure-app/PrehrajtoProxy/wwwroot router.php
 * (nebo jednodušeji: ./start-termux.sh)
 *
 *  - /            -> wwwroot/index.html (WTZI)
 *  - /api/search  -> index.php?action=search (nebo souběžně přes $SERVER_PROXIES / ?proxy=, viz níže)
 *  - /api/proxy   -> index.php (získání URL videa)
 *  - /api/thumb   -> index.php?action=thumb (thumbnail pro homepage)
 *  - /api/subtitles -> relay VTT titulků pro <track>
 *  - /api/stream  -> přeposílání videa z CDN (Range, obnova vypršelého odkazu) + stahování
 */

// Hlášení PHP (Deprecated/Warning) nesmí do odpovědi, rozbila by JSON. Jdou do terminálu.
ini_set('display_errors', '0');
ini_set('log_errors', '1');
ini_set('error_log', 'php://stderr');
error_reporting(E_ALL & ~E_DEPRECATED);

$path = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);

function isPrehrajUrl($u) {
    $host = parse_url($u, PHP_URL_HOST);
    $scheme = parse_url($u, PHP_URL_SCHEME);
    if (!$host || !in_array($scheme, ['http', 'https'], true)) return false;
    $host = strtolower($host);
    return $host === 'prehraj.to' || substr($host, -11) === '.prehraj.to';
}

function jsonError($payload, $code = 400) {
    http_response_code($code);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($payload, JSON_UNESCAPED_UNICODE);
    exit;
}

// Odpověď se počítá jako úspěšná jen když není JSON chyba. Proxy servery vrací chybu
// z prehraj.to jako HTTP 200 + {"success":false,...} - bez tohohle by taková odpověď přebila
// fungující zdroj a třeba 429 by se nikdy nepřeskočila na další server.
function isGoodBody($body) {
    $t = ltrim((string)$body);
    if ($t === '' || $t[0] !== '{') return true;   // HTML: bereme cokoli neprázdného
    $d = json_decode($t, true);
    if (!is_array($d)) return true;
    if (array_key_exists('success', $d) && $d['success'] === false) return false;
    // {"valid":false,"error":...} = nepovedlo se ověřit; {"valid":false,"status":404} je odpověď
    if (array_key_exists('valid', $d) && $d['valid'] === false && array_key_exists('error', $d)) return false;
    return true;
}

// --------------------------------------------------------------------------
// Seznam PHP proxy serverů - stejná myšlenka jako appsettings.json
// "Prehraj:ProxyUrls" / DEFAULT_PROXY_SERVERS v script.js. Udržuje to
// scripts/change-proxy-servers.sh, needituj ručně mezi markery. Je to jen
// fallback pro případ, že tenhle self-host sám běží odjinud (zahraniční VPS
// apod.) - když Termux/self-host běží z české IP, appka si v ⚙️ Nastavení
// proxy klidně vypne, přímé volání je rychlejší.
$SERVER_PROXIES = [
    // PROXY-SERVERS:BEGIN
    'http://wtzi.borec.cz/index.php',
    'http://wtzi.euweb.cz/index.php',
    'http://wtzi.chytrak.cz/index.php',
    // PROXY-SERVERS:END
];

function isValidProxyUrl($u) {
    $scheme = parse_url($u, PHP_URL_SCHEME);
    $host = parse_url($u, PHP_URL_HOST);
    return $host !== null && in_array($scheme, ['http', 'https'], true);
}

// $_GET['proxy'] drží jen poslední hodnotu (PHP sloučí opakované klíče), takže
// seznam čteme ručně z raw query stringu - appka posílá &proxy=a&proxy=b&proxy=c.
function clientProxyList() {
    $out = [];
    foreach (explode('&', $_SERVER['QUERY_STRING'] ?? '') as $pair) {
        if ($pair === '') continue;
        $eq = strpos($pair, '=');
        if ($eq === false || substr($pair, 0, $eq) !== 'proxy') continue;
        $out[] = urldecode(substr($pair, $eq + 1));
    }
    return $out;
}

function effectiveProxies($serverProxies) {
    $client = array_values(array_unique(array_filter(clientProxyList(), 'isValidProxyUrl')));
    if (count($client) > 0) return $client;
    return array_values(array_unique(array_filter($serverProxies, 'isValidProxyUrl')));
}

// Odešle tělo vítěze závodu a skončí. Vrátí jenom false - pak proxy selhaly (429, výpadek, ...)
// a volající pokračuje přímo přes index.php na tomhle serveru, což je ten fallback.
function sendRaceWinner($winner) {
    if ($winner === null) return false;
    header('Content-Type: application/json; charset=utf-8');
    echo $winner;
    exit;
}

// Odešle stejný dotaz souběžně na všechny proxy servery (curl_multi) a vrátí první odpověď,
// která projde: 2xx + neprázdné tělo + není JSON chyba - ekvivalent RaceSources z Program.cs.
// Padlý/pomalý/limitovaný server se jen přeskočí. Vrací tělo vítěze, nebo null (selhaly všechny).
function viaProxyRace(array $bases, string $query, int $timeoutSeconds = 30) {
    $mh = curl_multi_init();
    $handles = [];
    foreach ($bases as $base) {
        $sep = (strpos($base, '?') !== false) ? '&' : '?';
        $ch = curl_init($base . $sep . $query);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT => $timeoutSeconds,
            CURLOPT_FOLLOWLOCATION => true,
            // Hlavičky běžného Chrome - samotný User-Agent řadě WAF (hostingy, prehraj.to)
            // nestačí a dotaz i tak označí jako bota a vrátí 403.
            CURLOPT_USERAGENT => 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
                . '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            CURLOPT_HTTPHEADER => [
                'Accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language: cs-CZ,cs;q=0.9,en;q=0.5',
                'Upgrade-Insecure-Requests: 1',
                'Cache-Control: no-cache',
                'Pragma: no-cache',
                'sec-ch-ua: "Chromium";v="120", "Not(A:Brand";v="24", "Google Chrome";v="120"',
                'sec-ch-ua-mobile: ?0',
                'sec-ch-ua-platform: "Windows"',
                'Sec-Fetch-Dest: document',
                'Sec-Fetch-Mode: navigate',
                'Sec-Fetch-Site: none',
                'Sec-Fetch-User: ?1',
            ],
        ]);
        curl_multi_add_handle($mh, $ch);
        $handles[(int) $ch] = ['ch' => $ch, 'base' => $base];
    }

    $winner = null;
    $errors = [];
    do {
        curl_multi_exec($mh, $running);
        if (count($handles) === 0) break;
        curl_multi_select($mh, 0.2);
        while ($info = curl_multi_info_read($mh)) {
            $ch = $info['handle'];
            $id = (int) $ch;
            $base = $handles[$id]['base'];
            $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
            $body = curl_multi_getcontent($ch);
            $err = curl_error($ch);
            if ($winner === null && $err === '' && $code >= 200 && $code < 300 && $body !== ''
                && isGoodBody($body)) {
                $winner = $body;
            } else {
                $errors[] = $base . ': ' . ($err !== '' ? $err : "HTTP $code");
            }
            curl_multi_remove_handle($mh, $ch);
            curl_close($ch);
            unset($handles[$id]);
        }
    } while ($winner === null && $running > 0);

    // Co ještě běží (vyhráli jsme dřív, nebo cyklus skončil) - zavřít a zahodit.
    foreach ($handles as $h) {
        curl_multi_remove_handle($mh, $h['ch']);
        curl_close($h['ch']);
    }
    curl_multi_close($mh);

    if ($winner === null && count($errors) > 0) {
        error_log('proxy race: ' . implode(' | ', $errors));
    }
    return $winner;
}

// --------------------------------------------------------------------------
// /api/stream - relay videa z CDN
// Podepsaný odkaz z CDN po pár minutách vyprší, takže přehrávač (nebo stahování) v půlce
// dostane chybu a zasekne se. Tady si odkaz bereme čerstvý při každém požadavku a když CDN
// vrátí chybu nebo se spojení utrhne, odkaz obnovíme a přenos navážeme přesně od posledního
// odeslaného bajtu - prohlížeč nic nepozná.
const STREAM_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
    . '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

function curlText($url, $timeout = 30) {
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_TIMEOUT => $timeout,
        CURLOPT_USERAGENT => STREAM_UA,
        CURLOPT_HTTPHEADER => [
            'Accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language: cs-CZ,cs;q=0.9,en;q=0.5',
        ],
        CURLOPT_ENCODING => '',
    ]);
    $body = curl_exec($ch);
    $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $err = curl_error($ch);
    curl_close($ch);
    return [$code, is_string($body) ? $body : '', $err];
}

function findCdnUrl($html) {
    $patterns = [
        '/["\']?(https?:\/\/[^"\']*premiumcdn\.net[^"\']*\.m3u8[^"\']*)["\']?/i',
        '/["\']?(https?:\/\/[^"\']*premiumcdn\.net[^"\']*\.mp4[^"\']*)["\']?/i',
        '/["\']?(https?:\/\/[^"\']*cdn[^"\']*\.(?:m3u8|mp4)[^"\']*)["\']?/i',
        '/<source[^>]+src=["\']([^"\']+)["\'][^>]*>/i',
        '/<video[^>]+src=["\']([^"\']+)["\'][^>]*>/i',
        '/"file"\s*:\s*"([^"]+)"/i',
        '/"src"\s*:\s*"([^"]+)"/i',
        '/"url"\s*:\s*"([^"]+\.m3u8[^"]*)"/i',
    ];
    foreach ($patterns as $p) {
        if (preg_match($p, $html, $m) && preg_match('/\.(m3u8|mp4)/i', $m[1])) {
            return str_replace('\\/', '/', $m[1]);
        }
    }
    return null;
}

// Čerstvý CDN odkaz pro stránku na prehraj.to. Krátká cache v tmp (90 s), aby seeking
// (spousta Range požadavků za sebou) nestahoval pokaždé celou stránku.
function normCdn($u) {
    return str_replace('\\u0026', '&', html_entity_decode(str_replace('\\/', '/', $u), ENT_QUOTES | ENT_HTML5));
}
function cdnKey($u) {
    $p = parse_url($u);
    return strtolower(($p['host'] ?? '') . ($p['path'] ?? ''));
}
// Na stránce bývá víc video odkazů; vezmeme ten se stejnou cestou jako ten, co klient právě hraje.
function pickByHint($html, $hint) {
    $key = cdnKey($hint);
    if (preg_match_all('/https?:\\\\?\/\\\\?\/[^"\'<>\s]+\.(?:m3u8|mp4)[^"\'<>\s]*/i', $html, $mm)) {
        foreach ($mm[0] as $u) {
            $u = normCdn($u);
            if (cdnKey($u) === $key) return $u;
        }
    }
    return null;
}

// $hint = CDN odkaz, který klient právě přehrává (&v=). Přímo ho používáme jen pro premiumcdn.net
// (jinak by šlo přes server stahovat cokoli); jinak slouží jen k nalezení správného souboru na stránce.
function resolveCdnUrl($page, $fresh, $serverProxies, $hint = null) {
    $cacheFile = sys_get_temp_dir() . '/wtzi_cdn_' . md5($page . '|' . ($hint ? cdnKey($hint) : '')) . '.txt';
    if (!$fresh) {
        if (is_file($cacheFile) && time() - filemtime($cacheFile) < 90) {
            $hit = @file_get_contents($cacheFile);
            if ($hit) return $hit;
        }
        if ($hint) {
            $hh = strtolower((string) parse_url($hint, PHP_URL_HOST));
            $hs = strtolower((string) parse_url($hint, PHP_URL_SCHEME));
            if (in_array($hs, ['http', 'https'], true)
                && ($hh === 'premiumcdn.net' || substr($hh, -14) === '.premiumcdn.net')) return $hint;
        }
    }

    $found = null;
    // Napřed napřímo - stejná IP, která odkaz získá, ho pak i stáhne.
    list($code, $html) = curlText($page, 30);
    if ($code >= 200 && $code < 300 && $html !== '') $found = ($hint ? pickByHint($html, $hint) : null) ?? findCdnUrl($html);

    if ($found === null) {
        // Záloha: PHP proxy servery (když je prehraj.to z tohohle místa blokované).
        foreach ($serverProxies as $base) {
            $sep = (strpos($base, '?') !== false) ? '&' : '?';
            list($pc, $pb) = curlText($base . $sep . 'url=' . rawurlencode($page), 30);
            if ($pc < 200 || $pc >= 300 || !isGoodBody($pb)) continue;   // 429/403/5xx nebo chybové JSON = další proxy
            $j = json_decode($pb, true);
            if (is_array($j) && $hint && !empty($j['allUrls']) && is_array($j['allUrls'])) {
                foreach ($j['allUrls'] as $cand) {
                    $cand = normCdn((string) $cand);
                    if (cdnKey($cand) === cdnKey($hint)) { $found = $cand; break 2; }
                }
            }
            if (is_array($j) && !empty($j['videoUrl'])) { $found = $j['videoUrl']; break; }
        }
    }
    if ($found === null) return null;

    $found = html_entity_decode($found, ENT_QUOTES | ENT_HTML5);
    $found = str_replace('\\u0026', '&', $found);
    @file_put_contents($cacheFile, $found);
    return $found;
}

function streamRelay($serverProxies) {
    $page = $_GET['url'] ?? '';
    if ($page === '') jsonError(['success' => false, 'error' => 'Missing url parameter']);
    if (!isPrehrajUrl($page)) jsonError(['success' => false, 'error' => 'URL must be from prehraj.to']);
    $download = !empty($_GET['download']) && $_GET['download'] !== '0';
    $name = trim((string) ($_GET['name'] ?? ''));
    $hint = trim((string) ($_GET['v'] ?? '')) ?: null;

    @set_time_limit(0);
    ignore_user_abort(false);
    while (ob_get_level() > 0) @ob_end_clean();

    // Range od prohlížeče: bytes=a-b | bytes=a- | bytes=-n
    $reqStart = 0; $reqEnd = null; $suffixLen = null; $hasRange = false;
    if (!empty($_SERVER['HTTP_RANGE']) && preg_match('/^bytes=(\d*)-(\d*)$/', trim($_SERVER['HTTP_RANGE']), $rm)) {
        if ($rm[1] === '' && $rm[2] !== '') {
            $suffixLen = (int) $rm[2];
        } elseif ($rm[1] !== '') {
            $hasRange = true;
            $reqStart = (int) $rm[1];
            if ($rm[2] !== '') $reqEnd = (int) $rm[2];
        }
    }

    $sent = 0; $total = null; $started = false; $fresh = false; $lastStatus = 0;

    for ($attempt = 0; $attempt < 6; $attempt++) {
        if (connection_aborted()) exit;

        $cdn = resolveCdnUrl($page, $fresh, $serverProxies, $hint);
        $fresh = false;
        if ($cdn === null) {
            if (!$started) jsonError(['success' => false, 'error' => 'Video URL not found in page'], 404);
            break;
        }
        if (stripos($cdn, '.m3u8') !== false) {
            if (!$started) jsonError(['success' => false, 'error' => 'HLS (m3u8) stream nejde přeposílat'], 501);
            break;
        }

        $offset = $reqStart + $sent;
        if ($reqEnd !== null && $offset > $reqEnd) break;
        $range = null;
        if ($suffixLen !== null && !$started) $range = 'bytes=-' . $suffixLen;
        elseif ($hasRange || $sent > 0) $range = 'bytes=' . $offset . '-' . ($reqEnd !== null ? $reqEnd : '');

        $status = 0; $hdrs = []; $abort = false;
        $ch = curl_init($cdn);
        curl_setopt_array($ch, [
            CURLOPT_FOLLOWLOCATION => true,
            CURLOPT_USERAGENT => STREAM_UA,
            CURLOPT_REFERER => 'https://prehraj.to/',
            CURLOPT_CONNECTTIMEOUT => 15,
            CURLOPT_TIMEOUT => 0,              // film může běžet hodiny
            CURLOPT_LOW_SPEED_LIMIT => 1,      // ...ale 30 s úplného ticha = spojení je mrtvé
            CURLOPT_LOW_SPEED_TIME => 30,
            CURLOPT_HTTPHEADER => array_values(array_filter([
                'Accept: */*',
                'Accept-Encoding: identity',
                $range !== null ? 'Range: ' . $range : null,
            ])),
            CURLOPT_HEADERFUNCTION => function ($ch, $line) use (&$status, &$hdrs) {
                $t = trim($line);
                if (stripos($t, 'HTTP/') === 0) {
                    $parts = explode(' ', $t, 3);
                    $status = (int) ($parts[1] ?? 0);
                    $hdrs = [];            // (po redirectu začínáme znovu)
                } elseif (strpos($t, ':') !== false) {
                    list($k, $v) = explode(':', $t, 2);
                    $hdrs[strtolower(trim($k))] = trim($v);
                }
                return strlen($line);
            },
            CURLOPT_WRITEFUNCTION => function ($ch, $data) use (
                &$status, &$hdrs, &$abort, &$sent, &$total, &$started, $download, $name
            ) {
                if ($status !== 200 && $status !== 206) { $abort = true; return 0; }
                if ($started && $status === 200) { $abort = true; return 0; } // CDN ignorovala Range
                if (!$started) {
                    http_response_code($status);
                    header('Content-Type: ' . ($hdrs['content-type'] ?? 'video/mp4'));
                    header('Accept-Ranges: bytes');
                    header('Cache-Control: no-store');
                    if (isset($hdrs['content-length'])) {
                        header('Content-Length: ' . $hdrs['content-length']);
                        $total = (int) $hdrs['content-length'];
                    }
                    if (isset($hdrs['content-range'])) header('Content-Range: ' . $hdrs['content-range']);
                    if ($download) {
                        $base = trim(preg_replace('/[\\\\\/:*?"<>|\x00-\x1f]+/u', ' ', $name !== '' ? $name : 'video'));
                        if ($base === '') $base = 'video';
                        $file = mb_substr($base, 0, 150) . '.mp4';
                        $ascii = preg_replace('/[^\x20-\x7e]|["\\\\]/', '_', $file);
                        header('Content-Disposition: attachment; filename="' . $ascii . "\"; filename*=UTF-8''" . rawurlencode($file));
                    }
                    $started = true;
                }
                echo $data;
                flush();
                $sent += strlen($data);
                return strlen($data);
            },
        ]);
        curl_exec($ch);
        $lastStatus = $status;
        curl_close($ch);

        if (connection_aborted()) exit;
        if ($status === 416) {
            if (!$started) { http_response_code(416); if (isset($hdrs['content-range'])) header('Content-Range: ' . $hdrs['content-range']); exit; }
            break;
        }
        if ($started && ($total === null || $sent >= $total)) break;  // hotovo (nebo neznámá délka -> navázat nejde)
        if ($abort && $started) break;                                // CDN neumí navázat

        // chyba CDN / utržené spojení -> příště čerstvý odkaz a jedeme dál od $sent
        $fresh = true;
        usleep(300000 * ($attempt + 1));
    }

    if (!$started) jsonError(['success' => false, 'error' => 'CDN returned HTTP ' . $lastStatus], 502);
    exit;
}

$proxies = effectiveProxies($SERVER_PROXIES);

// /api/catalog - filmy pro homepage z keyless iTunes RSS (cz výchozí / en), cache na 1 den.
// Stejná odpověď jako /api/catalog v Program.cs; frontend ji použije, když běží přes tenhle router.
function catalogResponse($lang) {
    $file = sys_get_temp_dir() . '/wtzi_catalog_' . $lang . '.json';
    if (is_file($file) && time() - filemtime($file) < 86400) {
        header('Content-Type: application/json; charset=utf-8');
        header('Cache-Control: public, max-age=3600');
        readfile($file);
        exit;
    }

    $store = $lang === 'en' ? 'us' : 'cz';
    list($code, $body) = curlText("https://itunes.apple.com/$store/rss/topmovies/limit=50/json", 20);
    if ($code < 200 || $code >= 300 || $body === '') {
        jsonError(['success' => false, 'error' => 'iTunes feed nedostupný: HTTP ' . $code], 502);
    }

    // žánry z feedu -> naše řádky/žánry na úvodní stránce (stejně jako CatalogGenres v Program.cs)
    $map = [
        'Action & Adventure' => ['Akční'],
        'Sci-Fi & Fantasy'   => ['Sci-fi', 'Fantasy'],
        'Kids & Family'      => ['Rodinné'],
        'Comedy'             => ['Komedie'],
        'Thriller'           => ['Thriller'],
        'Horror'             => ['Horror'],
        'Drama'              => ['Drama'],
        'Romance'            => ['Drama'],
    ];

    $d = json_decode($body, true);
    $entries = (isset($d['feed']['entry']) && is_array($d['feed']['entry'])) ? $d['feed']['entry'] : [];
    $items = [];
    $seen = [];
    foreach ($entries as $e) {
        $title = isset($e['im:name']['label']) ? (string)$e['im:name']['label'] : '';
        if ($title === '' || isset($seen[strtolower($title)])) continue;
        $seen[strtolower($title)] = true;

        $img = '';
        if (!empty($e['im:image']) && is_array($e['im:image'])) {
            foreach ($e['im:image'] as $im) {
                if (!empty($im['label'])) $img = (string)$im['label'];
            }
        }
        $img = preg_replace('#/\d+x\d+bb\.(?:png|jpe?g|webp)$#i', '/600x900bb.jpg', $img);

        $y = '';
        if (preg_match('/\((\d{4})\)$/', $title, $m)) {
            $y = $m[1];
        } elseif (!empty($e['im:releaseDate']['label'])) {
            $y = substr((string)$e['im:releaseDate']['label'], 0, 4);
        }

        $label = isset($e['category']['attributes']['label']) ? (string)$e['category']['attributes']['label'] : '';
        $items[] = [
            't' => $title,
            'y' => $y,
            'img' => $img,
            'q' => trim(preg_replace('/\s*\(\d{4}\)\s*$/', '', $title)),
            'g' => isset($map[$label]) ? $map[$label] : [],
        ];
    }

    if (count($items) === 0) jsonError(['success' => false, 'error' => 'Prázdný iTunes feed'], 502);

    $out = json_encode(['success' => true, 'lang' => $lang, 'count' => count($items), 'items' => $items],
        JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    @file_put_contents($file, $out);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: public, max-age=3600');
    echo $out;
    exit;
}

// --------------------------------------------------------------------------
// /api/subtitles - relay VTT titulků pro <track>
// Titulky jsou podepsané na CDN a nemusí posílat CORS; prohlížeč je proto načítá
// z naší domény. Soubor je malý (jednotky až stovky kB), takže relay nic nebolí.
function isValidSubtitleUrl($u) {
    if (!is_string($u) || $u === '') return false;
    $p = parse_url($u);
    if (!$p || !in_array($p['scheme'] ?? '', ['http', 'https'], true)) return false;
    $path = $p['path'] ?? '';
    if (strtolower(pathinfo($path, PATHINFO_EXTENSION)) !== 'vtt') return false;
    $host = strtolower($p['host'] ?? '');
    if ($host === '' || $host === 'localhost') return false;
    $ip = filter_var($host, FILTER_VALIDATE_IP) ? $host : gethostbyname($host);
    if (!filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE)) return false;
    return true;
}

function subtitleRelay() {
    $url = isset($_GET['url']) && is_string($_GET['url']) ? $_GET['url'] : '';
    if (!isValidSubtitleUrl($url)) jsonError(['success' => false, 'error' => 'Neplatná URL titulků']);

    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_TIMEOUT => 20,
        CURLOPT_USERAGENT => STREAM_UA,
        CURLOPT_REFERER => 'https://prehraj.to/',
        CURLOPT_ENCODING => '',
        CURLOPT_HTTPHEADER => ['Accept: text/vtt,text/plain;q=0.9,*/*;q=0.5'],
    ]);
    $body = curl_exec($ch);
    $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $err = curl_error($ch);
    curl_close($ch);

    if ($err !== '' || !is_string($body) || $code < 200 || $code >= 300) {
        jsonError(['success' => false, 'error' => 'Titulky se nepodařilo načíst: '
            . ($err !== '' ? $err : 'HTTP ' . $code)], 502);
    }
    if (strlen($body) > 1000000) jsonError(['success' => false, 'error' => 'Titulky jsou příliš velké'], 413);
    $body = ltrim($body, "\xEF\xBB\xBF \t\r\n");
    if (stripos($body, 'WEBVTT') !== 0)
        jsonError(['success' => false, 'error' => 'Zdroj nevrátil WebVTT titulky'], 502);

    header('Content-Type: text/vtt; charset=utf-8');
    header('Cache-Control: private, max-age=1800');
    echo $body;
    exit;
}

switch ($path) {
    case '/api/search':
        $q = $_GET['q'] ?? '';
        $qs = 'action=search&q=' . rawurlencode($q);
        if ($proxies) sendRaceWinner(viaProxyRace($proxies, $qs, 30));
        // proxy selhaly (429 atd.) -> jedeme přímo přes index.php na tomhle serveru
        $_GET['action'] = 'search';
        require __DIR__ . '/index.php';
        return true;

    case '/api/thumb':
        if ($proxies) {
            $q = $_GET['q'] ?? ''; $t = $_GET['t'] ?? ''; $re = $_GET['re'] ?? '';
            $src = ($_GET['src'] ?? '') === 'itunes' ? 'itunes' : 'prehraj';
            $qs = 'action=thumb&q=' . rawurlencode($q) . '&t=' . rawurlencode($t)
                . '&re=' . rawurlencode($re) . '&src=' . $src;
            if (isset($_GET['y']) && $_GET['y'] !== '') $qs .= '&y=' . rawurlencode($_GET['y']);
            sendRaceWinner(viaProxyRace($proxies, $qs, 40));
        }
        $_GET['action'] = 'thumb';
        require __DIR__ . '/index.php';
        return true;

    case '/api/proxy':
        $url = $_GET['url'] ?? '';
        if ($url === '') jsonError(['success' => false, 'error' => 'Missing url parameter']);
        if (!isPrehrajUrl($url)) jsonError(['success' => false, 'error' => 'URL must be from prehraj.to']);
        if ($proxies) sendRaceWinner(viaProxyRace($proxies, 'url=' . rawurlencode($url), 30));
        $_GET['action'] = 'video';
        require __DIR__ . '/index.php';
        return true;

    case '/api/subtitles':
        subtitleRelay();
        exit;

    case '/api/stream':
        // Video jde vždy přímo z tohohle zařízení (stejná IP odkaz získá i stáhne);
        // PHP proxy servery se použijí jen jako záloha pro získání odkazu.
        streamRelay(array_values(array_unique(array_filter($SERVER_PROXIES, 'isValidProxyUrl'))));
        exit;

    case '/api/catalog':
        catalogResponse((isset($_GET['lang']) && $_GET['lang'] === 'en') ? 'en' : 'cz');
        exit;
}

// Cokoliv jiného = statické soubory z wwwroot (docroot, -t)
return false;
