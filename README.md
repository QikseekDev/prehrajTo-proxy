# Wflix

Proxy pro přehrávání videí z Prehraj.to z libovolné lokace.

**Autor:** Vojtěch Vokoun · [contact@qikseek.qzz.io](mailto:contact@qikseek.qzz.io)
(fork původního projektu, viz [Kredit](#kredit))

## Architektura

```
Uživatel (kdekoli) → Azure App Service (HTTPS) → PHP proxy (CZ hosting) → prehraj.to
```

Backend v `Program.cs` nevolá prehraj.to nikdy přímo: z datacentrové IP vrací captcha
stránku, která vypadá jako platná odpověď, ale nic nenajde. Každý dotaz proto jde přes
PHP proxy, která běží na české IP.

**Seznam proxy** má dvě vrstvy, prohlížeč má přednost:

1. Prohlížeč – `DEFAULT_PROXY_SERVERS` v `wwwroot/script.js`, posílá se jako `&proxy=<url>`.
2. Server – `appsettings.json` → `Prehraj.ProxyUrls`; v Azure `Prehraj__ProxyUrls__0`, `__1`, …

Servery se zkouší postupně, první s 2xx a neprázdným tělem vyhrává. Mrtvý server se
přeskočí a naposledy funkční jde příště na začátek. Když selžou všechny, endpoint vrátí
`Všechny zdroje selhaly: …`. Seznam se mění jedním příkazem:

```bash
./scripts/change-proxy-servers.sh
```

Skript upraví `proxy-servers.txt` a promítne ho do `script.js`, `appsettings.json`
i `router.php`; ty tři bloky needituj ručně.

## Živé vysílání (IPTV)

Tlačítko **Živě** bere playlisty z [iptv-org](https://github.com/iptv-org/iptv) – Česko,
čeština (`lang=ces`), Slovensko, USA, Velká Británie (`uk`). HLS přehrává `hls.min.js`,
Safari/iOS nativně. Kanály s vlastním User-Agent/Referer nebo bez CORS jdou přes relay
`/api/live/hls`. Volitelně lze přidat EPG a vlastní playlisty (`Epg:Urls`,
`Prehraj:LivePlaylists`). Kanály jsou cizí streamy – část je geoblokovaná a mohou kdykoli
přestat fungovat.

## Volitelné vrstvy

Vypnuté, dokud se nenastaví; při výpadku zdroje tiše zmizí.

| Vrstva | Nastavení | Co přidá |
|---|---|---|
| ČSFD metadata | `Csfd:BaseUrl` | hodnocení, žánry, plakát |
| EPG | `Epg:Urls` | program na dlaždicích Živě |
| FlareSolverr | `FLARESOLVERR_URL` | obejití Cloudflare výzvy v PHP proxy |

Co se z výzkumu integrovalo a co ne: [docs/EXPANSION.md](docs/EXPANSION.md).
Přehled zdrojů obsahu: [docs/SOURCES.md](docs/SOURCES.md).

## API

| Endpoint | Význam |
|---|---|
| `GET /api/search?q=` | hledání (`source=`, `fallback=0`) |
| `GET /api/proxy?url=` | resolve stránky na CDN odkaz a titulky |
| `GET /api/stream?url=` | přeposílání videa s Range; `download=1` |
| `GET /api/subtitles?url=` | relay WebVTT |
| `GET /api/live?country=cz` | seznam IPTV kanálů |
| `GET /api/live/hls?url=` | relay HLS playlistu a segmentů |
| `GET /api/thumb?q=` | plakát pro homepage |
| `GET /api/meta?q=&y=` | ČSFD metadata |
| `GET /api/config` | údržba a stav vypínačů |

## Limity

`/api/*` má token bucket na IP: hledání 5/s, api 6/s, titulky 20/s, náhledy 10/s,
live/hls 40/s, admin 10/s (burst 3–4×). Překročení vrací `429` + `Retry-After: 20`.
Hledání se navíc sdílí v cache (30 min) a pouští po 1,6 s, protože prehraj.to limit
~5 dotazů/10 s vidí ze všech proxy jako jednu IP. Hlavičky (User-Agent, Referer) se
nekontrolují, aby fungovaly WebView a `curl`.

## Admin panel

`/admin` na .NET backendu – jedna HTML stránka bez buildu. Zapne se `ADMIN_PASSWORD`,
stav je JSON mimo repo (`ADMIN_STATE_PATH`, jinak `App_Data/`). Umí údržbu, vypínače
(stahování, živé, relay, více zdrojů, náhledy), zapínání zdrojů, mazání cache, bany IP,
přehled provozu a správu seznamu proxy. Login vymění heslo za podepsanou HttpOnly cookie,
každý zápis vyžaduje CSRF token.

Volitelné: `WFLIX_PURGE_TOKEN` (mazání cache na PHP proxy), `WFLIX_GITHUB_TOKEN` +
`WFLIX_GITHUB_REPO`/`WFLIX_GITHUB_BRANCH` (commit seznamu proxy). PHP self-host panel nemá.

## Komponenty

- `azure-app/PrehrajtoProxy/` – ASP.NET Core 9 a frontend v `wwwroot/` (vanilla JS)
- `index.php` – PHP proxy pro český hosting
- `router.php` – self-host router (vestavěný PHP server)
- `apk/`, `ipk/` – Android a LG webOS klient; `ipk/app` je zdroj pravdy
- `scripts/`, `tests/`

## Self-host bez Azure

```bash
./start.sh                 # http://127.0.0.1 (port 80)
HOST=0.0.0.0 ./start.sh    # dostupné i z jiných zařízení v síti
PORT=9000 ./start.sh       # jiný port
```

Potřebuje PHP s curl (Termux: `pkg install php`). Na české IP volá prehraj.to přímo,
jinde doplň `$SERVER_PROXIES` v `router.php`. `HOST=0.0.0.0` nevystavuj do internetu –
appka je bez přihlášení.

## Lokální vývoj

```bash
cd azure-app/PrehrajtoProxy
dotnet run          # http://localhost:5218
```

Testy: `node --test tests/` (parser seriálů, synchronizace APK/IPK assetů).

## Deploy

- **Azure / MonsterASP:** push do `main` sestaví a nasadí backend; nastavení v
  [azure-app/DEPLOY-MONSTERASP.md](azure-app/DEPLOY-MONSTERASP.md).
- **PHP proxy:** nahraj `index.php` na český hosting (FTP).
- CI: `push-checks.yml` a `pr-checks.yml` (Node testy, `php -l`, `dotnet build`).

## Právní upozornění

Projekt je pouze technický proxy a přehrávač. Nehostuje, neukládá ani nenabízí žádný
obsah; videa a IPTV kanály pocházejí od třetích stran. Není spojen s Prehraj.to ani
s poskytovateli playlistů. Za dodržování zákonů a autorských práv odpovídá uživatel.
Software je poskytován „tak, jak je“, bez záruky.

## Kredit

Fork spravuje **Vojtěch Vokoun** ([contact@qikseek.qzz.io](mailto:contact@qikseek.qzz.io)).
Původní projekt napsal **Jiřík**. Úvodní animace vychází z
[codevkn/netflix-intro_html_css](https://github.com/codevkn/netflix-intro_html_css).

## Licence

MIT
