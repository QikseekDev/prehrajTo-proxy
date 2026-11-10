# Nasazení na MonsterASP.NET (free)

Cíl: po každém pushi do `main` se backend **sám sestaví a nasadí** na MonsterASP.NET, bez placeného plánu.

## Co free plán umí a co ne

| Funkce | Free | Premium |
| --- | --- | --- |
| Git deploy v panelu – ruční **Pull** + **Build & publish** | ✅ | ✅ |
| Git deploy – **auto deploy webhookem** při pushi | ❌ | ✅ |
| **Web Deploy** (publish z VS / z CI) | ✅ | ✅ |
| FTP / SFTP, ZIP, command line | ✅ | ✅ |

Auto-deploy webhookem je tedy na free plánu nedostupný. Zdarma se stejný výsledek dělá takto:
**build běží na GitHub Actions a hotový výstup se nahraje na hosting přes Web Deploy.**
Workflow je v repu: [`.github/workflows/deploy-monsterasp.yml`](../.github/workflows/deploy-monsterasp.yml).

## 1. Založit web

1. Přihlas se na [monsterasp.net](https://www.monsterasp.net/) a vytvoř **Free** website (Windows / .NET).
2. Zapamatuj si ID webu ve tvaru `siteXXXXXX` – používá se jako uživatelské jméno i název webu.
3. Aplikace cílí na **.NET 9** (`net9.0`). Pokud by hosting .NET 9 ještě nenabízel, změň
   `TargetFramework` v `azure-app/PrehrajtoProxy/PrehrajtoProxy.csproj` (a `dotnet-version` ve workflow).

## 2. Zapnout Web Deploy a opsat údaje

Control Panel → **Websites** → tvůj web → **Deploy** → karta **Visual Studio access**:

1. Přepni **WebDeploy** na **Enabled**.
2. Opiš čtyři hodnoty z karty:
   - **Server** → `https://siteXXXXXX.siteasp.net:8172`
   - **Site** (ID webu) → `siteXXXXXX`
   - **Login** → `siteXXXXXX`
   - **Password** → vygenerované heslo pro Web Deploy

> Když heslo v panelu změníš, musíš ho změnit i v GitHub secrets níže.

## 3. Nastavit GitHub secrets

Repo → **Settings** → **Secrets and variables** → **Actions** → *New repository secret*:

| Secret | Hodnota z karty Visual Studio access |
| --- | --- |
| `WEBSITE_NAME` | `siteXXXXXX` |
| `SERVER_COMPUTER_NAME` | `https://siteXXXXXX.siteasp.net:8172` |
| `SERVER_USERNAME` | `siteXXXXXX` |
| `SERVER_PASSWORD` | heslo pro Web Deploy |

Heslo patří **jen** do secrets – nikdy do workflow souboru ani do repa.

## 4. Push = build + publish

Workflow se spustí při pushi do `main`, který mění `azure-app/PrehrajtoProxy/**`
(nebo ručně: **Actions** → *Deploy to MonsterASP.NET* → **Run workflow**). Dělá:

1. `dotnet publish -c Release -o publish` na `windows-latest`,
2. nahraje obsah `publish/` do `/wwwroot` přes Web Deploy (inkrementálně – posílají se jen změněné soubory).

Nasazuje se **jen ASP.NET backend** (`azure-app/PrehrajtoProxy`). PHP proxy (`index.php`) a klientské
appky (APK/IPK) mají vlastní cesty a tímhle workflowem se nenahrazují.

## 5. Po prvním nasazení zkontrolovat

- `https://<web>.runasp.net/` → načte se UI (Wflix).
- `https://<web>.runasp.net/api/search?q=matrix` → `{"success":true,...}`.
- Hlavičky: `/` musí mít `Cache-Control: no-store`, `script.js` verzi s hashem (`?v=<hash>`) –
  `Program.cs` ji počítá z obsahu, takže se po každém nasazení sama změní.

## Provozní poznámky (free plán)

- Free tarif má omezené CPU/paměť a app pool se po nečinnosti uspává → první request je pomalejší
  (cold start). Pro produkci s provozem je vhodný placený tarif.
- Produkční nastavení (např. `Prehraj__ProxyUrls__0`, `Prehraj__LivePlaylists__0`) patří do
  konfigurace v panelu (App settings / Environment variables), ne do repa.
- Web Deploy nahrává jen změny, takže opakované nasazení je rychlé; `app_offline.htm` není potřeba,
  deploy sám aplikaci restartuje.
- HTTPS a vlastní doména se řeší v panelu (Let's Encrypt), mimo tento workflow.

## Alternativa: Git deploy v panelu (bez CI)

Control Panel → **Deploy** → **Git deploy** → vlož HTTPS URL repa, větev `main`, případně Personal
Access Token pro privátní repo. Na free plánu pak ale musíš po každém pushi ručně kliknout
**Pull latest** a **Build & publish** – server buildí sám (`dotnet publish`), jen to není automatické.
