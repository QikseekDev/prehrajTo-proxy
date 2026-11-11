using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;

namespace Wflix.Admin;

// ---------------------------------------------------------------------------
// Proxy servery za běhu. Panel je může přidat/ubrat/vypnout a změna platí
// okamžitě - seznam z appsettings.json (Prehraj:ProxyUrls) je jen výchozí stav,
// dokud panel proxy nezačne řídit (state.Proxies == null).
// ---------------------------------------------------------------------------

public sealed class ProxyPool
{
    private readonly AdminStore store;
    private readonly string[] configured;

    public ProxyPool(AdminStore store, string[] configured)
    {
        this.store = store;
        this.configured = configured.Where(IsValidUrl).Distinct(StringComparer.OrdinalIgnoreCase).ToArray();
    }

    /// <summary>Seznam z konfigurace (appsettings / Prehraj__ProxyUrls).</summary>
    public string[] Configured => configured;

    /// <summary>Jestli proxy řídí panel (ve stavu je uložený seznam).</summary>
    public bool Managed => store.Current.Proxies != null;

    /// <summary>Co se má skutečně použít: zapnuté proxy z panelu, jinak konfigurace.</summary>
    public string[] Current
    {
        get
        {
            var managed = store.Current.Proxies;
            if (managed == null) return configured;
            return managed.Where(p => p.Enabled).Select(p => p.Url).ToArray();
        }
    }

    /// <summary>Všechny položky včetně vypnutých - pro panel (první načtení předvyplní konfiguraci).</summary>
    public ProxyEntry[] Items => store.Current.Proxies?.ToArray()
        ?? configured.Select(u => new ProxyEntry { Url = u }).ToArray();

    public static bool IsValidUrl(string? url)
    {
        if (string.IsNullOrWhiteSpace(url)) return false;
        url = url.Trim();
        if (url.Length > 200) return false;
        if (!Uri.TryCreate(url, UriKind.Absolute, out var uri)) return false;
        if (uri.Scheme != Uri.UriSchemeHttp && uri.Scheme != Uri.UriSchemeHttps) return false;
        if (string.IsNullOrEmpty(uri.Host)) return false;
        if (!string.IsNullOrEmpty(uri.UserInfo)) return false;
        return true;
    }

    /// <summary>Obsah proxy-servers.txt - stejný formát, jaký čte scripts/change-proxy-servers.sh.</summary>
    public static string FileText(IEnumerable<string> urls) =>
        "# Seznam PHP proxy serverů (jeden na řádek). Prázdné řádky a řádky začínající\n"
        + "# \"#\" se ignorují. Uprav tenhle soubor a spusť scripts/change-proxy-servers.sh -\n"
        + "# promítne se to do script.js, appsettings.json i router.php najednou.\n"
        + string.Join("\n", urls.Select(u => u.Trim())) + "\n";
}

// ---------------------------------------------------------------------------
// Commit proxy-servers.txt do GitHubu. Volitelné: bez tokenu panel jen nabídne
// stažení souboru a napíše, co nastavit. Token se nikdy neloguje.
// ---------------------------------------------------------------------------

public sealed record ProxyCommitResult(
    bool Ok,
    bool Skipped,
    string? Sha,
    string? Url,
    string? Error,
    string? Hint);

public sealed class ProxyCommitSettings
{
    public string? Token { get; init; }
    public string Repo { get; init; } = "QikseekDev/prehrajTo-proxy";
    public string Branch { get; init; } = "main";
    public string Path { get; init; } = "proxy-servers.txt";

    public bool Configured => !string.IsNullOrWhiteSpace(Token);

    public static ProxyCommitSettings From(IConfiguration cfg)
    {
        static string? FirstNonEmpty(params string?[] v) =>
            v.Select(x => x?.Trim()).FirstOrDefault(x => !string.IsNullOrEmpty(x));

        return new ProxyCommitSettings
        {
            Token = FirstNonEmpty(
                Environment.GetEnvironmentVariable("WFLIX_GITHUB_TOKEN"),
                Environment.GetEnvironmentVariable("GITHUB_TOKEN"),
                cfg["Admin:GitHubToken"]),
            Repo = FirstNonEmpty(Environment.GetEnvironmentVariable("WFLIX_GITHUB_REPO"), cfg["Admin:GitHubRepo"]) ?? "QikseekDev/prehrajTo-proxy",
            Branch = FirstNonEmpty(Environment.GetEnvironmentVariable("WFLIX_GITHUB_BRANCH"), cfg["Admin:GitHubBranch"]) ?? "main",
        };
    }
}

public static class ProxyCommit
{
    private static readonly JsonSerializerOptions Json = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };

    public static async Task<ProxyCommitResult> CommitAsync(
        IHttpClientFactory factory,
        ProxyCommitSettings settings,
        IReadOnlyList<string> urls,
        string actor,
        CancellationToken ct)
    {
        if (!settings.Configured)
            return new ProxyCommitResult(false, true, null, null, null,
                "Automatický commit není nastavený. Přidej proměnnou WFLIX_GITHUB_TOKEN (GitHub → Settings → "
                + "Developer settings → Personal access tokens, právo Contents: read & write) a proxy se budou "
                + "commitovat samy. Zatím můžeš soubor stáhnout a nahrát ručně.");

        var client = factory.CreateClient("prehraj");
        var api = $"https://api.github.com/repos/{settings.Repo}/contents/{settings.Path}";

        try
        {
            // Nejdřív sha současné verze - bez ní GitHub update odmítne (a s ní pozná konflikt).
            string? sha = null;
            var problems = new List<string>();
            using (var get = new HttpRequestMessage(HttpMethod.Get, api + "?ref=" + Uri.EscapeDataString(settings.Branch)))
            {
                get.Headers.Authorization = new AuthenticationHeaderValue("Bearer", settings.Token);
                get.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/vnd.github+json"));
                get.Headers.UserAgent.Add(new ProductInfoHeaderValue("Wflix-Admin", "2"));
                using var res = await client.SendAsync(get, ct);
                var body = await res.Content.ReadAsStringAsync(ct);
                if (res.IsSuccessStatusCode)
                {
                    using var doc = JsonDocument.Parse(body);
                    if (doc.RootElement.TryGetProperty("sha", out var s)) sha = s.GetString();
                }
                else if ((int)res.StatusCode != 404)
                {
                    problems.Add($"GET {(int)res.StatusCode}: {Trim(body)}");
                }
            }

            if (problems.Count > 0)
                return new ProxyCommitResult(false, false, null, null, problems[0],
                    "Zkontroluj, že token má právo Contents: read & write a že repo/branch sedí.");

            var content = Convert.ToBase64String(Encoding.UTF8.GetBytes(ProxyPool.FileText(urls)));
            var payload = new Dictionary<string, object?>
            {
                ["message"] = $"Proxy servery: úprava z admin panelu ({urls.Count} položek)",
                ["content"] = content,
                ["branch"] = settings.Branch,
            };
            if (!string.IsNullOrEmpty(sha)) payload["sha"] = sha;

            using var put = new HttpRequestMessage(HttpMethod.Put, api)
            {
                Content = new StringContent(JsonSerializer.Serialize(payload, Json), Encoding.UTF8, "application/json"),
            };
            put.Headers.Authorization = new AuthenticationHeaderValue("Bearer", settings.Token);
            put.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/vnd.github+json"));
            put.Headers.UserAgent.Add(new ProductInfoHeaderValue("Wflix-Admin", "2"));

            using var putRes = await client.SendAsync(put, ct);
            var putBody = await putRes.Content.ReadAsStringAsync(ct);
            if (!putRes.IsSuccessStatusCode)
                return new ProxyCommitResult(false, false, null, null, $"PUT {(int)putRes.StatusCode}: {Trim(putBody)}",
                    "Když je to 409, někdo mezitím soubor změnil - ulož znovu.");

            using var putDoc = JsonDocument.Parse(putBody);
            var commitSha = putDoc.RootElement.TryGetProperty("commit", out var c) && c.TryGetProperty("sha", out var cs)
                ? cs.GetString()
                : null;
            var htmlUrl = putDoc.RootElement.TryGetProperty("commit", out var c2) && c2.TryGetProperty("html_url", out var hu)
                ? hu.GetString()
                : null;
            return new ProxyCommitResult(true, false, commitSha, htmlUrl, null, null);
        }
        catch (Exception ex)
        {
            return new ProxyCommitResult(false, false, null, null, ex.GetType().Name + ": " + ex.Message, null);
        }
    }

    private static string Trim(string s) => s.Length > 200 ? s[..200] : s;
}
