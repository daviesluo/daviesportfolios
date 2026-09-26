"""PMLATE step 2 (feasibility, exploration sample only): when the stale side is taken, how much is left, what it costs.

For every closed event of the sample whose station publishes METAR (the Hong Kong Observatory's events are counted
and left out): the local day's reports (IEM, routine and special), each matched to AWC's receipt instant; the running
extreme; for each bucket the first report that made it impossible ("dead") or certain ("locked"), and whether the
market still gave it a chance just before ("informative": the last print in the hour before the report's observation
time put its YES at >= 0.05 for a dead bucket, <= 0.95 for a locked one). Every print of the bucket from then to the
close is classed as stale side (a taker selling a dead bucket's YES or buying its NO; buying a locked bucket's YES or
selling its NO) or not, and timed against the report's observation and receipt. Also the basis check (the final
extreme against the winning bucket) and the capital lock (from the report's receipt to the market's closed time).

Net edge of a stale-side share = its gross edge (a dead bucket's YES price y; a locked bucket's 1 - y) less the
weather taker fee 0.05 × y × (1 - y) — each market's own schedule, read from Gamma (every bucket of the sample
carries rate 0.05, exponent 1).

usage: explore.py <events file> <out json>
"""
import bisect
import json
import os
import sys
from collections import Counter, defaultdict

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as C  # noqa: E402
import metar as W  # noqa: E402
from rw_mechanism import contains, state_after  # noqa: E402
from stations import tz_of  # noqa: E402

THRESH = (0.001, 0.005, 0.01, 0.02, 0.05)
WINDOWS = [("before_obs", None, "obs"), ("obs_to_receipt", "obs", 0), ("r+0_60", 0, 60), ("r+60_120", 60, 120),
           ("r+120_300", 120, 300), ("r+300_3600", 300, 3600), ("r+1h_close", 3600, None)]


def window_of(ts_, obs, rec):
    if ts_ < obs:
        return "before_obs"
    if ts_ < rec:
        return "obs_to_receipt"
    d = ts_ - rec
    for name, a, b in WINDOWS[2:]:
        if d >= a and (b is None or d < b):
            return name
    return "r+1h_close"


def fee(rate, y):
    return rate * y * (1 - y)


def yes_dir(side, oi, price):
    if oi == 0:
        return side, price
    if oi == 1:
        return ("SELL" if side == "BUY" else "BUY"), 1.0 - price
    return None, None


def main():
    evf, outp = sys.argv[1], sys.argv[2]
    ev = C.load_json(evf)["events"]
    ev = list(ev.values()) if isinstance(ev, dict) else ev
    obs_cache = {}
    agg = defaultdict(lambda: defaultdict(float))
    lags = defaultdict(list)
    basis = Counter()
    basis_rows = []
    deaths = []
    postday = defaultdict(float)
    n_ev = Counter()
    for e in sorted(ev, key=lambda x: (x["date"], x["event"])):
        if not e.get("closed"):
            n_ev["open"] += 1
            continue
        st = e.get("station")
        if not st or st == "HKO":
            n_ev["hko_or_none"] += 1
            continue
        pth = os.path.join(C.DATA, "prints", f"ev_{e['event']}.json")
        if not C.pmnet.exists(pth):
            n_ev["no_prints"] += 1
            continue
        if st not in obs_cache:
            o = C.load_json(os.path.join(C.DATA, "obs", st + ".json"))
            rec = {}
            for r in o.get("awc", []):
                if r.get("obs_ts") and r.get("receipt_ts"):
                    k = int(r["obs_ts"]) // 60
                    rec[k] = min(rec.get(k, 1e18), r["receipt_ts"])
            obs_cache[st] = (o["iem"], rec)
        iem, rec = obs_cache[st]
        tz = tz_of(st)
        s, t = W.local_day_bounds(e["date"], tz)
        run = W.running(iem, e["unit"], e["hl"], s, t)
        run_r = W.running(iem, e["unit"], e["hl"], s, t, ("routine",))
        n_ev["analysed"] += 1
        win = [b for b in e["buckets"] if b["payout_yes"] == 1.0]
        final = run[-1][2] if run else None
        final_r = run_r[-1][2] if run_r else None
        if win and final is not None:
            ok, ok_r = contains(win[0]["bucket"], final), contains(win[0]["bucket"], final_r)
            basis["agree_all" if ok else "disagree_all"] += 1
            basis["agree_routine" if ok_r else "disagree_routine"] += 1
            if not ok or not ok_r:
                basis_rows.append([e["event"], e["date"], e["city"], e["hl"], e["unit"], st, e.get("source"), final,
                                   final_r, win[0]["bucket"], len(run)])
        elif final is None:
            basis["no_reports"] += 1
        for o in run:
            k = int(o[0]) // 60
            if k in rec:
                lags[st].append(rec[k] - o[0])
        rows = C.load_json(pth)["rows"]
        by_cond = defaultdict(list)
        for r in rows:
            by_cond[r[1]].append(r)
        for b in e["buckets"]:
            prs = sorted(by_cond.get(b["cond"], []))
            if not prs:
                continue
            state, obs_ts = None, None
            for ts_, v, rr in run:
                k_ = state_after(e["hl"], b["bucket"], rr)
                if k_:
                    state, obs_ts = k_, ts_
                    break
            # post-day: every bucket is decided once the local day is over (by the reports); stale side after it
            if run and b["payout_yes"] in (0.0, 1.0):
                decided_win = contains(b["bucket"], final)
                for r in prs:
                    if r[0] < t:
                        continue
                    d, y = yes_dir(r[2], r[3], r[4])
                    if d is None:
                        continue
                    stale = (d == "BUY") if decided_win else (d == "SELL")
                    if not stale:
                        continue
                    g = (1 - y) if decided_win else y
                    postday["shares"] += r[5]
                    postday["net_edge_usd"] += r[5] * (g - fee(b["fee_rate"] or 0.05, y))
                    postday["notional_usd"] += r[5] * ((y if decided_win else 1 - y))
                    postday["prints"] += 1
                    if g >= 0.005:
                        postday["net_edge_usd_ge_0.5c"] += r[5] * (g - fee(b["fee_rate"] or 0.05, y))
                        postday["notional_usd_ge_0.5c"] += r[5] * ((y if decided_win else 1 - y))
            if not state:
                continue
            rc = rec.get(int(obs_ts) // 60)
            has_rc = rc is not None
            rc = rc if has_rc else obs_ts + 300
            tss = [r[0] for r in prs]
            i = bisect.bisect_left(tss, obs_ts)
            pre = [r for r in prs[:i] if r[0] >= obs_ts - 3600]
            pre_y = yes_dir(pre[-1][2], pre[-1][3], pre[-1][4])[1] if pre else None
            informative = pre_y is not None and ((state == "dead" and pre_y >= 0.05) or (state == "locked" and pre_y <= 0.95))
            won = b["payout_yes"] == 1.0
            wrong = (state == "dead" and won) or (state == "locked" and not won)
            rec_d = {"event": e["event"], "date": e["date"], "city": e["city"], "hl": e["hl"], "station": st,
                     "bucket": b["bucket"], "state": state, "obs": obs_ts, "receipt": rc, "has_receipt": has_rc,
                     "pre_y": pre_y, "informative": informative, "wrong": wrong, "closed": b["closed_time"],
                     "win": {}}
            first_drop = None
            late = {lag_s: {th: [0.0, 0.0, 0] for th in THRESH} for lag_s in (60, 120, 300)}
            for r in prs:
                if r[0] < obs_ts - 3600:
                    continue
                d, y = yes_dir(r[2], r[3], r[4])
                if d is None:
                    continue
                stale = (state == "dead" and d == "SELL") or (state == "locked" and d == "BUY")
                if not stale:
                    continue
                g = y if state == "dead" else 1 - y
                net = g - fee(b["fee_rate"] or 0.05, y)
                wname = window_of(r[0], obs_ts, rc)
                w = rec_d["win"].setdefault(wname, [0, 0.0, 0.0, 0.0, 0.0, 0.0])
                w[0] += 1
                w[1] += r[5]
                w[2] += r[5] * max(net, 0)
                w[3] += r[5] * (1 - y if state == "dead" else y)
                if g >= 0.01:
                    w[4] += r[5] * max(net, 0)
                    w[5] = max(w[5], g)
                for lag_s, byth in late.items():
                    if r[0] >= rc + lag_s:
                        for th, acc in byth.items():
                            if g >= th:
                                acc[0] += r[5] * max(net, 0)                          # net edge, $
                                acc[1] += r[5] * (1 - y if state == "dead" else y)    # cost of the shares, $
                                acc[2] += 1
                if first_drop is None and pre_y is not None and g < 0.5 * (pre_y if state == "dead" else 1 - pre_y) and r[0] >= obs_ts - 3600:
                    first_drop = r[0]
            rec_d["first_drop"] = first_drop
            rec_d["late"] = {str(k): {str(th): v for th, v in byth.items()} for k, byth in late.items()}
            deaths.append(rec_d)
    # summaries
    summ = {"events": dict(n_ev), "basis": dict(basis), "basis_rows": basis_rows[:200], "postday": dict(postday)}
    lagall = sorted(x for v in lags.values() for x in v)
    q = lambda xs, p: xs[min(len(xs) - 1, int(p * len(xs)))] if xs else None  # noqa: E731
    summ["receipt_lag_s"] = {"n": len(lagall), "p10": q(lagall, 0.1), "p50": q(lagall, 0.5), "p90": q(lagall, 0.9),
                             "p99": q(lagall, 0.99),
                             "by_station_p50": {k: q(sorted(v), 0.5) for k, v in sorted(lags.items())},
                             "by_station_p90": {k: q(sorted(v), 0.9) for k, v in sorted(lags.items())}}
    for label, sel in (("informative", lambda d: d["informative"]), ("all", lambda d: True)):
        tot = defaultdict(lambda: [0, 0.0, 0.0, 0.0, 0.0])
        n = Counter()
        for d in deaths:
            if not sel(d):
                continue
            n[d["state"]] += 1
            n["wrong"] += d["wrong"]
            n["with_receipt"] += d["has_receipt"]
            for w, v in d["win"].items():
                tt = tot[w]
                tt[0] += v[0]; tt[1] += v[1]; tt[2] += v[2]; tt[3] += v[3]; tt[4] += v[4]
        late = {}
        for lag_s in ("60", "120", "300"):
            for th in THRESH:
                edge = cost = 0.0
                hit, per_ev = 0, defaultdict(float)
                for d in deaths:
                    if not sel(d):
                        continue
                    a = d["late"][lag_s][str(th)]
                    edge += a[0]; cost += a[1]
                    if a[2]:
                        hit += 1
                        per_ev[d["event"]] += a[0]
                vals = sorted(per_ev.values())
                late[f"r+{lag_s}s g>={th}"] = {"net_edge_usd": round(edge, 2), "cost_usd": round(cost, 2),
                                              "deaths_with_prints": hit, "events_with_prints": len(per_ev),
                                              "event_net_edge_p50": round(q(vals, 0.5), 3) if vals else None,
                                              "event_net_edge_p90": round(q(vals, 0.9), 3) if vals else None}
        summ[label] = {"counts": dict(n), "windows": {w: {"prints": v[0], "shares": round(v[1], 1),
                                                            "net_edge_usd": round(v[2], 2), "notional_usd": round(v[3], 2),
                                                            "net_edge_usd_g_ge_1c": round(v[4], 2)}
                                                        for w, v in tot.items()},
                       "late": late}
    # timing of the drop, informative only
    drops = sorted((d["first_drop"] - d["receipt"]) for d in deaths if d["informative"] and d["first_drop"] and d["has_receipt"])
    summ["informative_drop_vs_receipt_s"] = {"n": len(drops), "p10": q(drops, 0.1), "p25": q(drops, 0.25),
                                             "p50": q(drops, 0.5), "p75": q(drops, 0.75), "p90": q(drops, 0.9),
                                             "share_before_receipt": (sum(1 for x in drops if x < 0) / len(drops)) if drops else None,
                                             "share_before_r+60": (sum(1 for x in drops if x < 60) / len(drops)) if drops else None,
                                             "share_before_r+120": (sum(1 for x in drops if x < 120) / len(drops)) if drops else None}
    locks = sorted((d["closed"] - d["receipt"]) / 3600 for d in deaths if d["closed"])
    summ["lock_hours_receipt_to_close"] = {"n": len(locks), "p10": q(locks, 0.1), "p50": q(locks, 0.5), "p90": q(locks, 0.9)}
    C.dump_json(outp, {"summary": summ, "deaths": deaths})
    print(json.dumps(summ, indent=1, sort_keys=True)[:6000])


if __name__ == "__main__":
    main()
