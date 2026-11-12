# Zdroje obsahu: co appka umí a co je jen katalog

Wflix umí šest webů: **prehraj.to** (přes PHP proxy), **bombuj.si**, **sledujteto.cz**,
**hellspy.to**, **fastshare.cz** a **sdilej.cz**. Všechny kromě prehraj.to jedou přes
veřejná JSON rozhraní a jsou součástí „vrstvy jedna“ – hledají se souběžně při
„Více výsledků“ (`source=all`), žádný z nich není fallback jiného.

Vedle toho existuje řada českých úložišť, která agregují přehrávače jako
[Nokturno](https://github.com/nokturno-app/plugin.video.nokturno) pro Kodi. Tenhle
dokument je jejich katalog: co to je, jaký má veřejný web a co by zapojení vyžadovalo.

> Kód Nokturna je „all rights reserved“ (copying prohibited), takže se odtud **nepřevzal
> žádný kód**. Níže je jen věcný seznam služeb a jejich veřejných domén – to samé, co má
> projekt popsané v README, jen setříděné pro potřeby týhle appky.

## 1. Zdroje, které appka používá

| Zdroj | Veřejná adresa | Rozhraní | Přístup | Stav ve Wflixu |
|---|---|---|---|---|
| Přehraj.to | `prehraj.to` | HTML stránka hledání | bez účtu, geoblokace mimo ČR | **podporováno** – `searchPrehraj`, `resolveSourceVideo` + `Meta/*` |
| Sledujteto | `sledujteto.cz` | `/api/web/videos` | bez účtu pro hledání, Premium pro plné přehrávání | **podporováno** – `searchSledujteto` |
| Bombuj | `bombuj.si` | autocomplete z `uvod.php` | bez účtu | **podporováno** – `searchBombuj` |
| HellSpy | `hellspy.to` | `api.hellspy.to/gw/search`, `gw/video/<id>/<hash>/download` (302) | bez účtu a tokenu | **podporováno** – `searchHellspy`, `parseHellspyBody`; při 429 se zdroj přeskočí |
| FastShare | `fastshare.cz` | `api/api_kodi.php?process=search` | hledání bez účtu, přehrávání někdy s účtem | **podporováno** – `searchFastshare(..., 'fastshare')` |
| Sdilej.cz | `sdilej.cz` | stejné `api/api_kodi.php` (společný katalog) | jako FastShare | **podporováno** – `searchFastshare(..., 'sdilej')` |

Přepínač zdrojů je v adminu (Zdroje) a v API (`source` parametr, `only=...` pro `all`);
appka nevolá žádný z těch webů přímo z Azure, všechny jdou přes PHP proxy (česká IP).
HellSpy vrací jen soubory (`GWSearchVideo`), ne katalog filmů – proto se v UI zobrazují
jako běžné položky se zdrojem `hellspy` a přehrávají se z podepsané CDN adresy.

## 2. Zdroje z Nokturna, které appka neumí

| Zdroj | Veřejná adresa | Co vyžaduje | Proč není ve Wflixu |
|---|---|---|---|
| WebShare | `webshare.cz` | účet (API token) | přihlašovací údaje per uživatel; appka je bez přihlášení a bez účtů |
| Sosáč / Streamuj.tv | `sosac.tv`, `streamuj.tv` | Premium účet | streamy jsou vázané na účet a předplatné |
| CZtor | `cztor.com` | účet párovaný PINem | torrenty – mimo rozsah appky (a právně rizikovější) |
| Luna | vlastní server (`http://<ip>:7126`) | běžící instance u uživatele | lokální služba, ne veřejný web |
| Vlastní úložiště | WebDAV / NAS / SMB | přístupové údaje | appka nemá uživatelské účty ani úložiště |

Společný jmenovatel: všechno v téhle tabulce chce účet nebo vlastní server. Wflix je
veřejná appka bez registrace, takže by musela držet cizí credentials – to záměrně nedělá.

## 3. Co by zapojení jednoho zdroje obnášelo

Kdyby měl některý zdroj přibýt, je to vždy stejná sada kroků (prehraj.to je vzor):

1. `searchX()` v `index.php` – najít endpoint hledání a rozparsovat výsledky do
   `{title, url, thumbnail, year}`.
2. `resolveSourceVideo()` – z detailu stránky dostat přímý odkaz (a případně `#EXTVLCOPT`
   hlavičky pro User-Agent/Referer).
3. `wflixAllowedSourceUrl()` – povolit jen domény toho zdroje (appka nesmí být otevřený proxy).
4. Volba zdroje v UI a v `appsettings.json`.

Bez bodu 3 by šel `/api/proxy` zneužít na libovolnou URL, proto je seznam domén
whitelist a nový zdroj se musí přidat vědomě.

## 4. Odkazy

- Nokturno (Kodi/HA přehrávač, katalog zdrojů): https://github.com/nokturno-app/plugin.video.nokturno
- HellSpy veřejné rozhraní: https://api.hellspy.to/gw/search?query=matrix
- FastShare / Sdilej API pro Kodi: https://fastshare.cz/api/api_kodi.php, https://sdilej.cz/api/api_kodi.php
- Přehraj.to scraper jako inspirace: https://github.com/thetedotgg/prehrajto-scraper
- Co všechno se z výzkumu integrovalo: [EXPANSION.md](EXPANSION.md)
