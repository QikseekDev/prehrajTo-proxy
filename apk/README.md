# Wflix pro Android (`apk/`)

Nativní obal webového klienta Wflixu pro Android a Android TV.

| | |
|---|---|
| **Hotový APK** | [`Wflix-1.0.0.apk`](Wflix-1.0.0.apk) (podepsaný, instalovatelný) |
| **Package** | `cz.qikseek.wflix` |
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
├── WebView  →  assets/www/  (stejný klient jako webOS appka, viz ../ipk/app)
│                index.html, styles.css, app.js, hls.min.js
└── Bridge  "WflixNative"  (JavaScript interface)
      httpGet(url)      – synchronní HTTP bez CORS (pro starší backendy)
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

Výsledný soubor zkopíruj jako `Wflix-1.0.0.apk` do týhle složky.

### Podpis

`release` build je podepsaný **debug klíčem**, aby šel hned nainstalovat bez dalšího nastavení.
Pro vlastní distribuci (Google Play, delší aktualizace) si vyrob keystore a v `app/build.gradle`
nahraď `signingConfig signingConfigs.debug`:

```bash
keytool -genkey -v -keystore wflix.jks -keyalg RSA -keysize 2048 -validity 10000 -alias wflix
```

Do `~/.gradle/gradle.properties` (ne do gitu) pak patří `WFLEX_STORE_FILE`, `WFLEX_STORE_PASSWORD`,
`WFLEX_KEY_ALIAS`, `WFLEX_KEY_PASSWORD`.

### Struktura projektu

```
apk/
├── Wflix-1.0.0.apk                  hotový podepsaný build
├── settings.gradle, build.gradle    Gradle 8.7 + AGP 8.5.2
├── gradlew, gradle/wrapper/         wrapper (build bez instalace Gradle)
├── gradle.properties
└── app/
    ├── build.gradle
    └── src/main/
        ├── AndroidManifest.xml      INTERNET, cleartext pro LAN, LEANBACK_LAUNCHER
        ├── java/cz/qikseek/wflix/MainActivity.java
        ├── assets/www/              sdílený klient (kopie z ../ipk/app)
        └── res/                     ikony, TV banner, téma, network security config
```

### Synchronizace klienta

UI je stejné jako u TV appky, zdroj je v `../ipk/app`. Po úpravě klienta zkopíruj soubory:

```bash
cp ../ipk/app/{index.html,styles.css,app.js,hls.min.js} app/src/main/assets/www/
```

---

## Omezení

- **Ověřeno jen buildem a v prohlížeči** (stejný klient běžící proti mock backendu) – appka
  nebyla spuštěná na skutečném telefonu ani TV. Před nasazením projdi instalaci a přehrávání.
- Přehrávání jde přes `<video>` ve WebView (žádný ExoPlayer), takže kodeky řeší systémový
  WebView: H.264/AAC ano, exotické formáty a DRM ne.
- Bez aktualizovaného backendu (CORS) funguje hledání a katalog přes nativní most, ale živé
  vysílání a titulky ne.
- Cleartext HTTP je povolený (self-host na LAN), pro veřejný provoz používej HTTPS.
- Appka nehostuje žádný obsah, jen zprostředkovává API a přehrává streamy třetích stran.
