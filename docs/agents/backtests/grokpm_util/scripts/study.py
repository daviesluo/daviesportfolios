"""GROKPM utilisation study (2026-10-28), step 2: what looser rules would have done, from the agent's own shadow
forecasts and the public tape.

Run from the repository root:  python3 -I docs/agents/backtests/grokpm_util/scripts/study.py > docs/agents/backtests/grokpm_util/results/study.txt

Inputs
  data/rows.txt        the shadow forecasts (and the agent's own opens) of the twelve markets whose books were two-sided at some
                       forecast and whose p cleared 5 points over m, from sql/rows.sql: a row a time p or m changed:
                       MMDDHHMI|p|m|category|book bid|book ask|bid depth within 5 points ($, 0.. from 10-26 03:10 UTC)|last trade|action
  data/markets.json    each market's condition id, the token the agent priced, a label
  data/public.json.gz  scripts/fetch.py: Gamma outcomes and the data API's taker prints (back to 2026-10-24)

The model (each piece is a choice, and the review says which way it errs)
  - A candidate rule set bids at a row if every gate it keeps passes: edge p - m at or over its bar (the server reads
    the dearer of the order's price and the mid; the bid is at or under the mid, so the mid decides), the price in
    [0.05, 0.90) outside category A, a two-sided book of spread 5 points or under, and either a deep book (ordinary
    path: $500 of bids within 5 points, size at most $10) or the D15 path (category B, size at most min(cap, a quarter of
    the depth), at most N such markets, the whole bid before the cut). A depth the record did not keep (before 10-26) is
    treated as "enough for the cap": that errs generous.
  - One event, one cap (D17): outcomes sharing a negative-risk id share the cap; only the first to pass bids.
  - The bid sits at the mid rounded down to half a cent, not under the book's best bid. Its size is a quarter Kelly of $100
    at p and the bid, within the cap, at least the venue's 5 shares or refused.
  - Fill: the public takers' prints, from the row's time to the end of the bid's life. A print fills a bid at b if it sells
    the token at b or under, or buys the other outcome at 1 - b or over. Two lives: "wake" (one 65-minute bid, D16) and
    "rest" (kept while the agent's rows still pass the edge, to the cut or the market's end: generous). The queue ahead of
    the bid is not modelled: that errs generous.
  - Outcome: the market's payout once closed, else the token's Gamma price at the read. Held to the end; maker fees 0.
"""
import gzip
import json
import math
import os
import time

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "..", "data")
PUB = json.load(gzip.open(os.path.join(DATA, "public.json.gz")))
MK = json.load(open(os.path.join(DATA, "markets.json")))
READ_AT = PUB["read_at"]
EQUITY = 100.0
EVENT = {"0x3c492d38": "korea", "0xd15a63ed": "korea", "0x62ee1bfa": "korea", "0x8f62c057": "vertiv", "0x65736448": "vertiv",
         "0xbba373b5": "banrep", "0x2e8f33b8": "banrep"}  # Gamma's negRiskMarketID, read in fetch.py
EVENT_AT = {"0x8f62c057": "2026-10-28T09:00:00Z", "0x65736448": "2026-10-28T09:00:00Z"}  # Vertiv's earnings (the cut Grok's orders carried)
D15_LIVE = "2026-10-26T02:45:00Z"
WINDOW = "2026-10-24T08:12:00Z"  # the first forecast with a recorded book


def ts(s):
    s = s.replace("Z", "")
    return time.mktime(time.strptime(s[:19], "%Y-%m-%dT%H:%M:%S")) - time.timezone


def row_ts(x):
    return ts(f"2026-{x[0:2]}-{x[2:4]}T{x[4:6]}:{x[6:8]}:00")


def load_rows():
    out = {}
    for line in open(os.path.join(DATA, "rows.txt")):
        k, rest = line.strip().split("|", 1)
        rows = []
        for r in rest.split(";"):
            a = r.split("|")
            rows.append({"t": row_ts(a[0]), "p": float(a[1]), "m": float(a[2]), "cat": a[3],
                         "bb": float(a[4]) if a[4] else None, "ba": float(a[5]) if a[5] else None,
                         "bd": float(a[6]) if a[6] != "" else None, "lt": float(a[7]) if a[7] else None, "act": a[8]})
        out[k] = rows
    return out


def market_info(k):
    g = PUB["markets"][k]["gamma"]
    token = PUB["markets"][k]["token"]
    ids = json.loads(g["clobTokenIds"])
    i = ids.index(token)
    prices = [float(x) for x in json.loads(g["outcomePrices"])]
    closed = bool(g["closed"])
    end = ts(g["endDate"]) if g.get("endDate") else None
    closed_at = ts(g["closedTime"].replace(" ", "T")[:19]) if g.get("closedTime") else None
    return {"i": i, "price": prices[i], "closed": closed and prices[i] in (0.0, 1.0), "end": end, "closed_at": closed_at, "token": token,
            "other": ids[1 - i]}


def qualifying(k, info, b, t0, t1):
    """The size of public takers' prints that would fill a bid at b between t0 and t1, first print time."""
    tot, first = 0.0, None
    for x in sorted(PUB["markets"][k]["trades"], key=lambda y: y["timestamp"]):
        if x["timestamp"] <= t0 or x["timestamp"] > t1:
            continue
        hit = (x["asset"] == info["token"] and x["side"] == "SELL" and x["price"] <= b + 1e-9) or \
              (x["asset"] == info["other"] and x["side"] == "BUY" and x["price"] >= 1 - b - 1e-9)
        if hit:
            tot += x["size"]
            first = first or x["timestamp"]
    return tot, first


def floor_half_cent(x):
    return math.floor(x / 0.005 + 1e-9) * 0.005


class Rules:
    def __init__(self, name, bar_a=0.08, bar_b=0.12, d15_cap=5.0, d15_markets=3, cut_h=48, d15_a=False, ordinary_cap=10.0,
                 start=D15_LIVE, depth_min=500.0, d15=True, d17=True):
        self.__dict__.update(locals())


def run(rules, rows, life):
    """Returns the trades one rule set would have made: a list of dicts."""
    trades, open_d15 = [], []
    ev_cost = {}
    t_start = ts(rules.start)
    order = []
    # a market's candidate entry: its first passing row
    for k, rs in rows.items():
        info = market_info(k)
        for j, r in enumerate(rs):
            if r["t"] < max(t_start, ts(WINDOW)):
                continue
            if info["end"] and r["t"] >= info["end"]:
                continue
            bar = rules.bar_a if r["cat"] == "A" else rules.bar_b
            if r["bb"] is None or r["ba"] is None or r["ba"] - r["bb"] > 0.05 + 1e-9:
                continue
            mid = (r["bb"] + r["ba"]) / 2  # the server reads the book's mid, not the agent's m
            if r["p"] - max(mid, mid) < bar - 1e-9:
                continue
            b = max(r["bb"], floor_half_cent(mid))
            b = min(b, mid)
            if b < 0.05 or (r["cat"] != "A" and b >= 0.90):
                continue
            kelly = 0.25 * (r["p"] - b) / (1 - b) * EQUITY
            deep = r["bd"] is not None and r["bd"] >= rules.depth_min
            if deep:
                cap, path = rules.ordinary_cap, "ordinary"
            else:
                if not rules.d15 or (r["cat"] != "B" and not rules.d15_a):
                    continue
                cap = rules.d15_cap if r["bd"] is None else min(rules.d15_cap, 0.25 * r["bd"])
                path = "d15" if r["bd"] is not None else "d15 (depth unknown)"
            usd = min(max(kelly, 5 * b), cap)
            shares = math.floor(usd / b + 1e-9)
            if shares < 5:
                continue
            ev_at = ts(EVENT_AT[k]) if k in EVENT_AT else info["end"]
            cut = (min(info["end"], ev_at) if info["end"] else ev_at) - rules.cut_h * 3600
            if path.startswith("d15") and r["t"] + (life if life else 0) >= cut:
                continue
            # when does the bid stop? "wake": one 65-minute bid; "rest": the bid follows the agent's rows (re-placed at each
            # row's mid while the edge still passes), to the cut or the market's end
            if life:
                t_end = min(r["t"] + life, cut if path.startswith("d15") else 1e18)
                segs = [(r["t"], t_end, b)]
            else:
                t_end = cut if path.startswith("d15") else (info["end"] or 1e18)
                if info["closed_at"]:
                    t_end = min(t_end, info["closed_at"])
                segs, cur = [], None
                for r2, nxt in zip(rs[j:], rs[j + 1:] + [None]):
                    bar2 = rules.bar_a if r2["cat"] == "A" else rules.bar_b
                    mid2 = (r2["bb"] + r2["ba"]) / 2 if r2["bb"] is not None and r2["ba"] is not None else r2["m"]
                    if r2["p"] - mid2 >= bar2 - 1e-9:
                        if r2["bb"] is not None and r2["ba"] is not None and r2["ba"] - r2["bb"] <= 0.05 + 1e-9:
                            cur = min(max(r2["bb"], floor_half_cent(mid2)), mid2)
                        # a row with no book keeps the last price
                    else:
                        cur = None
                    s0, s1 = r2["t"], min(nxt["t"] if nxt else 1e18, t_end)
                    if cur is not None and cur >= 0.05 and (r["cat"] == "A" or cur < 0.90) and s0 < s1:
                        segs.append((s0, s1, cur))
            if info["closed_at"]:
                t_end = min(t_end, info["closed_at"])
            order.append({"k": k, "t": r["t"], "b": b, "shares": shares, "path": path, "t_end": t_end, "p": r["p"], "m": r["m"],
                          "cat": r["cat"], "bd": r["bd"], "cut": cut, "segs": segs})
            break
    # one event, one cap (D17: held at cost plus resting bids plus the order); at most N D15 markets at once, by order time
    order.sort(key=lambda o: o["t"])
    resv = []  # (event, from, until, cost)
    for o in order:
        ev = EVENT.get(o["k"], o["k"]) if rules.d17 else o["k"]
        info = market_info(o["k"])
        cost = o["b"] * o["shares"]
        cap_here = rules.d15_cap if o["path"].startswith("d15") else rules.ordinary_cap
        if sum(c for (e, a, u, c) in resv if e == ev and a <= o["t"] < u) + cost > cap_here + 1e-9:
            continue
        if o["path"].startswith("d15"):
            live = [x for x in open_d15 if x["from"] <= o["t"] < x["until"]]
            if len(live) >= rules.d15_markets:
                continue
        fill, first, spent = 0.0, None, 0.0
        for (s0, s1, bb_) in o["segs"]:
            got, f1 = qualifying(o["k"], info, bb_, s0, s1)
            take = min(o["shares"] - fill, got)
            if take > 0:
                fill += take
                spent += take * bb_
                first = first or f1
            if fill >= o["shares"] - 1e-9:
                break
        o = {**o, "b_avg": (spent / fill) if fill else o["b"]}
        hold_until = (info["closed_at"] or info["end"] or 1e18)
        last_seg = max([s1 for (_s0, s1, _b) in o["segs"]], default=o["t"])  # a bid the agent let lapse stops holding a slot
        if fill > 0:
            resv.append((ev, o["t"], first, cost))
            resv.append((ev, first, hold_until, o["b_avg"] * fill))
        else:
            resv.append((ev, o["t"], last_seg, cost))
        if o["path"].startswith("d15"):
            open_d15.append({"from": o["t"], "until": hold_until if fill > 0 else last_seg})
        trades.append({**o, "fill": fill, "first": first, "event": ev,
                       "pnl": fill * (info["price"] - o["b_avg"]),
                       "closed": info["closed"], "price_now": info["price"]})
    return trades


def fmt_t(t):
    return time.strftime("%m-%d %H:%M", time.gmtime(t))


# The repository is public: the account's real fills (size, price, P&L) are `[•]`. The replay of a market the agent really
# traded would print the same numbers, so those three lines show only the path and the fill time, and the totals below
# count the other markets alone ("added") and the most held at once as a whole percent of the $100 budget.
TRADED = {"0x8f62c057", "0xbba373b5", "0x2e8f33b8"}


def show(rules, rows, life, label):
    tr = run(rules, rows, life)
    filled = [x for x in tr if x["fill"] > 0]
    print(f"\n{rules.name} [{label}]  bids {len(tr)}, filled {len(filled)}")
    for x in tr:
        what = f"{x['path'][:9]:9} bid {fmt_t(x['t'])}"
        when = f"at {fmt_t(x['first'])}" if x["first"] else "          "
        if x["k"] in TRADED:
            print(f"   {MK[x['k']][2][:44]:44} {what}  size, price, fill and pnl [•] (the agent traded it)   filled: {'yes ' + when if x['fill'] > 0 else 'no'}")
            continue
        print(f"   {MK[x['k']][2][:44]:44} {what} @{x['b']:.3f} x{x['shares']:>3} ({x['b'] * x['shares']:.2f}) p {x['p']:.2f} "
              f"fill {x['fill']:>5.1f} {when} {'RESOLVED' if x['closed'] else 'open@%.3f' % x['price_now']} pnl {x['pnl']:+.2f}")
    # the most the filled positions held at once, at cost: the worst case if every one of them had lost
    ev = []
    for x in filled:
        info = market_info(x["k"])
        c = x["b_avg"] * x["fill"]
        ev.append((x["first"], c))
        ev.append(((info["closed_at"] or ts(READ_AT)), -c))
    peak = cur_c = 0.0
    for _t, c in sorted(ev):
        cur_c += c
        peak = max(peak, cur_c)
    print(f"   most held at once (cost): {peak / EQUITY * 100:.0f} % of the budget")
    added = [x for x in filled if x["k"] not in TRADED]
    res = [x for x in added if x["closed"]]
    print(f"   added (markets the agent did not trade): {len(added)} filled, cost {sum(x['b_avg'] * x['fill'] for x in added):.2f}, "
          f"paper pnl {sum(x['pnl'] for x in added):+.2f}, resolved {len(res)} ({sum(1 for x in res if x['pnl'] > 0)} won)")
    return tr


def main():
    rows = load_rows()
    print(f"read at {READ_AT}; rows for {len(rows)} markets; book-era window from {WINDOW}")
    sets = [
        Rules("V0 check: D15 as it ran 10-26 to 10-28 (no D17 yet), live from 10-26 02:45", start=D15_LIVE, d17=False),
        Rules("K0 current rules (A 8, B 12, D15 $5 x3 markets, cut 48 h, D17), live from 10-26 02:45", start=D15_LIVE),
        Rules("K0r the same rules, had they been live from the first recorded book", start=WINDOW),
        Rules("K1 B 10", bar_b=0.10, start=WINDOW), Rules("K2 B 8", bar_b=0.08, start=WINDOW),
        Rules("K3 B 6", bar_b=0.06, start=WINDOW), Rules("K4 B 5", bar_b=0.05, start=WINDOW),
        Rules("K5 D15 cap $10", d15_cap=10.0, start=WINDOW),
        Rules("K6 D15 markets 6", d15_markets=6, start=WINDOW),
        Rules("K7 D15 cut 24 h", cut_h=24, start=WINDOW), Rules("K8 D15 no cut", cut_h=0, start=WINDOW),
        Rules("K9 B 8 + cap $10 + 6 markets + cut 24 h", bar_b=0.08, d15_cap=10.0, d15_markets=6, cut_h=24, start=WINDOW),
    ]
    for r in sets:
        for life, label in ((65 * 60, "wake: one 65-minute bid"), (0, "rest: kept while rows pass")):
            show(r, rows, life, label)


if __name__ == "__main__":
    main()
