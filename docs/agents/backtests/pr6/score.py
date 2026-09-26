"""PR6 scorer: runs what docs/agents/reviews/2026-09-26-pr6-revx-usd-par-prereg.md froze, and writes one JSON.
usage, from the repository root: python3 docs/agents/backtests/pr6/score.py OUT.json

In this order:
1. The pre-registration, PR5's simulator and its checks, and the scripts and outputs that ran before the freeze must
   hash as the pre-registration says.
2. PR5's own checks (test_sim_logic.py, in a fresh process, because they need PR5's own constants) and this layer's
   checks (checks.py) run on made-up prints. If one fails, nothing is scored and the file names the check.
3. Only then are the two print files opened, and they too must hash as frozen.
4. The primary and stress arms, the null (every whole-day shift from 1 to 282 days), PR5's random-time null
   (descriptive), the descriptive arms, the figures the pre-registration says are reported, and the bar.

A twin's P&L in the null is PR5's `exit_only()` for $1 at the twin's entry minute, times the trip's dollars. With
X = 1 in every minute, `exit_only()` is linear in its size (qty = size / entry price, P&L = qty x (exit - entry)), so
this is the same number as calling it with the trip's size; the scorer recomputes three whole null values with direct
calls and records the difference.

Nothing reads the clock, and the one random draw (PR5's null) is seeded: two runs write the same bytes.
"""
import collections
import datetime
import hashlib
import json
import os
import random
import statistics
import subprocess
import sys

sys.dont_write_bytecode = True
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import pr6_sim as S  # noqa: E402
import checks  # noqa: E402

P, M, DAY, TICK, REPO, BOOKS = S.P, S.M, S.DAY, S.TICK, S.REPO, S.BOOKS

PREREG = "docs/agents/reviews/2026-09-26-pr6-revx-usd-par-prereg.md"
FROZEN = {
    PREREG: "45e69d0d4c4d0669cdfaac824d543dcac39d7e940e0c9f6631ca405fb5426a54",
    "docs/agents/scripts/pr5/pr5_sim.py": "56fbad85ee4df6292f596188d091ad064d030180f33cefe3bd09089d7e772a1a",
    "docs/agents/scripts/pr5/test_sim_logic.py": "7dedbaa189febaf2d712c7e809d62da79be0375edf1ae620ac1b73245e888243",
}
PRINTS_SHA = {"USDC-USD": "91a1287c7be36082ab49604751aea61c92c73553bc7a15b19af0a6f34a8fce7d",
              "USDT-USD": "0568e84ca5d185d29975dbb6fe0d89f579ec67ac930a2116cee8c6402c5ec97c"}
# The scripts that ran before the freeze, as the pre-registration names them (in full, or by the first 8 characters).
PREFREEZE_SCRIPTS = {"fetch.py": "a9cbb205c713195d5688ae6cd3fc3208aa3ab128945a29a6a2a1e1753181fe72",
                     "region_check.py": "fd7edcb495896a9f5f6b0655c17ddc95e99da0d52b13ca683be814a95420b0e4",
                     "power_check.py": "e0f5da19ddb67600043534f265e3a6c4dfc4c8f506ca93172d8a64beb37e85cb",
                     "probe.py": "2ca5bc0b", "probe_depth.py": "5d7ceee8", "candle_counts.py": "60797ec2",
                     "fp5_candle_volume.py": "6c6ccfc4", "feasibility_synthetic.py": "4125dfeb"}
PREFREEZE_OUTPUTS = {"region_check.json": "b6d2bc6c", "power_check.json": "d908859d"}

END = S.END
LAST3M, LAST4W = S.ms("2026-06-26T00:00"), S.ms("2026-08-29T00:00")
DAYS = {b: (END - S.PRIMARY_START[b]) // DAY for b in BOOKS}            # 303 and 283
CAPITAL = 1200.0
CAP_YEARS = sum(600.0 * DAYS[b] / 365.0 for b in BOOKS)                 # $963.29
NEED_PRIMARY = 0.08 * CAP_YEARS                                           # $77.06
NEED_LAST3M = CAPITAL * 0.08 * 92 / 365.0                                 # $24.20
SHIFTS = list(range(1, min(DAYS.values())))                               # 1 .. 282 days
P95_INDEX = int(0.95 * (len(SHIFTS) - 1))                                 # 266


def rel(path):
    return os.path.relpath(path, REPO).replace(os.sep, "/")


def sha(path):
    with open(path, "rb") as f:
        return hashlib.sha256(f.read()).hexdigest()


def iso(t):
    return datetime.datetime.fromtimestamp(t / 1000, datetime.timezone.utc).strftime("%Y-%m-%dT%H:%MZ")


def month(t):
    return datetime.datetime.fromtimestamp(t / 1000, datetime.timezone.utc).strftime("%Y-%m")


def isoweek(t):
    return datetime.datetime.fromtimestamp(t / 1000, datetime.timezone.utc).strftime("%G-W%V")


def ticks_of(k):
    return round(k / 1e-4)


def r(x, n=6):
    return None if x is None else round(x, n)


MONTHS = sorted({month(t) for b in BOOKS for t in range(S.PRIMARY_START[b], END, DAY)})


# ---------------------------------------------------------------- arms and summaries
def run_arm(books, **kw):
    trips, orders = [], collections.Counter()
    for b in BOOKS:
        tr, od = S.simulate(books[b], **kw)
        trips += tr
        orders.update(od)
    return trips, orders


def total(trips):
    return sum(x["pnl_usd"] for x in trips)


def summary(trips, days=None):
    """PR5's `summarize`, plus the unrounded total, and exits split into maker exits, 24-hour stops and the closes at
    the end of the data."""
    s = P.summarize(trips, 0, 10 ** 15, None, days)
    s["pnl_usd_full"] = total(trips)
    stops = [x for x in trips if x["how"] == "taker" and x["t_exit"] >= x["t_entry"] + 1440 * M]
    ends = [x for x in trips if x["how"] == "taker" and x["t_exit"] < x["t_entry"] + 1440 * M]
    s["maker_exits"] = sum(1 for x in trips if x["how"] == "maker")
    s["maker_exit_pnl_usd"] = r(sum(x["pnl_usd"] for x in trips if x["how"] == "maker"))
    s["stops_24h"] = len(stops)
    s["stops_24h_pnl_usd"] = r(total(stops))
    s["end_of_data_closes"] = len(ends)
    s["end_of_data_close_pnl_usd"] = r(total(ends))
    s["mean_notional_usd"] = r(sum(x["notional_usd"] for x in trips) / len(trips), 4) if trips else None
    s["full_100_fills"] = sum(1 for x in trips if x["notional_usd"] >= 100.0 - 1e-9)
    return s


def window(trips, t0, t1=END):
    return [x for x in trips if t0 <= x["t_entry"] < t1]


def arm_report(trips, orders=None):
    """The whole primary window, the last three months and the last four weeks, and each book."""
    L3, L4 = window(trips, LAST3M), window(trips, LAST4W)
    out = {"primary": summary(trips, max(DAYS.values())),
           "pct_per_year_on_capital_years": r(100 * total(trips) / CAP_YEARS, 4),
           "last_three_months": summary(L3, 92),
           "last_three_months_pct_per_year_on_1200": r(100 * total(L3) / (CAPITAL * 92 / 365.0), 4),
           "last_four_weeks": summary(L4, 28),
           "last_four_weeks_pct_per_year_on_1200": r(100 * total(L4) / (CAPITAL * 28 / 365.0), 4),
           "by_book": {b: summary([x for x in trips if x["book"] == b], DAYS[b]) for b in BOOKS}}
    if orders is not None:
        out["orders"] = orders_report(orders)
    return out


def orders_report(orders):
    days = sorted(orders)
    busiest = max(days, key=lambda d: (orders[d], -d)) if days else None
    return {"total": sum(orders.values()),
            "per_day_mean": r(sum(orders.values()) / max(DAYS.values()), 2),   # PR5: over the days from the earliest start
            "per_day_max": orders[busiest] if days else 0,
            "busiest_day": iso(busiest * DAY)[:10] if days else None,
            "days_with_orders": len(days),
            "days_over_700": sum(1 for d in days if orders[d] > 700),
            "days_over_1000": sum(1 for d in days if orders[d] > 1000)}


# ---------------------------------------------------------------- the nulls
def next_ok_minutes(B):
    """For each minute, the first minute at or after it that has a print and is not dark; -1 if none to the end."""
    a = [-1] * (B.n + 1)
    for i in range(B.n - 1, -1, -1):
        a[i] = i if (i in B.by_min and B.F[i] is not None) else a[i + 1]
    return a


def twin_minute(x, B, nxt, d):
    """The twin's entry minute for a whole-day shift of d days: the trip's entry minute moved d days later, wrapping
    within the book's primary window, then the first minute at or after it with a print and a fair value, searching
    forward and wrapping at the window's end."""
    s = ((x["t_entry"] - B.t0) // M + d * 1440) % B.n
    j = nxt[s]
    return j if j >= 0 else nxt[0]


def circular_null(trips, books):
    nxt = {b: next_ok_minutes(books[b]) for b in BOOKS}
    T = sorted(trips, key=lambda z: (z["book"], z["t_entry"], z["side"], z["k"]))
    per_dollar, vals = {}, []
    for d in SHIFTS:
        tot = 0.0
        for x in T:
            B = books[x["book"]]
            j = twin_minute(x, B, nxt[x["book"]], d)
            key = (x["book"], x["side"], j)
            if key not in per_dollar:
                per_dollar[key] = S.exit_only(B, j, x["side"], 1.0)
            tot += x["notional_usd"] * per_dollar[key]
        vals.append(tot)
    # three whole null values again, each twin by a direct call at the trip's own dollars
    direct = {}
    for d in (SHIFTS[0], SHIFTS[len(SHIFTS) // 2], SHIFTS[-1]):
        tot, memo = 0.0, {}
        for x in T:
            B = books[x["book"]]
            j = twin_minute(x, B, nxt[x["book"]], d)
            key = (x["book"], x["side"], j, x["notional_usd"])
            if key not in memo:
                memo[key] = S.exit_only(B, j, x["side"], x["notional_usd"])
            tot += memo[key]
        direct[d] = tot
    srt = sorted(vals)
    return {"shifts": len(vals), "shift_days": [SHIFTS[0], SHIFTS[-1]], "p95_index": P95_INDEX,
            "p95": srt[P95_INDEX], "mean": r(statistics.fmean(vals)), "p50": r(srt[len(srt) // 2]),
            "min": r(srt[0]), "max": r(srt[-1]),
            "values_by_shift_day": {str(d): r(v) for d, v in zip(SHIFTS, vals)},
            "distinct_twin_entries_simulated": len(per_dollar),
            "direct_check": {str(d): {"per_dollar_route": vals[SHIFTS.index(d)], "direct_calls": v,
                                      "abs_difference": abs(vals[SHIFTS.index(d)] - v)} for d, v in direct.items()}}


def pr5_random_time_null(trips, books):
    """The null loop of pr5_sim.py's main(), unchanged but for the seed and the books: each trip's twin at the last
    print of a uniformly drawn traded minute of its book in the primary window, sized from that minute."""
    T = sorted(trips, key=lambda z: (z["book"], z["t_entry"], z["side"], z["k"]))
    pools = {b: [i for i in sorted(books[b].by_min) if books[b].t0 + i * M < END and books[b].X[i]] for b in BOOKS}
    rng = random.Random(20260926)
    cache, draws = {}, []
    for _ in range(2000):
        tot = 0.0
        for x in T:
            b = x["book"]
            i = pools[b][rng.randrange(len(pools[b]))]
            key = (b, i, x["side"])
            if key not in cache:
                Bk = books[b]
                usd = min(100.0, 0.10 * Bk.qvol[i] * Bk.X[i])
                cache[key] = S.exit_only(Bk, i, x["side"], usd, Bk.X[i]) if usd > 0 else 0.0
            tot += cache[key]
        draws.append(tot)
    draws.sort()
    prim = total(trips)
    return {"draws": len(draws), "seed": 20260926, "mean": r(statistics.fmean(draws)), "p50": r(draws[1000]),
            "p95": r(draws[int(0.95 * (len(draws) - 1))]), "max": r(draws[-1]),
            "share_draws_ge_primary": r(sum(1 for v in draws if v >= prim) / len(draws), 4),
            "distinct_twins_simulated": len(cache)}


# ---------------------------------------------------------------- reported and descriptive figures
def mtm_daily(trips, books):
    """Every open position valued at its book's last print at each UTC midnight, at no cost, plus what has closed."""
    t0 = min(S.PRIMARY_START.values())
    series, peak, dd, dd_at, worst_open, worst_open_at = [], 0.0, 0.0, None, 0.0, None
    by_exit = sorted(trips, key=lambda x: x["t_exit"])
    k, realized = 0, 0.0
    for tau in range(t0, END + 1, DAY):
        while k < len(by_exit) and by_exit[k]["t_exit"] < tau:
            realized += by_exit[k]["pnl_usd"]
            k += 1
        open_v = 0.0
        for x in trips:
            if x["t_entry"] < tau <= x["t_exit"]:
                last = books[x["book"]].last_at_or_before(tau - 1) * TICK
                qty = x["notional_usd"] / x["entry"]
                open_v += qty * (last - x["entry"]) if x["side"] == "bid" else qty * (x["entry"] - last)
        eq = realized + open_v
        series.append([iso(tau)[:10], r(eq), r(open_v)])
        peak = max(peak, eq)
        if peak - eq > dd:
            dd, dd_at = peak - eq, iso(tau)[:10]
        if open_v < worst_open:
            worst_open, worst_open_at = open_v, iso(tau)[:10]
    return {"worst_drawdown_usd": r(dd), "worst_drawdown_at": dd_at, "worst_open_value_usd": r(worst_open),
            "worst_open_value_at": worst_open_at, "daily": series}


def weekly_gap(prints, start):
    """PR5's regime measure (diagnostics.py), per book: adjacent prints of opposite aggressors within 60 s, buy minus
    sell over their mean, in bps; the median per ISO week, from the book's primary start."""
    gap = collections.defaultdict(list)
    for a, c in zip(prints, prints[1:]):
        if a[3] != c[3] and c[0] - a[0] <= 60000 and start <= c[0] < END:
            buy = a if a[3] == "buy" else c
            sell = c if a[3] == "buy" else a
            gap[isoweek(c[0])].append((buy[1] - sell[1]) / ((buy[1] + sell[1]) / 2) * 1e4)
    return {w: {"median_bps": r(statistics.median(v), 2), "pairs": len(v)} for w, v in sorted(gap.items())}


def audit(trips, books, prints):
    """Every primary trip against the raw prints: entry at its rung, a print strictly through it at its fill time and
    inside its fill minute, the size cap, maker exits at par with a print strictly through par in the exit minute and
    at least two minutes after the fill, and every taker exit a 24-hour stop or the end of the data."""
    at_ts = {b: collections.defaultdict(list) for b in BOOKS}
    for b in BOOKS:
        for p in prints[b]:
            at_ts[b][p[0]].append(p)
    bad = collections.Counter()
    for x in trips:
        B = books[x["book"]]
        n = ticks_of(x["k"])
        e = S.PAR - n if x["side"] == "bid" else S.PAR + n
        if round(x["entry"] / TICK) != e:
            bad["entry_not_at_its_rung"] += 1
        if not (x["t_entry"] <= x["fill_ts"] < x["t_entry"] + M):
            bad["fill_print_outside_the_fill_minute"] += 1
        if not any((p[1] < e if x["side"] == "bid" else p[1] > e) for p in at_ts[x["book"]].get(x["fill_ts"], ())):
            bad["no_print_strictly_through_the_entry_at_fill_time"] += 1
        cap = min(100.0, 0.10 * B.qvol[(x["t_entry"] - B.t0) // M])
        if abs(x["notional_usd"] - cap) > 1e-9:
            bad["size_not_the_cap"] += 1
        if x["how"] == "maker":
            if round(x["exit"] / TICK) != S.PAR:
                bad["maker_exit_not_at_par"] += 1
            if x["t_exit"] < x["t_entry"] + 2 * M:
                bad["maker_exit_before_its_order_was_live"] += 1
            j = (x["t_exit"] - B.t0) // M
            if not any((p[1] > S.PAR if x["side"] == "bid" else p[1] < S.PAR) for p in B.by_min.get(j, ())):
                bad["maker_exit_without_a_print_strictly_through_par"] += 1
        elif not (x["t_exit"] >= x["t_entry"] + 1440 * M or x["t_exit"] == END - M):
            bad["taker_exit_neither_a_24h_stop_nor_the_end"] += 1
    return {"trips_checked": len(trips), "failures": dict(sorted(bad.items()))}


def dark_runs(B):
    """The runs of minutes the de-peg guard darkened: [first minute, length in minutes]."""
    runs, i = [], 0
    while i < B.n:
        if B.F[i] is None:
            j = i
            while j < B.n and B.F[j] is None:
                j += 1
            runs.append([iso(B.t0 + i * M), j - i])
            i = j
        else:
            i += 1
    return runs


def by_key(trips, keyf, days=None):
    groups = collections.defaultdict(list)
    for x in trips:
        groups[keyf(x)].append(x)
    return {k: summary(v, days) for k, v in sorted(groups.items())}


# ---------------------------------------------------------------- main
def main():
    out_fn = sys.argv[1]
    R = {"study": "PR6: 0 % maker quotes at par on Revolut X's UK USDC-USD and USDT-USD books"}
    # 1. the frozen files' hashes (the print files are opened only after the checks)
    got = {p: sha(os.path.join(REPO, p)) for p in FROZEN}
    R["prereg"] = {"path": PREREG, "sha256": got[PREREG], "frozen_by": "714a71c0 on main"}
    R["frozen_files"] = {p: {"sha256": got[p], "matches": got[p] == FROZEN[p]} for p in FROZEN}
    scripts = sorted(f for f in os.listdir(HERE) if f.endswith(".py"))
    R["scripts"] = {rel(os.path.join(HERE, f)): sha(os.path.join(HERE, f)) for f in scripts}
    R["prefreeze_scripts_match_prereg"] = {f: sha(os.path.join(HERE, f)).startswith(h) for f, h in PREFREEZE_SCRIPTS.items()}
    R["prefreeze_outputs"] = {rel(os.path.join(HERE, "prefreeze", f)): sha(os.path.join(HERE, "prefreeze", f))
                              for f in sorted(os.listdir(os.path.join(HERE, "prefreeze")))}
    R["prefreeze_outputs_match_prereg"] = {f: sha(os.path.join(HERE, "prefreeze", f)).startswith(h)
                                           for f, h in PREFREEZE_OUTPUTS.items()}
    hashes_ok = (all(v["matches"] for v in R["frozen_files"].values()) and all(R["prefreeze_scripts_match_prereg"].values())
                 and all(R["prefreeze_outputs_match_prereg"].values()))
    # 2. the checks on made-up prints, before any PR6 print is opened
    env = {k: v for k, v in os.environ.items() if k not in ("PR5_DATA", "PR5_DRYRUN")}
    env["PYTHONDONTWRITEBYTECODE"] = "1"
    run5 = subprocess.run([sys.executable, os.path.join(REPO, "docs/agents/scripts/pr5/test_sim_logic.py")], cwd=REPO,
                          env=env, capture_output=True, text=True)
    last5 = run5.stdout.strip().splitlines()[-1] if run5.stdout.strip() else ""
    pr5_ok = run5.returncode == 0 and last5 == "all synthetic checks pass"
    lay_ok, lay = checks.run()
    R["checks"] = {"pr5_test_sim_logic": {"returncode": run5.returncode, "last_line": last5, "ok": pr5_ok},
                   "pr6_layer": lay, "pr6_layer_ok": lay_ok}
    raws = {}
    if hashes_ok and pr5_ok and lay_ok:
        raws = {b: S.read_input(b) for b in BOOKS}
        R["inputs"] = {b: {"path": rel(os.path.join(S.INPUTS, f"{b}.jsonl.gz")),
                           "gz_sha256": sha(os.path.join(S.INPUTS, f"{b}.jsonl.gz")),
                           "content_sha256": raws[b][1], "matches_prereg": raws[b][1] == PRINTS_SHA[b]} for b in BOOKS}
        hashes_ok = all(v["matches_prereg"] for v in R["inputs"].values())
    R["scored"] = bool(hashes_ok and pr5_ok and lay_ok)
    if not R["scored"]:
        R["not_scored_because"] = [w for w, ok in (("a hash differs from the frozen one", hashes_ok),
                                                   ("PR5's checks failed", pr5_ok), ("a PR6 layer check failed", lay_ok)) if not ok]
        with open(out_fn, "w") as f:
            json.dump(R, f, indent=1, sort_keys=True)
        return 1
    # 3. the books
    prints = {b: S.parse_prints(raws[b][0]) for b in BOOKS}
    prim = {b: S.ParBook(b, prints[b], S.PRIMARY_START[b], END) for b in BOOKS}
    R["windows"] = {b: {"primary": [iso(S.PRIMARY_START[b]), iso(END)], "days": DAYS[b]} for b in BOOKS}
    R["windows"]["last_three_months"] = [iso(LAST3M), iso(END)]
    R["windows"]["last_four_weeks"] = [iso(LAST4W), iso(END)]
    R["windows"]["whole_tape_from"] = iso(S.WHOLE_START)
    R["windows"]["months"] = MONTHS
    R["constants"] = {"rungs_ticks": [1, 2, 3], "half_spread": S.HALF_SPREAD, "guard_ticks": S.GUARD_TICKS,
                      "capital_usd": CAPITAL, "capital_years_usd": CAP_YEARS, "need_primary_usd": NEED_PRIMARY,
                      "need_last_three_months_usd": NEED_LAST3M, "shift_days": [SHIFTS[0], SHIFTS[-1]],
                      "p95_index": P95_INDEX}
    R["data"] = {b: {"prints": len(prints[b]), "minutes": prim[b].n, "traded_minutes": len(prim[b].by_min),
                     "prints_more_than_30bps_from_par_in_the_primary_window":
                         sum(1 for p in prints[b] if S.PRIMARY_START[b] <= p[0] < END and S.dark(p[1])),
                     "dark_minutes": sum(1 for f in prim[b].F if f is None), "dark_runs": dark_runs(prim[b]),
                     "last_minute_has_prints": (prim[b].n - 1) in prim[b].by_min} for b in BOOKS}
    # 4. the arms
    trips, orders = run_arm(prim)
    stress, stress_orders = run_arm(prim, stress=True)
    R["primary"] = arm_report(trips, orders)
    R["primary"]["by_rung"] = by_key(trips, lambda x: f"{ticks_of(x['k'])}_tick")
    R["primary"]["by_side"] = by_key(trips, lambda x: x["side"])
    R["primary"]["by_book_and_rung"] = by_key(trips, lambda x: f"{x['book']} {x['side']} {ticks_of(x['k'])}")
    R["primary"]["by_month"] = {m: summary([x for x in trips if month(x["t_entry"]) == m]) for m in MONTHS}
    R["primary"]["by_week"] = by_key(trips, lambda x: isoweek(x["t_entry"]))
    R["stress"] = arm_report(stress, stress_orders)
    # 5. the nulls
    R["null_circular_shift"] = circular_null(trips, prim)
    R["null_pr5_random_time"] = pr5_random_time_null(trips, prim)
    # 6. the bar
    pnl, spnl = total(trips), total(stress)
    mp = {m: total([x for x in trips if month(x["t_entry"]) == m]) for m in MONTHS}
    mn = {m: sum(1 for x in trips if month(x["t_entry"]) == m) for m in MONTHS}
    pos = sum(1 for m in MONTHS if mn[m] > 0 and mp[m] > 0)
    share = max(mp[m] / pnl for m in MONTHS) if pnl > 0 else None
    pnl3 = total(window(trips, LAST3M))
    omax = max(orders.values()) if orders else 0
    p95 = R["null_circular_shift"]["p95"]
    R["bar"] = {"1_pnl_gt_0": pnl > 0, "2_pnl_gt_circular_shift_p95": pnl > p95, "3_stress_pnl_gt_0": spnl > 0,
                "4_at_least_60_round_trips_and_no_day_over_1000_orders": len(trips) >= 60 and omax <= 1000,
                "5_positive_in_at_least_8_of_11_months": pos >= 8,
                "6_no_month_over_40pct_of_the_total": share is not None and share <= 0.40,
                "7_at_least_8pct_a_year_on_the_primary_window_and_the_last_three_months":
                    pnl >= NEED_PRIMARY and pnl3 >= NEED_LAST3M}
    R["bar"]["PASS"] = all(R["bar"].values())
    R["bar_detail"] = {"pnl_usd": pnl, "circular_shift_p95_usd": p95, "stress_pnl_usd": spnl, "round_trips": len(trips),
                       "orders_busiest_day": omax, "months": len(MONTHS), "positive_months": pos,
                       "month_pnl_usd": {m: r(v) for m, v in mp.items()}, "month_trips": mn,
                       "max_month_share": r(share, 4), "pnl_last_three_months_usd": pnl3,
                       "need_primary_usd": NEED_PRIMARY, "need_last_three_months_usd": NEED_LAST3M,
                       "pct_per_year_primary": r(100 * pnl / CAP_YEARS, 4),
                       "pct_per_year_last_three_months": r(100 * pnl3 / (CAPITAL * 92 / 365.0), 4)}
    # 7. descriptive arms
    D = {}
    for name, kw in (("side_aware_fills", {"side_aware": True}), ("no_post_only_refusal", {"no_block": True}),
                     ("full_100_fills", {"full": True})):
        tr, od = run_arm(prim, **kw)
        D[name] = arm_report(tr, od)
    tr, od = run_arm({b: S.ParBook(b, prints[b], S.PRIMARY_START[b], END, guard=False) for b in BOOKS})
    D["no_depeg_guard"] = arm_report(tr, od)
    D["capacity"] = {}
    for size in (25.0, 300.0, 1000.0):
        tr, od = run_arm(prim, size=size)
        cy = sum(6 * size * DAYS[b] / 365.0 for b in BOOKS)
        L3 = window(tr, LAST3M)
        D["capacity"][f"rung_{int(size)}"] = {"primary": summary(tr), "pct_per_year_on_capital_years": r(100 * total(tr) / cy, 4),
                                              "last_three_months_pnl_usd": r(total(L3)),
                                              "last_three_months_pct_per_year": r(100 * total(L3) / (12 * size * 92 / 365.0), 4),
                                              "orders": orders_report(od)}
    whole = {b: S.ParBook(b, prints[b], S.WHOLE_START, END) for b in BOOKS}
    tr, od = run_arm(whole)
    before = [x for x in tr if x["t_entry"] < S.PRIMARY_START[x["book"]]]
    D["whole_tape"] = {"all": summary(tr), "by_book": {b: summary([x for x in tr if x["book"] == b]) for b in BOOKS},
                       "before_each_books_primary_start": summary(before),
                       "before_by_book": {b: summary([x for x in before if x["book"] == b]) for b in BOOKS},
                       "from_each_books_primary_start": summary([x for x in tr if x["t_entry"] >= S.PRIMARY_START[x["book"]]])}
    D["mark_to_market_daily"] = mtm_daily(trips, prim)
    D["weekly_gap"] = {b: weekly_gap(prints[b], S.PRIMARY_START[b]) for b in BOOKS}
    R["descriptive"] = D
    R["audit"] = audit(trips, prim, prints)
    R["primary_trips"] = [{k: (round(v, 8) if isinstance(v, float) else v) for k, v in x.items()}
                          for x in sorted(trips, key=lambda z: (z["book"], z["t_entry"], z["side"], z["k"]))]
    with open(out_fn, "w") as f:
        json.dump(R, f, indent=1, sort_keys=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
