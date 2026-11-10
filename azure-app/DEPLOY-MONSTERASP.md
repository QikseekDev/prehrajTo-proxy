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
2. nahraje obsah `publish/` do `/wwwroot` na **Wflix** a pak na **WTZI** (Web Deploy, inkrementálně),
3. po každém nasazení zavolá `https://<web>/api/version` a **selže, pokud web nevrací právě pushnutý
   commit** – v Actions tak rovnou vidíš, že se nasazení opravdu propsalo.

Web bez nastaveného hesla se přeskočí s warningem – workflow nespadne.

Nasazuje se **jen ASP.NET backend** (`azure-app/PrehrajtoProxy`). PHP proxy (`index.php`) a klientské
appky (APK/IPK) mají vlastní cesty a tímhle workflowem se nenahrazují.

## 4. Jak ověřit, že deploy opravdu proběhl

**a) Běží nový build?** Endpoint `/api/version` vrací commit, ze kterého CI stavělo:

```bash
curl -s https://wflix.runasp.net/api/version     # {"ok":true,"build":"1.0.0+<sha>","commit":"<sha>",...}
curl -s https://wtzi.runasp.net/api/version
git rev-parse HEAD                               # commit se musí rovnat
```

Když `commit` sedí na poslední commit v `main`, web běží přesně ten kód. (Používej `curl -s`,
ne `-sI` – endpoint je jen GET, HEAD vrací 405.)

**b) Změnil se obsah stránky?** Do `index.html` se vkládá hash obsahu assetů:

```bash
curl -s https://wflix.runasp.net/ | grep -o 'script.js?v=[a-f0-9]*'
sha256sum azure-app/PrehrajtoProxy/wwwroot/script.js | cut -c1-12    # musí být stejný hash
```

**c) Cache se nelepí:**

```bash
curl -sI https://wflix.runasp.net/ | grep -i cache-control           # no-store, max-age=0
curl -sI https://wflix.runasp.net/script.js | grep -i cache-control  # max-age=2592000
```

**d) V Actions** musí být zelené kroky `Deploy to Wflix (site104887)` a `Deploy to WTZI (site104437)`.
Když je u některého jen warning o chybějícím heslu, na ten web se nenasadilo nic.

**e) Test „změna → live“:** uprav něco viditelného (třeba text v `wwwroot/index.html`), commit + push,
počkej na zelené Actions a načti web. Když se změna neprojeví, zkontroluj, že workflow vůbec běžel
(push se musí týkat `azure-app/PrehrajtoProxy/**`) a že `/` vrací `no-store`.

**f) Základní funkčnost:** `/api/search?q=matrix` na obou webech → `{"success":true,...}`.

## Provozní poznámky (free plán)

- Free tarif má omezené CPU/paměť a app pool se po nečinnosti uspává → první request je pomalejší
  (cold start). Pro produkci s provozem je vhodný placený tarif.
- Produkční nastavení (např. `Prehraj__ProxyUrls__0`, `Prehraj__LivePlaylists__0`) patří do
  konfigurace v panelu (App settings / Environment variables), ne do repa. **Každý web má vlastní
  app settings** – WTZI může mít jiné proxy adresy než Wflix.
- Web Deploy nahrává jen změny, takže opakované nasazení je rychlé; deploy sám aplikaci restartuje.
- HTTPS a vlastní doména se řeší v panelu (Let's Encrypt), mimo tento workflow.

## Řešení potíží

**Web běží nový commit, ale `script.js`/`styles.css` je pořád starý.**
MSDeploy standardně porovnává jen čas poslední změny; když má soubor na serveru novější čas
(např. po ručním nahrání nebo ZIPu), změněný obsah přeskočí. Workflow proto volá `msdeploy.exe`
s `-useChecksum` (porovnání podle obsahu) a `-enableRule:AppOffline` (odstavení appky během
synchronizace, aby nebyly zamčené DLL). Když se i tak obsah nezmění, zkontroluj, že běží nový
workflow (ne starý krok s `simply-web-deploy`) a že `publish/wwwroot/script.js` má jiný hash než
`curl -s https://<web>/script.js | sha256sum`.

**Deploy hlásí chybu přihlášení.** WebDeploy musí být v panelu `Enabled` a heslo v secrets musí
odpovídat kartě *Visual Studio access* (po změně hesla v panelu je potřeba změnit i secret).

**`/api/version` vrací 404.** Web ještě neběží build s tímto endpointem – nasaď (push / Run workflow)
a zkontroluj, že krok `Deploy to …` proběhl zeleně.

## Alternativa: Git deploy v panelu (bez CI)

Control Panel → **Deploy** → **Git deploy** → vlož HTTPS URL repa, větev `main`, případně Personal
Access Token pro privátní repo. Na free plánu pak ale musíš po každém pushi ručně kliknout
**Pull latest** a **Build & publish** – server buildí sám (`dotnet publish`), jen to není automatické.
