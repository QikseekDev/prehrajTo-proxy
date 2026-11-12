# Zdroje obsahu: co appka umí a co je jen katalog

Wflix umí tři weby: **prehraj.to** (přes PHP proxy), **bombuj.si** a **sledujteto.cz**.
Vedle toho existuje řada českých úložišť, která agregují přehrávače jako
[Nokturno](https://github.com/nokturno-app/plugin.video.nokturno) pro Kodi. Tenhle
dokument je jejich katalog: co to je, jaký má veřejný web a co by zapojení vyžadovalo.

> Kód Nokturna je „all rights reserved“ (copying prohibited), takže se odtud **nepřevzal
> žádný kód**. Níže je jen věcný seznam služeb a jejich veřejných domén – to samé, co má
> projekt popsané v README, jen setříděné pro potřeby týhle appky.

## 1. Zdroje, které appka používá

| Zdroj | Veřejná adresa | Přístup | Stav ve Wflixu |
|---|---|---|---|
| Přehraj.to | `prehraj.to` | bez účtu (HTML), geoblokace mimo ČR | **podporováno** – `index.php` (`searchPrehraj`, `resolveSourceVideo`) + `Meta/*` |
| Sledujteto | `sledujteto.cz` | bez účtu pro hledání, Premium pro plné přehrávání | **podporováno** – `index.php` (`searchSledujteto`) |
| Bombuj | `bombuj.si` | bez účtu | **podporováno** – `index.php` (`searchBombuj`) |

Přepínač zdrojů je v UI (`src`/`source` parametr) a v `appsettings.json`; appka
nevolá žádný z těch webů přímo z Azure, prehraj.to jde vždy přes PHP proxy.

## 2. Zdroje z Nokturna, které appka neumí

| Zdroj | Veřejná adresa | Co vyžaduje | Proč není ve Wflixu |
|---|---|---|---|
| WebShare | `webshare.cz` | účet (API token) | přihlašovací údaje per uživatel; appka je bez přihlášení a bez účtů |
| HellSpy | `hellspy.to` | nic (veřejné rozhraní) | jde o fulltext souborů, ne o katalog filmů – chtělo by vlastní UI a stránkování |
| FastShare / Sdilej.cz | `fastshare.cz`, `sdilej.cz` | účet nebo kredit pro přehrávání | hledání bez účtu ano, přehrávání ne |
| Sosáč / Streamuj.tv | `sosac.tv`, `streamuj.tv` | Premium účet | streamy jsou vázané na účet a předplatné |
| CZtor | `cztor.com` | účet párovaný PINem | torrenty – mimo rozsah appky (a právně rizikovější) |
| Luna | vlastní server (`http://<ip>:7126`) | běžící instance u uživatele | lokální služba, ne veřejný web |
| Vlastní úložiště | WebDAV / NAS / SMB | přístupové údaje | appka nemá uživatelské účty ani úložiště |

Společný jmenovatel: všechno kromě HellSpy chce účet nebo vlastní server. Wflix je
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
- Přehraj.to scraper jako inspirace: https://github.com/thetedotgg/prehrajto-scraper
- Co všechno se z výzkumu integrovalo: [EXPANSION.md](EXPANSION.md)
