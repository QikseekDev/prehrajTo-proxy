using System.Collections.Concurrent;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Text.Json;

namespace Wflix.Admin;

// ---------------------------------------------------------------------------
// Odhad polohy podle IP pro seznam "kdo je právě na webu".
//
// Bere se to na serveru, takže prohlížeč nic nevidí a nikdo nemusí nic povolovat.
// Zdroj je ip-api.com (free, bez klíče): dávkový endpoint zvládne 100 IP na dotaz
// a 45 dotazů za minutu, proto se volá nejvýš jednou za 4 s a výsledky se drží
// 24 h v paměti. Když zdroj neodpovídá, panel prostě polohu neukáže - nic
// nekritického a nic, co by blokovalo načtení seznamu.
// ---------------------------------------------------------------------------

public sealed record GeoInfo(string? Country, string? CountryCode, string? City, string? Isp, DateTimeOffset At);

public sealed class GeoIpService
{
    private static readonly TimeSpan CacheLifetime = TimeSpan.FromHours(24);
    private static readonly TimeSpan MinInterval = TimeSpan.FromSeconds(4);
    private static readonly TimeSpan FailLifetime = TimeSpan.FromMinutes(10);

    private readonly IHttpClientFactory factory;
    private readonly ILogger<GeoIpService> log;
    private readonly ConcurrentDictionary<string, GeoInfo> cache = new(StringComparer.OrdinalIgnoreCase);
    private readonly ConcurrentDictionary<string, DateTimeOffset> failed = new(StringComparer.OrdinalIgnoreCase);
    private readonly SemaphoreSlim gate = new(1, 1);
    private DateTimeOffset lastCall = DateTimeOffset.MinValue;

    public GeoIpService(IHttpClientFactory factory, ILogger<GeoIpService> log)
    {
        this.factory = factory;
        this.log = log;
    }

    public string? LastError { get; private set; }
    public DateTimeOffset? LastSuccess { get; private set; }

    public GeoInfo? Get(string ip) => cache.TryGetValue(ip, out var g) ? g : null;

    /// <summary>Kolik IP v seznamu ještě nemá polohu a není u nich známé, že to nejde.</summary>
    public int Pending(IEnumerable<string> ips, int limit = 100)
    {
        var now = DateTimeOffset.UtcNow;
        return ips
            .Where(IsPublic)
            .Where(ip => !cache.ContainsKey(ip))
            .Where(ip => !(failed.TryGetValue(ip, out var at) && at > now - FailLifetime))
            .Take(limit)
            .Count();
    }

    /// <summary>
    /// Doplní polohu pro zadané IP. Vrací počet nově zjištěných. Nikdy nehází -
    /// volá se na pozadí z endpointu, který kvůli tomu nesmí selhat.
    /// </summary>
    public async Task<int> ResolveAsync(IEnumerable<string> ips, CancellationToken ct = default)
    {
        var now = DateTimeOffset.UtcNow;
        var batch = ips
            .Where(IsPublic)
            .Where(ip => !cache.ContainsKey(ip))
            .Where(ip => !(failed.TryGetValue(ip, out var at) && at > now - FailLifetime))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .Take(100)
            .ToArray();
        if (batch.Length == 0) return 0;

        if (!await gate.WaitAsync(TimeSpan.FromSeconds(1), ct)) return 0;
        try
        {
            // Rate limit: 45/min na free plánu. Když se volalo před chvílí, příště.
            var wait = MinInterval - (DateTimeOffset.UtcNow - lastCall);
            if (wait > TimeSpan.Zero)
            {
                if (wait > TimeSpan.FromSeconds(2)) return 0;
                await Task.Delay(wait, ct);
            }
            lastCall = DateTimeOffset.UtcNow;

            var client = factory.CreateClient();
            var body = JsonSerializer.Serialize(batch);
            using var cts = CancellationTokenSource.CreateLinkedTokenSource(ct);
            cts.CancelAfter(TimeSpan.FromSeconds(6));
            using var req = new HttpRequestMessage(HttpMethod.Post, "http://ip-api.com/batch?fields=status,message,country,countryCode,city,isp,query")
            {
                Content = new StringContent(body, Encoding.UTF8, "application/json"),
            };
            req.Headers.UserAgent.ParseAdd("Wflix-Admin/2");

            using var res = await client.SendAsync(req, cts.Token);
            if (!res.IsSuccessStatusCode)
            {
                LastError = "ip-api.com vrátil HTTP " + (int)res.StatusCode;
                MarkFailed(batch);
                return 0;
            }

            await using var stream = await res.Content.ReadAsStreamAsync(cts.Token);
            using var doc = await JsonDocument.ParseAsync(stream, cancellationToken: cts.Token);
            if (doc.RootElement.ValueKind != JsonValueKind.Array)
            {
                LastError = "ip-api.com vrátil neočekávaný formát.";
                MarkFailed(batch);
                return 0;
            }

            var added = 0;
            foreach (var item in doc.RootElement.EnumerateArray())
            {
                var ip = item.TryGetProperty("query", out var q) ? q.GetString() : null;
                if (string.IsNullOrEmpty(ip)) continue;

                if (item.TryGetProperty("status", out var st) && st.GetString() == "success")
                {
                    cache[ip] = new GeoInfo(
                        Text(item, "country"),
                        Text(item, "countryCode"),
                        Text(item, "city"),
                        Text(item, "isp"),
                        DateTimeOffset.UtcNow);
                    failed.TryRemove(ip, out _);
                    added++;
                }
                else
                {
                    // Soukromá/neplatná IP nebo vyčerpaný limit - chvíli to nezkoušet.
                    failed[ip] = DateTimeOffset.UtcNow;
                    if (item.TryGetProperty("message", out var m)) LastError = m.GetString();
                }
            }

            if (added > 0)
            {
                LastSuccess = DateTimeOffset.UtcNow;
                LastError = null;
            }
            return added;
        }
        catch (Exception ex)
        {
            LastError = ex is OperationCanceledException ? "ip-api.com neodpověděl včas." : ex.GetType().Name + ": " + ex.Message;
            MarkFailed(batch);
            log.LogDebug(ex, "Admin: geolokaci se nepodařilo doplnit");
            return 0;
        }
        finally
        {
            gate.Release();
        }
    }

    private void MarkFailed(IEnumerable<string> ips)
    {
        var now = DateTimeOffset.UtcNow;
        foreach (var ip in ips) failed[ip] = now;
    }

    private static string? Text(JsonElement el, string name) =>
        el.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;

    /// <summary>Veřejná IP má smysl geolokovat; loopback, RFC1918 a IPv6 ULA ne.</summary>
    public static bool IsPublic(string? ip)
    {
        if (string.IsNullOrWhiteSpace(ip) || ip.Equals("unknown", StringComparison.OrdinalIgnoreCase)) return false;
        if (!IPAddress.TryParse(ip, out var addr)) return false;
        if (addr.IsIPv4MappedToIPv6) addr = addr.MapToIPv4();
        if (IPAddress.IsLoopback(addr)) return false;

        if (addr.AddressFamily == AddressFamily.InterNetwork)
        {
            var b = addr.GetAddressBytes();
            if (b[0] == 10) return false;
            if (b[0] == 172 && b[1] >= 16 && b[1] <= 31) return false;
            if (b[0] == 192 && b[1] == 168) return false;
            if (b[0] == 169 && b[1] == 254) return false;
            if (b[0] == 100 && b[1] >= 64 && b[1] <= 127) return false; // CGNAT
            if (b[0] == 0 || b[0] >= 224) return false;
            return true;
        }

        if (addr.AddressFamily == AddressFamily.InterNetworkV6)
        {
            if (addr.IsIPv6LinkLocal || addr.IsIPv6SiteLocal || addr.IsIPv6Multicast) return false;
            var b = addr.GetAddressBytes();
            if ((b[0] & 0xFE) == 0xFC) return false; // fc00::/7 (ULA)
            return true;
        }

        return false;
    }
}
