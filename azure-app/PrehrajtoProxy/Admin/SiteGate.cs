using System.Text.Encodings.Web;
using System.Text.Json;

namespace Wflix.Admin;

// ---------------------------------------------------------------------------
// "Vrata" před webem. Tři režimy, které jdou udělat z panelu:
//
//  1. Mimo provoz     - místo webu i veřejných /api se ukáže stránka s hláškou
//                       (503, Retry-After).
//  2. Zamknout web    - zamykací stránka s polem pro admin heslo, takže web
//                       nejde zamknout nadobro.
//  3. Vypnutí frontendu - web a veřejné /api přestanou existovat, zůstává jen
//                       panel. Bez dveří - proto se to nedá odemknout, jen vypnout.
//
// Přihlášení do panelu samo web neodemyká: jinak by se zamčený web tvářil, že
// funguje, protože ho správce vidí. Odemyká až cookie z /api/admin/unlock (30 min).
// Panel a endpoints, které potřebuje, zůstávají otevřené vždy - jinak by vznikl
// softlock. Když admin není nastavený (žádné heslo), režimy se ignorují.
// ---------------------------------------------------------------------------

public static class SiteGate
{
    private const string DefaultMessage = "Wflix je dočasně mimo provoz. Zkus to za chvíli.";

    public static bool IsAdminArea(PathString path) =>
        path.StartsWithSegments("/api/admin", StringComparison.OrdinalIgnoreCase)
        || path.Equals("/admin", StringComparison.OrdinalIgnoreCase)
        || path.Equals("/admin/", StringComparison.OrdinalIgnoreCase)
        || path.Equals("/admin.html", StringComparison.OrdinalIgnoreCase);

    /// <summary>Endpoints, které panel (a monitoring) potřebuje i při vypnutém webu.</summary>
    public static bool IsMeta(PathString path) =>
        path.Equals("/api/config", StringComparison.OrdinalIgnoreCase)
        || path.Equals("/api/health", StringComparison.OrdinalIgnoreCase)
        || path.Equals("/api/version", StringComparison.OrdinalIgnoreCase)
        || path.Equals("/api/ping", StringComparison.OrdinalIgnoreCase);

    private static bool WantsHtml(HttpRequest req)
    {
        var accept = req.Headers.Accept.ToString();
        return accept.Length == 0 || accept.Contains("text/html", StringComparison.OrdinalIgnoreCase);
    }

    public static async Task Invoke(HttpContext ctx, Func<Task> next, AdminStore store)
    {
        var flags = store.Current.Flags;
        var shutdown = flags.FrontendShutdown;
        var locked = flags.FullMaintenance;
        var maintenance = flags.Maintenance;
        if (!shutdown && !locked && !maintenance) { await next(); return; }

        var path = ctx.Request.Path;
        if (IsAdminArea(path) || IsMeta(path)) { await next(); return; }

        // Bez hesla by to nešlo odemknout - radši pustit web dál.
        if (!store.Enabled) { await next(); return; }

        // Odemčení správcem (cookie z /api/admin/unlock, 30 minut) platí na celý web.
        // Přihlášení do panelu samo o sobě web neodemyká - jinak by se zamčený web
        // tvářil, že funguje, protože ho správce vidí. Úplné vypnutí frontendu dveře
        // nemá: tam zůstává jen panel, aby šlo provoz vrátit.
        if (!shutdown && store.ValidateUnlock(ctx.Request.Cookies[AdminStore.UnlockCookie]))
        {
            await next();
            return;
        }

        var message = string.IsNullOrWhiteSpace(flags.MaintenanceMessage) ? DefaultMessage : flags.MaintenanceMessage;

        ctx.Response.Headers.CacheControl = "no-store, max-age=0";
        ctx.Response.Headers.Pragma = "no-cache";
        ctx.Response.Headers["X-Robots-Tag"] = "noindex, nofollow";
        ctx.Response.Headers.RetryAfter = "120";

        if (WantsHtml(ctx.Request))
        {
            // Zámek má na stránce přihlášení, takže je to platná stránka (200). Mimo
            // provoz a vypnutý frontend jsou dočasné odstávky, proto 503.
            ctx.Response.StatusCode = locked ? StatusCodes.Status200OK : StatusCodes.Status503ServiceUnavailable;
            ctx.Response.ContentType = "text/html; charset=utf-8";
            await ctx.Response.WriteAsync(Page(locked ? "lock" : "offline", message));
            return;
        }

        ctx.Response.StatusCode = StatusCodes.Status503ServiceUnavailable;
        ctx.Response.ContentType = "application/json; charset=utf-8";
        await ctx.Response.WriteAsync(JsonSerializer.Serialize(new
        {
            success = false,
            locked,
            shutdown,
            maintenance,
            error = message,
        }));
    }

    // Stránka je celá v jednom souboru (žádné externí css/js) - musí fungovat i ve
    // chvíli, kdy jsou statické soubory zablokované.
    private static string Page(string kind, string message)
    {
        var heading = kind == "lock" ? "Wflix je zamčený" : "Wflix je mimo provoz";
        return Template.Replace("{{TITLE}}", HtmlEncoder.Default.Encode(heading))
                       .Replace("{{HEADING}}", HtmlEncoder.Default.Encode(heading))
                       .Replace("{{MESSAGE}}", HtmlEncoder.Default.Encode(message))
                       .Replace("{{FORM}}", kind == "lock" ? UnlockForm : "");
    }

    private const string UnlockForm = """
        <form id="unlock">
            <input id="pw" type="password" placeholder="Heslo" autocomplete="current-password" autofocus>
            <button type="submit" id="go">Odemknout</button>
        </form>
        <div id="err" class="err"></div>
        <div class="note">Odemčení platí 30 minut pro tenhle prohlížeč.</div>
        <script>
        (function () {
            var form = document.getElementById('unlock');
            var pw = document.getElementById('pw');
            var go = document.getElementById('go');
            var err = document.getElementById('err');
            form.addEventListener('submit', function (e) {
                e.preventDefault();
                if (!pw.value) { err.textContent = 'Zadej heslo.'; return; }
                go.disabled = true;
                fetch('/api/admin/unlock', {
                    method: 'POST',
                    credentials: 'same-origin',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ password: pw.value })
                }).then(function (res) {
                    return res.json().catch(function () { return {}; }).then(function (d) {
                        if (res.ok) { location.reload(); return; }
                        err.textContent = d.error || ('Nepovedlo se (' + res.status + ').');
                        if (res.status === 429) { go.disabled = true; return; }
                        go.disabled = false;
                    });
                }).catch(function () {
                    err.textContent = 'Server neodpovídá.';
                    go.disabled = false;
                });
            });
        })();
        </script>
        """;

    private const string Template = """
        <!doctype html>
        <html lang="cs">
        <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <meta name="robots" content="noindex,nofollow">
        <title>{{TITLE}}</title>
        <style>
            :root { --red: #e50914; --bg: #0d0d0d; --panel: #171717; --line: #2c2c2c; --text: #e5e5e5; --muted: #8c8c8c; }
            * { box-sizing: border-box; margin: 0; padding: 0; }
            body { min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 24px;
                   background: radial-gradient(1200px 600px at 50% -10%, #2a0a0c 0%, #0d0d0d 60%);
                   color: #e5e5e5; font-family: 'Helvetica Neue', Helvetica, Arial, -apple-system, 'Segoe UI', sans-serif; }
            .card { width: 100%; max-width: 380px; background: #171717; border: 1px solid #2c2c2c;
                    border-radius: 12px; padding: 28px 24px 24px; box-shadow: 0 20px 60px rgba(0,0,0,.45); }
            .logo { font-weight: 900; font-size: 30px; color: #e50914; letter-spacing: -.5px; }
            h1 { font-size: 18px; margin: 14px 0 8px; }
            p { color: #8c8c8c; font-size: 13px; line-height: 1.5; }
            form { margin-top: 18px; display: grid; gap: 10px; }
            input { width: 100%; background: #0f0f0f; color: #e5e5e5; border: 1px solid #3a3a3a;
                    border-radius: 6px; padding: 10px 12px; font: inherit; }
            input:focus { outline: none; border-color: #e50914; }
            button { width: 100%; font: inherit; font-weight: 600; cursor: pointer; border: 1px solid #e50914;
                     background: #e50914; color: #fff; border-radius: 6px; padding: 10px 14px; }
            button:hover { background: #c00812; }
            button:disabled { opacity: .6; cursor: default; }
            .err { min-height: 18px; margin-top: 10px; color: #ff6b6b; font-size: 13px; }
            .note { margin-top: 4px; font-size: 12px; color: #6f6f6f; }
            .foot { margin-top: 18px; padding-top: 14px; border-top: 1px solid #2c2c2c; font-size: 12px; color: #8c8c8c; }
            a { color: #8c8c8c; }
        </style>
        </head>
        <body>
        <div class="card">
            <div class="logo">Wflix</div>
            <h1>{{HEADING}}</h1>
            <p>{{MESSAGE}}</p>
            {{FORM}}
            <div class="foot">Vlastník webu: <a href="/admin">admin panel</a></div>
        </div>
        </body>
        </html>
        """;
}
