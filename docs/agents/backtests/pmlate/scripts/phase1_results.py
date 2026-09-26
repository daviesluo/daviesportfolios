"""PMLATE phase 1: gather the feasibility numbers the study reports into committed result files.

Reads what the other phase-1 scripts wrote under $PMLATE_DATA (the exploration of September's temperature markets,
the basis check over every market-day, the count family's measurement, RW's own market-days, the universes) and
writes, under the given folder:
* `phase1_temperature.json` — when the stale side is taken against METAR publication (all decided buckets, split into
  informative ones whose verdict held, the rest, and the ones whose verdict failed), the first-drop timing, what is
  left after the loop could act, the capital lock, the after-the-day window;
* `phase1_basis.json` — the resolution against the station's reports over every market-day, by source, region, month,
  with every disagreement;
* `phase1_counts.json` — the post-count family: tracker capture delay, timing of the stale side against the post,
  what is left after the tracker's capture, the tracker's count against the result, per series;
* `phase1_universe.json` — market-days per month (US, non-US, Hong Kong) and the count family's events per series;
* `rw_mechanism.json` — RW's same-day temperature market-days, bucket by bucket.

usage: phase1_results.py <out folder>
"""
import json
import os
import sys
from collections import Counter, defaultdict

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as C  # noqa: E402

W = ["before_obs", "obs_to_receipt", "r+0_60", "r+60_120", "r+120_300", "r+300_3600", "r+1h_close"]


def q(xs, p):
    return xs[min(len(xs) - 1, int(p * len(xs)))] if xs else None


def rnd(x, n=2):
    return round(x, n) if isinstance(x, float) else x


def temperature():
    x = C.load_json(os.path.join(C.DATA, "explore_sep.json"))
    D = x["deaths"]
    groups = {"informative_held": lambda d: d["informative"] and not d["wrong"],
              "other_held": lambda d: (not d["informative"]) and not d["wrong"], "wrong": lambda d: d["wrong"]}
    out = {"sample": "closed daily temperature events with a target date 2026-09-01 → 2026-09-26 (Gamma tag 103040)",
           "events": x["summary"]["events"], "receipt_lag_s": x["summary"]["receipt_lag_s"],
           "lock_hours_receipt_to_close": x["summary"]["lock_hours_receipt_to_close"], "groups": {}}
    for name, sel in groups.items():
        tot = {w: [0, 0.0, 0.0, 0.0] for w in W}
        n = 0
        for d in D:
            if not sel(d):
                continue
            n += 1
            for w, v in d["win"].items():
                tot[w][0] += v[0]; tot[w][1] += v[2]; tot[w][2] += v[4]; tot[w][3] += v[3]
        post = sum(tot[w][1] for w in W[1:])
        late = {}
        for lag in ("60", "120", "300"):
            for th in ("0.001", "0.005", "0.01", "0.02", "0.05"):
                e = sum(d["late"][lag][th][0] for d in D if sel(d))
                c = sum(d["late"][lag][th][1] for d in D if sel(d))
                k = sum(1 for d in D if sel(d) and d["late"][lag][th][2])
                late[f"receipt+{lag}s g>={th}"] = {"net_edge_usd": rnd(e), "cost_usd": rnd(c), "bucket_deaths_with_prints": k}
        out["groups"][name] = {
            "bucket_deaths": n,
            "windows": {w: {"stale_prints": v[0], "net_edge_usd": rnd(v[1]), "net_edge_usd_g_ge_1c": rnd(v[2]),
                            "share_of_post_observation_edge": (rnd(v[1] / post, 4) if post and w != "before_obs" else None)}
                        for w, v in tot.items()},
            "late_100pct_of_prints_uncapped": late}
    drops = sorted(d["first_drop"] - d["receipt"] for d in D if d["informative"] and not d["wrong"] and d["first_drop"] and d["has_receipt"])
    drops_obs = sorted(d["first_drop"] - d["obs"] for d in D if d["informative"] and not d["wrong"] and d["first_drop"] and d["has_receipt"])
    out["informative_held_first_drop"] = {
        "n": len(drops), "vs_receipt_s": {p: rnd(q(drops, v), 0) for p, v in (("p10", .1), ("p25", .25), ("p50", .5), ("p75", .75), ("p90", .9))},
        "vs_observation_s": {p: rnd(q(drops_obs, v), 0) for p, v in (("p10", .1), ("p25", .25), ("p50", .5), ("p75", .75), ("p90", .9))},
        "share_before_receipt": rnd(sum(1 for a in drops if a < 0) / len(drops), 4),
        "share_before_receipt+60s": rnd(sum(1 for a in drops if a < 60) / len(drops), 4),
        "share_before_receipt+120s": rnd(sum(1 for a in drops if a < 120) / len(drops), 4)}
    out["informative_deaths"] = sum(1 for d in D if d["informative"])
    out["events_with_an_informative_death"] = len({d["event"] for d in D if d["informative"]})
    out["wrong_by_date"] = dict(Counter(d["date"] for d in D if d["wrong"]))
    out["after_the_local_day"] = {k: rnd(v) for k, v in x["summary"]["postday"].items()}
    return out


def basis():
    b = C.load_json(os.path.join(C.DATA, "basis_all.json"))
    return {"note": "the resolution (the winning bucket) against the station's IEM routine + special reports over the "
                    "local day; 'dead bucket won' = a bucket the reports' final extreme had passed paid YES, by a "
                    "margin of more than 0 / 1 / 2 whole degrees", "counts": b["counts"],
            "dates_with_2plus_disagreements": b["dates_with_2plus"], "disagreements": b["disagreements"]}


def counts():
    x = C.load_json(os.path.join(C.DATA, "count_measure2.json"))
    out = {"capture_lag_s": x["summary"]["capture_lag_s"], "basis": x["summary"]["basis"], "by_family": {}}
    fams = {"elon (sampled)": lambda e: e["series"].startswith("elon"),
            "seven smaller series (every event)": lambda e: not e["series"].startswith("elon")}
    Wc = ["before_post", "post+0_60", "post+60_120", "post+120_300", "post+300_3600", "post+1h+"]
    for fam, fsel in fams.items():
        ev = [e for e in x["events"] if fsel(e)]
        famo = {"events": len(ev), "groups": {}}
        for lab, sel in (("informative_held", lambda b: b["informative"] and not b["wrong"]),
                         ("other_held", lambda b: (not b["informative"]) and not b["wrong"]), ("wrong", lambda b: b["wrong"])):
            tot = {w: [0, 0.0, 0.0] for w in Wc}
            late = defaultdict(lambda: [0.0, 0.0, 0])
            n = 0
            for e in ev:
                for b in e["buckets"]:
                    if not sel(b):
                        continue
                    n += 1
                    for w, v in b["win"].items():
                        tot[w][0] += v[0]; tot[w][1] += v[1]; tot[w][2] += v[2]
                    for lag, bt in b["late"].items():
                        for th, v in bt.items():
                            a = late[f"post+{lag}s g>={th}"]; a[0] += v[0]; a[1] += v[1]; a[2] += (1 if v[2] else 0)
                    for th, v in b["late_cap"].items():
                        a = late[f"capture+60s g>={th}"]; a[0] += v[0]; a[1] += v[1]; a[2] += (1 if v[2] else 0)
            post = sum(tot[w][1] for w in Wc[1:])
            famo["groups"][lab] = {"bucket_deaths": n,
                                   "windows": {w: {"stale_prints": v[0], "net_edge_usd": rnd(v[1]), "cost_usd": rnd(v[2]),
                                                   "share_of_post_edge": (rnd(v[1] / post, 4) if post and w != "before_post" else None)}
                                               for w, v in tot.items()},
                                   "late_100pct_of_prints_uncapped": {k: {"net_edge_usd": rnd(v[0]), "cost_usd": rnd(v[1]), "bucket_deaths_with_prints": v[2]}
                                                                      for k, v in sorted(late.items())}}
        out["by_family"][fam] = famo
    out["tracker_vs_result"] = [[e["series"], e["title"][-42:], e["winner"], e["n_end"], e["n_close"], e["n_now"]]
                                for e in x["events"] if e["winner"]]
    return out


def universe():
    seen, cnt = set(), Counter()
    for f in ("events_2026-09-01_2026-09-27.json", "events_wx.json"):
        for e in C.load_json(os.path.join(C.DATA, "univ", f))["events"].values():
            if e["event"] in seen:
                continue
            seen.add(e["event"])
            st = e.get("station") or ""
            cnt[(e["date"][:7], "US" if st.startswith("K") else ("HKO" if st == "HKO" else ("none" if not st else "non-US")))] += 1
    months = sorted({k[0] for k in cnt})
    temp = {m: {r: cnt[(m, r)] for r in ("US", "non-US", "HKO", "none") if cnt[(m, r)]} for m in months}
    u = C.load_json(os.path.join(C.DATA, "count", "universe_2025-09-26_2026-09-27.json"))["events"]
    by = defaultdict(lambda: [0, 0.0])
    for e in u.values():
        k = f"{e['family']}:{e['series']}"
        by[k][0] += 1
        by[k][1] += e["volume"]
    cnts = {k: {"events": v[0], "volume_usd": round(v[1])} for k, v in sorted(by.items(), key=lambda kv: -kv[1][1])}
    return {"temperature_events_by_month": temp, "count_family_events_2025-09-26_to_2026-09-26": cnts}


def rw_mech():
    res = C.load_json(os.path.join(C.DATA, "rw", "mechanism.json"))
    out = []
    for r in res:
        out.append({"event": r["event"], "date": r["date"], "city": r["city"], "hl": r["hl"], "station": r["station"],
                    "source": r["source"], "reports": r["reports"], "max_gap_h": rnd(r["gaps_h"], 1), "final": r["final_all"],
                    "winner": r["winner"], "agrees": r["agrees"],
                    "buckets": [{"bucket": b["bucket"], "rw": b["rw"], "payout": b["payout"], "state": b["state"],
                                 "obs": C.iso(b["obs_ts"]) if b["obs_ts"] else None,
                                 "receipt_after_obs_s": rnd(b["pub_ts"] - b["obs_ts"], 0) if b["pub_ts"] else None,
                                 "prints": b["prints"], "stale_prints_after_receipt": len(b["stale"]),
                                 "stale_net_edge_after_receipt_usd": rnd(sum(s["size"] * s["edge"] for s in b["stale"]))}
                                for b in r["buckets"]]})
    return out


def main():
    od = sys.argv[1]
    os.makedirs(od, exist_ok=True)
    for name, fn in (("phase1_temperature.json", temperature), ("phase1_basis.json", basis), ("phase1_counts.json", counts),
                     ("phase1_universe.json", universe), ("rw_mechanism.json", rw_mech)):
        with open(os.path.join(od, name), "w") as f:
            json.dump(fn(), f, indent=1, sort_keys=True)
            f.write("\n")
        print("wrote", name)


if __name__ == "__main__":
    main()
