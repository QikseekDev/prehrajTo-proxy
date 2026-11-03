# WTZI 🎬

[![Uptime Status](https://img.shields.io/uptimerobot/status/m801943371-78c6e4351b1a34cc26858090?label=Azure%20App&style=flat-square)](https://stats.uptimerobot.com/ueMqtXp5wJ)
[![Uptime Status](https://img.shields.io/uptimerobot/status/m801943405-1df9c48a5d475447d1d9b7af?label=TinyURL&style=flat-square)](https://stats.uptimerobot.com/ueMqtXp5wJ)

Proxy pro přehrávání videí z Prehraj.to z libovolné lokace.

**Autor:** Vojtěch Vokoun · [contact@qikseek.qzz.io](mailto:contact@qikseek.qzz.io)
(fork původního projektu WTZI, viz [Kredit](#kredit))

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

**1. Prohlížeč (`DEFAULT_PROXY_SERVERS` v `index.html`)** – appka pošle `&proxy=<url>` pro každý
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

### Přidání/úprava serverů jedním příkazem
```bash
./scripts/change-proxy-servers.sh
```
Otevře `proxy-servers.txt` v `nano` (jiný editor přes `EDITOR=vim ...`), po uložení a zavření
seznam ověří (musí to být `http://`/`https://` URL) a promítne ho najednou do `index.html`
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

Playlist tahá server (`/api/live`) a posílá do prohlížeče jen jméno, skupinu, logo a URL. HLS pak
přehrává `hls.min.js` (přibalený v `wwwroot`, načítá se až při otevření kanálu; Safari/iOS použije
nativní HLS). Když zdroj nepošle CORS hlavičky, zkusí se stejný kanál přes `/api/live/hls`.

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
| `search` | `/api/search` | 3 dotazy/s | 8 |
| `api` | `/api/proxy`, `/api/validate`, `/api/stream`, `/api/catalog` | 6/s | 20 |
| `thumb` | `/api/thumb` | 10/s | 40 |
| `live` | `/api/live/hls` | 40/s | 120 |

Dávka je tam proto, že úvodní stránka posílá náhledy všech viditelných posterů najednou a přehrávač
při seekování pošle několik Range dotazů v jedné vlně – s holým „3/s“ by se appka rozbila sama sobě.
Překročení vrací `429` + `Retry-After: 5` a JSON `{"success":false,"error":"…"}`, který UI zobrazí
jako běžnou chybu hledání. Za App Service se IP bere z `X-Forwarded-For` (`UseForwardedHeaders`),
jinak by všechny požadavky měly IP front-endu Azure a limit by platil pro celý internet dohromady.

**2. Blokace nástrojů** – požadavek na `/api` dostane `403`, když má User-Agent z deny-listu
(curl, wget, python-requests, httpx, aiohttp, scrapy, go-http-client, okhttp, axios, httpie,
Postman, PowerShell, headless Chrome, Puppeteer, Playwright, Selenium…), prázdný UA, nebo nemá
ani `Sec-Fetch-Site` ani `Referer` na vlastní doménu. Statické soubory (`/`, `index.html`) se
neblokují ani nelimitují, aby fungoval uptime monitoring.

> Hlavičky jde podstrčit, takže blokace UA není bezpečnostní hranice – scraping reálně brzdí až
> rate limiting. Pro ruční testování z terminálu je potřeba poslat prohlížečové hlavičky:
> `curl -A 'Mozilla/5.0 … Chrome/131' -H 'Sec-Fetch-Site: same-origin' '…/api/search?q=matrix'`.

## Komponenty

### `/azure-app/PrehrajtoProxy/`
ASP.NET Core 9.0 aplikace hostovaná na Azure App Service.

- **Frontend** (`wwwroot/index.html`) - WTZI, UI ve stylu streamovací služby: katalog doporučených
  filmů, vyhledávání, přehrávač. Jediný statický soubor (CSS i JS uvnitř). Nastavení (avatar vpravo
  nahoře) nabízí jen katalog úvodní stránky a limit souběžných náhledů – proxy jsou vždy zapnuté
  a zdroj náhledů je vždy prehraj.to.
- **API Endpoints**:
  - `GET /api/search?q={query}` - Vyhledávání filmů
  - `GET /api/proxy?url={prehrajto_url}` - Získání URL videa
  - `GET /api/validate?url={prehrajto_url}` - Ověření, že video funguje
  - `GET /api/stream?url={prehrajto_url}[&download=1&name={titul}]` - Server video přeposílá z CDN (podporuje Range/seeking)
    a sám obnovuje vypršelý odkaz, takže se přehrávání ani stahování nezasekne po pár minutách. S `download=1` se
    posílá jako příloha (tlačítko ⬇ Stáhnout video). Neumí HLS (`.m3u8`). Pozor na přenesená data: na Azure
    (zvlášť free tier) se tím video počítá do odchozího provozu, na self-hostu (Termux) je to zadarmo.
  - `GET /api/live?country={kód}[&lang={kód}][&custom={index}]` - Seznam IPTV kanálů (viz [Živé vysílání](#živé-vysílání-iptv)).
  - `GET /api/live/hls?url={playlist}` - Záložní relay HLS playlistu pro zdroje bez CORS; přepisuje playlist,
    segmenty i klíče na sebe, takže prohlížeč nikdy nesahá mimo naši doménu. Neveřejné adresy (localhost, 10.x,
    192.168.x) odmítá.
  - `GET /api/thumb?q={query}[&t={titul}][&y={rok}][&re={regex}][&src=itunes]` - Jen thumbnail pro homepage. Výchozí regex je `query*`
    (každé významné slovo z `q`/`t` jako začátek slova v názvu/slugu, bez diakritiky, pořadí je jedno); `re` ho přepíše.
    Výsledek se cachuje na serveru (týden, nenalezené hodinu).
    Volitelný limit souběžných dotazů (výchozí: bez limitu): server `Prehraj:ThumbConcurrency` (Azure `Prehraj__ThumbConcurrency`),
    aplikace: avatar vpravo nahoře → Nastavení → „Omezit souběžné dotazy na náhledy“ (výchozí vypnuto, uloží se v prohlížeči).
    Náhledy se vždycky berou z prehraj.to a vypnout se nedají. `src=itunes` je jen pro volání API – hledá
    plakát přes keyless iTunes Search API (záloha: prehraj.to); UI tuhle volbu nenabízí, katalog si plakáty
    z iTunes tahá sám.

**Přehrávání** (`index.html`): video se napřed pustí napřímo z CDN. Když se zasekne / vyhodí chybu / skončí
předčasně (odkaz z CDN vyprší), appka si vezme čerstvý odkaz a naváže od stejného místa; po dvou neúspěšných
pokusech přepne na `/api/stream`.

### `/index.php`
PHP proxy pro český hosting – bez něj se .NET verze k prehraj.to nedostane (viz výše).

## Self-host bez Azure (Termux / Linux)

Celé to jde provozovat jen přes PHP, bez Azure a bez .NET. Navíc požadavky na prehraj.to
půjdou z tvého zařízení (česká IP), takže odpadá geo-blokace.

```bash
# Termux: pkg install git php   (start-termux.sh si PHP doinstaluje sám)
./start-termux.sh                 # http://127.0.0.1 (port 80, jen tenhle telefon)
HOST=0.0.0.0 ./start-termux.sh    # dostupné i z jiných zařízení ve Wi-Fi
PORT=9000 ./start-termux.sh       # jiný port
```

Běží to přes `router.php` (vestavěný PHP server): `/` je WTZI, `/api/search`, `/api/proxy`
a `/api/validate` používají logiku z `index.php`. Server startuje s více workery, aby se
ověřování videí neprovádělo po jednom.

`router.php` umí stejné proxy řetězení jako Azure/.NET verze: seznam, který prohlížeč posílá
(`&proxy=...` z `DEFAULT_PROXY_SERVERS`), přebije lokální seznam `$SERVER_PROXIES` na začátku
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
- 📱 Responzivní design (mobil, tablet, desktop)
- 📺 Živé vysílání – IPTV kanály (Česko, čeština, Slovensko)
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

### PHP Proxy
Upload `index.php` na český hosting přes FTP.

---

## Kredit

Tenhle fork spravuje **Vojtěch Vokoun** – [contact@qikseek.qzz.io](mailto:contact@qikseek.qzz.io).

Původní WTZI napsal **Jiřík**; od něj je základ aplikace, `index.php`, `router.php` a původní
podoba README včetně jeho osobního věnování. Díky za základ, na kterém jde stavět.

---

## Licence

MIT
