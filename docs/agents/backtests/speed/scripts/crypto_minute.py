"""SPEED step 4 (the crypto trend rows): what a minute of delay can cost a stop or an entry on BTC/ETH/SOL/AVAX.

Binance's public 1-minute candles (data-api.binance.vision, keyless) over the last 30 days: the distribution of one
minute's move (|close/open - 1|) and of the worst fall inside a minute (low/open - 1), in basis points. A stop checked
once a minute sells up to a minute after the floor is crossed; checked every second, a second after. The trend rows
enter on a newly closed 4-hour bar, so the same minute bounds what acting at the close + 1 s instead of + ~5 s changes.

usage: crypto_minute.py <out json>
"""
import json
import sys
import time
import urllib.parse
import urllib.request

UA = "daviesportfolios-speed-study/1.0 (research; public data only)"
SYMS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "AVAXUSDT"]


def get(params):
    url = "https://data-api.binance.vision/api/v3/klines?" + urllib.parse.urlencode(params)
    with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": UA}), timeout=30) as r:
        return json.load(r)


def q(xs, p):
    return round(xs[min(len(xs) - 1, int(p * len(xs)))], 1)


def main():
    end = int(time.time() // 60 * 60 * 1000)
    start = end - 30 * 86400 * 1000
    out = {"window_ms": [start, end], "symbols": {}}
    for s in SYMS:
        rows, t = [], start
        while t < end:
            d = get({"symbol": s, "interval": "1m", "startTime": t, "limit": 1000})
            if not d:
                break
            rows += d
            t = d[-1][0] + 60000
            time.sleep(0.2)
        mv = sorted(abs(float(r[4]) / float(r[1]) - 1) * 1e4 for r in rows)
        fall = sorted((1 - float(r[3]) / float(r[1])) * 1e4 for r in rows)
        out["symbols"][s] = {"minutes": len(rows),
                             "abs_move_bps": {"p50": q(mv, .5), "p90": q(mv, .9), "p99": q(mv, .99), "p999": q(mv, .999), "max": round(mv[-1], 1)},
                             "worst_fall_in_minute_bps": {"p50": q(fall, .5), "p99": q(fall, .99), "p999": q(fall, .999), "max": round(fall[-1], 1)}}
        print(s, out["symbols"][s])
    with open(sys.argv[1], "w") as f:
        json.dump(out, f, indent=1)
        f.write("\n")


if __name__ == "__main__":
    main()
