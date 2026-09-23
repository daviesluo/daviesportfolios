"""Revolut X public candles, region=UK, for the completeness check (daily) and the fair-value comparison (hourly).

GET https://revx.revolut.com/api/1.0/public/candles/{SYM}?interval=<min>&since=<ms>&until=<ms>&region=UK
<= 1,000 candles a call; every request through netlib's shared lock (>= 1.1 s apart across all processes).
Writes data/candles/<SYM>_<interval>.json: {"calls": [...request, status, n...], "rows": [sorted unique candles]}.
usage: pull_candles.py INTERVAL START_DAY END_DAY_EXCLUSIVE SYM [SYM ...]
"""
import json, os, sys, datetime
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import netlib

S = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def ms(day):
    return int(datetime.datetime.fromisoformat(day + "T00:00").replace(tzinfo=datetime.timezone.utc).timestamp() * 1000)


def main():
    interval = int(sys.argv[1]); a, z = ms(sys.argv[2]), ms(sys.argv[3])
    step = interval * 60000 * 1000
    for sym in sys.argv[4:]:
        calls, rows = [], {}
        t = a
        while t < z:
            u = min(z, t + step)
            url = f"https://revx.revolut.com/api/1.0/public/candles/{sym}?interval={interval}&since={t}&until={u}&region=UK"
            st, d, t0, t1 = netlib.get_json(url)
            data = (d.get("data") if isinstance(d, dict) else None) or []
            calls.append({"url": url, "status": st, "n": len(data)})
            for r in data:
                rows[int(r["start"])] = r
            t = u
        out = {"symbol": sym, "interval": interval, "region": "UK", "calls": calls, "rows": [rows[k] for k in sorted(rows)]}
        json.dump(out, open(os.path.join(S, "data", "candles", f"{sym}_{interval}.json"), "w"), indent=0, sort_keys=True)
        print(sym, interval, len(rows), [c["status"] for c in calls], flush=True)


if __name__ == "__main__":
    main()
