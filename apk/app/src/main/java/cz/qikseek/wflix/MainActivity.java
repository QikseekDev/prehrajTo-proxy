package cz.qikseek.wflix;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.DownloadManager;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.net.Uri;
import android.net.http.SslError;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.view.KeyEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.webkit.JavascriptInterface;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.SslErrorHandler;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.Toast;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.MalformedURLException;
import java.net.URL;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Wflix – obal webového klienta (assets/www) pro Android / Android TV.
 *
 * Klient je stejný jako u webOS verze, jen běží v plnohodnotném Chromiu:
 *  - {@link Bridge} dává JS přístup k HTTP (obchází CORS, takže funguje i proti
 *    staršímu backendu bez Access-Control-Allow-Origin). Preferovaná je asynchronní
 *    varianta {@code httpGetAsync}, která neblokuje vykreslování stránky,
 *  - tlačítko Zpět zavírá překryvy v aplikaci, na úvodní obrazovce ukončí appku,
 *  - displej zůstává zapnutý jen při přehrávání (řídí klient přes setKeepScreenOn),
 *  - pád renderovacího procesu WebView se zotaví (WebView se znovu vytvoří).
 */
public class MainActivity extends Activity {

    private static final String START_URL = "file:///android_asset/www/index.html";
    private static final String ASSET_PREFIX = "file:///android_asset/";
    private static final int BG = 0xFF0B0C0F;
    private static final long MAX_BODY_BYTES = 32L * 1024 * 1024;   // ochrana proti obrovské odpovědi
    private static final int MAX_REDIRECTS = 5;

    private FrameLayout root;
    private WebView web;
    private ExecutorService net;
    private final Handler ui = new Handler(Looper.getMainLooper());
    private Runnable backFallback;
    private volatile boolean backHandled = false;
    private boolean immersive = true;
    private volatile boolean insecureWarned = false;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // Displej NEhoří trvale – klient zapíná FLAG_KEEP_SCREEN_ON jen při přehrávání.
        net = Executors.newFixedThreadPool(4);

        root = new FrameLayout(this);
        root.setBackgroundColor(BG);
        setContentView(root);

        // Ladění přes chrome://inspect jen u debug buildů.
        if ((getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0) {
            WebView.setWebContentsDebuggingEnabled(true);
        }

        createWebView(savedInstanceState);
        enterImmersive(true);
    }

    @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
    private void createWebView(Bundle state) {
        web = new WebView(this);
        web.setLayoutParams(new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        web.setBackgroundColor(BG);
        root.addView(web);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setLoadWithOverviewMode(true);
        s.setUseWideViewPort(true);
        // Soubory appky jsou v assets (file:///android_asset/ je dostupné vždy). Přístup k ostatním
        // souborům a content:// URI klient nepotřebuje, takže je vypínáme.
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setJavaScriptCanOpenWindowsAutomatically(false);
        s.setSupportMultipleWindows(false);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);
        // Appka je zabalená v assets a mluví s backendem na LAN/Azure – povolujeme i http.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            s.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        }
        // Stránka běží z file:// a mluví s libovolným backendem uživatele (bez CORS u starších serverů).
        s.setAllowFileAccessFromFileURLs(true);
        s.setAllowUniversalAccessFromFileURLs(true);

        web.addJavascriptInterface(new Bridge(), "WflixNative");
        web.setWebChromeClient(new WebChromeClient());
        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return handleNavigation(request.getUrl().toString());
            }

            @SuppressWarnings("deprecation")
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                return handleNavigation(url);
            }

            @Override
            public void onReceivedSslError(WebView view, SslErrorHandler handler, SslError error) {
                // Nikdy nepokračujeme s neplatným certifikátem.
                handler.cancel();
            }

            @Override
            public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
                // Renderer spadl (málo paměti / crash). Bez tohohle by padla celá appka.
                if (view == web) {
                    recreateWebView();
                }
                return true;
            }
        });

        if (state == null || web.restoreState(state) == null) {
            web.loadUrl(START_URL);
        }
    }

    private void recreateWebView() {
        if (web != null) {
            root.removeView(web);
            web.destroy();
            web = null;
        }
        createWebView(null);
        toast("Prohlížeč se restartoval");
    }

    /** Navigace uvnitř appky zůstane, cizí odkazy (jen http/https) jdou do prohlížeče. */
    private boolean handleNavigation(String url) {
        if (url == null) return false;
        if (url.startsWith(ASSET_PREFIX) || url.startsWith("about:") || url.startsWith("data:")) {
            return false;
        }
        openExternalSafe(url);
        return true;
    }

    private void openExternalSafe(String url) {
        if (!isHttpUrl(url)) return;     // žádné intent:, file:, content: apod.
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)));
        } catch (Exception ignored) {
        }
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        if (web != null) web.saveState(outState);
    }

    @Override
    protected void onPause() {
        super.onPause();
        if (web != null) web.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (web != null) web.onResume();
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        // Po dialogu / systémové liště by se jinak lišty už neschovaly.
        if (hasFocus) applyImmersive();
    }

    @Override
    protected void onDestroy() {
        ui.removeCallbacksAndMessages(null);
        if (net != null) {
            net.shutdownNow();
            net = null;
        }
        if (web != null) {
            root.removeView(web);
            web.destroy();
            web = null;
        }
        super.onDestroy();
    }

    @Override
    public void onBackPressed() {
        if (web == null) {
            super.onBackPressed();
            return;
        }
        // Necháme klienta zavřít překryv (přehrávač, detail, klávesnice). Když nic
        // nezavře, appka se dostane do pozadí – stejné chování jako u TV.
        backHandled = false;
        web.evaluateJavascript(
                "(function(){var e=new KeyboardEvent('keydown',{key:'Escape',code:'Escape',keyCode:461,which:461,bubbles:true,cancelable:true});"
                        + "document.dispatchEvent(e);return 1;})()", null);
        if (backFallback != null) ui.removeCallbacks(backFallback);
        backFallback = new Runnable() {
            @Override
            public void run() {
                if (!backHandled) moveTaskToBack(true);
            }
        };
        ui.postDelayed(backFallback, 450);
    }

    @Override
    public boolean dispatchKeyEvent(KeyEvent event) {
        // Mediální tlačítka na TV ovladači předáváme do přehrávače.
        int code = event.getKeyCode();
        if (event.getAction() == KeyEvent.ACTION_DOWN) {
            String key = null;
            if (code == KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE) key = "MediaPlayPause";
            else if (code == KeyEvent.KEYCODE_MEDIA_PLAY) key = "MediaPlay";
            else if (code == KeyEvent.KEYCODE_MEDIA_PAUSE) key = "MediaPause";
            else if (code == KeyEvent.KEYCODE_MEDIA_FAST_FORWARD) key = "MediaFastForward";
            else if (code == KeyEvent.KEYCODE_MEDIA_REWIND) key = "MediaRewind";
            if (key != null && web != null) {
                web.evaluateJavascript(
                        "document.dispatchEvent(new KeyboardEvent('keydown',{key:'" + key + "',bubbles:true}))",
                        null);
                return true;
            }
        }
        return super.dispatchKeyEvent(event);
    }

    private void enterImmersive(final boolean on) {
        immersive = on;
        runOnUiThread(new Runnable() {
            @Override
            public void run() {
                applyImmersive();
            }
        });
    }

    @SuppressWarnings("deprecation")
    private void applyImmersive() {
        View decor = getWindow().getDecorView();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            getWindow().setDecorFitsSystemWindows(!immersive);
            WindowInsetsController c = decor.getWindowInsetsController();
            if (c == null) return;      // okno ještě není připojené, zopakuje se při onWindowFocusChanged
            if (immersive) {
                c.setSystemBarsBehavior(WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
                c.hide(WindowInsets.Type.systemBars());
            } else {
                c.show(WindowInsets.Type.systemBars());
            }
        } else if (immersive) {
            decor.setSystemUiVisibility(View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                    | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                    | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                    | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                    | View.SYSTEM_UI_FLAG_FULLSCREEN
                    | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY);
        } else {
            decor.setSystemUiVisibility(View.SYSTEM_UI_FLAG_VISIBLE);
        }
    }

    /* ------------------------------------------------------------------ *
     *  HTTP pomocné funkce (volané z mostu, nikdy z UI vlákna)
     * ------------------------------------------------------------------ */

    private static boolean isHttpUrl(String url) {
        return url != null && (url.regionMatches(true, 0, "http://", 0, 7)
                || url.regionMatches(true, 0, "https://", 0, 8));
    }

    private static URL parseHttpUrl(String s) {
        if (s == null) return null;
        s = s.trim();
        if (!isHttpUrl(s)) return null;
        try {
            URL u = new URL(s);
            String host = u.getHost();
            return (host == null || host.isEmpty()) ? null : u;
        } catch (MalformedURLException e) {
            return null;
        }
    }

    /** Soukromá / lokální adresa, kde je http:// v pořádku (LAN, Termux, Tailscale…). Bez DNS dotazů. */
    private static boolean isPrivateHost(String host) {
        if (host == null) return false;
        String h = host.toLowerCase(Locale.ROOT);
        if (h.startsWith("[") && h.endsWith("]")) h = h.substring(1, h.length() - 1);
        if (h.equals("localhost") || h.endsWith(".local") || h.endsWith(".lan") || h.endsWith(".home")
                || h.endsWith(".internal") || h.endsWith(".localdomain")) {
            return true;
        }
        if (h.indexOf(':') >= 0) {
            return h.equals("::1") || h.startsWith("fc") || h.startsWith("fd") || h.startsWith("fe80");
        }
        if (h.matches("\\d{1,3}(\\.\\d{1,3}){3}")) {
            String[] p = h.split("\\.");
            int a = Integer.parseInt(p[0]);
            int b = Integer.parseInt(p[1]);
            return a == 10 || a == 127
                    || (a == 192 && b == 168)
                    || (a == 172 && b >= 16 && b <= 31)
                    || (a == 169 && b == 254)
                    || (a == 100 && b >= 64 && b <= 127);
        }
        return h.indexOf('.') < 0;      // jednoslovný hostname (např. "nas")
    }

    /** http:// mimo lokální síť posílá data nešifrovaně – upozorníme (jednou za spuštění), ale nezablokujeme. */
    private void warnIfInsecure(URL url) {
        if ("http".equalsIgnoreCase(url.getProtocol()) && !isPrivateHost(url.getHost())
                && !"wflix.runasp.net".equalsIgnoreCase(url.getHost()) && !insecureWarned) {
            insecureWarned = true;
            toast("Server běží přes nezabezpečené HTTP. Mimo domácí síť použij HTTPS.");
        }
    }

    private String userAgent() {
        String v = "1";
        try {
            v = getPackageManager().getPackageInfo(getPackageName(), 0).versionName;
        } catch (Exception ignored) {
        }
        return "WflixAndroid/" + v;
    }

    private static final class Result {
        final boolean ok;
        final String data;      // tělo odpovědi, nebo popis chyby

        private Result(boolean ok, String data) {
            this.ok = ok;
            this.data = data;
        }

        static Result ok(String d) {
            return new Result(true, d);
        }

        static Result err(String d) {
            return new Result(false, d);
        }
    }

    /** GET s ručním sledováním přesměrování (http↔https), limitem velikosti a timeouty. */
    private Result fetchBody(String urlStr, int connectMs, int readMs) {
        HttpURLConnection conn = null;
        try {
            URL url = parseHttpUrl(urlStr);
            if (url == null) return Result.err("Neplatná adresa");
            warnIfInsecure(url);
            for (int hop = 0; hop <= MAX_REDIRECTS; hop++) {
                conn = (HttpURLConnection) url.openConnection();
                conn.setConnectTimeout(connectMs);
                conn.setReadTimeout(readMs);
                conn.setInstanceFollowRedirects(false);
                conn.setRequestProperty("Accept", "application/json, text/plain, */*");
                conn.setRequestProperty("User-Agent", userAgent());
                int code = conn.getResponseCode();
                if (code == 301 || code == 302 || code == 303 || code == 307 || code == 308) {
                    String loc = conn.getHeaderField("Location");
                    conn.disconnect();
                    conn = null;
                    if (loc == null) return Result.err("HTTP " + code);
                    url = parseHttpUrl(new URL(url, loc).toString());
                    if (url == null) return Result.err("Neplatné přesměrování");
                    continue;
                }
                if (code >= 400) return Result.err("HTTP " + code);
                ByteArrayOutputStream out = new ByteArrayOutputStream();
                try (InputStream in = conn.getInputStream()) {
                    byte[] buf = new byte[16384];
                    int n;
                    long total = 0;
                    while ((n = in.read(buf)) != -1) {
                        total += n;
                        if (total > MAX_BODY_BYTES) return Result.err("Odpověď je příliš velká");
                        out.write(buf, 0, n);
                    }
                }
                return Result.ok(out.toString("UTF-8"));
            }
            return Result.err("Příliš mnoho přesměrování");
        } catch (Exception e) {
            return Result.err(e.getMessage() == null ? e.getClass().getSimpleName() : e.getMessage());
        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    private static String jsQuote(String s) {
        return JSONObject.quote(s == null ? "" : s)
                .replace("\u2028", "\\u2028")
                .replace("\u2029", "\\u2029");
    }

    /** Doručí výsledek asynchronního požadavku do window.__wflixNativeResult(id, ok, payload). */
    private void deliver(final String id, final boolean ok, final String payload) {
        runOnUiThread(new Runnable() {
            @Override
            public void run() {
                if (web == null) return;
                web.evaluateJavascript("window.__wflixNativeResult&&window.__wflixNativeResult("
                        + jsQuote(id) + "," + ok + "," + jsQuote(payload) + ")", null);
            }
        });
    }

    private void toast(final String msg) {
        runOnUiThread(new Runnable() {
            @Override
            public void run() {
                Toast.makeText(MainActivity.this, msg, Toast.LENGTH_LONG).show();
            }
        });
    }

    /** Most pro klienta – jméno v JS je window.WflixNative. */
    private class Bridge {

        /**
         * Synchronní GET (zachováno kvůli starším klientům). Blokuje JS vlákno stránky,
         * proto klient používá {@link #httpGetAsync}. Vrací tělo odpovědi, nebo "__ERROR__:popis".
         */
        @JavascriptInterface
        public String httpGet(String url) {
            Result r = fetchBody(url, 15000, 40000);
            return r.ok ? r.data : "__ERROR__:" + r.data;
        }

        /**
         * Asynchronní GET bez CORS. Výsledek přijde do
         * window.__wflixNativeResult(id, ok, payload) – stránka se při čekání neblokuje.
         */
        @JavascriptInterface
        public void httpGetAsync(final String url, final String id) {
            if (id == null || id.length() > 64) return;
            try {
                net.execute(new Runnable() {
                    @Override
                    public void run() {
                        Result r = fetchBody(url, 15000, 30000);
                        deliver(id, r.ok, r.data);
                    }
                });
            } catch (Exception e) {
                deliver(id, false, "Aplikace se ukončuje");
            }
        }

        @JavascriptInterface
        public void setFullscreen(final boolean on) {
            enterImmersive(on);
        }

        @JavascriptInterface
        public void setKeepScreenOn(final boolean on) {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    if (on) {
                        getWindow().addFlags(android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                    } else {
                        getWindow().clearFlags(android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                    }
                }
            });
        }

        @JavascriptInterface
        public void openExternal(final String url) {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    openExternalSafe(url);
                }
            });
        }

        /** Stahování přes systémový DownloadManager (jde vždy přes /api/stream?download=1). */
        @JavascriptInterface
        public void download(String url, String name) {
            try {
                URL u = parseHttpUrl(url);
                if (u == null) {
                    toast("Neplatná adresa ke stažení");
                    return;
                }
                warnIfInsecure(u);
                String safe = (name == null || name.trim().isEmpty()) ? "wflix-video.mp4" : name.trim();
                safe = safe.replaceAll("[\\\\/:*?\"<>|]+", "_");
                if (!safe.toLowerCase(Locale.ROOT).endsWith(".mp4")) safe += ".mp4";
                DownloadManager dm = (DownloadManager) getSystemService(Context.DOWNLOAD_SERVICE);
                if (dm == null) {
                    toast("Stahování není dostupné");
                    return;
                }
                DownloadManager.Request req = new DownloadManager.Request(Uri.parse(u.toString()));
                req.setTitle(safe);
                req.setDescription("Wflix");
                req.setMimeType("video/mp4");
                req.addRequestHeader("User-Agent", userAgent());
                req.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
                req.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, safe);
                dm.enqueue(req);
                toast("Stahuji: " + safe);
            } catch (Exception e) {
                toast("Stahování selhalo: " + e.getMessage());
            }
        }

        @JavascriptInterface
        public void backHandled() {
            backHandled = true;
        }

        @JavascriptInterface
        public void exitApp() {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    finish();
                }
            });
        }

        @JavascriptInterface
        public String version() {
            try {
                return getPackageManager().getPackageInfo(getPackageName(), 0).versionName;
            } catch (Exception e) {
                return "";
            }
        }

        /** Otevře systémové "Přenést obrazovku" (Google Cast / Miracast / Smart View). */
        @JavascriptInterface
        public boolean castScreen() {
            // Každý výrobce má přenos obrazovky jinde, proto víc pokusů od nejpřesnějšího.
            Intent[] intents = new Intent[] {
                    new Intent("android.settings.CAST_SETTINGS"),
                    new Intent().setClassName("com.android.settings",
                            "com.android.settings.Settings$WifiDisplaySettingsActivity"),
                    new Intent("android.settings.DISPLAY_SETTINGS"),
                    new Intent("android.settings.WIRELESS_SETTINGS")
            };
            for (Intent i : intents) {
                try {
                    i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    startActivity(i);
                    return true;
                } catch (Exception ignored) {
                    // zkusí další variantu
                }
            }
            return false;
        }

        @JavascriptInterface
        public boolean isTV() {
            return getPackageManager().hasSystemFeature("android.software.leanback")
                    || getPackageManager().hasSystemFeature("android.hardware.type.television");
        }
    }
}
