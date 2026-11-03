using System.Globalization;
using System.Net;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.Extensions.Caching.Memory;

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
}).ConfigurePrimaryHttpMessageHandler(() => new HttpClientHandler
{
    AllowAutoRedirect = true,
    AutomaticDecompression = DecompressionMethods.All
});

// Klient pro přeposílání videa (/api/stream): bez dekomprese (Range musí sedět na bajty souboru)
// a bez celkového timeoutu - film běží hodiny, hlídáme jen nečinnost při čtení.
builder.Services.AddHttpClient("prehraj-stream", c =>
{
    c.Timeout = Timeout.InfiniteTimeSpan;
    c.DefaultRequestHeaders.UserAgent.ParseAdd(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36");
    c.DefaultRequestHeaders.AcceptLanguage.ParseAdd("cs-CZ,cs;q=0.9,en;q=0.5");
}).ConfigurePrimaryHttpMessageHandler(() => new HttpClientHandler
{
    AllowAutoRedirect = true,
    AutomaticDecompression = DecompressionMethods.None
});

builder.Services.AddMemoryCache();

var app = builder.Build();

app.UseDefaultFiles();
app.UseStaticFiles();

// Optional: set "Prehraj:ProxyUrls" in appsettings.json / Azure config (Prehraj__ProxyUrls__0,
// Prehraj__ProxyUrls__1, ... in App Service) to a list of your own index.php hosts
// (e.g. "https://wtzi.borec.cz/index.php") to route through them instead of calling prehraj.to
// directly. With several entries they're raced concurrently, same as the client's own list from
// ⚙️ Nastavení - whichever answers first wins, a dead one is simply skipped. This is the server-side
// default used when the client sends none; "Prehraj:ProxyUrl" (singular) still works for a single URL.
var serverProxies = app.Configuration.GetSection("Prehraj:ProxyUrls").Get<string[]>() ?? Array.Empty<string>();
var proxyUrl = app.Configuration["Prehraj:ProxyUrl"];
if (!string.IsNullOrWhiteSpace(proxyUrl)) serverProxies = serverProxies.Append(proxyUrl).ToArray();

const RegexOptions Ci = RegexOptions.IgnoreCase | RegexOptions.CultureInvariant;
const RegexOptions CiS = Ci | RegexOptions.Singleline;

// ------------------------------------------------------------------ helpers
static bool IsPrehrajUrl(string u) =>
    Uri.TryCreate(u, UriKind.Absolute, out var x)
    && (x.Scheme == Uri.UriSchemeHttp || x.Scheme == Uri.UriSchemeHttps)
    && (x.Host.Equals("prehraj.to", StringComparison.OrdinalIgnoreCase)
        || x.Host.EndsWith(".prehraj.to", StringComparison.OrdinalIgnoreCase));

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
    IHttpClientFactory f, string proxyBase, string query, int timeoutSeconds)
{
    var sep = proxyBase.Contains('?') ? "&" : "?";
    var url = proxyBase + sep + query;
    return ct => GetAsync(f, url, timeoutSeconds, null, ct);
}

// Souběžně zkusí všechny zdroje (PHP proxy servery + prehraj.to přímo) a vrátí první odpověď,
// která projde: 2xx + neprázdné tělo + není JSON chyba. Vítěz se bere, ostatní se zruší -
// jeden padlý/limitovaný server (429 atd.) request nezbrzdí, dokud funguje aspoň jeden zdroj.
static async Task<(bool ok, string body, List<string> errors)> RaceSources(
    Func<CancellationToken, Task<(int status, string body, string? err)>>[] sources, int timeoutSeconds)
{
    using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(timeoutSeconds));
    var errors = new List<string>();
    var tasks = new List<Task<(int status, string body, string? err)>>();
    foreach (var src in sources)
    {
        var t = src(cts.Token);
        _ = t.ContinueWith(_ => { }, TaskContinuationOptions.OnlyOnFaulted); // ať spadlý úkol nezůstane nepozorovaný
        tasks.Add(t);
    }
    while (tasks.Count > 0)
    {
        var done = await Task.WhenAny(tasks);
        tasks.Remove(done);
        (int status, string body, string? err) r;
        try { r = await done; }
        catch (Exception ex) { errors.Add(ex.Message); continue; }
        if (r.err == null && Is2xx(r.status) && r.body.Length > 0 && IsGoodBody(r.body))
        {
            cts.Cancel();
            return (true, r.body, errors);
        }
        errors.Add(r.err ?? $"HTTP {r.status}");
    }
    return (false, "", errors);
}

// Společná chybová odpověď, když selže úplně všechno (proxy i přímé volání).
static IResult AllFailed(List<string> errors) =>
    Results.Json(new { success = false, valid = false, error = "Všechny zdroje selhaly: " + string.Join(" | ", errors) });

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

string? FindVideoUrl(string html, bool strict)
{
    // Same patterns, same order as index.php
    var patterns = strict
        ? new[]
        {
            @"[""']?(https?:\/\/[^""']*premiumcdn\.net[^""']*\.m3u8[^""']*)[""']?",
            @"[""']?(https?:\/\/[^""']*premiumcdn\.net[^""']*\.mp4[^""']*)[""']?",
        }
        : new[]
        {
            @"[""']?(https?:\/\/[^""']*premiumcdn\.net[^""']*\.m3u8[^""']*)[""']?",
            @"[""']?(https?:\/\/[^""']*premiumcdn\.net[^""']*\.mp4[^""']*)[""']?",
            @"[""']?(https?:\/\/[^""']*cdn[^""']*\.(?:m3u8|mp4)[^""']*)[""']?",
            @"<source[^>]+src=[""']([^""']+)[""'][^>]*>",
            @"<video[^>]+src=[""']([^""']+)[""'][^>]*>",
            @"""file""\s*:\s*""([^""]+)""",
            @"""src""\s*:\s*""([^""]+)""",
            @"""url""\s*:\s*""([^""]+\.m3u8[^""]*)""",
        };

    foreach (var p in patterns)
    {
        var m = Regex.Match(html, p, Ci);
        if (!m.Success) continue;
        var candidate = m.Groups[1].Value;
        if (strict || Regex.IsMatch(candidate, @"\.(m3u8|mp4)", Ci))
            return candidate.Replace("\\/", "/");
    }
    return null;
}

// ------------------------------------------------------------------ search (sdílené: /api/search + /api/thumb)
// Parsování výsledků hledání z HTML prehraj.to - používá přímá cesta v /api/search i thumb.
List<Movie> ParseSearchHtml(string html)
{
    var movies = new List<Movie>();
    var seen = new HashSet<string>();

    var linkRx = new Regex(
        @"<a[^>]*class=""[^""]*video[^""]*""[^>]*href=""(\/[a-z0-9+-]+\/[a-z0-9]+)""[^>]*title=""([^""]+)""[^>]*>", Ci);

    foreach (Match m in linkRx.Matches(html))
    {
        var url = m.Groups[1].Value;
        if (!seen.Add(url)) continue;
        var title = WebUtility.HtmlDecode(m.Groups[2].Value);

        var thumb = "";
        var tm = Regex.Match(html, "href=\"" + Regex.Escape(url) + "\".*?<img[^>]*src=\"([^\"]+thumb[^\"]*\\.jpg)\"", CiS);
        if (tm.Success) thumb = tm.Groups[1].Value;

        var year = "";
        var ym = Regex.Match(title, @"[-(](\d{4})[)-]");
        if (ym.Success) year = ym.Groups[1].Value;
        else
        {
            ym = Regex.Match(url, @"-(\d{4})[-/]");
            if (ym.Success) year = ym.Groups[1].Value;
        }

        movies.Add(new Movie("https://prehraj.to" + url, title, thumb, year));
        if (movies.Count >= 30) break;
    }

    // Fallback pattern (same as index.php)
    if (movies.Count == 0)
    {
        var alt = new Regex(
            @"data-video-id=""[^""]*"".*?href=""(\/[^""]+)""[^>]*title=""([^""]+)"".*?src=""([^""]+\.jpg)""", CiS);
        foreach (Match m in alt.Matches(html))
        {
            movies.Add(new Movie("https://prehraj.to" + m.Groups[1].Value,
                WebUtility.HtmlDecode(m.Groups[2].Value), m.Groups[3].Value, ""));
            if (movies.Count >= 30) break;
        }
    }

    return movies;
}

// ------------------------------------------------------------------ /api/search
app.MapGet("/api/search", async (string q, string[]? proxy, IHttpClientFactory f) =>
{
    q = (q ?? "").Trim();
    if (q.Length == 0)
        return Results.BadRequest(new { success = false, error = "Missing search query (q parameter)" });

    // Závod: jen PHP proxy servery - na prehraj.to přímo se nikdy nechodí (datacentrová IP
    // dostane captcha a přímá cesta by přebila výsledky z proxy nulovým počtem).
    var query = $"action=search&q={Uri.EscapeDataString(q)}";
    var sources = EffectiveProxies(proxy, serverProxies).Select(p => ProxySource(f, p, query, 30)).ToList();


    var (ok, body, errors) = await RaceSources(sources.ToArray(), 30);
    if (!ok) return AllFailed(errors);
    return Results.Content(body, "application/json");
});

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

string FixThumb(string u) =>
    u.Length == 0 ? "" : u.StartsWith("//") ? "https:" + u : u.StartsWith("/") ? "https://prehraj.to" + u : u;

app.MapGet("/api/thumb", async (string? q, string? t, int? y, string? re, string? src, string[]? proxy, IHttpClientFactory f, IMemoryCache cache, HttpContext ctx) =>
{
    q = (q ?? "").Replace("*", " ").Trim();
    t = (t ?? "").Replace("*", " ").Trim();
    re = (re ?? "").Trim();
    src = src == "itunes" ? "itunes" : "prehraj";
    if (q.Length == 0)
        return Results.BadRequest(new { success = false, error = "Missing q parameter", usage = "/api/thumb?q=Matrix&y=1999" });

    var eff = EffectiveProxies(proxy, serverProxies);
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

    var key = $"thumb|{src}|{Norm(q)}|{Norm(t)}|{y}|{re}";
    if (!cache.TryGetValue(key, out ThumbResult? res) || res is null)
    {
        // Závod: PHP proxy servery + vlastní pohled iTunes (na prehraj.to přímo se nechodí). Kdo vrátí 2xx
        // s normální odpovědí, ten vyhrává; chyba (429 atd.) nebo {"success":false} = prohra
        // a bere se další zdroj. Když selže všechno, klient dostane chybu a zkusí to příště.
        var sources = eff.Select(p => ProxySource(f, p, qs, 40)).ToList();
        sources.Add(async ct =>
        {
            // Nikdy přímo na prehraj.to - jen přes PHP proxy servery; tahle cesta zůstává jen pro iTunes.
            ThumbResult? r2 = null;
            if (src == "itunes") r2 = await ItunesThumb(f, t.Length > 0 ? t : q, rx, y);
            if (r2 is null) return (0, "", "direct fetch disabled - use PHP proxies");
            // nalezené držíme týden, nenalezené hodinu; chyby z prehraj.to se necachují
            cache.Set(key, r2, r2.Thumbnail.Length > 0 ? TimeSpan.FromDays(7) : TimeSpan.FromHours(1));
            var json = JsonSerializer.Serialize(new { success = true, q, thumbnail = r2.Thumbnail, title = r2.Title, url = r2.Url });
            return (200, json, (string?)null);
        });

        var (won, body, errors) = await RaceSources(sources.ToArray(), 40);
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
    }

    ctx.Response.Headers.CacheControl = res.Thumbnail.Length > 0 ? "public, max-age=86400" : "public, max-age=600";
    return Results.Json(new { success = true, q, thumbnail = res.Thumbnail, title = res.Title, url = res.Url });
});

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
        return Results.Json(new { success = true, lang, count = items.Count, items });
    }
    catch (Exception ex)
    {
        return Results.Json(new { success = false, error = "iTunes feed parse error: " + ex.Message });
    }
});

// ------------------------------------------------------------------ /api/proxy  (extract video URL)
app.MapGet("/api/proxy", async (string url, string[]? proxy, IHttpClientFactory f) =>
{
    if (string.IsNullOrEmpty(url))
        return Results.BadRequest(new { success = false, error = "Missing url parameter" });
    if (!IsPrehrajUrl(url))
        return Results.BadRequest(new { success = false, error = "URL must be from prehraj.to" });

    // Závod: jen PHP proxy servery - na prehraj.to přímo se nechodí. 2xx s normální odpovědí = vyhrává;
    // 429/403/5xx nebo {"success":false} = prohra a bere se další zdroj.
    var query = $"url={Uri.EscapeDataString(url)}";
    var sources = EffectiveProxies(proxy, serverProxies).Select(p => ProxySource(f, p, query, 30)).ToList();


    var (ok, body, errors) = await RaceSources(sources.ToArray(), 30);
    if (!ok)
        return Results.Json(new
        {
            success = false,
            error = "Všechny zdroje selhaly: " + string.Join(" | ", errors),
            hint = "Page might require JavaScript or different parsing"
        });
    return Results.Content(body, "application/json");
});

// ------------------------------------------------------------------ /api/validate
app.MapGet("/api/validate", async (string url, string[]? proxy, IHttpClientFactory f) =>
{
    if (string.IsNullOrEmpty(url))
        return Results.Json(new { valid = false, error = "Missing url parameter" });

    if (!IsPrehrajUrl(url))
        return Results.Json(new { valid = false, error = "URL must be from prehraj.to" });

    // Závod: jen PHP proxy servery (na prehraj.to přímo se nechodí). "valid:false" bez error je platná odpověď
    // (video neexistuje), {"valid":false,"error":...} a jakákoli ne-2xx jsou chyba -> další zdroj.
    var query = $"action=validate&url={Uri.EscapeDataString(url)}";
    var sources = EffectiveProxies(proxy, serverProxies).Select(p => ProxySource(f, p, query, 30)).ToList();


    var (ok, body, errors) = await RaceSources(sources.ToArray(), 30);
    if (!ok) return Results.Json(new { valid = false, error = "Všechny zdroje selhaly: " + string.Join(" | ", errors) });
    return Results.Content(body, "application/json");
});

// ------------------------------------------------------------------ /api/stream  (relay videa + stahování)
// GET /api/stream?url={prehraj.to stránka}[&download=1&name=Titul]
// Server si sám vezme čerstvý odkaz z CDN a video přeposílá (včetně Range, takže funguje seeking).
// Proč: podepsaný CDN odkaz po pár minutách vyprší, prehrávač si pak nemůže dotáhnout další část a
// video se zasekne. Tady se při chybě CDN / utrženém spojení odkaz obnoví a přenos naváže přesně
// tam, kde skončil - prohlížeč nic nepozná. S &download=1 se posílá jako příloha (stažení).
static string NormCdn(string u) => WebUtility.HtmlDecode(u.Replace("\\/", "/")).Replace("\\u0026", "&");
static string CdnKey(string u) =>
    Uri.TryCreate(u, UriKind.Absolute, out var x) ? (x.Host + x.AbsolutePath).ToLowerInvariant() : u.ToLowerInvariant();

// Na stránce bývá víc video odkazů; vezmeme ten, co má stejnou cestu jako ten, který klient právě hraje.
static string? PickByHint(string html, string hint)
{
    var key = CdnKey(hint);
    foreach (Match m in Regex.Matches(html, @"https?:\\?/\\?/[^""'<>\s]+\.(?:m3u8|mp4)[^""'<>\s]*", Ci))
    {
        var u = NormCdn(m.Value);
        if (CdnKey(u) == key) return u;
    }
    return null;
}

// hint = CDN odkaz, který klient právě přehrává (&v=). Přímo ho používáme jen pro premiumcdn.net
// (jinak by šlo přes server stahovat cokoli); jinak slouží jen k nalezení správného souboru na stránce.
async Task<string?> ResolveCdnUrl(IHttpClientFactory f, IMemoryCache cache, string page, bool fresh, string? hint)
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
    // Nikdy přímo na prehraj.to - stránka videa chodí jen přes PHP proxy servery.
    foreach (var p in serverProxies.Where(IsValidProxyUrl).Distinct(StringComparer.OrdinalIgnoreCase))
    {
            var sep = p.Contains('?') ? "&" : "?";
            var (ps, pb, pe) = await GetAsync(f, p + sep + "url=" + Uri.EscapeDataString(page), 30);
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
    return found;
}

app.MapGet("/api/stream", async (string url, string? name, string? download, string? v, IHttpClientFactory f, IMemoryCache cache, HttpContext ctx) =>
{
    if (!IsPrehrajUrl(url))
        return Results.Json(new { success = false, error = "URL must be from prehraj.to" }, statusCode: 400);

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
    var buf = new byte[81920];

    for (var attempt = 0; attempt < 6 && !ct.IsCancellationRequested; attempt++)
    {
        var cdn = await ResolveCdnUrl(f, cache, url, fresh, string.IsNullOrWhiteSpace(v) ? null : v);
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
            await Task.Delay(300, CancellationToken.None);
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
                await Task.Delay(300 * (attempt + 1), CancellationToken.None);
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

    if (!started)
        return Results.Json(new { success = false, error = $"CDN returned HTTP {lastStatus}" }, statusCode: 502);
    return Results.Empty;
});

app.Run();

record Movie(string Url, string Title, string Thumbnail, string Year);
record ThumbResult(string Thumbnail, string Title, string Url);
// Položka katalogu pro homepage (iTunes RSS): t=název, y=rok, img=plakát, q=hledací výraz, g=žánry
record CatalogItem(string T, string Y, string Img, string Q, string[] G);
