"""CJ5 against PR5 on the same days: the frozen rule on Revolut X's UK books and on CoinJar's, at the same rung in pounds,
the same interbank X, each venue from flat on each Revolut X book's first day (USDC-GBP 2025-11-26, USDT-GBP 2025-12-16)
to 2026-10-09 00:00 UTC.

* Revolut X: PR5's committed prints (inputs/pr5_2026-09-23, to 09-23) joined with the stat-arb search's committed UK
  prints (statarb_search/inputs/long to 10-02, fiat_stable to 10-09), de-duplicated by id; fairU = PR5's F3 on Revolut
  X's own USD-book hourly closes (PR5's committed candles, then ../inputs/revx_usd_hours_2026-09-16_10-09.json.gz). Its
  stop pays PR5's own 0.09 % + 0.0067 %.
* CoinJar: CJ5's inputs and costs (cj5_sim.py). As a check, CoinJar is also run with Revolut X's fairU.
Daily P&L by entry day; the paired difference CJ5 - PR5 with the day bootstrap (random.Random(20261023), 2,000 draws,
index 100).
usage: python3 -I paired.py   -> ../results/paired.json
"""
import collections, gzip, json, os, random, statistics as st, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import cj5_sim as C  # noqa: E402
import inputs as I  # noqa: E402
from vbook import VBook, P  # noqa: E402

BT = os.path.normpath(os.path.join(C.HERE, ".."))
RX_BOOK = {"USDCGBP": "USDC-GBP", "USDTGBP": "USDT-GBP"}
W0 = {"USDCGBP": I.ms("2025-11-26T00:00"), "USDTGBP": I.ms("2025-12-16T00:00")}
SUB = {"since_2026-08-24": I.ms("2026-08-24T00:00"), "since_2026-09-11_last_28_days": I.ms("2026-09-11T00:00")}


def rx_prints(book):
    rows = {}
    with gzip.open(os.path.join(BT, "inputs", "pr5_2026-09-23", "trades", f"{book}.jsonl.gz"), "rt") as f:
        for l in f:
            r = json.loads(l)
            if r["region"] == "UK":
                rows[r["id"]] = (r["ts"], r["price"], r["qty"], r["side"])
    for sub in ("long", "fiat_stable"):
        for r in json.load(gzip.open(os.path.join(BT, "statarb_search", "inputs", sub, f"revx_{book}.json.gz"), "rt")):
            if r["region"] == "UK":
                rows[r["id"]] = (r["timestamp"], r["price"], r["quantity"], r["side"])
    out = []
    for ts, p, q, s in rows.values():
        tk = round(float(p) / P.TICK)
        assert abs(tk * P.TICK - float(p)) < 1e-9
        out.append((int(ts), tk, float(q), s))
    out.sort(key=lambda x: x[0])
    return out


def rx_hours(usd_book):
    h = {int(r["start"]): float(r["close"]) for r in json.load(P._open(os.path.join(P.S, "data", "candles", f"{usd_book}_60.json")))["rows"]}
    new = json.load(gzip.open(os.path.join(C.HERE, "inputs", "revx_usd_hours_2026-09-16_10-09.json.gz"), "rt"))
    for r in new[usd_book]["body"]["data"]:
        h[int(r["start"])] = float(r["close"])
    ks = sorted(h)
    return ks, [h[k] for k in ks]


def daily(trips, t0, t1):
    d = collections.Counter()
    for x in trips:
        if t0 <= x["t_entry"] < t1:
            d[C.day_of(x["t_entry"])] += x["pnl_usd"]
    return d


def main():
    fx_t, fx_v = I.load_fx()
    usd = I.load_usd()
    cfg = I.load_config()
    R = {"window": {b: [C.day_of(W0[b]), C.day_of(C.END)] for b in I.PRODUCTS}, "sizes": {}}
    rxb, cjb, cjb_rxfair = {}, {}, {}
    for b in I.PRODUCTS:
        ht, hc = rx_hours(P.USD_OF[RX_BOOK[b]])
        rxb[b] = VBook(RX_BOOK[b], rx_prints(RX_BOOK[b]), W0[b], C.END, fx_t, fx_v, ht, hc, gbp=True)
        hours = usd[I.COIN[b]]
        cjb[b] = VBook(b, I.load_prints(b), W0[b], C.END, fx_t, fx_v, [h[0] for h in hours], [h[1] for h in hours], gbp=True)
        cjb_rxfair[b] = VBook(b, I.load_prints(b), W0[b], C.END, fx_t, fx_v, ht, hc, gbp=True)
    R["revx_prints_in_window"] = {b: sum(len(v) for v in rxb[b].by_min.values()) for b in I.PRODUCTS}
    R["revx_gbp_volume_per_day"] = {b: round(sum(rxb[b].qvol.values()) / ((C.END - W0[b]) / C.DAY), 0) for b in I.PRODUCTS}
    R["coinjar_gbp_volume_per_day"] = {b: round(sum(cjb[b].qvol.values()) / ((C.END - W0[b]) / C.DAY), 0) for b in I.PRODUCTS}
    t0 = min(W0.values())
    days = C.window_days(t0)
    for size in C.SIZES:
        runs = {}
        for name, books, fee, hs in (("PR5_revx", rxb, 0.0009, {b: 0.000067 for b in I.PRODUCTS}),
                                     ("CJ5_coinjar", cjb, cfg["taker_fee"], cfg["half_spread"]),
                                     ("CJ5_coinjar_revx_fair", cjb_rxfair, cfg["taker_fee"], cfg["half_spread"])):
            trips = []
            saved = (P.FEE, P.HALF_SPREAD)
            P.FEE = fee
            for b in I.PRODUCTS:
                P.HALF_SPREAD = hs[b]
                tr, _ = P.simulate(books[b], size=size)
                trips += tr
            P.FEE, P.HALF_SPREAD = saved
            runs[name] = trips
        S = {}
        for name, trips in runs.items():
            tot = sum(x["pnl_usd"] for x in trips)
            S[name] = {"trips": len(trips), "pnl_gbp": round(tot, 4), "gbp_per_day": round(tot / len(days), 4),
                       "gbp_per_year": round(tot / len(days) * 365, 2), "stops": sum(1 for x in trips if x["how"] == "taker"),
                       "win_rate": round(sum(1 for x in trips if x["pnl_usd"] > 0) / len(trips), 4) if trips else None,
                       "by_book": {b: round(sum(x["pnl_usd"] for x in trips if x["book"] in (b, RX_BOOK[b])), 4) for b in I.PRODUCTS},
                       **{k: round(sum(x["pnl_usd"] for x in trips if x["t_entry"] >= t), 4) for k, t in SUB.items()}}
            bm = collections.Counter()
            for x in trips:
                bm[C.day_of(x["t_entry"])[:7]] += x["pnl_usd"]
            S[name]["by_month"] = {m: round(v, 4) for m, v in sorted(bm.items())}
        a, b_ = daily(runs["CJ5_coinjar"], t0, C.END), daily(runs["PR5_revx"], t0, C.END)
        diff = [a.get(d, 0.0) - b_.get(d, 0.0) for d in days]
        rng = random.Random(20261023)
        s = sorted(sum(rng.choice(diff) for _ in range(len(diff))) for _ in range(2000))
        xa, xb = [a.get(d, 0.0) for d in days], [b_.get(d, 0.0) for d in days]
        S["paired_CJ5_minus_PR5"] = {"days": len(days), "sum_gbp": round(sum(diff), 4), "index100_gbp": round(s[100], 4),
                                     "share_draws_gt_0": round(sum(1 for v in s if v > 0) / 2000, 4),
                                     "days_CJ5_ahead": sum(1 for v in diff if v > 0), "days_PR5_ahead": sum(1 for v in diff if v < 0),
                                     "daily_correlation": round(st.correlation(xa, xb), 4) if st.pstdev(xa) and st.pstdev(xb) else None}
        for k, t in SUB.items():
            dd = [a.get(d, 0.0) - b_.get(d, 0.0) for d in days if d >= C.day_of(t)]
            rng = random.Random(20261023)
            s2 = sorted(sum(rng.choice(dd) for _ in range(len(dd))) for _ in range(2000))
            S["paired_CJ5_minus_PR5"][k] = {"days": len(dd), "sum_gbp": round(sum(dd), 4), "index100_gbp": round(s2[100], 4),
                                            "share_draws_gt_0": round(sum(1 for v in s2 if v > 0) / 2000, 4),
                                            "days_CJ5_ahead": sum(1 for v in dd if v > 0), "days_PR5_ahead": sum(1 for v in dd if v < 0)}
        R["sizes"][f"{int(size)}"] = S
        print(size, {k: (v["pnl_gbp"], v["trips"], v["stops"]) for k, v in S.items() if "trips" in v}, S["paired_CJ5_minus_PR5"], flush=True)
    json.dump(R, open(os.path.join(C.HERE, "results", "paired.json"), "w"), indent=1, sort_keys=True)


if __name__ == "__main__":
    main()
