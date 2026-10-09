"""FUNDX: the funding spread between Hyperliquid and OKX on the same perpetual, and a rule that harvests it.

Keyless: api.hyperliquid.xyz/info (fundingHistory, hourly) and OKX /api/v5/public/funding-rate-history (as far back as
it pages, about three months). For each coin and UTC day: D = sum of the day's Hyperliquid rates - sum of OKX's.
The rule, written before the first run: from day 8, if the previous 7 days' mean D > +tau, hold short Hyperliquid /
long OKX (collect D) the next day; if < -tau the reverse; else flat. A change of side or to flat pays the round trip
on the legs it closes and opens: taker 4.5 bps (HL) and 5 bps (OKX) a leg, so 19 bps to open and close both;
tau in {2, 5, 10} bps a day. Price basis between the venues is ignored (a lower bound on risk). Results per $ notional.
Output: results/funding_xvenue.json; raw pulls kept in inputs/funding/.
"""
import gzip, json, os, sys, time
import datetime as dt

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from netget import get, get_json

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
INP = os.path.join(HERE, "inputs", "funding")
os.makedirs(INP, exist_ok=True)
COINS = ["BTC", "ETH", "SOL", "XRP", "DOGE", "AVAX", "LINK", "SUI"]


def hl(coin, start):
    out, t = [], start
    while True:
        st, b = get("https://api.hyperliquid.xyz/info", data=json.dumps({"type": "fundingHistory", "coin": coin, "startTime": t}).encode(),
                    headers={"content-type": "application/json"})
        rows = json.loads(b) if st == 200 else []
        if not rows:
            break
        out += rows
        nt = rows[-1]["time"] + 1
        if nt <= t or len(rows) < 500:
            break
        t = nt
        time.sleep(0.3)
    return out


def okx(coin):
    out, after = [], None
    for _ in range(40):
        url = f"https://www.okx.com/api/v5/public/funding-rate-history?instId={coin}-USDT-SWAP&limit=100" + (f"&after={after}" if after else "")
        _, j = get_json(url)
        d = (j or {}).get("data") or []
        if not d:
            break
        out += d
        after = d[-1]["fundingTime"]
        time.sleep(0.25)
    return out


def main():
    res = {}
    for coin in COINS:
        ok = okx(coin)
        if not ok:
            res[coin] = {"skipped": "no OKX history"}
            continue
        start = min(int(r["fundingTime"]) for r in ok)
        h = hl(coin, start)
        open(os.path.join(INP, f"okx_{coin}.json.gz"), "wb").write(gzip.compress(json.dumps(ok, sort_keys=True).encode(), mtime=0))
        open(os.path.join(INP, f"hl_{coin}.json.gz"), "wb").write(gzip.compress(json.dumps(h, sort_keys=True).encode(), mtime=0))
        day = lambda ms: dt.datetime.utcfromtimestamp(int(ms) / 1000).date()
        fo, fh = {}, {}
        for r in ok:
            fo[day(r["fundingTime"])] = fo.get(day(r["fundingTime"]), 0) + float(r.get("realizedRate") or r["fundingRate"])
        for r in h:
            fh[day(r["time"])] = fh.get(day(r["time"]), 0) + float(r["fundingRate"])
        days = sorted(set(fo) & set(fh))[1:-1]  # whole days only
        D = [fh[d] - fo[d] for d in days]
        r = {"days": len(days), "from": str(days[0]), "to": str(days[-1]),
             "mean_D_bps_day": round(1e4 * sum(D) / len(D), 3), "mean_abs_D_bps_day": round(1e4 * sum(abs(x) for x in D) / len(D), 3),
             "hl_mean_bps_day": round(1e4 * sum(fh[d] for d in days) / len(days), 3),
             "okx_mean_bps_day": round(1e4 * sum(fo[d] for d in days) / len(days), 3), "rules": {}}
        for tau in (0.0002, 0.0005, 0.001):
            pos, pnl, trades, held = 0, 0.0, 0, 0
            for i in range(7, len(days)):
                m = sum(D[i - 7:i]) / 7
                want = 1 if m > tau else -1 if m < -tau else 0
                if want != pos:
                    pnl -= 0.0019 * (abs(pos) + abs(want)) / 2 * (2 if pos and want else 1)
                    trades += 1
                    pos = want
                pnl += pos * D[i]
                held += abs(pos)
            r["rules"][f"tau{tau*1e4:g}bp"] = {"pnl_bps_on_notional": round(1e4 * pnl, 1), "changes": trades, "days_held": held,
                                               "annualised_pct": round(100 * pnl * 365 / max(len(days) - 7, 1), 2)}
        res[coin] = r
        print(coin, r)
    json.dump(res, open(os.path.join(HERE, "results", "funding_xvenue.json"), "w"), indent=1, sort_keys=True)


if __name__ == "__main__":
    main()
