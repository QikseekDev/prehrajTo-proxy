namespace Wflix.Meta;

// Pořadí kanálů pro zemi, kterou LivePopularity nezná. Měřená sledovanost po zemích
// zdarma k dispozici není, takže se rankuje z toho, co o kanálu víme: má program
// v EPG guide dané země (skutečný vysílatel má rozvrh), jaká je to skupina
// (General/News výš než Music/Shop), kvalita streamu a kolik má záložních adres.
// Je to odhad "hlavní kanály v zemi", ne změřená popularita.
public static class LiveAutoRank
{
    // Skupiny z group-title playlistu. General a News jsou to, co v zemi hraje
    // v každé domácnosti; hudba, náboženství a shop jsou na opačném konci.
    private static readonly Dictionary<string, int> GroupWeight = new(StringComparer.Ordinal)
    {
        ["general"] = 20,
        ["news"] = 18,
        ["sports"] = 12,
        ["entertainment"] = 10,
        ["movies"] = 10,
        ["series"] = 10,
        ["kids"] = 8,
        ["documentary"] = 8,
        ["culture"] = 6,
        ["lifestyle"] = 6,
        ["comedy"] = 6,
        ["animation"] = 6,
        ["music"] = 2,
        ["religious"] = 2,
        ["shop"] = 2,
    };

    public static int Score(string? group, string? quality, int alts, string? logo, int programmes)
    {
        var g = 5;
        foreach (var part in (group ?? "").Split(';', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
            if (GroupWeight.TryGetValue(part.ToLowerInvariant(), out var w) && w > g) g = w;

        var q = (quality ?? "").ToLowerInvariant();
        var qb = q.Contains("4k") || q.Contains("2160") || q.Contains("1080") ? 6
            : q.Contains("720") ? 3
            : 0;

        var a = Math.Min(Math.Max(alts, 0), 3) * 2;
        var l = string.IsNullOrWhiteSpace(logo) ? 0 : 2;

        // 45 bodů za program v guide a až 15 podle toho, jak je rozvrh plný. Kanál,
        // který v guide země je, je skoro vždycky opravdová stanice - a to je jediné
        // rozlišení mezi národními kanály a náhodnými streamy, které zdarma máme.
        var e = programmes > 0 ? 45 + Math.Min(programmes, 40) * 15.0 / 40.0 : 0;

        return (int)Math.Round(e + g + qb + a + l);
    }

    // "France 3 Lorraine" a "France 3 Cote d'Azur" jsou jeden kanál ve více regionech,
    // stejně jako "NPO 1" a "NPO 1 HD". Z rodiny jde do hlavní skupiny jen jedna
    // položka (nejkratší název = ta hlavní), zbytek se přesune do "Dalších kanálů" -
    // jinak by první obrazovku zaplavilo dvacet regionálních variant.
    public static string Family(string? name)
    {
        var n = (name ?? "").Split('(')[0].Trim().ToLowerInvariant();
        var words = n.Split(' ', StringSplitOptions.RemoveEmptyEntries);
        return words.Length switch
        {
            0 => "",
            1 => words[0],
            _ => words[0] + " " + words[1],
        };
    }
}
