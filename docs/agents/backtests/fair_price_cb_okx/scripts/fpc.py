"""Shared loaders and statistics of the fair-price study (docs/agents/reviews/2026-10-29-cb-okx-fair-price-study.md).

Production inputs are the md5-checked pulls of ../sql/ (scripts/grab.py), committed gzipped in ../inputs/prod/ byte for byte.
Every series is keyed by the minute's start (epoch minutes, "m") or by milliseconds where it says so.
"""
import bisect, collections, datetime, gzip, json, os, random

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
PROD = os.path.join(ROOT, "inputs", "prod")
M, H, DAY = 60000, 3600000, 86400000
BOOKS = ["USDC-GBP", "USDT-GBP", "USDC-EUR", "USDT-EUR"]
QUOTE = {"USDC-GBP": "GBP", "USDT-GBP": "GBP", "USDC-EUR": "EUR", "USDT-EUR": "EUR"}
COIN = {"USDC-GBP": "USDC", "USDT-GBP": "USDT", "USDC-EUR": "USDC", "USDT-EUR": "USDT"}
TICK = {"USDC-GBP": 1e-4, "USDT-GBP": 1e-4, "USDC-EUR": 1e-4, "USDT-EUR": 1e-5}


def lines(name):
    with gzip.open(os.path.join(PROD, name + ".txt.gz"), "rt") as f:
        return [l.rstrip("\n") for l in f if l.strip()]


def num(s):
    return None if s in ("-", "", None) else float(s)


def iso_ms(s):
    return int(datetime.datetime.fromisoformat(str(s).replace("Z", "+00:00")).timestamp() * 1000)


def day_of(ms):
    return datetime.datetime.fromtimestamp(ms / 1000, datetime.timezone.utc).strftime("%Y-%m-%d")


def is_closure(ms):
    """PR5-W's FX closure: Friday 21:00 to Sunday 21:00 UTC (the holidays aside)."""
    d = datetime.datetime.fromtimestamp(ms / 1000, datetime.timezone.utc)
    wd, h = d.weekday(), d.hour
    return (wd == 4 and h >= 21) or wd == 5 or (wd == 6 and h < 21)


def load_minutes(book):
    """{m: dict} from the base record (cb_quote_minutes) with the weekend arm's fair (cb_hold_minutes) beside it."""
    out = {}
    for l in lines("minutes_" + book):
        p = l.split("\t")
        m = int(p[0])
        out[m] = {"x": num(p[1]), "fair": num(p[2]), "hfair": num(p[3]), "xage": num(p[4]), "eage": num(p[5]),
                  "hours_n": int(p[6]), "prints_n": int(p[7]), "vol": float(p[8]), "sell_lo": num(p[9]), "sell_hi": num(p[10]),
                  "buy_lo": num(p[11]), "buy_hi": num(p[12]), "last": num(p[13]), "last_side": {"b": "buy", "s": "sell"}.get(p[14])}
    return out


def load_touch():
    """{book: {m: (seconds into the minute, bid, ask, bid size, ask size)}}: the recorder's read at the top of minute m."""
    out = collections.defaultdict(dict)
    for l in lines("touch"):
        b, m, s, bid, ask, bs, az = l.split("\t")
        out[b][int(m)] = (float(s), float(bid), float(ask), float(bs), float(az))
    return out


def load_fx():
    """{'GBPUSD': ([minute ms], [value]), 'EURUSD': ...}: Yahoo's one-minute closes as the engines stored them."""
    d = collections.defaultdict(lambda: ([], []))
    for l in lines("fx"):
        k, m, v = l.split("\t")
        d[k][0].append(int(m) * M); d[k][1].append(float(v))
    return dict(d)


def load_hours_revx():
    """{'USDC': [(hour start ms, close)], 'USDT': ...}: Revolut X UK's USD-book hourly closes (PR5's stored `fair:*`)."""
    d = collections.defaultdict(list)
    for l in lines("hours"):
        k, m, v = l.split("\t")
        d[k.split(":")[1].split("-")[0]].append((int(m) * M, float(v)))
    return {k: sorted(v) for k, v in d.items()}


def load_cb_usdt_1m():
    """([minute ms], [close]): Coinbase USDT-USD one-minute candle closes (fetch_cb_usdt.py)."""
    d = json.load(gzip.open(os.path.join(ROOT, "inputs", "cb_usdtusd_1m.json.gz"), "rt"))
    return [c[0] * M for c in d["candles"]], [float(c[1]) for c in d["candles"]]


def hourly_from_minutes(ts, vs):
    """Hourly closes (the hour's last one-minute close) from minute closes: [(hour start ms, close)]."""
    h = {}
    for t, v in zip(ts, vs):
        h[t // H * H] = v
    return sorted(h.items())


def load_trips():
    out = []
    for l in lines("trips"):
        arm, j = l.split("\t", 1)
        r = json.loads(j)
        r["arm"] = arm
        for k in ("t_entry", "fill_ts", "t_exit"):
            r[k + "_ms"] = iso_ms(r[k])
        out.append(r)
    return out


def bar_at(t, ts, vs, lookback=10 * M):
    """The value of the latest bar that started in [t - lookback, t - 1 min] (`fxBarAt`); None when there is none."""
    k = bisect.bisect_right(ts, t - M) - 1
    return vs[k] if k >= 0 and ts[k] >= t - lookback else None


def f3(t, hours):
    """PR5's F3: the median of the hourly closes whose hour started in [t - 24 h, t - 1 h]."""
    hs = [c for s, c in hours if t - DAY <= s <= t - H]
    if not hs:
        return None
    hs.sort(); n = len(hs)
    return hs[n // 2] if n % 2 else (hs[n // 2 - 1] + hs[n // 2]) / 2


class F3:
    """F3 over a long hourly series, fast: a sliding median by bisect."""

    def __init__(self, hours):
        self.t = [h[0] for h in hours]; self.c = [h[1] for h in hours]; self.cache = {}

    def __call__(self, t):
        i, j = bisect.bisect_left(self.t, t - DAY), bisect.bisect_right(self.t, t - H)
        if (i, j) not in self.cache:
            xs = sorted(self.c[i:j]); n = len(xs)
            self.cache[(i, j)] = None if not n else (xs[n // 2] if n % 2 else (xs[n // 2 - 1] + xs[n // 2]) / 2)
        return self.cache[(i, j)]

    def last(self, t):
        """The close of the last completed hour (started at or before t - 1 h)."""
        j = bisect.bisect_right(self.t, t - H) - 1
        return self.c[j] if j >= 0 and self.t[j] >= t - 3 * H else None


def bootstrap_paired(daily_a, daily_b, days, seed=20261029, n=2000):
    """Day-block bootstrap of the paired difference a - b over `days` (a day missing in either counts 0): (mean a day,
    5th, 95th percentile of the mean, share of draws above zero)."""
    v = [daily_a.get(d, 0.0) - daily_b.get(d, 0.0) for d in days]
    if not v:
        return None
    rng = random.Random(seed)
    s = sorted(sum(rng.choice(v) for _ in range(len(v))) / len(v) for _ in range(n))
    return {"mean_day": sum(v) / len(v), "p05": s[int(0.05 * n)], "p95": s[int(0.95 * n) - 1], "share_gt0": sum(1 for x in s if x > 0) / n}


def days_between(t0, t1):
    return [day_of(t) for t in range(t0 // DAY * DAY, t1, DAY)]
