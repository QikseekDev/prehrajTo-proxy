# Handoff – stav k 3. 11. 2026

HEAD `4732567` na `main` (pushnuto). Větev workspace: `freebuff/fa8c77482bd20deb2928d34b`.
Přečti `skill.md` – obsahuje pravidla a mapu repa; tady je jen to, co je rozjeté.

## Hotovo (od nejnovějšího)

| Commit | Co |
|---|---|
| `4732567` | Responzivita: řady už nekradou svislý swipe (`overflow-y: hidden`), karty mají 2řádkový titulek a zkrácený metařádek, Top 5 je vyšší na tabletu, hero plakát pod 900 px přes celý billboard, breakpointy pro mobil/TV, focus ring a šipky pro D-pad |
| `96580ca` | Přehrávač: poster + Media Session (lock screen, sluchátka), overlay po konci videa (Pustit znovu / Domovská stránka / Hledat další) |
| `5de0c4b` | Nastavení zkráceno na dvě volby; pryč „Použít PHP proxy“, „Vypnout načítání náhledů“, „Zdroj náhledů“ i jejich JS/CSS; staré klíče z localStorage se zahazují |
| `1f0989b` | Horní lišta: jedno tlačítko nastavení (avatar), přestylované hledání |
| `9f617c6` | Živá URL pryč z README |
| `3a6dd4f` | Rate limiting (3 politiky) + bot guard v `Program.cs` |
| `a35d4d8` | Sedm reálných stránek v patičce |
| `83ab3f1` | Smazané nepoužívané direct-fetch helpery |

## Otevřené

**Přepsaná historie bez živé URL není na GitHubu.** Větev `purge-live-url` (`7dcf050`) má stejný obsah
jako `main`, ale historii bez URL. Z tohohle prostředí force push neprojde (žádné push credentials pro
obyčejný `git`), takže to musí udělat provozovatel:

```bash
git push --force-with-lease origin purge-live-url:main
```

Do té doby je URL pořád dohledatelná v historii `main`. (`cloud_git` umí jen běžný push HEAD → main,
force ne.)

## Známé nedodělávky

1. **README je na několika místech zastaralé** – mluví o volbách, které z Nastavení zmizely:
   řádky 23, 31, 44, 46–48 („Použít PHP proxy“, tvrzení že prázdné `ProxyUrls` = přímé volání),
   114–116 („Zdroj náhledů“, „Vypnout načítání náhledů“), 142 (`⚙️ Nastavení` v self-hostu).
   Opravit, ale pozor: text musí odpovídat realitě, že proxy jsou vždy zapnuté a náhledy vždy ze
   `prehraj.to`.
2. **Responzivní změny nejsou vizuálně ověřené.** Sandbox nemá prohlížeč a Chromium se sem nedá
   stáhnout (download padá na timeoutu). Ověřeno jen `node --check`, párování CSS závorek a HTTP 200.
   Potřebuje pohled na skutečném telefonu/tabletu — hlavně Top 5 řada a svislý swipe na řadách — a
   ideálně i na TV/velké obrazovce.
3. **`start-termux.sh` má výchozí `PORT=80`**, ale komentář v hlavičce i README mluví o 8080. Srovnat.
4. **`preview-server.js` je necommitnutý** lokální náhledový server (`:8099`). Buď ho smazat, nebo
   vědomě přidat do repa jako vývojovou pomůcku.
5. **Hero popis je generovaný** (`heroDesc`), protože iTunes synopsi neposílá. Není to bug, ale text
   „příběh, který vás od prvního záběru nepustí“ je fiktivní.
6. **Náhledy mají natvrdo zdroj `prehraj.to`**; iTunes se používá jen na plakáty z katalogu. Volba
   v UI byla záměrně odstraněna, `src=itunes` na `/api/thumb` ale na serveru pořád funguje.
7. **429 od prehraj.to je sdílené** pro všechny tři proxy (stejná IP hostingů). Nejde to obejít
   přidáním dalšího serveru na stejný hosting, jen jiným hostingem nebo pomalejším načítáním náhledů.

## Co odsud nejde ověřit

- `https://wtzi.runasp.net` – ze sandboxu nedostupné, takže živá verze se testuje jen u provozovatele.
- Skutečné přehrávání do konce (overlay po konci videa, obnova vypršelého CDN odkazu).
- Rate limiting proti živému provozu; dřív měřeno lokálně (40 paralelních `/api/catalog` → 21×200 /
  19×429, 16× `/api/search` → 8×200 / 8×429, curl → 403).

## Kam dál (návrhy)

- Vizuální kontrola na telefonu a TV, doladit, co zbylo.
- Srovnat README s aktuálním chováním (viz bod 1).
- Vyřešit přepsanou historii (`purge-live-url`).
- Zvážit pokračování ve sledování („Pokračovat ve sledování“ řada z `localStorage`) – rozepsané
  nebylo, jen nápad.
