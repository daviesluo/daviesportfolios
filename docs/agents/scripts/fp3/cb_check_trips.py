"""Hand check of CB trips against the raw 1-minute klines: for every 25th OOS trip of the primary arm and every
OOS time-stop trip of 2026, re-derive the bid from the close two minutes earlier, the fill (low strictly below),
the price-range cap, the target exit (a later high strictly above) or the time-stop close, and the P&L."""
import json, os, datetime
S = os.environ.get("FP_ROOT", ".") + "/research_fp3"
r = json.load(open(os.path.join(S, "results", "cb_run1.json")))
rules = {x["symbol"]: 1 - float(x["rules"][0]["bidLimitMultDown"]) for x in json.load(open(os.path.join(S, "data", "binance_executionRules_all.json")))["symbolRules"]}
hs = json.load(open(os.path.join(S, "data", "cb_spreads.json")))["half_spread_bps"]
oos = [t for t in r["trips_primary"] if t["win"] in ("OOS1", "OOS2")]
pick = oos[::25] + [t for t in oos if t["kind"] == "stop" and t["t"] >= 1767225600000][:6]
cache = {}
out = []
for t in pick:
    s = t["sym"]
    if s not in cache:
        cache[s] = {row[0]: row for row in json.load(open(os.path.join(S, "data", "bn_1m_cb", f"{s}.json")))}
    k = cache[s]; m = t["t"]
    c2 = k[m - 120000][4]; bid = c2 * (1 - t["k"]); lo = k[m][3]
    ref5 = sum(k[m - j * 60000][4] for j in range(1, 6)) / 5
    cap_ok = bid > ref5 * (1 - rules.get(s, 0.25))
    tgt = bid * (1 + t["k"] / 2)
    if t["kind"] == "target":
        first = next(x for x in range(m + 60000, t["exit_t"] + 1, 60000) if k[x][2] > tgt)
        exit_ok = first == t["exit_t"] and abs(t["exit"] - tgt) < 1e-5 * tgt  # the JSON rounds prices to 10 decimals (PEPE-scale prices lose ~1e-6 relative)
    else:
        exit_ok = t["exit_t"] == m + 1440 * 60000 and abs(t["exit"] - k[t["exit_t"]][4] * (1 - hs.get(s, 5.0) / 1e4)) < 1e-5 * t["exit"] and all(k[x][2] <= tgt for x in range(m + 60000, t["exit_t"], 60000))
    qty = 100 / bid
    pnl = (t["exit"] - bid) * qty - 0.001 * 100 - 0.001 * t["exit"] * qty
    out.append({"sym": s, "t": datetime.datetime.utcfromtimestamp(m / 1000).isoformat()[:16], "k": t["k"], "bid_ok": abs(bid - t["entry"]) < 1e-5 * bid,
                "fill_ok": lo < bid, "cap_ok": cap_ok, "exit_ok": exit_ok, "kind": t["kind"], "pnl_ok": abs(pnl - t["pnl"]) < 1e-3, "pnl": t["pnl"],
                "drop_from_c2_to_low": round(lo / c2 - 1, 4)})
json.dump(out, open(os.path.join(S, "results", "cb_check_trips.json"), "w"), indent=1)
bad = [o for o in out if not (o["bid_ok"] and o["fill_ok"] and o["cap_ok"] and o["exit_ok"] and o["pnl_ok"])]
print(len(out), "checked,", len(bad), "failed")
for o in out: print(o)
