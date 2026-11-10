# Nasazení na MonsterASP.NET (free)

Cíl: po každém pushi do `main` se backend **sám sestaví a nasadí** na oba MonsterASP weby, bez placeného plánu.

| Web | Web Deploy (site) | Veřejná adresa |
| --- | --- | --- |
| **Wflix** | `site104887` → `https://site104887.siteasp.net:8172` | `wflix.runasp.net` |
| **WTZI** | `site104437` → `https://site104437.siteasp.net:8172` | `wtzi.runasp.net` |

## Co free plán umí a co ne

| Funkce | Free | Premium |
| --- | --- | --- |
| Git deploy v panelu – ruční **Pull** + **Build & publish** | ✅ | ✅ |
| Git deploy – **auto deploy webhookem** při pushi | ❌ | ✅ |
| **Web Deploy** (publish z VS / z CI) | ✅ | ✅ |
| FTP / SFTP, ZIP, command line | ✅ | ✅ |

Auto-deploy webhookem je na free plánu nedostupný. Zdarma se stejný výsledek dělá takto:
**build běží na GitHub Actions a hotový výstup se nahraje na oba weby přes Web Deploy.**
Workflow je v repu: [`.github/workflows/deploy-monsterasp.yml`](../.github/workflows/deploy-monsterasp.yml).

## 1. Weby a Web Deploy

Pro každý web (Wflix `site104887`, WTZI `site104437`):

1. Přihlas se na [monsterasp.net](https://www.monsterasp.net/), otevři daný web.
2. Control Panel → **Websites** → web → **Deploy** → karta **Visual Studio access**.
3. Přepni **WebDeploy** na **Enabled**.
4. Opiš **Password** (Server/Site/Login jsou u těchto webů už vyplněné ve workflow:
   `https://siteXXXXXX.siteasp.net:8172`, `siteXXXXXX`, `siteXXXXXX`).

Aplikace cílí na **.NET 9** (`net9.0`). Pokud by některý web .NET 9 nenabízel, změň
`TargetFramework` v `azure-app/PrehrajtoProxy/PrehrajtoProxy.csproj` a `dotnet-version` ve workflow.

## 2. GitHub secrets (stačí dvě hesla)

Repo → **Settings** → **Secrets and variables** → **Actions** → *New repository secret*:

| Secret | Hodnota |
| --- | --- |
| `WFLIX_SERVER_PASSWORD` | heslo z karty Visual Studio access u `site104887` |
| `WTZI_SERVER_PASSWORD` | heslo z karty Visual Studio access u `site104437` |

Volitelně jde přepsat i zbytek (kdyby se site ID změnilo) – workflow má tyto defaults:

| Secret | Default |
| --- | --- |
| `WFLIX_WEBSITE_NAME` / `WFLIX_SERVER_USERNAME` | `site104887` |
| `WFLIX_SERVER_COMPUTER_NAME` | `https://site104887.siteasp.net:8172` |
| `WTZI_WEBSITE_NAME` / `WTZI_SERVER_USERNAME` | `site104437` |
| `WTZI_SERVER_COMPUTER_NAME` | `https://site104437.siteasp.net:8172` |

Hesla patří **jen** do secrets – nikdy do workflow souboru ani do repa. Když heslo v panelu změníš,
změň ho i v secrets.

## 3. Push = build + publish na oba weby

Workflow se spustí při pushi do `main`, který mění `azure-app/PrehrajtoProxy/**`
(nebo ručně: **Actions** → *Deploy to MonsterASP.NET* → **Run workflow**). Dělá:

1. `dotnet publish -c Release -o publish` na `windows-latest` (jednou),
2. nahraje obsah `publish/` do `/wwwroot` na **Wflix** a pak na **WTZI** (Web Deploy, inkrementálně).

Web bez nastaveného hesla se přeskočí s warningem – workflow nespadne.

Nasazuje se **jen ASP.NET backend** (`azure-app/PrehrajtoProxy`). PHP proxy (`index.php`) a klientské
appky (APK/IPK) mají vlastní cesty a tímhle workflowem se nenahrazují.

## 4. Po nasazení zkontrolovat

- `https://wflix.runasp.net/` a `https://wtzi.runasp.net/` → načte se UI (Wflix).
- `/api/search?q=matrix` na obou → `{"success":true,...}`.
- Hlavičky: `/` musí mít `Cache-Control: no-store`, `script.js` verzi s hashem (`?v=<hash>`) –
  `Program.cs` ji počítá z obsahu, takže se po každém nasazení sama změní.

## Provozní poznámky (free plán)

- Free tarif má omezené CPU/paměť a app pool se po nečinnosti uspává → první request je pomalejší
  (cold start). Pro produkci s provozem je vhodný placený tarif.
- Produkční nastavení (např. `Prehraj__ProxyUrls__0`, `Prehraj__LivePlaylists__0`) patří do
  konfigurace v panelu (App settings / Environment variables), ne do repa. **Každý web má vlastní
  app settings** – WTZI může mít jiné proxy adresy než Wflix.
- Web Deploy nahrává jen změny, takže opakované nasazení je rychlé; deploy sám aplikaci restartuje.
- HTTPS a vlastní doména se řeší v panelu (Let's Encrypt), mimo tento workflow.

## Alternativa: Git deploy v panelu (bez CI)

Control Panel → **Deploy** → **Git deploy** → vlož HTTPS URL repa, větev `main`, případně Personal
Access Token pro privátní repo. Na free plánu pak ale musíš po každém pushi ručně kliknout
**Pull latest** a **Build & publish** – server buildí sám (`dotnet publish`), jen to není automatické.
