"""POST-HOC, descriptive only (written after cb_run1.json existed): CB's primary trips split by the seven
majors that carry a +-15 % price range (BTC ETH BNB XRP TRX DOGE SOL) vs every other coin; by calendar
half-year; and since the price range rule. No split here is a finding: each would need its own
pre-registration and its own out-of-sample time."""
import json, os, datetime
S = os.environ.get("FP_ROOT", ".") + "/research_fp3"
r = json.load(open(os.path.join(S, "results", "cb_run1.json")))
MAJ = {"BTCUSDT", "ETHUSDT", "BNBUSDT", "XRPUSDT", "TRXUSDT", "DOGEUSDT", "SOLUSDT"}
def d(t): return datetime.datetime.utcfromtimestamp(t / 1000)
out = {"by_group_window": {}, "by_half_year": {}, "since_rule_by_group": {}}
for t in r["trips_primary"]:
    g = "majors" if t["sym"] in MAJ else "others"
    k = f"{g}|{t['win']}"
    e = out["by_group_window"].setdefault(k, [0.0, 0]); e[0] += t["pnl"]; e[1] += 1
    hy = f"{d(t['t']).year}H{1 if d(t['t']).month <= 6 else 2}"
    e = out["by_half_year"].setdefault(hy, [0.0, 0]); e[0] += t["pnl"]; e[1] += 1
    if d(t["t"]).strftime("%Y-%m-%d") >= "2026-04-01":
        e = out["since_rule_by_group"].setdefault(g, [0.0, 0]); e[0] += t["pnl"]; e[1] += 1
for sec in out.values():
    for k in sec: sec[k] = [round(sec[k][0], 2), sec[k][1]]
json.dump(out, open(os.path.join(S, "results", "cb_posthoc.json"), "w"), indent=1, sort_keys=True)
print(json.dumps(out, indent=1, sort_keys=True))
