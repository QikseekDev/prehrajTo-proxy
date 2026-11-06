# Wflix pro Android (`apk/`)

Nativní obal webového klienta Wflixu pro Android a Android TV.

| | |
|---|---|
| **Hotový APK** | CI (`Android APK build`) vyrábí podepsaný `Wflix-<verze>.apk` + `.sha256`; u tagu `v*` je přiloží k GitHub Release. Přiložený `Wflix-1.0.0.apk` je starý build podepsaný debug klíčem. |
| **Package** | `cz.qikseek.wflix` |
| **Verze** | 1.2.0 (versionCode 3) |
| **Min. Android** | 6.0 (API 23) |
| **Cíl** | API 34, Android 14 |
| **Velikost** | ~166 kB |

APK není appka s vlastním backendem – je to klient, který po prvním spuštění dostane adresu
tvého Wflix serveru (Azure App Service nebo PHP self-host) a dál používá jeho `/api/*`.

---

## Instalace

**Telefon / tablet**

```bash
adb install -r Wflix-1.0.0.apk
```

Nebo soubor zkopíruj do telefonu a otevři ho (povol „Instalace z neznámých zdrojů“).

**Android TV / Google TV**

```bash
adb connect <IP televize>:5555      # v TV zapni Vývojářské možnosti → Ladění po USB/síti
adb install -r Wflix-1.0.0.apk
```

Appka má v manifestu `LEANBACK_LAUNCHER`, takže se objeví i na TV launcheru a ovládá se
dálkovým ovladačem (šipky, Enter, Zpět). Na TV dej pozor na `uses-feature` – dotykové
ovládání není vyžadované, takže jde nainstalovat i na zařízení bez displeje na dotyk.

---

## První spuštění

1. Otevři appku → obrazovka **Připojení k serveru**.
2. Zadej adresu backendu, např. `https://moje-app.azurewebsites.net` nebo `http://192.168.1.10:5218`.
3. **Připojit** – appka si vyzkouší `/api/catalog` a adresu si zapamatuje (změna kdykoli v Nastavení).

Stejná adresa se používá pro všechno: katalog, hledání, přehrávání, titulky i živé vysílání.

---

## Co appka umí

- **Katalog a hledání** – `/api/catalog` pro úvodní stránku, `/api/search` pro hledání; plakáty
  z iTunes (katalog) nebo z prehraj.to (`/api/thumb`).
- **Přehrávání** – nejdřív přímo z CDN (`/api/proxy` → `videoUrl`), při chybě nebo vypršení
  odkazu se přepne na `/api/stream` a pokračuje od stejného místa. Tlačítko **Přes server**
  přepne okamžitě, nastavení **Přímé přehrávání z CDN** to mění globálně.
- **Titulky** – WebVTT přes `/api/subtitles`, volba jazyka tlačítkem *Titulky* v přehrávači.
- **Pokračovat ve sledování** – pozice se ukládá do `localStorage` (`wflix-history`) a film naváže
  tam, kde jsi skončil (řady *Pokračovat ve sledování* a *Nedávno sledované* na úvodní stránce).
- **Oblíbené** – záložka ★ v detailu titulu a řada *Moje oblíbené* (`wflix-favs`).
- **Titulky na míru** – velikost a pozadí titulků v Nastavení (CSS proměnné, stopa se nenačítá znovu).
- **Živé vysílání** – `/api/live` (iptv-org: Česko, Čeština, Slovensko, USA, VB) s filtry
  1080p / bez geo bloku / jen 24-7. HLS hraje `hls.js`, kanály s vlastním User-Agentem nebo
  Refererem jdou vždy přes relay `/api/live/hls`.
- **Stahování** – přes systémový DownloadManager (`/api/stream?download=1`), soubor skončí ve
  složce *Stažené*.
- **Ovladač** – šipky = navigace s prostorovým fokusem, Enter = potvrzení, Zpět = zavře překryv,
  na úvodní obrazovce appku přesune do pozadí, mediální tlačítka = play/pauza/seek.
- **Celoobrazovka** – při přehrávání se schovají systémové lišty a displej nezhasne.

---

## Jak to funguje

```
MainActivity (Java, žádné AndroidX)
├── WebView  →  assets/www/  (webový klient)
│                index.html, styles.css, app.js, hls.min.js
└── Bridge  "WflixNative"  (JavaScript interface)
      httpGetAsync(url,id) – asynchronní HTTP bez CORS, výsledek jde do window.__wflixNativeResult
      httpGet(url)      – synchronní varianta (blokuje JS vlákno, jen pro starší klienty)
      setFullscreen(on) – immersive režim
      setKeepScreenOn() – FLAG_KEEP_SCREEN_ON při přehrávání
      download(url,name) – DownloadManager
      openExternal(url) – odkazy mimo appku do prohlížeče
      backHandled()     – potvrzení, že Zpět zavřel překryv
      exitApp()         – ukončení appky
```

Proč nativní most: WebView načítá appku z `file:///android_asset/`, takže každé volání API je
cross-origin. Kdyby backend neposílal `Access-Control-Allow-Origin`, JSON by se nepřečetl.
Most proto tahá JSON nativně (`HttpURLConnection`) a fetch v JS je jen záloha. **Přehrávání
HLS a titulky** most obejít nemůže – ty jdou z `<video>`/`hls.js`, takže potřebují CORS na
backendu (v tomhle repu je doplněný v `Program.cs` i `router.php`).

---

## Build ze zdrojáků

Potřebuješ **JDK 17** a **Android SDK 34** (`platforms;android-34`, `build-tools;34.0.0`).

```bash
cd apk
echo "sdk.dir=$HOME/android-sdk" > local.properties     # nebo nastav ANDROID_HOME
./gradlew assembleRelease
# → app/build/outputs/apk/release/app-release.apk
```

Výsledný soubor se v CI ukládá jako `Wflix-<verze>.apk` (verze z `versionName`).

### Podpis a vydání

`release` build je minifikovaný (R8, `shrinkResources`) a podepisuje se **tvým keystorem**, pokud je
nastavený. Bez něj spadne na debug klíč – použitelné jen na vyzkoušení: každý takový build má jiný
podpis, takže ho nejde nainstalovat přes starší verzi (Android hlásí konflikt podpisů).

1. Vyrob keystore (jednou) a nastav GitHub secrets:

   ```bash
   bash apk/scripts/generate-keystore.sh     # vypíše i příkazy `gh secret set …`
   ```

   Secrets: `WFLIX_KEYSTORE_BASE64`, `WFLIX_STORE_PASSWORD`, `WFLIX_KEY_ALIAS`, `WFLIX_KEY_PASSWORD`.
   **Keystore a heslo si zazálohuj** – bez nich nejde appku aktualizovat.

2. Lokální release build: do `~/.gradle/gradle.properties` (ne do gitu) přidej
   `WFLIX_STORE_FILE`, `WFLIX_STORE_PASSWORD`, `WFLIX_KEY_ALIAS`, `WFLIX_KEY_PASSWORD`
   (starý překlep `WFLEX_*` stále funguje).

3. Vydání: zvyš `versionCode`/`versionName` v `app/build.gradle`, pushni tag `vX.Y.Z`.
   CI ověří, že tag odpovídá `versionName`, build **odmítne** bez keystoru, zkontroluje podpis
   (`apksigner verify`), vytvoří `.sha256` a přiloží obojí k GitHub Release.

### Struktura projektu

```
apk/
├── Wflix-1.0.0.apk                  starý přiložený build (debug klíč)
├── settings.gradle, build.gradle    Gradle 8.7 + AGP 8.5.2
├── gradlew, gradle/wrapper/         wrapper (build bez instalace Gradle)
├── gradle.properties
├── scripts/generate-keystore.sh     výroba release keystoru
└── app/
    ├── build.gradle, proguard-rules.pro
    └── src/main/
        ├── AndroidManifest.xml      INTERNET, cleartext pro LAN, LEANBACK_LAUNCHER
        ├── java/cz/qikseek/wflix/MainActivity.java
        ├── assets/www/              webový klient (zdroj)
        └── res/                     ikony, TV banner, téma, network security config
```

Zdroj webového klienta je přímo v `app/src/main/assets/www/` – stačí upravit tamní soubory.

---

## Omezení

- **Ověřeno v prohlížeči proti živému backendu** (katalog, hledání, detail, oblíbené, osobní
  řady, nastavení titulků) – appka ale neběžela na skutečném telefonu ani TV. Na zařízení je
  potřeba projít instalaci, D-pad/ovladač a přehrávání.
- Přehrávání jde přes `<video>` ve WebView (žádný ExoPlayer), takže kodeky řeší systémový
  WebView: H.264/AAC ano, exotické formáty a DRM ne.
- Bez aktualizovaného backendu (CORS) funguje hledání a katalog přes nativní most, ale živé
  vysílání a titulky ne.
- Cleartext HTTP je povolený (self-host na LAN), pro veřejný provoz používej HTTPS. Mostu stačí vědět,
  že adresa mimo soukromou síť jde přes `http://` – appka tě jednou za spuštění upozorní.
- Stránka běží z `file://` s povoleným `allowUniversalAccessFromFileURLs` (kvůli starším backendům bez CORS).
  Appka proto nikdy nenačítá cizí stránky – externí odkazy (jen `http/https`) otevírá v prohlížeči.
- Appka nehostuje žádný obsah, jen zprostředkovává API a přehrává streamy třetích stran.
