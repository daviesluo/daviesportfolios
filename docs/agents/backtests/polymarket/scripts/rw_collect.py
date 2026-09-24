"""RW data: a forward record of every rewarded market's book, once a minute (fp4, test RW).

At start: the current liquidity-reward configurations (/rewards/markets/current,
native and sponsored) and, for each rewarded market, its tokens, tick, minimum
size and end date from Gamma (by condition id, 50 a request). The universe is
frozen then: every rewarded market with a total daily rate of at least MIN_RATE
that is accepting orders. Then, until STOP (epoch seconds), once a minute: the
YES book of every universe market (the NO book is its mirror, checked in M1),
kept as the levels within 10 cents of the touch. Public reads only; nothing is
placed. Writes $PM_DATA/rw/universe.json and $PM_DATA/rw/books/<minute>.json.

usage: rw_collect.py <stop epoch seconds>
"""
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(__file__))
import pmnet  # noqa: E402

CLOB = "https://clob.polymarket.com"
GAMMA = "https://gamma-api.polymarket.com"
MIN_RATE = 10.0


def fnum(x, d=0.0):
    try:
        return float(x)
    except (TypeError, ValueError):
        return d


def rewards():
    out = {}
    for spons in ("false", "true"):
        cursor = None
        while True:
            params = {"sponsored": spons}
            if cursor:
                params["next_cursor"] = cursor
            d = pmnet.get(CLOB + "/rewards/markets/current", params)
            for r in d.get("data") or []:
                c = r["condition_id"]
                rate = fnum(r.get("total_daily_rate")) or (fnum(r.get("native_daily_rate")) + fnum(r.get("sponsored_daily_rate")))
                if c not in out or rate > out[c]["rate"]:
                    out[c] = {"rate": rate, "v": fnum(r.get("rewards_max_spread")), "min_size": fnum(r.get("rewards_min_size"))}
            cursor = d.get("next_cursor")
            if not cursor or cursor == "LTE=" or not d.get("data"):
                break
    return out


def universe():
    rw = rewards()
    conds = [c for c, r in rw.items() if r["rate"] >= MIN_RATE and r["v"] > 0]
    uni = {}
    for i in range(0, len(conds), 50):
        chunk = conds[i:i + 50]
        d = pmnet.get(GAMMA + "/markets/keyset", {"condition_ids": chunk, "limit": 100})
        for m in d.get("markets") or []:
            if not (m.get("enableOrderBook") and m.get("acceptingOrders")) or m.get("closed"):
                continue
            try:
                toks = json.loads(m.get("clobTokenIds") or "[]")
            except ValueError:
                continue
            if len(toks) != 2:
                continue
            c = m["conditionId"]
            uni[c] = dict(rw[c], yes=toks[0], tick=fnum(m.get("orderPriceMinTickSize"), 0.01), end=m.get("endDate"),
                          q=(m.get("question") or "")[:100], fee=(m.get("feeSchedule") or {}).get("rate"),
                          cat=m.get("feeType"), neg=bool(m.get("negRisk")),
                          event=((m.get("events") or [{}])[0]).get("slug"))
    return uni


def main():
    stop = float(sys.argv[1])
    base = os.path.join(pmnet.DATA, "rw")
    os.makedirs(os.path.join(base, "books"), exist_ok=True)
    up = os.path.join(base, "universe.json")
    if os.path.exists(up):
        uni = pmnet.load(up)
    else:
        uni = universe()
        pmnet.dump(up, {"t": time.time(), "min_rate": MIN_RATE, "markets": uni})
        uni = {"markets": uni}
    mk = uni["markets"]
    toks = [(c, m["yes"]) for c, m in mk.items()]
    print("universe", len(mk), flush=True)
    while time.time() < stop:
        t0 = time.time()
        minute = int(t0 // 60 * 60)
        path = os.path.join(base, "books", f"{minute}.json")
        if os.path.exists(path):
            # a restarted recorder never rewrites a minute it already has
            while time.time() < minute + 60:
                time.sleep(1)
            continue
        rec = {"t0": t0, "books": {}}
        for i in range(0, len(toks), 100):
            chunk = toks[i:i + 100]
            try:
                res = pmnet.post(CLOB + "/books", [{"token_id": t} for _, t in chunk])
            except RuntimeError as e:
                print("books error", str(e)[:120], flush=True)
                continue
            by = {b.get("asset_id"): b for b in res}
            for c, t in chunk:
                b = by.get(t)
                if not b:
                    continue
                bids = sorted(((fnum(o["price"]), fnum(o["size"])) for o in b.get("bids") or []), key=lambda x: -x[0])
                asks = sorted(((fnum(o["price"]), fnum(o["size"])) for o in b.get("asks") or []), key=lambda x: x[0])
                if not bids or not asks:
                    rec["books"][c] = None
                    continue
                bb, ba = bids[0][0], asks[0][0]
                rec["books"][c] = {"ts": b.get("timestamp"),
                                   "b": [[p, s] for p, s in bids if p >= bb - 0.10 - 1e-9],
                                   "a": [[p, s] for p, s in asks if p <= ba + 0.10 + 1e-9]}
        rec["t1"] = time.time()
        pmnet.dump(path, rec)
        dt = time.time() - t0
        print(time.strftime("%H:%M:%S", time.gmtime()), "books", len(rec["books"]), "secs", round(dt, 1), flush=True)
        nxt = minute + 60
        while time.time() < nxt:
            time.sleep(min(5, max(0.1, nxt - time.time())))


if __name__ == "__main__":
    main()
