"""S1b: S1's simulator, unchanged, on the weeks before its window, for the books S1 ranked first. FX is FXCM's 1-minute
bid/ask mid (the PR5 study's anchor) instead of Yahoo's. pull_long.py pulled 2026-07-06 -> 10-02, but FXCM's archive
answers 404 for 2026 weeks 26-31 (pull log, 2026-10-09 17:07 UTC; re-checked by hand), so its first minute is
2026-08-09 21:03 and the scored window is 2026-08-10 00:00 -> 10-02 00:00 UTC (53 days); July's prints are not scored. Per book: totals, per
calendar month, best day's share, and the share of the P&L before / after 2026-08-24 (the week PR5's UK books
tightened, reference §3.27).
usage: python3 s1b_long_sim.py   (after pull_long.py)
"""
import csv, gzip, io, json, os, sys, time, datetime
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import s1_fiat_stable_sim as s

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LONG = os.path.join(HERE, "inputs", "long")
A, Z = 1786320000, 1791504000 - 7 * 86400   # 2026-08-10T00:00Z -> 2026-10-02T00:00Z
assert time.strftime("%Y-%m-%dT%H:%M", time.gmtime(A)) == "2026-08-10T00:00"
CUT = int(datetime.datetime(2026, 8, 24, tzinfo=datetime.timezone.utc).timestamp())


def fxcm(pair):
    t, c = [], []
    for w in range(26, 41):
        fn = os.path.join(LONG, f"fxcm_{pair}_2026_{w:02d}.csv.gz")
        if not os.path.exists(fn):
            continue
        for row in csv.DictReader(io.TextIOWrapper(gzip.open(fn), encoding="utf-8-sig")):
            ts = int(datetime.datetime.strptime(row["DateTime"][:16], "%m/%d/%Y %H:%M").replace(tzinfo=datetime.timezone.utc).timestamp())
            t.append(ts); c.append((float(row["BidClose"]) + float(row["AskClose"])) / 2)
    z = sorted(zip(t, c))
    return [a for a, _ in z], [b for _, b in z]


def main():
    s.IN = LONG
    g, e = fxcm("GBPUSD"), fxcm("EURUSD")
    ut = s.load("coinbase_USDT-USD")
    s.USDT = ([r[0] for r in ut], [r[4] for r in ut])
    for k in list(s.FXOF):
        if k.endswith("GBP") or "TGBP" in k:
            s.FXOF[k] = g
        elif k.endswith("EUR") or "EURC" in k:
            s.FXOF[k] = e
    names = ["revx UK USDC-GBP", "revx UK USDT-GBP", "revx EEA USDC-EUR", "coinbase USDC-GBP", "coinbase USDT-GBP", "coinbase USDC-EUR"]
    res = {"window": "2026-08-10T00:00Z -> 2026-10-02T00:00Z (FXCM has no 2026 weeks 26-31)", "fx": "FXCM 1-minute bid/ask mid", "books": {}}
    for n in names:
        r = s.run(n, start=A, end=Z)
        r1k = s.run(n, cap_usd=1000.0, start=A, end=Z)
        bym = {}
        for d, v in r["pnl_by_day"].items():
            bym[d[:7]] = round(bym.get(d[:7], 0.0) + v, 3)
        pre = sum(v for d, v in r["pnl_by_day"].items() if d < "2026-08-24")
        post = sum(v for d, v in r["pnl_by_day"].items() if d >= "2026-08-24")
        days_pre = (CUT - A) / 86400; days_post = (Z - CUT) / 86400
        r2 = {k: r[k] for k in ("trips", "stops", "pnl_usd", "pnl_usd_per_day", "pct_per_year_on_capital", "best_day_share",
                                "abs_dev_bps_median", "abs_dev_bps_p90", "usd_volume_per_day_fx_minutes", "share_of_volume_ge_bps", "per_rung")}
        r2["by_month"] = bym
        r2["usd_per_day_before_08_24"] = round(pre / days_pre, 3)
        r2["usd_per_day_from_08_24"] = round(post / days_post, 3)
        r2["usd_per_day_at_1000_per_rung"] = r1k["pnl_usd_per_day"]
        r2["days_positive"] = sum(1 for v in r["pnl_by_day"].values() if v > 0)
        r2["days_negative"] = sum(1 for v in r["pnl_by_day"].values() if v < 0)
        res["books"][n] = r2
        print(f"{n:20s} trips {r['trips']:5d} stops {r['stops']:3d} ${r['pnl_usd']:8.2f} ${r['pnl_usd_per_day']:6.3f}/d {r['pct_per_year_on_capital']:6.1f}%/yr "
              f"pre ${r2['usd_per_day_before_08_24']}/d post ${r2['usd_per_day_from_08_24']}/d best-day {r['best_day_share']} "
              f"@1k ${r1k['pnl_usd_per_day']}/d |dev| {r['abs_dev_bps_median']} vol ${r['usd_volume_per_day_fx_minutes']}/d months {bym}")
    json.dump(res, open(os.path.join(HERE, "results", "s1b_long.json"), "w"), indent=1, sort_keys=True)


if __name__ == "__main__":
    main()

