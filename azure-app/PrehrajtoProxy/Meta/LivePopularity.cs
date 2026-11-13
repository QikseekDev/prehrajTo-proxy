namespace Wflix.Meta;

// Sledovanost jednotlivých stanic se zdarma a pro všechny země sehnat nedá (Nielsen,
// ATO a spol. jsou placené, Wikipedie ani Wikidata rozumné pořadí nedají). Proto je tu
// ručně udržovaný žebříček: pro každou zemi seznam id stanic od té nejsledovanější.
// Kanály, které v seznamu nejsou, zůstanou v pořadí playlistu - takže to funguje i pro
// zemi, kterou tu nikdo nevyplnil, jen bez seskupení.
// Id je základ z iptv-org ("CT1.cz@SD" -> "ct1.cz"), varianta SD/HD se ignoruje.
internal static class LivePopularity
{
    private static readonly Dictionary<string, string[]> Ranked = new(StringComparer.OrdinalIgnoreCase)
    {
        ["cz"] = new[]
        {
            "ct1.cz", "ct2.cz", "ct24.cz", "ctSport.cz", "prima.cz", "primacool.cz", "primalove.cz",
            "primazoom.cz", "primamax.cz", "primakrimi.cz", "primastar.cz", "primashow.cz",
            "primasportczechia.cz", "tvbarrandov.cz", "kinobarrandov.cz", "barrandovkrimi.cz",
            "televizeseznam.cz", "cnnprimanews.cz", "ctdecko.cz", "ocko.cz", "ockostar.cz",
            "ockoexpres.cz", "ockogold.cz", "ockoblack.cz", "sport1.cz", "sport2.cz",
            "eurosport1.fr", "eurosport2.fr", "disneychannel.cz", "minimaxcee.cz", "nickelodeon.cz",
            "hbo.cz", "cinemaxcentraleurope.hu", "filmplus.cz", "tvnoe.cz", "spektrum.cz",
            "history.cz", "viasathistory.cz", "viasatexplore.cz", "viasatnature.cz",
            "nationalgeographic.cz", "discoverychannel.cz", "travelchannel.cz", "foodnetwork.cz",
            "investigationdiscovery.cz", "hgtv.cz", "tlc.cz", "warnerTv.cz",
        },

        ["sk"] = new[]
        {
            "jednotka.sk", "dvojka.sk", "24.sk", "markizaplus1.sk", "primask.sk", "primacoolsk.sk",
            "primalovesk.sk", "primakrimisk.sk", "tv8.sk", "tv9.sk", "sport.sk", "sport1.sk",
            "sport2.sk", "arenasport1.sk", "arenasport2.sk", "canalplussportsk.sk", "tvlux.sk",
            "senzi.sk", "tvt.sk", "mtr.sk", "turbotv.sk", "hahatv.sk", "ocko.cz", "filmboxplusone.pl",
            "disneychannel.cz", "minimaxcee.cz", "spektrum.cz", "viasathistory.cz", "viasatexplore.cz",
            "viasatnature.cz", "nationalgeographic.cz", "sport1.cz", "sport2.cz", "eurosport1.fr",
            "eurosport2.fr",
        },

        ["uk"] = new[]
        {
            "bbcone.uk", "bbctwo.uk", "bbcthree.uk", "bbcfour.uk", "bbcnews.uk", "bbcscotland.uk",
            "channel4.uk", "channel5.uk", "itv2.uk", "itv3.uk", "itv4.uk", "e4.uk", "more4.uk",
            "5usa.uk", "gbnews.uk", "talktv.uk", "skynewsweather.uk", "skysportsnews.uk",
            "skysportsf1.uk", "tntsports1.uk", "quest.uk", "really.uk", "cbbc.uk", "cbeebies.uk",
            "s4c.uk", "animalplanet.uk", "discoverychannel.uk", "nationalgeographic.uk",
            "nickelodeon.uk", "pop.uk", "tinypop.uk", "blaze.uk", "togethertv.uk", "pbsamerica.uk",
            "talkingpicturestv.uk", "qvc.uk",
        },

        ["us"] = new[]
        {
            "pbs.us", "nbc.us", "fox.us", "cnn.us", "espn.us", "hbo.us", "history.us",
            "nationalgeographic.us", "amc.us", "fx.us", "tnt.us", "tbs.us", "usanetwork.us",
            "mtv.us", "bravo.us", "foodnetwork.us", "cartoonnetwork.us", "cnbc.us", "lifetime.us",
            "syfy.us",
        },

        ["de"] = new[]
        {
            "daserste.de", "zdf.de", "rtl.de", "prosieben.de", "vox.de", "kabeleins.de",
            "rtlzwei.de", "prosiebenmaxx.de", "zdfneo.de", "zdfinfo.de", "3sat.de", "arte.de",
            "nitro.de", "sixx.de", "rtlup.de", "sat1gold.de", "ntv.de", "welt.de",
            "kika.de", "tele5.de", "comedycentral.de", "dmax.de", "ardalpha.de", "wdrfernsehen.de",
            "mdrfernsehen.de",
        },

        ["at"] = new[]
        {
            "orf1.at", "orf2.at", "orfiii.at", "atv.at", "servustv.at",
        },

        ["pl"] = new[]
        {
            "tvp1.pl", "tvpinfo.pl", "polsat.pl", "tv4.pl", "tv6.pl", "tvpuls.pl", "superpolsat.pl",
            "polsatnews.pl", "fokustv.pl", "tvrepublika.pl", "tvppolonia.pl", "canalplussport.pl",
            "canalplusnow.pl", "tvpworld.pl", "canalplus360.pl", "tvprozrywka.pl",
        },
    };

    // Jazyk si bere tabulku země, ze které daný jazyk hlavně je (čeština -> Česko).
    private static readonly Dictionary<string, string> LangToCountry = new(StringComparer.OrdinalIgnoreCase)
    {
        ["ces"] = "cz", ["slo"] = "sk", ["slk"] = "sk", ["eng"] = "uk", ["deu"] = "de", ["ger"] = "de",
        ["pol"] = "pl",
    };

    private static readonly Dictionary<string, Dictionary<string, int>> Index = Build();

    private static Dictionary<string, Dictionary<string, int>> Build()
    {
        var map = new Dictionary<string, Dictionary<string, int>>(StringComparer.OrdinalIgnoreCase);
        foreach (var (country, ids) in Ranked)
        {
            var byId = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
            for (var i = 0; i < ids.Length; i++)
                byId[TextNorm.StripVariant(ids[i]).ToLowerInvariant()] = i;
            map[country] = byId;
        }
        return map;
    }

    public static bool Has(string? key) => key is { Length: > 0 } && Index.ContainsKey(Resolve(key));

    public static string Resolve(string key) => LangToCountry.TryGetValue(key, out var cc) ? cc : key;

    // -1 = stanici v žebříčku nemáme.
    public static int Rank(string? key, string channelId)
    {
        if (key is not { Length: > 0 }) return -1;
        if (!Index.TryGetValue(Resolve(key), out var byId)) return -1;
        return byId.TryGetValue(TextNorm.StripVariant(channelId).ToLowerInvariant(), out var rank) ? rank : -1;
    }
}
