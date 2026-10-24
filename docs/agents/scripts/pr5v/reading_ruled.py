"""Rule D's reading: "Stablecoin quotes variant-2" (arm `d`, PR5V's arm `main` with rule D) against its
pre-registration's deviation check and five conditions.

Written 2026-10-24, committed before the deadline its pre-registration sets (2026-10-27 00:00 UTC), and run at the
reading, on or after 2026-10-28 01:00 UTC, on the exports `reading_pull_ruled.sql` takes and `reading_grab.py` cuts into
`docs/agents/backtests/pr5v/ruled/data/`. It was written strictly from `docs/agents/reviews/2026-09-28-pr5-rule-d-
prereg.md` and the deviations recorded for it (reference §4 item 47: deviation 1, TrueFX read before the turn, then
deviation 2, arm d reads PR5's stored X, so the replay's X is the X arm d recorded, `x_d`, and the window holds no TrueFX
minute; deviation 3, the governor 900 / 950; deviation 4, the 0.03 % rung left the twin only, not arm d), with no
discretionary choice: where the text is silent the narrowest reading it supports is taken and named
(`reading_common.GAPS` and `GAPS_RULED`, repeated in the output). Tested on synthetic data only (`test_reading.py`).
Its §9 "proposed, not run" line (arm d without its 0.03 % rungs) is not here: it was proposed to Davies, not adopted.

Not blind (the output says so): the ledger read the variants' daily results for 2026-09-28 -> 09-30 on 2026-09-30,
and no-peek rules were cancelled on 2026-10-04.

Variant-2 is judged only if arm v1 equals PR5V's arm main (the deviation check, before any condition).

    python3 -I docs/agents/scripts/pr5v/reading_ruled.py [DATA_DIR] [OUT.json]
    (defaults: docs/agents/backtests/pr5v/ruled/data and docs/agents/backtests/pr5v/ruled/reading.json)
"""
import collections, os, sys, time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import reading_common as C  # noqa: E402  (checks the frozen files' hashes as it loads)
import fastx_sim as X  # noqa: E402  (asserts pr5v_sim.py's hash itself)

S, V = C.S, C.V
PREREG = "docs/agents/reviews/2026-09-28-pr5-rule-d-prereg.md"
SEED_PAIRED = 20261028
CAPITAL = 3600.0
CHECK_MAX_USD = 0.01
DISCLOSURE = ("Not blind. The ledger read PR5V's and variant-2's daily results for 2026-09-28 -> 09-30 on 2026-09-30 "
              "(its history 22:14 UTC), before this script was written; no-peek rules were cancelled on 2026-10-04, and the "
              "stablecoin quote reviews of 2026-10-09 (which read both arms' records), 10-14, 10-18 and 10-21 read them. This "
              "script was written strictly from the pre-registration and its recorded deviations, with no discretionary choice.")
DEVIATIONS = {
    "1 (2026-09-30)": "the first engine priced a turn with a TrueFX rate read after it; code version 2 read TrueFX before the "
                      "turn (x_d_read < minute, which this reading confirms on every TrueFX row it exports).",
    "2 (2026-09-30, Davies)": "arm d reads PR5's stored X, as variant-1 does (code version 3): the replay's X is the X arm d "
                              "recorded, and the window should hold no TrueFX minute (counted below).",
    "3 (2026-10-01, Davies)": "both arms take the live design's governor, 900 / 950 (code version 4): the replay's gov and "
                              "condition 5 read 900 and 950. The reproduction check replays §1's runs, at their 600 / 700.",
    "4 (2026-10-09, Davies)": "the 0.03 % rung left rule D's twin only; arm d keeps nine rungs and is read unchanged.",
}
GAPS_RULED = {
    "check_window_days": "'checkMaxUsd over the window's days is under $0.01' is computed from the exports over the window's "
                         "days (the largest absolute difference of daily P&L, by UTC day of entry, between arm v1 and PR5V's "
                         "arm main); the engine's stored checkMaxUsd covers every day either has a trip and is reported beside it.",
    "paired_gain_by_source": "'The paired gain on each set' of minutes (TrueFX, Yahoo) is the sum, over the window's trips "
                             "entered in a minute of that set, of arm d's P&L less PR5V's arm main's.",
}


def daily_max_abs(a, b, w0, w1):
    da, db = collections.Counter(), collections.Counter()
    for x in a:
        if w0 <= x["t_entry"] < w1:
            da[x["t_entry"] // C.DAY] += x["pnl_usd"]
    for x in b:
        if w0 <= x["t_entry"] < w1:
            db[x["t_entry"] // C.DAY] += x["pnl_usd"]
    days = set(da) | set(db)
    return (max((abs(da[d] - db[d]) for d in days), default=0.0), len(days))


def run(data, out, now_ms=None, R=None):
    t_start = time.time()
    res = {"what": "Rule D's reading (" + PREREG + ")", "disclosure": DISCLOSURE, "deviations": DEVIATIONS,
           "gaps": dict(C.GAPS, **GAPS_RULED), "hashes": C.check_hashes(("fastx_sim.py", "pr5v_sim.py", "../pr5/pr5_sim.py", "study.py")),
           "reading_scripts": {f: C.sha(os.path.join(HERE, f)) for f in ("reading_common.py", "reading_ruled.py")}}
    now_ms = int(time.time() * 1000) if now_ms is None else now_ms
    res["run_at"] = C.iso(now_ms)
    res["run_at_or_after_earliest_instant"] = now_ms >= C.READ_FROM
    R = R or S.Runner()
    res["reproduction"] = C.study_reproduction(R, X.simulate, C.NINE, C.RULE_D, {"N": (593, 30.3004), "F": (60, 3.742)})
    if not res["reproduction"]["pass"]:
        res["status"] = "stopped: the replay's markets do not reproduce §1's rule D runs; no export was opened"
        C.write(out, res)
        return res

    meta = C.load_kv(data, "meta")
    num = lambda k: int(meta[k]) if meta.get(k) else None  # noqa: E731
    last_d, last_p, last_v = num("ruled_last_minute"), num("pr5_last_minute"), num("pr5v_last_minute")
    res["record"] = {"ruled_last_minute": C.iso(last_d) if last_d else None, "ruled_code_version": meta.get("ruled_code_version"),
                     "ruled_last_error": meta.get("ruled_last_error") or None, "pr5_last_minute": C.iso(last_p) if last_p else None,
                     "pr5v_last_minute": C.iso(last_v) if last_v else None,
                     "stored_check_max_usd": float(meta["check_max_usd"]) if meta.get("check_max_usd") else None,
                     "stored_check_days": num("check_days")}
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
    if last_d is None or last_d < w["e"] - C.M or last_v is None or last_v < w["e"] - C.M:
        res["status"] = "wait: rule D's or PR5V's engine has not decided every minute before E"
        C.write(out, res)
        return res
    w0, w1, e, days = w["w0"], w["w1"], w["e"], w["days"]
    trips = C.load_trips(data, "trips")
    events = C.load_events(data)
    pr5v = C.load_trips(data, "pr5v_main_trips")
    res["export_complete"] = C.counts_match(meta, {"minutes": sum(len(v) for v in minutes.values()), "events": len(events), "trips": len(trips)})
    if not res["export_complete"]["pass"]:
        res["status"] = "stopped: the export's pages do not add up to the meta statement's counts; take it again"
        C.write(out, res)
        return res
    eng = {a: [x for x in trips if x["arm"] == a] for a in ("d", "v1")}
    pv_w = C.in_window(pr5v, w0, w1)

    # the deviation, before any condition
    dev = C.faithful(pv_w, C.in_window(eng["v1"], w0, w1), label_e="pr5v_main", label_r="v1")
    mx, nd = daily_max_abs(eng["v1"], pr5v, w0, w1)
    dev["max_abs_daily_diff_usd_window"] = round(mx, 9)
    dev["window_days_with_a_trip"] = nd
    dev["check_under_001"] = mx < CHECK_MAX_USD
    dev["pass"] = bool(dev["pass"] and dev["check_under_001"])
    res["deviation_check"] = dev

    mk = C.markets(prints, minutes, xfield="x_d")
    res["print_count_differs"] = C.print_count_diffs(prints, minutes, C.START, e)
    res["rebuilt_minutes"] = {b: [C.iso(m) for m, r in sorted(minutes[b].items()) if r["source"] == "rebuilt" and C.START <= m < e] for b in C.BOOKS}
    rep = X.simulate([mk[b] for b in C.BOOKS], C.cfg(C.NINE, C.GOV, rule=C.RULE_D), C.START, e)
    stress = X.simulate([mk[b] for b in C.BOOKS], C.cfg(C.NINE, C.GOV, stress=True, rule=C.RULE_D), C.START, e, collect_posts=False)
    ew, rw, sw = C.in_window(eng["d"], w0, w1), C.in_window(rep["trips"], w0, w1), C.in_window(stress["trips"], w0, w1)
    cond = {"1_faithful": C.faithful(ew, rw),
            "2_above_null": C.above_null(R, mk, C.NINE, eng["d"], w0, w1, e),
            "3_better_than_variant1": C.paired(eng["d"], pr5v, w0, w1, SEED_PAIRED),
            "4_stress": {"trips": len(sw), "pnl_usd": round(sum(x["pnl_usd"] for x in sw), 6), "pass": sum(x["pnl_usd"] for x in sw) > 0},
            "5_governor": C.governor(events, "d", C.GOV),
            "replay_closed_at_last_step": C.last_step_closes(rw, e) + C.last_step_closes(sw, e)}
    res["d"] = cond
    names = ("1_faithful", "2_above_null", "3_better_than_variant1", "4_stress", "5_governor")
    clean = not cond["replay_closed_at_last_step"]
    judged = days >= C.MIN_DAYS and dev["pass"] and clean
    passed = all(cond[c]["pass"] for c in names)
    why_not = None if judged else (f"{days} days < {C.MIN_DAYS}" if days < C.MIN_DAYS else
                                   "the deviation check failed: the shared function drifted" if not dev["pass"] else
                                   "a scored replay trip closed at the run's last step")
    res["verdict"] = {"judged": judged, "pass": bool(judged and passed), "conditions": {c: cond[c]["pass"] for c in names},
                      "replay_closed_at_last_step_ok": clean,
                      "reading": ("PASS" if passed else "FAIL") if judged else f"reported, not judged ({why_not})"}

    # described, never judged
    src = {b: {m: r.get("x_source") for m, r in minutes[b].items()} for b in C.BOOKS}
    win_min = [(b, m) for b in C.BOOKS for m in range(w0, w1, C.M)]
    count = collections.Counter(src[b].get(m) for b, m in win_min)
    truefx_rows = [(b, m, r) for b in C.BOOKS for m, r in minutes[b].items() if r.get("x_source") == "truefx"]
    bad_read = [[b, C.iso(m)] for b, m, r in truefx_rows if not (r.get("x_d_read") is not None and r["x_d_read"] < m)]
    gain = collections.Counter()
    for x in ew:
        gain[src[x["book"]].get(x["t_entry"]) or "none"] += x["pnl_usd"]
    for x in pv_w:
        gain[src[x["book"]].get(x["t_entry"]) or "none"] -= x["pnl_usd"]
    tot = (sum(x["pnl_usd"] for x in ew) - sum(x["pnl_usd"] for x in pv_w)) / days if days else None
    res["described"] = {
        "d": C.trips_table(ew, CAPITAL, days), "v1": C.trips_table(C.in_window(eng["v1"], w0, w1), CAPITAL, days),
        "pr5v_main": C.trips_table(pv_w, CAPITAL, days),
        "gain_over_variant1": {"usd_per_day": round(tot, 6) if tot is not None else None, "extra_capital_usd": 0.0,
                               "note": "rule D locks the same $3,600 as variant-1"},
        "x_source_window_book_minutes": {str(k): v for k, v in sorted(count.items(), key=lambda kv: str(kv[0]))},
        "truefx_rows_exported": len(truefx_rows), "truefx_rows_read_at_or_after_their_minute": bad_read,
        "paired_gain_by_x_source_usd": {k: round(v, 6) for k, v in sorted(gain.items())},
        "posts_d": C.post_tables(events, "d", w0, w1), "posts_v1": C.post_tables(events, "v1", w0, w1),
    }
    res["status"] = "read"
    res["seconds"] = round(time.time() - t_start, 1)
    C.write(out, res)
    return res


if __name__ == "__main__":
    a = sys.argv[1:]
    data = a[0] if a else os.path.join(C.ROOT, "docs/agents/backtests/pr5v/ruled/data")
    out = a[1] if len(a) > 1 else os.path.join(C.ROOT, "docs/agents/backtests/pr5v/ruled/reading.json")
    r = run(data, out)
    print(r["status"], r.get("verdict", {}).get("reading", ""))
