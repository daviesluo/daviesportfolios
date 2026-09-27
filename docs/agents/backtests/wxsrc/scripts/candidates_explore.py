"""WXSRC C (exploration month only, descriptive): what a 1 s taker would have made in September at each station, at
the instant a keyless source shows the deciding report, and what a source as fast as the first takers would be worth.

Every METAR station is scored on the keyless METAR chain, report by report: tgftp's file written at the report's own
AWC receipt less tgftp's median lead (7.7 s at US stations, 1.4 s elsewhere; `station_edge.keyless_written`). Toronto
is also scored on its SWOB-ML file (`CYYZ-MAN`), written a fixed time after the observation: the median of every
Last-Modified the two live polls saw (the speed study's committed `inputs/poll/obs.jsonl.gz` and this study's
`results/live_latency.json`), and, as a sensitivity, at each of them.

USLATE's fill model (PMLATE's frozen rule, `uslate_test.py`) on the exploration month's bucket deaths
(`station_edge.deaths`), with USLATE-FAST's instant: the source's write + a 1 s poll + 0.25 s dispatch, and only the
prints the data API stamps at least 3 s after that (`station_edge.ACT_S` = 4.25 s after the write). From there every
stale print with a gross edge of at least 1¢ fills half its size at its own price, in time order, until the bucket
has cost $100; the market's fee on the fill; held to resolution (a trap loses 1 − g + fee a share). Nothing here is a
test: September was read, and the stations were picked on it.

* `stations`: each station on the keyless chain, and `CYYZ@swob`.
* `swob_write_sensitivity`: Toronto at each measured SWOB-ML write time.
* `fixed_delay_by_station` and `pooled_fixed_delay`: a source that delivered every report 15, 30 or 60 s after its
  observation (a keyed feed as fast as the first takers), per station and pooled US / non-US, traps apart.
* `timing_rule_set`: the stations whose keyless source's median write is within 30 s of their median first stale
  print, per date, and what 56 days would give at September's rate: the power check of the draft FASTSRC as first
  computed, as corrected, and corrected with the US lead everywhere; it was withdrawn on it
  (`reviews/2026-09-27-wxsrc-study.md` §C1).
* `keyed_groups`: the same per date for the stations each keyed source would serve (§C2's power checks).

usage: candidates_explore.py <out json>   (reads $PMLATE_DATA)
"""
import gzip
import json
import os
import statistics
import sys
from collections import defaultdict
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import station_edge as S  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
SPEED_OBS = os.path.join(HERE, "..", "..", "speed", "inputs", "poll", "obs.jsonl.gz")
LIVE = os.path.join(HERE, "..", "results", "live_latency.json")
CAP = 100.0
TEST_DAYS = 56


def swob_written():
    """{observation UTC: seconds from the observation to CYYZ-MAN SWOB-ML's Last-Modified}, both live polls."""
    out = {}
    with gzip.open(SPEED_OBS, "rt") as f:
        for x in f:
            r = json.loads(x)
            if r.get("src") == "msc_swob" and (r.get("meta") or {}).get("lm"):
                du = datetime.fromtimestamp(r["obs"], timezone.utc).strftime("%Y-%m-%dT%H:%MZ")
                out[du] = round(r["meta"]["lm"] - r["obs"], 1)
    live = json.load(open(LIVE))["last_modified_after_data_s"].get("msc_swob|CYYZ", {})
    out.update(live)
    return dict(sorted(out.items()))


def capture(stale, start, trap):
    cost = pnl = 0.0
    filled = False
    for dt, size, g, net, w in stale:
        if dt < start or g < 0.01:
            continue
        sh = size / 2.0
        c = 1.0 - g
        if c <= 0:
            continue
        if cost + sh * c > CAP:
            sh = (CAP - cost) / c
        if sh <= 0:
            break
        f = g - net   # the fee per share
        filled = True
        cost += sh * c
        pnl += sh * ((-(1.0 - g) - f) if trap else (g - f))
        if cost >= CAP - 1e-9:
            break
    return pnl, cost, filled


def start_of(d, kind, val, lead=None, act=None):
    act = S.ACT_S if act is None else act
    if kind == "fixed":
        return val + act
    if not d["receipt"]:
        return None
    if lead is not None:
        return d["receipt"] - lead - d["obs"] + act
    return S.keyless_written(d) + act


def score(D, st, kind, val, lead=None, act=None):
    tot = defaultdict(float)
    n_b, dts, traps = 0, set(), 0
    by_date = defaultdict(float)
    for d in D:
        if d["station"] != st:
            continue
        start = start_of(d, kind, val, lead, act)
        if start is None:
            continue
        pnl, cost, filled = capture(d["stale"], start, d["wrong"])
        if filled:
            n_b += 1
            dts.add(d["date"])
            traps += d["wrong"]
            tot["pnl"] += pnl
            tot["cost"] += cost
            by_date[d["date"]] += pnl
    return n_b, dts, traps, tot, by_date


def main():
    outp = sys.argv[1]
    D, days = S.deaths()
    dates = sorted({d["date"] for d in D})
    ndays = len(dates)
    sw = swob_written()
    swob_s = statistics.median(sw.values())
    res = {"sample": "bucket deaths, 2026-09-01 → 09-26 (PMLATE's exploration month); USLATE's fill model",
           "days": ndays, "act_after_write_s": S.ACT_S, "keyless_lead_s": S.KEYLESS_LEAD_S,
           "swob_written_s_by_obs": sw, "swob_written_s_median": swob_s, "stations": {}}
    cands = {st: (st, ("tgftp", None)) for st in sorted({d["station"] for d in D})}
    cands["CYYZ@swob"] = ("CYYZ", ("fixed", swob_s))
    for key, (st, (kind, val)) in cands.items():
        n_b, dts, traps, tot, by_date = score(D, st, kind, val)
        best = max(by_date.items(), key=lambda kv: kv[1]) if by_date else (None, 0)
        res["stations"][key] = {"source_delay": [kind, val], "buckets_filled": n_b, "dates": len(dts),
                                "traps_filled": traps, "pnl_usd": round(tot["pnl"], 2), "cost_usd": round(tot["cost"], 2),
                                "pnl_per_day_usd": round(tot["pnl"] / ndays, 2),
                                "best_date": best[0],
                                "best_date_share": round(best[1] / tot["pnl"], 3) if tot["pnl"] > 0 else None}
    res["swob_write_sensitivity"] = {}
    for du, w in sw.items():
        n_b, dts, traps, tot, by_date = score(D, "CYYZ", "fixed", w)
        res["swob_write_sensitivity"][du] = {"written_s": w, "buckets_filled": n_b, "pnl_usd": round(tot["pnl"], 2)}
    # a source as fast as the first takers: every report written 15 / 30 / 60 s after its observation
    res["fixed_delay_by_station"] = {}
    for st in sorted({d["station"] for d in D}):
        row = {}
        for delay in (15.0, 30.0, 60.0):
            n_b, dts, traps, tot, by_date = score(D, st, "fixed", delay)
            row[f"{int(delay)}s"] = {"buckets_filled": n_b, "traps_filled": traps, "pnl_usd": round(tot["pnl"], 2)}
        res["fixed_delay_by_station"][st] = row
    pooled = {}
    for delay in (15.0, 30.0, 60.0):
        for reg in ("US", "non-US"):
            held = trap = 0.0
            n_b = 0
            for d in D:
                if S.region(d["station"]) != reg:
                    continue
                pnl, cost, filled = capture(d["stale"], delay + S.ACT_S, d["wrong"])
                if filled:
                    n_b += 1
                    if d["wrong"]:
                        trap += pnl
                    else:
                        held += pnl
            pooled[f"{reg}@{int(delay)}s"] = {"buckets_filled": n_b, "held_pnl_usd": round(held, 2),
                                             "trap_pnl_usd": round(trap, 2),
                                             "per_day_usd": round((held + trap) / ndays, 2)}
    res["pooled_fixed_delay"] = pooled
    # the keyed directions' power checks: each group of stations a keyed source would serve, at a fixed delay, per date
    groups = {"US (FAA SWIM)": sorted({d["station"] for d in D if S.region(d["station"]) == "US"}),
              "Seoul and Busan (KMA AMOS)": ["RKPK", "RKSI"], "Paris (Meteo-France DPObs)": ["LFPB"],
              "Amsterdam (KNMI)": ["EHAM"]}
    res["keyed_groups"] = {}
    for gname, sts in groups.items():
        row = {"stations": sts}
        for delay in (15.0, 30.0, 60.0):
            by_date, n_b, traps = defaultdict(float), 0, 0
            for st in sts:
                nb, dts, tr, tot, bd = score(D, st, "fixed", delay)
                n_b += nb
                traps += tr
                for k, v in bd.items():
                    by_date[k] += v
            xs = [by_date.get(t, 0.0) for t in dates]
            m, sd = statistics.mean(xs), statistics.pstdev(xs)
            row[f"{int(delay)}s"] = {"buckets_filled": n_b, "traps_filled": traps, "pnl_usd": round(sum(xs), 2),
                                     "per_day_mean_usd": round(m, 2), "per_day_sd_usd": round(sd, 2),
                                     "z_28_days": round(m * 28 ** 0.5 / sd, 2) if sd else None,
                                     "z_56_days": round(m * 56 ** 0.5 / sd, 2) if sd else None}
        res["keyed_groups"][gname] = row
    # the timing rule's stations (the withdrawn FASTSRC's power check): as the draft first computed it (tgftp's US lead
    # everywhere, prints from 2 s after the write, the SWOB-ML at the 72 s the live poll first saw at 02:00 UTC), as
    # corrected (tgftp's measured lead by region, USLATE-FAST's 4.25 s, the SWOB-ML at its median write), and the
    # correction with the US lead everywhere
    res["timing_rule_set"] = {}
    for label, lead, act, swob_at in (("as_drafted", S.KEYLESS_LEAD_S["US"], 2.0, 72.0),
                                      ("corrected", None, None, swob_s),
                                      ("corrected_us_lead", S.KEYLESS_LEAD_S["US"], None, swob_s)):
        rule = {"OPKC": ("tgftp", None), "CYYZ": ("fixed", swob_at), "SBGR": ("tgftp", None),
                "OEJN": ("tgftp", None), "WSSS": ("tgftp", None), "LLBG": ("tgftp", None)}
        by_date_all, n_all, dates_all, traps_all, by_st = defaultdict(float), 0, set(), 0, {}
        for st, (kind, val) in rule.items():
            n_b, dts, traps, tot, by_date = score(D, st, kind, val, lead, act)
            n_all += n_b
            dates_all |= dts
            traps_all += traps
            by_st[st] = round(tot["pnl"], 2)
            for k, v in by_date.items():
                by_date_all[k] += v
        xs = [by_date_all.get(t, 0.0) for t in dates]
        m, sd = statistics.mean(xs), statistics.pstdev(xs)
        se = sd * TEST_DAYS ** 0.5
        res["timing_rule_set"][label] = {
            "stations": sorted(rule), "buckets_filled": n_all, "dates_with_fill": len(dates_all),
            "traps_filled": traps_all, "pnl_usd": round(sum(xs), 2), "pnl_by_station_usd": by_st,
            "per_day_mean_usd": round(m, 2), "per_day_sd_usd": round(sd, 2), "test_days": TEST_DAYS,
            "expected_total_usd": round(m * TEST_DAYS, 2), "sd_of_total_usd": round(se, 2),
            "z": round(m * TEST_DAYS / se, 2) if se else None}
    with open(outp, "w") as f:
        json.dump(res, f, indent=1, sort_keys=True)
        f.write("\n")
    for k, v in pooled.items():
        print(k, v)
    print("swob", sw, "median", swob_s)
    print("swob sensitivity", res["swob_write_sensitivity"])
    print("timing_rule_set", res["timing_rule_set"])
    for st, v in sorted(res["stations"].items(), key=lambda kv: -kv[1]["pnl_usd"]):
        print(st, v["buckets_filled"], "buckets", v["dates"], "dates, traps", v["traps_filled"], "pnl", v["pnl_usd"],
              "per day", v["pnl_per_day_usd"], "best date share", v["best_date_share"])


if __name__ == "__main__":
    main()
