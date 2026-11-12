using System.Collections.Concurrent;

namespace Wflix.Admin;

// ---------------------------------------------------------------------------
// Lehká telemetrie pro panel. Všechno drží v paměti procesu - po restartu se
// to vynuluje, stejně jako počítadla v AdminStore. Zapisuje se jen veřejné
// /api (ne admin volání a ne statické soubory), takže tabulky ukazují provoz
// webu, ne šum z otevřeného panelu.
// ---------------------------------------------------------------------------

public sealed class AdminTraffic
{
    public sealed record Sample(DateTimeOffset At, string Method, string Path, int Status, double Ms, string Ip);

    private const int RecentCap = 200;
    private const int KeepMinutes = 180;

    private readonly ConcurrentQueue<Sample> recent = new();
    private readonly ConcurrentDictionary<long, Minute> minutes = new();
    private readonly ConcurrentDictionary<string, PathStat> paths = new(StringComparer.Ordinal);

    private sealed class Minute
    {
        public long Count;
        public long ClientErrors;
        public long ServerErrors;
        public long Ms;
    }

    private sealed class PathStat
    {
        public string Path = "";
        public long Count;
        public long Ms;
        public long Errors;
        public long LastTick;
    }

    public void Record(string method, string path, int status, double ms, string ip)
    {
        var now = DateTimeOffset.UtcNow;
        var sample = new Sample(now, method, path, status, Math.Round(ms, 1), ip);
        recent.Enqueue(sample);
        while (recent.Count > RecentCap) recent.TryDequeue(out _);

        var minuteKey = now.ToUnixTimeSeconds() / 60;
        var bucket = minutes.GetOrAdd(minuteKey, _ => new Minute());
        Interlocked.Increment(ref bucket.Count);
        if (status == 403) Interlocked.Increment(ref bucket.ClientErrors);
        if (status >= 500) Interlocked.Increment(ref bucket.ServerErrors);
        Interlocked.Add(ref bucket.Ms, (long)ms);

        var stat = paths.GetOrAdd(path, p => new PathStat { Path = p });
        Interlocked.Increment(ref stat.Count);
        Interlocked.Add(ref stat.Ms, (long)ms);
        if (status >= 400) Interlocked.Increment(ref stat.Errors);
        Interlocked.Exchange(ref stat.LastTick, now.ToUnixTimeSeconds());

        Prune(minuteKey, now);
    }

    private void Prune(long minuteKey, DateTimeOffset now)
    {
        if (minutes.Count <= KeepMinutes) return;

        var oldest = minuteKey - KeepMinutes;
        foreach (var kv in minutes)
            if (kv.Key < oldest) minutes.TryRemove(kv.Key, out _);

        var staleTick = now.ToUnixTimeSeconds() - 900;
        foreach (var kv in paths)
            if (Volatile.Read(ref kv.Value.LastTick) < staleTick) paths.TryRemove(kv.Key, out _);
    }

    public object Snapshot(int windowMinutes)
    {
        var now = DateTimeOffset.UtcNow;
        var currentMinute = now.ToUnixTimeSeconds() / 60;

        var buckets = new List<object>(windowMinutes);
        long total = 0, total403 = 0, total5xx = 0, totalMs = 0;
        for (var i = windowMinutes - 1; i >= 0; i--)
        {
            var key = currentMinute - i;
            if (minutes.TryGetValue(key, out var m))
            {
                var avg = m.Count > 0 ? Math.Round((double)m.Ms / m.Count, 0) : 0;
                buckets.Add(new
                {
                    time = DateTimeOffset.FromUnixTimeSeconds(key * 60).ToLocalTime().ToString("HH:mm"),
                    count = m.Count,
                    clientErrors = Interlocked.Read(ref m.ClientErrors),
                    serverErrors = Interlocked.Read(ref m.ServerErrors),
                    avgMs = avg,
                });
                total += Interlocked.Read(ref m.Count);
                total403 += Interlocked.Read(ref m.ClientErrors);
                total5xx += Interlocked.Read(ref m.ServerErrors);
                totalMs += Interlocked.Read(ref m.Ms);
            }
            else
            {
                buckets.Add(new
                {
                    time = DateTimeOffset.FromUnixTimeSeconds(key * 60).ToLocalTime().ToString("HH:mm"),
                    count = 0,
                    clientErrors = 0,
                    serverErrors = 0,
                    avgMs = 0d,
                });
            }
        }

        var stats = paths.Values
            .Select(p => new
            {
                path = p.Path,
                count = Interlocked.Read(ref p.Count),
                avgMs = p.Count > 0 ? Math.Round((double)p.Ms / p.Count, 0) : 0,
                errors = Interlocked.Read(ref p.Errors),
            })
            .ToList();

        var slowest = stats.Where(s => s.count >= 2).OrderByDescending(s => s.avgMs).Take(8).ToList();
        var busiest = stats.OrderByDescending(s => s.count).Take(8).ToList();
        var failing = stats.Where(s => s.errors > 0).OrderByDescending(s => s.errors).Take(8).ToList();

        var latest = recent.Reverse().Take(40).Select(s => new
        {
            at = s.At.ToLocalTime().ToString("HH:mm:ss"),
            method = s.Method,
            path = s.Path,
            status = s.Status,
            ms = s.Ms,
            ip = s.Ip,
        }).ToList();

        return new
        {
            window = windowMinutes,
            buckets,
            recent = latest,
            slowest,
            busiest,
            failing,
            totals = new
            {
                count = total,
                clientErrors = total403,
                serverErrors = total5xx,
                avgMs = total > 0 ? Math.Round((double)totalMs / total, 0) : 0,
                perMinute = windowMinutes > 0 ? Math.Round((double)total / windowMinutes, 2) : 0,
            },
        };
    }
}
