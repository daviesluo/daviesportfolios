"""PR5V's reading: "Stablecoin quotes - variant" (arm `main`) against its pre-registration's five conditions.

Written 2026-10-24, committed before the deadline its pre-registration sets (2026-10-27 00:00 UTC), and run at the
reading, on or after 2026-10-28 01:00 UTC, on the exports `reading_pull.sql` takes and `reading_grab.py` cuts into
`docs/agents/backtests/pr5v/forward/data/`. It was written strictly from `docs/agents/reviews/2026-09-28-pr5-variant-
prereg.md` and the deviations recorded for it (reference §4 item 45: deviation 1, the engine's code version bumped and
the record re-decided, which changes nothing read here; deviation 2, the governor 900 / 950, which the replay's `gov`
and condition 5 take), with no discretionary choice: where the text is silent the narrowest reading it supports is
taken and named (`reading_common.GAPS`, repeated in the output). It was tested on synthetic data only
(`test_reading.py`, `reading_fixture.py`), before any real reading.

Not blind (the output says so): the ledger read the variants' daily results for 2026-09-28 -> 09-30 on 2026-09-30
(22:14 UTC), and no-peek rules were cancelled on 2026-10-04.

Steps, in the pre-registration's order: the frozen files' hashes; the replay's markets built from the study's own Mkt
values reproduce the study's runs of main on its stock markets, trip for trip and POST for POST, and ref_timing.json's
numbers for main (563 trips, $29.5129; 40 trips, $2.5438), before any export is opened; the preconditions (the engine
decided every minute before E; PR5's record and stepMinute, §3's end rule); the replay of main at §2's settings and its
stress arm, flat from 2026-09-28 00:00 to E; conditions 1-5; then everything §5 describes.

    python3 -I docs/agents/scripts/pr5v/reading_pr5v.py [DATA_DIR] [OUT.json]
    (defaults: docs/agents/backtests/pr5v/forward/data and docs/agents/backtests/pr5v/forward/reading.json)
"""
import os, sys, time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import reading_common as C  # noqa: E402  (checks the frozen files' hashes as it loads)

S, V = C.S, C.V
PREREG = "docs/agents/reviews/2026-09-28-pr5-variant-prereg.md"
SEED_PAIRED = 20261027
CAPITAL_MAIN, CAPITAL_TOP5, CAPITAL_PR5_EXTRA = 3600.0, 2000.0, 2400.0
DISCLOSURE = ("Not blind. The ledger read PR5V's and variant-2's daily results for 2026-09-28 -> 09-30 on 2026-09-30 "
              "(its history 22:14 UTC), before this script was written; no-peek rules were cancelled on 2026-10-04, and the "
              "stablecoin quote reviews of 2026-10-09, 10-14, 10-18 and 10-21 read the variants' records. This script was "
              "written strictly from the pre-registration and its recorded deviations, with no discretionary choice.")
DEVIATIONS = {
    "1 (2026-09-30)": "VARIANT_CODE_VERSION bumped to 2 and the record re-decided from 2026-09-28 00:00 (entryBand added "
                      "after minutes were decided); changes no input of this reading.",
    "2 (2026-10-01, Davies)": "the governor is the live design's, 900 / 950: the replay's gov and condition 5 read 900 and "
                              "950 (VARIANT_CODE_VERSION 3, re-decided from 2026-09-28 00:00). The reproduction check "
                              "replays the study's runs, at their 600 / 700.",
}


def run(data, out, now_ms=None, R=None):
    t_start = time.time()
    res = {"what": "PR5V's reading (" + PREREG + ")", "disclosure": DISCLOSURE, "deviations": DEVIATIONS, "gaps": C.GAPS,
           "hashes": C.check_hashes(("pr5v_sim.py", "../pr5/pr5_sim.py", "study.py")),
           "reading_scripts": {f: C.sha(os.path.join(HERE, f)) for f in ("reading_common.py", "reading_pr5v.py")}}
    now_ms = int(time.time() * 1000) if now_ms is None else now_ms
    res["run_at"] = C.iso(now_ms)
    res["run_at_or_after_earliest_instant"] = now_ms >= C.READ_FROM
    R = R or S.Runner()
    res["reproduction"] = C.study_reproduction(R, V.simulate, C.NINE, None, {"N": (563, 29.5129), "F": (40, 2.5438)})
    if not res["reproduction"]["pass"]:
        res["status"] = "stopped: the replay's markets do not reproduce the study's runs; no export was opened"
        C.write(out, res)
        return res

    meta = C.load_kv(data, "meta")
    last_v = int(meta["variant_last_minute"]) if meta.get("variant_last_minute") else None
    last_p = int(meta["pr5_last_minute"]) if meta.get("pr5_last_minute") else None
    first_live = int(meta["first_live_order"]) if meta.get("first_live_order") else None
    res["record"] = {"variant_last_minute": C.iso(last_v) if last_v else None, "variant_code_version": meta.get("variant_code_version"),
                     "variant_last_error": meta.get("variant_last_error") or None, "pr5_last_minute": C.iso(last_p) if last_p else None,
                     "first_live_order": C.iso(first_live) if first_live else None}
    sm = C.step_minute_unchanged()
    res["step_minute"] = sm
    if sm.get("checked") and not sm["unchanged"]:
        res["status"] = "stopped: stepMinute changed after the freeze (GAPS stepminute_changed): §3's end rule needs its deploy date"
        C.write(out, res)
        return res
    prints, minutes = C.load_prints(data), C.load_minutes(data)
    w = C.window(minutes, last_p)
    res["window"] = {k: (C.iso(v) if k in ("w0", "w1", "e") else v) for k, v in w.items()}
    if not w["ok"]:
        res["status"] = "wait: " + w["why"]
        C.write(out, res)
        return res
    if last_v is None or last_v < w["e"] - C.M:
        res["status"] = "wait: the variant's engine has not decided every minute before E"
        C.write(out, res)
        return res
    w0, w1, e, days = w["w0"], w["w1"], w["e"], w["days"]
    trips = C.load_trips(data, "trips")
    events = C.load_events(data)
    pr5 = C.load_trips(data, "pr5_trips", arm_first=False)
    res["export_complete"] = C.counts_match(meta, {"minutes": sum(len(v) for v in minutes.values()), "events": len(events),
                                                   "trips": len(trips), "pr5_trips": len(pr5)})
    if not res["export_complete"]["pass"]:
        res["status"] = "stopped: the export's pages do not add up to the meta statement's counts; take it again"
        C.write(out, res)
        return res
    eng = {a: [x for x in trips if x["arm"] == a] for a in ("main", "top5")}
    mk = C.markets(prints, minutes)
    res["print_count_differs"] = C.print_count_diffs(prints, minutes, C.START, e)
    res["rebuilt_minutes"] = {b: [C.iso(m) for m, r in sorted(minutes[b].items()) if r["source"] == "rebuilt" and C.START <= m < e] for b in C.BOOKS}

    def arm(name, rungs):
        rep = V.simulate([mk[b] for b in C.BOOKS], C.cfg(rungs, C.GOV), C.START, e)
        stress = V.simulate([mk[b] for b in C.BOOKS], C.cfg(rungs, C.GOV, stress=True), C.START, e, collect_posts=False)
        ew, rw, sw = C.in_window(eng[name], w0, w1), C.in_window(rep["trips"], w0, w1), C.in_window(stress["trips"], w0, w1)
        out = {"1_faithful": C.faithful(ew, rw),
               "2_above_null": C.above_null(R, mk, rungs, eng[name], w0, w1, e),
               "3_better_than_pr5": C.paired(eng[name], pr5, w0, w1, SEED_PAIRED),
               "4_stress": {"trips": len(sw), "pnl_usd": round(sum(x["pnl_usd"] for x in sw), 6), "pass": sum(x["pnl_usd"] for x in sw) > 0},
               "5_governor": C.governor(events, name, C.GOV),
               "replay_closed_at_last_step": C.last_step_closes(rw, e) + C.last_step_closes(sw, e)}
        return out, ew

    main, ew_main = arm("main", C.NINE)
    clean = not main["replay_closed_at_last_step"]
    judged = days >= C.MIN_DAYS and clean
    passed = all(main[c]["pass"] for c in ("1_faithful", "2_above_null", "3_better_than_pr5", "4_stress", "5_governor"))
    why_not = None if judged else (f"{days} days < {C.MIN_DAYS}" if days < C.MIN_DAYS else "a scored replay trip closed at the run's last step")
    res["main"] = main
    res["verdict"] = {"judged": judged, "pass": bool(judged and passed),
                      "conditions": {c: main[c]["pass"] for c in ("1_faithful", "2_above_null", "3_better_than_pr5", "4_stress", "5_governor")},
                      "replay_closed_at_last_step_ok": clean,
                      "reading": ("PASS" if passed else "FAIL") if judged else f"reported, not judged ({why_not})"}

    pr5w = C.in_window(pr5, w0, w1)
    gain = (sum(x["pnl_usd"] for x in ew_main) - sum(x["pnl_usd"] for x in pr5w)) / days if days else None
    line = CAPITAL_PR5_EXTRA * 0.08 / 365
    top5, ew_top5 = arm("top5", C.TOP5)
    res["described"] = {
        "main": C.trips_table(ew_main, CAPITAL_MAIN, days),
        "pr5": C.trips_table(pr5w, 1200.0, days),                 # PR5's paper rule at its own $1,200 (twelve $100 rungs)
        "extra_capital": {"gain_over_pr5_usd_per_day": round(gain, 6) if gain is not None else None,
                          "line_8pct_on_2400_usd_per_day": round(line, 6),
                          "gain_pct_per_year_on_the_extra_2400": round(100 * gain * 365 / CAPITAL_PR5_EXTRA, 4) if gain is not None else None},
        "top5": {"conditions_never_judged": top5, "table": C.trips_table(ew_top5, CAPITAL_TOP5, days)},
        "posts_main": C.post_tables(events, "main", w0, w1), "posts_top5": C.post_tables(events, "top5", w0, w1),
        "pr5_first_live_order": C.first_live_split(eng["main"], pr5, first_live, w0, w1),
    }
    res["status"] = "read"
    res["seconds"] = round(time.time() - t_start, 1)
    C.write(out, res)
    return res


if __name__ == "__main__":
    a = sys.argv[1:]
    data = a[0] if a else os.path.join(C.ROOT, "docs/agents/backtests/pr5v/forward/data")
    out = a[1] if len(a) > 1 else os.path.join(C.ROOT, "docs/agents/backtests/pr5v/forward/reading.json")
    r = run(data, out)
    print(r["status"], r.get("verdict", {}).get("reading", ""))
