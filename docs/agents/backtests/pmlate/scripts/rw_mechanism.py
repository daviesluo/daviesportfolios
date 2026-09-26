"""PMLATE step 1b: the mechanism on RW's own same-day temperature market-days.

For every event behind a temperature market RW quoted on the day it ended (from `rw_events.py`): the station's reports
through the local day (IEM, with AWC's receipt instants), the minute the running extreme made each bucket impossible
("dead") or certain ("locked"), and every print of every bucket (the data API) set against those instants: the stale
side (a taker selling a dead bucket's YES or buying its NO; buying a locked bucket's YES or selling its NO), how soon
after the report became public, at what price and how much. Writes $PMLATE_DATA/rw/mechanism.json and prints a table.

A bucket is [lo, hi] in whole degrees of the market's unit (None = open). For a high, the running maximum M after a
report kills every bucket with hi < M and locks an "X or higher" bucket once M >= X; for a low, the running minimum m
kills every bucket with lo > m and locks an "X or below" bucket once m <= X. The day is the station's local civil day.
"""
import json
import os
import sys
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as C  # noqa: E402
import metar as W  # noqa: E402
from stations import tz_of  # noqa: E402


def state_after(hl, b, run):
    """'dead', 'locked' or None for bucket b = [lo, hi] given the running extreme `run`."""
    lo, hi = b
    if hl == "highest":
        if hi is not None and run > hi:
            return "dead"
        if hi is None and lo is not None and run >= lo:
            return "locked"
    else:
        if lo is not None and run < lo:
            return "dead"
        if lo is None and hi is not None and run <= hi:
            return "locked"
    return None


def contains(b, v):
    lo, hi = b
    return (lo is None or v >= lo) and (hi is None or v <= hi)


def yes_px(p):
    """A print as (taker's direction on YES, the YES-equivalent price)."""
    if p["oi"] == 0:
        return p["side"], p["price"]
    if p["oi"] == 1:
        return ("SELL" if p["side"] == "BUY" else "BUY"), 1.0 - p["price"]
    return None, None


def analyse_event(e, cache):
    tz = tz_of(e["station"])
    s, t = W.local_day_bounds(e["date"], tz)
    obs = W.iem(e["station"], C.utc(s) - timedelta(hours=6), C.utc(t) + timedelta(hours=6), os.path.join(cache, "iem"))
    rec = W.awc(e["station"], C.utc(t) + timedelta(hours=6), 60, os.path.join(cache, "awc"))
    receipt = {int(r["obs_ts"]): r["receipt_ts"] for r in rec if r["obs_ts"] and r["receipt_ts"]}
    runs = {k: W.running(obs, e["unit"], e["hl"], s, t, kinds) for k, kinds in
            (("all", ("routine", "special")), ("routine", ("routine",)))}
    run = runs["all"]
    final = run[-1][2] if run else None
    win = [b for b in e["buckets"] if b["payout_yes"] == 1.0]
    out = {"event": e["event"], "city": e["city"], "date": e["date"], "hl": e["hl"], "unit": e["unit"],
           "station": e["station"], "source": e["source"], "tz": tz, "day": [s, t], "reports": len(run),
           "final_all": final, "final_routine": runs["routine"][-1][2] if runs["routine"] else None,
           "winner": win[0]["bucket"] if win else None,
           "agrees": (contains(win[0]["bucket"], final) if (win and final is not None) else None),
           "gaps_h": max([(b2[0] - b1[0]) / 3600 for b1, b2 in zip(run, run[1:])] or [0]),
           "receipt_lag_s": sorted(receipt[int(o[0])] - o[0] for o in run if int(o[0]) in receipt),
           "buckets": []}
    for b in e["buckets"]:
        st_ts, st_kind, st_val = None, None, None
        for ts_, v, r in run:
            k = state_after(e["hl"], b["bucket"], r)
            if k:
                st_ts, st_kind, st_val = ts_, k, r
                break
        pub = receipt.get(int(st_ts)) if st_ts else None
        pr = C.prints_of(b["cond"], os.path.join(cache, "prints"))["prints"]
        rows = []
        for p in pr:
            d, y = yes_px(p)
            if d is None:
                continue
            rows.append((p["ts"], d, y, p["size"], p["wallet"]))
        stale = []
        if st_ts:
            t_pub = pub or st_ts
            for ts_, d, y, sz, w in rows:
                if ts_ < t_pub:
                    continue
                if st_kind == "dead" and d == "SELL":
                    stale.append({"dt": ts_ - t_pub, "yes": y, "size": sz, "edge": y, "wallet": w})
                elif st_kind == "locked" and d == "BUY":
                    stale.append({"dt": ts_ - t_pub, "yes": y, "size": sz, "edge": 1 - y, "wallet": w})
        before = [r for r in rows if st_ts and r[0] < (pub or st_ts)]
        out["buckets"].append({
            "cond": b["cond"], "bucket": b["bucket"], "payout": b["payout_yes"], "closed_time": b["closed_time"],
            "rw": b["cond"] in e["rw_conds"], "state": st_kind, "obs_ts": st_ts, "pub_ts": pub, "value": st_val,
            "prints": len(rows), "prints_before": len(before),
            "last_print": rows[-1][0] if rows else None,
            "stale": stale,
        })
    return out


def main():
    cache = C.DATA
    events = C.load_json(os.path.join(cache, "rw", "events.json"))
    res = [analyse_event(e, cache) for e in sorted(events.values(), key=lambda e: (e["date"], e["city"]))]
    C.dump_json(os.path.join(cache, "rw", "mechanism.json"), res)
    for r in res:
        print(f"\n{r['date']} {r['city']} {r['hl']} {r['unit']} {r['station']} ({r['source']}) reports {r['reports']} "
              f"max gap {r['gaps_h']:.1f} h final {r['final_all']} (routine {r['final_routine']}) winner {r['winner']} "
              f"agrees {r['agrees']} receipt lag med "
              f"{(sorted(r['receipt_lag_s'])[len(r['receipt_lag_s'])//2] if r['receipt_lag_s'] else None)}")
        for b in r["buckets"]:
            st = b["stale"]
            usd = sum(x["size"] * (1 - x["yes"] if b["state"] == "dead" else x["yes"]) for x in st)
            edge = sum(x["size"] * x["edge"] for x in st)
            first = min((x["dt"] for x in st), default=None)
            e1 = [x for x in st if x["edge"] >= 0.01]
            print(f"  {str(b['bucket']):12} pay {b['payout']} {'RW' if b['rw'] else '  '} {str(b['state']):6} "
                  f"obs {C.iso(b['obs_ts'])[11:16] if b['obs_ts'] else '-':5} pub+{(b['pub_ts'] - b['obs_ts']) if b['pub_ts'] else '-'}s "
                  f"prints {b['prints']:4} stale {len(st):3} (edge>=1c {len(e1):3}) ${usd:8.2f} edge ${edge:7.2f} first +{first}s "
                  f"last print {C.iso(b['last_print'])[5:16] if b['last_print'] else '-'}")


if __name__ == "__main__":
    main()
