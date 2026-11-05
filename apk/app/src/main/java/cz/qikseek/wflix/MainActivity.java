package cz.qikseek.wflix;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.DownloadManager;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.view.KeyEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.Toast;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.Locale;

/**
 * Wflix – obal webového klienta (assets/www) pro Android / Android TV.
 *
 * Klient je stejný jako u webOS verze, jen běží v plnohodnotném Chromiu:
 *  - {@link Bridge} dává JS přístup k HTTP (obchází CORS, takže funguje i proti
 *    staršímu backendu bez Access-Control-Allow-Origin),
 *  - tlačítko Zpět zavírá překryvy v aplikaci, na úvodní obrazovce ukončí appku,
 *  - přehrávání je celoobrazovkové, displej nezhasíná, HLS řeší hls.js v klientovi.
 */
public class MainActivity extends Activity {

    private static final String START_URL = "file:///android_asset/www/index.html";
    private static final String ASSET_PREFIX = "file:///android_asset/";

    private WebView web;
    private volatile boolean backHandled = false;

    @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(0xFF050B16);
        web = new WebView(this);
        web.setLayoutParams(new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        web.setBackgroundColor(0xFF050B16);
        root.addView(web);
        setContentView(root);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setLoadWithOverviewMode(true);
        s.setUseWideViewPort(true);
        s.setAllowFileAccess(true);
        s.setAllowContentAccess(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setJavaScriptCanOpenWindowsAutomatically(false);
        s.setSupportMultipleWindows(false);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);
        // Appka je zabalená v assets a mluví s backendem na LAN/Azure – povolujeme i http.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            s.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        }
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
        });

        if (savedInstanceState != null) {
            web.restoreState(savedInstanceState);
        } else {
            web.loadUrl(START_URL);
        }
        enterImmersive(true);
    }

    /** Navigace uvnitř appky zůstane, cizí odkazy jdou do prohlížeče. */
    private boolean handleNavigation(String url) {
        if (url == null) return false;
        if (url.startsWith(ASSET_PREFIX) || url.startsWith("about:") || url.startsWith("data:")) {
            return false;
        }
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)));
        } catch (Exception ignored) {
        }
        return true;
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
    protected void onDestroy() {
        if (web != null) {
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
        web.postDelayed(new Runnable() {
            @Override
            public void run() {
                if (!backHandled) moveTaskToBack(true);
            }
        }, 450);
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
        runOnUiThread(new Runnable() {
            @Override
            public void run() {
                View decor = getWindow().getDecorView();
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                    if (on) {
                        getWindow().setDecorFitsSystemWindows(false);
                        decor.getWindowInsetsController().hide(
                                android.view.WindowInsets.Type.systemBars());
                    } else {
                        getWindow().setDecorFitsSystemWindows(true);
                        decor.getWindowInsetsController().show(
                                android.view.WindowInsets.Type.systemBars());
                    }
                } else {
                    if (on) {
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
            }
        });
    }

    /** Most pro klienta – jméno v JS je window.WflixNative. */
    private class Bridge {

        /**
         * Synchronní GET, který nepodléhá CORS (volá se z JS vlákna WebView, ne z UI).
         * Vrací tělo odpovědi, nebo "__ERROR__:popis".
         */
        @JavascriptInterface
        public String httpGet(String url) {
            HttpURLConnection conn = null;
            try {
                conn = (HttpURLConnection) new URL(url).openConnection();
                conn.setConnectTimeout(15000);
                conn.setReadTimeout(40000);
                conn.setInstanceFollowRedirects(true);
                conn.setRequestProperty("Accept", "application/json, text/plain, */*");
                conn.setRequestProperty("User-Agent", "WflixAndroid/1.0");
                int code = conn.getResponseCode();
                InputStream in = (code >= 400) ? conn.getErrorStream() : conn.getInputStream();
                if (in == null) return "__ERROR__:HTTP " + code;
                ByteArrayOutputStream out = new ByteArrayOutputStream();
                byte[] buf = new byte[16384];
                int n;
                long total = 0;
                while ((n = in.read(buf)) != -1) {
                    out.write(buf, 0, n);
                    total += n;
                    if (total > 32L * 1024 * 1024) break;      // ochrana proti obrovské odpovědi
                }
                in.close();
                String body = out.toString("UTF-8");
                if (code >= 400) return "__ERROR__:HTTP " + code;
                return body;
            } catch (Exception e) {
                return "__ERROR__:" + (e.getMessage() == null ? e.getClass().getSimpleName() : e.getMessage());
            } finally {
                if (conn != null) conn.disconnect();
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
                        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                    } else {
                        getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                    }
                }
            });
        }

        @JavascriptInterface
        public void openExternal(String url) {
            try {
                startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)));
            } catch (Exception ignored) {
            }
        }

        /** Stahování přes systémový DownloadManager (jde vždy přes /api/stream?download=1). */
        @JavascriptInterface
        public void download(String url, String name) {
            try {
                String safe = (name == null || name.trim().isEmpty()) ? "wflix-video.mp4" : name.trim();
                safe = safe.replaceAll("[\\\\/:*?\"<>|]+", "_");
                if (!safe.toLowerCase(Locale.ROOT).endsWith(".mp4")) safe += ".mp4";
                DownloadManager dm = (DownloadManager) getSystemService(Context.DOWNLOAD_SERVICE);
                if (dm == null) {
                    toast("Stahování není dostupné");
                    return;
                }
                DownloadManager.Request req = new DownloadManager.Request(Uri.parse(url));
                req.setTitle(safe);
                req.setDescription("Wflix");
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
            return "1.0.0";
        }

        @JavascriptInterface
        public boolean isTV() {
            return getPackageManager().hasSystemFeature("android.software.leanback")
                    || getPackageManager().hasSystemFeature("android.hardware.type.television");
        }

        private void toast(final String msg) {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    Toast.makeText(MainActivity.this, msg, Toast.LENGTH_LONG).show();
                }
            });
        }
    }
}
