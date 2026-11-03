# WTZI – provozní příručka pro práci v repu

Appka, která přehrává videa z prehraj.to z jakékoli IP. Řetěz je vždy stejný:

```
prohlížeč → Azure App Service (.NET, Program.cs) → PHP proxy na CZ hostingu (index.php) → prehraj.to
```

Prohlížeč ani Azure **nikdy nevolají prehraj.to přímo**. Z datacentrové IP vrací prehraj.to captcha
stránku, která vypadá jako platná odpověď, ale nenajde nic. Tohle je důvod existence celého projektu,
ne detail implementace.

## Železná pravidla

1. **Žádný přímý fetch na prehraj.to.** Ani z backendu, ani z JS. Každý dotaz jde přes seznam PHP proxy.
2. **Seznam proxy má jeden zdroj pravdy:** `proxy-servers.txt`. Do `index.html` (`DEFAULT_PROXY_SERVERS`),
   `appsettings.json` (`Prehraj.ProxyUrls`) a `router.php` (`$SERVER_PROXIES`) ho promítá
   `scripts/change-proxy-servers.sh` (přes `scripts/apply_proxy_servers.py`). Neupravuj ty tři bloky ručně,
   rozejdou se. Markery `// PROXY-SERVERS:BEGIN` / `END` v `index.html` nemaž, skript je hledá.
3. **UI je česky**, včetně chybových hlášek, a vypadá jako streamovací služba. Neměň to na angličtinu
   ani na “admin” vzhled.
4. **Žádné frameworky ani CDN.** Jeden statický `index.html` s CSS a JS uvnitř, vanilla JS. Nepřidávej
   React, Tailwind, Google Fonts ani knihovny z CDN.
5. **Nikdy necommituj živou URL appky** (`wtzi.runasp.net`), credentials, klíče ani `.env`. Kontakt
   patří jen do README a patičky (`contact@qikseek.qzz.io`).
6. **Build musí projít s `-warnaserror`** – deploy build warningy shodí.
7. **Neodstraňuj rate limiting ani bot guard** z `Program.cs`. Jsou to jediné věci, které reálně brzdí
   scraping; statické soubory zůstávají bez limitu kvůli uptime monitoringu.
8. **Patička a právní stránky jsou součástí jedné stránky** (`PAGES` + `#pageSection`), ne samostatné
   HTML soubory. Nová stránka = nový klíč v `PAGES` a tlačítko v patičce.

## Mapa repa

| Cesta | Co to je |
|---|---|
| `azure-app/PrehrajtoProxy/Program.cs` | Celý backend: proxy řetěz, endpointy, cache, rate limiting, bot guard (778 řádků, žádné jiné .cs soubory) |
| `azure-app/PrehrajtoProxy/wwwroot/index.html` | Celý frontend: `<style>`, markup i jeden `<script>` v jednom souboru |
| `azure-app/PrehrajtoProxy/appsettings.json` | `Prehraj.ProxyUrls`, `Prehraj.ThumbConcurrency`, logování |
| `index.php` | PHP proxy pro český hosting; `?action=search\|thumb\|stream\|validate` |
| `router.php` | Self-host router pro vestavěný PHP server (`/` + `/api/*` se stejnou logikou jako .NET) |
| `proxy-servers.txt` | Lidsky čitelný seznam proxy (zdroj pravdy) |
| `scripts/change-proxy-servers.sh` | Editor + propagace seznamu do tří souborů |
| `scripts/apply_proxy_servers.py` | Samotné přepsání markerů (volá se z .sh) |
| `start-termux.sh` | Self-host na Termux/Linuxu přes PHP |
| `README.md` | Uživatelská dokumentace (částečně zastaralá, viz `handoff.md`) |

## Backend

### Endpointy

Všechny jsou `GET`, vracejí JSON `{success, …}` a leží pod `/api`, takže na ně platí bot guard i limity.

| Endpoint | Co dělá |
|---|---|
| `/api/search?q=` | Hledání na prehraj.to přes proxy; vrací výsledky s `url`, `title`, `thumbnail` |
| `/api/proxy?url=` | Z prehraj.to stránky vytáhne URL videa na CDN |
| `/api/validate?url=` | Ověří, že video na CDN opravdu jde přehrát |
| `/api/stream?url=[&v=][&download=1&name=]` | Server přeposílá video (Range, seeking) a sám obnovuje vypršelý podepsaný odkaz. Neumí HLS |
| `/api/thumb?q=[&t=][&y=][&re=][&src=]` | Náhled pro katalog. Cache týden, nenalezené hodinu. `src=itunes` = plakát z iTunes |
| `/api/catalog?lang=cz\|en` | Žebříček z iTunes RSS pro úvodní stránku, cache 1 den |
| `/api/live?country=cz\|lang=ces\|custom=N` | Seznam IPTV kanálů z iptv-org (`streams/xx.m3u` nebo `languages/xxx.m3u`), cache 30 min. `custom` bere URL z `Prehraj:LivePlaylists` |
| `/api/live/hls?url=` | Relay HLS playlistu: přepisuje playlisty, segmenty i klíče na sebe, takže prohlížeč nepotřebuje CORS od zdroje. Blokuje privátní adresy |

### Proxy řetěz

- Server má výchozí seznam z `Prehraj:ProxyUrls` (v Azure `Prehraj__ProxyUrls__0`, `__1`, …;
  `Prehraj:ProxyUrl` bez `s` je zkratka pro jednu).
- Klient posílá `&proxy=<url>` opakovaně (`proxyQS()` v `index.html` z `DEFAULT_PROXY_SERVERS`)
  a tenhle seznam **přebije** serverový pro daný request.
- Servery se zkouší **postupně**, ne souběžně (`FirstWorking` v `Program.cs`). První použitelná
  odpověď vyhrává, mrtvý/zaplněný se přeskočí. Naposledy funkční server jde příště první
  (`lastGoodProxy`), takže výpadek stojí jeden timeout.
- Odpověď `HTTP 200` s tělem `{"success":false,…}` je **neúspěch** – PHP proxy takhle předává chyby
  prehraj.to (typicky 429) a bez `IsGoodBody` by přebila fungující server.

### Ochrany

| Policy | Endpointy | Trvale | Burst |
|---|---|---|---|
| `search` | `/api/search` | 3/s | 8 |
| `api` | `/api/proxy`, `/api/validate`, `/api/stream`, `/api/catalog` | 6/s | 20 |
| `thumb` | `/api/thumb` | 10/s | 40 |
| `live` | `/api/live/hls` | 40/s | 120 |

- Klíč limitu je IP klienta; za App Service ji doplní `UseForwardedHeaders` (KnownNetworks/KnownProxies
  vyčištěné). Překročení = `429` + `Retry-After: 5` + JSON chyba.
- Bot guard: `/api` dostane `403`, když má UA z deny-listu (curl, wget, python-requests, scrapy,
  headless Chrome, Playwright…), prázdný UA, nebo nemá `Sec-Fetch-Site` ani `Referer` na vlastní doménu.
  Není to bezpečnostní hranice, jen speed bump – scraping brzdí limity.
- Statické soubory (`/`) se neblokují ani nelimitují.

## Frontend (`wwwroot/index.html`)

Jeden soubor, tři vrstvy: `<style>`, markup, jeden `<script>` na konci. Sekce se přepínají
`showSection('placeholder' | 'results' | 'player' | 'page')`, vše ostatní je `display: none`.

- **Úvodní stránka** – `renderHero()` (billboard s „W TIP DNE“) a `renderCatalog()` (chips + řady).
  Data: `CATALOG` (z `/api/catalog`, fallback `BUILTIN_CATALOG`), kategorie `CHIPS`.
  Karta = `posterHtml()`, řada = `rowHtml()`, na dotyku bez šipek, na klávesnici/D-padu šipky
  přesouvají fokus mezi `.poster`.
- **Hledání** – `searchMovies()` vykreslí výsledky inline (žádný popup), stav v `#resultsState`.
- **Nastavení** – `#profileBtn` (avatar) otevírá `#settingsPanel`. Na výběr jsou jen dvě věci:
  `catLang` (katalog CZ/EN) a `limitOn`/`limit` (limit souběžných dotazů na náhledy). Ukládá se do
  `localStorage` pod `wtzi-settings` (`SETTINGS_KEY`), staré klíče se při startu zahazují.
  Proxy a náhledy jsou vždy zapnuté, zdroj náhledů je vždy výchozí – záměrně, ne nedodělek.
- **Přehrávač** – nativní `<video controls>` (žádný custom ovládací pruh, schválně kvůli fullscreenu,
  PiP a media keys). `loadAndPlay()` pustí video napřímo z CDN; `recoverPlayback()` při chybě/vypršení
  odkazu vezme čerstvý odkaz a naváže od stejného místa, po dvou neúspěších přepne na `/api/stream`.
  `setNowPlaying()` nastavuje poster a Media Session (lock screen, sluchátka). Po skutečném konci
  (`ended`, ne předčasném utržení) se ukáže overlay `#playerEnd` s tlačítky Pustit znovu / Domovská
  stránka / Hledat další.
- **Náhledy** – `getThumb()` + `pumpThumbs()` přes `/api/thumb`, cache v `localStorage`
  (`wtzi-thumbs-v3`).
- **Patička** – `PAGES` (help, about, sources, terms, privacy, cookies, contact), otevírá `openPage()`
  do `#pageSection`. Kontakt `CONTACT_MAIL`.
- **Živě (IPTV)** – tlačítko `#liveBtn` v liště → `#liveSection` (grid `#liveGrid`, zdroj
  `#liveSource`, filtr `#liveFilter`). `openLive()`/`loadLive()`/`renderLive()` staví dlaždice z
  `/api/live`, `playLive()` pustí HLS v `#livePlayerSection`. `hls.min.js` se dotahuje lazy při prvním
  kanálu; Safari/iOS jde přes nativní HLS. Při chybě sítě se playlist zkusí ještě přes
  `/api/live/hls`, teprve pak se ukáže chyba. `showSection()` mimo `livePlayer` volá `stopLive()`,
  aby kanál nehrál na pozadí.
- **Breakpointy** – `1180px` tablet, `900px` (skryté odkazy v liště, hero plakát přes celý billboard),
  `700px` mobil, `1600px+` TV; `hover: none` vypíná hover zvětšování karet.
- **Pozor na `overflow-x: auto`** u řad a chipsů: samo o sobě zapne i `overflow-y: auto` a řada pak
  krade svislý swipe. Vždy s ním drž `overflow-y: hidden`.

## Lokální vývoj

```bash
export PATH="$HOME/.dotnet:$PATH"          # SDK 9.0 je v ~/.dotnet
cd azure-app/PrehrajtoProxy
dotnet build --no-restore -warnaserror     # musí být 0 warnings, 0 errors
dotnet run --urls http://127.0.0.1:5199   # http://127.0.0.1:5199
```

`dotnet run` bez `--urls` bere `http://localhost:5218` z `launchSettings.json`.

Bez .NET (jen prohlížení UI): `preview-server.js` v rootu (necommitnutý, `node preview-server.js`)
servíruje `wwwroot` na `:8099` a `/api/*` tahá přímo z PHP proxy. Maže se po použití.

Self-host bez Azure: `./start-termux.sh` (PHP + `router.php`), `HOST=0.0.0.0` zpřístupní v síti,
`PORT` mění port (v skriptu je výchozí `80`).

## Běžné úkoly

**Změna proxy serverů** – uprav `proxy-servers.txt` a spusť `./scripts/change-proxy-servers.sh --no-edit`.
Zkontroluj, že se seznam propsal na všech třech místech, a restartuj appku.

**Nová stránka v patičce** – přidej klíč do `PAGES` (title + body s HTML) a tlačítko
`class="f-link" data-page="klíč"` do patičky. Nic dalšího není potřeba.

**Vlastní IPTV playlist** – do `appsettings.json` přidej
`"Prehraj": { "LivePlaylists": ["https://…/muj.m3u"] }` (Azure `Prehraj__LivePlaylists__0`) a otevři
`/api/live?custom=0`. UI tuhle volbu nenabízí schválně – z prohlížeče se nenačítá libovolná URL.

**Nový API endpoint** – `app.MapGet("/api/…")` v `Program.cs` a `.RequireRateLimiting("api")`;
cokoli pod `/api` automaticky projde bot guardem. Volání na prehraj.to veď přes `FirstWorking`/proxy
seznam, nikdy ne přes přímý `HttpClient` na prehraj.to.

**Změna limitů** – politiky v `Program.cs` (`AddPolicy("search"|"api"|"thumb")`) a tabulka v README.

## Ověřování (bez prohlížeče)

V sandboxu není prohlížeč ani Playwright, takže se ověřuje takhle:

```bash
# 1) syntaxe JS + párování CSS závorek
python3 - <<'PY'
import re; s=open('azure-app/PrehrajtoProxy/wwwroot/index.html',encoding='utf-8').read()
css=re.search(r'<style>(.*?)</style>',s,re.S).group(1); print('CSS', css.count('{'), css.count('}'))
open('/tmp/s.js','w').write(re.findall(r'<script>(.*?)</script>',s,re.S)[0])
PY
node --check /tmp/s.js

# 2) appka vůbec něco servíruje
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:5199/

# 3) bot guard a API s hlavičkami prohlížeče
curl -s -o /dev/null -w '%{http_code}\n' 'http://127.0.0.1:5199/api/search?q=matrix'   # 403
curl -s -H 'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/131' \
     -H 'Sec-Fetch-Site: same-origin' 'http://127.0.0.1:5199/api/search?q=matrix'
```

Co odsud nejde: vizuální kontrola, skutečné přehrávání a `wtzi.runasp.net` (není ze sandboxu dostupné).
Když něco z toho potvrdit nemůžeš, napiš to, nevydávej to za otestované.

## Commity a deploy

- Commit message anglicky, imperativ, první řádek co a proč; tělo vysvětluje důvod, ne výčet souborů.
  Footer `🤖 Generated with Codebuff` + `Co-Authored-By: Codebuff <noreply@codebuff.com>`.
- Deploy Azure: `dotnet publish -c Release -o ./publish`, zip a nahrát přes Kudu. PHP proxy: nahrát
  `index.php` na český hosting přes FTP.

## Časté chyby

- **429 od prehraj.to** je sdílené pro všechny proxy (jedna IP hostingů) – není to chyba appky a
  „opravit“ to nejde obejitím, jen jinou proxy nebo pomalejším načítáním náhledů.
- **Podepsaný odkaz na CDN vyprší** – proto relay a obnova; nikdy neukládej CDN URL natrvalo.
- **Hero popis je generovaný** (`heroDesc`) – iTunes synopsi neposílá, „příběh, který vás…“ není reálný text.
- **Náhledy jdou z prehraj.to**, iTunes je jen fallback pro plakáty z katalogu; `src=itunes` z UI už
  nejde poslat.
- **Nová závislost** jen když se bez ní nedá pokračovat – projekt je záměrně bez balíčků.
  Výjimka je `wwwroot/hls.min.js` (HLS v Chrome bez něj nejde) – drž ho lokálně, ne z CDN.
- **Živé kanály umírají** – jsou to cizí streamy; mrtvý kanál není bug appky. Nova v iptv-org pro ČR
  není (jen Prima a spol.), takže ji tam nenajdeš, ani když tam „má být“.
- **Geoblokace vs. relay** – přímé přehrání jde z IP diváka (české kanály projdou), relay jde z Azure
  (projde na CORS, ne na geoblokaci). Proto se zkouší v tomhle pořadí.
- **IPv6** – oba `HttpClient`y mají `ConnectCallback = ConnectPreferIpv4`; bez toho se některé
  dual-stack CDN z Azure nikdy nenačtou (IPv6 visí do timeoutu).
