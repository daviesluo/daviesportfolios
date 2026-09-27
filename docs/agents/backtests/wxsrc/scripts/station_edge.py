"""WXSRC A2 (exploration month only): per station, when the stale side of a decided temperature bucket is taken, how
much is left L seconds after the deciding report's observation, and who takes it first.

The sample is PMLATE's exploration month, already read: every closed daily-temperature event with a target date
2026-09-01 → 09-26 whose station publishes METAR (the Hong Kong Observatory's events are left out), from PMLATE's raw
pulls (`$PMLATE_DATA`: `univ/events_2026-09-01_2026-09-27.json.gz`, `prints/ev_<event>.json.gz`,
`obs/<ICAO>.json.gz`). Nothing here reads a price or print of any other month.

Definitions are PMLATE's (`explore.py`, `edge_vs_latency.py` of the speed study): the station's reports of its local
civil day (IEM, routine and special) give a running extreme; a bucket is "dead" at the first report whose running
extreme rules it out and "locked" at the first that makes an open-ended bucket certain; "informative" when the last
print in the hour before that report's observation time still gave it a chance (YES >= 0.05 dead, <= 0.95 locked);
a "trap" when the market resolved against the reports' verdict. A stale-side print is a taker selling a dead bucket's
YES or buying its NO (buying a locked bucket's YES or selling its NO); its gross edge g is the dead bucket's YES price
y (the locked bucket's 1 - y), its net edge g less the market's taker fee rate × y × (1 - y).

Per station: market-days and volume; bucket deaths by class; AWC's receipt delay; the first stale print (g >= 1¢)
after the observation and the first print below half the pre-report price, as seconds after the observation; the
net edge still on the stale side at the observation + L (whole prints, floored at 0, held buckets only) for L on a
grid; the net edge taken in the hour BEFORE the observation (what the takers anticipated); and the taker wallets
behind the first stale prints (a wallet is the data API's `proxy_wallet`, kept as its first eight hex digits).

usage: station_edge.py <out json>   (reads $PMLATE_DATA)
"""
import bisect
import gzip
import json
import os
import sys
from collections import Counter, defaultdict

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import wxcommon as X  # noqa: E402
import metar as W  # noqa: E402  (PMLATE's)
from rw_mechanism import contains, state_after  # noqa: E402,F401  (PMLATE's)
from stations import tz_of  # noqa: E402  (PMLATE's)

PM = os.environ.get("PMLATE_DATA")
L_GRID = [0, 15, 30, 45, 60, 75, 90, 105, 120, 150, 180, 210, 240, 300, 420, 600, 900, 1800, 3600]
# The keyless METAR chain, report by report. tgftp's station file is written before AWC's receipt of the same report
# by a median 7.7 s at US stations and 1.4 s elsewhere (the speed study's live poll: `backtests/speed/results/
# source_latency.json`, `vs_awc_receipt` "tgftp_st_file_written|US" / "|non-US", n = 67 / 48). A 1 s poll sees it
# within a second, the order goes 0.25 s later, and only prints the data API stamps at least 3 s after that count (it
# stamps a print 2-3 s after the match: `backtests/speed/results/print_time_lag.json`) — USLATE-FAST's conventions
# (`reviews/2026-09-27-speed-prereg-uslate-fast.md`). ACT_S is the first print a 1 s keyless taker could claim.
KEYLESS_LEAD_S = {"US": 7.7, "non-US": 1.4}
POLL_S, DISPATCH_S, PRINT_MARGIN_S = 1.0, 0.25, 3.0
ACT_S = POLL_S + DISPATCH_S + PRINT_MARGIN_S


def region(st):
    return "US" if st.startswith("K") else "non-US"


def keyless_written(d):
    """Seconds after the observation at which tgftp wrote the deciding report, modelled from AWC's receipt."""
    return d["receipt"] - KEYLESS_LEAD_S[region(d["station"])] - d["obs"]


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


def deaths():
    ev = load(os.path.join(PM, "univ", "events_2026-09-01_2026-09-27.json.gz"))["events"]
    obs_cache, out, days = {}, [], defaultdict(lambda: {"market_days": 0, "volume_usd": 0.0})
    for e in sorted(ev.values(), key=lambda x: (x["date"], x["event"])):
        if not e.get("closed") or not ("2026-09-01" <= e["date"] <= "2026-09-26"):
            continue
        st = e.get("station")
        if not st or st == "HKO":
            continue
        pth = os.path.join(PM, "prints", f"ev_{e['event']}.json.gz")
        if not os.path.exists(pth):
            continue
        days[st]["market_days"] += 1
        days[st]["volume_usd"] += sum(float(b.get("vol") or 0) for b in e["buckets"])
        if st not in obs_cache:
            o = load(os.path.join(PM, "obs", st + ".json.gz"))
            rec = {}
            for r in o.get("awc", []):
                if r.get("obs_ts") and r.get("receipt_ts"):
                    k = int(r["obs_ts"]) // 60
                    rec[k] = min(rec.get(k, 1e18), r["receipt_ts"])
            obs_cache[st] = (o["iem"], rec)
        iem, rec = obs_cache[st]
        s, t = W.local_day_bounds(e["date"], tz_of(st))
        run = W.running(iem, e["unit"], e["hl"], s, t)
        kinds = {}
        for o in iem:
            if s <= o["ts"] < t:
                kinds[o["ts"]] = o["kind"]
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
            rate = b.get("fee_rate") if b.get("fee_rate") is not None else 0.05
            stale, before, first_drop = [], 0.0, None
            for r in prs:
                if r[0] < obs_ts - 3600:
                    continue
                d, y = yes_dir(r[2], r[3], r[4])
                if d is None:
                    continue
                if not ((state == "dead" and d == "SELL") or (state == "locked" and d == "BUY")):
                    continue
                g = y if state == "dead" else 1 - y
                if r[0] < obs_ts:
                    before += r[5] * max(g - fee(rate, y), 0.0)
                else:
                    stale.append((r[0] - obs_ts, r[5], g, g - fee(rate, y), r[6]))
                if (first_drop is None and pre_y is not None and r[0] >= obs_ts
                        and g < 0.5 * (pre_y if state == "dead" else 1 - pre_y)):
                    first_drop = r[0] - obs_ts
            out.append({"event": e["event"], "date": e["date"], "station": st, "state": state, "obs": obs_ts,
                        "kind": kinds.get(obs_ts, "?"), "receipt": rc, "informative": informative, "wrong": wrong,
                        "pre_y": pre_y, "before_edge": before, "first_drop": first_drop, "stale": stale})
    return out, days


def main():
    outp = sys.argv[1]
    D, days = deaths()
    by_st = defaultdict(list)
    for d in D:
        by_st[d["station"]].append(d)
    res = {"sample": "closed daily temperature events, target dates 2026-09-01 → 09-26 (PMLATE's exploration)",
           "grid_s": L_GRID, "stations": {}}
    for st in sorted(by_st):
        ds = by_st[st]
        held = [d for d in ds if not d["wrong"]]
        inf = [d for d in held if d["informative"]]
        traps = [d for d in ds if d["wrong"]]

        def left(L, group):
            return round(sum(sz * max(net, 0.0) for d in group for dt, sz, g, net, w in d["stale"] if dt >= L), 2)
        first = []
        wallets = Counter()
        for d in inf:
            f = next(((dt, w) for dt, sz, g, net, w in d["stale"] if g >= 0.01), None)
            if f:
                first.append(f[0])
                wallets[f[1]] += 1
        lags = [d["receipt"] - d["obs"] for d in ds if d["receipt"]]
        lags_inf = [d["receipt"] - d["obs"] for d in inf if d["receipt"]]
        res["stations"][st] = {
            "market_days": days[st]["market_days"], "volume_usd": round(days[st]["volume_usd"], 2),
            "bucket_deaths": {"informative_held": len(inf), "other_held": len(held) - len(inf), "trap": len(traps)},
            "deciding_report_kind_informative": dict(Counter(d["kind"] for d in inf)),
            "awc_receipt_after_obs_s": X.pct(lags, (0.1, 0.5, 0.9)),
            "awc_receipt_after_obs_s_informative": X.pct(lags_inf, (0.1, 0.5, 0.9)),
            "first_stale_print_after_obs_s_informative": X.pct(first),
            "first_drop_after_obs_s_informative": X.pct([d["first_drop"] for d in inf]),
            "first_stale_print_wallets_top": wallets.most_common(5),
            "first_stale_print_wallets_n": len(wallets),
            "net_edge_before_obs_usd_informative": round(sum(d["before_edge"] for d in inf), 2),
            "net_edge_left_after_obs_usd": {"informative_held": {str(L): left(L, inf) for L in L_GRID},
                                            "all_held": {str(L): left(L, held) for L in L_GRID}},
            "net_edge_left_after_awc_receipt_usd_held": round(sum(
                sz * max(net, 0.0) for d in held if d["receipt"] for dt, sz, g, net, w in d["stale"]
                if d["obs"] + dt >= d["receipt"]), 2),
            # the keyless METAR chain (above): before the first print a 1 s keyless taker could claim, the edge went
            # to someone with a faster source
            "keyless_written_after_obs_s": X.pct([keyless_written(d) for d in ds if d["receipt"]], (0.1, 0.5, 0.9)),
            "net_edge_before_keyless_usd_held": round(sum(
                sz * max(net, 0.0) for d in held if d["receipt"] for dt, sz, g, net, w in d["stale"]
                if dt < keyless_written(d) + ACT_S), 2),
            "net_edge_after_keyless_usd_held": round(sum(
                sz * max(net, 0.0) for d in held if d["receipt"] for dt, sz, g, net, w in d["stale"]
                if dt >= keyless_written(d) + ACT_S), 2),
            "held_deaths_with_receipt": sum(1 for d in held if d["receipt"]),
            "trap_whole_print_loss_usd": round(sum(sz * (1 - g) for d in traps for dt, sz, g, net, w in d["stale"]), 2),
        }
    with open(outp, "w") as f:
        json.dump(res, f, indent=1, sort_keys=True)
        f.write("\n")
    for st, v in sorted(res["stations"].items(), key=lambda kv: -kv[1]["net_edge_left_after_obs_usd"]["all_held"]["0"]):
        e0 = v["net_edge_left_after_obs_usd"]["all_held"]
        print(f"{st} days={v['market_days']:3d} vol=${v['volume_usd']:>10,.0f} inf={v['bucket_deaths']['informative_held']:3d} "
              f"traps={v['bucket_deaths']['trap']:2d} rc50={v['awc_receipt_after_obs_s']['p50']} "
              f"first50={v['first_stale_print_after_obs_s_informative'].get('p50')} "
              f"drop50={v['first_drop_after_obs_s_informative'].get('p50')} "
              f"edge@0=${e0['0']:>8,.0f} @60=${e0['60']:>7,.0f} @120=${e0['120']:>7,.0f} @300=${e0['300']:>7,.0f} "
              f"pre=${v['net_edge_before_obs_usd_informative']:>8,.0f} wallets={v['first_stale_print_wallets_n']}")


if __name__ == "__main__":
    main()
