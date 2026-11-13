using System.Collections.Concurrent;
using System.Globalization;
using System.IO.Compression;
using System.Text;
using System.Text.RegularExpressions;
using System.Xml;

namespace Wflix.Meta;

public sealed record EpgProgramme(string Title, string Description, DateTimeOffset Start, DateTimeOffset Stop);

public sealed record EpgEntry(string Id, string Name, EpgProgramme? Now, EpgProgramme? Next);

public sealed record EpgChannel(string Id, string Name, List<EpgProgramme> Programmes);

public sealed class EpgSnapshot
{
    public DateTimeOffset Loaded { get; init; }
    public Dictionary<string, EpgChannel> Channels { get; } = new(StringComparer.Ordinal);
    public Dictionary<string, string> NameKeys { get; } = new(StringComparer.Ordinal);

    // Slovník všech variant, kterými se dá kanál z playlistu trefit: id bez varianty,
    // id bez země ("Prima.Krimi.cz" -> "Prima.Krimi"), název z guide, název bez kvality
    // a země ("ČT1 HD" -> "ČT1") a aliasy z .txt seznamů. Na jednu variantu může sedět
    // víc kanálů guide ("Barrandov" je v CZ i SK guide), takže se drží seznam v pořadí
    // priorit - hledání bere první, který má v daném okně opravdu program.
    public Dictionary<string, List<string>> Index { get; } = new(StringComparer.Ordinal);

    // Aliasy z doprovodných .txt seznamů kanálů (epgshare01 jimi publikuje id, která
    // guide používá): "primakrimi" -> "primakrimicz". Díky tomu se trefí i kanál, který
    // v playlistu nemá tvg-id a jmenuje se jen "Prima Krimi".
    public Dictionary<string, string> Aliases { get; } = new(StringComparer.Ordinal);
    public HashSet<string> Listed { get; } = new(StringComparer.Ordinal);
}

// Programový průvodce pro Živě. Kanály v playlistech nesou tvg-id, který u iptv-org
// vypadá jako "CT1.cz@SD". XMLTV z iptv-org/epg (nebo z libovolného grabberu) má
// channel id "CT1.cz", takže se porovnává id bez varianty a jako druhá možnost
// znormalizovaný název kanálu - tím se trefí i guides, které id pojmenovávají jinak.
//
// Nic se neposílá do prohlížeče předem: /api/live/epg vrátí jen "co běží teď a co bude
// následovat", takže dlaždice kanálů mají co ukázat, aniž by klient tahal XMLTV.
public sealed class EpgService
{
    private readonly IHttpClientFactory _factory;
    private readonly ILogger<EpgService> _log;
    private readonly string[] _urls;
    private readonly TimeSpan _ttl;
    // Šablona guide pro jednu zemi ("https://iptv-epg.org/files/epg-{country}.xml.gz").
    // Prázdná = dotahování podle země je vypnuté.
    private readonly string _countryTemplate;

    private readonly SemaphoreSlim _gate = new(1, 1);
    private EpgSnapshot? _snapshot;
    private DateTimeOffset _loadedAt = DateTimeOffset.MinValue;

    // Guide jednotlivých zemí: drží se jen ty naposledy použité, protože dohromady mají
    // stovky megabajtů a v paměti instance by se nevyplatily.
    private readonly ConcurrentDictionary<string, GuideEntry> _countryGuides = new(StringComparer.OrdinalIgnoreCase);
    private readonly ConcurrentDictionary<string, SemaphoreSlim> _countryLocks = new(StringComparer.OrdinalIgnoreCase);
    private readonly SemaphoreSlim _countrySlots = new(3, 3);
    private const int CountryCacheMax = 4;
    // Země s obřím guide (US má 60 MB gzip) se nepřekládá do paměti - playlist pro ni
    // zůstane bez programu, ale instance nespadne.
    private const long CountryMaxBytes = 24 * 1024 * 1024;

    // iptv-org používá pro Británii "uk", iptv-epg.org (a ISO) "gb"; soubor se jmenuje
    // epg-gb.xml.gz. Ostatní kódy sedí, chybějící země (sk, xk…) vrátí 404 a hodinu
    // se nezkoušejí.
    private static readonly Dictionary<string, string> CountryFileCodes = new(StringComparer.OrdinalIgnoreCase)
    {
        ["uk"] = "gb",
    };

    private sealed record GuideEntry(EpgSnapshot? Snapshot, DateTimeOffset ExpiresAt);

    public bool Enabled => _urls.Length > 0 || _countryTemplate.Length > 0;

    public EpgService(IConfiguration cfg, IHttpClientFactory factory, ILogger<EpgService> log)
    {
        _factory = factory;
        _log = log;
        _urls = (cfg.GetSection("Epg:Urls").Get<string[]>() ?? Array.Empty<string>())
            .Where(u => !string.IsNullOrWhiteSpace(u))
            .Select(u => u.Trim())
            .ToArray();
        _countryTemplate = (cfg.GetValue<string>("Epg:CountryGuideUrl") ?? "").Trim();
        var minutes = cfg.GetValue<int?>("Epg:TtlMinutes") ?? 360;
        _ttl = TimeSpan.FromMinutes(Math.Clamp(minutes, 15, 1440));
    }

    public async Task<EpgSnapshot?> GetAsync(CancellationToken ct)
    {
        if (!Enabled) return null;
        if (_snapshot != null && DateTimeOffset.UtcNow - _loadedAt < _ttl) return _snapshot;

        // Jeden stahuje, ostatní dostanou, co je v paměti. Průvodce má megabajty,
        // takže paralelní stahování od každého požadavku by jen zatížilo zdroj i server.
        if (!await _gate.WaitAsync(TimeSpan.FromSeconds(2), ct)) return _snapshot;
        try
        {
            if (_snapshot != null && DateTimeOffset.UtcNow - _loadedAt < _ttl) return _snapshot;

            var fresh = await LoadAsync(_urls, 64 * 1024 * 1024, ct);
            _loadedAt = DateTimeOffset.UtcNow;
            if (fresh != null) _snapshot = fresh;
            return _snapshot;
        }
        finally
        {
            _gate.Release();
        }
    }

    // Guide pro jednu zemi. Stahuje se až ve chvíli, kdy ho divák opravdu potřebuje -
    // seznam zemí v iptv-epg.org má desítky XMLTV a všechna naráz by znamenala stovky
    // megabajtů v paměti. Neúspěch (země bez guide) se pamatuje hodinu, aby se 404
    // nezkoušela při každém obnovení seznamu kanálů.
    public async Task<EpgSnapshot?> GetCountryAsync(string? country, CancellationToken ct)
    {
        if (_countryTemplate.Length == 0) return null;
        var cc = (country ?? "").Trim().ToLowerInvariant();
        if (!Regex.IsMatch(cc, "^[a-z]{2}$")) return null;
        if (_countryGuides.TryGetValue(cc, out var cached) && cached.ExpiresAt > DateTimeOffset.UtcNow)
            return cached.Snapshot;

        var gate = _countryLocks.GetOrAdd(cc, _ => new SemaphoreSlim(1, 1));
        if (!await gate.WaitAsync(TimeSpan.FromSeconds(20), ct))
            return _countryGuides.TryGetValue(cc, out var stale) ? stale.Snapshot : null;
        try
        {
            if (_countryGuides.TryGetValue(cc, out cached) && cached.ExpiresAt > DateTimeOffset.UtcNow)
                return cached.Snapshot;

            var file = CountryFileCodes.TryGetValue(cc, out var mapped) ? mapped : cc;
            var url = _countryTemplate.Replace("{country}", file);
            // Stejný guide může být i v Epg:Urls (CZ tam je kvůli slovenským kanálům,
            // které se v něm taky hledají) - pak se nestahuje podruhé.
            if (_urls.Any(u => u.Equals(url, StringComparison.OrdinalIgnoreCase))) return _snapshot;

            EpgSnapshot? snapshot = null;
            // Souběžných stahování je nanejvýš pár, aby jeden velký guide nezabral
            // všechny prostředky instance.
            if (await _countrySlots.WaitAsync(TimeSpan.FromSeconds(20), ct))
            {
                try
                {
                    snapshot = await LoadAsync(new[] { url }, CountryMaxBytes, ct);
                }
                finally
                {
                    _countrySlots.Release();
                }
            }
            if (snapshot == null) _log.LogDebug("EPG pro zemi {Country} není k dispozici ({Url})", cc, url);

            _countryGuides[cc] = new GuideEntry(snapshot, DateTimeOffset.UtcNow.Add(snapshot == null ? TimeSpan.FromMinutes(60) : _ttl));
            TrimCountryGuides(cc);
            return snapshot;
        }
        finally
        {
            gate.Release();
        }
    }

    // Nechá v paměti jen pár zemí: tu, kterou právě řešíme, a ty s nejdelší platností.
    // Velký guide ( Německo, Británie) se tak po chvíli uvolní sám.
    private void TrimCountryGuides(string keep)
    {
        if (_countryGuides.Count <= CountryCacheMax) return;
        foreach (var pair in _countryGuides
                     .Where(p => !p.Key.Equals(keep, StringComparison.OrdinalIgnoreCase))
                     .OrderBy(p => p.Value.ExpiresAt)
                     .Take(_countryGuides.Count - CountryCacheMax))
            _countryGuides.TryRemove(pair.Key, out _);
    }

    // Kanál z guide, který odpovídá kanálu z playlistu. Zkouší se varianty popořadě:
    // tvg-id bez varianty (@SD), bez země (CT1.cz -> CT1), pak název a název bez
    // kvality/země (ČT1 HD -> ČT1). Aliasy z .txt seznamů jsou ve stejném slovníku,
    // takže se trefí i kanál, který v playlistu nemá tvg-id.
    public static EpgChannel? FindChannel(EpgSnapshot? snapshot, string? tvgId, string? name,
        DateTimeOffset? from = null, DateTimeOffset? to = null)
    {
        if (snapshot == null) return null;
        foreach (var key in ChannelKeys(tvgId, name))
        {
            if (key.Length < 2) continue;
            if (!snapshot.Index.TryGetValue(key, out var candidates)) continue;
            foreach (var channelKey in candidates)
            {
                if (!snapshot.Channels.TryGetValue(channelKey, out var channel)) continue;
                // Guide někdy zná kanál, ale nemá k němu program (prázdná položka <channel>
                // nebo data jen z minulých dní). Taková shoda se přeskočí a zkusí se další -
                // jinak by kanál zůstal bez programu, i když guide má stejný kanál s daty.
                if (from is { } f && to is { } t && Programmes(channel, f, t).Count == 0) continue;
                return channel;
            }
        }
        return null;
    }

    private static void AddIndex(EpgSnapshot snapshot, string variant, string channelKey)
    {
        if (!snapshot.Index.TryGetValue(variant, out var list))
            snapshot.Index[variant] = list = new List<string>(1);
        if (!list.Contains(channelKey)) list.Add(channelKey);
    }

    // Program, který běží v danou chvíli, a ten následující. Null = pro kanál nic nevíme.
    public static EpgEntry? Match(EpgSnapshot? snapshot, string? tvgId, string? name, DateTimeOffset at)
    {
        var channel = FindChannel(snapshot, tvgId, name);
        if (channel == null) return null;

        EpgProgramme? current = null, next = null;
        foreach (var p in channel.Programmes)
        {
            if (p.Start <= at && at < p.Stop) current = p;
            else if (p.Start > at && (next == null || p.Start < next.Start)) next = p;
        }
        return current == null && next == null ? null : new EpgEntry(channel.Id, channel.Name, current, next);
    }

    public static IReadOnlyList<EpgEntry> Entries(EpgSnapshot? snapshot, DateTimeOffset at)
    {
        if (snapshot == null) return Array.Empty<EpgEntry>();
        var list = new List<EpgEntry>(snapshot.Channels.Count);
        foreach (var ch in snapshot.Channels.Values)
        {
            EpgProgramme? current = null, next = null;
            foreach (var p in ch.Programmes)
            {
                if (p.Start <= at && at < p.Stop) current = p;
                else if (p.Start > at && (next == null || p.Start < next.Start)) next = p;
            }
            if (current != null || next != null) list.Add(new EpgEntry(ch.Id, ch.Name, current, next));
        }
        // Nejdřív kanály, které právě něco vysílají - frontend je stejně filtruje podle sebe.
        return list.OrderByDescending(e => e.Now != null).ToList();
    }

    // Programy, které zasahují do zadaného okna - pro časovou osu se posílá celý den.
    public static IReadOnlyList<EpgProgramme> Programmes(EpgChannel channel, DateTimeOffset from, DateTimeOffset to)
    {
        var list = new List<EpgProgramme>();
        foreach (var p in channel.Programmes)
            if (p.Stop > from && p.Start < to) list.Add(p);
        return list;
    }

    // Varianty klíčů kanálu z playlistu, od nejpřesnější. Id je spolehlivější než název.
    private static IEnumerable<string> ChannelKeys(string? tvgId, string? name) =>
        IdKeys(tvgId).Concat(NameVariants(name));

    private static IEnumerable<string> IdKeys(string? tvgId)
    {
        var id = TextNorm.StripVariant(tvgId);
        foreach (var variant in Variants(id)) yield return variant;
        foreach (var variant in Variants(WithoutCountrySuffix(id))) yield return variant;
    }

    private static IEnumerable<string> NameVariants(string? name) => Variants(name);

    // Klíč názvu a jeho čištěné podoby: bez závorek ("(HD)") a bez slov, která nenesou
    // identitu (kvalita, země, "TV"). Playlist píše "ČT1 HD", guide "ČT1" - tím se potkají.
    private static IEnumerable<string> Variants(string? value)
    {
        var text = (value ?? "").Trim();
        if (text.Length == 0) yield break;

        var seen = new HashSet<string>(StringComparer.Ordinal);
        foreach (var candidate in new[]
                 {
                     text,
                     WithoutBrackets(text),
                     WithoutNoise(text),
                     WithoutNoise(WithoutBrackets(text)),
                 })
        {
            var key = TextNorm.Key(candidate);
            if (key.Length > 1 && seen.Add(key)) yield return key;
        }
    }

    // Slova, která kanál nerozlišují: kvalita, země a označení feedu se v názvu z playlistu
    // i z guide objevují nahodile, takže se při porovnání zahazují. Playlist píše
    // "AXN CEE Czech Republic", guide "AXN" - bez těch slov se klíče potkají.
    private static readonly HashSet<string> NoiseWords = new(StringComparer.Ordinal)
    {
        "hd", "sd", "fhd", "uhd", "fullhd", "4k", "8k", "hq", "hdr", "h265", "hevc",
        "cz", "sk", "czech", "slovak", "czechia", "slovakia", "cesko", "slovensko", "ceska", "cesky",
        "republic", "republika", "ceskarepublika", "europe", "evropa", "central",
        "cee", "international", "balkan", "nordic", "feed", "plus",
        "tv", "televize",
    };

    private static string WithoutBrackets(string value)
    {
        var sb = new StringBuilder(value.Length);
        var depth = 0;
        foreach (var ch in value)
        {
            if (ch is '(' or '[') { depth++; continue; }
            if (ch is ')' or ']') { if (depth > 0) depth--; continue; }
            if (depth == 0) sb.Append(ch);
        }
        return sb.ToString();
    }

    private static string WithoutNoise(string value)
    {
        var sb = new StringBuilder(value.Length);
        var token = new StringBuilder();
        foreach (var ch in value + " ")
        {
            if (char.IsLetterOrDigit(ch)) { token.Append(ch); continue; }
            if (token.Length == 0) continue;
            var word = token.ToString();
            if (!NoiseWords.Contains(TextNorm.Key(word))) sb.Append(word).Append(' ');
            token.Clear();
        }
        return sb.ToString();
    }

    private async Task<EpgSnapshot?> LoadAsync(IReadOnlyList<string> urls, long maxBytes, CancellationToken ct)
    {
        var snapshot = new EpgSnapshot { Loaded = DateTimeOffset.UtcNow };
        // Časová osa v prohlížeči začíná o půlnoci místního času, takže se drží i program,
        // který už skončil - jinak by dopoledne byla levá část osy prázdná. Starší než
        // 14 hodin se zahazuje, aby průvodce nedržel v paměti celý den zpětně.
        var cutoff = DateTimeOffset.UtcNow.AddHours(-14);
        var client = _factory.CreateClient("meta");
        var failures = new List<string>();

        foreach (var url in urls)
        {
            if (!Uri.TryCreate(url, UriKind.Absolute, out var uri)
                || (uri.Scheme != Uri.UriSchemeHttp && uri.Scheme != Uri.UriSchemeHttps))
                continue;

            try
            {
                using var req = new HttpRequestMessage(HttpMethod.Get, uri);
                using var res = await client.SendAsync(req, HttpCompletionOption.ResponseHeadersRead, ct);
                if (!res.IsSuccessStatusCode)
                {
                    failures.Add($"{uri.Host}: HTTP {(int)res.StatusCode}");
                    continue;
                }

                var bytes = await res.Content.ReadAsByteArrayAsync(ct);
                // Průvodce pro jednu zemi má jednotky MB (gzip) až desítky MB po rozbalení.
                // Strop je tam proto, aby špatně nastavená URL (nebo omylem binární soubor)
                // nesežrala paměť instance.
                if (bytes.Length == 0 || bytes.Length > maxBytes)
                {
                    failures.Add($"{uri.Host}: {bytes.Length / (1024 * 1024)} MB je nad limit");
                    continue;
                }

                // epgshare01 publikuje ke každému guidu i .txt se seznamem id kanálů -
                // podle prvního znaku poznáme, jestli jde o XMLTV, nebo o ten seznam.
                var isGzip = bytes.Length > 1 && bytes[0] == 0x1f && bytes[1] == 0x8b;
                if (await LooksLikeXmlAsync(bytes, isGzip, ct))
                {
                    Stream stream = new MemoryStream(bytes, writable: false);
                    if (isGzip) stream = new GZipStream(stream, CompressionMode.Decompress);
                    await using (stream)
                        await ParseAsync(stream, snapshot, cutoff, ct);
                }
                else
                {
                    ParseChannelList(DecodeText(bytes, isGzip), snapshot);
                }
            }
            catch (OperationCanceledException) when (ct.IsCancellationRequested)
            {
                throw;
            }
            catch (Exception ex)
            {
                failures.Add($"{uri.Host}: {ex.GetType().Name}");
                _log.LogDebug(ex, "EPG {Url} se nepodařilo načíst", url);
            }
        }

        foreach (var channel in snapshot.Channels.Values)
            channel.Programmes.Sort((a, b) => a.Start.CompareTo(b.Start));

        foreach (var id in snapshot.Listed)
        {
            var full = TextNorm.Key(TextNorm.StripVariant(id));
            if (full.Length < 3 || !snapshot.Channels.ContainsKey(full)) continue;
            var bare = TextNorm.Key(WithoutCountrySuffix(id));
            if (bare.Length > 2 && !snapshot.Channels.ContainsKey(bare) && !snapshot.Aliases.ContainsKey(bare))
                snapshot.Aliases[bare] = full;
        }

        // Jméno kanálu z guides je pro porovnání spolehlivější než id: playlisty píšou
        // "ČT1", guide "ČT 1" - normalizace z toho udělá stejný klíč.
        foreach (var pair in snapshot.Channels)
        {
            var nameKey = TextNorm.Key(pair.Value.Name);
            if (nameKey.Length > 1) snapshot.NameKeys[nameKey] = pair.Key;
        }

        // Slovník variant pro párování playlistu s guide. TryAdd drží priority: přesná id
        // jsou první, pak názvy a nakonec aliasy z .txt, takže volnější varianta
        // nepřepíše přesnější shodu.
        foreach (var pair in snapshot.Channels)
            foreach (var variant in IdKeys(pair.Value.Id))
                AddIndex(snapshot, variant, pair.Key);
        foreach (var pair in snapshot.Channels)
            foreach (var variant in NameVariants(pair.Value.Name))
                AddIndex(snapshot, variant, pair.Key);
        foreach (var pair in snapshot.Aliases)
            if (snapshot.Channels.ContainsKey(pair.Value))
                AddIndex(snapshot, pair.Key, pair.Value);

        if (failures.Count > 0)
            _log.LogWarning("EPG: část zdrojů selhala ({Failures})", string.Join(", ", failures));

        return snapshot.Channels.Count > 0 ? snapshot : null;
    }

    private static async Task ParseAsync(Stream xml, EpgSnapshot snapshot, DateTimeOffset cutoff, CancellationToken ct)
    {
        var horizon = DateTimeOffset.UtcNow.AddHours(72);
        var settings = new XmlReaderSettings
        {
            Async = true,
            DtdProcessing = DtdProcessing.Ignore,
            XmlResolver = null,
            IgnoreComments = true,
            IgnoreProcessingInstructions = true,
            CloseInput = false,
        };

        using var reader = XmlReader.Create(xml, settings);
        while (await reader.ReadAsync().ConfigureAwait(false))
        {
            ct.ThrowIfCancellationRequested();
            if (reader.NodeType != XmlNodeType.Element) continue;

            if (reader.Name == "channel")
            {
                var id = reader.GetAttribute("id") ?? "";
                var name = "";
                using (var sub = reader.ReadSubtree())
                {
                    while (await sub.ReadAsync().ConfigureAwait(false))
                    {
                        if (sub.NodeType == XmlNodeType.Element && sub.Name == "display-name" && name.Length == 0)
                            name = await sub.ReadElementContentAsStringAsync().ConfigureAwait(false);
                    }
                }

                var key = TextNorm.Key(TextNorm.StripVariant(id));
                if (key.Length > 0 && !snapshot.Channels.ContainsKey(key))
                    snapshot.Channels[key] = new EpgChannel(id, TextNorm.Clean(name, 120), new List<EpgProgramme>());
                continue;
            }

            if (reader.Name != "programme") continue;

            var channelRaw = reader.GetAttribute("channel") ?? "";
            var start = ParseXmltvTime(reader.GetAttribute("start"));
            var stop = ParseXmltvTime(reader.GetAttribute("stop"));
            var title = "";
            var description = "";

            using (var sub = reader.ReadSubtree())
            {
                while (await sub.ReadAsync().ConfigureAwait(false))
                {
                    if (sub.NodeType != XmlNodeType.Element) continue;
                    if (sub.Name == "title" && title.Length == 0)
                        title = await sub.ReadElementContentAsStringAsync().ConfigureAwait(false);
                    else if (sub.Name == "desc" && description.Length == 0)
                        description = await sub.ReadElementContentAsStringAsync().ConfigureAwait(false);
                }
            }

            if (string.IsNullOrWhiteSpace(title) || start == null || stop == null) continue;
            // Držíme jen okno, které se dá zobrazit: dnešní den a kousek zítřka. Guide
            // některých zemí obsahuje týden dopředu a v paměti by to bylo zbytečné.
            if (stop <= start || stop < cutoff || start > horizon) continue;

            var channelKey = TextNorm.Key(TextNorm.StripVariant(channelRaw));
            if (channelKey.Length == 0) continue;
            if (!snapshot.Channels.TryGetValue(channelKey, out var channel))
            {
                channel = new EpgChannel(channelRaw, "", new List<EpgProgramme>());
                snapshot.Channels[channelKey] = channel;
            }

            // Na kanál držíme jeden den programu (max 60 pořadů) - to je přesně to, co
            // se vejde na časovou osu, a víc by jen zbytečně sedělo v paměti.
            if (channel.Programmes.Count >= 60) continue;
            channel.Programmes.Add(new EpgProgramme(
                TextNorm.Clean(title, 160),
                TextNorm.Clean(description, 220),
                start.Value,
                stop.Value));
        }
    }

    // První smysluplný znak rozhodne: '<' = XMLTV, cokoli jiného = seznam id po řádcích.
    // GZip se kvůli tomu rozbaluje dvakrát, ale jen kousek - GZipStream přečte hlavičku
    // a první blok, ne celý guide.
    private static async Task<bool> LooksLikeXmlAsync(byte[] bytes, bool isGzip, CancellationToken ct)
    {
        Stream stream = new MemoryStream(bytes, writable: false);
        if (isGzip) stream = new GZipStream(stream, CompressionMode.Decompress);
        await using (stream)
        {
            var buffer = new byte[512];
            var read = await stream.ReadAsync(buffer.AsMemory(0, buffer.Length), ct);
            var start = read >= 3 && buffer[0] == 0xEF && buffer[1] == 0xBB && buffer[2] == 0xBF ? 3 : 0;
            for (var i = start; i < read; i++)
            {
                if (buffer[i] is (byte)' ' or (byte)'\t' or (byte)'\r' or (byte)'\n') continue;
                return buffer[i] == (byte)'<';
            }
        }
        return false;
    }

    private static string DecodeText(byte[] bytes, bool isGzip)
    {
        if (!isGzip) return Encoding.UTF8.GetString(bytes).TrimStart('\uFEFF');
        using var raw = new MemoryStream(bytes, writable: false);
        using var gz = new GZipStream(raw, CompressionMode.Decompress);
        using var text = new StreamReader(gz, Encoding.UTF8);
        return text.ReadToEnd().TrimStart('\uFEFF');
    }

    // Seznam id kanálů z epgshare01 .txt: první řádek je časová značka, pak id po
    // jednom na řádek. Programy v něm nejsou - slouží jen jako slovník id.
    private static void ParseChannelList(string text, EpgSnapshot snapshot)
    {
        foreach (var raw in text.Split('\n'))
        {
            var line = raw.Trim();
            if (line.Length < 3 || line[0] == '#' || line.StartsWith("--", StringComparison.Ordinal)) continue;
            if (line.Contains(' ')) continue;                       // poznámky a hlavičky
            if (line.All(char.IsDigit)) continue;                    // "202611121139"
            snapshot.Listed.Add(line);
        }
    }

    // "Prima.Krimi.cz" -> "Prima.Krimi"
    private static string WithoutCountrySuffix(string id)
    {
        var value = (id ?? "").Trim();
        var dot = value.LastIndexOf('.');
        return dot > 0 && dot == value.Length - 3 ? value[..dot] : value;
    }

    // XMLTV čas: "20261112193000 +0100" nebo bez zóny. Ručně, protože DateTimeOffset.Parse
    // s tímhle formátem nemá deterministicé chování napříč kulturami.
    private static DateTimeOffset? ParseXmltvTime(string? raw)
    {
        var s = (raw ?? "").Trim();
        if (s.Length < 14) return null;
        if (!int.TryParse(s.AsSpan(0, 4), NumberStyles.None, CultureInfo.InvariantCulture, out var year)) return null;
        if (!int.TryParse(s.AsSpan(4, 2), NumberStyles.None, CultureInfo.InvariantCulture, out var month)) return null;
        if (!int.TryParse(s.AsSpan(6, 2), NumberStyles.None, CultureInfo.InvariantCulture, out var day)) return null;
        if (!int.TryParse(s.AsSpan(8, 2), NumberStyles.None, CultureInfo.InvariantCulture, out var hour)) return null;
        if (!int.TryParse(s.AsSpan(10, 2), NumberStyles.None, CultureInfo.InvariantCulture, out var minute)) return null;
        if (!int.TryParse(s.AsSpan(12, 2), NumberStyles.None, CultureInfo.InvariantCulture, out var second)) return null;
        if (year < 1990 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) return null;
        if (hour > 23 || minute > 59 || second > 59) return null;

        var offset = TimeSpan.Zero;
        var rest = s.Length > 14 ? s[14..].Trim() : "";
        if (rest.Length >= 5 && (rest[0] == '+' || rest[0] == '-')
            && int.TryParse(rest.AsSpan(1, 2), NumberStyles.None, CultureInfo.InvariantCulture, out var offHours)
            && int.TryParse(rest.AsSpan(3, 2), NumberStyles.None, CultureInfo.InvariantCulture, out var offMinutes))
        {
            offset = new TimeSpan(offHours, offMinutes, 0);
            if (rest[0] == '-') offset = -offset;
        }

        try
        {
            return new DateTimeOffset(year, month, day, hour, minute, second, offset);
        }
        catch (ArgumentOutOfRangeException)
        {
            return null;
        }
    }
}
