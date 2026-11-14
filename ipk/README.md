# Wflix pro LG webOS TV (`ipk/`)

Webová appka pro televizory LG s webOS, zabalená do `.ipk`.

| | |
|---|---|
| **Hotový balíček** | [`cz.qikseek.wflix_1.0.0_all.ipk`](cz.qikseek.wflix_1.0.0_all.ipk) (poslední přiložený build) · **1.1.0** vyrábí CI (`webOS IPK build`) |
| **App ID** | `cz.qikseek.wflix` |
| **Verze** | 1.1.0 |
| **Zdroj** | [`app/`](app) – čisté HTML/CSS/JS, žádný build krok |
| **Rozlišení** | 1920×1080, `uiRevision: 2` |
| **Velikost** | ~153 kB (včetně `hls.min.js`) |

Stejně jako Android verze je to jen klient: po startu dostane adresu Wflix backendu a dál
používá jeho `/api/*`. UI si nese vlastní, takže nepotřebuje, aby server hostoval frontend.

---

## Instalace do televize

Bez podpisu LG certifikátem jde appka nainstalovat jen v **Developer Mode** (to je pro domácí
použití běžná cesta, platnost režimu je 1000 hodin a pak se obnovuje).

1. V TV nainstaluj z LG Content Store appku **Developer Mode**, přihlas se LG účtem a zapni
   Developer Mode. Poznamenej si **IP televize**, **passphrase** a nech vygenerovat **klíč**
   (TV ho stáhne jako `.pem`).
2. Na počítači s Node.js nainstaluj CLI:

   ```bash
   npm install -g @webos-tools/cli
   ares-setup-device            # přidej TV: IP, port 9922, uživatel "prisoner", heslo = passphrase
   ares-install -d <název-zařízení> cz.qikseek.wflix_1.0.0_all.ipk
   ares-launch  -d <název-zařízení> cz.qikseek.wflix
   ```

   (`ares-install --device tv …`, název zařízení je ten, který jsi zadal v `ares-setup-device`.)

3. Appka se objeví v launcheru jako **Wflix**.

Pro instalaci z USB disku (bez Developer Mode) musí být balíček podepsaný certifikátem
LG – to `@webos-tools/cli` neumí, potřebuješ k tomu webOS Studio / LG developer účet:

```bash
# v LG webOS Studiu: Project → Package → Sign with certificate, nebo
# v CLI s nainstalovaným profilem: ares-package --sign app -o .
```

---

## První spuštění

1. Appka naběhne na obrazovce **Připojení k serveru**.
2. Tlačítkem na adresu otevři **obrazovkovou klávesnici** (dálkový ovladač nemá klávesnici,
   proto ji appka kreslí sama) a napiš adresu backendu, např. `https://moje-app.azurewebsites.net`.
3. **Hotovo** → **Připojit**. Adresa se uloží do `localStorage` a příště se appka otevře rovnou.

Změna adresy: **Nastavení → Server → Změnit**.

---

## Ovládání dálkovým ovladačem

| Tlačítko | Akce |
|---|---|
| Šipky | pohyb mezi dlaždicemi, tlačítky a položkami nabídky |
| Enter / OK | potvrzení, přehrání, otevření detailu |
| Zpět | zavře přehrávač / detail / klávesnici; na úvodní obrazovce nechá appku běžet |
| Play / Pause | přehrání a pauza i mimo fokus na tlačítku |
| Přetáčení vpřed/vzad | skok o 10 s (u filmů) |
| Červené tlačítko | záložka Živě |
| Zelené tlačítko | seznam kanálů (číslo, název, co právě běží); šipkami výběr, OK přepne, znovu zelené nebo Zpět zavře |
| Číslice | číslo kanálu: v OSD je celé napsané číslo a seznam kanálů, na které se dá přepnout; přepne se 4 s po poslední číslici |
| Šipky v přehrávači | ←/→ skok o 10 s, ↑/↓ přesun mezi ovládacími prvky |

Fokus je vždy vidět (bílý rám + modrý obrys), ovládání přehrávače se po 5 s nečinnosti schová.

---

## Co appka umí

- **Domů** – katalog z `/api/catalog` (plakáty iTunes, české klasiky navíc), hero s plakátem
  a řady podle žánrů.
- **Hledat** – `/api/search`, výsledky seřazené podle shody názvu, detail s plakátem.
- **Přehrávač** – přímé CDN přehrávání, automatický přechod na `/api/stream` při chybě nebo
  vypršení odkazu, ruční tlačítko **Přes server**, titulky WebVTT přes `/api/subtitles`.
- **Pokračovat ve sledování** – pozice se ukládá do `localStorage` (`wflix-history`) a film naváže
  tam, kde jsi skončil (řady *Pokračovat ve sledování* a *Nedávno sledované* na úvodní stránce).
- **Oblíbené** – záložka ★ v detailu titulu a řada *Moje oblíbené* (`wflix-favs`).
- **Titulky na míru** – velikost a pozadí titulků v Nastavení (CSS proměnné, stopa se nenačítá znovu).
- **Živě** – `/api/live?epg=1` (iptv-org: Česko, Čeština, Slovensko, USA, VB) jako časová
  osa 00:00–24:00: řádek na kanál, pořady z EPG jako bloky, červená linka „teď“ a tlačítko
  Teď; kanál bez programu má blok „Data o programu nejsou k dispozici“ a pořád jde přehrát.
  Zdroj kanálů (země/jazyk) se vybírá v Nastavení, proto karta Živě žádný výběr ani filtry
  nemá – místo nich je nad průvodcem karta o pořadu: co běží nebo co je označené fokusem,
  odkdy dokdy, kolik zbývá a co následuje. HLS přes `hls.js`, relay `/api/live/hls` pro
  kanály, které chtějí vlastní User-Agent nebo Referer.
- **Nastavení** – server, přímé přehrávání, jazyk katalogu, výchozí zdroj živého vysílání,
  test spojení.

---

## Jak to funguje

```
app/
├── index.html      kostra: setup, lišta, Domů / Hledat / Živě / Nastavení, překryvy
├── styles.css      tmavý design, TV i mobil, fokus a škálování podle výšky displeje
├── app.js          logika: API, fokus/šipky, klávesnice, přehrávač, HLS, titulky
├── hls.min.js      přibalený hls.js (živé vysílání na TV bez nativního HLS)
├── appinfo.json    manifest webOS appky
└── icon.png, largeIcon.png, splash.png
```

Klient je jeden soubor logiky bez frameworku a bez build kroku – syntaxe je záměrně starší
(žádné `?.` ani `??`), aby prošla i na starším Chromiu ve webOS 4/5.

Volané endpointy: `/api/catalog`, `/api/search`, `/api/proxy`, `/api/stream`, `/api/subtitles`,
`/api/thumb`, `/api/live`, `/api/live/hls`.

### CORS

TV appka běží z `file://…`, takže každé volání API je cross-origin. Backend proto musí posílat
`Access-Control-Allow-Origin` – v tomhle repu je doplněný v `Program.cs` (ASP.NET) i
`router.php` (PHP self-host). Bez něj appka načte UI, ale katalog, hledání i přehrávání zůstanou
prázdné.

---

## Přestavba balíčku

```bash
npm install -g @webos-tools/cli
cd ipk
ares-package app -o .          # → cz.qikseek.wflix_1.1.0_all.ipk
ares-package -I cz.qikseek.wflix_1.1.0_all.ipk   # kontrola obsahu/manifestu
```

Po změně `appinfo.json` (verze, název) balíček přebal. Nová verze musí mít vyšší `version`,
jinak ji TV odmítne aktualizovat.


---

## Kontrolní seznam před vydáním (LG webOS TV)

- [ ] **Instalace a spuštění:** instalace `.ipk` přes Developer Mode (`ares-install`), ikona/název ve launcheru, splash při startu (ne černá obrazovka bez vysvětlení), první obrazovka po startu.
- [ ] **Ovládání dálkovým ovladačem:** šipky/OK/Zpět na všech obrazovkách, vždy viditelný fokus, žádné zacyklení fokusu, obrazovková klávesnice, návrat z přehrávače/detailu/nastavení.
- [ ] **Navigace a Zpět:** zavírání překryvů před opuštěním obrazovky, chování Zpět na vstupní obrazovce podle cílové verze webOS, opětovné otevření/návrat do appky (pokud je podporováno).
- [ ] **Katalog, hledání, detail:** načtení dat, prázdné výsledky, chybové stavy a opakování pokusu tam, kde je dostupné.
- [ ] **Přehrávač:** přehrávání (přímé/relay), pauza/seek, titulky, pokračování, skrytí/zobrazení ovládání, chování při chybě streamu a při pomalé síti.
- [ ] **Živé vysílání:** načtení/filtry kanálů, přehrávání (vč. HLS), chybový stav a opakování pokusu.
- [ ] **Výkon na cílových TV:** odezva fokusu/scrollu, načítání obrázků, delší přehrávání bez zamrznutí (ověřit na starších/slabších modelech, kde je to možné).
- [ ] **Balíček a metadata:** `appinfo.json` (id/verze/ikony/splash/rozlišení), správné cesty k assetům, výstup `ares-package -I`, verze vyšší než předchozí release.
- [ ] **Distribuce (pokud cílíš na LG Content Store):** připravit store ikonu/screenshoty/UX scénář a vyplněný self-checklist dle Seller Lounge; veřejně dostupné požadavky na podpis balíčku ověřit přímo v Seller Lounge/LG procesu.

---

## Omezení

- **Ověřeno v prohlížeči proti živému backendu** (render, fokus, hledání, detail, oblíbené,
  osobní řady, nastavení titulků), ale **ne na skutečné televizi**. Instalaci, ovladač a
  přehrávání je potřeba projít na TV.
- webOS nemá nativní HLS v `<video>` na všech verzích, proto je přibalený `hls.js` (MSE).
  DRM (Widevine L1) appka neřeší – zdroje s DRM nepřehraje.
- Kanály z iptv-org jsou cizí streamy: část je geoblokovaná na ČR, část je neoficiální
  re-stream a může kdykoli přestat fungovat.
- Bez podepsání LG certifikátem appka neprojde instalací z USB ani publikací v LG Content Store.
- Appka nehostuje žádný obsah, jen zprostředkovává API a přehrává streamy třetích stran.
