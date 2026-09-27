"""WXSRC B4 (exploration month only, descriptive): at a fixed hour of the market's own day, does a fresh model run plus
the reports so far know more about the day's high than the market's price does?

The sample is PMLATE's exploration month, already read: the closed "highest temperature" events of the US stations
below (eleven had September events; KDEN had none) with a target date 2026-09-01 → 09-26 (`$PMLATE_DATA`: the
September universe, prints and reports). Nothing
here reads a price or print of any other month. It trades nothing and computes no P&L: it scores probabilities.

At each decision time T (17:00 and 20:00 UTC on the target date: 13:00 and 16:00 in New York, 10:00 and 13:00 in Los
Angeles):
* the reports so far: every METAR/SPECI of the station's local day whose observation time plus AWC's receipt delay
  (the report's own receipt where AWC has it, else 300 s) is at or before T gives the running maximum R (whole °F,
  PMLATE's `metar.temp_in`);
* the model: HRRR's run initialised two hours before T (15Z, 18Z; NOAA posts a run's hours 51–74 minutes after its
  initial time), its hourly 2 m temperature at the station's nearest grid point over [T, the end of the local day),
  maximum F (°F) — from NOAA's archive (`hrrr_points.py`);
* the model's probability of each bucket: the day's high is M = max(R, round(X)) with X ~ Normal(F + μ, σ); (μ, σ)
  maximise the likelihood of the winning buckets over the SAME sample (so the model is flattered, as fp4's
  `wx_day1_brier.py` flattered it: if even this loses to the market, the market knows more), pooled and per station;
* the market's probability: the YES-equivalent price of the bucket's last print in the hour before T.

Scores every bucket that has both, by Brier score, per decision time; the market's and the model's probability on the
bucket that won; how far apart the two are; and the buckets where they differ by ten points or more, with how often
the model's side was right (the only buckets a rule could trade).

usage: intraday_explore.py <out json>   (reads $PMLATE_DATA and $WXSRC_DATA/hrrr/)
"""
import bisect
import gzip
import json
import math
import os
import sys
from collections import defaultdict
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import wxcommon as X  # noqa: E402
import metar as W  # noqa: E402  (PMLATE's)
from stations import tz_of  # noqa: E402  (PMLATE's)

PM = os.environ.get("PMLATE_DATA")
STATIONS = ["KATL", "KAUS", "KBKF", "KDAL", "KDEN", "KHOU", "KLAX", "KLGA", "KMIA", "KORD", "KSEA", "KSFO"]
DECISIONS_UTC = {17: 15, 20: 18}   # decision hour → HRRR run hour (two hours earlier)


def load(p):
    with gzip.open(p, "rt") as f:
        return json.load(f)


def yes_px(side, oi, price):
    if oi == 0:
        return price
    if oi == 1:
        return 1.0 - price
    return None


def phi(x):
    return 0.5 * (1 + math.erf(x / math.sqrt(2)))


def bucket_prob(b, R, m, s):
    lo, hi = b
    lo_i = -10 ** 6 if lo is None else lo
    hi_i = 10 ** 6 if hi is None else hi
    if hi_i < R:
        return 0.0
    top = phi((hi_i + 0.5 - m) / s) if hi is not None else 1.0
    if lo_i <= R:
        return top
    return max(0.0, top - phi((lo_i - 0.5 - m) / s))


def fit(rs, per_station=False):
    """(mu, sigma) maximising the winning buckets' likelihood; per station mu when asked (sigma pooled)."""
    def ll_of(mu_of, sg):
        ll = 0.0
        for r in rs:
            pw = next(bucket_prob(b, r["R"], r["F"] + mu_of(r), sg) for b, p, w in r["buckets"] if w)
            ll += math.log(max(pw, 1e-6))
        return ll
    best = None
    for mu10 in range(-80, 81, 2):
        for s10 in range(5, 81, 2):
            ll = ll_of(lambda r, m=mu10 / 10: m, s10 / 10)
            if best is None or ll > best[0]:
                best = (ll, mu10 / 10, s10 / 10)
    if not per_station:
        return best[0], (lambda r, m=best[1]: m), best[2], {"mu_F": best[1], "sigma_F": best[2]}
    sg = best[2]
    mus = {}
    for st in STATIONS:
        sub = [r for r in rs if r["station"] == st]
        if not sub:
            continue
        cands = []
        for mu10 in range(-80, 81, 2):
            ll_st = 0.0
            for r in sub:
                pw = next(bucket_prob(b, r["R"], r["F"] + mu10 / 10, sg) for b, p, w in r["buckets"] if w)
                ll_st += math.log(max(pw, 1e-6))
            cands.append((ll_st, mu10 / 10))
        mus[st] = max(cands)[1]
    ll = ll_of(lambda r: mus[r["station"]], sg)
    return ll, (lambda r: mus[r["station"]]), sg, {"mu_F_by_station": mus, "sigma_F": sg}


def score(rs, mu_of, sg):
    bm = bk = 0.0
    n = 0
    gap, pw_m, pw_k = [], [], []
    big = {"n": 0, "model_side_right": 0, "model_higher": 0}
    for r in rs:
        for b, p, w in r["buckets"]:
            if p is None:
                continue
            q = bucket_prob(b, r["R"], r["F"] + mu_of(r), sg)
            y = 1.0 if w else 0.0
            bm += (q - y) ** 2
            bk += (p - y) ** 2
            n += 1
            gap.append(abs(q - p))
            if w:
                pw_m.append(q)
                pw_k.append(p)
            if abs(q - p) >= 0.10:
                big["n"] += 1
                big["model_higher"] += q > p
                big["model_side_right"] += (q > p) == w
    # does the model add anything to the price? the in-sample best mix w·model + (1 − w)·market (flattered again)
    blend = []
    for w10 in range(0, 21):
        w_ = w10 / 20
        tot = 0.0
        for r in rs:
            for b, p, w in r["buckets"]:
                if p is None:
                    continue
                q = bucket_prob(b, r["R"], r["F"] + mu_of(r), sg)
                tot += (w_ * q + (1 - w_) * p - (1.0 if w else 0.0)) ** 2
        blend.append((round(tot / n, 5) if n else None, w_))
    best_blend = min(blend)
    return {"buckets_scored": n, "brier_model": round(bm / n, 5) if n else None,
            "brier_market": round(bk / n, 5) if n else None, "abs_gap": X.pct(gap, (0.5, 0.75, 0.9, 0.99)),
            "best_blend_in_sample": {"model_weight": best_blend[1], "brier": best_blend[0]},
            "winner_prob_model_mean": round(sum(pw_m) / len(pw_m), 4) if pw_m else None,
            "winner_prob_market_mean": round(sum(pw_k) / len(pw_k), 4) if pw_k else None,
            "gap_ge_10pts": big}


def main():
    outp = sys.argv[1]
    ev = load(os.path.join(PM, "univ", "events_2026-09-01_2026-09-27.json.gz"))["events"]
    obs_cache, hrrr_cache, rows = {}, {}, []
    for e in sorted(ev.values(), key=lambda x: (x["date"], x["event"])):
        st = e.get("station")
        if (not e.get("closed") or e["hl"] != "highest" or st not in STATIONS
                or not ("2026-09-01" <= e["date"] <= "2026-09-26")):
            continue
        pth = os.path.join(PM, "prints", f"ev_{e['event']}.json.gz")
        wins = [b["bucket"] for b in e["buckets"] if b["payout_yes"] == 1.0]
        if not os.path.exists(pth) or len(wins) != 1:
            continue
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
        by_cond = defaultdict(list)
        for r in load(pth)["rows"]:
            by_cond[r[1]].append(r)
        y, mo, d = map(int, e["date"].split("-"))
        for hh, run_h in DECISIONS_UTC.items():
            T = datetime(y, mo, d, hh, tzinfo=timezone.utc).timestamp()
            key = f"{y:04d}{mo:02d}{d:02d}{run_h:02d}"
            if key not in hrrr_cache:
                p = os.path.join(X.DATA, "hrrr", key + ".json.gz")
                hrrr_cache[key] = load(p) if os.path.exists(p) else None
            hr = hrrr_cache[key]
            if not hr:
                continue
            R = None
            for o in iem:
                if not (s <= o["ts"] < t):
                    continue
                if rec.get(int(o["ts"]) // 60, o["ts"] + 300) > T:
                    continue
                v = W.temp_in(o, "F")
                if v is not None:
                    R = v if R is None else max(R, v)
            F = None
            for ts_, c in hr[st]:
                if T <= ts_ < t:
                    f = c * 9 / 5 + 32
                    F = f if F is None else max(F, f)
            if R is None or F is None:
                continue
            mk = []
            for b in e["buckets"]:
                prs = sorted(by_cond.get(b["cond"], []))
                tss = [p[0] for p in prs]
                i = bisect.bisect_right(tss, T)
                p = None
                for r in reversed(prs[max(0, i - 50):i]):
                    if r[0] >= T - 3600:
                        p = yes_px(r[2], r[3], r[4])
                        break
                mk.append([b["bucket"], p, b["payout_yes"] == 1.0])
            rows.append({"event": e["event"], "date": e["date"], "station": st, "decision_utc": hh, "R": R,
                         "F": round(F, 2), "buckets": mk})
    res = {"sample": "closed US highest-temperature events, 2026-09-01 → 09-26 (PMLATE's exploration month)",
           "decisions_utc_to_hrrr_run": DECISIONS_UTC, "groups": {}}
    for hh in DECISIONS_UTC:
        rs = [r for r in rows if r["decision_utc"] == hh]
        for per in (False, True):
            ll, mu_of, sg, params = fit(rs, per)
            g = score(rs, mu_of, sg)
            g.update({"events": len(rs), "loglik": round(ll, 3), "fit": params})
            res["groups"][f"hrrr@{hh}Z{'_mu_by_station' if per else ''}"] = g
    with open(outp, "w") as f:
        json.dump(res, f, indent=1, sort_keys=True)
        f.write("\n")
    for k, v in res["groups"].items():
        print(k, {kk: v[kk] for kk in ("events", "buckets_scored", "brier_model", "brier_market",
                                       "winner_prob_model_mean", "winner_prob_market_mean", "gap_ge_10pts")})


if __name__ == "__main__":
    main()
