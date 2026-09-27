"""SPEED step 3: how far a print's time in the data API (what PMLATE times the market with) lags the match itself.

The WebSocket probe (`pm_ws_probe.mjs`) wrote every `last_trade_price` event it received, with the CLOB's own
millisecond timestamp. This reads the data API's `/trades` for the same markets (keyless, each read cache-busted) and
pairs each socket trade with the data API row of the same token, price and size nearest in time; the lag is the data
API's `timestamp` (whole seconds) less the socket's. It says how early a print really happened when PMLATE's tables say
it happened at second t.

usage: print_time_lag.py <ws_trades.jsonl> <out json>
"""
import json
import sys
import time
import urllib.parse
import urllib.request
from collections import defaultdict

UA = "daviesportfolios-speed-study/1.0 (research; public data only)"


def lines(path):
    """A JSON-lines file, plain or gzipped (the committed copies are `<name>.gz`)."""
    import gzip
    import os
    f = gzip.open(path + ".gz", "rt") if not os.path.exists(path) and os.path.exists(path + ".gz") else open(path)
    with f:
        return [json.loads(x) for x in f if x.strip()]


def get(url, params):
    req = urllib.request.Request(url + "?" + urllib.parse.urlencode(params), headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)


def q(xs, p):
    xs = sorted(xs)
    return xs[min(len(xs) - 1, int(p * len(xs)))] if xs else None


def main():
    ws = lines(sys.argv[1])
    by_mkt = defaultdict(list)
    for t in ws:
        if t.get("market") and t.get("ts"):
            by_mkt[t["market"]].append(t)
    t_lo = min(t["ts"] for t in ws) / 1000 - 60
    lags, unmatched, markets = [], 0, 0
    for mkt, trades in sorted(by_mkt.items(), key=lambda kv: -len(kv[1]))[:40]:
        rows, off = [], 0
        while off < 3000:
            d = get("https://data-api.polymarket.com/trades", {"market": mkt, "limit": 500, "offset": off,
                                                              "_": str(int(time.time() * 1000))})
            if not d:
                break
            rows += d
            if len(d) < 500 or min(int(r.get("timestamp") or 0) for r in d) < t_lo:
                break
            off += 500
            time.sleep(0.3)
        markets += 1
        idx = defaultdict(list)
        for r in rows:
            idx[(str(r.get("asset")), round(float(r.get("price") or 0), 4), round(float(r.get("size") or 0), 2))].append(int(r.get("timestamp") or 0))
        for t in trades:
            k = (str(t["asset"]), round(float(t["price"]), 4), round(float(t["size"]), 2))
            cands = idx.get(k)
            if not cands:
                unmatched += 1
                continue
            best = min(cands, key=lambda s: abs(s - t["ts"] / 1000))
            if abs(best - t["ts"] / 1000) <= 120:
                lags.append(best - t["ts"] / 1000)
            else:
                unmatched += 1
        time.sleep(0.3)
    res = {"markets": markets, "socket_trades": sum(len(v) for v in by_mkt.values()), "matched": len(lags),
           "unmatched": unmatched,
           "data_api_ts_minus_match_s": {"p10": q(lags, .1), "p25": q(lags, .25), "p50": q(lags, .5), "p75": q(lags, .75),
                                         "p90": q(lags, .9), "min": q(lags, 0), "max": q(lags, 1)}}
    with open(sys.argv[2], "w") as f:
        json.dump(res, f, indent=1)
        f.write("\n")
    print(json.dumps(res, indent=1))


if __name__ == "__main__":
    main()
