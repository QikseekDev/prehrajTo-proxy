# Wflix / Prehraj.to Proxy – agent skill

Projekt je multi-klient proxy/přehrávač pro Wflix/Prehraj.to (a související zdroje). Repo: `prehrajTo-proxy` (QikseekDev).

## Struktura (kde co upravovat)
- **Web (Azure wwwroot):** `azure-app/PrehrajtoProxy/wwwroot/{index.html,script.js,styles.css}` (+ statické assety). Stejná produktová logika často jako APK/IPK, ale samostatná codebase.
- **Android APK (WebView klient):** UI v `apk/app/src/main/assets/www/{index.html,app.js,styles.css}`. Android wrapper `apk/app/src/main/java/...`, verze v `apk/app/build.gradle` (`versionCode`, `versionName`).
- **LG webOS IPK (TV app):** `ipk/app/{index.html,app.js,styles.css,appinfo.json}`. Verze v `ipk/app/appinfo.json` (`version`).
- **Backend/proxy:** `index.php`, `router.php` (PHP) a `azure-app/PrehrajtoProxy/Program.cs` (ASP.NET). API pod `/api/*` (search, proxy/stream, live/hls, health atd.). **Neměnit `.php`/backend bez potřeby**, zejména když požadavek zní „jen UI/klient“.
- **Admin panel (jen .NET):** `azure-app/PrehrajtoProxy/Admin/{AdminStore.cs,AdminEndpoints.cs,SiteGate.cs,ProxyPool.cs,GeoIp.cs}` + `wwwroot/admin.html` na `/admin`. Stav (vypínače, zdroje, bany, proxy) je JSON mimo repo (`ADMIN_STATE_PATH`, jinak `$HOME/wflix-admin/state.json`), heslo z `ADMIN_PASSWORD` – **do kódu se žádné heslo neukládá** a bez proměnné je `/api/admin` vypnuté (`503`). Klienti čtou `/api/config` (i aktuální seznam proxy). `SiteGate` umí **úplnou údržbu** (zámek webu, odemkne ho admin heslo) a **vypnutí frontendu** (`/admin` a `/api/admin` zůstávají dostupné, aby se to dalo vrátit); oba vypínače se ignorují, když heslo není nastavené. `admin.html` má navíc seznam návštěvníků s GeoIP (`ip-api.com`, jen server), graf požadavků/minutu a správu proxy s volitelným commitem do `proxy-servers.txt` (`WFLIX_GITHUB_TOKEN`). PHP `index.php` má jen `action=purge` (`WFLIX_PURGE_TOKEN`), panel tam není.
- **CI:** `.github/workflows/android.yml` (APK), `.github/workflows/build-ipk.yml` (IPK), další `*.yml` pro .NET/checky.

## Důležité konvence
- **APK/IPK držet v sync**, když změna řeší stejné UI/chování v obou klientech (HTML/JS/CSS). ID prvků a handler logika bývají shodné.
- **TV/D-pad fokus (přehrávač):** výchozí fokus na normální ovládání (ne na posuvník). Posuvník `#pBar` je normální focusable prvek v pořadí **Zpět ↓ → posuvník ↓ → Přehrát/Pauza** (↑ zpět). **L/R posouvá čas jen když je fokus na posuvníku**; jinak L/R normálně naviguje. OK/Enter na posuvníku přepíná pauza/přehrát. Při skrytém UI (`idle`) první D-pad/klik jen probudí menu a akci neprovede (Zpět ponechán průchozí).
- **WebOS starší kompatibilita (IPK):** nepoužívat `inset:0` / `display:grid; place-items` / `:has` bez potřeby; raději `top/right/bottom/left:0`, flex centrování, `!important` pro přepínání hidden/display. Obrázky v IPK bez `loading="lazy"` tam, kde způsobovalo šedé náhledy.
- **Zaseknutí streamu:** web má plnou obnovu (`recoverPlayback` – čerstvý odkaz/relay, reload). APK/IPK mají `switchToRelay` a stall recovery (po ~8 s, max 3×): plná obnova přes `/api/proxy` (čerstvý zdroj, re-attach HLS/direct podle nastavení) a návrat na stejnou pozici, fallback na relay. Bez umělého posunu času, pokud není výslovně požadován.
- **Pokračování přehrávání (web i APK/IPK):** `localStorage` klíč `wflix.progress` (TTL ~30 dní, ukládá `t,d,ts,title,thumb,url`); web: `azure-app/PrehrajtoProxy/wwwroot/script.js` (`applyWebResume`/`saveWebProgress`), appky: `applyResumeIfNeeded` + retry (`scheduleResumeRetry`) — řádek **„Pokračovat ve sledování“** na domů + obnovení pozice při otevření titulu/dílu (`loadedmetadata`/manifest, zobrazí „Pokračuji od …“). Ukládají se **všechny** rozkoukané tituly/díly seriálu (každý zvlášť podle URL) na ~30 dní, auto-návrat na uložený čas bez dotazu. Při pauze/zavření/průběžně. **≤ 2 min před koncem** (nebo dohrání) se záznam smaže automaticky.
- **Cache busting (web):** `Program.cs` vkládá do `index.html` hash obsahu `script.js`/`styles.css`/`intro.css` (`?v=<prvních 12 znaků SHA256>`), takže po nasazení se URL sama změní a verzi není potřeba přepisovat. HTML jde s `no-store`, statické assety s `max-age=2592000` (30 dní).

## Verze – schéma `X.Y.Z` = velké . normální . „radši neříkal“
- **X (velké vylepšení):** opravdu velký posun/funkce hodná „resume“.
- **Y (normální změna):** běžné vylepšení/bugfix.
- **Z (radši neříkat):** drobná/trapná záplata, přešlap.
- **Kde se verzuje ručně (pokud je třeba):** IPK `ipk/app/appinfo.json` → `version`; APK `apk/app/build.gradle` → `versionName` + `versionCode` (Android `versionCode` musí vždy růst).

## CI auto-bump (push na `main`)
Workflowy `.github/workflows/build-ipk.yml` a `.github/workflows/android.yml` při push na `main` (IPK jen když se změnila appka mimo `appinfo.json`) automaticky zvýší verzi a po úspěšném buildu ji zapíší zpět do repa `[skip ci]`.
- **Výchozí** = zvýší **Z**.
- Vynucení typu značkou v commit message: **`[bump:velke]`/`[bump:major]`** → `X+1, Y=0, Z=0`; **`[bump:normalni]`/`[bump:minor]`** → `Y+1, Z=0`; **`[bump:spatne]`/`[bump:patch]`** → `Z+1`.
- APK vždy inkrementuje i `versionCode`. Tagy `v*` musí odpovídat `versionName` (kontrola v android workflow).

## Ověření
- Rychlá kontrola JS: `node --check ipk/app/app.js && node --check apk/app/src/main/assets/www/app.js && node --check azure-app/PrehrajtoProxy/wwwroot/script.js`
- Backend: `cd azure-app/PrehrajtoProxy && dotnet build`; admin panel jde ověřit i bez prohlížeče (`curl` na `/api/config`, login, `/api/admin/state`).
- Plné ověření UI/přehrávání vyžaduje reálné zařízení/buil z CI (webOS TV, Android). Git push přes `cloud_git`/projektový postup; nerozbíjet remote/user změny, řešit merge konflikty citlivě.
- **Vždy pushuj:** po dokončení změn je (pokud uživatel výslovně neřekne jinak) commitni a pushni na remote; při odmítnutí push (non-fast-forward) nejdřív stáhni/začni rebase a push zopakuj, bez ztráty změn.
