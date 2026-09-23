"""Hand check of ZF trips against the per-minute print levels: for sample OOS trips of the primary arm,
the entry minute must hold a print strictly beyond the order price and the exit minute (if a maker exit)
a print strictly beyond the exit price. Also recomputes the fair of the entry minute from scratch."""
import json, os, sys, datetime, statistics
S = os.environ.get("FP_ROOT", ".") + "/research_fp3"
r = json.load(open(os.path.join(S, "results", "zf_run1.json")))
out = []
for book in ["UUSDT", "XUSDUSDT", "EURIUSDT", "RLUSDUSDT"]:
    mins = json.load(open(os.path.join(S, "data", "aggtrades", f"{book}_min.json")))
    trips = r["sample_trips"][book][:5]
    for t in trips:
        m = str(t["t"]); lv = mins.get(m)
        ok_entry = lv is not None and ((t["side"] == "long" and min(p for p, _ in lv[1]) < t["entry"]) or (t["side"] == "short" and max(p for p, _ in lv[1]) > t["entry"]))
        # exit minute
        xm = str(t["t"] + (t["exit_i"] - t["i"]) * 60000)
        xl = mins.get(xm)
        if t["kind"] == "maker":
            ok_exit = xl is not None and ((t["side"] == "long" and max(p for p, _ in xl[1]) > t["exit"]) or (t["side"] == "short" and min(p for p, _ in xl[1]) < t["exit"]))
        else:
            ok_exit = None
        # recompute fair for non-EUR books: median of last prints in the 1,440 minutes before the hour of (t - 1 min)
        tm1 = t["t"] - 60000; h = tm1 - tm1 % 3600000
        if book != "EURIUSDT":
            vals = [mins[str(x)][0] for x in range(h - 1440 * 60000, h, 60000) if str(x) in mins]
            s = sorted(vals); n = len(s); fair = s[n // 2] if n % 2 else 0.5 * (s[n // 2 - 1] + s[n // 2])
        else:
            fair = None
        out.append({"book": book, "t": datetime.datetime.utcfromtimestamp(t["t"] / 1000).isoformat(), "side": t["side"], "d": t["d"], "entry": t["entry"],
                    "exit": t["exit"], "kind": t["kind"], "pnl": t["pnl"], "entry_print_through": ok_entry, "exit_print_through": ok_exit,
                    "recomputed_fair": fair, "entry_levels": lv[1][:4] if lv else None})
json.dump(out, open(os.path.join(S, "results", "zf_check_trips.json"), "w"), indent=1)
for o in out: print(o["book"], o["t"], o["side"], o["d"], o["entry"], o["exit"], o["kind"], round(o["pnl"], 5), "entry ok", o["entry_print_through"], "exit ok", o["exit_print_through"], "fair", o["recomputed_fair"])
