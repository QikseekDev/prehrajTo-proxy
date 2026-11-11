# Wflix 🎬

[![Uptime Status](https://img.shields.io/uptimerobot/status/m801943371-78c6e4351b1a34cc26858090?label=Azure%20App&style=flat-square)](https://stats.uptimerobot.com/oMZ6zgtbxR)

Proxy pro přehrávání videí z Prehraj.to z libovolné lokace.

**Autor:** Vojtěch Vokoun · [contact@qikseek.qzz.io](mailto:contact@qikseek.qzz.io)
(fork původního projektu, viz [Kredit](#kredit))

## Architektura

```
Uživatel (kdekoli) → Azure App Service (HTTPS) → PHP proxy (CZ hosting) → prehraj.to
```

Backend v `Program.cs` **prehraj.to nikdy nevolá přímo** – každý dotaz jde na PHP proxy
(serverový seznam z `appsettings.json`, nebo ty, které pošle prohlížeč). Důvod: z datacentrové IP
Azure prehraj.to vrací captcha stránku, která se tváří jako platná odpověď, ale nenajde nic.
PHP servery z české IP vrací skutečné výsledky.

> ⚠️ prehraj.to blokuje zahraniční IP. Appka proto posílá každý dotaz přes PHP proxy níže – region
> Azure ani IP, ze které běží, tím pádem nerozhoduje.

### PHP proxy
`index.php` v rootu se nasazuje na český hosting (klidně víc hostingů zároveň) a appka přes ně
posílá každý dotaz na prehraj.to. Přepínač, kterým by se proxy daly vypnout, neexistuje: přímé
volání prehraj.to v .NET appce není, protože z datacentrové IP vrací captcha stránku.

Seznam serverů jsou dvě vrstvy, které se doplňují:

**1. Prohlížeč (`DEFAULT_PROXY_SERVERS` v `wwwroot/script.js`)** – appka pošle `&proxy=<url>` pro každý
server v seznamu a tenhle seznam **přebije** serverový. Je to výchozí chování pro všechny
návštěvníky a v Nastavení se needituje (tam jsou jen katalog úvodní stránky a limit náhledů).

**2. Server (`appsettings.json` / Azure)** – použije se, když prohlížeč nepošle nic (stránka
z cache prohlížeče, API klient bez `&proxy`). V `appsettings.json`:
```json
"Prehraj": {
  "ProxyUrls": [
    "http://wtzi.borec.cz/index.php",
    "http://wtzi.euweb.cz/index.php",
    "http://wtzi.chytrak.cz/index.php"
  ]
}
```
Další server = další řádek do pole. V Azure (Configuration → Application settings) se totéž pole
nastaví přes indexované klíče: `Prehraj__ProxyUrls__0`, `Prehraj__ProxyUrls__1`,
`Prehraj__ProxyUrls__2`, … (`Prehraj__ProxyUrl` bez `s` pořád funguje jako zkratka pro jediný).
Když není k dispozici ani jeden server, endpoint vrátí chybu `Všechny zdroje selhaly: …` – appka
bez proxy nefunguje, náhradní přímá cesta v .NET verzi neexistuje.

V obou případech platí totéž chování: servery se zkouší **postupně** v pořadí – první, který vrátí
použitelnou odpověď (2xx + neprázdné tělo), vyhrává. Mrtvý nebo zaplněný server (timeout, 4xx/5xx,
prázdné tělo) se přeskočí a zkusí se další. Odpověď `200` s tělem `{"success":false,…}` je taky
chyba – přesně takhle PHP proxy předává 429 z prehraj.to, takže se přejde na další server.
Server, který naposledy fungoval, jde příště na začátek, takže výpadek jedné proxy stojí jen jeden
timeout. Neplatné (ne-http/https) hodnoty backend tiše ignoruje.

Který server dotaz zrovna obsloužil, posílá backend prohlížeči v hlavičce `X-Wflix-Proxy`
(`router.php` posílá `direct`, když jede bez proxy). Hlavička zůstává na diagnostiku (curl,
DevTools), appka ji v UI nikde neukazuje. Failover poznáš jen podle toho, že první dotaz po
přepnutí může být pomalejší, protože se čeká na timeout mrtvého serveru.

### Přidání/úprava serverů jedním příkazem
```bash
./scripts/change-proxy-servers.sh
```
Otevře `proxy-servers.txt` v `nano` (jiný editor přes `EDITOR=vim ...`), po uložení a zavření
seznam ověří (musí to být `http://`/`https://` URL) a promítne ho najednou do `script.js`
(`DEFAULT_PROXY_SERVERS`), `appsettings.json` (`Prehraj.ProxyUrls`) i `router.php`
(`$SERVER_PROXIES`) - needituj ty tři bloky ručně zvlášť. `./scripts/change-proxy-servers.sh
--no-edit` jen pushne aktuální obsah `proxy-servers.txt` bez otevření editoru (hodí se ze
skriptu/CI). Potřebuje `python3` v PATH (jen na čisté přepsání `appsettings.json`).

## Živé vysílání (IPTV)

V liště je tlačítko **Živě**. Kanály se berou z [iptv-org](https://github.com/iptv-org/iptv) – jeden
playlist na zemi nebo jazyk:

| Volba v UI | Co se stáhne |
|---|---|
| Česko (`cz`) | `iptv-org.github.io/iptv/countries/cz.m3u` – 107 kanálů |
| Čeština (`lang=ces`) | `iptv-org.github.io/iptv/languages/ces.m3u` |
| Slovensko (`sk`) | `countries/sk.m3u` |
| USA (`us`) | `countries/us.m3u` – přes 1 400 kanálů |
| Anglie / VB (`uk`) | `countries/uk.m3u` – Velká Británie má v iptv-org kód `uk`, ne `gb` |

Sestavené seznamy (`countries/…`) obsahují navíc `tvg-logo` a `group-title`, takže dlaždice mají loga
a kategorii. Když sestavený seznam selže, appka zkusí raw `streams/xx.m3u`. Dlouhé seznamy se
v UI vykreslují po 300 kanálech (tlačítko „Zobrazit další“), aby se telefony nezadusily.

Dlaždice nesou odznak kvality (`1080p`, `720p`, …) a tagy, které playlist sám uvádí: **`geo blok`**
(kanál pustí jen IP dané země) a **`ne 24/7`** (nevysílá nonstop). Nad mřížkou jdou stejné věci
filtrovat: `1080p`, `Bez geo bloku`, `Jen 24/7`; filtry se násobí a `Vše` je zruší.

Některé kanály v playlistu vyžadují konkrétní prohlížeč nebo Referer – ať už jako atribut
`http-user-agent="…"` v `#EXTINF`, nebo jako řádek `#EXTVLCOPT:http-user-agent=…` /
`#EXTVLCOPT:http-referrer=…` před URL. Server to přečte a takový kanál posílá **vždy přes relay**
(`/api/live/hls?url=…&ua=…&referrer=…`), protože prohlížeč u `<video>` hlavičky nastavit neumí.
Hlavičky se přenášejí i do přepsaných segmentů, takže funguje i samotné přehrávání, ne jen playlist.

Playlist tahá server (`/api/live`) a posílá do prohlížeče jen jméno, skupinu, logo a URL. HLS pak
přehrává `hls.min.js` (přibalený v `wwwroot`, načítá se až při otevření kanálu; Safari/iOS použije
nativní HLS). Když zdroj nepošle CORS hlavičky, zkusí se stejný kanál přes `/api/live/hls`. S vypnutým Přímým
přehráváním se relay použije hned; se zapnutým (výchozí) se po chybě nejdřív zkusí přímé přehrání
znovu a teprve pak se pro tenhle kanál dočasně přepne na relay. Nastavení se nemění. Kanály vyžadující
vlastní hlavičky jdou přes relay vždy.
Přímé HLS přehrávání spoléhá na to, že playlist předá platné (i relativní) adresy segmentů a klíčů; když
CDN vyžaduje token v query každého segmentu a playlist ho nepředává, přímé přehrání neprojde a je potřeba relay.

Vlastní playlist (IPTV od poskytovatele) jde přidat konfigurací: `Prehraj:LivePlaylists` jako pole URL
(Azure: `Prehraj__LivePlaylists__0`, `__1`, …) a pak `GET /api/live?custom=0`. Z prohlížeče se
libovolná URL nenačítá, aby appka nebyla otevřený proxy pro cokoli.

> Kanály jsou cizí streamy, které appka jen zprostředkovává – část z nich je geoblokovaná na ČR,
> část je neoficiální re-stream a může kdykoli přestat fungovat. Když kanál nenaskočí, je to vlastnost
> zdroje, ne chyba přehrávače.

## Limity a ochrana proti scrapingu

Appka je veřejná a bez přihlášení, takže `/api/*` má dvě vrstvy ochrany (obojí v `Program.cs`):

**1. Rate limiting** – built-in `AddRateLimiter`, token bucket zvlášť pro každou IP:

| Policy | Endpointy | Trvale | Dávka (burst) |
|---|---|---|---|
| `search` | `/api/search` | 5 dotazů/s | 20 |
| `api` | `/api/proxy`, `/api/stream`, `/api/catalog` | 6/s | 20 |
| `subs` | `/api/subtitles` | 20/s | 60 |
| `thumb` | `/api/thumb` | 10/s | 40 |
| `live` | `/api/live/hls` | 40/s | 120 |
| `admin` | `/api/admin/*` | 10/s | 30 |

Dávka je tam proto, že úvodní stránka posílá náhledy všech viditelných posterů najednou a přehrávač
při seekování pošle několik Range dotazů v jedné vlně – s holým „3/s“ by se appka rozbila sama sobě.
Překročení vrací `429` + `Retry-After: 20` a JSON `{"success":false,"error":"…"}`, který UI zobrazí
jako běžnou chybu hledání. Za App Service se IP bere z `X-Forwarded-For` (`UseForwardedHeaders`),
jinak by všechny požadavky měly IP front-endu Azure a limit by platil pro celý internet dohromady.

**Hledání se sdílí a dávkuje.** prehraj.to pustí z jedné IP zhruba 5 hledání za 10 s a pak na
~20 s vrací 429. Všechny PHP proxy servery se přitom chovají jako jedna IP (po 429 na jednom
vrátí 429 i ostatní), takže přeskakování na další server u 429 nemá smysl. `/api/search` proto
drží výsledky ve sdílené cache (30 min, prázdné 5 min, při 429 se vrátí i starší kopie) a dotazy
na prehraj.to pouští po jednom s odstupem 1,6 s (`PacedFirstWorking`). Cache se použije i když
prohlížeč pošle `&proxy=…` – sada proxy je součástí klíče, takže stejný dotaz obslouží všechny
diváky (dřív se cache kvůli parametru `proxy` nepoužila vůbec). Při 429 z prehraj.to se stejný zdroj zkusí nejvýš 2× a čeká se až 20 s; když je fronta delší než 20 s,
vrátí se `rateLimited` a klient to sám po pár vteřinách zopakuje.

**2. Nic se neblokuje podle hlaviček** – `/api` nekontroluje User-Agent, `Sec-Fetch-Site` ani
`Referer`. Dřív tu byl deny-list nástrojů (curl, python-requests, okhttp…) plus požadavek na
vlastní `Referer`, ale to zároveň blokovalo WebView v mobilní appce a jiné klienty, kteří tyhle
hlavičky neposílají – dostávali `403` a appka vypadala rozbitá. Scraping teď brzdí jen limity
výš, statické soubory se nelimitují vůbec, takže funguje i uptime monitoring a `curl` na
`/api/search?q=matrix` vrátí normální JSON.

## Admin panel

`/admin` na .NET backendu – jedna stránka (`wwwroot/admin.html`), žádný build ani závislosti.
Ovládá **běžící** instanci: změna platí do sekundy, bez restartu a bez nového nasazení.
Kód ani `appsettings.json` se nemění, stav je JSON soubor.

**Zapnutí.** Nastav `ADMIN_PASSWORD` (App Service → Configuration → Application settings) a
restartuj appku. Je to obyčejné heslo – jakékoli, které si zvolíš; do repa se neukládá a nikdy
patřit nemá. Bez něj `/admin` i celá `/api/admin` vrací `503`.

| proměnná | význam | výchozí |
|---|---|---|
| `ADMIN_PASSWORD` | heslo do panelu; prázdné = admin vypnutý (starší název `ADMIN_TOKEN` funguje dál) | – |
| `ADMIN_STATE_PATH` | kam ukládat `state.json` a `audit.jsonl` | `$HOME/wflix-admin/`, jinak `App_Data/` |
| `WFLIX_PURGE_TOKEN` | stejná hodnota na PHP proxy, povolí `action=purge` | – |

### Co panel umí

**Vypínače** (platí hned, vynucuje server – ne jen UI):

| vypínač | co vypne |
|---|---|
| Údržba + hláška | `/api/*` kromě `/api/config`, `/api/health`, `/api/admin` → `503` s hláškou |
| Stahování | `/api/stream?download=1` → `403`; přehrávání přes server funguje dál |
| Živé vysílání | `/api/live`, `/api/live/countries`, `/api/live/hls` → `503` |
| HLS relay | jen `/api/live/hls` (seznam kanálů a přímé přehrávání zůstávají) |
| Více výsledků | `source=all` degraduje na jeden zapnutý zdroj |
| Náhledy z iTunes | katalog a plakáty z prehraj.to fungují dál |

**Zdroje** – zapnout/vypnout `prehraj.to`, `sledujteto.cz`, `bombuj.si`, automatický fallback a
strop stránek (`maxPage`). Vypnutý zdroj vrátí `400` s českou hláškou, takže je vidět, že jde o
vědomé vypnutí, a ne o rozbitou appku. Když prehraj.to sype 429, vypneš ho a jede sledujteto.

**Cache** – počty položek, zásahy (hit rate) a mazání po oblastech: hledání, náhledy, katalog,
živé, CDN odkazy, nebo všechno. Server umí mazat podle prefixu jen díky vlastní evidenci klíčů
(`WflixCache`), samotný `IMemoryCache` to neumí. Volitelně se pošle `action=purge` i na PHP proxy
servery (mají vlastní cache v `sys_get_temp_dir()`), ale jen těm, které mají `WFLIX_PURGE_TOKEN`.

**Bany** – dočasné zablokování IP nebo klienta (`cid` z `localStorage`) na zadaný počet minut,
s rušením a seznamem nejaktivnějších klientů za posledních pár minut. Rate limit scraping jen
zpomalí, ban ho zastaví; `/api/admin` a `/admin` zůstávají dostupné, aby se dal ban zrušit.

**Ops** – běžící build a commit, uptime, online uživatelé, počítadla 5xx/429 od startu procesu,
 audit změn (`audit.jsonl`) a tlačítko „Otestovat zdroje a proxy“, které projde prehraj.to,
sledujteto, bombuj.si, iTunes, iptv-org a prvních šest proxy (`/api/health` používá stejný kód).

### Bezpečnost

Heslo se nikdy neposílá v URL ani se neukládá do stránky: login ho vymění za podepsanou cookie
(HMAC-SHA256, 12 h, `HttpOnly`, `SameSite=Strict`) a každý zápis navíc vyžaduje hlavičku
`X-Wflix-CSRF` s tokenem z druhé (čitelné) cookie – double submit. Po 5 špatných zadáních hesla
z jedné IP je přihlášení na 10 minut zavřené, `/api/admin` má vlastní rate limit a stránka posílá
`X-Robots-Tag: noindex`. Stav se ukládá mimo repo (`$HOME/…`), zapisuje se atomicky přes `.tmp`
+ `File.Move` a načítá se při změně souboru, takže se dá upravit i ručně.

### Limity

- **PHP self-host panel nemá.** `index.php` ani `router.php` admin neznají – přibyl v nich jen
  `action=purge` (`?action=purge&scope=all|search|thumb&token=…`, `WFLIX_PURGE_TOKEN`), aby panel
  mohl mazat i cache na hostinzích. Zbytek nastavení jde jen na .NET backendu.
- **Stav je lokální pro instanci.** `state.json` leží v `$HOME` kontejneru, takže při víc instancích
  App Service má každá svůj (a ban/maintenance platí jen na té, kterou zrovna trefíš). Na free tieru
  je instance jedna; při scale-out nastav `ADMIN_STATE_PATH` na sdílený mount.
- **Žádný redeploy, žádná správa proxy ani IPTV.** Panel záměrně neumí spouštět nasazení a needituje
  seznam proxy/IPTV kanálů – na to je git a `proxy-servers.txt`, ne tlačítko v prohlížeči.
- **Heslo jde do prostředí, ne do kódu.** Panel ho čte jen z `ADMIN_PASSWORD`; kdyby bylo
  v `appsettings.json` nebo v `admin.html`, vidí ho každý, kdo vidí repo.
- **Mobilní klienti `/api/config` nečtou** (APK/IPK ho neznají), takže hlášku o údržbě uvidí jen
  web. Vynucení je ale na serveru, takže vypnuté stahování/živé vysílání dostanou i oni (`403`/`503`).

## Komponenty

### `/azure-app/PrehrajtoProxy/`
ASP.NET Core 9.0 aplikace hostovaná na Azure App Service.

- **Frontend** (`wwwroot/index.html`, `wwwroot/styles.css`, `wwwroot/script.js`) - Wflix, UI ve stylu
  streamovací služby: katalog doporučených filmů, vyhledávání, přehrávač s volbou titulků. `index.html`
  obsahuje značku, `styles.css` vzhled a `script.js` logiku. Nastavení je vlastní stránka
  (avatar vpravo nahoře) a nabízí katalog úvodní stránky, limit souběžných náhledů, Přímé
  přehrávání z CDN, světlý režim a styl titulků – proxy pro prehraj.to jsou vždy zapnuté a zdroj
  náhledů je vždy prehraj.to.
  Knihovna (odkaz v liště před Živě) je taky stránka: historie přehrávání s odebráním po jednom,
  smazáním celé historie a přepínačem „Ukládat historii přehrávání“, pod ní oblíbené. Vše se
  ukládá jen do prohlížeče – `localStorage` (`wflix-history`, `wflix-favs`, `wflix-settings`),
  žádný účet ani server.
- **API Endpoints**:
  - `GET /api/search?q={query}[&source=prehrajto|bombuj|sledujteto|all][&fallback=0]` - Vyhledávání filmů.
    Výchozí zdroj je `prehrajto` (zpětně kompatibilní). Při prázdném výsledku/chybě `prehrajto` se
    automaticky zkusí `sledujteto` jako fallback a výsledky se sloučí s deduplikací (vypne se `fallback=0`).
    `all` (aliasy `merge`/`both`, experimentální) hledá na `prehraj.to`, `sledujteto` a `bombuj` současně/omezeně a výsledky
    sloučí s deduplikací. Když jeden zdroj selže, pokračuje se s ostatními; chyba se vrátí jen když selžou všechny.
    Ve web UI jde zapnout volitelně v Nastavení → Vyhledávání („Více výsledků“).
    `bombuj` hledá přes `bombuj.si` (autocomplete endpoint z `uvod.php`, dynamicky zjištěný).
    `sledujteto` zkouší API endpointy `https://www.sledujteto.cz/api/web/videos` / `https://sledujteto.cz/api/web/videos`
    (primárně) a `old.sledujteto.cz` jako zálohu, s `page`/`query`/`limit`/`sort=relevance`; běží přes PHP proxy
    (česká IP). HTML stránka `https://www.sledujteto.cz/vyhledat/?search=...&page=...` je JS-renderovaná,
    takže server-side se parsuje API varianta. Prehraj.to vrací třicítku, kterou stránka hledání nabízí.
  - `GET /api/proxy?url={page_url}[&source=prehrajto|bombuj|sledujteto]` - Získání URL videa/resolve stránky
    (a seznamu VTT titulků, pokud je stránka má). Pro `prehrajto` extrahuje CDN URL; pro `bombuj`/`sledujteto`
    vrací best-effort nalezené stream/embed URL (přímý stream nemusí být ve statickém HTML vždy dostupný).
  - `GET /api/stream?url={prehrajto_url}[&download=1&name={titul}]` - Server video přeposílá z CDN (podporuje Range/seeking)
    a sám obnovuje vypršelý odkaz, takže se přehrávání ani stahování nezasekne po pár minutách. Používá se pro
    stahování, ruční přehrání přes server a jako záložní cesta, když přímé přehrávání z CDN neprojde. S `download=1` se
    posílá jako příloha (tlačítko ⬇ Stáhnout video). Neumí HLS (`.m3u8`). Pozor na přenesená data: na Azure
    (zvlášť free tier) se tím video počítá do odchozího provozu, na self-hostu (Termux) je to zadarmo.
  - `GET /api/config` - Veřejná konfigurace pro klienty: `maintenance` + `message` a stav vypínačů
    (`flags.downloads`, `live`, `liveRelay`, `mergeSources`, `itunesThumb`). Web podle toho ukáže
    hlášku o údržbě a schová tlačítko Stáhnout; rozhodující je vždy vynucení na serveru. Když admin
    není nastavený, vrací výchozí (vše zapnuté) hodnoty.
  - `GET /api/subtitles?url={vtt}` - Relay WebVTT titulků pro `<track>`; jen http/https `.vtt`, max. 1 MB,
    s Refererem prehraj.to. Titulky se načítají z naší domény, takže neřešíme CORS ani expiraci CDN odkazu.
  - `GET /api/live?country={kód}[&lang={kód}][&custom={index}]` - Seznam IPTV kanálů (viz [Živé vysílání](#živé-vysílání-iptv)).
  - `GET /api/live/hls?url={playlist}` - Záložní relay HLS playlistu pro zdroje bez CORS; přepisuje playlist,
    segmenty i klíče na sebe, takže prohlížeč nikdy nesahá mimo naši doménu. Neveřejné adresy (localhost, 10.x,
    192.168.x) odmítá.
  - `GET /api/thumb?q={query}[&t={titul}][&y={rok}][&re={regex}][&src=itunes]` - Jen thumbnail pro homepage. Výchozí regex je `query*`
    (každé významné slovo z `q`/`t` jako začátek slova v názvu/slugu, bez diakritiky, pořadí je jedno); `re` ho přepíše.
    Výsledek se cachuje na serveru (týden, nenalezené hodinu) – i když ho vrátí PHP proxy – a souběžné
    stejné dotazy se slučují do jednoho. Prohlížeč náhledy pouští až po načtení katalogu z `/api/catalog`,
    aby se při studeném startu neposlaly desítky hledání na prehraj.to jen na plakáty (ta hledání pak
    chybí u vyhledávání, protože mají společnou kvótu).
    Volitelný limit souběžných dotazů (výchozí: bez limitu): server `Prehraj:ThumbConcurrency` (Azure `Prehraj__ThumbConcurrency`),
    aplikace: avatar vpravo nahoře → Nastavení → „Omezit souběžné dotazy na náhledy“ (výchozí vypnuto, uloží se v prohlížeči).
    Náhledy se vždycky berou z prehraj.to a vypnout se nedají. `src=itunes` je jen pro volání API – hledá
    plakát přes keyless iTunes Search API (záloha: prehraj.to); UI tuhle volbu nenabízí, katalog si plakáty
    z iTunes tahá sám.

**Přehrávání** (`wwwroot/script.js`): video se napřed pustí napřímo z CDN. Když se zasekne / vyhodí chybu / skončí
předčasně (odkaz z CDN vyprší), appka si vezme čerstvý odkaz a naváže od stejného místa; po dvou neúspěšných
pokusech přepne na `/api/stream`.

V Nastavení je přepínač **Přímé přehrávání z CDN** (výchozí: zapnuto). Zapnutý přehrává video i HLS
přímo ze zdroje; když přímé přehrávání opakovaně selže, appka pro **to jedno** přehrávání (film nebo
kanál) dočasně přejde na server a příště zkusí CDN znovu. Nastavení se přitom nemění, takže se server
nepoužívá, dokud je přímá cesta funkční. Vypnutý přehrává rovnou přes server (užitečné pro zdroje,
které přímé přehrávání nepodporují). Tlačítko Stáhnout jde vždy přes `/api/stream`, protože přímý CDN
odkaz se stáhnout nedá. Volba se ukládá do `localStorage` (`wflix-settings`).

Když má film titulky, PHP proxy je vytáhne z inicializace přehrávače (Video.js/JWPlayer `tracks`)
do pole `subtitles` v odpovědi `/api/proxy`. Přehrávač je načte přes `/api/subtitles` a pod videem
nabídne volbu **Titulky** (Vypnuto / jazyky). VTT relay je malý, takže se do limitu přenesených dat
téměř nepromítne. **Titulky se objeví jen po nahrání nového `index.php` na PHP proxy servery
a nového .NET buildu** – starý proxy `subtitles` nevrací a starý backend `/api/subtitles` nezná.

### `/index.php`
PHP proxy pro český hosting – bez něj se .NET verze k prehraj.to nedostane (viz výše).
Hledání se v něm cachuje do `sys_get_temp_dir()` na 30 min (prázdné 5 min) a při 429 z prehraj.to
vrátí i starší kopii, takže stejný dotaz nejde na prehraj.to znovu pro každou instanci appky ani po
restartu. Po úpravě `index.php` je potřeba ho znovu nahrát na všechny proxy hostingy.

Navíc má `index.php` akci `?action=purge&scope=all|search|thumb&token=…`, kterou volá admin panel,
aby smazal cache i na hostinzích. Funguje jen když je na hostingu nastavený `WFLIX_PURGE_TOKEN` a
token v požadavku sedí (`hash_equals`); bez proměnné vrací `403`. Nikdy tam nedávej `ADMIN_TOKEN` –
proxy jedou po plain http, takže by token do panelu šel po drátě v čitelné podobě.

## Self-host bez Azure (Termux / Linux)

Celé to jde provozovat jen přes PHP, bez Azure a bez .NET. Navíc požadavky na prehraj.to
půjdou z tvého zařízení (česká IP), takže odpadá geo-blokace.

```bash
# Termux: pkg install git php   (start-termux.sh si PHP doinstaluje sám)
./start-termux.sh                 # http://127.0.0.1 (port 80, jen tenhle telefon)
HOST=0.0.0.0 ./start-termux.sh    # dostupné i z jiných zařízení ve Wi-Fi
PORT=9000 ./start-termux.sh       # jiný port
```

Běží to přes `router.php` (vestavěný PHP server): `/` je Wflix a `/api/search`, `/api/proxy`,
`/api/thumb`, `/api/stream` i `/api/subtitles` používají logiku z `index.php`.

`router.php` obsluhuje i `/api/subtitles` (relay VTT), takže titulky fungují i v self-hostu: seznam, který prohlížeč posílá
(`&proxy=...` z `DEFAULT_PROXY_SERVERS` v `script.js`), přebije lokální seznam `$SERVER_PROXIES` na začátku
souboru. Ten je záměrně prázdný: self-host typicky běží na české IP, takže v tuhle chvíli volá
prehraj.to přímo z daného zařízení a proxy nepotřebuje. Když zařízení českou IP nemá, doplň sem
seznam serverů.

> Nevystavuj `HOST=0.0.0.0` do veřejného internetu - je to bez přihlášení.

## Živá verze

Provozní URL sem záměrně nepatří – appka je sdílená jen s přáteli. Když ji potřebuješ,
vyptej se provozovatele ([contact@qikseek.qzz.io](mailto:contact@qikseek.qzz.io)).

## Funkce

- 🔍 Vyhledávání filmů a seriálů
- 🎥 Přehrávání videí přímo v prohlížeči
- ⏱ Knihovna s historií přehrávání (pozice v `localStorage`), mazání po jednom i celé
- ⏸ Vypínač ukládání historie – nic se pak neposílá ani neukládá
- ⭐ Oblíbené (watchlist) se záložkou u každého titulu a filtrovatelným seznamem v Knihovně
- ⌨️ Klávesové zkratky přehrávače (mezerník, šipky, F)
- 🪟 Obraz v obraze (Picture-in-Picture)
- 📺 Přehrát na TV (Chromecast / AirPlay na webu, přenos obrazovky v Android aplikaci)
- 💬 Volba velikosti a pozadí titulků
- 🌗 Světlý a tmavý režim
- 📝 Titulky (WebVTT) u filmů, které je mají
- 📱 Responzivní design (mobil, tablet, desktop)
- 📺 Živé vysílání – IPTV kanály (Česko, čeština, Slovensko)
- 🎬 Filmový úvodní podpis se zvukem
- 🔗 Sdílení odkazů na konkrétní videa
- ⬅️ Navigace zpět/vpřed v prohlížeči

## Technologie

- **Backend**: ASP.NET Core 9.0, PHP 8
- **Frontend**: HTML5, CSS3, Vanilla JavaScript
- **Hosting**: Azure App Service, Webzdarma.cz
- **Video**: HTML5 Video Player, hls.js pro živé vysílání (`wwwroot/hls.min.js`)

## Lokální vývoj

```bash
# ASP.NET aplikace
cd azure-app/PrehrajtoProxy
dotnet run

# Otevři http://localhost:5218
```

## Deploy

### Azure App Service
```bash
cd azure-app/PrehrajtoProxy
dotnet publish -c Release -o ./publish
cd publish && zip -r ../deploy.zip .
# Upload deploy.zip přes Kudu API
```

### MonsterASP.NET (free, GitHub Actions)
Push do `main` sestaví backend na GitHub Actions a nasadí ho přes Web Deploy na oba weby –
**Wflix** (`site104887`) a **WTZI** (`site104437`) – zdarma, bez placeného auto-deploy webhooku.
Workflow: `.github/workflows/deploy-monsterasp.yml`.
Nastavení (WebDeploy v panelu, dvě hesla v GitHub secrets, limity free plánu):
[`azure-app/DEPLOY-MONSTERASP.md`](azure-app/DEPLOY-MONSTERASP.md).

### PHP Proxy
Upload `index.php` na český hosting přes FTP.

---

## Právní upozornění (Disclaimer)

Tento projekt je pouze technický proxy server a přehrávač. **Nehostuje, neukládá ani nenabízí žádný obsah.** Veškerá videa a IPTV kanály pocházejí od třetích stran (Prehraj.to a veřejné playlisty) a jejich dostupnost ani legalita nejsou pod kontrolou autora.

- Projekt není nijak spojen s Prehraj.to ani s poskytovateli IPTV playlistů a není jimi schválen ani podporován.
- Za dodržování zákonů a autorských práv platných ve tvé zemi odpovídá uživatel.
- Veřejnou instanci provozuješ na vlastní odpovědnost.
- Autor nenese odpovědnost za jakékoli použití ani zneužití tohoto softwaru.
- Software je poskytován „tak, jak je", bez jakékoli záruky (viz [LICENSE](LICENSE)).

*EN: This project is a technical proxy and player only. It does not host, store or distribute any content. All videos and IPTV streams come from third parties. It is not affiliated with Prehraj.to or any IPTV provider. Users are responsible for complying with the laws and copyright rules of their country. Provided "as is", without warranty.*

---
## Kredit

Tenhle fork spravuje **Vojtěch Vokoun** – [contact@qikseek.qzz.io](mailto:contact@qikseek.qzz.io).

Původní projekt napsal **Jiřík**; od něj je základ aplikace.

Úvodní animace (`wwwroot/intro.css`) vychází z ukázky [codevkn/netflix-intro_html_css](https://github.com/codevkn/netflix-intro_html_css), převedené z N na W.

---

## Licence

MIT
