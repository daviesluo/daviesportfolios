"""Fixture check for CB's screen: run the primary fill rule over FULL months of 1-minute klines (every day, not
only the screened ones) for four symbol-months and compare the fills with cb_run1.json's trips in those
months. The screen is a necessary condition, so the two lists must be identical."""
import json, os, sys, datetime, importlib.util
S = os.environ.get("FP_ROOT", ".") + "/research_fp3"
spec = importlib.util.spec_from_file_location("cb", os.path.join(S, "analysis", "cb_test.py"))
sys.argv = ["x", "/dev/null"]; cb = importlib.util.module_from_spec(spec); spec.loader.exec_module(cb)
r = json.load(open(os.path.join(S, "results", "cb_run1.json")))
res = {}
for sym, month in [("SOLUSDT", "2024-08"), ("DOGEUSDT", "2024-03"), ("PEPEUSDT", "2024-03"), ("BANKUSDT", "2026-07")]:
    rows = json.load(open(os.path.join(S, "data", "bn_1m_cb_fullmonth", f"{sym}.json")))
    rows = [x[:6] for x in rows]
    days_in = cb.days_in.get(sym, set())
    fills = []
    for i in range(5, len(rows)):
        t, o, hi, lo, c, v = rows[i]
        dd = cb.day_of(t)
        if dd not in days_in or rows[i - 5][0] != t - 300000: continue
        c2 = rows[i - 2][4]; ref5 = sum(rows[j][4] for j in range(i - 5, i)) / 5
        for k in cb.RUNGS:
            bid = c2 * (1 - k)
            if lo < bid and bid > ref5 * (1 - cb.RULES.get(sym, 0.25)):
                fills.append((t, k))
    # the simulator also blocks a rung while a position is open; compare candidate fill minutes, not trips
    trips = sorted((x["t"], x["k"]) for x in r["trips_primary"] if x["sym"] == sym and cb.day_of(x["t"])[:7] == month)
    cand = sorted(set(fills))
    screened = set(cb.SCREEN.get(sym, []))
    unscreened = [f for f in cand if cb.day_of(f[0]) not in screened]
    missing = [tr for tr in trips if tr not in set(cand)]
    res[f"{sym} {month}"] = {"candidate_fill_minutes": len(cand), "trips_in_run": len(trips), "candidates_on_unscreened_days": len(unscreened), "trips_not_candidates": len(missing)}
json.dump(res, open(os.path.join(S, "results", "cb_check_screen.json"), "w"), indent=1)
print(json.dumps(res, indent=1))
