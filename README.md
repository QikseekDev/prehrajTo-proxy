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

> ⚠️ prehraj.to může blokovat zahraniční IP. Pokud Azure vrací chybu `HTTP error: 403` / `451`,
> zvol region co nejblíž ČR, nebo zapni PHP proxy níže.

### Volitelná PHP proxy
Soubor `index.php` v rootu zůstává. Pokud ho nahraješ na vlastní (český) hosting (klidně i víc
hostingů zároveň), appka se umí dotazovat přes ně místo přímého volání prehraj.to. Dvě nezávislé
vrstvy, které se dají kombinovat:

**1. Server (appsettings.json / Azure)** - výchozí seznam pro všechny uživatele, i kdyby v
prohlížeči ⚙️ Nastavení nic nezapínali. V `appsettings.json`:
```json
"Prehraj": {
  "ProxyUrls": [
    "https://wtzi.borec.cz/index.php",
    "https://wtzi.euweb.cz/index.php",
    "https://wtzi.chytrak.cz/index.php"
  ]
}
```
Další server = další řádek do pole. V Azure (Configuration → Application settings) se totéž pole
nastaví přes indexované klíče: `Prehraj__ProxyUrls__0`, `Prehraj__ProxyUrls__1`,
`Prehraj__ProxyUrls__2`, … (`Prehraj__ProxyUrl` bez `s` pořád funguje jako zkratka pro jediný).
Prázdné pole (výchozí) = volá se prehraj.to přímo, pokud klient sám nepošle svoje proxy.

**2. Prohlížeč (⚙️ Nastavení → „Použít PHP proxy“)** - když je zapnuto (výchozí stav) a uživatel
má v seznamu zaškrtnutý aspoň jeden server, appka pošle `&proxy=<url>` pro každý z nich a tyhle
**přebijí** serverový seznam z appsettings pro ten konkrétní request. Přidat server jde přímo v
Nastavení tlačítkem „+ přidat server“, nebo se dá změnit výchozí nabídka pro nové uživatele v
`index.html` v poli `DEFAULT_PROXY_SERVERS`.

V obou případech platí totéž chování: servery se zkouší **postupně** v pořadí – první, který vrátí
použitelnou odpověď (2xx + neprázdné tělo), vyhrává. Mrtvý nebo zaplněný server (timeout, 4xx/5xx,
prázdné tělo) se přeskočí a zkusí se další. Server, který naposledy fungoval, jde příště na začátek,
takže výpadek jedné proxy stojí jen jeden timeout. Neplatné (ne-http/https) hodnoty backend tiše ignoruje.

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

## Limity a ochrana proti scrapingu

Appka je veřejná a bez přihlášení, takže `/api/*` má dvě vrstvy ochrany (obojí v `Program.cs`):

**1. Rate limiting** – built-in `AddRateLimiter`, token bucket zvlášť pro každou IP:

| Policy | Endpointy | Trvale | Dávka (burst) |
|---|---|---|---|
| `search` | `/api/search` | 3 dotazy/s | 8 |
| `api` | `/api/proxy`, `/api/validate`, `/api/stream`, `/api/catalog` | 6/s | 20 |
| `thumb` | `/api/thumb` | 10/s | 40 |

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

- **Frontend** (`wwwroot/index.html`) - WTZI, UI ve stylu streamovací služby: katalog doporučených filmů, vyhledávání, přehrávač
- **API Endpoints**:
  - `GET /api/search?q={query}` - Vyhledávání filmů
  - `GET /api/proxy?url={prehrajto_url}` - Získání URL videa
  - `GET /api/validate?url={prehrajto_url}` - Ověření, že video funguje
  - `GET /api/stream?url={prehrajto_url}[&download=1&name={titul}]` - Server video přeposílá z CDN (podporuje Range/seeking)
    a sám obnovuje vypršelý odkaz, takže se přehrávání ani stahování nezasekne po pár minutách. S `download=1` se
    posílá jako příloha (tlačítko ⬇ Stáhnout video). Neumí HLS (`.m3u8`). Pozor na přenesená data: na Azure
    (zvlášť free tier) se tím video počítá do odchozího provozu, na self-hostu (Termux) je to zadarmo.
  - `GET /api/thumb?q={query}[&t={titul}][&y={rok}][&re={regex}][&src=itunes]` - Jen thumbnail pro homepage. Výchozí regex je `query*`
    (každé významné slovo z `q`/`t` jako začátek slova v názvu/slugu, bez diakritiky, pořadí je jedno); `re` ho přepíše.
    Výsledek se cachuje na serveru (týden, nenalezené hodinu).
    Volitelný limit souběžných dotazů (výchozí: bez limitu): server `Prehraj:ThumbConcurrency` (Azure `Prehraj__ThumbConcurrency`),
    aplikace: ⚙️ Nastavení → „Omezit souběžné dotazy na náhledy“ (výchozí vypnuto, uloží se v prohlížeči).
    `src=itunes` hledá plakát přes keyless iTunes Search API (záloha: prehraj.to); v aplikaci ⚙️ → „Zdroj náhledů“.
    V Nastavení jde také „Vypnout načítání náhledů“ úplně (výchozí vypnuto = náhledy se načítají).

**Přehrávání** (`index.html`): video se napřed pustí napřímo z CDN. Když se zasekne / vyhodí chybu / skončí
předčasně (odkaz z CDN vyprší), appka si vezme čerstvý odkaz a naváže od stejného místa; po dvou neúspěšných
pokusech přepne na `/api/stream`.

### `/index.php`
Volitelná PHP proxy pro český hosting (viz výše).

## Self-host bez Azure (Termux / Linux)

Celé to jde provozovat jen přes PHP, bez Azure a bez .NET. Navíc požadavky na prehraj.to
půjdou z tvého zařízení (česká IP), takže odpadá geo-blokace.

```bash
# Termux: pkg install git php   (start-termux.sh si PHP doinstaluje sám)
./start-termux.sh                 # http://127.0.0.1:8080 (jen tenhle telefon)
HOST=0.0.0.0 ./start-termux.sh    # dostupné i z jiných zařízení ve Wi-Fi
PORT=9000 ./start-termux.sh       # jiný port
```

Běží to přes `router.php` (vestavěný PHP server): `/` je WTZI, `/api/search`, `/api/proxy`
a `/api/validate` používají logiku z `index.php`. Server startuje s více workery, aby se
ověřování videí neprovádělo po jednom.

`router.php` umí stejné souběžné proxy racování jako Azure/.NET verze: zapnuté servery z
⚙️ Nastavení v prohlížeči (`&proxy=...`) přebijí lokální seznam `$SERVER_PROXIES` na začátku
souboru (výchozí prázdný = self-host volá prehraj.to přímo z tohohle zařízení). Má to smysl
hlavně když Termux/self-host neběží na české IP - jinak klidně nech proxy v Nastavení vypnuté,
přímé volání z CZ zařízení je rychlejší.

> Nevystavuj `HOST=0.0.0.0` do veřejného internetu - je to bez přihlášení.

## Živá verze

Provozní URL sem záměrně nepatří – appka je sdílená jen s přáteli. Když ji potřebuješ,
vyptej se provozovatele ([contact@qikseek.qzz.io](mailto:contact@qikseek.qzz.io)).

## Funkce

- 🔍 Vyhledávání filmů a seriálů
- 🎥 Přehrávání videí přímo v prohlížeči
- 📱 Responzivní design (mobil, tablet, desktop)
- 🔗 Sdílení odkazů na konkrétní videa
- ⬅️ Navigace zpět/vpřed v prohlížeči

## Technologie

- **Backend**: ASP.NET Core 9.0, PHP 8
- **Frontend**: HTML5, CSS3, Vanilla JavaScript
- **Hosting**: Azure App Service, Webzdarma.cz
- **Video**: HTML5 Video Player

## Lokální vývoj

```bash
# ASP.NET aplikace
cd azure-app/PrehrajtoProxy
dotnet run

# Otevři http://localhost:5000
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
