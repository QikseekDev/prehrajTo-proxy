using System.Collections.Concurrent;
using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.Extensions.Caching.Memory;

namespace Wflix.Admin;

// ---------------------------------------------------------------------------
// Stav, který admin panel mění. Ukládá se jako JSON a čte se za běhu - appka
// se kvůli přepnutí flagu nemusí restartovat ani nasazovat znovu.
// ---------------------------------------------------------------------------

public sealed class FlagsConfig
{
    /// <summary>Všechno /api kromě /api/config, /api/health a /api/admin vrací 503.</summary>
    public bool Maintenance { get; set; }
    public string MaintenanceMessage { get; set; } = "Wflix je dočasně mimo provoz. Zkus to za chvíli.";
    /// <summary>Stahování (/api/stream?download=1). Přehrávání přes server zůstává.</summary>
    public bool Downloads { get; set; } = true;
    /// <summary>Celé Živé vysílání (/api/live, /api/live/countries, /api/live/hls).</summary>
    public bool Live { get; set; } = true;
    /// <summary>Jen HLS relay (/api/live/hls); seznam kanálů a přímé přehrávání fungují dál.</summary>
    public bool LiveRelay { get; set; } = true;
    /// <summary>Hledání ve všech zdrojích naráz (source=all / "Více výsledků").</summary>
    public bool MergeSources { get; set; } = true;
    /// <summary>Náhledy plakátů z iTunes (/api/thumb?src=itunes).</summary>
    public bool ItunesThumb { get; set; } = true;
}

public sealed class SourcesConfig
{
    public bool Prehrajto { get; set; } = true;
    public bool Sledujteto { get; set; } = true;
    public bool Bombuj { get; set; } = true;
    /// <summary>Automatický fallback prehrajto -> sledujteto při prázdném výsledku/chybě.</summary>
    public bool Fallback { get; set; } = true;
    /// <summary>Nejvyšší stránka, kterou /api/search pustí (1-50).</summary>
    public int MaxPage { get; set; } = 50;

    public string[] Enabled() => new[]
    {
        Prehrajto ? "prehrajto" : null,
        Sledujteto ? "sledujteto" : null,
        Bombuj ? "bombuj" : null,
    }.Where(x => x != null).Select(x => x!).ToArray();

    public bool IsEnabled(string source) => source switch
    {
        "prehrajto" => Prehrajto,
        "sledujteto" => Sledujteto,
        "bombuj" => Bombuj,
        _ => false,
    };
}

public sealed class BanEntry
{
    public string Target { get; set; } = "";
    /// <summary>"ip" nebo "cid".</summary>
    public string Kind { get; set; } = "ip";
    public DateTimeOffset Until { get; set; }
    public string Reason { get; set; } = "";
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;

    [JsonIgnore]
    public bool Active => Until > DateTimeOffset.UtcNow;
}

public sealed class AdminState
{
    public int Version { get; set; } = 1;
    public FlagsConfig Flags { get; set; } = new();
    public SourcesConfig Sources { get; set; } = new();
    public List<BanEntry> Bans { get; set; } = new();
    public DateTimeOffset UpdatedAt { get; set; } = DateTimeOffset.UtcNow;
    public string? UpdatedBy { get; set; }
}

public sealed record AuditEntry(DateTimeOffset At, string Action, string Actor, string Details);

// ---------------------------------------------------------------------------
// Počítadla cache. IMemoryCache neumí "smaž všechno se prefixem", tak si klíče
// evidujeme sami (klíč -> oblast) a při purge je odstraníme po jedné.
// ---------------------------------------------------------------------------

public static class WflixCache
{
    private static readonly ConcurrentDictionary<string, string> Tracked = new(StringComparer.Ordinal);
    private static long hits;
    private static long misses;

    public static void Hit() => Interlocked.Increment(ref hits);
    public static void Miss() => Interlocked.Increment(ref misses);
    public static void Track(string key, string scope) => Tracked[key] = scope;
    public static (long Hits, long Misses) Stats => (Interlocked.Read(ref hits), Interlocked.Read(ref misses));

    public static int Count(string scope) =>
        scope == "all" ? Tracked.Count : Tracked.Count(kv => kv.Value == scope);

    /// <summary>Zapomene klíče, které už v cache nejsou (TTL vypršel), aby počty nelhaly.</summary>
    public static void Prune(IMemoryCache cache)
    {
        foreach (var kv in Tracked)
            if (!cache.TryGetValue(kv.Key, out _)) Tracked.TryRemove(kv.Key, out _);
    }

    public static int Purge(IMemoryCache cache, string scope)
    {
        var removed = 0;
        foreach (var kv in Tracked.ToArray())
        {
            if (scope != "all" && !string.Equals(kv.Value, scope, StringComparison.Ordinal)) continue;
            cache.Remove(kv.Key);
            if (Tracked.TryRemove(kv.Key, out _)) removed++;
        }
        return removed;
    }
}

// ---------------------------------------------------------------------------
// Store: soubor se stavem + auth (token z env, HMAC cookie), bany, statistiky.
// ---------------------------------------------------------------------------

public sealed class AdminStore
{
    public const string SessionCookie = "wflix_admin";
    public const string CsrfCookie = "wflix_admin_csrf";
    private static readonly TimeSpan SessionLifetime = TimeSpan.FromHours(12);
    private static readonly TimeSpan ReloadThrottle = TimeSpan.FromSeconds(1);

    private static readonly JsonSerializerOptions Json = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        PropertyNameCaseInsensitive = true,
        WriteIndented = true,
    };

    private readonly ILogger<AdminStore> log;
    private readonly object gate = new();
    private AdminState state = new();
    private DateTime stateMtime = DateTime.MinValue;
    private DateTime lastReloadCheck = DateTime.MinValue;

    private readonly ConcurrentDictionary<string, (int Fails, DateTime Until)> loginFails = new();
    private readonly ConcurrentDictionary<string, long> perClient = new();
    private readonly ConcurrentQueue<AuditEntry> audit = new();
    private long requests;
    private long rateLimited;
    private long serverErrors;

    public string StatePath { get; }
    public string AuditPath { get; }
    public string? Token { get; }
    public string? PurgeToken { get; }
    public bool Enabled => !string.IsNullOrWhiteSpace(Token);

    public AdminStore(IConfiguration cfg, IHostEnvironment env, ILogger<AdminStore> log)
    {
        this.log = log;

        // ADMIN_TOKEN (env / App Service settings) je zdroj pravdy; konfigurační klíč je jen
        // alternativa pro appsettings.Development.json.
        Token = FirstNonEmpty(Environment.GetEnvironmentVariable("ADMIN_TOKEN"), cfg["Admin:Token"]);
        PurgeToken = FirstNonEmpty(Environment.GetEnvironmentVariable("WFLIX_PURGE_TOKEN"), cfg["Admin:PurgeToken"]);

        var path = FirstNonEmpty(Environment.GetEnvironmentVariable("ADMIN_STATE_PATH"), cfg["Admin:StatePath"]);
        if (path == null)
        {
            // App Service: /home je persistentní a sdílený mezi instancemi. Lokálně appsettings
            // složka projektu. Nikdy ne bin/ - ta se při nasazení přepíše.
            var home = Environment.GetEnvironmentVariable("HOME");
            path = !string.IsNullOrWhiteSpace(home)
                ? Path.Combine(home, "wflix-admin", "state.json")
                : Path.Combine(env.ContentRootPath, "App_Data", "state.json");
        }
        StatePath = Path.GetFullPath(path);
        AuditPath = Path.Combine(Path.GetDirectoryName(StatePath)!, "audit.jsonl");

        Load();
        LoadAuditTail();
        log.LogInformation("Admin: enabled={Enabled}, state={Path}", Enabled, StatePath);
    }

    private static string? FirstNonEmpty(params string?[] values) =>
        values.Select(v => v?.Trim()).FirstOrDefault(v => !string.IsNullOrEmpty(v));

    // ---------------------------------------------------------------- stav
    public AdminState Current
    {
        get
        {
            MaybeReload();
            return Volatile.Read(ref state);
        }
    }

    private void MaybeReload()
    {
        var now = DateTime.UtcNow;
        if (now - lastReloadCheck < ReloadThrottle) return;
        lastReloadCheck = now;

        DateTime mtime;
        try
        {
            if (!File.Exists(StatePath)) return;
            mtime = File.GetLastWriteTimeUtc(StatePath);
        }
        catch { return; }

        if (mtime == stateMtime) return;
        Load();
        log.LogInformation("Admin: stav znovu načten z {Path}", StatePath);
    }

    private void Load()
    {
        try
        {
            if (!File.Exists(StatePath))
            {
                lock (gate) Write(new AdminState());
                return;
            }
            var json = File.ReadAllText(StatePath);
            var parsed = JsonSerializer.Deserialize<AdminState>(json, Json);
            if (parsed == null) return;
            parsed.Flags ??= new FlagsConfig();
            parsed.Sources ??= new SourcesConfig();
            parsed.Bans ??= new List<BanEntry>();
            parsed.Sources.MaxPage = Math.Clamp(parsed.Sources.MaxPage, 1, 50);
            lock (gate)
            {
                state = parsed;
                stateMtime = File.GetLastWriteTimeUtc(StatePath);
            }
        }
        catch (Exception ex)
        {
            log.LogWarning(ex, "Admin: stav se nepodařilo načíst z {Path}", StatePath);
        }
    }

    private void Write(AdminState next)
    {
        var dir = Path.GetDirectoryName(StatePath)!;
        Directory.CreateDirectory(dir);
        var tmp = StatePath + ".tmp";
        File.WriteAllText(tmp, JsonSerializer.Serialize(next, Json));
        File.Move(tmp, StatePath, true);
        state = next;
        stateMtime = File.GetLastWriteTimeUtc(StatePath);
    }

    /// <summary>Atomicky změní stav (klon -> mutace -> zápis) a vrátí novou podobu.</summary>
    public AdminState Update(Action<AdminState> mutate, string actor)
    {
        lock (gate)
        {
            // Když soubor mezitím někdo upravil ručně, načte se před zápisem - jinak by
            // se ruční změna tiše přepsala starou kopií z paměti.
            ReloadIfChangedUnderLock();
            var clone = JsonSerializer.Deserialize<AdminState>(JsonSerializer.Serialize(state, Json), Json) ?? new AdminState();
            mutate(clone);
            clone.Flags ??= new FlagsConfig();
            clone.Sources ??= new SourcesConfig();
            clone.Bans ??= new List<BanEntry>();
            clone.Sources.MaxPage = Math.Clamp(clone.Sources.MaxPage, 1, 50);
            if (string.IsNullOrWhiteSpace(clone.Flags.MaintenanceMessage))
                clone.Flags.MaintenanceMessage = new FlagsConfig().MaintenanceMessage;
            if (clone.Flags.MaintenanceMessage.Length > 300)
                clone.Flags.MaintenanceMessage = clone.Flags.MaintenanceMessage[..300];
            // Prošlé bany starší než den už nikoho nezajímají.
            clone.Bans.RemoveAll(b => !b.Active && b.Until < DateTimeOffset.UtcNow.AddDays(-1));
            clone.UpdatedAt = DateTimeOffset.UtcNow;
            clone.UpdatedBy = actor;
            Write(clone);
            return clone;
        }
    }

    // Volá se pod lockem; Load() je reentrantní (stejný Monitor).
    private void ReloadIfChangedUnderLock()
    {
        lastReloadCheck = DateTime.UtcNow;
        try
        {
            if (!File.Exists(StatePath)) return;
            if (File.GetLastWriteTimeUtc(StatePath) != stateMtime) Load();
        }
        catch { /* soubor mohl zmizet - jede se z paměti */ }
    }

    // ---------------------------------------------------------------- auth
    public bool TokenMatches(string? candidate)
    {
        if (!Enabled || string.IsNullOrEmpty(candidate)) return false;
        var a = SHA256.HashData(Encoding.UTF8.GetBytes(candidate));
        var b = SHA256.HashData(Encoding.UTF8.GetBytes(Token!));
        return CryptographicOperations.FixedTimeEquals(a, b);
    }

    public string IssueSession()
    {
        var exp = DateTimeOffset.UtcNow.Add(SessionLifetime).ToUnixTimeSeconds().ToString(CultureInfo.InvariantCulture);
        return exp + "." + Sign(exp);
    }

    private string Sign(string payload)
    {
        using var hmac = new HMACSHA256(SHA256.HashData(Encoding.UTF8.GetBytes(Token ?? "")));
        var raw = hmac.ComputeHash(Encoding.UTF8.GetBytes("wflix-admin|" + payload));
        return Convert.ToBase64String(raw).TrimEnd('=').Replace('+', '-').Replace('/', '_');
    }

    public bool ValidateSession(string? cookie)
    {
        if (!Enabled || string.IsNullOrWhiteSpace(cookie)) return false;
        var dot = cookie.IndexOf('.');
        if (dot <= 0 || dot == cookie.Length - 1) return false;
        var payload = cookie[..dot];
        var sig = cookie[(dot + 1)..];
        if (!long.TryParse(payload, NumberStyles.Integer, CultureInfo.InvariantCulture, out var exp)) return false;
        if (exp < DateTimeOffset.UtcNow.ToUnixTimeSeconds()) return false;
        return CryptographicOperations.FixedTimeEquals(Encoding.UTF8.GetBytes(sig), Encoding.UTF8.GetBytes(Sign(payload)));
    }

    public static TimeSpan SessionMaxAge => SessionLifetime;

    public static string NewCsrfToken() =>
        Convert.ToBase64String(RandomNumberGenerator.GetBytes(24)).TrimEnd('=').Replace('+', '-').Replace('/', '_');

    // Login throttle: 5 špatných pokusů z jedné IP během 10 minut = 10 minut pauza.
    // Fails se počítá ve okně (Until), blokuje se až od pátého pokusu - jeden překlep
    // nemá zamknout panel na deset minut.
    private const int MaxLoginFails = 5;
    private const int LoginWindowMinutes = 10;
    private const int LoginBlockMinutes = 10;

    public bool LoginBlocked(string ip)
    {
        if (!loginFails.TryGetValue(ip, out var v)) return false;
        if (v.Until <= DateTime.UtcNow)
        {
            loginFails.TryRemove(ip, out _);
            return false;
        }
        return v.Fails >= MaxLoginFails;
    }

    public void LoginFailed(string ip)
    {
        var now = DateTime.UtcNow;
        loginFails.AddOrUpdate(ip,
            _ => (1, now.AddMinutes(LoginWindowMinutes)),
            (_, v) =>
            {
                var inWindow = v.Until > now;
                var fails = inWindow ? v.Fails + 1 : 1;
                var until = fails >= MaxLoginFails
                    ? now.AddMinutes(LoginBlockMinutes)
                    : (inWindow ? v.Until : now.AddMinutes(LoginWindowMinutes));
                return (fails, until);
            });
        if (loginFails.Count > 2048)
            foreach (var kv in loginFails)
                if (kv.Value.Until < now) loginFails.TryRemove(kv.Key, out _);
    }

    public void LoginSucceeded(string ip) => loginFails.TryRemove(ip, out _);

    // ---------------------------------------------------------------- bany
    public BanEntry? ActiveBan(HttpContext ctx)
    {
        var s = Current;
        if (s.Bans.Count == 0) return null;

        var ip = ctx.Connection.RemoteIpAddress?.ToString();
        var cid = ClientId(ctx);
        foreach (var b in s.Bans)
        {
            if (!b.Active) continue;
            if (b.Kind == "ip" && ip != null && string.Equals(b.Target, ip, StringComparison.OrdinalIgnoreCase)) return b;
            if (b.Kind == "cid" && cid != null && string.Equals(b.Target, cid, StringComparison.Ordinal)) return b;
        }
        return null;
    }

    // Stejná pravidla jako PresenceId v Program.cs - cid je jen krátký [A-Za-z0-9_-] řetězec.
    public static string? ClientId(HttpContext ctx)
    {
        var id = ctx.Request.Query["cid"].ToString();
        if (string.IsNullOrWhiteSpace(id)) id = ctx.Request.Headers["X-Wflix-Client"].ToString();
        if (string.IsNullOrWhiteSpace(id)) return null;
        id = id.Trim();
        if (id.Length < 8 || id.Length > 80) return null;
        foreach (var c in id) if (!char.IsLetterOrDigit(c) && c != '-' && c != '_') return null;
        return id;
    }

    public AdminState Ban(string kind, string target, int minutes, string reason, string actor) =>
        Update(s =>
        {
            s.Bans.RemoveAll(b => b.Kind == kind && string.Equals(b.Target, target, StringComparison.OrdinalIgnoreCase));
            s.Bans.Add(new BanEntry
            {
                Kind = kind,
                Target = target,
                Until = DateTimeOffset.UtcNow.AddMinutes(minutes),
                Reason = reason,
            });
        }, actor);

    public AdminState Unban(string kind, string target, string actor) =>
        Update(s => s.Bans.RemoveAll(b => b.Kind == kind && string.Equals(b.Target, target, StringComparison.OrdinalIgnoreCase)), actor);

    // ---------------------------------------------------------------- statistiky
    public void CountRequest(string client, int status)
    {
        Interlocked.Increment(ref requests);
        if (status == StatusCodes.Status429TooManyRequests) Interlocked.Increment(ref rateLimited);
        if (status >= 500) Interlocked.Increment(ref serverErrors);

        if (perClient.Count > 4096) perClient.Clear();
        perClient.AddOrUpdate(client, 1, (_, v) => v + 1);
    }

    public (long Requests, long RateLimited, long ServerErrors) Counters =>
        (Interlocked.Read(ref requests), Interlocked.Read(ref rateLimited), Interlocked.Read(ref serverErrors));

    public object[] TopTalkers(int take) => perClient
        .OrderByDescending(kv => kv.Value)
        .Take(take)
        .Select(kv => (object)new { client = kv.Key, requests = kv.Value })
        .ToArray();

    // ---------------------------------------------------------------- audit
    public void RecordAudit(string action, string actor, string details)
    {
        var entry = new AuditEntry(DateTimeOffset.UtcNow, action, actor, details);
        audit.Enqueue(entry);
        while (audit.Count > 500) audit.TryDequeue(out _);
        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(AuditPath)!);
            if (File.Exists(AuditPath) && new FileInfo(AuditPath).Length > 1_000_000)
                File.Delete(AuditPath);
            File.AppendAllText(AuditPath, JsonSerializer.Serialize(entry, Json) + "\n");
        }
        catch (Exception ex)
        {
            log.LogWarning(ex, "Admin: audit se nepodařilo zapsat");
        }
    }

    public AuditEntry[] Audit(int take) => audit.Reverse().Take(take).ToArray();

    private void LoadAuditTail()
    {
        try
        {
            if (!File.Exists(AuditPath)) return;
            foreach (var line in File.ReadLines(AuditPath).TakeLast(200))
            {
                try
                {
                    var e = JsonSerializer.Deserialize<AuditEntry>(line, Json);
                    if (e != null) audit.Enqueue(e);
                }
                catch (JsonException) { }
            }
        }
        catch (Exception ex)
        {
            log.LogWarning(ex, "Admin: audit se nepodařilo načíst");
        }
    }
}
