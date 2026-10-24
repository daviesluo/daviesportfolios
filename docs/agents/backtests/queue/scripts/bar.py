"""QUEUE's bar for Q1 and Q2 (`docs/agents/reviews/2026-09-28-queue-prereg.md`, "Condition 2" and "The bar"), and
the hourly shift it reports beside it (arm 3i). Written 2026-10-24, before the export.
"""
import collections, random

M, DAY = 60000, 86400000
SEED, RESAMPLES = 20261004, 10000
CAPITAL = 1200.0
NEED_USD = CAPITAL * 0.08 * 28 / 365          # $7.3644 (compared at full precision)
SHIFT_HOURS = list(range(1, 672))             # delta = 1 ... 671 whole hours
SHIFT_P95_INDEX = 636                         # the value at index 636 of the 671 sorted ascending


def daily(trips, w0, days=28):
    """The P&L of every round trip opened each UTC day, both books together, the days in date order, a day with none 0."""
    by = collections.Counter()
    for x in trips:
        d = (x["t_entry"] - w0) // DAY
        if 0 <= d < days:
            by[d] += x["pnl_usd"]
    return [by.get(d, 0.0) for d in range(days)]


def day_bootstrap(values, seed=SEED, n=RESAMPLES):
    """Each resample draws len(values) days with replacement, one after another, by rng.randrange(len) over the days in
    date order; its value is their sum; p is the share of resamples at or below 0. Each hypothesis has its own generator,
    random.Random(seed), so Q1 and Q2 draw the same days."""
    rng = random.Random(seed)
    L = len(values)
    le = 0
    for _ in range(n):
        s = 0.0
        for _ in range(L):
            s += values[rng.randrange(L)]
        if s <= 0:
            le += 1
    return le / n


def holm(p1, p2):
    """Holm over Q1 and Q2: the smaller p must be at most 0.025, and then the other at most 0.05; equal p, both 0.025."""
    if p1 == p2:
        ok = p1 <= 0.025
        return ok, ok
    if p1 < p2:
        a = p1 <= 0.025
        return a, a and p2 <= 0.05
    b = p2 <= 0.025
    return b and p1 <= 0.05, b


def conditions(trips, stress_trips, orders, w0, half, w1, p_holds):
    """The six conditions for one hypothesis' primary (each position counted in the day and half it opened in)."""
    sel = [x for x in trips if w0 <= x["t_entry"] < w1]
    pnl = sum(x["pnl_usd"] for x in sel)
    h1 = sum(x["pnl_usd"] for x in sel if x["t_entry"] < half)
    h2 = sum(x["pnl_usd"] for x in sel if x["t_entry"] >= half)
    spnl = sum(x["pnl_usd"] for x in stress_trips if w0 <= x["t_entry"] < w1)
    counted = sum(1 for x in sel if x["entry_notional_usd"] >= 1.0)
    omax = max(orders.values(), default=0)                  # every UTC day of the run, both books together
    days = daily(sel, w0)
    share = max(d / pnl for d in days) if pnl > 0 else None
    c = {"1_pnl_gt_0_and_each_half": pnl > 0 and h1 > 0 and h2 > 0,
         "2_day_bootstrap_holm": bool(p_holds),
         "3_stress_gt_0": spnl > 0,
         "4_at_least_60_trips_from_1usd_and_no_day_over_1000_orders": counted >= 60 and omax <= 1000,
         "5_no_day_over_40pct": share is not None and share <= 0.40,
         "6_at_least_8pct_a_year_on_1200": pnl >= NEED_USD}
    c["PASS"] = all(c.values())
    detail = {"pnl_usd": pnl, "halves_usd": [h1, h2], "stress_pnl_usd": spnl, "trips": len(sel), "trips_from_1usd": counted,
              "trips_under_1usd": len(sel) - counted, "orders_busiest_day": omax, "max_day_share": share, "need_usd": NEED_USD,
              "pct_per_year_on_1200": 100 * pnl / CAPITAL * 365 / 28, "daily_usd": days}
    return c, detail


def shift_values(trips, run_twin, w0, w1):
    """Arm 3i: for delta = 1 ... 671 hours, each primary round trip's twin (same book and side, the trip's entry notional)
    enters at the last print of the first minute at or after entry minute + delta hours (wrapped within the window) that
    has a print and is not dark, and runs the exit with the queue fill alone; one value is the sum over the twins for one
    delta. `run_twin(book, side, minute, usd)` returns a twin's P&L."""
    span = w1 - w0
    vals = []
    for d in SHIFT_HOURS:
        tot = 0.0
        for x in sorted(trips, key=lambda z: (z["book"], z["t_entry"], z["side"], z["k"])):
            start = w0 + ((x["t_entry"] - w0) + d * 3600000) % span
            tot += run_twin(x["book"], x["side"], start, x["entry_notional_usd"])
        vals.append(tot)
    return vals


def shift_report(vals, primary_pnl):
    s = sorted(vals)
    return {"values": len(vals), "share_at_or_above_primary": sum(1 for v in vals if v >= primary_pnl) / len(vals),
            "p95_index_636": s[SHIFT_P95_INDEX], "min": s[0], "max": s[-1]}
