"""Descriptive (kill) measurement: what a long bought at the close of a new Binance USDT listing's
first UTC day earns 1, 7 and 30 days later, for every USDT pair first traded 2022-01-01 → 2026-08-22
(daily klines of the xsmom pipeline, delisted pairs included; stables, fiat, leveraged and stock
tokens excluded). No costs. Writes results/m_listing_drift.json."""
import json, os, glob, datetime, statistics
S = os.environ.get("FP_ROOT", ".") + "/research_fp3"
DAILY = os.environ.get("FP_ROOT", ".") + "/binance_klines/daily"
import importlib.util
spec = importlib.util.spec_from_file_location("u", os.path.join(S, "scripts", "universe.py"))
EXCL_SRC = open(os.path.join(S, "scripts", "universe.py")).read()
ns = {"__file__": os.path.join(S, "scripts", "universe.py")}
exec(EXCL_SRC.split("series = {}")[0].replace("N = int(sys.argv[1]) if len(sys.argv) > 1 else 30", "N = 30"), ns)
excluded = ns["excluded"]
out = []
for f in sorted(glob.glob(DAILY + "/*.json")):
    sym = os.path.basename(f)[:-5]
    if not sym.endswith("USDT") or excluded(sym): continue
    rows = json.load(open(f))
    if len(rows) < 2: continue
    d0 = datetime.datetime.utcfromtimestamp(rows[0][0]).date()
    if not (datetime.date(2022, 1, 1) <= d0 <= datetime.date(2026, 8, 22)): continue
    c0 = rows[0][4]
    def ret(k):
        return rows[k][4] / c0 - 1 if len(rows) > k and (datetime.datetime.utcfromtimestamp(rows[k][0]).date() - d0).days == k else None
    out.append({"sym": sym, "first_day": d0.isoformat(), "r1": ret(1), "r7": ret(7), "r30": ret(30), "open_to_close_day0": c0 / rows[0][1] - 1})
summ = {}
for k in ("r1", "r7", "r30", "open_to_close_day0"):
    v = [x[k] for x in out if x[k] is not None]
    summ[k] = {"n": len(v), "mean": round(sum(v) / len(v), 4), "median": round(statistics.median(v), 4), "share_positive": round(sum(1 for x in v if x > 0) / len(v), 3)}
by_year = {}
for x in out:
    y = x["first_day"][:4]
    if x["r30"] is not None: by_year.setdefault(y, []).append(x["r30"])
summ["r30_by_listing_year"] = {y: {"n": len(v), "median": round(statistics.median(v), 4), "mean": round(sum(v) / len(v), 4)} for y, v in sorted(by_year.items())}
json.dump({"summary": summ, "listings": out}, open(os.path.join(S, "results", "m_listing_drift.json"), "w"), indent=1)
print(json.dumps(summ, indent=1))
