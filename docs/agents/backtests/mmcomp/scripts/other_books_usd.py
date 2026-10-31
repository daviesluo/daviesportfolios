# MAKER-OTHER-BOOKS (2026-10-31): what quoting would earn on Revolut X's UK USD stablecoin books (USDT-USD, USDC-USD),
# which the GBP books' other maker also makes (reviews/2026-10-31-maker-other-books.md §2). The engine is run2.py (PR5-OPT's
# executor with MMCOMP's hooks, imported unchanged), fed a USD book as if it were the GBP book of the same coin with X = 1:
# its fair is then PR5's own fairU (the 24-hour median of the USD book's closes, as agent_quote_minutes stored it), its
# tick 0.0001 and its £ amounts dollars. Prints: data/other_usd_prints.txt.gz (keyless public trades, other_books_trades.py,
# 2026-09-26 -> 2026-10-31 00:00 UTC). The maker's presence: the USD book's own snapshots (fair_price/data/book_<USD>.txt.gz,
# run2.Ref, its one order of 4,999.5-5,010.5 coins), gone after 15 minutes without it, as the GBP watch dates an absence.
# Window 2026-09-27 00:00 -> 2026-10-29 00:00 UTC (where the snapshots and the minute record both are).
#   python3 -I docs/agents/backtests/mmcomp/scripts/other_books_usd.py  -> results/other_usd.json
import collections, gzip, json, os, statistics as st, sys
HERE = os.path.dirname(os.path.abspath(__file__))
sys.dont_write_bytecode = True
sys.path.insert(0, HERE)
from run2 import run2, Ref, D, sim, DAY, M, daily, boot
import fp_data

OUT = os.path.join(HERE, "..", "results", "other_usd.json")
DATA = os.path.join(HERE, "..", "data")
T0, T1 = D.ms(2026, 9, 27), D.ms(2026, 10, 29)
GONE = 15
USD_OF = {"USDT-GBP": "USDT-USD", "USDC-GBP": "USDC-USD"}


def load():
    mins = fp_data.load_minutes()
    prints = collections.defaultdict(list)
    for l in gzip.open(os.path.join(DATA, "other_usd_prints.txt.gz"), "rt"):
        pid, b, t, px, q, sd = l.strip().split("|")
        prints[b].append((int(t), round(float(px) / sim.TICK), float(q), sd, pid))
    for b in prints: prints[b].sort(key=lambda z: (z[0], z[4]))
    m, p = {}, {}
    for g, u in USD_OF.items():
        m[g] = [(t, 1.0, fu) for (t, x, fu, lag) in mins[g]]
        p[g] = prints[u]
    return m, p


def absent_minutes(ref):
    """minute -> True when the maker's order was on neither side for a run of GONE seen minutes or more."""
    seen = []
    for t in range(T0, T1, M):
        i = ref.at(t + 59_000)
        seen.append(None if i is None else (ref.mb[i] is not None or ref.ma[i] is not None))
    out = [False] * len(seen)
    run = []
    for j, s in enumerate(seen + [True]):
        if s is False: run.append(j)
        elif s is True:
            if len(run) >= GONE:
                for k in run: out[k] = True
            run = []
    return out, sum(1 for s in seen if s is None)


def ladder(book, d):
    return {(book, s, k): g for s in ("bid", "ask") for k, g in d.items() if g > 0}


mins, prints = load()
res = {"window": "2026-09-27 00:00 -> 2026-10-29 00:00 UTC", "books": {}}
for g, u in USD_OF.items():
    ref = Ref(u)
    ab, unseen = absent_minutes(ref)
    n = len(ab)
    P = [x for x in prints[g] if T0 <= x[0] < T1]
    usd_flow = sum(x[1] * sim.TICK * x[2] for x in P)
    small = sum(1 for x in P if x[1] * sim.TICK * x[2] < 0.2)
    widths = {d: w for d, w in ref.widths.items() if "2026-09-27" <= d < "2026-10-29"}
    B = {"usd_book": u, "prints": len(P), "prints_under_0.2": small, "usd_a_day": round(usd_flow / ((T1 - T0) / DAY), 0),
         "absent_hours": round(sum(ab) / 60, 1), "unseen_hours": round(unseen / 60, 1), "minutes": n,
         "maker_width_ticks_by_day": widths, "runs": {}}
    live = {0.001: 100, 0.002: 100, 0.003: 100}
    V = collections.OrderedDict([
        ("live_rules_600", dict(size=ladder(g, live))),
        ("live_rules_1200", dict(size=ladder(g, {0.001: 200, 0.002: 200, 0.003: 200}))),
        ("inside_1tick_100", dict(size=ladder(g, {"in": 100}), inside=dict(k_bps=2, off=1, gbp=100))),
        ("live_plus_inside", dict(size={**ladder(g, live), **ladder(g, {"in": 100})}, inside=dict(k_bps=2, off=1, gbp=100))),
        ("live_rules_absent_only", dict(size=ladder(g, live), gate=lambda T, b, s, k: ab[min(n - 1, max(0, (T - T0) // M))])),
    ])
    for fill in ("at", "through"):
        for vn, kw in V.items():
            kwx = dict(kw)
            ins = kwx.pop("inside", None)
            stt = {}
            trips, cap = run2({g: mins[g]}, {g: prints[g]}, T0, T1, ref={g: ref}, inside=ins, stats=stt, hold_min_gbp=1.0,
                              exit_off=1, fill=fill, **kwx)
            dd = daily(trips, T0, T1)
            vals = list(dd.values())
            ent = [tr for tr in trips if tr["tEntry"] is not None]
            in_abs = [tr for tr in ent if ab[min(n - 1, max(0, (tr["tEntry"] - T0) // M))]]
            pnl = sum(tr["pnl"] for tr in trips)
            o = {"capital_usd": cap, "usd_a_day": round(pnl / len(vals), 4), "bps_capital_day": round(pnl / len(vals) / cap * 1e4, 2) if cap else None,
                 "trips": sum(1 for tr in trips if tr["how"] != "open"), "taker_stops": sum(1 for tr in trips if tr["how"] == "taker"),
                 "bps_trip": round(1e4 * pnl / sum(tr["gbp"] for tr in trips), 2) if trips else None,
                 "days_positive": sum(1 for v in vals if v > 1e-9), "days": len(vals), "boot_mean_day": boot(vals),
                 "absent_usd": round(sum(tr["pnl"] for tr in in_abs), 4), "absent_trips": len(in_abs),
                 "present_usd_a_day": round((pnl - sum(tr["pnl"] for tr in in_abs)) / ((n - sum(ab)) / 1440), 4),
                 "absent_usd_a_day": round(sum(tr["pnl"] for tr in in_abs) / (sum(ab) / 1440), 4) if sum(ab) else None,
                 "orders_day_mean": stt.get("orders_day_mean"), "orders_day_max": stt.get("orders_day_max")}
            B["runs"][f"{fill}|{vn}"] = o
            print(u, fill, vn, {k: o[k] for k in ("usd_a_day", "bps_capital_day", "trips", "bps_trip", "absent_usd_a_day", "present_usd_a_day", "orders_day_mean")}, flush=True)
    res["books"][u] = B
json.dump(res, open(OUT, "w"), indent=1, sort_keys=True)
