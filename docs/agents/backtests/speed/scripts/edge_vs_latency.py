"""SPEED step 1 (exploration month only): how much of the stale side's edge is still there L seconds after the report
that decided a temperature bucket, i.e. what speed is worth if our data arrived at the observation time.

September's closed daily-temperature events (target dates 2026-09-01 → 09-26, the PMLATE exploration sample, already
read; no test-period print is opened). For every bucket a report decided, exactly as PMLATE's `explore.py` defines it
— the first report of the station's local day (IEM routine + special) whose running extreme made the bucket impossible
("dead") or certain ("locked"); "informative" when the last print in the hour before the report's observation time
still gave it a chance (YES >= 0.05 dead, <= 0.95 locked); a "trap" when the market resolved against the reports'
verdict — every stale-side print (a taker selling a dead bucket's YES or buying its NO; buying a locked bucket's YES or
selling its NO) from the observation time t_obs to the close, with its size, its gross edge g (a dead bucket's YES price
y; a locked bucket's 1 - y) and its net edge g - fee (the market's own rate × y × (1 - y); 0.05 where none is given).

Measures, per region (US = ICAO K…, non-US) and class (informative held, other held, trap):
* the net edge ($, whole prints) of the stale prints at or after t_obs + L, and its share of the post-observation total,
  for L on a 5-second grid to an hour (the table at 0, 5, 10, 20, 30, 60, 120, 300 s …);
* the same after AWC's receipt + L (reports AWC received; AWC's own receipt instants);
* what a taker acting at t_obs + L would have made under USLATE's fill model (each stale print with g >= 1 ¢ fills
  half its size at its own price, in time order, until the bucket has cost $100; the market's fee on our fill; hold to
  resolution): held buckets win g - fee a share, traps lose 1 - g + fee a share.

Print times are the data API's `timestamp` (the settlement block's time, whole seconds; the match is a few seconds
earlier), so the first few seconds of L are approximate.

usage: edge_vs_latency.py <SPEED data folder> <out json>
"""
import bisect
import gzip
import json
import os
import sys
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "..", "pmlate", "scripts"))
import metar as W  # noqa: E402
from rw_mechanism import contains, state_after  # noqa: E402
from stations import tz_of  # noqa: E402

GRID = list(range(0, 3601, 5))
L_TAB = [0, 5, 10, 20, 30, 45, 60, 90, 120, 150, 180, 240, 300, 600, 900, 1800, 3600]
L_REC = [-300, -120, -60, -30, 0, 5, 10, 20, 30, 60, 120, 300]
# the receipt-relative grid step 4 reads architectures off: 1 s steps for the first two minutes after the receipt
RC_GRID = list(range(-300, 0, 5)) + list(range(0, 121)) + list(range(125, 901, 5))
CAP = 100.0


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


def q(xs, p):
    xs = sorted(xs)
    return xs[min(len(xs) - 1, int(p * len(xs)))] if xs else None


def deaths_of(data):
    ev = load(os.path.join(data, "univ", "events_2026-09-01_2026-09-27.json.gz"))["events"]
    obs_cache, out = {}, []
    for e in sorted(ev.values(), key=lambda x: (x["date"], x["event"])):
        if not e.get("closed") or not ("2026-09-01" <= e["date"] <= "2026-09-26"):
            continue
        st = e.get("station")
        if not st or st == "HKO":
            continue
        pth = os.path.join(data, "prints", f"ev_{e['event']}.json.gz")
        if not os.path.exists(pth):
            continue
        if st not in obs_cache:
            o = load(os.path.join(data, "obs", st + ".json.gz"))
            rec = {}
            for r in o.get("awc", []):
                if r.get("obs_ts") and r.get("receipt_ts"):
                    k = int(r["obs_ts"]) // 60
                    rec[k] = min(rec.get(k, 1e18), r["receipt_ts"])
            obs_cache[st] = (o["iem"], rec)
        iem, rec = obs_cache[st]
        s, t = W.local_day_bounds(e["date"], tz_of(st))
        run = W.running(iem, e["unit"], e["hl"], s, t)
        rows = load(pth)["rows"]
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
            if not state:
                continue
            rc = rec.get(int(obs_ts) // 60)
            tss = [r[0] for r in prs]
            i = bisect.bisect_left(tss, obs_ts)
            pre = [r for r in prs[:i] if r[0] >= obs_ts - 3600]
            pre_y = yes_dir(pre[-1][2], pre[-1][3], pre[-1][4])[1] if pre else None
            informative = pre_y is not None and ((state == "dead" and pre_y >= 0.05) or (state == "locked" and pre_y <= 0.95))
            won = b["payout_yes"] == 1.0
            wrong = (state == "dead" and won) or (state == "locked" and not won)
            rate = b.get("fee_rate") or 0.05
            stale = []
            for r in prs[i:]:
                d, y = yes_dir(r[2], r[3], r[4])
                if d is None:
                    continue
                if not ((state == "dead" and d == "SELL") or (state == "locked" and d == "BUY")):
                    continue
                g = y if state == "dead" else 1 - y
                stale.append((r[0] - obs_ts, r[5], g, g - fee(rate, y), fee(rate, y)))
            out.append({"event": e["event"], "date": e["date"], "station": st, "us": st.startswith("K"),
                        "state": state, "obs": obs_ts, "receipt": rc, "informative": informative, "wrong": wrong,
                        "stale": stale})
    return out


def capture(stale, L, trap):
    """USLATE's fill model from t_obs + L: half of each stale print with g >= 1 ¢, in time order, to $100 of cost."""
    cost = pnl = 0.0
    filled = False
    for dt, size, g, net, f in stale:
        if dt < L or g < 0.01:
            continue
        sh = size / 2.0
        c = 1.0 - g
        if c <= 0:
            continue
        if cost + sh * c > CAP:
            sh = (CAP - cost) / c
        if sh <= 0:
            break
        filled = True
        cost += sh * c
        pnl += sh * ((-(1.0 - g) - f) if trap else (g - f))
        if cost >= CAP - 1e-9:
            break
    return pnl, cost, filled


def main():
    data, outp = sys.argv[1], sys.argv[2]
    D = deaths_of(data)
    dates = sorted({d["date"] for d in D})
    ndays = len(dates)
    groups = {}
    for d in D:
        reg = "US" if d["us"] else "non-US"
        cls = "trap" if d["wrong"] else ("informative_held" if d["informative"] else "other_held")
        for key in ((reg, cls), ("all", cls)):
            groups.setdefault(key, []).append(d)
    res = {"sample": "closed daily temperature events, target dates 2026-09-01 → 09-26 (PMLATE's exploration)",
           "days": ndays, "grid_s": GRID, "groups": {},
           "note": "net edge = whole stale-side prints at or after the instant, floored at 0 (PMLATE's explore.py); "
                   "uslate = USLATE's fill model (half of each print with g >= 1 ¢, $100 a bucket, the market's fee); "
                   "traps (the market resolved against the reports) are their own class and lose 1 - g + fee a share"}
    for (reg, cls), ds in sorted(groups.items()):
        # edge at or after t_obs + L (whole prints, net edge floored at 0 as PMLATE's explore did)
        dts = sorted((dt, sz * max(net, 0.0), sz * max(net, 0.0) if g >= 0.01 else 0.0, sz * (1 - g + f))
                     for d in ds for dt, sz, g, net, f in d["stale"])
        xs = [x[0] for x in dts]
        suf_edge, suf_g1, suf_loss = [0.0] * (len(dts) + 1), [0.0] * (len(dts) + 1), [0.0] * (len(dts) + 1)
        for j in range(len(dts) - 1, -1, -1):
            suf_edge[j] = suf_edge[j + 1] + dts[j][1]
            suf_g1[j] = suf_g1[j + 1] + dts[j][2]
            suf_loss[j] = suf_loss[j + 1] + dts[j][3]

        def after(L, arr):
            return arr[bisect.bisect_left(xs, L)]
        tot = suf_edge[0]
        curve = [round(after(L, suf_edge), 2) for L in GRID]
        tab = {}
        for L in L_TAB:
            e_all, e_g1 = after(L, suf_edge), after(L, suf_g1)
            row = {"net_edge_usd": round(e_all, 2), "share": round(e_all / tot, 4) if tot else None,
                   "net_edge_usd_g_ge_1c": round(e_g1, 2), "usd_per_day": round(e_all / ndays, 2)}
            if cls == "trap":
                row["taker_loss_usd_whole_prints"] = round(after(L, suf_loss), 2)
            cap = [capture(d["stale"], L, cls == "trap") for d in ds]
            row["uslate_fill_pnl_usd"] = round(sum(c[0] for c in cap), 2)
            row["uslate_fill_cost_usd"] = round(sum(c[1] for c in cap), 2)
            row["uslate_buckets_filled"] = sum(1 for c in cap if c[2])
            row["uslate_dates_filled"] = len({d["date"] for d, c in zip(ds, cap) if c[2]})
            tab[str(L)] = row
        # after AWC's receipt + L, as a share of the same post-observation total (reports AWC received)
        rtab = {}
        withr = [d for d in ds if d["receipt"]]
        tot_r = sum(sz * max(net, 0.0) for d in withr for dt, sz, g, net, f in d["stale"])
        for L in L_REC:
            e = sum(sz * max(net, 0.0) for d in withr for dt, sz, g, net, f in d["stale"]
                    if d["obs"] + dt >= d["receipt"] + L)
            cap = [capture([(d["obs"] + dt - d["receipt"], sz, g, net, f) for dt, sz, g, net, f in d["stale"]], L,
                           cls == "trap") for d in withr]
            rtab[str(L)] = {"net_edge_usd": round(e, 2), "share": round(e / tot_r, 4) if tot_r else None,
                            "uslate_fill_pnl_usd": round(sum(c[0] for c in cap), 2),
                            "uslate_buckets_filled": sum(1 for c in cap if c[2])}
        # the same on a fine receipt-relative grid, for step 4 (uncapped net edge, and USLATE's fill model)
        rel = [(d, [(d["obs"] + dt - d["receipt"], sz, g, net, f) for dt, sz, g, net, f in d["stale"]]) for d in withr]
        rc_edge, rc_pnl, rc_n = [], [], []
        for L in RC_GRID:
            rc_edge.append(round(sum(sz * max(net, 0.0) for _, st in rel for x, sz, g, net, f in st if x >= L), 2))
            cap = [capture(st, L, cls == "trap") for _, st in rel]
            rc_pnl.append(round(sum(c[0] for c in cap), 2))
            rc_n.append(sum(1 for c in cap if c[2]))
        # when the edge goes: the instant (after t_obs) by which half / 90 % of the post-observation edge was taken
        half = next((L for L, v in zip(GRID, curve) if tot and v <= 0.5 * tot), None)
        ninety = next((L for L, v in zip(GRID, curve) if tot and v <= 0.1 * tot), None)
        lags = [d["receipt"] - d["obs"] for d in ds if d["receipt"]]
        # the first stale print (g >= 1 ¢) after the observation, per bucket, against the observation and the receipt
        first = [(next((dt for dt, sz, g, net, f in d["stale"] if g >= 0.01), None), d) for d in ds]
        f_obs = [x for x, d in first if x is not None]
        f_rc = [x + d["obs"] - d["receipt"] for x, d in first if x is not None and d["receipt"]]
        res["groups"][f"{reg}:{cls}"] = {
            "bucket_deaths": len(ds), "with_awc_receipt": len(withr),
            "post_obs_net_edge_usd": round(tot, 2), "post_obs_net_edge_usd_per_day": round(tot / ndays, 2),
            "half_taken_by_s": half, "ninety_pct_taken_by_s": ninety,
            "awc_receipt_after_obs_s": {"p10": q(lags, .1), "p50": q(lags, .5), "p90": q(lags, .9)} if lags else None,
            "first_stale_print_after_obs_s": {"n": len(f_obs), "p25": q(f_obs, .25), "p50": q(f_obs, .5), "p75": q(f_obs, .75)},
            "first_stale_print_vs_receipt_s": {"n": len(f_rc), "p25": q(f_rc, .25), "p50": q(f_rc, .5), "p75": q(f_rc, .75),
                                               "share_before_receipt": round(sum(1 for x in f_rc if x < 0) / len(f_rc), 4) if f_rc else None},
            "after_obs": tab, "after_awc_receipt": rtab, "curve_net_edge_usd_after_obs": curve,
            "rc_grid_s": RC_GRID, "rc_curve_net_edge_usd": rc_edge, "rc_curve_uslate_pnl_usd": rc_pnl,
            "rc_curve_uslate_buckets_filled": rc_n}
    with open(outp, "w") as f:
        json.dump(res, f, indent=1, sort_keys=True)
        f.write("\n")
    for k, v in res["groups"].items():
        print(k, v["bucket_deaths"], "post-obs $", v["post_obs_net_edge_usd"], "half by", v["half_taken_by_s"],
              "90% by", v["ninety_pct_taken_by_s"])
        print("   share left:", {L: v["after_obs"][str(L)]["share"] for L in (0, 5, 10, 20, 30, 60, 120, 300)})
        print("   $ left    :", {L: v["after_obs"][str(L)]["net_edge_usd"] for L in (0, 5, 10, 20, 30, 60, 120, 300)})
        print("   uslate pnl:", {L: v["after_obs"][str(L)]["uslate_fill_pnl_usd"] for L in (0, 5, 10, 20, 30, 60, 120, 300)})
        print("   after rc  :", {L: v["after_awc_receipt"][str(L)]["share"] for L in (-60, 0, 60, 120, 300)})
        print("   first stale print vs obs:", v["first_stale_print_after_obs_s"], "vs receipt:", v["first_stale_print_vs_receipt_s"])


if __name__ == "__main__":
    main()
