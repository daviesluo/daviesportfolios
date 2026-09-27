"""WXSRC A2c (exploration month only): the Hong Kong markets — when their stale side is taken, against when the
Observatory's own keyless running maximum and minimum showed the value that decided each bucket.

PMLATE left the Hong Kong events out (they resolve on the Observatory, not on a METAR). The sample is PMLATE's
exploration month, already read: the closed Hong Kong events with a target date 2026-09-01 → 09-26 and their prints
(`$PMLATE_DATA`), and `hko_archive.py`'s capture of the Observatory's "maximum and minimum air temperature from
1-minute mean temperatures since midnight" (`$WXSRC_DATA/hko/`), whose version for the ten-minute slot ending at s was
public by its capture instant (the live poll, `results/live_latency.json`, puts the file's Last-Modified about 7 minutes
after s and its first public sighting about 8½).

* The day's value: the HK Observatory row of each slot of the local day (the slot at 00:00 still carries the previous
  day's full maximum and minimum; the next day's 00:00 slot gives this day's), and the running max (highest) or min
  (lowest). The Daily Extract resolves on the same 0.1 °C value, and a whole-degree bucket k holds [k.0, k.9] (the
  basis check below confirms both on every resolved event).
* A bucket is "dead" at the first slot whose running value puts floor(value) outside it (above hi for a high, below lo
  for a low) and "locked" at the first slot that makes an open-ended bucket certain; "informative" when the last print
  in the hour before that slot's time still gave it a chance (YES >= 0.05 dead, <= 0.95 locked); a "trap" when the
  market resolved against it.
* Stale prints as PMLATE defines them; net edge after the market's own fee. Timed against the slot time s (the end of
  the ten minutes in which the value was reached) and the capture instant c.

usage: hko_edge.py <out json>   (reads $PMLATE_DATA and $WXSRC_DATA)
"""
import bisect
import glob
import gzip
import json
import math
import os
import statistics
import sys
from collections import Counter, defaultdict
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import wxcommon as X  # noqa: E402

PM = os.environ.get("PMLATE_DATA")
HKT = ZoneInfo("Asia/Hong_Kong")
L_GRID = [-600, -300, -120, -60, 0, 60, 120, 240, 300, 420, 480, 540, 600, 660, 720, 900, 1200, 1800, 3600]


def load(p):
    with gzip.open(p, "rt") as f:
        return json.load(f)


def fee(rate, y):
    return rate * y * (1 - y)


def yes_dir(side, oi, price):
    if oi == 0:
        return side, price
    if oi == 1:
        return ("SELL" if side == "BUY" else "BUY"), 1.0 - price
    return None, None


def series():
    """{date: [(slot_ts, capture_ts, max, min)] for the slots inside that local day, and the next day's 00:00 slot}"""
    rows = []
    for p in sorted(glob.glob(os.path.join(X.DATA, "hko", "sincemidnight_*.json.gz"))):
        rows += [r for r in load(p)["rows"] if r.get("slot_ts")]
    by_slot = {}
    for r in rows:   # a slot captured twice keeps its first capture
        if r["slot"] not in by_slot or r["capture_ts"] < by_slot[r["slot"]]["capture_ts"]:
            by_slot[r["slot"]] = r
    out = defaultdict(list)
    for slot, r in sorted(by_slot.items()):
        dt = datetime.strptime(slot, "%Y%m%d%H%M").replace(tzinfo=HKT)
        day = (dt - timedelta(minutes=1)).strftime("%Y-%m-%d") if dt.hour == 0 and dt.minute == 0 else dt.strftime("%Y-%m-%d")
        out[day].append((r["slot_ts"], r["capture_ts"], r["max"], r["min"]))
    return out


def state_of(hl, b, v):
    lo, hi = b
    k = math.floor(v + 1e-9)
    if hl == "highest":
        if hi is not None and k > hi:
            return "dead"
        if hi is None and lo is not None and k >= lo:
            return "locked"
    else:
        if lo is not None and k < lo:
            return "dead"
        if lo is None and hi is not None and k <= hi:
            return "locked"
    return None


def main():
    outp = sys.argv[1]
    ser = series()
    ev = load(os.path.join(PM, "univ", "events_2026-09-01_2026-09-27.json.gz"))["events"]
    basis = Counter()
    basis_rows = []
    deaths = []
    vol = 0.0
    n_ev = 0
    for e in sorted(ev.values(), key=lambda x: (x["date"], x["event"])):
        if e.get("station") != "HKO" or not e.get("closed") or not ("2026-09-01" <= e["date"] <= "2026-09-26"):
            continue
        pth = os.path.join(PM, "prints", f"ev_{e['event']}.json.gz")
        sl = ser.get(e["date"])
        if not os.path.exists(pth) or not sl:
            continue
        n_ev += 1
        vol += sum(float(b.get("vol") or 0) for b in e["buckets"])
        idx = 2 if e["hl"] == "highest" else 3
        # the day's slots in order; the last one (next day's 00:00) carries the full day's value
        run, cur = [], None
        for s_ts, c_ts, mx, mn in sl:
            v = mx if idx == 2 else mn
            if v is None:
                continue
            cur = v if cur is None else (max(cur, v) if idx == 2 else min(cur, v))
            run.append((s_ts, c_ts, v, cur))
        final = run[-1][3] if run else None
        win = [b for b in e["buckets"] if b["payout_yes"] == 1.0]
        if win and final is not None:
            ok = state_of(e["hl"], win[0]["bucket"], final) is None and (
                (win[0]["bucket"][0] is None or math.floor(final + 1e-9) >= win[0]["bucket"][0]) and
                (win[0]["bucket"][1] is None or math.floor(final + 1e-9) <= win[0]["bucket"][1]))
            basis["agree" if ok else "disagree"] += 1
            if not ok:
                basis_rows.append([e["event"], e["date"], e["hl"], final, win[0]["bucket"]])
        rows = load(pth)["rows"]
        by_cond = defaultdict(list)
        for r in rows:
            by_cond[r[1]].append(r)
        for b in e["buckets"]:
            prs = sorted(by_cond.get(b["cond"], []))
            if not prs:
                continue
            st_, s_ts, c_ts = None, None, None
            for s0, c0, v, rr in run:
                k_ = state_of(e["hl"], b["bucket"], rr)
                if k_:
                    st_, s_ts, c_ts = k_, s0, c0
                    break
            if not st_:
                continue
            tss = [r[0] for r in prs]
            i = bisect.bisect_left(tss, s_ts)
            pre = [r for r in prs[:i] if r[0] >= s_ts - 3600]
            pre_y = yes_dir(pre[-1][2], pre[-1][3], pre[-1][4])[1] if pre else None
            informative = pre_y is not None and ((st_ == "dead" and pre_y >= 0.05) or (st_ == "locked" and pre_y <= 0.95))
            won = b["payout_yes"] == 1.0
            wrong = (st_ == "dead" and won) or (st_ == "locked" and not won)
            rate = b.get("fee_rate") if b.get("fee_rate") is not None else 0.05
            stale = []
            for r in prs:
                if r[0] < s_ts - 3600:
                    continue
                d, y = yes_dir(r[2], r[3], r[4])
                if d is None or not ((st_ == "dead" and d == "SELL") or (st_ == "locked" and d == "BUY")):
                    continue
                g = y if st_ == "dead" else 1 - y
                stale.append((r[0] - s_ts, r[5], g, g - fee(rate, y), r[6]))
            deaths.append({"event": e["event"], "date": e["date"], "hl": e["hl"], "bucket": b["bucket"],
                           "state": st_, "slot": s_ts, "capture": c_ts, "informative": informative, "wrong": wrong,
                           "pre_y": pre_y, "stale": stale})
    held = [d for d in deaths if not d["wrong"]]
    inf = [d for d in held if d["informative"]]

    def left(L, group, rel="slot"):
        tot = 0.0
        for d in group:
            off = 0.0 if rel == "slot" else d["capture"] - d["slot"]
            tot += sum(sz * max(net, 0.0) for dt, sz, g, net, w in d["stale"] if dt >= off + L)
        return round(tot, 2)
    first, wallets = [], Counter()
    for d in inf:
        f = next(((dt, w) for dt, sz, g, net, w in d["stale"] if dt >= -600 and g >= 0.01), None)
        if f:
            first.append(f[0])
            wallets[f[1]] += 1
    res = {"sample": "closed Hong Kong events, target dates 2026-09-01 → 09-26 (PMLATE's exploration month)",
           "events": n_ev, "volume_usd": round(vol, 2), "basis": dict(basis), "basis_disagreements": basis_rows,
           "bucket_deaths": {"informative_held": len(inf), "other_held": len(held) - len(inf),
                             "trap": len(deaths) - len(held)},
           "capture_after_slot_s": X.pct([d["capture"] - d["slot"] for d in deaths]),
           "first_stale_print_vs_slot_s_informative": X.pct(first),
           "first_stale_print_before_slot_share": round(sum(1 for x in first if x < 0) / len(first), 4) if first else None,
           "first_stale_print_before_capture_share": round(sum(
               1 for d in inf for f in [next((dt for dt, sz, g, net, w in d["stale"] if dt >= -600 and g >= 0.01), None)]
               if f is not None and f < d["capture"] - d["slot"]) / len(first), 4) if first else None,
           "first_stale_print_wallets_top": wallets.most_common(8),
           "net_edge_hour_before_slot_usd_informative": round(sum(
               sz * max(net, 0.0) for d in inf for dt, sz, g, net, w in d["stale"] if dt < 0), 2),
           "net_edge_left_after_slot_usd": {"informative_held": {str(L): left(L, inf) for L in L_GRID},
                                            "all_held": {str(L): left(L, held) for L in L_GRID}},
           "net_edge_left_after_capture_usd": {"informative_held": {str(L): left(L, inf, "capture") for L in (0, 1, 5, 30, 60, 300)},
                                               "all_held": {str(L): left(L, held, "capture") for L in (0, 1, 5, 30, 60, 300)}},
           "by_kind": {hl: {"informative_held": sum(1 for d in inf if d["hl"] == hl),
                            "edge_after_slot_0": round(sum(sz * max(net, 0.0) for d in held if d["hl"] == hl
                                                           for dt, sz, g, net, w in d["stale"] if dt >= 0), 2),
                            "edge_after_capture": round(sum(sz * max(net, 0.0) for d in held if d["hl"] == hl
                                                            for dt, sz, g, net, w in d["stale"]
                                                            if dt >= d["capture"] - d["slot"]), 2)}
                       for hl in ("highest", "lowest")}}
    # USLATE's fill model (half of each stale print with g >= 1¢, $100 a bucket, the fee, held) from three instants,
    # each + ACT_S (a 1 s poll, 0.25 s dispatch, prints stamped 3 s later: USLATE-FAST's conventions): the capture
    # (the archive's own clock, an upper bound); the slot + the live poll's median first sighting of a new version
    # (when the public file actually changed, `results/live_latency.json`); and the slot + the live median
    # Last-Modified (a reader who had the file the moment the origin wrote it, which the public endpoint did not allow)
    live = json.load(open(os.path.join(X.RESULTS, "live_latency.json")))
    seen_s = live["summary"]["hko_max"]["seen_after_s"]["p50"]
    lm_s = statistics.median(live["last_modified_after_data_s"]["hko_max"].values())
    res["live_public_after_slot_s"] = {"first_seen_p50": seen_s, "last_modified_median": lm_s}
    res["net_edge_left_after_live_public_usd"] = {"informative_held": left(seen_s + 4.25, inf),
                                                  "all_held": left(seen_s + 4.25, held)}

    def capture_pnl(d, start):
        cost = pnl = 0.0
        filled = False
        for dt, size, g, net, w in d["stale"]:
            if dt < start or g < 0.01:
                continue
            sh = size / 2.0
            c = 1.0 - g
            if c <= 0:
                continue
            if cost + sh * c > 100.0:
                sh = (100.0 - cost) / c
            if sh <= 0:
                break
            filled = True
            fee_ = g - net
            cost += sh * c
            pnl += sh * ((-(1.0 - g) - fee_) if d["wrong"] else (g - fee_))
            if cost >= 100.0 - 1e-9:
                break
        return pnl, cost, filled
    ndays = len({d["date"] for d in deaths})
    arms = {}
    act = 1.0 + 0.25 + 3.0
    for name, start_of in (("archive_capture", lambda d: d["capture"] - d["slot"] + act),
                           ("live_first_seen", lambda d: seen_s + act),
                           ("live_last_modified", lambda d: lm_s + act)):
        by_date = defaultdict(float)
        n_b, cost_t = 0, 0.0
        for d in deaths:
            pnl, cost, filled = capture_pnl(d, start_of(d))
            if filled:
                n_b += 1
                cost_t += cost
                by_date[d["date"]] += pnl
        tot = sum(by_date.values())
        xs = [by_date.get(dd, 0.0) for dd in sorted({d["date"] for d in deaths})]
        mean = tot / ndays if ndays else 0.0
        sd = (sum((x - mean) ** 2 for x in xs) / len(xs)) ** 0.5 if xs else 0.0
        best = max(by_date.items(), key=lambda kv: kv[1]) if by_date else (None, 0.0)
        arms[name] = {"buckets_filled": n_b, "dates": len(by_date), "pnl_usd": round(tot, 2), "cost_usd": round(cost_t, 2),
                      "per_day_usd": round(mean, 2), "sd_per_day_usd": round(sd, 2), "best_date": best[0],
                      "best_date_share": round(best[1] / tot, 3) if tot > 0 else None}
    res["uslate_fill_model"] = {"days": ndays, "arms": arms}
    with open(outp, "w") as f:
        json.dump(res, f, indent=1, sort_keys=True)
        f.write("\n")
    print(json.dumps({k: v for k, v in res.items() if k not in ("net_edge_left_after_slot_usd",)}, indent=1)[:4000])
    print("left after slot (all held):", res["net_edge_left_after_slot_usd"]["all_held"])


if __name__ == "__main__":
    main()
