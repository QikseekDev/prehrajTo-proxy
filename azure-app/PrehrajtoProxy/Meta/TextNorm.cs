using System.Globalization;
using System.Text;

namespace Wflix.Meta;

// Jedno pravidlo pro porovnávání názvů na obou stranách (server i prohlížeč):
// bez diakritiky, malá písmena, jen ASCII písmena a číslice. Když se klíč počítá
// stejně pro kanál z playlistu i pro program z EPG, stačí se trefit jménem.
// Prohlížeč má stejnou funkci v script.js (epgKey), testy hlídají, že se nerozejdou.
internal static class TextNorm
{
    public static string Key(string? value)
    {
        if (string.IsNullOrWhiteSpace(value)) return "";
        var decomposed = value.Normalize(NormalizationForm.FormD);
        var sb = new StringBuilder(decomposed.Length);
        foreach (var ch in decomposed)
        {
            if (CharUnicodeInfo.GetUnicodeCategory(ch) == UnicodeCategory.NonSpacingMark) continue;
            if (ch >= 128 || !char.IsLetterOrDigit(ch)) continue;
            sb.Append(char.ToLowerInvariant(ch));
        }
        return sb.ToString();
    }

    // "CT1.cz@SD" -> "CT1.cz": varianta kanálu (SD/HD) není součástí identity.
    public static string StripVariant(string? channelId)
    {
        var id = (channelId ?? "").Trim();
        var at = id.IndexOf('@');
        return at > 0 ? id[..at] : id;
    }

    // Text z cizího zdroje: bez řídicích znaků, zkrácený, ať se dá bezpečně poslat do JSONu.
    public static string Clean(string? value, int max = 400)
    {
        if (string.IsNullOrWhiteSpace(value)) return "";
        var sb = new StringBuilder(Math.Min(value.Length, max));
        foreach (var ch in value.Trim())
        {
            if (char.IsControl(ch)) { if (ch == '\n' || ch == '\t') sb.Append(' '); continue; }
            sb.Append(ch);
            if (sb.Length >= max) break;
        }
        return sb.ToString().Trim();
    }
}
