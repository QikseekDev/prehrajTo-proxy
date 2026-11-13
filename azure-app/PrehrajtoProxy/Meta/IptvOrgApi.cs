using System.Text.Json;

namespace Wflix.Meta;

// Záložní adresa streamu z iptv-org streams.json. Krátké názvy polí drží odpověď
// /api/live malou: kanálů jsou stovky a každý může mít několik alternativ.
public sealed record IptvAlt(string U, string Ua, string Referrer);

// iptv-org API jako doplněk k M3U playlistům, ne jejich náhrada: playlist je hotový
// pohled na zemi (jeden stream na kanál, logo, skupina) a streams.json k části kanálů
// zná další adresy, které v playlistu nejsou. Používají se jako záložní - když první
// stream nefunguje, klient zkusí další, místo aby divákovi ukázal chybu.
//
// streams.json má ~4 MB, takže se stahuje nejvýš jednou za 6 h a drží se v paměti;
// když stažení selže, zůstane to, co už je načtené.
public sealed class IptvOrgApi
{
    private const string StreamsUrl = "https://iptv-org.github.io/api/streams.json";
    private static readonly TimeSpan Ttl = TimeSpan.FromHours(6);

    private readonly IHttpClientFactory _factory;
    private readonly ILogger<IptvOrgApi> _log;
    private readonly SemaphoreSlim _gate = new(1, 1);
    private readonly object _sync = new();
    private Task? _loading;

    // id kanálu bez varianty ("CT1.cz@SD" -> "CT1.cz") -> alternativní streamy
    private Dictionary<string, List<IptvAlt>> _alts = new(StringComparer.OrdinalIgnoreCase);
    private DateTimeOffset _loadedAt = DateTimeOffset.MinValue;
    // Po neúspěchu se chvíli nezkouší znovu, aby výpadek API neznamenal stahování
    // při každém požadavku na /api/live.
    private DateTimeOffset _retryAt = DateTimeOffset.MinValue;

    public IptvOrgApi(IHttpClientFactory factory, ILogger<IptvOrgApi> log)
    {
        _factory = factory;
        _log = log;
    }

    // Alternativní streamy kanálu bez toho z playlistu. Prázdné pole znamená, že API
    // k danému kanálu nic dalšího nezná - klient pak nemá co zkoušet a ukáže chybu.
    public IReadOnlyList<IptvAlt> Alts(string? channelId, string? playlistUrl)
    {
        var id = ChannelKey(channelId);
        if (id.Length == 0 || !_alts.TryGetValue(id, out var list) || list.Count == 0) return Array.Empty<IptvAlt>();
        if (string.IsNullOrEmpty(playlistUrl)) return list;
        return list.Where(a => !string.Equals(a.U, playlistUrl, StringComparison.OrdinalIgnoreCase)).ToList();
    }

    // Data se načítají na pozadí; endpoint si počká jen `budget`, aby první odpověď
    // /api/live nevisela na 4 MB datasetu. Když se to nestihne, doběhne stažení samo
    // a alternativy se objeví u dalšího požadavku (seznam kanálů se cachuje zvlášť).
    public async Task WarmAsync(TimeSpan budget, CancellationToken ct)
    {
        if (_loadedAt != DateTimeOffset.MinValue && DateTimeOffset.UtcNow - _loadedAt < Ttl) return;
        if (DateTimeOffset.UtcNow < _retryAt) return;
        StartLoad();
        var task = _loading;
        if (task == null) return;
        using var cts = CancellationTokenSource.CreateLinkedTokenSource(ct);
        cts.CancelAfter(budget);
        try { await task.WaitAsync(cts.Token); }
        catch (OperationCanceledException) { /* stažení pokračuje na pozadí */ }
    }

    private void StartLoad()
    {
        lock (_sync)
        {
            if (_loading is { IsCompleted: false }) return;
            _loading = Task.Run(() => EnsureLoadedAsync(CancellationToken.None));
        }
    }

    private async Task EnsureLoadedAsync(CancellationToken ct)
    {
        if (!await _gate.WaitAsync(TimeSpan.FromSeconds(20), ct)) return;
        try
        {
            if (_loadedAt != DateTimeOffset.MinValue && DateTimeOffset.UtcNow - _loadedAt < Ttl) return;

            var client = _factory.CreateClient();
            client.Timeout = TimeSpan.FromSeconds(90);
            var json = await client.GetStringAsync(StreamsUrl, ct);
            var alts = ParseStreams(json);

            // Až po úspěšném parsování: při chybě zůstane předchozí (i prázdný) stav.
            if (alts.Count > 0) _alts = alts;
            _loadedAt = DateTimeOffset.UtcNow;
        }
        catch (Exception ex)
        {
            _retryAt = DateTimeOffset.UtcNow.AddMinutes(10);
            _log.LogWarning(ex, "iptv-org streams.json se nepodařilo načíst");
        }
        finally
        {
            _gate.Release();
        }
    }

    private static Dictionary<string, List<IptvAlt>> ParseStreams(string json)
    {
        var map = new Dictionary<string, List<IptvAlt>>(StringComparer.OrdinalIgnoreCase);
        using var doc = JsonDocument.Parse(json);
        if (doc.RootElement.ValueKind != JsonValueKind.Array) return map;

        foreach (var row in doc.RootElement.EnumerateArray())
        {
            if (row.ValueKind != JsonValueKind.Object) continue;
            if (!row.TryGetProperty("channel", out var ch) || ch.ValueKind != JsonValueKind.String) continue;
            var id = ch.GetString();
            if (string.IsNullOrWhiteSpace(id)) continue;
            if (!row.TryGetProperty("url", out var u) || u.ValueKind != JsonValueKind.String) continue;
            var url = u.GetString();
            if (string.IsNullOrWhiteSpace(url) || !LooksLikeHls(url)) continue;

            // Playlist páruje podle tvg-id bez varianty, takže id z API ("CT1.cz")
            // odpovídá i kanálu "CT1.cz@SD".
            var alt = new IptvAlt(url.Trim(), Str(row, "user_agent"), Str(row, "referrer"));
            if (!map.TryGetValue(id!, out var list)) map[id!] = list = new List<IptvAlt>(2);
            if (list.All(x => !string.Equals(x.U, alt.U, StringComparison.OrdinalIgnoreCase))) list.Add(alt);
        }
        return map;
    }

    // Prohlížeč přehraje jen HLS playlist; část streamů v API jsou surové MPEG-TS adresy,
    // které by hls.js jen zbytečně zkoušel a selhal, takže se do záložních adres neberou.
    private static bool LooksLikeHls(string url) =>
        url.Contains(".m3u8", StringComparison.OrdinalIgnoreCase)
        || url.Contains("/hls", StringComparison.OrdinalIgnoreCase)
        || url.Contains("playlist", StringComparison.OrdinalIgnoreCase);

    private static string Str(JsonElement row, string name) =>
        row.TryGetProperty(name, out var el) && el.ValueKind == JsonValueKind.String
            ? (el.GetString() ?? "").Trim()
            : "";

    // "AMCEurope.uk@CzechRepublic" -> "AMCEurope.uk"; API zná kanál, ne variantu.
    private static string ChannelKey(string? tvgId)
    {
        if (string.IsNullOrWhiteSpace(tvgId)) return "";
        var at = tvgId.IndexOf('@');
        return (at > 0 ? tvgId[..at] : tvgId).Trim();
    }
}
