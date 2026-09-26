"""FUND: score the frozen pre-registration. Reads only inputs/ and writes fund.json.

    python3 docs/agents/backtests/fund/score.py

The rule, the windows, the null and the bar are docs/agents/reviews/2026-09-26-fund-crowding-prereg.md,
frozen on main at 98862d04. The scorer stops unless that file is on disk with the frozen sha256, and
it stops before reading any price unless the counts it recomputes from the stored funding and SOFR
equal the counts the file states. Nothing is drawn at random. The output carries no clock.
"""

from __future__ import annotations

import bisect
import gzip
import hashlib
import json
import math
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from fractions import Fraction
from pathlib import Path
from statistics import NormalDist

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[3]
PREREG = ROOT / "docs/agents/reviews/2026-09-26-fund-crowding-prereg.md"
PREREG_SHA256 = "a0a85db1e6b3f775143180be6d6de9efb246dcf73893b96525f82b03a20a2ab8"
INPUTS = HERE / "inputs"
OUT = HERE / "fund.json"

EIGHT_H = 8 * 3_600_000
DAY = 86_400_000
PUBLISH_HOUR = 13  # fp317: a SOFR print is published 13:00 UTC on the next effectiveDate

COST = 0.00105  # 9 bp taker + 1.5 bp half-spread, a side
STRESS = 0.0021  # double
MIN_SHIFT = 60
RULES = ("UZERO", "USOFR")
# name: (first entry day, last entry day, last open used)
WINDOWS = {
    "primary": (date(2024, 1, 1), date(2026, 9, 23), date(2026, 9, 25)),
    "second": (date(2019, 9, 11), date(2022, 12, 30), date(2023, 1, 1)),
    "2023": (date(2023, 1, 1), date(2023, 12, 30), date(2024, 1, 1)),
}
SCORED = ("primary", "second")
WORTH_MONEY = 0.04  # a year, on the $100 tied up, over the primary window
MONTH_CAP = 0.40
MIN_ENTRIES = 30

# The power check's table, as frozen: signal days, entries, days held, entries by half, signal days by half.
FROZEN_COUNTS = {
    ("UZERO", "primary"): (140, 40, 200, (21, 19), (53, 87)),
    ("UZERO", "second"): (171, 68, 264, (21, 47), (65, 106)),
    ("USOFR", "primary"): (366, 74, 496, (33, 41), (157, 209)),
    ("USOFR", "second"): (211, 72, 317, (21, 51), (66, 145)),
    ("UZERO", "2023"): (36, 20, 63, (11, 9), (14, 22)),
    ("USOFR", "2023"): (126, 29, 175, (21, 8), (60, 66)),
}


# ---------------------------------------------------------------- pure helpers (pinned by test_score.py)

def ms(d: date) -> int:
    return int(datetime(d.year, d.month, d.day, tzinfo=timezone.utc).timestamp() * 1000)


def days_between(first: date, last: date) -> list[date]:
    out, d = [], first
    while d <= last:
        out.append(d)
        d += timedelta(days=1)
    return out


def latest(stamps: list[int], ts: int) -> int | None:
    """Index of the latest stamp strictly before ts (fp313's `_latest`), or None."""
    i = bisect.bisect_left(stamps, ts)
    return None if i == 0 else i - 1


def sofr_eight(percent: str) -> float:
    """fp317's `sofr_eight`: the actual/360 rate for eight hours."""
    p = Decimal(percent)
    return float(p / Decimal(100) * Decimal(8) / Decimal(24) / Decimal(360))


def pair_sofr(rows: list[list[str]]) -> tuple[list[int], list[str]]:
    """fp317's `pair_sofr`: row i's percent is published 13:00 UTC on row i+1's effectiveDate."""
    pubs, pcts = [], []
    for i in range(len(rows) - 1):
        y, m, d = (int(x) for x in rows[i + 1][0].split("-"))
        pubs.append(ms(date(y, m, d)) + PUBLISH_HOUR * 3_600_000)
        pcts.append(rows[i][1])
    return pubs, pcts


def signal_on(rule: str, entry_ms: int, fund: tuple, sofr: tuple) -> bool:
    stamps, rates = fund
    i = latest(stamps, entry_ms)
    if i is None:
        raise SystemExit("no settled funding before a decision")
    rate = rates[i]
    if rule == "UZERO":
        return rate < 0.0
    if rule == "USOFR":
        pubs, pcts = sofr
        j = latest(pubs, entry_ms)
        if j is None:
            raise SystemExit("no published SOFR before a decision")
        return rate < sofr_eight(pcts[j])
    raise ValueError(rule)


def trades_of(sig: list[int]) -> list[tuple[int, int]]:
    """The frozen position rule: one position; a signal while holding moves the exit to two days after it.

    sig[i] is the signal on entry day i (0..N-1); days N and N+1 carry exits only.
    Returns (entry index, exit index) pairs.
    """
    n = len(sig)
    out: list[tuple[int, int]] = []
    holding = False
    entry = exit_ = -1
    for d in range(n + 2):
        on = d < n and bool(sig[d])
        if holding:
            if on:
                exit_ = d + 2
            elif d == exit_:
                out.append((entry, exit_))
                holding = False
        elif on:
            holding = True
            entry, exit_ = d, d + 2
    if holding:
        raise RuntimeError("a position outlived its window")
    return out


def rotate(sig: list[int], k: int) -> list[int]:
    """Shift k: entry day i takes the signal of entry day (i - k) mod N."""
    n = len(sig)
    k %= n
    return sig[n - k:] + sig[:n - k] if k else list(sig)


def net_return(entry_open: float, exit_open: float, cost: float) -> float:
    if entry_open <= 0 or exit_open <= 0:
        raise ValueError("a fill needs a positive price")
    return exit_open * (1.0 - cost) / (entry_open * (1.0 + cost)) - 1.0


def total_s(trades: list[tuple[int, int]], opens: list[float], cost: float) -> float:
    """S: P&L in dollars with $100 in each trade, not compounded."""
    return 100.0 * sum(net_return(opens[a], opens[b], cost) for a, b in trades)


def count_ge(s0: float, shifted: list[float]) -> int:
    """The number of shifts with S_k >= S_0: a tie counts against the rule."""
    return sum(1 for s in shifted if s >= s0)


def p_value(s0: float, shifted: list[float]) -> Fraction:
    """(1 + the number of shifts with S_k >= S_0) / (1 + the number of shifts), exact."""
    return Fraction(1 + count_ge(s0, shifted), 1 + len(shifted))


def holm(p: dict[str, Fraction]) -> dict[str, bool]:
    """Condition 3 as frozen: the smaller p clears at <= 0.025, the other at <= 0.05 if the first cleared;
    equal p's both clear at <= 0.025 and neither above it."""
    (a, pa), (b, pb) = sorted(p.items())
    if pa == pb:
        both = pa <= Fraction(1, 40)
        return {a: both, b: both}
    first, second = (a, b) if pa < pb else (b, a)
    first_clears = p[first] <= Fraction(1, 40)
    return {first: first_clears, second: first_clears and p[second] <= Fraction(1, 20)}


def percentile(sorted_vals: list[float], q: float) -> float:
    """sorted[int(q * (M - 1))]."""
    return sorted_vals[int(q * (len(sorted_vals) - 1))]


def sd(xs: list[float]) -> float:
    m = sum(xs) / len(xs)
    return math.sqrt(sum((x - m) ** 2 for x in xs) / (len(xs) - 1))


def acf1(xs: list[float]) -> float:
    m = sum(xs) / len(xs)
    return sum((a - m) * (b - m) for a, b in zip(xs, xs[1:])) / sum((a - m) ** 2 for a in xs)


# ---------------------------------------------------------------- inputs

def sha256_file(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def load_gz(name: str):
    with gzip.open(INPUTS / name, "rb") as fh:
        return json.loads(fh.read())


def load_funding() -> tuple[list[int], list[float]]:
    rows = load_gz("funding_btcusdt.json.gz")
    stamps = [int(t) for t, _ in rows]
    rates = [float(r) for _, r in rows]  # as fp313: float(row["fundingRate"])
    if stamps != sorted(set(stamps)):
        raise SystemExit("funding stamps are not strictly increasing")
    buckets = []
    for t in stamps:
        q, r = divmod(t, EIGHT_H)
        if r > 120_000:
            raise SystemExit("a settlement stamp is not just after an 8-hour boundary")
        buckets.append(q * EIGHT_H)
    if any(b - a != EIGHT_H for a, b in zip(buckets, buckets[1:])):
        raise SystemExit("a settlement is missing")
    if buckets[0] != ms(date(2019, 9, 10)) + EIGHT_H or buckets[-1] != ms(date(2026, 9, 24)) + 2 * EIGHT_H:
        raise SystemExit("funding does not cover 2019-09-10 08:00 to 2026-09-24 16:00")
    return stamps, rates


def load_sofr() -> tuple[list[int], list[str]]:
    rows = load_gz("sofr.json.gz")
    dates = [d for d, _ in rows]
    if dates != sorted(set(dates)) or dates[0] != "2019-06-03" or dates[-1] != "2026-09-24":
        raise SystemExit("SOFR does not have the frozen shape")
    if any(not isinstance(p, str) for _, p in rows):
        raise SystemExit("a SOFR percent was precomputed")
    return pair_sofr(rows)


def load_opens(name: str, first: date, last: date, complete: bool) -> dict[int, float]:
    rows = load_gz(name)
    out = {int(t): float(p) for t, p in rows}
    lo, hi = ms(first), ms(last)
    out = {t: p for t, p in out.items() if lo <= t <= hi}
    if complete:
        want = list(range(lo, hi + DAY, DAY))
        if sorted(out) != want:
            raise SystemExit(f"{name} is missing a day")
    if any(p <= 0 for p in out.values()):
        raise SystemExit(f"{name} holds a price that is not positive")
    return out


# ---------------------------------------------------------------- the study

def window_days(name: str) -> tuple[list[date], list[date]]:
    first, last_entry, last_open = WINDOWS[name]
    entry_days = days_between(first, last_entry)
    price_days = days_between(first, last_open)
    if len(price_days) != len(entry_days) + 2:
        raise RuntimeError("a window's last open is not two days after its last entry")
    return entry_days, price_days


def signals(rule: str, entry_days: list[date], fund, sofr) -> list[int]:
    out = []
    for d in entry_days:
        t = ms(d)
        i = latest(fund[0], t)
        if (fund[0][i] // EIGHT_H) * EIGHT_H != t - EIGHT_H:
            raise SystemExit(f"the decision of {d} does not use the D-1 16:00 settlement")
        out.append(1 if signal_on(rule, t, fund, sofr) else 0)
    return out


def counts_of(sig: list[int]) -> tuple:
    tr = trades_of(sig)
    half = len(sig) // 2
    return (
        sum(sig),
        len(tr),
        sum(b - a for a, b in tr),
        (sum(1 for a, _ in tr if a < half), sum(1 for a, _ in tr if a >= half)),
        (sum(sig[:half]), sum(sig[half:])),
    )


def r2(x: float) -> float:
    return round(x, 2)


def r4(x: float) -> float:
    return round(x, 4)


def score_window(rule: str, name: str, sig: list[int], price_days: list[date],
                 opens: dict[int, float], cb: dict[int, float]) -> dict:
    n = len(sig)
    px = [opens[ms(d)] for d in price_days]
    tr = trades_of(sig)
    half = n // 2
    held = sum(b - a for a, b in tr)
    s_base = total_s(tr, px, COST)
    s_stress = total_s(tr, px, STRESS)

    trade_rows = []
    months: dict[str, float] = defaultdict(float)
    halves = [0.0, 0.0]
    cb_total, cb_halves, cb_left_out = 0.0, [0.0, 0.0], 0
    for a, b in tr:
        net = net_return(px[a], px[b], COST)
        months[price_days[a].strftime("%Y-%m")] += 100.0 * net
        halves[0 if a < half else 1] += 100.0 * net
        ca, cb_exit = cb.get(ms(price_days[a])), cb.get(ms(price_days[b]))
        cb_net = None
        if ca is None or cb_exit is None:
            cb_left_out += 1
        else:
            cb_net = net_return(ca, cb_exit, COST)
            cb_total += 100.0 * cb_net
            cb_halves[0 if a < half else 1] += 100.0 * cb_net
        trade_rows.append({
            "entry": price_days[a].isoformat(),
            "exit": price_days[b].isoformat(),
            "days": b - a,
            "entry_open": px[a],
            "exit_open": px[b],
            "gross_bp": r2(1e4 * (px[b] / px[a] - 1.0)),
            "net_bp": r2(1e4 * net),
            "stress_net_bp": r2(1e4 * net_return(px[a], px[b], STRESS)),
            "coinbase_net_bp": None if cb_net is None else r2(1e4 * cb_net),
        })

    ranked = sorted(months.items(), key=lambda kv: (-kv[1], kv[0]))
    best_month, best_s = ranked[0] if ranked else (None, 0.0)
    without_best = s_base - best_s
    share = best_s / s_base if s_base > 0 else None

    # The shift null: every k from 60 to N - 60.
    ks = list(range(MIN_SHIFT, n - MIN_SHIFT + 1))
    shifted, shifted_entries = [], []
    for k in ks:
        tk = trades_of(rotate(sig, k))
        shifted.append(total_s(tk, px, COST))
        shifted_entries.append(len(tk))
    ordered = sorted(shifted)
    ge = count_ge(s_base, shifted)
    p = p_value(s_base, shifted)
    mean_null = sum(shifted) / len(shifted)

    days_in_window = len(price_days) - 1
    return {
        "_raw": {"S": s_base, "S_stress": s_stress, "halves": list(halves), "without_best": without_best,
                 "share": share, "annualised": s_base / 100.0 * 365.0 / days_in_window, "p": p},
        "N": n,
        "signal_days": sum(sig),
        "entries": len(tr),
        "days_held": held,
        "in_market_pct": r2(100.0 * held / days_in_window),
        "S_usd": r4(s_base),
        "S_stress_usd": r4(s_stress),
        "S_halves_usd": [r4(halves[0]), r4(halves[1])],
        "halves": [
            [price_days[0].isoformat(), price_days[half - 1].isoformat()],
            [price_days[half].isoformat(), price_days[n - 1].isoformat()],
        ],
        "mean_net_per_trade_bp": r2(100.0 * s_base / len(tr)) if tr else None,
        "mean_net_per_held_day_bp": r2(100.0 * s_base / held) if held else None,
        "annualised_on_100_pct": r4(s_base * 365.0 / days_in_window),
        "days_in_window": days_in_window,
        "months_usd": {k: r4(v) for k, v in sorted(months.items())},
        "best_month": best_month,
        "best_month_usd": r4(best_s),
        "best_month_share": None if share is None else r4(share),
        "without_best_month_usd": r4(without_best),
        "trades": trade_rows,
        "null": {
            "shifts": len(ks),
            "k_from": ks[0],
            "k_to": ks[-1],
            "count_ge": ge,
            "p": f"{1 + ge}/{1 + len(ks)}",
            "p_float": round(float(p), 6),
            "mean_usd": r4(mean_null),
            "sd_usd": r4(sd(shifted)),
            "p05_usd": r4(percentile(ordered, 0.05)),
            "p50_usd": r4(percentile(ordered, 0.50)),
            "p95_usd": r4(percentile(ordered, 0.95)),
            "p975_usd": r4(percentile(ordered, 0.975)),
            "entries_min_max": [min(shifted_entries), max(shifted_entries)],
            "percentile_rule": "sorted[int(q * (M - 1))]",
        },
        "coinbase": {
            "S_usd": r4(cb_total),
            "S_halves_usd": [r4(cb_halves[0]), r4(cb_halves[1])],
            "trades_left_out": cb_left_out,
        },
    }


def power_check(fund, sofr, opens: dict[int, float]) -> dict:
    z = NormalDist().inv_cdf
    k80 = z(0.975) + z(0.80)
    out = {"vol": {}, "mde": {}}
    for name in ("primary", "second", "2023"):
        _, price_days = window_days(name)
        px = [opens[ms(d)] for d in price_days]
        r1 = [math.log(b / a) for a, b in zip(px, px[1:])]
        r2d = [math.log(px[i + 2] / px[i]) for i in range(len(px) - 2)]
        out["vol"][name] = {
            "daily_sd_pct": round(100 * sd(r1), 3),
            "annual_sd_pct": round(100 * sd(r1) * math.sqrt(365), 1),
            "lag1_autocorrelation": round(acf1(r1), 3),
            "two_day_sd_over_sqrt2_one_day": round(sd(r2d) / (math.sqrt(2) * sd(r1)), 3),
        }
        sigma = sd(r1)
        for rule in RULES:
            entry_days, _ = window_days(name)
            sig = signals(rule, entry_days, fund, sofr)
            n = len(sig)
            tr = trades_of(sig)
            t, h = len(tr), sum(b - a for a, b in tr)
            null_sd = sigma * math.sqrt(h * (1 - h / n))
            eps = k80 * null_sd / t
            out["mde"][f"{rule} {name}"] = {
                "sd_of_S_usd": round(100 * null_sd, 1),
                "smallest_edge_per_trade_bp": round(1e4 * eps, 1),
                "smallest_edge_per_held_day_bp": round(1e4 * eps * t / h, 1),
            }
    return out


def main() -> None:
    if not PREREG.is_file():
        raise SystemExit("the pre-registration is not on disk; nothing is scored without it")
    if sha256_file(PREREG) != PREREG_SHA256:
        raise SystemExit("the pre-registration on disk is not the frozen one")

    fund = load_funding()
    sofr = load_sofr()

    # 1. Counts first, from funding and SOFR alone. No price has been read yet.
    sigs: dict[tuple[str, str], list[int]] = {}
    counts = {}
    for rule in RULES:
        for name in WINDOWS:
            entry_days, _ = window_days(name)
            sig = signals(rule, entry_days, fund, sofr)
            sigs[(rule, name)] = sig
            got = counts_of(sig)
            if got != FROZEN_COUNTS[(rule, name)]:
                raise SystemExit(f"{rule} {name}: counts {got} differ from the frozen {FROZEN_COUNTS[(rule, name)]}")
            counts[f"{rule} {name}"] = {
                "signal_days": got[0], "entries": got[1], "days_held": got[2],
                "entries_by_half": list(got[3]), "signal_days_by_half": list(got[4]),
            }
    # The power check's other counts, reported beside the text that states them.
    by_year: dict[str, list[int]] = {}
    for d in days_between(date(2019, 9, 11), date(2026, 9, 23)):
        t = ms(d)
        row = by_year.setdefault(str(d.year), [0, 0])
        row[0] += int(signal_on("UZERO", t, fund, sofr))
        row[1] += int(signal_on("USOFR", t, fund, sofr))
    entry_days, _ = window_days("primary")
    feb_apr = sum(s for d, s in zip(entry_days, sigs[("UZERO", "primary")])
                  if date(2026, 2, 1) <= d <= date(2026, 4, 30))
    lengths = {}
    for rule in RULES:
        for name in SCORED:
            tr = trades_of(sigs[(rule, name)])
            lengths[f"{rule} {name}"] = [min(b - a for a, b in tr), max(b - a for a, b in tr)]
    nested = all(u <= s for key in WINDOWS for u, s in zip(sigs[("UZERO", key)], sigs[("USOFR", key)]))

    # 2. Prices.
    opens = load_opens("spot_btcusdt_open.json.gz", date(2019, 9, 11), date(2026, 9, 25), complete=True)
    cb = load_opens("coinbase_btcusd_open.json.gz", date(2019, 9, 11), date(2026, 9, 25), complete=False)

    results: dict[str, dict] = {rule: {} for rule in RULES}
    for rule in RULES:
        for name in WINDOWS:
            _, price_days = window_days(name)
            results[rule][name] = score_window(rule, name, sigs[(rule, name)], price_days, opens, cb)

    # 3. The bar, decided on unrounded values.
    raw = {rule: {name: results[rule][name].pop("_raw") for name in WINDOWS} for rule in RULES}
    p_primary = {rule: raw[rule]["primary"]["p"] for rule in RULES}
    holm_clear = holm(p_primary)
    bar = {}
    for rule in RULES:
        w, rw = results[rule], raw[rule]
        c = {}
        c["1_profit_each_window"] = all(rw[n]["S"] > 0 for n in SCORED)
        c["2_profit_each_half"] = all(h > 0 for n in SCORED for h in rw[n]["halves"])
        c["3_shift_null_primary_holm"] = holm_clear[rule]
        c["4_double_cost_each_window"] = all(rw[n]["S_stress"] > 0 for n in SCORED)
        c["5_not_one_month"] = all(
            rw[n]["S"] > 0 and rw[n]["without_best"] > 0 and rw[n]["share"] is not None
            and rw[n]["share"] <= MONTH_CAP for n in SCORED)
        c["6_worth_money_primary"] = rw["primary"]["annualised"] > WORTH_MONEY
        c["7_enough_trades"] = all(w[n]["entries"] >= MIN_ENTRIES for n in SCORED)
        c["pass"] = all(c.values())
        bar[rule] = c

    buy_hold = {}
    for name in WINDOWS:
        _, price_days = window_days(name)
        a, b = ms(price_days[0]), ms(price_days[-1])
        buy_hold[name] = {
            "binance_usd": r4(100.0 * net_return(opens[a], opens[b], COST)),
            "coinbase_usd": None if a not in cb or b not in cb else r4(100.0 * net_return(cb[a], cb[b], COST)),
        }

    scripts ={p.name: sha256_file(p) for p in sorted(HERE.glob("*.py"))}
    payload = {
        "study": "FUND: funding crowding as a BTC spot trade at Revolut X's costs",
        "prereg": {"path": "docs/agents/reviews/2026-09-26-fund-crowding-prereg.md", "sha256": PREREG_SHA256,
                   "frozen_at": "98862d04"},
        "inputs_sha256": {p.name: sha256_file(p) for p in sorted(INPUTS.glob("*.json.gz"))},
        "scripts_sha256": scripts,
        "costs_per_side": {"base": COST, "stress": STRESS},
        "windows": {n: {"first_entry": a.isoformat(), "last_entry": b.isoformat(), "last_open": c.isoformat()}
                    for n, (a, b, c) in WINDOWS.items()},
        "counts_check": {"matches_frozen_table": True, "counts": counts,
                         "signal_days_by_year_uzero_usofr": by_year,
                         "uzero_primary_days_feb_to_apr_2026": feb_apr,
                         "trade_length_min_max": lengths,
                         "every_uzero_day_is_a_usofr_day": nested},
        "power_check": power_check(fund, sofr, opens),
        "results": results,
        "holm_primary": {rule: {"p": results[rule]["primary"]["null"]["p"],
                                "p_float": round(float(p_primary[rule]), 6),
                                "clears": holm_clear[rule]} for rule in RULES},
        "bar": bar,
        "verdict": {rule: ("pass" if bar[rule]["pass"] else "fail") for rule in RULES},
        "buy_and_hold_one_round_trip": buy_hold,
    }
    text = json.dumps(payload, indent=1, sort_keys=True) + "\n"
    OUT.write_text(text)
    print(f"fund.json sha256 {hashlib.sha256(text.encode()).hexdigest()}")
    for rule in RULES:
        print(rule, payload["verdict"][rule], {k: v for k, v in bar[rule].items()})


if __name__ == "__main__":
    main()
