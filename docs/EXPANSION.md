# Rozšíření: co z open-source výzkumu je v appce a co ne

Tenhle dokument mapuje repozitáře a projekty, které vzešly z průzkumu volně dostupných
zdrojů pro filmy, seriály, IPTV a metadata. Cílem nebylo pobrat všechno, co existuje, ale
vzít to, co sedí na současný stack (ASP.NET Core 9 + PHP proxy + vanilla JS) a co se dá
přidat bez přepsání appky.

Legenda:

- **integrováno** – kód je v tomto repu a chová se podle popisu níže,
- **referenční** – dobrý zdroj/myšlenka, ale integrace by znamenala jiný runtime nebo
  velký zásah do UI; zůstává jako dokumentovaná možnost,
- **odmítnuto** – nepoužitelné (mrtvé, licenčně nevhodné, duplikuje to, co už appka umí).

## 1. Integrováno v této větvi

| Repozitář / projekt | Co přinesl | Kde v kódu | Licence |
|---|---|---|---|
| [bartholomej/node-csfd-api](https://github.com/bartholomej/node-csfd-api) | ČSFD metadata (hodnocení, žánry, plakát, odkaz) přes jeho REST server | `Meta/CsfdClient.cs`, `GET /api/meta`, `GET /api/thumb?src=csfd`, badge v přehrávači | MIT |
| [iptv-org/epg](https://github.com/iptv-org/epg) | Formát XMLTV a grabbery, ze kterých vzniká programový průvodce | `Meta/EpgService.cs`, `GET /api/live/epg`, řádek „teď vysílá“ na dlaždicích Živě | Unlicense |
| [iptv-org/api](https://github.com/iptv-org/api) | Kanonické `tvg-id` (`CT1.cz@SD`) – podle nich se páruje EPG | párování v `TextNorm.StripVariant` + `epgKey` v `script.js` | CC0 / Unlicense |
| [tv-logo/tv-logos](https://github.com/tv-logo/tv-logos) | Náhradní loga kanálů, když je playlist nemá | `Meta/TvLogos.cs`, doplnění v `GET /api/live` | bez explicitní licence (attribution) |
| [FlareSolverr/FlareSolverr](https://github.com/FlareSolverr/FlareSolverr) | Řešení Cloudflare výzev pro PHP proxy | `wflixFlareSolverrGet()` v `index.php` a `router.php` | MIT |

Všechny čtyři vrstvy jsou **volitelné a vypnuté, dokud se nenastaví** – appka bez nich
funguje přesně jako dřív:

- `Csfd:BaseUrl` prázdné → `/api/meta` vrátí `configured: false`, badge se neukáže.
- `Epg:Urls` prázdné → `/api/live/epg` vrátí `configured: false`, dlaždice jsou bez programu.
- `FLARESOLVERR_URL` nenastavené → PHP proxy se chová jako dřív.

### 1.1 ČSFD metadata (`node-csfd-api`)

ČSFD nemá veřejné API a scraping přímo v appce by znamenal další místo, které se rozbije
při každé změně webu. `node-csfd-api` je MIT projekt, který scraping dělá za nás a nabízí
ho jako REST službu (Docker image `bartholomej/node-csfd-api`). Appka je pak jen HTTP
klient:

```jsonc
// appsettings.json nebo Azure App Settings
"Csfd": {
  "BaseUrl": "http://127.0.0.1:3000",  // prázdné = metadata vypnutá
  "ApiKey": "",                        // jen když služba běží s API_KEY
  "Language": "cs"                     // cs | sk | en
}
```

Použité endpointy služby: `GET /search/{query}?language=cs` a `GET /movie/{id}?language=cs`.

- `GET /api/meta?q=Matrix&y=1999` → `{ success, configured, source: "csfd", info: { id, title, year, poster, rating, ratingCount, genres[], url } }`
- `GET /api/thumb?src=csfd&q=Matrix&y=1999` → plakát jako `thumbnail` (stejný tvar jako u `src=itunes`)

Výběr výsledku: přesná shoda názvu (bez diakritiky) má přednost, pak shoda roku; teprve
potom se stahuje detail. Nalezené i nenalezené odpovědi se cachují (7 dní / 6 hodin), aby
se cizí služba neobcházela pro každého diváka.

### 1.2 EPG pro Živě (`iptv-org/epg` formát)

Server stáhne XMLTV (gzip i plain), rozparsuje ho streamovaně přes `XmlReader`
(`DtdProcessing.Ignore`, žádný `XmlResolver`) a v paměti drží jen programy, které
neskončily před dvěma hodinami – maximálně 12 na kanál. Do prohlížeče jde jen to, co
dlaždice potřebují:

```jsonc
"Epg": {
  "Urls": [
    "https://epgshare01.online/epgshare01/epg_ripper_CZ1.xml.gz",
    "https://epgshare01.online/epgshare01/epg_ripper_SK1.xml.gz"
  ],
  "TtlMinutes": 360
}
```

`GET /api/live/epg` → `{ success, configured, updated, now, count, channels: [{ id, name, now: { title, description, start, stop }, next: { … } }] }`

Párování kanál ↔ program:

1. `tvg-id` bez varianty (`CT1.cz@SD` → `CT1.cz`), normalizovaně (`ct1cz`),
2. když nesedí, normalizovaný název kanálu (`ČT 1` → `ct1`).

Normalizace je na obou stranách stejná (`TextNorm.Key` v C#, `epgKey` v JS): bez
diakritiky, malá písmena, jen `a-z0-9`. Stahování je single-flight – když průvodce
zrovna někdo načítá, ostatní požadavky dostanou starou kopii místo druhého stahování.
Když zdroj selže, zůstane poslední dobrý snapshot; dlaždice se nikdy nevykreslí prázdné.

### 1.3 Náhradní loga (`tv-logo/tv-logos`)

Playlisty z iptv-org mají `tvg-logo` jen někdy. Kde chybí, `/api/live` dopočítá adresu
`countries/<země>/<kanál>-<země>.png` z `tvg-id` (`CT1.cz@SD` → `czech-republic/ct1-cz.png`,
`BarrandovKrimi.cz` → `barrandov-krimi-cz.png`). Je to **odhad**, ne garantovaná adresa:
iniciály proto zůstávají pod obrázkem a při chybě načtení (`onerror`) se obrázek zahodí,
takže dlaždice nikdy nespadne na prázdné místo. Mapované země: cz, sk, us, uk, de, at,
pl, hu, ro, si, hr, fr, es, it.

### 1.4 FlareSolverr (PHP proxy)

`wflixHttpGet()` / `curlText()` zůstávají primární cesta. Jen když odpověď vypadá jako
Cloudflare výzva (403/503 nebo text `Just a moment`, `cf-challenge`, `Attention Required`),
zkusí se stejná URL ještě jednou přes FlareSolverr (`POST /v1`, `cmd: request.get`).
Limit 429 se záměrně **neopakuje** – to není challenge, ale „zpomal“.

```
FLARESOLVERR_URL=http://127.0.0.1:8191   # prázdné/nenastavené = fallback vypnutý
```

## 2. Referenční (vědomě neintegrováno)

| Projekt | Proč ne | Co by to obnášelo |
|---|---|---|
| [thetedotgg/prehrajto-scraper](https://github.com/thetedotgg/prehrajto-scraper) | Appka už prehraj.to scrapuje přes PHP proxy; druhý scraper by byl duplicitní zdroj pravdy | sladit selektory a fallbacky s `index.php` |
| [warren-bank/node-HLS-Proxy](https://github.com/warren-bank/node-HLS-Proxy) | Náš `/api/live/hls` už playlist přepisuje včetně `URI="…"` (`EXT-X-MAP`, `EXT-X-KEY`, `EXT-X-MEDIA`) | jen by přidal druhý runtime (Node) vedle .NET |
| [zhimin-dev/iptv-checker](https://github.com/zhimin-dev/iptv-checker) | Kontrola dostupnosti kanálů je fajn, ale je to samostatná služba s vlastním UI a během na pozadí | nová úloha na pozadí + úložiště výsledků |
| Nokturno (plugin pro prehraj.to) | Licence říká „copying prohibited“, takže kód nejde převzít | jen jako inspirace pro chování, ne zdroj kódu |
| Nuvio/Vega provider pluginy, Kodi a Stremio addony | Jiný runtime (JS pluginy / Python addony) a jiný model zdrojů | samostatný adaptér, ne úprava appky |
| Watchparty / synchronizované přehrávání | Vyžaduje realtime server a stav relace | WebSocket vrstva + UI pro místnosti |
| Přepsání přehrávače na Video.js | Současný `<video>` + hls.js pokrývá HLS i MP4 včetně titulků | velký zásah do `script.js` bez užitku pro uživatele |

## 3. Odmítnuto

| Projekt | Důvod |
|---|---|
| [movie-web/providers](https://github.com/movie-web/providers) | Repo už není dostupné (404/451), ekosystém se rozpadl |
| p-stream, sudo-flix | Duplikují agregaci zdrojů, kterou appka nechce provozovat (právní riziko) |
| nova (archived) | Archivovaný projekt bez údržby |
| Subscene scrapery | Subscene je mimo provoz, scrapeby vracely prázdno |
| ulozto-downloader | EOL, závisí na neexistujícím API |
| phisher98/phisher-nuvio-providers | Repo není dostupné (404) |
| undetected-chromedriver | GPL-3 – neslučitelné s tím, jak chceme kód šířit |

## 4. Co by šlo přidat dál

Pořadí podle poměru užitek/práce, kdyby na to mělo dojít:

1. **Vlastní EPG grabber** přes `iptv-org/epg` v Dockeru – přesnější programy pro CZ/SK
   kanály než hotový epgshare01, ale znamená to další službu k provozu.
2. **Kontrola dostupnosti kanálů** (myšlenka z `iptv-checker`) jako noční úloha, která
   z `/api/live` schová mrtvé kanály.
3. **Seriálová metadata z ČSFD** – `node-csfd-api` umí i `/tv-series/{id}`; chtělo by to
   mapování epizod na řadu v UI.
