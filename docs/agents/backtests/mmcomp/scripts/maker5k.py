# MMCOMP part 3: the book's dominant resting order, the "$5,000 maker". Its orders are one order a level of 5,000 coins plus a
# small amount that drifts with the coin's USD price (USDT-GBP 5,000.9 -> 5,007.5 as Revolut X's USDT-USD sits 10-15 bps under
# par: $5,000 at that price), so a level of one order sized 4,999.5-5,010 coins is taken as one of its orders. Day by day, from
# the committed snapshots (2026-09-26 -> 10-29):
#   present  share of snapshots with at least one such order on each side within the five levels shown
#   at_touch share of snapshot-sides where the best level is one of its orders
#   mspread  its own spread: best such ask minus best such bid, ticks (median of snapshots that show both)
#   ladder   how many of its orders the five levels a side show (median, both sides together)
#   vs_fair  its best bid and best ask against fair (PR5's fairU / GBP/USD), median bps
# python3 -I docs/agents/backtests/mmcomp/scripts/maker5k.py   -> results/maker5k.json
import collections, json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.dont_write_bytecode = True
import load as L

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "results", "maker5k.json")
fx = L.gbpusd()


def is5k(level):
    p, q, o = level
    return o == 1 and 4999.5 <= q <= 5010


def study(bk):
    usd = L.usd(bk)
    days = collections.defaultdict(lambda: {"n": 0, "pb": 0, "pa": 0, "tb": 0, "ta": 0, "ms": [], "lad": [], "fb": [], "fa": [], "hours": collections.Counter(), "hn": collections.Counter()})
    for t, bids, asks in L.book(bk):
        if not bids or not asks:
            continue
        d = days[L.day(t)]
        d["n"] += 1
        mb = [l for l in bids if is5k(l)]
        ma = [l for l in asks if is5k(l)]
        d["pb"] += bool(mb); d["pa"] += bool(ma)
        d["tb"] += is5k(bids[0]); d["ta"] += is5k(asks[0])
        h = (t // 3_600_000) % 24
        d["hn"][h] += 1
        d["hours"][h] += is5k(bids[0]) + is5k(asks[0])
        d["lad"].append(len(mb) + len(ma))
        x, u = fx.at(t), usd.at(t)
        if mb and ma:
            d["ms"].append(round((ma[0][0] - mb[0][0]) / L.TICK))
        if x and u:
            f = u / x
            if mb: d["fb"].append(L.bps(mb[0][0], f))
            if ma: d["fa"].append(L.bps(ma[0][0], f))
    out = {}
    for k in sorted(days):
        d = days[k]
        n = d["n"]
        out[k] = {"snaps": n, "present_bid": round(d["pb"] / n, 2), "present_ask": round(d["pa"] / n, 2),
                  "at_touch": round((d["tb"] + d["ta"]) / (2 * n), 2), "mspread_ticks": L.median(d["ms"]),
                  "ladder": L.median(d["lad"]), "bid_vs_fair": r(L.median(d["fb"])), "ask_vs_fair": r(L.median(d["fa"]))}
    # hour-of-day presence at the touch over the weekdays
    hrs = collections.Counter(); hn = collections.Counter()
    import datetime
    for k, d in days.items():
        if datetime.date.fromisoformat(k).weekday() < 5:
            hrs.update(d["hours"]); hn.update(d["hn"])
    return {"days": out, "weekday_touch_share_by_utc_hour": {h: round(hrs[h] / (2 * hn[h]), 2) for h in sorted(hn)}}


def r(x):
    return None if x is None else round(x, 2)


res = {b: study(b) for b in ("USDC-GBP", "USDT-GBP")}
json.dump(res, open(OUT, "w"), indent=0, sort_keys=True)
for b, v in res.items():
    print(b, "weekday touch share by UTC hour:", v["weekday_touch_share_by_utc_hour"])
    for k, d in v["days"].items():
        print(k, d)
