"""Descriptive: CB's primary and no-cap arms on 2025-10-10 only (the one crash day of the pre-rule window),
to say how much the retroactive price range cap removed that day. Re-runs cb_test.run_symbol for the
symbols with trips that day; writes results/cb_day_20251010.json."""
import json, os, sys, importlib.util
S = os.environ.get("FP_ROOT", ".") + "/research_fp3"
spec = importlib.util.spec_from_file_location("cb", os.path.join(S, "analysis", "cb_test.py"))
sys.argv = ["x", "/dev/null"]; cb = importlib.util.module_from_spec(spec); spec.loader.exec_module(cb)
syms = sorted(s for s in cb.SCREEN if "2025-10-10" in cb.SCREEN[s])
res = {}
for name, arm in [("primary", {"fee": cb.FEE, "hmult": 1.0, "cap": True, "close_twin": False}),
                  ("no_cap", {"fee": cb.FEE, "hmult": 1.0, "cap": False, "close_twin": False})]:
    trips = [t for s in syms for t in cb.run_symbol(s, arm) if cb.day_of(t["t"]) == "2025-10-10"]
    res[name] = {"trips": len(trips), "pnl": round(sum(t["pnl"] for t in trips), 4),
                 "by_symbol": {s: round(sum(t["pnl"] for t in trips if t["sym"] == s), 4) for s in syms if any(t["sym"] == s for t in trips)},
                 "deepest_fill_drop": round(min((t["drop_to_low"] for t in trips), default=0), 4)}
json.dump({"symbols_screened_that_day": syms, **res}, open(os.path.join(S, "results", "cb_day_20251010.json"), "w"), indent=1)
print(json.dumps(res, indent=1))
