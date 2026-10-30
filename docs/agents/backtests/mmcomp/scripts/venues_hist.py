# MMCOMP part 7: did the GBP stablecoin books of Coinbase and Kraken tighten when Revolut X's did (the week of 2026-08-24)?
# Keyless public trades only (GETs): Coinbase Exchange /products/<P>/trades (paged back by trade id) and Kraken /0/public/Trades
# (from a time). For each ISO week from 2026-06-01 to 2026-10-26, two samples (Monday and Wednesday from 12:00 UTC), up to 1,000
# trades each, and the same measure as part 1: the median price gap between a taker buy and the taker sell next to it within
# 60 s, in bps (taker buy minus taker sell). Coinbase's `side` is the MAKER's side, so a taker buy is side 'sell'.
# Writes results/venues_hist.json (the measures; the raw trades are not kept). Re-running it re-reads the venues.
# SSL_CERT_FILE=<the proxy's CA bundle, when there is one> python3 -I docs/agents/backtests/mmcomp/scripts/venues_hist.py
import datetime, json, math, os, statistics, time, urllib.request

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "results", "venues_hist.json")
UA = {"User-Agent": "mmcomp-study"}


def get(url):
    for a in range(5):
        try:
            return json.load(urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30))
        except Exception:
            time.sleep(1 + 2 * a)
    raise SystemExit(f"failed: {url}")


def gap60(trades):
    """trades: [(sec, price, taker_side)] sorted; the median of buy - sell (bps) over adjacent opposite pairs within 60 s."""
    g = []
    for a, b in zip(trades, trades[1:]):
        if a[2] != b[2] and b[0] - a[0] <= 60:
            buy, sell = (a, b) if a[2] == "buy" else (b, a)
            g.append(1e4 * math.log(buy[1] / sell[1]))
    return (round(statistics.median(g), 2) if g else None), len(g)


def cb_page(product, after=None):
    url = f"https://api.exchange.coinbase.com/products/{product}/trades?limit=1000" + (f"&after={after}" if after else "")
    time.sleep(0.15)
    return get(url)


def cb_time(t):
    return datetime.datetime.fromisoformat(t["time"].replace("Z", "+00:00")).timestamp()


def cb_id_at(product, ts, hi_id):
    """The first trade id at or after ts, by interpolation then bisection on single-trade pages."""
    lo, hi = 1, hi_id
    for _ in range(40):
        if hi - lo <= 1000:
            break
        mid = (lo + hi) // 2
        page = cb_page(product, after=mid + 1)
        if not page:
            lo = mid
            continue
        t = cb_time(page[0])
        if t < ts:
            lo = mid
        else:
            hi = mid
    return hi


def cb_sample(product, ts, hi_id):
    i = cb_id_at(product, ts, hi_id)
    page = cb_page(product, after=i + 1000)     # trades with id < i + 1000: about the 1,000 after ts
    tr = sorted((cb_time(t), float(t["price"]), "buy" if t["side"] == "sell" else "sell") for t in page)
    tr = [x for x in tr if x[0] >= ts]
    return tr


def kr_sample(pair, ts):
    j = get(f"https://api.kraken.com/0/public/Trades?pair={pair}&since={int(ts * 1e9)}&count=1000")
    time.sleep(1.1)
    rows = next(v for k, v in j["result"].items() if k != "last")
    return sorted((float(r[2]), float(r[0]), "buy" if r[3] == "b" else "sell") for r in rows)


res = {}
start = datetime.datetime(2026, 6, 1, 12, tzinfo=datetime.timezone.utc)
weeks = []
d = start
while d < datetime.datetime(2026, 10, 27, tzinfo=datetime.timezone.utc):
    weeks.append(d)
    d += datetime.timedelta(days=7)
cb_hi = {p: cb_page(p)[0]["trade_id"] for p in ("USDT-GBP", "USDC-GBP")}
for venue, books in (("coinbase", ("USDT-GBP", "USDC-GBP")), ("kraken", ("USDTGBP", "USDCGBP"))):
    for bk in books:
        rows = {}
        for w in weeks:
            tr = []
            for off in (0, 2):
                ts = (w + datetime.timedelta(days=off)).timestamp()
                tr += cb_sample(bk, ts, cb_hi[bk]) if venue == "coinbase" else kr_sample(bk, ts)
            tr.sort()
            g, n = gap60(tr)
            y, wk, _ = w.isocalendar()
            rows[f"{y}-W{wk:02d}"] = {"gap60_med": g, "pairs": n, "trades": len(tr)}
            print(venue, bk, f"{y}-W{wk:02d}", g, n, len(tr), flush=True)
        res[f"{venue}:{bk}"] = rows
json.dump(res, open(OUT, "w"), indent=0, sort_keys=True)
