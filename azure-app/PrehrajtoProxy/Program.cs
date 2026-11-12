using System.Buffers;
using System.Collections.Concurrent;
using System.Diagnostics;
using System.Globalization;
using System.Net;
using System.Text;
using System.Text.Json;
using System.Net.Sockets;
using System.Security.Cryptography;
using System.Text.RegularExpressions;
using System.Threading.RateLimiting;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.Extensions.Caching.Memory;
using Wflix.Admin;
using Wflix.Meta;

var builder = WebApplication.CreateBuilder(args);

// HttpClient for outbound fetches (PHP proxy servery, iTunes) - na prehraj.to přímo nechodíme
builder.Services.AddHttpClient("prehraj", c =>
{
    c.DefaultRequestHeaders.UserAgent.ParseAdd(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36");
    c.DefaultRequestHeaders.AcceptLanguage.ParseAdd("cs-CZ,cs;q=0.9,en;q=0.5");
    // Zbytek hlaviček, co posílá běžný Chrome při otevření stránky. Samotný User-Agent
    // řadě WAF (hostingy, prehraj.to) nestačí a dotaz i tak označí jako bota.
    c.DefaultRequestHeaders.Accept.ParseAdd("text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8");
    c.DefaultRequestHeaders.TryAddWithoutValidation("Upgrade-Insecure-Requests", "1");
    c.DefaultRequestHeaders.TryAddWithoutValidation("Cache-Control", "no-cache");
    c.DefaultRequestHeaders.TryAddWithoutValidation("Pragma", "no-cache");
    c.DefaultRequestHeaders.TryAddWithoutValidation("sec-ch-ua", "\"Chromium\";v=\"120\", \"Not(A:Brand\";v=\"24\", \"Google Chrome\";v=\"120\"");
    c.DefaultRequestHeaders.TryAddWithoutValidation("sec-ch-ua-mobile", "?0");
    c.DefaultRequestHeaders.TryAddWithoutValidation("sec-ch-ua-platform", "\"Windows\"");
    c.DefaultRequestHeaders.TryAddWithoutValidation("Sec-Fetch-Dest", "document");
    c.DefaultRequestHeaders.TryAddWithoutValidation("Sec-Fetch-Mode", "navigate");
    c.DefaultRequestHeaders.TryAddWithoutValidation("Sec-Fetch-Site", "none");
    c.DefaultRequestHeaders.TryAddWithoutValidation("Sec-Fetch-User", "?1");
})
    // Handlery (a s nimi pooled spojení) držíme 10 minut místo výchozích 2 - seekování
    // a navazování přehrávání tak neplatí nové TLS handshaky pokaždé znovu.
    .SetHandlerLifetime(TimeSpan.FromMinutes(10))
    .ConfigurePrimaryHttpMessageHandler(() => new SocketsHttpHandler
{
    AllowAutoRedirect = true,
    AutomaticDecompression = DecompressionMethods.All,
    // Spojení na CDN držíme déle než výchozí 2 minuty. Seekování posílá několik Range
    // dotazů za sebou a bez toho by každý začínal novým TLS handshake (režie navíc).
    PooledConnectionLifetime = TimeSpan.FromMinutes(10),
    ConnectCallback = ConnectPreferIpv4,
});

// Klient pro přeposílání videa (/api/stream): bez dekomprese (Range musí sedět na bajty souboru)
// a bez celkového timeoutu - film běží hodiny, hlídáme jen nečinnost při čtení.
builder.Services.AddHttpClient("prehraj-stream", c =>
{
    c.Timeout = Timeout.InfiniteTimeSpan;
    c.DefaultRequestHeaders.UserAgent.ParseAdd(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36");
    c.DefaultRequestHeaders.AcceptLanguage.ParseAdd("cs-CZ,cs;q=0.9,en;q=0.5");
})
    .SetHandlerLifetime(TimeSpan.FromMinutes(10))
    .ConfigurePrimaryHttpMessageHandler(() => new SocketsHttpHandler
{
    AllowAutoRedirect = true,
    AutomaticDecompression = DecompressionMethods.None,
    PooledConnectionLifetime = TimeSpan.FromMinutes(10),
    ConnectCallback = ConnectPreferIpv4,
});

// Některá CDN (třeba IPTV streamy) mají AAAA záznam, i když IPv6 v Azure nefunguje. .NET pak
// čeká na IPv6 spojení, dokud nespadne timeout, a kanál se nenačte, i když IPv4 funguje hned.
// Připojujeme se proto napřed na IPv4 a IPv6 zkoušíme jen jako záložní cestu.
static async ValueTask<Stream> ConnectPreferIpv4(SocketsHttpConnectionContext ctx, CancellationToken ct)
{
    var host = ctx.DnsEndPoint.Host;
    var port = ctx.DnsEndPoint.Port;
    var addrs = IPAddress.TryParse(host, out var literal)
        ? new[] { literal }
        : await Dns.GetHostAddressesAsync(host, ct);

    var ordered = addrs.Where(a => a.AddressFamily == AddressFamily.InterNetwork)
                       .Concat(addrs.Where(a => a.AddressFamily != AddressFamily.InterNetwork));

    Exception? last = null;
    foreach (var ip in ordered)
    {
        var socket = new Socket(ip.AddressFamily, SocketType.Stream, ProtocolType.Tcp) { NoDelay = true };
        try
        {
            using var cts = CancellationTokenSource.CreateLinkedTokenSource(ct);
            cts.CancelAfter(TimeSpan.FromSeconds(6));
            await socket.ConnectAsync(new IPEndPoint(ip, port), cts.Token);
            return new NetworkStream(socket, ownsSocket: true);
        }
        catch (Exception ex)
        {
            last = ex;
            socket.Dispose();
        }
    }
    throw last ?? new IOException("DNS nevrátil pro " + host + " žádnou adresu");
}

builder.Services.AddMemoryCache();
// Admin stav (flagy, bany, zdroje) + auth. Vše v Admin/AdminStore.cs; mění se za běhu,
// zdroj pravdy pro token je ADMIN_TOKEN v prostředí, ne soubor v repu.
builder.Services.AddSingleton<AdminStore>();
builder.Services.AddSingleton<AdminTraffic>();

// Proxy servery za běhu: panel je může měnit bez nasazení. Konfigurace (Prehraj:ProxyUrls)
// je jen výchozí seznam, dokud panel proxy nezačne řídit.
builder.Services.AddSingleton(sp =>
{
    var cfg = sp.GetRequiredService<IConfiguration>();
    var urls = cfg.GetSection("Prehraj:ProxyUrls").Get<string[]>() ?? Array.Empty<string>();
    var single = cfg["Prehraj:ProxyUrl"];
    if (!string.IsNullOrWhiteSpace(single)) urls = urls.Append(single).ToArray();
    return new ProxyPool(sp.GetRequiredService<AdminStore>(), urls);
});
builder.Services.AddSingleton(sp => ProxyCommitSettings.From(sp.GetRequiredService<IConfiguration>()));

// Odhad polohy podle IP pro seznam klientů v panelu (volitelné, na pozadí).
builder.Services.AddSingleton<GeoIpService>();

// Metadata (volitelné): ČSFD přes node-csfd-api a XMLTV průvodce pro Živě. Obojí je jen
// HTTP klient - bez nastavení appka funguje beze změny, jen tyhle vrstvy nic nevrátí.
builder.Services.AddHttpClient("meta", c =>
{
    c.Timeout = TimeSpan.FromSeconds(25);
    c.DefaultRequestHeaders.UserAgent.ParseAdd("Wflix/1.0 (+https://github.com/QikseekDev/prehrajTo-proxy)");
    c.DefaultRequestHeaders.Accept.ParseAdd("application/json, application/xml, */*;q=0.5");
})
    .SetHandlerLifetime(TimeSpan.FromMinutes(10))
    .ConfigurePrimaryHttpMessageHandler(() => new SocketsHttpHandler
    {
        AllowAutoRedirect = true,
        AutomaticDecompression = DecompressionMethods.All,
        PooledConnectionLifetime = TimeSpan.FromMinutes(10),
        ConnectCallback = ConnectPreferIpv4,
    });
builder.Services.AddSingleton<CsfdClient>();
builder.Services.AddSingleton<EpgService>();

// ------------------------------------------------------------------ veřejný provoz
// App Service stojí před appkou jako reverzní proxy: bez tohohle by měly všechny
// požadavky IP front-endu Azure a limit by platil pro celý internet dohromady.
builder.Services.Configure<ForwardedHeadersOptions>(o =>
{
    o.ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto;
    o.KnownNetworks.Clear();
    o.KnownProxies.Clear();
});

// Přibližný počet „online“ uživatelů: anonymní klient pošle stabilní cid (localStorage) jako
// ?cid= / X-Wflix-Client a server si pamatuje poslední aktivitu. Jen orientační indikátor pro
// malou skupinu (sdílená NAT = méně unikátních IP, ale cid je rozliší).
var Presence = new ConcurrentDictionary<string, DateTime>();
const int PresenceWindowSeconds = 90;
static string? PresenceId(HttpContext ctx)
{
    var id = ctx.Request.Query["cid"].ToString();
    if (string.IsNullOrWhiteSpace(id))
        id = ctx.Request.Headers["X-Wflix-Client"].ToString();
    if (string.IsNullOrWhiteSpace(id)) return null;
    id = id.Trim();
    if (id.Length < 8 || id.Length > 80) return null;
    foreach (var c in id) if (!char.IsLetterOrDigit(c) && c != '-' && c != '_') return null;
    return id;
}
void TouchPresence(HttpContext ctx)
{
    var id = PresenceId(ctx) ?? ("ip:" + ClientKey(ctx));
    var now = DateTime.UtcNow;
    Presence[id] = now;
    // občas prořezat, ať slovník neroste do nekonečna
    if ((now.Ticks & 0xFF) == 0)
    {
        var cut = now.AddSeconds(-PresenceWindowSeconds * 2);
        foreach (var kv in Presence) if (kv.Value < cut) Presence.TryRemove(kv.Key, out _);
    }
}
int OnlineCount()
{
    var cut = DateTime.UtcNow.AddSeconds(-PresenceWindowSeconds);
    var n = 0;
    foreach (var kv in Presence) if (kv.Value >= cut) n++; else if (kv.Value < cut.AddSeconds(-PresenceWindowSeconds)) Presence.TryRemove(kv.Key, out _);
    return n;
}


// Limity platí na IP a jen pro /api (statické soubory se nelimitují). Nastavené tak,
// aby běžnému člověku nepřekážely, ale scrapeování bylo pomalé:
//   search  - 5 dotazů/s, dávka 20: jeden search = jeden request; celá třída za jednou
//             NAT IP se do dávky vejde, skutečný strop je stejně limit prehraj.to (PacedFirstWorking)
//   api     - 6/s, dávka 20: přehrávač při seekování pošle víc Range dotazů naráz
//   thumb   - 10/s, dávka 40: úvodní stránka posílá náhledy všech posterů najednou
builder.Services.AddRateLimiter(o =>
{
    o.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
    o.OnRejected = async (ctx, ct) =>
    {
        ctx.HttpContext.Response.Headers.RetryAfter = "20";
        ctx.HttpContext.Response.ContentType = "application/json; charset=utf-8";
        var payload = JsonSerializer.Serialize(new
        {
            success = false,
            rateLimited = true,
            retryAfter = 20,
            onlineUsers = OnlineCount(),
            error = "Příliš mnoho požadavků. Chvilku počkej a zkus to znovu."
        });
        await ctx.HttpContext.Response.WriteAsync(payload, ct);
    };

    o.AddPolicy("search", ctx => RateLimitPartition.GetTokenBucketLimiter(ClientKey(ctx), _ => new TokenBucketRateLimiterOptions
    {
        TokenLimit = 20,
        TokensPerPeriod = 5,
        ReplenishmentPeriod = TimeSpan.FromSeconds(1),
        QueueLimit = 0,
        AutoReplenishment = true,
    }));

    o.AddPolicy("api", ctx => RateLimitPartition.GetTokenBucketLimiter(ClientKey(ctx), _ => new TokenBucketRateLimiterOptions
    {
        TokenLimit = 20,
        TokensPerPeriod = 6,
        ReplenishmentPeriod = TimeSpan.FromSeconds(1),
        QueueLimit = 0,
        AutoReplenishment = true,
    }));

    // Titulky: prohlížeč načte při otevření videa jeden až několik malých VTT souborů.
    // "api" limit 6/s by je zbytečně zahazoval, samostatný limit je benevolentnější.
    o.AddPolicy("subs", ctx => RateLimitPartition.GetTokenBucketLimiter(ClientKey(ctx), _ => new TokenBucketRateLimiterOptions
    {
        TokenLimit = 60,
        TokensPerPeriod = 20,
        ReplenishmentPeriod = TimeSpan.FromSeconds(1),
        QueueLimit = 0,
        AutoReplenishment = true,
    }));

    o.AddPolicy("thumb", ctx => RateLimitPartition.GetTokenBucketLimiter(ClientKey(ctx), _ => new TokenBucketRateLimiterOptions
    {
        TokenLimit = 40,
        TokensPerPeriod = 10,
        ReplenishmentPeriod = TimeSpan.FromSeconds(1),
        QueueLimit = 0,
        AutoReplenishment = true,
    }));

    // HLS relay: jeden divák posílá playlist, segmenty a klíč každé pár sekund, takže holý "api"
    // limit by přehrávání sám rozbil. Pořád to ale není neomezené - 40 dotazů/s na IP stačí na
    // několik paralelních streamů a scraping přes relay je pomalý.
    o.AddPolicy("live", ctx => RateLimitPartition.GetTokenBucketLimiter(ClientKey(ctx), _ => new TokenBucketRateLimiterOptions
    {
        TokenLimit = 120,
        TokensPerPeriod = 40,
        ReplenishmentPeriod = TimeSpan.FromSeconds(1),
        QueueLimit = 0,
        AutoReplenishment = true,
    }));

    // Admin panel: pár dotazů za sekundu stačí (UI polluje stav), ale nesmí to být
    // neomezené - login je navíc throttlovaný zvlášť (5 pokusů / 10 min na IP).
    o.AddPolicy("admin", ctx => RateLimitPartition.GetTokenBucketLimiter(ClientKey(ctx), _ => new TokenBucketRateLimiterOptions
    {
        TokenLimit = 30,
        TokensPerPeriod = 10,
        ReplenishmentPeriod = TimeSpan.FromSeconds(1),
        QueueLimit = 0,
        AutoReplenishment = true,
    }));
});

var app = builder.Build();

app.UseForwardedHeaders();

var adminStore = app.Services.GetRequiredService<AdminStore>();
var proxyPool = app.Services.GetRequiredService<ProxyPool>();
var traffic = app.Services.GetRequiredService<AdminTraffic>();

// ------------------------------------------------------------------ vrata: údržba / vypnutí webu
// Běží první, aby se zamčený nebo vypnutý web neprojevil ani statickými soubory. Admin panel
// a endpoints, které panel potřebuje, zůstávají vždycky otevřené - jinak by vznikl softlock.
app.Use((ctx, next) => SiteGate.Invoke(ctx, next, adminStore));

// Kdo je na webu: IP, čas a cesta pro seznam v panelu (geolokace se doplňuje až tam).
app.Use(async (ctx, next) =>
{
    adminStore.TouchVisitor(ClientKey(ctx), ctx.Request.Headers.UserAgent.ToString(), ctx.Request.Path.Value);
    await next();
});

// Telemetrie provozu pro panel (jen veřejné /api, ne admin volání a statické soubory).
app.Use(async (ctx, next) =>
{
    var path = ctx.Request.Path;
    if (!path.StartsWithSegments("/api") || path.StartsWithSegments("/api/admin"))
    {
        await next();
        return;
    }

    var started = Stopwatch.GetTimestamp();
    try
    {
        await next();
    }
    finally
    {
        var ms = Stopwatch.GetElapsedTime(started).TotalMilliseconds;
        traffic.Record(ctx.Request.Method, path.Value ?? "/", ctx.Response.StatusCode, ms, ClientKey(ctx));
    }
});

// ------------------------------------------------------------------ admin: bany, údržba, statistiky
// Čte se z admin stavu (Admin/AdminStore.cs) při každém požadavku, takže vypnutí zdroje,
// maintenance nebo ban platí do sekundy bez restartu a bez nasazení.
// /api/admin a /api/config zůstávají dostupné i v údržbě, aby se dalo vrátit zpět.
app.Use(async (ctx, next) =>
{
    if (!ctx.Request.Path.StartsWithSegments("/api"))
    {
        await next();
        return;
    }

    var isAdmin = ctx.Request.Path.StartsWithSegments("/api/admin");

    if (!isAdmin && adminStore.ActiveBan(ctx) is { } ban)
    {
        var seconds = Math.Max(1, (int)(ban.Until - DateTimeOffset.UtcNow).TotalSeconds);
        ctx.Response.StatusCode = StatusCodes.Status403Forbidden;
        ctx.Response.Headers.RetryAfter = seconds.ToString();
        ctx.Response.ContentType = "application/json; charset=utf-8";
        await ctx.Response.WriteAsync(JsonSerializer.Serialize(new
        {
            success = false,
            blocked = true,
            until = ban.Until,
            error = "Přístup z tohoto zařízení je zablokovaný."
                    + (string.IsNullOrWhiteSpace(ban.Reason) ? "" : " (" + ban.Reason + ")"),
        }));
        adminStore.CountRequest(ClientKey(ctx), StatusCodes.Status403Forbidden);
        return;
    }

    var flags = adminStore.Current.Flags;
    var alwaysOpen = isAdmin
        || ctx.Request.Path.StartsWithSegments("/api/config")
        || ctx.Request.Path.StartsWithSegments("/api/health")
        // Správce s odemčeným webem (cookie z /api/admin/unlock) vidí i /api.
        || adminStore.ValidateUnlock(ctx.Request.Cookies[AdminStore.UnlockCookie]);
    if (flags.Maintenance && !alwaysOpen)
    {
        ctx.Response.StatusCode = StatusCodes.Status503ServiceUnavailable;
        ctx.Response.Headers.RetryAfter = "60";
        ctx.Response.ContentType = "application/json; charset=utf-8";
        await ctx.Response.WriteAsync(JsonSerializer.Serialize(new
        {
            success = false,
            maintenance = true,
            error = flags.MaintenanceMessage,
        }));
        adminStore.CountRequest(ClientKey(ctx), StatusCodes.Status503ServiceUnavailable);
        return;
    }

    await next();
    adminStore.CountRequest(ClientKey(ctx), ctx.Response.StatusCode);
});

// Přibližná přítomnost pro indikátor „kolik lidí je online“ (viz PresenceId/OnlineCount).
app.Use(async (ctx, next) =>
{
    if (ctx.Request.Path.StartsWithSegments("/api"))
        TouchPresence(ctx);
    await next();
});

// /api nic neblokuje podle User-Agenta ani podle Refereru. WebView v mobilní appce
// a obecně jakýkoli jiný klient posílá jiné (nebo žádné) hlavičky než prohlížeč a blokace
// mu vracela 403, takže se aplikace tvářila jako rozbitá. Zůstávají jen limity výš -
// ty platí na IP a jsou nastavené tak, aby běžnému divákovi nepřekážely.
app.UseRateLimiter();

// Automatické verzování statických souborů (cache busting). Do index.html se při každém
// požadavku vkládá hash obsahu script.js / styles.css / intro.css, takže po nasazení se změní
// URL a prohlížeč si nikdy nedrží starý skript. Ruční přepisování ?v= v HTML už není potřeba.
var webRoot = app.Environment.WebRootPath ?? Path.Combine(app.Environment.ContentRootPath, "wwwroot");
var assetVersions = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
foreach (var asset in new[] { "script.js", "styles.css", "intro.css", "fonts.css" })
{
    try
    {
        using var fs = File.OpenRead(Path.Combine(webRoot, asset));
        assetVersions[asset] = Convert.ToHexString(SHA256.HashData(fs))[..12].ToLowerInvariant();
    }
    catch
    {
        assetVersions[asset] = DateTime.UtcNow.ToString("yyyyMMddHHmmss");
    }
}

// HTML (index) se neukládá do cache vůbec - jinak by prohlížeč mohl držet starou stránku
// s odkazy na staré soubory. Verzované css/js naopak držet můžeme (měsíc), URL se mění s obsahem.
app.Use(async (ctx, next) =>
{
    var path = ctx.Request.Path.Value ?? "/";
    if (!path.Equals("/", StringComparison.Ordinal) && !path.Equals("/index.html", StringComparison.OrdinalIgnoreCase))
    {
        await next();
        return;
    }
    string html;
    try { html = await File.ReadAllTextAsync(Path.Combine(webRoot, "index.html"), ctx.RequestAborted); }
    catch { await next(); return; }

    html = Regex.Replace(html, "(?<attr>href|src)=\"(?<name>script\\.js|styles\\.css|intro\\.css|fonts\\.css)\\?v=[^\"]*\"",
        m => m.Groups["attr"].Value + "=\"" + m.Groups["name"].Value + "?v="
             + (assetVersions.TryGetValue(m.Groups["name"].Value, out var v) ? v : "1") + "\"");

    ctx.Response.Headers.CacheControl = "no-store, max-age=0";
    ctx.Response.Headers.Pragma = "no-cache";
    ctx.Response.ContentType = "text/html; charset=utf-8";
    await ctx.Response.WriteAsync(html);
});

app.UseDefaultFiles();
app.UseStaticFiles(new StaticFileOptions
{
    OnPrepareResponse = ctx =>
    {
        var file = ctx.File.Name;
        var versioned = file.EndsWith(".css") || file.EndsWith(".js")
            || file.EndsWith(".png") || file.EndsWith(".svg") || file.EndsWith(".woff2");
        ctx.Context.Response.Headers.CacheControl = versioned
            ? "public, max-age=2592000"
            : "no-cache";
    }
});

// Optional: set "Prehraj:ProxyUrls" in appsettings.json / Azure config (Prehraj__ProxyUrls__0,
// Prehraj__ProxyUrls__1, ... in App Service) to a list of your own index.php hosts
// (e.g. "https://wtzi.borec.cz/index.php") to route through them instead of calling prehraj.to
// directly. With several entries they're tried one after another in order - the first one that
// answers correctly is used, a dead or rate-limited one is skipped and the next one is tried.
// The last server that worked is tried first next time. This is the server-side default used
// when the client sends none; "Prehraj:ProxyUrl" (singular) still works for a single URL.
// (Seznam se bere z ProxyPool - panel ho může za běhu změnit; appsettings je jen výchozí.)

// Vlastní IPTV playlisty (M3U) nad rámec iptv-org: "Prehraj:LivePlaylists" v appsettings.json /
// Azure jako Prehraj__LivePlaylists__0, __1, ... Index v tomhle poli posílá prohlížeč jako
// /api/live?custom=<index>. Pro vlastní zdroj (IPTV od poskytovatele) je to jediná cesta -
// z prohlížeče se libovolná URL nenačítá, aby appka nebyla otevřený proxy pro cokoli.
var liveCustom = app.Configuration.GetSection("Prehraj:LivePlaylists").Get<string[]>() ?? Array.Empty<string>();

const RegexOptions Ci = RegexOptions.IgnoreCase | RegexOptions.CultureInvariant;

// Klíč limitu pro jednu IP (skutečnou IP klienta za App Service doplní UseForwardedHeaders).
static string ClientKey(HttpContext ctx) => ctx.Connection.RemoteIpAddress?.ToString() ?? "unknown";

// ------------------------------------------------------------------ helpers
static bool IsAllowedHost(string host, params string[] domains) =>
    domains.Any(d => host.Equals(d, StringComparison.OrdinalIgnoreCase) || host.EndsWith("." + d, StringComparison.OrdinalIgnoreCase));

static bool IsPrehrajUrl(string u) =>
    Uri.TryCreate(u, UriKind.Absolute, out var x)
    && (x.Scheme == Uri.UriSchemeHttp || x.Scheme == Uri.UriSchemeHttps)
    && IsAllowedHost(x.Host, "prehraj.to");

static bool IsAllowedSourcePageUrl(string u) =>
    Uri.TryCreate(u, UriKind.Absolute, out var x)
    && (x.Scheme == Uri.UriSchemeHttp || x.Scheme == Uri.UriSchemeHttps)
    && IsAllowedHost(x.Host, "prehraj.to", "bombuj.si", "sledujteto.cz");

static string NormalizeSource(string? s)
{
    s = (s ?? "prehrajto").Trim().ToLowerInvariant();
    return s switch
    {
        "prehraj" or "prehrajto" or "prehraj.to" => "prehrajto",
        "bombuj" or "bombuj.si" => "bombuj",
        "sledujteto" or "sledujteto.cz" or "old.sledujteto.cz" => "sledujteto",
        "all" or "merge" or "both" or "prehrajto+sledujteto" => "all",
        _ => "prehrajto"
    };
}

static async Task<(int status, string body, string? error)> GetAsync(
    IHttpClientFactory f, string url, int timeoutSeconds, Action<HttpRequestMessage>? tweak = null,
    CancellationToken ct = default)
{
    try
    {
        using var cts = CancellationTokenSource.CreateLinkedTokenSource(ct);
        cts.CancelAfter(TimeSpan.FromSeconds(timeoutSeconds));
        using var req = new HttpRequestMessage(HttpMethod.Get, url);
        tweak?.Invoke(req);
        using var res = await f.CreateClient("prehraj").SendAsync(req, HttpCompletionOption.ResponseContentRead, cts.Token);
        var body = await res.Content.ReadAsStringAsync(cts.Token);
        return ((int)res.StatusCode, body, null);
    }
    catch (Exception ex)
    {
        return (0, "", ex.Message);
    }
}

// 2xx = úspěch. Cokoli jiného (429, 403, 5xx, timeout, ...) je chyba a jde se dalšího zdroje.
static bool Is2xx(int s) => s >= 200 && s < 300;

// Přeposílání streamu po blocích s hlídačem nečinnosti. Segment nebo soubor, který přestane
// téct, nesmí držet spojení (a vlákno) na sdíleném hostingu viset až do timeoutu klienta.
// Buffer se půjčuje z poolu, takže souběžné přenosy nealokují 32 kB každý znovu.
static async Task CopyWithIdleTimeout(Stream src, Stream dst, CancellationToken ct, int idleSeconds = 30)
{
    var buf = ArrayPool<byte>.Shared.Rent(32768);
    try
    {
        using var cts = CancellationTokenSource.CreateLinkedTokenSource(ct);
        while (true)
        {
            int n;
            try
            {
                cts.CancelAfter(TimeSpan.FromSeconds(idleSeconds));
                n = await src.ReadAsync(buf.AsMemory(0, buf.Length), cts.Token);
            }
            catch (OperationCanceledException) when (ct.IsCancellationRequested) { return; }
            catch (Exception) { return; }   // utržené spojení: klient dostane jen to, co už přišlo
            if (n <= 0) break;
            await dst.WriteAsync(buf.AsMemory(0, n), ct);
        }
    }
    finally { ArrayPool<byte>.Shared.Return(buf); }
}

// Odpověď se počítá jako úspěšná jen když není JSON chyba. PHP proxy servery (wtzi.borec.cz atd.)
// vrací chybu z prehraj.to jako HTTP 200 + {"success":false,...} - bez tohohle by taková odpověď
// přebila fungující zdroj a 429 by se nikdy nepřeskočilo na další server.
static bool IsGoodBody(string body)
{
    var t = body.TrimStart();
    if (t.Length == 0 || t[0] != '{') return true;   // HTML/aplikace: bereme cokoli neprázdného
    try
    {
        using var d = JsonDocument.Parse(t);
        var r = d.RootElement;
        if (r.ValueKind != JsonValueKind.Object) return true;
        if (r.TryGetProperty("success", out var s) && s.ValueKind == JsonValueKind.False) return false;
        // {"valid":false,"error":...} = nepovedlo se ověřit (chyba); {"valid":false,"status":404}
        // bez error = platná odpověď "video neplatné".
        if (r.TryGetProperty("valid", out var v) && v.ValueKind == JsonValueKind.False
            && r.TryGetProperty("error", out _)) return false;
        return true;
    }
    catch (JsonException) { return true; }
}

// Jeden PHP proxy server jako kandidát do závodu (stejné hlavičky jako dřív přes ViaProxyRace).
static Func<CancellationToken, Task<(int status, string body, string? err)>> ProxySource(
    IHttpClientFactory f, string proxyBase, string query, int timeoutSeconds, Action<string>? onGood = null)
{
    var sep = proxyBase.Contains('?') ? "&" : "?";
    var url = proxyBase + sep + query;
    return async ct =>
    {
        var r = await GetAsync(f, url, timeoutSeconds, null, ct);
        // server, který odpověděl správně, se příště zkouší jako první
        if (onGood != null && r.error == null && Is2xx(r.status) && r.body.Length > 0 && IsGoodBody(r.body))
            onGood(proxyBase);
        return r;
    };
}

// Zkusí zdroje jeden po druhém v pořadí a vrátí první odpověď, která projde:
// 2xx + neprázdné tělo + není JSON chyba. Žádný závod - teprve když zdroj selže
// (timeout, chyba, 429, ...), jde se na další. Výsledek je tak vždy z prvního funkčního
// zdroje a funkční server se nezatěžuje souběžnými dotazy.
static async Task<(bool ok, string body, List<string> errors)> FirstWorking(
    Func<CancellationToken, Task<(int status, string body, string? err)>>[] sources,
    CancellationToken ct = default)
{
    var errors = new List<string>();
    foreach (var src in sources)
    {
        if (ct.IsCancellationRequested) return (false, "", errors);
        (int status, string body, string? err) r;
        try { r = await src(ct); }
        catch (OperationCanceledException) when (ct.IsCancellationRequested) { return (false, "", errors); }
        catch (Exception ex) { errors.Add(ex.Message); continue; }
        if (r.err == null && Is2xx(r.status) && r.body.Length > 0 && IsGoodBody(r.body))
            return (true, r.body, errors);
        errors.Add(r.err ?? $"HTTP {r.status}");
    }
    return (false, "", errors);
}

// prehraj.to pustí z jedné IP zhruba 5 hledání za 10 s a pak na ~15-20 s vrací 429. Všechny
// PHP proxy servery jedou ze stejné egress IP, takže u 429 nemá smysl přeskakovat na další -
// jen se spálí další dva pokusy a limit se prodlouží. Hledání proto pouštíme po jednom
// s odstupem a po 429 zkusíme stejný server znovu; jiná chyba (timeout, 5xx) znamená vadný
// server a jde se na další. Když je fronta delší než pár vteřin, vrátíme rate-limited hned -
// klient to sám zopakuje (a mezitím se odpověď klidně objeví v cache od jiného diváka).
var upstreamGate = new SemaphoreSlim(1, 1);
var nextUpstreamSlot = DateTime.MinValue;
const int UpstreamSpacingMs = 1600;
const int UpstreamMaxQueueMs = 20000;

async Task<(bool ok, string body, List<string> errors)> PacedFirstWorking(
    Func<CancellationToken, Task<(int status, string body, string? err)>>[] sources,
    CancellationToken ct = default)
{
    var errors = new List<string>();
    foreach (var src in sources)
    {
        for (var attempt = 0; attempt < 2; attempt++)
        {
            if (ct.IsCancellationRequested) return (false, "", errors);

            DateTime slot;
            await upstreamGate.WaitAsync(ct);
            try
            {
                var now = DateTime.UtcNow;
                slot = nextUpstreamSlot > now ? nextUpstreamSlot : now;
                if (slot - now > TimeSpan.FromMilliseconds(UpstreamMaxQueueMs))
                {
                    errors.Add("HTTP 429");
                    return (false, "", errors);
                }
                nextUpstreamSlot = slot.AddMilliseconds(UpstreamSpacingMs);
            }
            finally { upstreamGate.Release(); }

            var wait = slot - DateTime.UtcNow;
            if (wait > TimeSpan.Zero) await Task.Delay(wait, ct);

            (int status, string body, string? err) r;
            try { r = await src(ct); }
            catch (OperationCanceledException) when (ct.IsCancellationRequested) { return (false, "", errors); }
            catch (Exception ex) { errors.Add(ex.Message); break; }

            if (r.err == null && Is2xx(r.status) && r.body.Length > 0 && IsGoodBody(r.body))
                return (true, r.body, errors);

            errors.Add(r.err ?? $"HTTP {r.status}");
            if (r.status != 429) break;   // vadný server -> další proxy
            if (attempt + 1 < 2) await Task.Delay(TimeSpan.FromSeconds(20), ct);
        }
    }
    return (false, "", errors);
}

// Společná chybová odpověď, když selže úplně všechno (proxy i přímé volání).
// Když některý zdroj vrátil 429, klient dostane rateLimited + retryAfter a sám to za pár vteřin zkusí znovu.
IResult AllFailed(List<string> errors)
{
    var rl = errors.Any(e => e.Contains("429"));
    return Results.Json(new
    {
        success = false,
        valid = false,
        rateLimited = rl,
        retryAfter = rl ? 20 : 0,
        onlineUsers = OnlineCount(),
        error = rl
            ? "Příliš mnoho požadavků na prehraj.to. Chvilku počkej a zkus to znovu."
            : "Všechny zdroje selhaly: " + string.Join(" | ", errors),
    });
}

// Client-supplied "proxy" query param(s) (Nastavení → "Použít PHP proxy"). Repeatable:
// ?proxy=a&proxy=b&proxy=c. Only absolute http(s) URLs are accepted, so a client can't point
// the server at an arbitrary internal/non-http target; invalid/duplicate entries are dropped.
static bool IsValidProxyUrl(string? u) =>
    !string.IsNullOrWhiteSpace(u)
    && Uri.TryCreate(u, UriKind.Absolute, out var x)
    && (x.Scheme == Uri.UriSchemeHttp || x.Scheme == Uri.UriSchemeHttps);

static string[] EffectiveProxies(string[]? clientProxies, string[] serverProxies)
{
    var valid = (clientProxies ?? Array.Empty<string>())
        .Where(IsValidProxyUrl).Distinct(StringComparer.OrdinalIgnoreCase).ToArray();
    if (valid.Length > 0) return valid;
    return serverProxies.Where(IsValidProxyUrl).Distinct(StringComparer.OrdinalIgnoreCase).ToArray();
}

// Poslední proxy server, který odpověděl správně - zkouší se první, aby se po výpadku
// nečekalo zbytečně na mrtvém serveru u každého dotazu.
string? lastGoodProxy = null;

// Který proxy server zrovna obsloužil dotaz, posíláme i do prohlížeče (odznak v liště).
// Je to poslední server, který odpověděl správně - stejná hodnota, podle které se řídí
// pořadí na další dotaz. Když se servery přepnou, prohlížeč to pozná podle změny hlavičky
// a může dát vědět, že první načtení po přepnutí může být pomalejší (timeout mrtvého serveru).
app.Use(async (ctx, next) =>
{
    ctx.Response.OnStarting(() =>
    {
        if (ctx.Request.Path.StartsWithSegments("/api") && !string.IsNullOrEmpty(lastGoodProxy))
            ctx.Response.Headers["X-Wflix-Proxy"] = lastGoodProxy;
        return Task.CompletedTask;
    });
    await next();
});

// ------------------------------------------------------------------ cache výsledků hledání / ověření
// Výsledek se drží v paměti serveru a sdílí se mezi všemi uživateli, takže stejný dotaz (a stejné
// ověření videa) jde na prehraj.to jednou, ne pokaždé. Souběžné stejné dotazy se spojí do jednoho
// (single-flight). Když zdroje selžou (429 apod.) a máme starší kopii, vrátí se ta - radši mírně
// zastaralý výsledek než chyba.
var inflight = new ConcurrentDictionary<string, Lazy<Task<(bool ok, string body, List<string> errors)>>>();

async Task<(bool ok, string body, List<string> errors)> CachedFetch(
    IMemoryCache cache, string key, string scope, Func<string, TimeSpan> ttlFor,
    Func<Task<(bool ok, string body, List<string> errors)>> fetch)
{
    if (cache.TryGetValue(key, out string? hit) && !string.IsNullOrEmpty(hit))
    {
        WflixCache.Hit();
        return (true, hit, new List<string>());
    }
    WflixCache.Miss();

    var lazy = inflight.GetOrAdd(key, k => new Lazy<Task<(bool ok, string body, List<string> errors)>>(async () =>
    {
        try
        {
            var r = await fetch();
            if (r.ok)
            {
                cache.Set(key, r.body, ttlFor(r.body));
                cache.Set("stale:" + key, r.body, TimeSpan.FromHours(6));
                WflixCache.Track(key, scope);
                WflixCache.Track("stale:" + key, scope);
                return r;
            }
            if (cache.TryGetValue("stale:" + key, out string? old) && !string.IsNullOrEmpty(old))
            {
                WflixCache.Hit();
                return (true, old, r.errors);
            }
            return r;
        }
        finally { inflight.TryRemove(key, out _); }
    }));
    return await lazy.Value;
}

// Výsledky hledání: s nálezy 30 min, prázdné jen 5 min (aby se nový obsah brzy objevil).
static TimeSpan SearchTtl(string body)
{
    try
    {
        using var d = JsonDocument.Parse(body);
        if (d.RootElement.ValueKind == JsonValueKind.Object
            && d.RootElement.TryGetProperty("movies", out var m)
            && m.ValueKind == JsonValueKind.Array && m.GetArrayLength() > 0)
            return TimeSpan.FromMinutes(30);
    }
    catch (JsonException) { }
    return TimeSpan.FromMinutes(5);
}

// Náhledy: nalezený plakát držíme týden, nenalezený hodinu - stejně jako dřív, jen teď
// i pro odpovědi z PHP proxy. TTL se počítá z těla, protože se cachuje hotový JSON.
static TimeSpan ThumbTtl(string body)
{
    try
    {
        using var d = JsonDocument.Parse(body);
        var thumb = d.RootElement.ValueKind == JsonValueKind.Object
            && d.RootElement.TryGetProperty("thumbnail", out var th) ? th.GetString() ?? "" : "";
        return thumb.Length > 0 ? TimeSpan.FromDays(7) : TimeSpan.FromHours(1);
    }
    catch (JsonException) { return TimeSpan.FromHours(1); }
}

// Prohlížeč posílá seznam proxy u každého dotazu (?proxy=... z DEFAULT_PROXY_SERVERS), takže
// "dotaz bez ?proxy=" v praxi neexistuje - podle toho se sdílená cache nesmí vypínat, jinak
// se nikdy nepoužije a každé hledání jde znovu na prehraj.to. Sada proxy jde proto do klíče:
// stejná sada (v libovolném pořadí) sdílí výsledky, jiná sada má vlastní záznam, takže cizí
// server nemůže podstrčit výsledky do sdílené cache.
static string CacheScope(string[] proxies) => proxies.Length == 0
    ? "direct"
    : Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(
        string.Join("\n", proxies.OrderBy(p => p, StringComparer.OrdinalIgnoreCase))))).Substring(0, 16);

// Pořadí proxy serverů: naposledy funkční jde první, ostatní v pořadí z konfigurace/klienta.
IEnumerable<string> OrderedProxies(IEnumerable<string> proxies)
{
    var arr = proxies.Where(IsValidProxyUrl).Distinct(StringComparer.OrdinalIgnoreCase).ToList();
    var good = lastGoodProxy;
    if (good == null || arr.Count < 2) return arr;
    return arr.OrderBy(p => string.Equals(p, good, StringComparison.OrdinalIgnoreCase) ? 0 : 1);
}

// ------------------------------------------------------------------ live helpers
// M3U z iptv-org: hlavička #EXTINF s atributy a názvem za čárkou, na dalším řádku URL.
static List<LiveChannel> ParseM3u(string text)
{
    var list = new List<LiveChannel>();
    var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
    string? name = null, logo = null, group = null, id = null, ua = null, referrer = null;

    foreach (var raw in text.Split('\n'))
    {
        var line = raw.TrimEnd('\r').Trim();
        if (line.Length == 0) continue;

        if (line.StartsWith("#EXTINF", StringComparison.OrdinalIgnoreCase))
        {
            var comma = line.LastIndexOf(',');
            var attrs = comma >= 0 ? line[..comma] : line;
            name = comma >= 0 ? line[(comma + 1)..].Trim() : "";
            logo = M3uAttr(attrs, "tvg-logo");
            group = M3uAttr(attrs, "group-title");
            id = M3uAttr(attrs, "tvg-id");
            // některé playlisty mají hlavičky přímo v #EXTINF
            ua = NilIfEmpty(M3uAttr(attrs, "http-user-agent")) ?? ua;
            referrer = NilIfEmpty(M3uAttr(attrs, "http-referrer")) ?? referrer;
            continue;
        }
        if (line.StartsWith("#EXTVLCOPT:", StringComparison.OrdinalIgnoreCase))
        {
            var opt = line["#EXTVLCOPT:".Length..].Trim();
            if (opt.StartsWith("http-user-agent=", StringComparison.OrdinalIgnoreCase))
                ua = CleanHeader(opt["http-user-agent=".Length..]);
            else if (opt.StartsWith("http-referrer=", StringComparison.OrdinalIgnoreCase))
                referrer = CleanHeader(opt["http-referrer=".Length..]);
            continue;
        }
        if (line.StartsWith('#')) continue;

        if (name == null) continue;
        if (!Uri.TryCreate(line, UriKind.Absolute, out var u)
            || (u.Scheme != Uri.UriSchemeHttp && u.Scheme != Uri.UriSchemeHttps))
        {
            name = null;
            continue;
        }

        // Poznámky v playlistu ("[Geo-blocked]", "[Not 24/7]") si necháme jako tagy pro UI,
        // protože přesně říkají, proč kanál občas nejde. Z názvu ale zmizí.
        var quality = "";
        var qm = Regex.Match(name, @"\((\d{3,4}p|\d+k)\)", RegexOptions.IgnoreCase);
        if (qm.Success) quality = qm.Groups[1].Value.ToLowerInvariant();

        var tags = new List<string>();
        foreach (Match marker in Regex.Matches(name, @"\[([^\]]+)\]"))
        {
            var m = marker.Groups[1].Value;
            if (m.Contains("geo", StringComparison.OrdinalIgnoreCase) && !tags.Contains("geo")) tags.Add("geo");
            if (m.Contains("24/7", StringComparison.OrdinalIgnoreCase) && !tags.Contains("not24")) tags.Add("not24");
        }

        // "Prima (1080p)" -> "Prima": kvalita do jména kanálu nepatří
        var clean = Regex.Replace(name, @"\s*\((?:\d{3,4}p|\d+k)\)\s*$", "", RegexOptions.IgnoreCase).Trim();
        clean = Regex.Replace(clean, @"\s*\[[^\]]*\]\s*$", "").Trim();
        // poznámka mohla být za kvalitou ("RTM+ (720p) [Not 24/7]"), takže kvalitu sundáme znovu
        clean = Regex.Replace(clean, @"\s*\(\d{3,4}p\)|\s*\(\d+k\)", "", RegexOptions.IgnoreCase).Trim();
        if (clean.Length == 0) clean = u.Host;
        if (seen.Add(line))
            list.Add(new LiveChannel(clean, group ?? "", logo ?? "", line, id ?? "", ua ?? "", referrer ?? "", quality, tags.ToArray()));
        name = null; logo = null; group = null; id = null; ua = null; referrer = null;
    }
    return list;
}

static string? NilIfEmpty(string v) => string.IsNullOrWhiteSpace(v) ? null : v;

static string M3uAttr(string attrs, string key)
{
    var m = Regex.Match(attrs, key + "=\"([^\"]*)\"", RegexOptions.IgnoreCase);
    return m.Success ? m.Groups[1].Value.Trim() : "";
}

// Playlist přes nás: relativní i absolutní URI přepíšeme na /api/live/hls?url=..., aby prohlížeč
// nikdy nesahal mimo naši doménu (CORS) a aby fungovaly i absolutní CDN adresy uvnitř playlistu.
static string RewritePlaylist(string text, Uri baseUri, string? ua = null, string? referrer = null)
{
    var sb = new StringBuilder(text.Length + 512);
    foreach (var raw in text.Split('\n'))
    {
        var line = raw.TrimEnd('\r');
        var t = line.Trim();
        if (t.Length == 0) { sb.Append('\n'); continue; }
        if (t.StartsWith('#'))
        {
            if (t.Contains("URI=\"", StringComparison.Ordinal))
                line = Regex.Replace(line, "URI=\"([^\"]+)\"", m => "URI=\"" + RelayHlsUrl(m.Groups[1].Value, baseUri, ua, referrer) + "\"");
            sb.Append(line).Append('\n');
            continue;
        }
        sb.Append(RelayHlsUrl(t, baseUri, ua, referrer)).Append('\n');
    }
    return sb.ToString();
}

static string RelayHlsUrl(string raw, Uri baseUri, string? ua = null, string? referrer = null)
{
    if (!Uri.TryCreate(baseUri, raw, out var abs)) return raw;
    if (abs.Scheme != Uri.UriSchemeHttp && abs.Scheme != Uri.UriSchemeHttps) return raw;
    var url = "/api/live/hls?url=" + Uri.EscapeDataString(abs.ToString());
    if (ua != null) url += "&ua=" + Uri.EscapeDataString(ua);
    if (referrer != null) url += "&referrer=" + Uri.EscapeDataString(referrer);
    return url;
}

// Hlavička z playlistu je cizí vstup: bez CR/LF (injection) a s rozumnou délkou.
static string? CleanHeader(string? value)
{
    if (string.IsNullOrWhiteSpace(value)) return null;
    var v = value.Trim();
    if (v.Length == 0 || v.Length > 300) return null;
    if (v.Contains('\r') || v.Contains('\n')) return null;
    return v;
}

// Relay nesmí být cesta do vnitřní sítě (localhost, 10.x, 192.168.x, ...).
static bool IsPrivateHost(string host)
{
    if (host.Equals("localhost", StringComparison.OrdinalIgnoreCase)) return true;
    if (!IPAddress.TryParse(host, out var ip)) return false;
    if (IPAddress.IsLoopback(ip) || ip.IsIPv6LinkLocal || ip.IsIPv6SiteLocal) return true;
    var b = ip.GetAddressBytes();
    if (b.Length != 4) return false;
    return b[0] == 10
        || (b[0] == 172 && b[1] >= 16 && b[1] <= 31)
        || (b[0] == 192 && b[1] == 168)
        || (b[0] == 169 && b[1] == 254)
        || b[0] == 0 || b[0] >= 224;
}

// ------------------------------------------------------------------ /api/search
app.MapGet("/api/search", async (string q, int? page, string? source, string[]? proxy, IHttpClientFactory f, IMemoryCache cache) =>
{
    q = (q ?? "").Trim();
    if (q.Length == 0)
        return Results.BadRequest(new { success = false, error = "Missing search query (q parameter)" });

    // Stránkování výsledků (pro dotahování epizod seriálů). 1 = první stránka, 2+ = další.
    // Strop je z adminu (1-50) - nižší hodnota sníží tlak na prehraj.to, když je 429.
    var st = adminStore.Current;
    var pg = Math.Clamp(page.GetValueOrDefault(1), 1, Math.Clamp(st.Sources.MaxPage, 1, 50));
    var src = NormalizeSource(source);

    // Vypnutý zdroj se neobsluhuje. "Vše najednou" (source=all) se při vypnutém mergi nebo
    // chybějícím zdroji degraduje na jeden zapnutý - jinak by source=all vypnuté zdroje stejně obeslal.
    if (src == "all" && (!st.Flags.MergeSources || st.Sources.Enabled().Length < 3))
        src = st.Sources.Enabled().FirstOrDefault() ?? "prehrajto";
    if (!st.Sources.IsEnabled(src))
        return Results.Json(new
        {
            success = false,
            source = src,
            error = "Zdroj \"" + src + "\" je dočasně vypnutý.",
            enabled = st.Sources.Enabled(),
        }, statusCode: 400);

    // Jen PHP proxy servery, zkoušené postupně - na prehraj.to přímo se nikdy nechodí (datacentrová IP
    // dostane captcha a přímá cesta by přebila výsledky z proxy nulovým počtem).
    var query = $"action=search&q={Uri.EscapeDataString(q)}&source={Uri.EscapeDataString(src)}" + (pg > 1 ? $"&page={pg}" : "")
                + (st.Sources.Fallback ? "" : "&fallback=0");
    var proxies = EffectiveProxies(proxy, proxyPool.Current);
    var sources = OrderedProxies(proxies)
        .Select(p => ProxySource(f, p, query, 30, g => lastGoodProxy = g)).ToArray();

    // Sdílená cache: normalizovaný dotaz (malá písmena, jedny mezery) + sada proxy, ze které se
    // výsledek vzal. Sada je v klíči proto, že prohlížeč posílá ?proxy= u každého dotazu - dřív
    // se kvůli tomu cache pro běžné diváky vůbec nepoužila a každé hledání šlo na prehraj.to.
    // Stejný dotaz teď obslouží všechny uživatele a při 429 se vrátí i starší uložená odpověď.
    var norm = Regex.Replace(q.ToLowerInvariant(), @"\s+", " ");
    var cacheKey = "search:" + src + ":" + CacheScope(proxies) + ":" + norm + (pg > 1 ? ":" + pg : "")
                   + (st.Sources.Fallback ? "" : ":nofb");
    var (ok, body, errors) = norm.Length <= 100
        ? await CachedFetch(cache, cacheKey, "search", SearchTtl, () => PacedFirstWorking(sources))
        : await PacedFirstWorking(sources);
    if (!ok) return AllFailed(errors);
    return Results.Content(body, "application/json");
}).RequireRateLimiting("search");

// ------------------------------------------------------------------ /api/thumb  (jen thumbnaily pro homepage)
// GET /api/thumb?q=Matrix[&t=Titul][&y=1999][&re=regex]
// Výchozí regex je "q*": každé významné slovo z q (a t) musí být v názvu/slugu jako začátek slova
// (pořadí je jedno, bez diakritiky, bez ohledu na velikost). &re= ho přepíše vlastním regexem
// (aplikuje se na název+slug bez diakritiky, malými písmeny). Výsledek se cachuje na serveru.
var Stop = new HashSet<string> { "a","i","z","ze","o","u","v","ve","na","do","se","si","k","s","the","of","and","to","in" };
var Bad = new HashSet<string> { "trailer","teaser","ukazka","upoutavka","recenze","review","soundtrack","ost","making",
                                "gameplay","hra","parodie","reaction","reakce","rozbor","sestrih","clip" };

// Volitelný limit souběžných dotazů na prehraj.to z /api/thumb: "Prehraj:ThumbConcurrency" (Azure: Prehraj__ThumbConcurrency).
// 0 / nenastaveno = bez limitu.
var thumbLimit = app.Configuration.GetValue<int>("Prehraj:ThumbConcurrency");
SemaphoreSlim? thumbGate = thumbLimit > 0 ? new SemaphoreSlim(thumbLimit) : null;

string Norm(string? s)
{
    if (string.IsNullOrEmpty(s)) return "";
    var sb = new StringBuilder();
    foreach (var c in s.Normalize(NormalizationForm.FormD))
        if (CharUnicodeInfo.GetUnicodeCategory(c) != UnicodeCategory.NonSpacingMark) sb.Append(c);
    return Regex.Replace(sb.ToString().ToLowerInvariant(), "[^a-z0-9]+", " ").Trim();
}

string[] Words(string? s)
{
    var w = Norm(s).Split(' ', StringSplitOptions.RemoveEmptyEntries);
    var sig = w.Where(x => !Stop.Contains(x)).ToArray();
    return sig.Length > 0 ? sig : w;
}

string AliasPattern(string? alias)
{
    var w = Words(alias);
    return w.Length == 0 ? "" : "^" + string.Concat(w.Select(x => @"(?=.*\b" + Regex.Escape(x) + ")"));
}

// Keyless alternativa: iTunes Search API (plakáty filmů, bez API klíče). Titul se hledá v CZ obchodě.
async Task<ThumbResult?> ItunesThumb(IHttpClientFactory f, string term, Regex rx, int? y)
{
    var (status, body, error) = await GetAsync(f,
        "https://itunes.apple.com/search?media=movie&entity=movie&country=cz&limit=15&term=" + Uri.EscapeDataString(term), 15);
    if (error != null || !Is2xx(status)) return null;
    try
    {
        using var doc = JsonDocument.Parse(body);
        ThumbResult? best = null;
        var bestScore = 0.6;
        foreach (var it in doc.RootElement.GetProperty("results").EnumerateArray())
        {
            var name = it.TryGetProperty("trackName", out var nEl) ? nEl.GetString() ?? "" : "";
            var art = it.TryGetProperty("artworkUrl100", out var aEl) ? aEl.GetString() ?? "" : "";
            if (name.Length == 0 || art.Length == 0) continue;

            bool ok;
            try { ok = rx.IsMatch(Norm(name)); } catch (RegexMatchTimeoutException) { ok = false; }
            if (!ok) continue;

            var sc = 1.0;
            var rel = it.TryGetProperty("releaseDate", out var rEl) ? rEl.GetString() ?? "" : "";
            if (y is int yy && rel.StartsWith(yy.ToString())) sc += 0.5;
            if (sc > bestScore)
            {
                var view = it.TryGetProperty("trackViewUrl", out var vEl) ? vEl.GetString() ?? "" : "";
                best = new ThumbResult(art.Replace("100x100bb", "600x600bb"), name, view);
                bestScore = sc;
            }
        }
        return best;
    }
    catch (Exception) { return null; }
}

app.MapGet("/api/thumb", async (string? q, string? t, int? y, string? re, string? src, string[]? proxy, IHttpClientFactory f, IMemoryCache cache, CsfdClient csfd, HttpContext ctx) =>
{
    q = (q ?? "").Replace("*", " ").Trim();
    t = (t ?? "").Replace("*", " ").Trim();
    re = (re ?? "").Trim();
    src = src switch { "itunes" => "itunes", "csfd" => "csfd", _ => "prehraj" };
    if (q.Length == 0)
        return Results.BadRequest(new { success = false, error = "Missing q parameter", usage = "/api/thumb?q=Matrix&y=1999" });

    if (src == "itunes" && !adminStore.Current.Flags.ItunesThumb)
        return Results.Json(new { success = false, error = "Náhledy z iTunes jsou dočasně vypnuté." }, statusCode: 403);

    // Plakát z ČSFD (volitelná integrace node-csfd-api). Na rozdíl od prehraj.to/iTunes ho
    // netaháme přes PHP proxy - ČSFD není geoblokované a odpověď je pár set kB.
    if (src == "csfd")
    {
        if (!csfd.Enabled)
            return Results.Json(new { success = false, error = "ČSFD metadata nejsou nastavená (Csfd:BaseUrl)." });
        var info = await csfd.LookupAsync(t.Length > 0 ? t : q, y, ctx.RequestAborted);
        if (info == null || info.Poster.Length == 0)
            return Results.Json(new { success = false, error = "Na ČSFD se nic nenašlo." });
        ctx.Response.Headers.CacheControl = "public, max-age=86400";
        return Results.Json(new { success = true, q, thumbnail = info.Poster, title = info.Title, url = info.Url });
    }

    var eff = EffectiveProxies(proxy, proxyPool.Current);
    var qs = $"action=thumb&q={Uri.EscapeDataString(q)}&t={Uri.EscapeDataString(t)}&re={Uri.EscapeDataString(re)}&src={src}"
             + (y is int py ? $"&y={py}" : "");

    Regex rx;
    try
    {
        var pattern = re.Length > 0
            ? re
            : string.Join("|", new[] { AliasPattern(q), AliasPattern(t) }.Where(p => p.Length > 0));
        if (pattern.Length == 0 || pattern.Length > 300)
            return Results.BadRequest(new { success = false, error = "Invalid or too long pattern" });
        rx = new Regex(pattern, Ci, TimeSpan.FromMilliseconds(250));
    }
    catch (ArgumentException ex)
    {
        return Results.BadRequest(new { success = false, error = "Invalid regex: " + ex.Message });
    }

    // Sada proxy je v klíči ze stejného důvodu jako u hledání: prohlížeč posílá ?proxy=
    // u každého dotazu. Náhledy se navíc musí cachovat i když je vrátí PHP proxy - dřív se
    // ukládaly jen ty z iTunes, takže každý nový divák (a každý restart) znovu poslal na
    // prehraj.to desítky hledání za náhledy a vyčerpal tím kvótu, kterou pak nemělo hledání.
    var key = $"thumb|{CacheScope(eff)}|{src}|{Norm(q)}|{Norm(t)}|{y}|{re}";

    // Postupně PHP proxy servery, pak vlastní pohled iTunes (na prehraj.to přímo se nechodí). Kdo vrátí 2xx
    // s normální odpovědí, ten vyhrává; chyba (429 atd.) nebo {"success":false} = prohra
    // a bere se další zdroj. Stejný náhled pro víc diváků najednou se stahuje jen jednou
    // (single-flight v CachedFetch).
    var sources = OrderedProxies(eff).Select(p => ProxySource(f, p, qs, 40, g => lastGoodProxy = g)).ToList();
    sources.Add(async ct =>
    {
        // Nikdy přímo na prehraj.to - jen přes PHP proxy servery; tahle cesta zůstává jen pro iTunes.
        ThumbResult? r2 = null;
        if (src == "itunes") r2 = await ItunesThumb(f, t.Length > 0 ? t : q, rx, y);
        if (r2 is null) return (0, "", "direct fetch disabled - use PHP proxies");
        var json = JsonSerializer.Serialize(new { success = true, q, thumbnail = r2.Thumbnail, title = r2.Title, url = r2.Url });
        return (200, json, (string?)null);
    });

    var (won, body, errors) = await CachedFetch(cache, key, "thumb", ThumbTtl, () => FirstWorking(sources.ToArray()));
    if (!won) return AllFailed(errors);

    var thumb = "";
    try
    {
        using var d = JsonDocument.Parse(body);
        if (d.RootElement.TryGetProperty("thumbnail", out var th)) thumb = th.GetString() ?? "";
    }
    catch (JsonException) { }
    ctx.Response.Headers.CacheControl = thumb.Length > 0 ? "public, max-age=86400" : "public, max-age=600";
    return Results.Content(body, "application/json");
}).RequireRateLimiting("thumb");

// ------------------------------------------------------------------ /api/meta  (metadata titulu)
// GET /api/meta?q=Matrix&y=1999 - hodnocení, žánry, plakát a odkaz na ČSFD pro detail
// přehrávaného titulu. Zdroj je volitelná služba node-csfd-api (MIT, Docker image
// bartholomej/node-csfd-api, Csfd:BaseUrl); bez ní endpoint vrátí configured:false
// a UI metadata prostě neukáže. ČSFD nemá veřejné API, takže se scraping odehrává
// v té jedné službě, ne tady - appka jen čte její JSON.
app.MapGet("/api/meta", async (string? q, string? t, int? y, CsfdClient csfd, HttpContext ctx) =>
{
    var query = (t ?? q ?? "").Replace("*", " ").Trim();
    if (query.Length < 2)
        return Results.BadRequest(new { success = false, error = "Missing q parameter", usage = "/api/meta?q=Matrix&y=1999" });

    if (!csfd.Enabled)
        return Results.Json(new { success = false, configured = false, error = "Metadata z ČSFD nejsou nastavená (Csfd:BaseUrl)." });

    var info = await csfd.LookupAsync(query, y, ctx.RequestAborted);
    if (info == null)
        return Results.Json(new { success = false, configured = true, error = "Na ČSFD se nic nenašlo." });

    ctx.Response.Headers.CacheControl = "public, max-age=86400";
    return Results.Json(new { success = true, configured = true, source = "csfd", info });
}).RequireRateLimiting("thumb");

// ------------------------------------------------------------------ /api/catalog  (filmy pro homepage)
// GET /api/catalog[&lang=cz|en] - seznam filmů s plakáty z keyless iTunes RSS:
//   cz (výchozí) -> https://itunes.apple.com/cz/rss/topmovies/limit=50/json
//   en           -> https://itunes.apple.com/us/rss/topmovies/limit=50/json
// Žádný klíč, žádný účet, žádná platba. Server drží výsledek 1 den v cache, takže se
// iTunes dotkne jednou za den za všechny uživatele. Když feed nejde stáhnout, vrátí se
// chyba a frontend použije vlastní záložní seznam.
var CatalogGenres = new Dictionary<string, string[]>(StringComparer.OrdinalIgnoreCase)
{
    ["Action & Adventure"] = new[] { "Akční" },
    ["Sci-Fi & Fantasy"] = new[] { "Sci-fi", "Fantasy" },
    ["Kids & Family"] = new[] { "Rodinné" },
    ["Comedy"] = new[] { "Komedie" },
    ["Thriller"] = new[] { "Thriller" },
    ["Horror"] = new[] { "Horror" },
    ["Drama"] = new[] { "Drama" },
    ["Romance"] = new[] { "Drama" },
};

app.MapGet("/api/catalog", async (string? lang, IHttpClientFactory f, IMemoryCache cache) =>
{
    lang = lang == "en" ? "en" : "cz";
    var key = "catalog|" + lang;
    if (cache.TryGetValue<List<CatalogItem>>(key, out var cached) && cached is { Count: > 0 })
        return Results.Json(new { success = true, lang, count = cached.Count, items = cached });

    var feed = $"https://itunes.apple.com/{(lang == "en" ? "us" : "cz")}/rss/topmovies/limit=50/json";
    var (status, body, error) = await GetAsync(f, feed, 20);
    if (error != null || !Is2xx(status) || string.IsNullOrEmpty(body))
        return Results.Json(new { success = false, error = "iTunes feed nedostupný: " + (error ?? "HTTP " + status) });

    try
    {
        using var doc = JsonDocument.Parse(body);
        var items = new List<CatalogItem>();
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var e in doc.RootElement.GetProperty("feed").GetProperty("entry").EnumerateArray())
        {
            if (!e.TryGetProperty("im:name", out var nEl) || !nEl.TryGetProperty("label", out var nl)) continue;
            var title = nl.GetString() ?? "";
            if (title.Length == 0 || !seen.Add(title)) continue;

            // největší plakát z feedu, přeškálovaný na 600x900 (mzstatic umí libovolnou velikost)
            var img = "";
            if (e.TryGetProperty("im:image", out var imgs) && imgs.ValueKind == JsonValueKind.Array)
                foreach (var im in imgs.EnumerateArray())
                    if (im.TryGetProperty("label", out var l) && l.GetString() is { Length: > 0 } u) img = u;
            img = Regex.Replace(img, @"/\d+x\d+bb\.(?:png|jpe?g|webp)$", "/600x900bb.jpg", RegexOptions.IgnoreCase);

            var year = "";
            var ym = Regex.Match(title, @"\(\d{4}\)$");
            if (ym.Success) year = ym.Value.Trim('(', ')');
            else if (e.TryGetProperty("im:releaseDate", out var rd)
                     && rd.TryGetProperty("label", out var rl)
                     && rl.GetString() is { Length: >= 4 } rs) year = rs[..4];

            var q = Regex.Replace(title, @"\s*\(\d{4}\)\s*$", "").Trim();

            var g = Array.Empty<string>();
            if (e.TryGetProperty("category", out var cat)
                && cat.TryGetProperty("attributes", out var attrs)
                && attrs.TryGetProperty("label", out var gl)
                && gl.GetString() is string gls
                && CatalogGenres.TryGetValue(gls, out var mapped)) g = mapped;

            items.Add(new CatalogItem(title, year, img, q, g));
        }

        if (items.Count == 0)
            return Results.Json(new { success = false, error = "Prázdný iTunes feed" });

        cache.Set(key, items, TimeSpan.FromDays(1));
        WflixCache.Track(key, "catalog");
        return Results.Json(new { success = true, lang, count = items.Count, items });
    }
    catch (Exception ex)
    {
        return Results.Json(new { success = false, error = "iTunes feed parse error: " + ex.Message });
    }
}).RequireRateLimiting("api");

// ------------------------------------------------------------------ /api/live  (IPTV kanály)
// Playlist tahá server, ne prohlížeč: seznamy mají desítky kB a část z nich neposílá CORS hlavičky.
// Do UI jde jen jméno, skupina, logo a URL streamu. Zdroj:
//   ?country=cz   -> https://iptv-org.github.io/iptv/countries/cz.m3u (když selže, streams/cz.m3u)
//   ?lang=ces     -> https://iptv-org.github.io/iptv/languages/ces.m3u
//   ?custom=<i>   -> "Prehraj:LivePlaylists" z konfigurace
app.MapGet("/api/live", async (string? country, string? lang, int? custom, IHttpClientFactory f, IMemoryCache cache) =>
{
    if (!adminStore.Current.Flags.Live)
        return Results.Json(new { success = false, error = "Živé vysílání je dočasně vypnuté." }, statusCode: 503);

    string url;
    string? countryCode = null;
    if (custom is int idx && idx >= 0 && idx < liveCustom.Length && IsValidProxyUrl(liveCustom[idx]))
        url = liveCustom[idx];
    else if (!string.IsNullOrWhiteSpace(lang) && Regex.IsMatch(lang.Trim(), "^[a-zA-Z]{2,3}$"))
        url = $"https://iptv-org.github.io/iptv/languages/{lang.Trim().ToLowerInvariant()}.m3u";
    else
    {
        var cc = (country ?? "cz").Trim().ToLowerInvariant();
        if (!Regex.IsMatch(cc, "^[a-z]{2}$")) cc = "cz";
        countryCode = cc;
        // Sestavený seznam má navíc tvg-logo a group-title (raw streams/xx.m3u je nemá), takže
        // dlaždice vypadají jako dlaždice. Když sestavený seznam selže, zkusí se raw varianta.
        url = $"https://iptv-org.github.io/iptv/countries/{cc}.m3u";
    }

    var key = "live|" + url;
    if (cache.TryGetValue<List<LiveChannel>>(key, out var cached) && cached is { Count: > 0 })
        return Results.Json(new { success = true, source = url, count = cached.Count, channels = cached });

    var (status, body, error) = await GetAsync(f, url, 25);
    if ((error != null || !Is2xx(status) || body.Length == 0) && url.Contains("/countries/", StringComparison.Ordinal))
    {
        var cc = Regex.Match(url, @"/countries/([a-z]{2})\.m3u").Groups[1].Value;
        url = $"https://raw.githubusercontent.com/iptv-org/iptv/master/streams/{cc}.m3u";
        (status, body, error) = await GetAsync(f, url, 25);
    }
    if (error != null || !Is2xx(status) || body.Length == 0)
        return Results.Json(new { success = false, error = "Playlist nedostupná: " + (error ?? "HTTP " + status) });

    var channels = ParseM3u(body);
    if (channels.Count == 0)
        return Results.Json(new { success = false, error = "Playlist neobsahuje žádné kanály" });

    // Playlisty nemají logo vždy. Kde chybí, doplní se odkaz na datovou sadu
    // tv-logo/tv-logos podle tvg-id ("CT1.cz@SD" -> czech-republic/ct1-cz.png).
    // Je to odhad: když soubor neexistuje, prohlížeč obrázek zahodí a dlaždice zůstane
    // s iniciálami, takže se tím nic nerozbije.
    channels = channels
        .Select(ch => string.IsNullOrWhiteSpace(ch.Logo) && TvLogos.Fallback(ch.Id, countryCode) is { Length: > 0 } logo
            ? ch with { Logo = logo }
            : ch)
        .ToList();

    cache.Set(key, channels, TimeSpan.FromMinutes(30));
    WflixCache.Track(key, "live");
    return Results.Json(new { success = true, source = url, count = channels.Count, channels });
}).RequireRateLimiting("api");

// ------------------------------------------------------------------ /api/live/countries  (výběr zdroje)
// Seznam zemí z iptv-org pro položku "Ostatní" ve výběru zdroje. Vrací jen dvoupísmenné kódy
// zemí, pro které iptv-org opravdu má playlist (viz níž). Doporučené země vyřazuje klient.
app.MapGet("/api/live/countries", async (IHttpClientFactory f, IMemoryCache cache) =>
{
    if (!adminStore.Current.Flags.Live)
        return Results.Json(new { success = false, error = "Živé vysílání je dočasně vypnuté." }, statusCode: 503);

    const string lcKey = "live-countries";
    if (cache.TryGetValue<List<LiveCountry>>(lcKey, out var lcCached) && lcCached is { Count: > 0 })
        return Results.Json(new { success = true, countries = lcCached });

    var (lcStatus, lcBody, lcError) = await GetAsync(f, "https://iptv-org.github.io/api/countries.json", 25);
    if (lcError != null || !Is2xx(lcStatus) || lcBody.Length == 0)
        return Results.Json(new { success = false, error = "Seznam zemí nedostupný: " + (lcError ?? "HTTP " + lcStatus) });

    var lcList = new List<LiveCountry>();
    try
    {
        using var lcDoc = JsonDocument.Parse(lcBody);
        if (lcDoc.RootElement.ValueKind == JsonValueKind.Array)
        {
            foreach (var lcEl in lcDoc.RootElement.EnumerateArray())
            {
                if (lcEl.ValueKind != JsonValueKind.Object) continue;
                string? lcCode = lcEl.TryGetProperty("code", out var lcCodeEl) && lcCodeEl.ValueKind == JsonValueKind.String
                    ? lcCodeEl.GetString() : null;
                string? lcName = lcEl.TryGetProperty("name", out var lcNameEl) && lcNameEl.ValueKind == JsonValueKind.String
                    ? lcNameEl.GetString() : null;
                if (lcCode != null && Regex.IsMatch(lcCode, "^[A-Za-z]{2}$") && !string.IsNullOrWhiteSpace(lcName))
                    lcList.Add(new LiveCountry(lcCode.ToLowerInvariant(), lcName.Trim()));
            }
        }
    }
    catch (JsonException) { }

    if (lcList.Count == 0)
        return Results.Json(new { success = false, error = "Seznam zemí je prázdný" });

    // countries.json je kompletní seznam (250 zemí), ale playlist má jen ~200 z nich. Které, říká
    // adresář streams/ v repu iptv-org (cz.m3u, sk.m3u, ...): berou se jen dvoupísmenné soubory,
    // takže at_pluto.m3u a spol. ne. Názvy zemí zůstávají z countries.json. Když výpis selže nebo
    // vypadá podezřele (rate limit GitHub API, změna struktury repa), vrátí se celý seznam
    // a za 10 minut se to zkusí znovu.
    var lcTtl = TimeSpan.FromHours(24);
    var (lsStatus, lsBody, lsError) = await GetAsync(f,
        "https://api.github.com/repos/iptv-org/iptv/contents/streams", 25,
        lsReq => { lsReq.Headers.Accept.Clear(); lsReq.Headers.Accept.ParseAdd("application/vnd.github+json"); });
    var lcWithStreams = new HashSet<string>();
    if (lsError == null && Is2xx(lsStatus))
    {
        try
        {
            using var lsDoc = JsonDocument.Parse(lsBody);
            if (lsDoc.RootElement.ValueKind == JsonValueKind.Array)
            {
                foreach (var lsEl in lsDoc.RootElement.EnumerateArray())
                {
                    if (lsEl.ValueKind != JsonValueKind.Object) continue;
                    var lsName = lsEl.TryGetProperty("name", out var lsNameEl) && lsNameEl.ValueKind == JsonValueKind.String
                        ? lsNameEl.GetString() : null;
                    var lsM = lsName == null ? null : Regex.Match(lsName, "^([a-z]{2})\\.m3u$");
                    if (lsM is { Success: true }) lcWithStreams.Add(lsM.Groups[1].Value);
                }
            }
        }
        catch (JsonException) { }
    }
    if (lcWithStreams.Count >= 20)
        lcList = lcList.Where(x => lcWithStreams.Contains(x.Code)).ToList();
    else
        lcTtl = TimeSpan.FromMinutes(10);

    cache.Set(lcKey, lcList, lcTtl);
    WflixCache.Track(lcKey, "live");
    return Results.Json(new { success = true, countries = lcList });
}).RequireRateLimiting("api");

// ------------------------------------------------------------------ /api/live/hls  (relay playlistu)
// HLS v prohlížeči potřebuje CORS na playlistu i na každém segmentu. Řada IPTV zdrojů ho nemá,
// takže UI zkouší napřed přímé přehrávání (funguje i pro geoblokované kanály, protože jde z IP
// diváka) a tenhle relay je záložní cesta. Playlist se přepisuje tak, aby další playlisty,
// segmenty i klíče šly zase přes nás.
app.MapGet("/api/live/hls", async (string url, string? ua, string? referrer, IHttpClientFactory f, HttpContext ctx) =>
{
    var liveFlags = adminStore.Current.Flags;
    if (!liveFlags.Live || !liveFlags.LiveRelay)
        return Results.Json(new { success = false, error = "Relay živého vysílání je dočasně vypnutý." }, statusCode: 503);

    if (!Uri.TryCreate(url, UriKind.Absolute, out var target)
        || (target.Scheme != Uri.UriSchemeHttp && target.Scheme != Uri.UriSchemeHttps)
        || IsPrivateHost(target.Host))
        return Results.Json(new { success = false, error = "Neplatná URL" }, statusCode: 400);

    var client = f.CreateClient("prehraj-stream");
    var uaClean = CleanHeader(ua);
    var referrerClean = CleanHeader(referrer);

    using var req = new HttpRequestMessage(HttpMethod.Get, target);
    req.Headers.TryAddWithoutValidation("Accept", "*/*");
    // Některé kanály pustí jen konkrétní prohlížeč nebo s Refererem - to jsou právě ty
    // #EXTVLCOPT:http-user-agent / http-referrer řádky v playlistu. Prohlížeč tyhle hlavičky
    // nastavit neumí, takže takový kanál jde vždycky přes relay.
    if (uaClean != null)
    {
        req.Headers.Remove("User-Agent");
        req.Headers.TryAddWithoutValidation("User-Agent", uaClean);
    }
    if (referrerClean != null) req.Headers.TryAddWithoutValidation("Referer", referrerClean);
    var range = ctx.Request.Headers.Range.ToString();
    if (range.Length > 0) req.Headers.TryAddWithoutValidation("Range", range);

    HttpResponseMessage res;
    try
    {
        using var hcts = CancellationTokenSource.CreateLinkedTokenSource(ctx.RequestAborted);
        hcts.CancelAfter(TimeSpan.FromSeconds(20));
        res = await client.SendAsync(req, HttpCompletionOption.ResponseHeadersRead, hcts.Token);
    }
    catch (Exception ex)
    {
        return Results.Json(new { success = false, error = "Zdroj neodpovídá: " + ex.Message }, statusCode: 502);
    }

    using (res)
    {
        var mediaType = res.Content.Headers.ContentType?.MediaType ?? "";
        var looksPlaylist = mediaType.Contains("mpegurl", StringComparison.OrdinalIgnoreCase)
            || target.AbsolutePath.EndsWith(".m3u8", StringComparison.OrdinalIgnoreCase)
            || target.AbsolutePath.EndsWith(".m3u", StringComparison.OrdinalIgnoreCase);

        if (looksPlaylist)
        {
            var text = await res.Content.ReadAsStringAsync(ctx.RequestAborted);
            if (!text.TrimStart().StartsWith("#EXTM3U", StringComparison.OrdinalIgnoreCase))
                return Results.Json(new { success = false, error = "Zdroj nevrátil playlist" }, statusCode: 502);
            ctx.Response.Headers.CacheControl = "no-store";
            return Results.Text(RewritePlaylist(text, target, uaClean, referrerClean), "application/vnd.apple.mpegurl");
        }

        ctx.Response.StatusCode = (int)res.StatusCode;
        foreach (var h in new[] { "Content-Type", "Content-Length", "Content-Range", "Accept-Ranges" })
        {
            if (res.Content.Headers.TryGetValues(h, out var cv)) { ctx.Response.Headers[h] = cv.ToArray(); continue; }
            if (res.Headers.TryGetValues(h, out var hv)) ctx.Response.Headers[h] = hv.ToArray();
        }
        ctx.Response.Headers.CacheControl = "no-store";
        await using var src = await res.Content.ReadAsStreamAsync(ctx.RequestAborted);
        // Segmenty a klíče tečou po blocích s hlídačem nečinnosti - žádné načítání celého
        // souboru do paměti a žádné visící spojení, když zdroj přestane odpovídat.
        await CopyWithIdleTimeout(src, ctx.Response.Body, ctx.RequestAborted);
        return Results.Empty;
    }
}).RequireRateLimiting("live");

// ------------------------------------------------------------------ /api/live/epg  (co běží teď)
// Programový průvodce pro dlaždice Živě. XMLTV se stahuje a parsuje na serveru a drží
// v paměti; do prohlížeče jde jen "teď" a "následuje" pro každý kanál, takže klient
// netahá megabajty XML. Kanály se párují podle tvg-id (bez varianty @SD/@HD) a když to
// nesedí, podle normalizovaného názvu. Zdroj: Epg:Urls, např. výstup iptv-org/epg
// nebo hotový guide pro CZ/SK (epgshare01). Bez nastavení vrátí configured:false.
app.MapGet("/api/live/epg", async (EpgService epg, CancellationToken ct) =>
{
    if (!adminStore.Current.Flags.Live)
        return Results.Json(new { success = false, error = "Živé vysílání je dočasně vypnuté." }, statusCode: 503);

    if (!epg.Enabled)
        return Results.Json(new { success = false, configured = false, error = "EPG není nastavené (Epg:Urls)." });

    var snapshot = await epg.GetAsync(ct);
    if (snapshot == null)
        return Results.Json(new { success = false, configured = true, error = "Průvodce se nepodařilo načíst." });

    var at = DateTimeOffset.UtcNow;
    var entries = EpgService.Entries(snapshot, at);
    return Results.Json(new
    {
        success = true,
        configured = true,
        updated = snapshot.Loaded,
        now = at,
        count = entries.Count,
        channels = entries,
    });
}).RequireRateLimiting("api");

// ------------------------------------------------------------------ /api/subtitles  (VTT relay)
// <track> musí mít VTT z naší domény (CDN nemusí posílat CORS) a podepsaný odkaz
// z prehraj.to po chvíli vyprší. Titulky proto stahuje server - jsou malé, takže
// na rozdíl od videa relay nestojí za řeč. URL bere z "subtitles", které vrací PHP proxy.
app.MapGet("/api/subtitles", async (string url, IHttpClientFactory f, HttpContext ctx) =>
{
    if (!Uri.TryCreate(url, UriKind.Absolute, out var target)
        || (target.Scheme != Uri.UriSchemeHttp && target.Scheme != Uri.UriSchemeHttps)
        || IsPrivateHost(target.Host)
        || !target.AbsolutePath.EndsWith(".vtt", StringComparison.OrdinalIgnoreCase))
        return Results.Json(new { success = false, error = "Neplatná URL titulků" }, statusCode: 400);

    var client = f.CreateClient("prehraj");
    using var req = new HttpRequestMessage(HttpMethod.Get, target);
    req.Headers.Referrer = new Uri("https://prehraj.to/");
    req.Headers.Accept.Clear();
    req.Headers.Accept.ParseAdd("text/vtt,text/plain;q=0.9,*/*;q=0.5");

    HttpResponseMessage res;
    try
    {
        using var hcts = CancellationTokenSource.CreateLinkedTokenSource(ctx.RequestAborted);
        hcts.CancelAfter(TimeSpan.FromSeconds(20));
        res = await client.SendAsync(req, HttpCompletionOption.ResponseHeadersRead, hcts.Token);
    }
    catch (Exception ex)
    {
        return Results.Json(new { success = false, error = "Titulky nejdou načíst: " + ex.Message }, statusCode: 502);
    }

    using (res)
    {
        if (!res.IsSuccessStatusCode)
            return Results.Json(new { success = false, error = $"CDN vrátila HTTP {(int)res.StatusCode}" }, statusCode: 502);
        if (res.Content.Headers.ContentLength is > 1_000_000)
            return Results.Json(new { success = false, error = "Titulky jsou příliš velké" }, statusCode: 413);

        string vtt;
        try
        {
            using var rcts = CancellationTokenSource.CreateLinkedTokenSource(ctx.RequestAborted);
            rcts.CancelAfter(TimeSpan.FromSeconds(20));
            await using var src = await res.Content.ReadAsStreamAsync(rcts.Token);
            using var ms = new MemoryStream();
            var buf = new byte[16384];
            while (true)
            {
                var n = await src.ReadAsync(buf.AsMemory(0, buf.Length), rcts.Token);
                if (n <= 0) break;
                if (ms.Length + n > 1_000_000)
                    return Results.Json(new { success = false, error = "Titulky jsou příliš velké" }, statusCode: 413);
                ms.Write(buf, 0, n);
            }
            vtt = Encoding.UTF8.GetString(ms.GetBuffer(), 0, (int)ms.Length);
        }
        catch (Exception ex)
        {
            return Results.Json(new { success = false, error = "Titulky nejdou načíst: " + ex.Message }, statusCode: 502);
        }

        vtt = vtt.TrimStart('\uFEFF').TrimStart();
        if (!vtt.StartsWith("WEBVTT", StringComparison.OrdinalIgnoreCase))
            return Results.Json(new { success = false, error = "Zdroj nevrátil WebVTT titulky" }, statusCode: 502);

        // Token v URL se mění, takže cache je vázaná na konkrétní odkaz; titulky jsou neměnné.
        ctx.Response.Headers.CacheControl = "private, max-age=1800";
        return Results.Text(vtt, "text/vtt; charset=utf-8");
    }
}).RequireRateLimiting("subs");

// ------------------------------------------------------------------ /api/proxy  (extract video URL)
app.MapGet("/api/proxy", async (string url, string? source, string[]? proxy, IHttpClientFactory f) =>
{
    if (string.IsNullOrEmpty(url))
        return Results.BadRequest(new { success = false, error = "Missing url parameter" });
    var src = NormalizeSource(source);
    if (Uri.TryCreate(url, UriKind.Absolute, out var u))
    {
        if (IsAllowedHost(u.Host, "bombuj.si")) src = "bombuj";
        else if (IsAllowedHost(u.Host, "sledujteto.cz")) src = "sledujteto";
        else if (IsAllowedHost(u.Host, "prehraj.to")) src = "prehrajto";
    }
    // Vypnutý zdroj se neobsluhuje ani tady - jinak by se dal obejít /api/search a přehrávat dál.
    if (src == "all") src = adminStore.Current.Sources.Enabled().FirstOrDefault() ?? "prehrajto";
    if (!adminStore.Current.Sources.IsEnabled(src))
        return Results.Json(new
        {
            success = false,
            source = src,
            error = "Zdroj \"" + src + "\" je dočasně vypnutý.",
            enabled = adminStore.Current.Sources.Enabled(),
        }, statusCode: 400);
    if (!IsAllowedSourcePageUrl(url))
        return Results.BadRequest(new { success = false, error = "URL must be from a supported source (prehraj.to, bombuj.si, sledujteto.cz)" });

    // Jen PHP proxy servery, zkoušené postupně. 2xx s normální odpovědí = vyhrává;
    // 429/403/5xx nebo {"success":false} = prohra a bere se další zdroj.
    var query = $"url={Uri.EscapeDataString(url)}&source={Uri.EscapeDataString(src)}";
    var sources = OrderedProxies(EffectiveProxies(proxy, proxyPool.Current))
        .Select(p => ProxySource(f, p, query, 30, g => lastGoodProxy = g)).ToArray();


    var (ok, body, errors) = await FirstWorking(sources);
    if (!ok)
        return Results.Json(new
        {
            success = false,
            error = "Všechny zdroje selhaly: " + string.Join(" | ", errors),
            hint = "Page might require JavaScript or different parsing"
        });
    return Results.Content(body, "application/json");
}).RequireRateLimiting("api");

// ------------------------------------------------------------------ /api/stream  (relay videa + stahování)
// GET /api/stream?url={prehraj.to stránka}[&download=1&name=Titul]
// Server si sám vezme čerstvý odkaz z CDN a video přeposílá (včetně Range, takže funguje seeking).
// Proč: podepsaný CDN odkaz po pár minutách vyprší, prehrávač si pak nemůže dotáhnout další část a
// video se zasekne. Tady se při chybě CDN / utrženém spojení odkaz obnoví a přenos naváže přesně
// tam, kde skončil - prohlížeč nic nepozná. S &download=1 se posílá jako příloha (stažení).
static string NormCdn(string u) => WebUtility.HtmlDecode(u.Replace("\\/", "/")).Replace("\\u0026", "&");
static string CdnKey(string u) =>
    Uri.TryCreate(u, UriKind.Absolute, out var x) ? (x.Host + x.AbsolutePath).ToLowerInvariant() : u.ToLowerInvariant();

// hint = CDN odkaz, který klient právě přehrává (&v=). Přímo ho používáme jen pro premiumcdn.net
// (jinak by šlo přes server stahovat cokoli); jinak slouží jen k nalezení správného souboru na stránce.
async Task<string?> ResolveCdnUrl(IHttpClientFactory f, IMemoryCache cache, string page, bool fresh, string? hint, CancellationToken ct = default)
{
    var key = "cdn|" + page + "|" + (hint == null ? "" : CdnKey(hint));
    if (!fresh)
    {
        if (cache.TryGetValue(key, out string? hit) && !string.IsNullOrEmpty(hit)) return hit;
        if (hint != null && Uri.TryCreate(hint, UriKind.Absolute, out var hu)
            && (hu.Scheme == Uri.UriSchemeHttp || hu.Scheme == Uri.UriSchemeHttps)
            && (hu.Host.Equals("premiumcdn.net", StringComparison.OrdinalIgnoreCase)
                || hu.Host.EndsWith(".premiumcdn.net", StringComparison.OrdinalIgnoreCase)))
            return hint;
    }

    string? found = null;
    // Nikdy přímo na prehraj.to - stránka videa chodí jen přes PHP proxy servery, jeden po druhém
    // (naposledy funkční první).
    foreach (var p in OrderedProxies(proxyPool.Current))
    {
            if (ct.IsCancellationRequested) return null;
            var sep = p.Contains('?') ? "&" : "?";
            var (ps, pb, pe) = await GetAsync(f, p + sep + "url=" + Uri.EscapeDataString(page), 30, null, ct);
            if (pe != null || !Is2xx(ps) || !IsGoodBody(pb)) continue;   // 429/403/5xx nebo chybové JSON = další proxy
            try
            {
                using var d = JsonDocument.Parse(pb);
                if (hint != null && d.RootElement.TryGetProperty("allUrls", out var all) && all.ValueKind == JsonValueKind.Array)
                {
                    var m = all.EnumerateArray().Select(x => x.GetString()).Where(x => !string.IsNullOrEmpty(x))
                        .Select(x => NormCdn(x!)).FirstOrDefault(x => CdnKey(x) == CdnKey(hint));
                    if (m != null) { found = m; break; }
                }
                if (d.RootElement.TryGetProperty("videoUrl", out var v) && v.GetString() is { Length: > 0 } u) { found = u; break; }
            }
            catch (JsonException) { }
        }
    if (found == null) return null;

    found = WebUtility.HtmlDecode(found).Replace("\\u0026", "&");
    cache.Set(key, found, TimeSpan.FromSeconds(90));
    WflixCache.Track(key, "cdn");
    return found;
}

app.MapGet("/api/stream", async (string url, string? name, string? download, string? v, IHttpClientFactory f, IMemoryCache cache, HttpContext ctx) =>
{
    if (!IsPrehrajUrl(url))
        return Results.Json(new { success = false, error = "URL must be from prehraj.to" }, statusCode: 400);

    // Admin kill switch: stahování počítá přenesená data (na Azure free tier to je reálná položka),
    // přehrávání přes server funguje dál.
    if (download is "1" or "true" && !adminStore.Current.Flags.Downloads)
        return Results.Json(new { success = false, error = "Stahování je dočasně vypnuté." }, statusCode: 403);

    var ct = ctx.RequestAborted;
    var client = f.CreateClient("prehraj-stream");

    // Range od prohlížeče: bytes=a-b | bytes=a- | bytes=-n
    long reqStart = 0; long? reqEnd = null; long? suffixLen = null; var hasRange = false;
    var rm = Regex.Match(ctx.Request.Headers.Range.ToString().Trim(), @"^bytes=(\d*)-(\d*)$");
    if (rm.Success)
    {
        if (rm.Groups[1].Value.Length == 0 && rm.Groups[2].Value.Length > 0) suffixLen = long.Parse(rm.Groups[2].Value);
        else if (rm.Groups[1].Value.Length > 0)
        {
            hasRange = true;
            reqStart = long.Parse(rm.Groups[1].Value);
            if (rm.Groups[2].Value.Length > 0) reqEnd = long.Parse(rm.Groups[2].Value);
        }
    }

    long sent = 0; long? total = null; var started = false; var fresh = false; var lastStatus = 0;
    // Půjčený buffer: 80 kB na požadavek by jinak bylo při víc souběžných filmech zbytečně
    // mnoho alokací pro GC (a na sdíleném hostingu je paměť vzácná).
    var buf = ArrayPool<byte>.Shared.Rent(81920);
    try
    {
        for (var attempt = 0; attempt < 6 && !ct.IsCancellationRequested; attempt++)
    {
        var cdn = await ResolveCdnUrl(f, cache, url, fresh, string.IsNullOrWhiteSpace(v) ? null : v, ct);
        fresh = false;
        if (cdn == null)
        {
            if (!started) return Results.Json(new { success = false, error = "Video URL not found in page" }, statusCode: 404);
            break;
        }
        if (cdn.Contains(".m3u8", StringComparison.OrdinalIgnoreCase))
        {
            if (!started) return Results.Json(new { success = false, error = "HLS (m3u8) stream nejde přeposílat" }, statusCode: 501);
            break;
        }

        var offset = reqStart + sent;
        if (reqEnd != null && offset > reqEnd) break;
        string? range = null;
        if (suffixLen != null && !started) range = $"bytes=-{suffixLen}";
        else if (hasRange || sent > 0) range = $"bytes={offset}-{(reqEnd?.ToString() ?? "")}";

        using var req = new HttpRequestMessage(HttpMethod.Get, cdn);
        req.Headers.Referrer = new Uri("https://prehraj.to/");
        req.Headers.Accept.ParseAdd("*/*");
        if (range != null) req.Headers.TryAddWithoutValidation("Range", range);

        HttpResponseMessage res;
        try
        {
            using var hcts = CancellationTokenSource.CreateLinkedTokenSource(ct);
            hcts.CancelAfter(TimeSpan.FromSeconds(30));
            res = await client.SendAsync(req, HttpCompletionOption.ResponseHeadersRead, hcts.Token);
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested) { return Results.Empty; }
        catch (Exception)
        {
            fresh = true;
            try { await Task.Delay(300, ct); } catch (OperationCanceledException) { return Results.Empty; }
            continue;
        }

        using (res)
        {
            var code = (int)res.StatusCode;
            lastStatus = code;

            if (code == 416)
            {
                if (!started)
                {
                    ctx.Response.StatusCode = 416;
                    if (res.Content.Headers.ContentRange is { } r416) ctx.Response.Headers["Content-Range"] = r416.ToString();
                    return Results.Empty;
                }
                break;
            }
            if (code != 200 && code != 206)
            {
                // odkaz vypršel / CDN se omylem zhoupla -> příště čerstvý odkaz
                fresh = true;
                try { await Task.Delay(300 * (attempt + 1), ct); } catch (OperationCanceledException) { return Results.Empty; }
                continue;
            }
            if (started && code == 200) break; // CDN ignorovala Range, navázat by nešlo bezpečně

            if (!started)
            {
                ctx.Response.StatusCode = code;
                ctx.Response.ContentType = res.Content.Headers.ContentType?.ToString() ?? "video/mp4";
                ctx.Response.Headers["Accept-Ranges"] = "bytes";
                ctx.Response.Headers.CacheControl = "no-store";
                if (res.Content.Headers.ContentLength is long cl) { ctx.Response.ContentLength = cl; total = cl; }
                if (res.Content.Headers.ContentRange is { } cr) ctx.Response.Headers["Content-Range"] = cr.ToString();
                if (download is "1" or "true")
                {
                    var baseName = Regex.Replace(string.IsNullOrWhiteSpace(name) ? "video" : name.Trim(), @"[\\/:*?""<>|\x00-\x1f]+", " ").Trim();
                    if (baseName.Length == 0) baseName = "video";
                    if (baseName.Length > 150) baseName = baseName[..150];
                    var fileName = baseName + ".mp4";
                    var ascii = new string(fileName.Where(c => c < 128 && c != '"' && c != '\\').ToArray());
                    ctx.Response.Headers.ContentDisposition =
                        $"attachment; filename=\"{ascii}\"; filename*=UTF-8''{Uri.EscapeDataString(fileName)}";
                }
                started = true;
            }

            await using var upstream = await res.Content.ReadAsStreamAsync(ct);
            using var rcts = CancellationTokenSource.CreateLinkedTokenSource(ct);
            while (true)
            {
                int n;
                try
                {
                    rcts.CancelAfter(TimeSpan.FromSeconds(30)); // hlídání nečinnosti CDN
                    n = await upstream.ReadAsync(buf, rcts.Token);
                }
                catch (OperationCanceledException) when (ct.IsCancellationRequested) { return Results.Empty; }
                catch (Exception) { n = -1; }   // spojení s CDN spadlo -> navážeme s novým odkazem
                if (n <= 0) break;
                try { await ctx.Response.Body.WriteAsync(buf.AsMemory(0, n), ct); }
                catch (Exception) { return Results.Empty; } // klient odešel
                sent += n;
            }

            if (total == null || sent >= total) break; // hotovo (nebo neznámá délka -> navázat nejde)
            fresh = true;                              // utrženo uprostřed -> další kolo s čerstvým odkazem
        }
        }
    }
    finally { ArrayPool<byte>.Shared.Return(buf); }

    if (!started)
        return Results.Json(new { success = false, error = $"CDN returned HTTP {lastStatus}" }, statusCode: 502);
    return Results.Empty;
}).RequireRateLimiting("api");

// ------------------------------------------------------------------ /api/health + /api/ping
// Proby upstreamů používá i admin panel (/api/admin/ops), takže jsou to samostatné lokální
// funkce místo kódu schovaného v handleru.
static async Task<object> ProbeUpstream(IHttpClientFactory f, string name, string url, int timeoutSec = 8, Dictionary<string,string>? headers = null)
{
    var sw = System.Diagnostics.Stopwatch.StartNew();
    try
    {
        using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(timeoutSec));
        var c = f.CreateClient("prehraj");
        using var req = new HttpRequestMessage(HttpMethod.Get, url);
        if (headers != null) foreach (var kv in headers) req.Headers.TryAddWithoutValidation(kv.Key, kv.Value);
        using var resp = await c.SendAsync(req, HttpCompletionOption.ResponseHeadersRead, cts.Token);
        sw.Stop();
        var ok = (int)resp.StatusCode >= 200 && (int)resp.StatusCode < 400;
        return new { endpoint = name, ok, status = (int)resp.StatusCode, ms = sw.ElapsedMilliseconds, error = ok ? (string?)null : ("HTTP " + (int)resp.StatusCode) };
    }
    catch (Exception ex)
    {
        sw.Stop();
        return new { endpoint = name, ok = false, status = 0, ms = sw.ElapsedMilliseconds, error = ex.GetType().Name + ": " + ex.Message };
    }
}

async Task<List<object>> RunUpstreamProbes(IHttpClientFactory f)
{
    var probes = new List<Task<object>>();
    probes.Add(ProbeUpstream(f, "upstream:itunes", "https://itunes.apple.com/search?media=movie&entity=movie&country=cz&limit=1&term=matrix"));
    probes.Add(ProbeUpstream(f, "upstream:iptv-org", "https://iptv-org.github.io/api/countries.json"));
    probes.Add(ProbeUpstream(f, "upstream:prehraj.to", "https://prehraj.to/"));
    probes.Add(ProbeUpstream(f, "upstream:sledujteto.cz", "https://www.sledujteto.cz/api/web/videos?query=test&limit=1&page=1&sort=relevance",
        headers: new Dictionary<string,string> { ["Accept"]="application/json", ["X-Requested-With"]="XMLHttpRequest", ["Referer"]="https://www.sledujteto.cz/vyhledat/?search=test&page=1", ["Origin"]="https://www.sledujteto.cz" }));
    probes.Add(ProbeUpstream(f, "upstream:bombuj.si", "https://www.bombuj.si/uvod.php"));
    foreach (var proxy in proxyPool.Current.Where(IsValidProxyUrl).Distinct(StringComparer.OrdinalIgnoreCase).Take(6))
    {
        var purl = proxy.Contains('?') ? (proxy + "&action=health") : (proxy + "?action=health");
        probes.Add(ProbeUpstream(f, "proxy:" + proxy, purl, 10));
    }
    return (await Task.WhenAll(probes)).ToList();
}

app.MapGet("/api/health", async (IHttpClientFactory f) =>
{
    var mapped = new[] { "/api/search", "/api/thumb", "/api/catalog", "/api/live", "/api/live/countries", "/api/live/hls", "/api/subtitles", "/api/proxy", "/api/stream", "/api/health", "/api/ping", "/api/version" };
    var mappedResults = mapped.Select(m => new { endpoint = m, ok = true, note = "mapped" }).ToArray<object>();

    var probeResults = await RunUpstreamProbes(f);
    var ok = probeResults.All(r => ((dynamic)r).ok);
    return Results.Json(new
    {
        ok,
        status = ok ? "ok" : "degraded",
        timeUtc = DateTime.UtcNow,
        onlineUsers = OnlineCount(),
        proxies = proxyPool.Current.Count(IsValidProxyUrl),
        lastGoodProxy = lastGoodProxy ?? "",
        endpoints = mappedResults,
        checks = probeResults,
    });
});

// Lehký heartbeat pro indikátor přítomnosti (nastavení / UI).
app.MapGet("/api/ping", () => Results.Json(new { ok = true, onlineUsers = OnlineCount() }))
   .RequireRateLimiting("api");

// Verze běžícího buildu - důkaz, že se opravdu nasadil nový kód. Commit doplní CI
// přes -p:SourceRevisionId=<sha> (objeví se za "+" v AssemblyInformationalVersion).
var buildVersion = typeof(Program).Assembly
    .GetCustomAttributes(typeof(System.Reflection.AssemblyInformationalVersionAttribute), false)
    .OfType<System.Reflection.AssemblyInformationalVersionAttribute>()
    .FirstOrDefault()?.InformationalVersion
    ?? typeof(Program).Assembly.GetName().Version?.ToString()
    ?? "unknown";
var startedAt = DateTimeOffset.UtcNow;
// ------------------------------------------------------------------ admin panel (/admin)
// Stav je v Admin/AdminStore.cs, endpointy v Admin/AdminEndpoints.cs. Heslo se bere
// z ADMIN_PASSWORD (App Service → Configuration → Application settings), nikdy z repa.
app.MapAdmin(new AdminRuntimeInfo(
    Build: buildVersion,
    Commit: buildVersion.IndexOf('+') >= 0 ? buildVersion[(buildVersion.IndexOf('+') + 1)..] : null,
    StartedAt: startedAt,
    OnlineUsers: OnlineCount,
    UpstreamProbes: RunUpstreamProbes,
    ServerProxies: () => proxyPool.Current.Where(IsValidProxyUrl).Distinct(StringComparer.OrdinalIgnoreCase).ToArray()));

app.MapGet("/api/version", (HttpContext ctx) =>
{
    var plus = buildVersion.IndexOf('+');
    ctx.Response.Headers.CacheControl = "no-store, max-age=0";
    return Results.Json(new
    {
        ok = true,
        build = buildVersion,
        commit = plus >= 0 ? buildVersion[(plus + 1)..] : null,
        started = startedAt,
        uptimeSeconds = (int)(DateTimeOffset.UtcNow - startedAt).TotalSeconds
    });
});

app.Run();

record ThumbResult(string Thumbnail, string Title, string Url);
// Položka katalogu pro homepage (iTunes RSS): t=název, y=rok, img=plakát, q=hledací výraz, g=žánry
record CatalogItem(string T, string Y, string Img, string Q, string[] G);

record LiveChannel(string Name, string Group, string Logo, string Url, string Id, string Ua, string Referrer, string Quality, string[] Tags);
record LiveCountry(string Code, string Name);
