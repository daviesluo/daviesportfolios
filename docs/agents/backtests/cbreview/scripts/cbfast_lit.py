"""CBFAST on the paper test's own record: the guards of cbfast.py replayed on the engine's stored minutes of the four books,
2026-10-11 23:01 -> 2026-10-15 00:00 UTC (inputs/lit_window_lines.json.gz + lit_lines_1012_1014.json.gz: fair as the engine
stored it, the prints' true extremes), including 2026-10-14, the day the history cannot reach (its inputs end 2026-10-09).

The base arm is `../../cbpaper/scripts/replay.py`'s own (PR5's frozen `simulate` on the minute record) and must reproduce the
engine's trips (counted and priced below against inputs/trips_to_1014.json). A guard runs through `cbfast.gsim`. P&L is in each
book's own currency (a euro book trades EUR 100 a rung) and is put into pounds at the rate the engine's own trips imply
(notional_gbp / 100: 0.8452 to 2026-10-13, 0.8432 from 2026-10-14).
usage: python3 -I cbfast_lit.py ["config name" ...]  -> ../results/cbfast_lit.json (default: the configs listed in LIT_DEFAULT)
"""
import collections, datetime, gzip, json, os, sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.normpath(os.path.join(ROOT, "..", "cbpaper", "scripts")))
import cbfast as C  # noqa: E402
import replay as R  # noqa: E402  (the frozen replay, read-only)
import replay_check as RC  # noqa: E402

P, M = C.P, C.M
DAY10_14 = "2026-10-14"
LIT_DEFAULT = ["base"]


def load_books():
    a = json.load(gzip.open(os.path.join(ROOT, "inputs", "lit_window_lines.json.gz"), "rt"))
    b = json.load(gzip.open(os.path.join(ROOT, "inputs", "lit_lines_1012_1014.json.gz"), "rt"))
    out = {}
    for book in sorted(a):
        rows = RC.minutes(a[book] + ";" + b[book], book)[1]       # the record with the true extremes
        tick, half = R.BOOK[book]
        out[book] = (R.MinuteBook(book, rows, tick), tick, half)
    return out


def fx(book, t_entry_day):
    if book.endswith("GBP"):
        return 1.0
    return 0.8432 if t_entry_day >= DAY10_14 else 0.8452


def run_book(book, B, tick, half, spec, events):
    """Trips (t_entry, t_exit, pnl_gbp, taker) of one spec on one book; the trailing end-of-data close is dropped as replay.py does."""
    saved = (P.TICK, P.FEE, P.HALF_SPREAD)
    P.TICK, P.FEE, P.HALF_SPREAD = tick, R.TAKER, half
    try:
        if spec["fam"] == "base":
            tr = P.simulate(B, size=100.0)[0]
        else:
            sig = C.signals(B, tick)
            pb, pa, mult, stop, dark = C.pauses(sig, spec, B, events)
            tr = C.gsim(B, pb=pb, pa=pa, mult=mult, stop_min=stop, dark=dark)
    finally:
        P.TICK, P.FEE, P.HALF_SPREAD = saved
    tr = [x for x in tr if not (x["how"] == "taker" and x["t_exit"] - x["t_entry"] < 1440 * M)]
    day = lambda t: datetime.datetime.fromtimestamp(t / 1000, datetime.timezone.utc).strftime("%Y-%m-%d")
    return [(x["t_entry"], x["t_exit"], x["pnl_usd"] * fx(book, day(x["t_entry"])), x["how"] == "taker", book) for x in tr]


def summarise(trips):
    day = lambda t: datetime.datetime.fromtimestamp(t / 1000, datetime.timezone.utc).strftime("%Y-%m-%d")
    by = collections.defaultdict(lambda: [0, 0, 0.0])
    for x in trips:
        d = by[day(x[1])]
        d[0] += 1; d[1] += int(x[2] > 0); d[2] += x[2]
    return {d: {"trips": v[0], "won": v[1], "pnl_gbp": round(v[2], 3)} for d, v in sorted(by.items())}


def engine_by_exit_day():
    t = json.load(open(os.path.join(ROOT, "inputs", "trips_to_1014.json")))["trips"]
    by = collections.defaultdict(lambda: [0, 0, 0.0])
    for book, side, k, te, tx, qty, notional, pnl in t:
        d = by[tx[:10]]
        d[0] += 1; d[1] += int(pnl > 1e-12); d[2] += pnl
    return {d: {"trips": v[0], "won": v[1], "pnl_gbp": round(v[2], 3)} for d, v in sorted(by.items())}


def main(names):
    books = load_books()
    events = C.load_events()
    grid = C.cfg_grid()
    grid.update(EXTRA)
    out = {"engine_by_exit_day": engine_by_exit_day(), "configs": {}}
    for name in names:
        spec = grid[name]
        trips = []
        for book, (B, tick, half) in books.items():
            trips += run_book(book, B, tick, half, spec, events)
        s = summarise(trips)
        d = s.get(DAY10_14, {"trips": 0, "won": 0, "pnl_gbp": 0.0})
        tot = round(sum(v["pnl_gbp"] for v in s.values()), 3)
        out["configs"][name] = {"by_exit_day": s, "total_gbp": tot, "trips": sum(v["trips"] for v in s.values()), "day_2026-10-14": d}
        # fills inside the CPI minute: trips ENTERED 2026-10-14 12:30 (the minute of the release)
        cpi = int(datetime.datetime(2026, 10, 14, 12, 30, tzinfo=datetime.timezone.utc).timestamp() * 1000)
        e = [x for x in trips if x[0] == cpi]
        out["configs"][name]["entered_in_the_release_minute"] = {"trips": len(e), "pnl_gbp": round(sum(x[2] for x in e), 3)}
        print("%-34s trips %3d  total %+8.3f   10-14: trips %2d won %d pnl %+7.3f   release minute: %d trips %+7.3f" % (
            name, out["configs"][name]["trips"], tot, d["trips"], d["won"], d["pnl_gbp"], len(e), sum(x[2] for x in e)))
    json.dump(out, open(os.path.join(ROOT, "results", "cbfast_lit.json"), "w"), indent=1, sort_keys=True)


EXTRA = {}

if __name__ == "__main__":
    main(sys.argv[1:] or LIT_DEFAULT)
