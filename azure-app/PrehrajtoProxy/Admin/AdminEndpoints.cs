using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Caching.Memory;

namespace Wflix.Admin;

public sealed record LoginRequest(string? Password);
public sealed record BanRequest(string? Kind, string? Target, int? Minutes, string? Reason);
public sealed record UnbanRequest(string? Kind, string? Target);
public sealed record PurgeRequest(string? Scope, bool? Proxies);
public sealed record ProxyItem(string? Url, bool? Enabled, string? Note);
public sealed record ProxiesRequest(List<ProxyItem>? Items, bool? Commit);
public sealed record ProxyTestRequest(List<string>? Urls);

public sealed record AdminRuntimeInfo(
    string Build,
    string? Commit,
    DateTimeOffset StartedAt,
    Func<int> OnlineUsers,
    Func<IHttpClientFactory, Task<List<object>>> UpstreamProbes,
    Func<string[]> ServerProxies);

/// <summary>
/// Admin endpoints. Všechno pod /api/admin (kromě login/session) vyžaduje cookie
/// podepsanou heslem z ADMIN_PASSWORD a u POSTů CSRF hlavičku; panel je na /admin.
/// </summary>
public static class AdminEndpoints
{
    private static readonly string[] PurgeScopes = { "all", "search", "thumb", "catalog", "live", "cdn" };

    public static void MapAdmin(this WebApplication app, AdminRuntimeInfo runtime)
    {
        var store = app.Services.GetRequiredService<AdminStore>();

        // ------------------------------------------------------------ stránka
        app.MapGet("/admin", async (HttpContext ctx) =>
        {
            var webRoot = app.Environment.WebRootPath ?? Path.Combine(app.Environment.ContentRootPath, "wwwroot");
            var file = Path.Combine(webRoot, "admin.html");
            if (!File.Exists(file)) return Results.NotFound();
            ctx.Response.Headers.CacheControl = "no-store, max-age=0";
            ctx.Response.Headers["X-Robots-Tag"] = "noindex, nofollow";
            ctx.Response.ContentType = "text/html; charset=utf-8";
            await ctx.Response.WriteAsync(await File.ReadAllTextAsync(file, ctx.RequestAborted));
            return Results.Empty;
        });

        // ------------------------------------------------------------ veřejná konfigurace pro klienty
        // Klienti (web/APK/IPK) si podle toho schovají tlačítka a ukážou hlášku, ale
        // rozhodující je stejně vynucení na serveru níž - config je jen UI.
        app.MapGet("/api/config", (HttpContext ctx) =>
        {
            var s = store.Current;
            ctx.Response.Headers.CacheControl = "no-store, max-age=0";
            return Results.Json(new
            {
                success = true,
                maintenance = s.Flags.Maintenance,
                fullMaintenance = s.Flags.FullMaintenance,
                shutdown = s.Flags.FrontendShutdown,
                message = s.Flags.MaintenanceMessage,
                proxies = app.Services.GetRequiredService<ProxyPool>().Current,
                flags = new
                {
                    downloads = s.Flags.Downloads,
                    live = s.Flags.Live,
                    liveRelay = s.Flags.LiveRelay,
                    mergeSources = s.Flags.MergeSources,
                    itunesThumb = s.Flags.ItunesThumb,
                },
                sources = new
                {
                    enabled = s.Sources.Enabled(),
                    fallback = s.Sources.Fallback,
                    maxPage = s.Sources.MaxPage,
                },
                build = runtime.Build,
            });
        });

        // ------------------------------------------------------------ přihlášení
        app.MapPost("/api/admin/login", (HttpContext ctx, LoginRequest body) =>
        {
            ctx.Response.Headers.CacheControl = "no-store, max-age=0";
            if (!store.Enabled)
                return Results.Json(new { success = false, error = "Admin není nakonfigurovaný. Nastav ADMIN_PASSWORD." }, statusCode: 503);

            var ip = ClientIp(ctx);
            if (store.LoginBlocked(ip))
                return Results.Json(new { success = false, error = "Příliš mnoho pokusů. Zkus to za 10 minut." }, statusCode: 429);
            if (!store.PasswordMatches(body?.Password))
            {
                store.LoginFailed(ip);
                store.RecordAudit("login-failed", ip, "");
                return Results.Json(new { success = false, error = "Špatné heslo." }, statusCode: 401);
            }

            store.LoginSucceeded(ip);
            var csrf = AdminStore.NewCsrfToken();
            var cookie = new CookieOptions
            {
                HttpOnly = true,
                Secure = ctx.Request.IsHttps,
                SameSite = SameSiteMode.Strict,
                Path = "/",
                MaxAge = AdminStore.SessionMaxAge,
            };
            ctx.Response.Cookies.Append(AdminStore.SessionCookie, store.IssueSession(), cookie);
            ctx.Response.Cookies.Append(AdminStore.CsrfCookie, csrf, new CookieOptions
            {
                HttpOnly = false,
                Secure = ctx.Request.IsHttps,
                SameSite = SameSiteMode.Strict,
                Path = "/",
                MaxAge = AdminStore.SessionMaxAge,
            });
            store.RecordAudit("login", ip, "");
            return Results.Json(new { success = true, csrf });
        }).RequireRateLimiting("admin");

        app.MapGet("/api/admin/session", (HttpContext ctx) =>
        {
            ctx.Response.Headers.CacheControl = "no-store, max-age=0";
            var authed = store.ValidateSession(ctx.Request.Cookies[AdminStore.SessionCookie]);
            string? csrf = null;
            if (authed)
            {
                csrf = ctx.Request.Cookies[AdminStore.CsrfCookie];
                if (string.IsNullOrEmpty(csrf))
                {
                    csrf = AdminStore.NewCsrfToken();
                    ctx.Response.Cookies.Append(AdminStore.CsrfCookie, csrf, new CookieOptions
                    {
                        HttpOnly = false,
                        Secure = ctx.Request.IsHttps,
                        SameSite = SameSiteMode.Strict,
                        Path = "/",
                        MaxAge = AdminStore.SessionMaxAge,
                    });
                }
            }
            return Results.Json(new { success = true, enabled = store.Enabled, authenticated = authed, csrf });
        }).RequireRateLimiting("admin");

        // ------------------------------------------------------------ chráněná část
        var secured = app.MapGroup("/api/admin").RequireRateLimiting("admin");

        secured.AddEndpointFilter(async (inv, next) =>
        {
            var ctx = inv.HttpContext;
            ctx.Response.Headers.CacheControl = "no-store, max-age=0";
            if (!store.Enabled)
                return Results.Json(new { success = false, error = "Admin není nakonfigurovaný. Nastav ADMIN_PASSWORD." }, statusCode: 503);
            if (!store.ValidateSession(ctx.Request.Cookies[AdminStore.SessionCookie]))
                return Results.Json(new { success = false, error = "Nejsi přihlášený." }, statusCode: 401);

            if (HttpMethods.IsPost(ctx.Request.Method))
            {
                var cookie = ctx.Request.Cookies[AdminStore.CsrfCookie] ?? "";
                var header = ctx.Request.Headers["X-Wflix-CSRF"].ToString();
                if (cookie.Length < 16 || header.Length != cookie.Length
                    || !CryptographicOperations.FixedTimeEquals(Encoding.UTF8.GetBytes(cookie), Encoding.UTF8.GetBytes(header)))
                    return Results.Json(new { success = false, error = "Neplatný CSRF token. Načti stránku znovu." }, statusCode: 403);
            }
            return await next(inv);
        });

        secured.MapPost("/logout", (HttpContext ctx) =>
        {
            ctx.Response.Cookies.Delete(AdminStore.SessionCookie, new CookieOptions { Path = "/" });
            ctx.Response.Cookies.Delete(AdminStore.CsrfCookie, new CookieOptions { Path = "/" });
            store.RecordAudit("logout", ClientIp(ctx), "");
            return Results.Json(new { success = true });
        });

        secured.MapGet("/state", (IMemoryCache cache) =>
        {
            WflixCache.Prune(cache);
            var s = store.Current;
            var (hits, misses) = WflixCache.Stats;
            var (req, rl, se) = store.Counters;
            return Results.Json(new
            {
                success = true,
                state = s,
                stats = new
                {
                    requests = req,
                    rateLimited = rl,
                    serverErrors = se,
                    activeBans = s.Bans.Count(b => b.Active),
                    topTalkers = store.TopTalkers(10),
                    requestsPerMinute = store.RequestsPerMinute(60),
                },
                cache = new
                {
                    memoryEntries = cache is MemoryCache mc ? mc.Count : -1,
                    trackedKeys = WflixCache.Count("all"),
                    hits,
                    misses,
                    scopes = new
                    {
                        search = WflixCache.Count("search"),
                        thumb = WflixCache.Count("thumb"),
                        catalog = WflixCache.Count("catalog"),
                        live = WflixCache.Count("live"),
                        cdn = WflixCache.Count("cdn"),
                    },
                },
                runtime = RuntimeJson(runtime),
            });
        });

        secured.MapGet("/ops", async (IHttpClientFactory f) =>
        {
            var probes = await runtime.UpstreamProbes(f);
            var (req, rl, se) = store.Counters;
            return Results.Json(new
            {
                success = true,
                runtime = RuntimeJson(runtime),
                onlineUsers = runtime.OnlineUsers(),
                stats = new { requests = req, rateLimited = rl, serverErrors = se },
                checks = probes,
            });
        });

        secured.MapPost("/flags", (FlagsConfig body, HttpContext ctx) =>
        {
            if (body == null) return Results.BadRequest(new { success = false, error = "Chybí tělo." });
            if (!store.Enabled && (body.FullMaintenance || body.FrontendShutdown))
                return Results.BadRequest(new
                {
                    success = false,
                    error = "Zamknout nebo vypnout web jde jen tehdy, když je nastavené admin heslo - jinak by se to nedalo odemknout.",
                });
            var next = store.Update(s => s.Flags = body, Actor(ctx));
            store.RecordAudit("flags", Actor(ctx), Describe(next.Flags));
            return Results.Json(new { success = true, state = next });
        });

        secured.MapPost("/sources", (SourcesConfig body, HttpContext ctx) =>
        {
            if (body == null) return Results.BadRequest(new { success = false, error = "Chybí tělo." });
            body.MaxPage = Math.Clamp(body.MaxPage, 1, 50);
            var next = store.Update(s => s.Sources = body, Actor(ctx));
            store.RecordAudit("sources", Actor(ctx), Describe(next.Sources));
            return Results.Json(new { success = true, state = next });
        });

        secured.MapPost("/bans", (BanRequest body, HttpContext ctx) =>
        {
            var kind = (body?.Kind ?? "").Trim().ToLowerInvariant();
            var target = (body?.Target ?? "").Trim();
            if (kind != "ip" && kind != "cid")
                return Results.BadRequest(new { success = false, error = "kind musí být \"ip\" nebo \"cid\"." });
            if (kind == "ip" && !System.Net.IPAddress.TryParse(target, out _))
                return Results.BadRequest(new { success = false, error = "Neplatná IP adresa." });
            if (kind == "cid" && (target.Length < 8 || target.Length > 80 || target.Any(c => !char.IsLetterOrDigit(c) && c != '-' && c != '_')))
                return Results.BadRequest(new { success = false, error = "Neplatný cid (8-80 znaků, [A-Za-z0-9_-])." });

            var minutes = Math.Clamp(body?.Minutes ?? 60, 1, 10080);
            var reason = (body?.Reason ?? "").Trim();
            if (reason.Length > 200) reason = reason[..200];

            var next = store.Ban(kind, target, minutes, reason, Actor(ctx));
            store.RecordAudit("ban", Actor(ctx), $"{kind} {target} na {minutes} min" + (reason.Length > 0 ? " (" + reason + ")" : ""));
            return Results.Json(new { success = true, state = next });
        });

        secured.MapPost("/bans/remove", (UnbanRequest body, HttpContext ctx) =>
        {
            var kind = (body?.Kind ?? "").Trim().ToLowerInvariant();
            var target = (body?.Target ?? "").Trim();
            if ((kind != "ip" && kind != "cid") || target.Length == 0)
                return Results.BadRequest(new { success = false, error = "Chybí kind/target." });
            var next = store.Unban(kind, target, Actor(ctx));
            store.RecordAudit("unban", Actor(ctx), $"{kind} {target}");
            return Results.Json(new { success = true, state = next });
        });

        secured.MapGet("/audit", () => Results.Json(new { success = true, entries = store.Audit(150) }));

        // Celý audit jako soubor - na dohledání, co se kdy změnilo, se hodí víc než 150 řádků v tabulce.
        secured.MapGet("/audit/export", () =>
        {
            if (!File.Exists(store.AuditPath))
                return Results.NotFound(new { success = false, error = "Audit je zatím prázdný." });
            return Results.File(store.AuditPath, "application/x-ndjson", "wflix-audit.jsonl");
        });

        // ------------------------------------------------------------ kdo je na webu
        secured.MapGet("/visitors", (HttpContext ctx, GeoIpService geo) =>
        {
            var minutes = int.TryParse(ctx.Request.Query["minutes"], out var m) ? m : 10;
            var list = store.Visitors(minutes, 200);
            var ips = list.Select(v => v.Ip).ToArray();
            var pending = geo.Pending(ips);

            // Poloha se doplňuje na pozadí, aby tabulka nikdy nečekala na cizí službu.
            if (pending > 0 && ctx.Request.Query["geo"].ToString() != "0")
                _ = Task.Run(() => geo.ResolveAsync(ips, CancellationToken.None));

            var rows = list.Select(v =>
            {
                var g = geo.Get(v.Ip);
                return new
                {
                    ip = v.Ip,
                    firstSeen = v.FirstSeen,
                    lastSeen = v.LastSeen,
                    secondsAgo = Math.Max(0, (int)(DateTimeOffset.UtcNow - v.LastSeen).TotalSeconds),
                    requests = v.Requests,
                    ua = v.Ua,
                    path = v.Path,
                    banned = v.Banned,
                    country = g?.Country,
                    countryCode = g?.CountryCode,
                    city = g?.City,
                    isp = g?.Isp,
                    geoKnown = g != null,
                };
            }).ToArray();

            var countries = rows
                .Where(r => !string.IsNullOrEmpty(r.country))
                .GroupBy(r => r.countryCode ?? r.country)
                .Select(g => new
                {
                    code = g.Key,
                    country = g.First().country,
                    count = g.Count(),
                    flag = Flag(g.First().countryCode),
                })
                .OrderByDescending(c => c.count)
                .ToArray();

            return Results.Json(new
            {
                success = true,
                minutes,
                count = rows.Length,
                pending,
                geoLastError = geo.LastError,
                countries,
                visitors = rows,
            });
        });

        // ------------------------------------------------------------ proxy servery
        secured.MapGet("/proxies", (ProxyPool pool, ProxyCommitSettings commit) => Results.Json(new
        {
            success = true,
            managed = pool.Managed,
            items = pool.Items.Select(p => new { url = p.Url, enabled = p.Enabled, note = p.Note }),
            effective = pool.Current,
            configured = pool.Configured,
            commit = new { configured = commit.Configured, repo = commit.Repo, branch = commit.Branch },
        }));

        secured.MapPost("/proxies", async (ProxiesRequest body, HttpContext ctx, ProxyPool pool,
            ProxyCommitSettings commitSettings, IHttpClientFactory f) =>
        {
            var entries = new List<ProxyEntry>();
            foreach (var item in body?.Items ?? new List<ProxyItem>())
            {
                var url = (item?.Url ?? "").Trim();
                if (url.Length == 0) continue;
                if (!ProxyPool.IsValidUrl(url))
                    return Results.BadRequest(new { success = false, error = "Neplatná URL proxy: " + url + " (musí to být http:// nebo https:// adresa)." });
                entries.Add(new ProxyEntry
                {
                    Url = url,
                    Enabled = item!.Enabled ?? true,
                    Note = (item.Note ?? "").Trim(),
                });
            }
            if (entries.Count > 100)
                return Results.BadRequest(new { success = false, error = "Nejvýš 100 proxy serverů." });

            var next = store.Update(s => s.Proxies = entries, Actor(ctx));
            var enabledUrls = entries.Where(e => e.Enabled).Select(e => e.Url).ToArray();
            var summary = $"{enabledUrls.Length} zapnutých z {entries.Count}";
            store.RecordAudit("proxies", Actor(ctx), summary);

            // Commit je volitelný a nikdy neshodí uložení - když chybí token, jen se řekne proč.
            ProxyCommitResult? commit = null;
            if (body?.Commit == true)
            {
                commit = await ProxyCommit.CommitAsync(f, commitSettings, enabledUrls, Actor(ctx), ctx.RequestAborted);
                store.RecordAudit("proxies-commit", Actor(ctx),
                    commit.Ok ? "ok " + (commit.Sha ?? "") : (commit.Skipped ? "přeskočeno" : "chyba: " + commit.Error));
            }

            return Results.Json(new { success = true, state = next, effective = pool.Current, commit });
        });

        // Commit současného seznamu bez další změny - když se předtím commit nepovedl.
        secured.MapPost("/proxies/commit", async (HttpContext ctx, ProxyPool pool,
            ProxyCommitSettings commitSettings, IHttpClientFactory f) =>
        {
            var urls = pool.Current;
            var commit = await ProxyCommit.CommitAsync(f, commitSettings, urls, Actor(ctx), ctx.RequestAborted);
            store.RecordAudit("proxies-commit", Actor(ctx),
                commit.Ok ? "ok " + (commit.Sha ?? "") : (commit.Skipped ? "přeskočeno" : "chyba: " + commit.Error));
            return Results.Json(new { success = commit.Ok, commit, effective = urls });
        });

        secured.MapGet("/proxies/export", (ProxyPool pool) =>
            Results.Text(ProxyPool.FileText(pool.Current), "text/plain; charset=utf-8"));

        secured.MapPost("/proxies/test", async (ProxyTestRequest body, IHttpClientFactory f) =>
        {
            var urls = (body?.Urls ?? new List<string>())
                .Select(u => (u ?? "").Trim())
                .Where(ProxyPool.IsValidUrl)
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .Take(20)
                .ToArray();

            var results = await Task.WhenAll(urls.Select(async url =>
            {
                var sw = System.Diagnostics.Stopwatch.StartNew();
                try
                {
                    var client = f.CreateClient("prehraj");
                    using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(10));
                    var target = url + (url.Contains('?') ? "&" : "?") + "action=health";
                    using var res = await client.GetAsync(target, cts.Token);
                    sw.Stop();
                    var ok = (int)res.StatusCode is >= 200 and < 400;
                    string? error = ok ? null : "HTTP " + (int)res.StatusCode;
                    return new { url, ok, status = (int)res.StatusCode, ms = sw.ElapsedMilliseconds, error };
                }
                catch (Exception ex)
                {
                    sw.Stop();
                    var error = (string?)(ex.GetType().Name + ": " + ex.Message);
                    return new { url, ok = false, status = 0, ms = sw.ElapsedMilliseconds, error };
                }
            }));

            return Results.Json(new { success = true, results });
        });

        // ------------------------------------------------------------ mazání cache
        secured.MapPost("/purge", async (PurgeRequest body, HttpContext ctx, IMemoryCache cache, IHttpClientFactory f) =>
        {
            var scope = (body?.Scope ?? "all").Trim().ToLowerInvariant();
            if (!PurgeScopes.Contains(scope))
                return Results.BadRequest(new { success = false, error = "scope musí být " + string.Join(", ", PurgeScopes) + "." });

            var removed = WflixCache.Purge(cache, scope);

            // PHP proxy má vlastní cache (sys_get_temp_dir) na každém hostingu zvlášť.
            // Maže se jen když je na proxy nastavený WFLIX_PURGE_TOKEN; jinak se to přeskočí.
            // Zaškrtávátko v panelu "smazat i cache na proxy" - když je vypnuté, nechodí se na sítě.
            var proxies = new List<object>();
            var wantProxies = body?.Proxies ?? true;
            if (wantProxies && (scope is "all" or "search" or "thumb"))
                proxies = await PurgeProxies(f, runtime.ServerProxies(), scope, store.PurgeToken);

            store.RecordAudit("purge", Actor(ctx), $"{scope}: {removed} klíčů, proxy {(proxies.Count == 0 ? "ne" : string.Join(", ", proxies.Select(p => JsonSerializer.Serialize(p))))}");
            return Results.Json(new { success = true, scope, removed, proxies });
        });
    }

    // ---------------------------------------------------------------- helpers
    private static object RuntimeJson(AdminRuntimeInfo runtime) => new
    {
        build = runtime.Build,
        commit = runtime.Commit,
        started = runtime.StartedAt,
        uptimeSeconds = (int)(DateTimeOffset.UtcNow - runtime.StartedAt).TotalSeconds,
        onlineUsers = runtime.OnlineUsers(),
        proxies = runtime.ServerProxies().Length,
    };

    /// <summary>Vlajka země z kódu (CZ -> 🇨🇿), ať se seznam čte rychleji.</summary>
    private static string? Flag(string? code)
    {
        if (string.IsNullOrWhiteSpace(code) || code.Length != 2) return null;
        var upper = code.ToUpperInvariant();
        if (!upper.All(c => c is >= 'A' and <= 'Z')) return null;
        return string.Concat(upper.Select(c => char.ConvertFromUtf32(0x1F1E6 + (c - 'A'))));
    }

    private static string ClientIp(HttpContext ctx) => ctx.Connection.RemoteIpAddress?.ToString() ?? "unknown";

    private static string Actor(HttpContext ctx) => ClientIp(ctx);

    private static string Describe(FlagsConfig f) => string.Join(",", new[]
    {
        f.Maintenance ? "maintenance" : null,
        f.FullMaintenance ? "full-maintenance" : null,
        f.FrontendShutdown ? "frontend-shutdown" : null,
        f.Downloads ? null : "no-downloads",
        f.Live ? null : "no-live",
        f.LiveRelay ? null : "no-live-relay",
        f.MergeSources ? null : "no-merge",
        f.ItunesThumb ? null : "no-itunes-thumb",
    }.Where(x => x != null));

    private static string Describe(SourcesConfig s) =>
        $"enabled={string.Join("+", s.Enabled())}, fallback={s.Fallback}, maxPage={s.MaxPage}";

    private static async Task<List<object>> PurgeProxies(IHttpClientFactory f, string[] proxies, string scope, string? token)
    {
        var results = new List<object>();
        if (string.IsNullOrWhiteSpace(token))
        {
            results.Add(new { proxy = "*", ok = false, skipped = true, error = "WFLIX_PURGE_TOKEN není nastavený, vzdálené cache zůstaly." });
            return results;
        }

        var client = f.CreateClient("prehraj");
        foreach (var p in proxies
                     .Where(p => p.StartsWith("http://", StringComparison.OrdinalIgnoreCase) || p.StartsWith("https://", StringComparison.OrdinalIgnoreCase))
                     .Distinct(StringComparer.OrdinalIgnoreCase))
        {
            var url = p + (p.Contains('?') ? "&" : "?")
                      + "action=purge&scope=" + Uri.EscapeDataString(scope)
                      + "&token=" + Uri.EscapeDataString(token);
            try
            {
                using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(10));
                using var res = await client.GetAsync(url, cts.Token);
                var text = await res.Content.ReadAsStringAsync(cts.Token);
                var purged = -1;
                try
                {
                    using var doc = JsonDocument.Parse(text);
                    if (doc.RootElement.ValueKind == JsonValueKind.Object
                        && doc.RootElement.TryGetProperty("purged", out var n) && n.TryGetInt32(out var count))
                        purged = count;
                }
                catch (JsonException) { }
                results.Add(new
                {
                    proxy = p,
                    ok = res.IsSuccessStatusCode,
                    status = (int)res.StatusCode,
                    purged,
                    error = res.IsSuccessStatusCode ? null : text[..Math.Min(160, text.Length)],
                });
            }
            catch (Exception ex)
            {
                results.Add(new { proxy = p, ok = false, status = 0, purged = -1, error = ex.GetType().Name + ": " + ex.Message });
            }
        }
        return results;
    }
}
