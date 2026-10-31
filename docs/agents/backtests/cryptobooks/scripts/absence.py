# CRYPTOBOOKS (2026-10-31): methods (a) and (d) on replay.py: a 0 % maker around the outside fair on a crypto book,
# quoting always (a) or only while the GBP stablecoin maker is away (d), whose absences tighten nothing: they are when the
# crypto books' inner liquidity goes too (inner.py). The windows are the production watch's own (data/maker_events.json,
# USDT-GBP): from 15 minutes after an absence's first minute (when the watch writes it) to 3 minutes after the maker's
# first minute back. Out-of-sample: the parameters are chosen on 2026-10-17 -> 10-23 and read on 10-24 ->.
# Writes results/absence.json. Pure Python, no network.
#   CRYPTOBOOKS_BN=<binance_1s.py's output> python3 -I absence.py BOOK...
import datetime as dt, json, os, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import ROOT, Fair  # noqa: E402
from replay import Book, boot_p, run, summary  # noqa: E402

SPLIT = 1792800000  # 2026-10-24 00:00 UTC


def windows(book="USDT-GBP"):
    ev = json.load(open(os.path.join(ROOT, "data", "maker_events.json")))[book]

    def ts(x):
        return int(dt.datetime.strptime("2026-" + x, "%Y-%m-%d %H:%M").replace(tzinfo=dt.timezone.utc).timestamp())

    dis = sorted(ts(x) for x in ev["disappeared"])
    app = sorted(ts(x) for x in ev["appeared"])
    out = []
    for d in dis:
        a = next((x for x in app if x > d), 10 ** 11)
        if a + 180 > d + 900:
            out.append((d + 900, a + 180))
    return out


def main(books):
    fair = Fair()
    W = windows()
    path = os.path.join(ROOT, "results", "absence.json")
    res = json.load(open(path)) if os.path.exists(path) else {}
    for name in books:
        bk = Book(name, fair)
        if not bk.orders or not bk.steps:
            continue
        span = (bk.orders[-1][0] // 1000, bk.orders[0][0] // 1000)
        w_secs = sum(max(0, min(b, span[0]) - max(a, span[1])) for a, b in W)
        rows = {}
        for mode, wins in (("always", None), ("away", W)):
            for U, th in ((1, 5), (60, 0)):
                for d in (3, 5, 8, 12):
                    for Q in (50, 200):
                        for tf in (0.0, 0.5):
                            for arb in (False, True):
                                key = f"{mode}_U{U}_d{d}_Q{Q}_t{tf}_arb{int(arb)}"
                                r = run(bk, d, 600, target_frac=tf, Q_gbp=Q, U=U, theta=th, arb=arb, windows=wins)
                                if r is None:
                                    continue
                                s = summary(r)
                                own_h = list(r["hours"].values())
                                ins = run(bk, d, 600, target_frac=tf, Q_gbp=Q, U=U, theta=th, arb=arb, windows=wins, t_to=SPLIT)
                                oos = run(bk, d, 600, target_frac=tf, Q_gbp=Q, U=U, theta=th, arb=arb, windows=wins, t_from=SPLIT)
                                rows[key] = {"fills_a_day": r["fills_a_day"], "arb_fills": r["arb_fills"], "orders_a_day": r["orders_a_day"],
                                             "turnover_gbp_a_day": r["turnover_gbp_a_day"], "edge_bps": r["edge_at_fill_bps_mean"],
                                             "markout_bps": r["markout_maker_bps_mean"], **s,
                                             "p_total_le0": boot_p(own_h),
                                             "in_total_a_day": summary(ins)["total_a_day"] if ins else None,
                                             "out_total_a_day": summary(oos)["total_a_day"] if oos else None,
                                             "out_own_a_day": summary(oos)["own_a_day"] if oos else None,
                                             "gbp_per_away_hour": round(sum(v["total"] for v in r["days"].values()) / (w_secs / 3600), 3)
                                             if mode == "away" and w_secs else None}
        res[name] = {"away_hours_in_tape": round(w_secs / 3600, 1), "rows": rows}
        best = sorted(((v["total_a_day"], k) for k, v in rows.items()), reverse=True)[:5]
        print(name, res[name]["away_hours_in_tape"], best, flush=True)
    with open(path, "w") as f:
        json.dump(json.loads(json.dumps(res)), f, indent=1, sort_keys=True)


if __name__ == "__main__":
    main(sys.argv[1:])
