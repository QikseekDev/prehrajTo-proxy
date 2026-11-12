using System.Net.Http.Headers;
using System.Text.Json;
using Microsoft.Extensions.Caching.Memory;

namespace Wflix.Meta;

public sealed record CsfdMeta(
    int Id,
    string Title,
    int? Year,
    string Poster,
    double? Rating,
    int? RatingCount,
    string[] Genres,
    string Url);

// ČSFD nemá veřejné API (jen HTML), takže metadata bereme z bartholomej/node-csfd-api
// (MIT), který se provozuje jako samostatná REST služba - Docker image
// bartholomej/node-csfd-api, endpointy /search/:query a /movie/:id.
// Volitelná integrace: když Csfd:BaseUrl není nastavené, endpointy se chovají jako
// "metadata nejsou k dispozici" a zbytek appky funguje beze změny.
public sealed class CsfdClient
{
    private static readonly TimeSpan HitTtl = TimeSpan.FromDays(7);
    private static readonly TimeSpan MissTtl = TimeSpan.FromHours(6);

    private readonly HttpClient _http;
    private readonly IMemoryCache _cache;
    private readonly ILogger<CsfdClient> _log;
    private readonly string _base;
    private readonly string _language;
    private readonly string? _apiKey;

    public bool Enabled => _base.Length > 0;

    public CsfdClient(IConfiguration cfg, IHttpClientFactory factory, IMemoryCache cache, ILogger<CsfdClient> log)
    {
        _cache = cache;
        _log = log;
        _http = factory.CreateClient("meta");
        _apiKey = string.IsNullOrWhiteSpace(cfg["Csfd:ApiKey"]) ? null : cfg["Csfd:ApiKey"]!.Trim();
        _language = (cfg["Csfd:Language"] ?? "cs").Trim().ToLowerInvariant() switch
        {
            "en" => "en",
            "sk" => "sk",
            _ => "cs",
        };
        _base = (cfg["Csfd:BaseUrl"] ?? "").Trim().TrimEnd('/');
    }

    // Najde film/seriál podle názvu (a případně roku) a vrátí plakát, hodnocení a žánry.
    // Nalezené i nenalezené výsledky se cachují - ČSFD je cizí server a nemá smysl ho
    // kvůli stejnému titulu obcházet pro každého diváka.
    public async Task<CsfdMeta?> LookupAsync(string query, int? year, CancellationToken ct)
    {
        if (!Enabled) return null;
        query = (query ?? "").Trim();
        if (query.Length < 2) return null;

        var key = $"csfd|{TextNorm.Key(query)}|{year?.ToString() ?? "-"}";
        if (_cache.TryGetValue(key, out CsfdMeta? cached)) return cached;

        CsfdMeta? result = null;
        try
        {
            result = await FetchAsync(query, year, ct);
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception ex)
        {
            _log.LogDebug(ex, "ČSFD lookup selhal pro {Query}", query);
        }

        _cache.Set(key, result, result != null ? HitTtl : MissTtl);
        return result;
    }

    private async Task<CsfdMeta?> FetchAsync(string query, int? year, CancellationToken ct)
    {
        using var search = await GetJsonAsync(
            $"{_base}/search/{Uri.EscapeDataString(query)}?language={_language}", ct);
        if (search is null) return null;

        var bestId = 0;
        var bestScore = -1;
        foreach (var bucket in new[] { "movies", "tvSeries" })
        {
            if (!search.RootElement.TryGetProperty(bucket, out var arr) || arr.ValueKind != JsonValueKind.Array)
                continue;
            foreach (var item in arr.EnumerateArray())
            {
                if (item.ValueKind != JsonValueKind.Object) continue;
                if (!item.TryGetProperty("id", out var idEl) || !idEl.TryGetInt32(out var id) || id <= 0) continue;

                var title = item.TryGetProperty("title", out var tEl) && tEl.ValueKind == JsonValueKind.String
                    ? tEl.GetString() ?? "" : "";
                var itemYear = item.TryGetProperty("year", out var yEl) && yEl.TryGetInt32(out var y) ? y : (int?)null;

                var score = 0;
                if (TextNorm.Key(title) == TextNorm.Key(query)) score += 3;
                else if (TextNorm.Key(title).Contains(TextNorm.Key(query), StringComparison.Ordinal)) score += 1;
                if (year is int wanted && itemYear == wanted) score += 2;
                else if (year is int wantedYear && itemYear is int iy && Math.Abs(iy - wantedYear) == 1) score += 1;

                if (score > bestScore)
                {
                    bestScore = score;
                    bestId = id;
                }
            }
        }
        if (bestId == 0) return null;

        using var movie = await GetJsonAsync($"{_base}/movie/{bestId}?language={_language}", ct);
        if (movie is null) return null;

        var root = movie.RootElement;
        var titleOut = root.TryGetProperty("title", out var mt) && mt.ValueKind == JsonValueKind.String
            ? mt.GetString() ?? query : query;
        var url = root.TryGetProperty("url", out var uEl) && uEl.ValueKind == JsonValueKind.String
            ? uEl.GetString() ?? "" : "";
        var poster = root.TryGetProperty("poster", out var pEl) && pEl.ValueKind == JsonValueKind.String
            ? pEl.GetString() ?? "" : "";

        return new CsfdMeta(
            bestId,
            TextNorm.Clean(titleOut, 200),
            root.TryGetProperty("year", out var ry) && ry.TryGetInt32(out var ryy) ? ryy : null,
            CleanUrl(poster),
            root.TryGetProperty("rating", out var rEl) && rEl.ValueKind == JsonValueKind.Number
                && rEl.TryGetDouble(out var rating) ? Math.Round(rating, 1) : null,
            root.TryGetProperty("ratingCount", out var rcEl) && rcEl.TryGetInt32(out var rc) ? rc : null,
            ReadGenres(root),
            CleanUrl(url));
    }

    // genres je v odpovědi buď pole stringů, nebo pole objektů { id, title } - záleží na verzi.
    private static string[] ReadGenres(JsonElement root)
    {
        if (!root.TryGetProperty("genres", out var g) || g.ValueKind != JsonValueKind.Array) return Array.Empty<string>();
        var list = new List<string>();
        foreach (var item in g.EnumerateArray())
        {
            var name = item.ValueKind switch
            {
                JsonValueKind.String => item.GetString(),
                JsonValueKind.Object when item.TryGetProperty("title", out var t) && t.ValueKind == JsonValueKind.String => t.GetString(),
                _ => null,
            };
            if (!string.IsNullOrWhiteSpace(name) && list.Count < 6 && !list.Contains(name)) list.Add(TextNorm.Clean(name, 40));
        }
        return list.ToArray();
    }

    // Odkazy z cizí služby pustíme do prohlížeče jen jako http(s) - nic jiného (javascript:, data:).
    private static string CleanUrl(string? url)
    {
        var u = (url ?? "").Trim();
        return u.StartsWith("http://", StringComparison.OrdinalIgnoreCase)
            || u.StartsWith("https://", StringComparison.OrdinalIgnoreCase) ? u : "";
    }

    private async Task<JsonDocument?> GetJsonAsync(string url, CancellationToken ct)
    {
        using var req = new HttpRequestMessage(HttpMethod.Get, url);
        req.Headers.Accept.Clear();
        req.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
        if (_apiKey != null) req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", _apiKey);

        using var res = await _http.SendAsync(req, HttpCompletionOption.ResponseHeadersRead, ct);
        if (!res.IsSuccessStatusCode) return null;
        await using var stream = await res.Content.ReadAsStreamAsync(ct);
        return await JsonDocument.ParseAsync(stream, cancellationToken: ct);
    }
}
