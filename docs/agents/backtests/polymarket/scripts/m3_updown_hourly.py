"""M3: are the hourly crypto up/down markets mispriced against Binance? (fp4, a kill measurement)

The hourly BTC/ETH/SOL/XRP "Up or Down" markets resolve on Binance's 1-hour
candle for the USDT pair (close >= open -> Up). Within the hour the fair price of
"Up" is a function of Binance's price, the candle's open, the time left and the
volatility: p* = Phi(ln(S/O) / (sigma * sqrt(tau))). For every such market that
closed in the last ~55 days, the market's own price at each 5-minute point of the
hour (/v2/prices-history, 300 s buckets) is set against p* from Binance's public
1-minute klines (sigma = realised 1-minute volatility of the previous 120
minutes), and against the outcome. Descriptive, in sample, no parameter chosen
for a test: it asks whether a once-a-minute taker could ever clear the crypto
fee (0.07 * p * (1 - p) a share) plus half the spread.

usage: m3_updown_hourly.py <out json> [days]
"""
import json
import math
import os
import sys
import time
from collections import defaultdict

sys.path.insert(0, os.path.dirname(__file__))
import pmnet  # noqa: E402

GAMMA = "https://gamma-api.polymarket.com"
DATA_API = "https://data-api.polymarket.com"
BINANCE = "https://data-api.binance.vision"
SERIES = {"btc-up-or-down-hourly": "BTCUSDT", "eth-up-or-down-hourly": "ETHUSDT",
          "solana-up-or-down-hourly": "SOLUSDT", "xrp-up-or-down-hourly": "XRPUSDT"}
FEE = 0.07


def phi(x):
    return 0.5 * (1 + math.erf(x / math.sqrt(2)))


def iso(ts_):
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(ts_))


def pts(s):
    from datetime import datetime
    s = s.replace("Z", "+00:00").replace(" ", "T")
    if s.endswith("+00"):
        s += ":00"
    return datetime.fromisoformat(s).timestamp()


def events_for(series_slug, t0, t1):
    s = pmnet.get(GAMMA + "/series", {"slug": series_slug})
    sid = (s[0] if isinstance(s, list) else s)["id"]
    out, cursor = [], None
    while True:
        params = {"series_id": sid, "closed": "true", "limit": 100, "end_date_min": iso(t0), "end_date_max": iso(t1)}
        if cursor:
            params["after_cursor"] = cursor
        d = pmnet.get(GAMMA + "/events/keyset", params)
        out.extend(d.get("events") or [])
        cursor = d.get("next_cursor")
        if not cursor or not d.get("events"):
            break
    return out


def klines(sym, t0, t1):
    rows, start = {}, int(t0 * 1000)
    while start < t1 * 1000:
        d = pmnet.get(BINANCE + "/api/v3/klines", {"symbol": sym, "interval": "1m", "startTime": start, "limit": 1000})
        if not d:
            break
        for k in d:
            rows[k[0] // 1000] = (float(k[1]), float(k[4]))
        start = d[-1][0] + 60000
    return rows


def main():
    outp = sys.argv[1]
    days = float(sys.argv[2]) if len(sys.argv) > 2 else 55
    cache = os.path.join(pmnet.DATA, "m3")
    os.makedirs(cache, exist_ok=True)
    now = time.time()
    t0, t1 = now - days * 86400, now - 3600
    obs = []
    per_series = {}
    for slug, sym in SERIES.items():
        cp = os.path.join(cache, slug + ".json")
        if os.path.exists(cp):
            blob = pmnet.load(cp)
        else:
            evs = events_for(slug, t0, t1)
            kl = klines(sym, t0 - 3 * 3600, t1 + 3600)
            mk = []
            for e in evs:
                for m in e.get("markets") or []:
                    try:
                        outs = json.loads(m.get("outcomes") or "[]")
                        toks = json.loads(m.get("clobTokenIds") or "[]")
                        op = [float(x) for x in json.loads(m.get("outcomePrices") or "[]")]
                    except ValueError:
                        continue
                    if "Up" not in outs or len(toks) != 2 or sorted(op) != [0.0, 1.0]:
                        continue
                    iu = outs.index("Up")
                    end = pts(m["endDate"])
                    start = end - 3600
                    ph = pmnet.get(DATA_API + "/v2/prices-history", {"token_id": toks[iu], "start": int(start - 300), "end": int(end), "bucket_seconds": 300})
                    mk.append({"start": start, "end": end, "up": op[iu], "hist": [[p["timestamp"], p["price"], p.get("resolution_seconds")] for p in (ph.get("data") or [])],
                               "slug": m.get("slug")})
            blob = {"markets": mk, "klines": {str(k): v for k, v in kl.items()}}
            pmnet.dump(cp, blob)
        kl = {int(k): v for k, v in blob["klines"].items()}
        n_used = 0

        def model_at(k, opn, end):
            """p* from the Binance close of the minute starting at k (known at k + 60)."""
            if k not in kl:
                return None
            rets = []
            for j in range(120):
                a, b = kl.get(k - 60 * (j + 1)), kl.get(k - 60 * j)
                if a and b:
                    rets.append(math.log(b[1] / a[1]))
            if len(rets) < 60:
                return None
            sig = math.sqrt(sum(r * r for r in rets) / len(rets))
            tau = (end - (k + 60)) / 60.0
            if tau <= 0 or sig <= 0:
                return None
            return phi(math.log(kl[k][1] / opn) / (sig * math.sqrt(tau)))

        for m in blob["markets"]:
            o = kl.get(int(m["start"]))
            if not o:
                continue
            opn = o[0]
            for t, p, res in m["hist"]:
                if res == 0 or t < m["start"] or t + 300 >= m["end"]:
                    continue
                # the market's price was observed somewhere in [t, t + 300). Two timings for the model:
                # "late" reads Binance at t + 300 (up to five minutes NEWER than the price: flatters the model),
                # "early" reads it at t (up to five minutes OLDER: flatters the market).
                late = model_at(int((t + 300) // 60 * 60) - 60, opn, m["end"])
                early = model_at(int(t // 60 * 60) - 60, opn, m["end"])
                if late is None or early is None:
                    continue
                obs.append({"series": slug, "min": round((t - m["start"]) / 60), "p": p, "pstar": late, "pstar_early": early, "y": m["up"]})
                n_used += 1
        per_series[slug] = {"markets": len(blob["markets"]), "markets_with_history": sum(1 for m in blob["markets"] if len(m["hist"]) > 2),
                            "observations": n_used}

    def brier(key):
        return sum((o[key] - o["y"]) ** 2 for o in obs) / max(1, len(obs))

    res = {"days": days, "series": per_series, "observations": len(obs),
           "brier_market": brier("p"), "brier_model_late": brier("pstar"), "brier_model_early": brier("pstar_early"),
           "note": "late = Binance read up to 5 min after the market's price (flatters the model); early = up to 5 min before"}
    # calibration of the market by price decile
    cal = defaultdict(lambda: [0, 0.0, 0.0])
    for o in obs:
        b = min(9, int(o["p"] * 10))
        cal[b][0] += 1
        cal[b][1] += o["p"]
        cal[b][2] += o["y"]
    res["market_calibration"] = {f"{b/10:.1f}-{(b+1)/10:.1f}": {"n": v[0], "mean_price": round(v[1] / v[0], 4), "freq_up": round(v[2] / v[0], 4)} for b, v in sorted(cal.items())}
    # a taker that buys the side the model favours by more than delta, at the market price plus a half-spread, pays the fee
    rules = {}
    for timing, key in (("late", "pstar"), ("early", "pstar_early")):
        for half_spread in (0.005, 0.01):
            for delta in (0.02, 0.05, 0.10, 0.15):
                n, pnl = 0, 0.0
                for o in obs:
                    d = o[key] - o["p"]
                    if d > delta:
                        px = min(0.99, o["p"] + half_spread)
                        pnl += o["y"] - px - FEE * px * (1 - px)
                        n += 1
                    elif -d > delta:
                        px = min(0.99, (1 - o["p"]) + half_spread)
                        pnl += (1 - o["y"]) - px - FEE * px * (1 - px)
                        n += 1
                rules[f"{timing}_h{half_spread}_d{delta}"] = {"trades": n, "pnl_per_share_sum": round(pnl, 3),
                                                             "pnl_per_trade": round(pnl / n, 4) if n else None}
    res["taker_rules"] = rules
    dist = sorted(abs(o["pstar"] - o["p"]) for o in obs)
    if dist:
        res["abs_gap_p50"] = dist[len(dist) // 2]
        res["abs_gap_p90"] = dist[int(len(dist) * 0.9)]
        res["abs_gap_p99"] = dist[int(len(dist) * 0.99)]
    pmnet.dump(outp, res)
    print(json.dumps(res, indent=1)[:5000])


if __name__ == "__main__":
    main()
