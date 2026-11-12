using System.Text;

namespace Wflix.Meta;

// Kanály z iptv-org mají tvg-logo jen někdy. Když chybí, zkusíme logo z datové sady
// tv-logo/tv-logos (stejné názvy souborů používá většina IPTV playlistů).
// Odvození je jen odhad - když soubor neexistuje, prohlížeč obrázek zahodí a dlaždice
// zůstane s iniciálami, takže chybějící logo nic nerozbije.
internal static class TvLogos
{
    private const string BaseUrl = "https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/";

    private static readonly Dictionary<string, string> CountryDirs = new(StringComparer.OrdinalIgnoreCase)
    {
        ["cz"] = "czech-republic",
        ["sk"] = "slovakia",
        ["us"] = "united-states",
        ["uk"] = "united-kingdom",
        ["de"] = "germany",
        ["at"] = "austria",
        ["pl"] = "poland",
        ["hu"] = "hungary",
        ["ro"] = "romania",
        ["si"] = "slovenia",
        ["hr"] = "croatia",
        ["fr"] = "france",
        ["es"] = "spain",
        ["it"] = "italy",
    };

    public static string Fallback(string? tvgId, string? country)
    {
        var cc = (country ?? "").Trim().ToLowerInvariant();
        var id = TextNorm.StripVariant(tvgId).Trim();
        if (id.Length == 0) return "";

        // "CT1.cz" -> kód země je v id, zbytek je název kanálu
        var dot = id.LastIndexOf('.');
        if (dot > 0 && dot == id.Length - 3)
        {
            var suffix = id[(dot + 1)..].ToLowerInvariant();
            if (cc.Length == 0) cc = suffix;
            id = id[..dot];
        }

        if (!CountryDirs.TryGetValue(cc, out var directory)) return "";
        var slug = Slug(id);
        if (slug.Length == 0) return "";
        return BaseUrl + directory + "/" + slug + "-" + cc + ".png";
    }

    // "BarrandovKrimi" -> "barrandov-krimi"; "CT1" -> "ct1".
    private static string Slug(string raw)
    {
        var sb = new StringBuilder(raw.Length + 4);
        for (var i = 0; i < raw.Length; i++)
        {
            var ch = raw[i];
            if (!char.IsLetterOrDigit(ch))
            {
                if (sb.Length > 0 && sb[^1] != '-') sb.Append('-');
                continue;
            }

            if (char.IsUpper(ch) && i > 0)
            {
                var previous = raw[i - 1];
                var nextIsLower = i + 1 < raw.Length && char.IsLower(raw[i + 1]);
                if (char.IsLower(previous) || char.IsDigit(previous) || (char.IsUpper(previous) && nextIsLower))
                    if (sb.Length > 0 && sb[^1] != '-') sb.Append('-');
            }

            sb.Append(char.ToLowerInvariant(ch));
        }
        return sb.ToString().Trim('-');
    }
}
