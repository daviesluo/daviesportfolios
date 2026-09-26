"""fp6 phase 1: the power check (event counts, market volatilities) and the measurements that kill ideas.

    python3 docs/agents/backtests/fp6/measure.py

Reads only inputs/ (and the TREND-LS counts `trend_ls_counts.json` written by trend_ls.ts). Writes
measurements.json with sorted keys, fixed rounding and no clock.

What it may compute (phase 1 of fp6): counts of signal days, packages, holding days and events;
the unconditional volatility and autocorrelation of market series with no rule applied (daily funding
sums, daily changes of the perpetual-to-spot basis, daily returns); the share of settlements at a
given rate; order filters. What it never computes: a return, a fee, a funding payment or a P&L of
any rule, any mean of a basis or of a funding series inside a test window, or any statistic
conditioned on a rule's positions except counts.
"""

from __future__ import annotations

import json
import math
import statistics
import sys
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import rules as R  # noqa: E402
import vision as V  # noqa: E402

HERE = Path(__file__).resolve().parent
IN = HERE / "inputs"
DAY = R.DAY


def ms(y, m, d):
    return int(datetime(y, m, d, tzinfo=timezone.utc).timestamp() * 1000)


def iso(t):
    return datetime.fromtimestamp(t / 1000, tz=timezone.utc).strftime("%Y-%m-%d")


WIN_FROM = ms(2023, 1, 1)        # first decision day of the carry and event windows
WIN_LAST = ms(2026, 9, 24)       # last decision day
WIN_END = ms(2026, 9, 25)        # the open that closes whatever is still open
HALF = ms(2024, 11, 13)          # first day of the second half (1,363 days split 682 / 681)
LAST12 = ms(2025, 9, 25)
DAYS = list(range(WIN_FROM, WIN_LAST + DAY, DAY))
# One-sided normal quantile at 0.05 / 6: H1's power figure, written while the family had six. H1 was withdrawn on its
# own counts (h1 below; the family prereg) and the five that remain are Holm-corrected at 0.05 / 5; their preregs
# state their detectable effects at that step. Kept as run so measurements.json still reproduces byte for byte.
Z_HOLM6 = 2.3940
Z_POWER = 0.8416                 # 80 % power


def r(x, k=4):
    return None if x is None else round(float(x), k)


def acf_sum(xs: list[float], max_lag: int) -> float:
    """1 + 2 Σ ρ_k over k = 1..max_lag (Bartlett weights), the variance inflation of a mean."""
    n = len(xs)
    mu = sum(xs) / n
    var = sum((x - mu) ** 2 for x in xs) / n
    s = 0.0
    for k in range(1, max_lag + 1):
        c = sum((xs[i] - mu) * (xs[i + k] - mu) for i in range(n - k)) / n
        s += (1 - k / (max_lag + 1)) * c / var
    return 1 + 2 * s


def load():
    return {
        "funding": V.read_gz(IN / "funding.json.gz"),
        "perp": V.read_gz(IN / "perp_1d.json.gz"),
        "spot": V.read_gz(IN / "spot_1d.json.gz"),
        "pairs": V.read_gz(IN / "perp_spot_pairs.json.gz"),
        "quarterly": V.read_gz(IN / "quarterly_1d.json.gz"),
        "xinfo": V.read_gz(IN / "exchangeinfo_2026-09-26.json.gz"),
        "ann": V.read_gz(IN / "announcements.json.gz"),
    }


def bars_by_day(rows):
    return {int(x[0]): x for x in rows}


# ───────────────────────────────────────────────────────────── H1 CARRY-P


def h1(d) -> dict:
    out = {}
    for coin in R.H1_COINS:
        f = R.Funding.of(d["funding"][coin])
        holds = R.h1_holds(f, DAYS)
        held_days = 0
        per_half = Counter()
        entries_half = Counter()
        for a, b in holds:
            b = b if b is not None else WIN_END
            held_days += (b - a) // DAY
            for t in range(a, b, DAY):
                per_half["first" if t < HALF else "second"] += 1
                if t >= LAST12:
                    per_half["last12"] += 1
            entries_half["first" if a < HALF else "second"] += 1
            if a >= LAST12:
                entries_half["last12"] += 1
        # settlements in the window, and how many sit at the formula's 0.01 % floor, per year (counts only)
        in_win = [(b, x) for b, x in zip(f.buckets, f.rates) if WIN_FROM <= b <= WIN_END]
        by_year = defaultdict(lambda: Counter())
        for b, x in in_win:
            y = iso(b)[:4]
            by_year[y]["settlements"] += 1
            if abs(x - 0.0001) < 1e-12:
                by_year[y]["at_floor_0.0100pct"] += 1
            if x < 0:
                by_year[y]["negative"] += 1
            if x > 0.0001 + 1e-12:
                by_year[y]["above_floor"] += 1
        intervals = Counter(int(row[1]) for row in d["funding"][coin] if WIN_FROM <= R.bucket(int(row[0])) <= WIN_END and row[1] is not None)
        # market volatilities, no rule: daily funding sum, daily change of the open-to-open basis
        fdaily = [f.sum_between(t, t + DAY) for t in DAYS]
        pb, sb = bars_by_day(d["perp"][coin]), bars_by_day(d["spot"][coin])
        basis = [pb[t][1] / sb[t][1] - 1 for t in DAYS + [WIN_END] if t in pb and t in sb]
        dbasis = [basis[i + 1] - basis[i] for i in range(len(basis) - 1)]
        out[coin] = {
            "entries": len(holds), "exits": sum(1 for _, b in holds if b is not None),
            "daysHeld": held_days, "daysInWindow": len(DAYS) + 0,
            "daysHeldByPart": dict(per_half), "entriesByPart": dict(entries_half),
            "settlementsByYear": {y: dict(c) for y, c in sorted(by_year.items())},
            "fundingIntervalsHours": {str(k): v for k, v in sorted(intervals.items())},
            "sdDailyFundingSum": r(statistics.pstdev(fdaily), 8),
            "varianceInflationDailyFunding90": r(acf_sum(fdaily, 90), 2),
            "sdDailyBasisChange": r(statistics.pstdev(dbasis), 8),
            "varianceInflationBasisChange10": r(acf_sum(dbasis, 10), 2),
            "basisDays": len(basis),
        }
    # the power of condition 2: SE of the sleeve's annualised mean from the two components (no mean computed)
    n = len(DAYS)
    comp = []
    for coin in R.H1_COINS:
        o = out[coin]
        var_f = (o["sdDailyFundingSum"] ** 2) * o["varianceInflationDailyFunding90"]
        var_b = (o["sdDailyBasisChange"] ** 2) * max(o["varianceInflationBasisChange10"], 0.0)
        comp.append(var_f + var_b)
    # sleeve = the two coins at equal capital, notional = capital / 1.1; worst case: the two perfectly correlated
    se_daily_corr = (sum(math.sqrt(v) for v in comp) / 2) / 1.1 / math.sqrt(n)
    se_ann = se_daily_corr * 365
    out["power"] = {
        "days": n, "seAnnualisedMeanOnCapital_perfectCorrelation": r(se_ann, 5),
        "smallestExcessOver8pct_80pctPower_holmFirstStep": r((Z_HOLM6 + Z_POWER) * se_ann, 4),
        "note": "held days < window days make the true SE smaller; funding's persistence (variance inflation over 90 lags) is the dominant term",
    }
    return out


# ───────────────────────────────────────────────────────────── H2 CARRY-Q (counts)


def h2(d) -> dict:
    out = {}
    for coin in ("ETHUSDT", "BTCUSDT"):
        sb = bars_by_day(d["spot"][coin])
        qs = {c: bars_by_day(rows) for c, rows in d["quarterly"].items() if c.startswith(coin + "_")}
        pk = []
        holding = None  # (contract, entry day)
        for t in DAYS:
            if holding is not None and t >= R.delivery_day(holding[0]):
                pk.append((holding[0], holding[1], R.delivery_day(holding[0])))
                holding = None
            if holding is None:
                prev = t - DAY
                closes = {c: q[prev][4] for c, q in qs.items() if prev in q and t in q and t < R.delivery_day(c)}
                s_prev = sb[prev][4] if prev in sb else None
                pick = R.h2_pick(t, s_prev, closes)
                if pick is not None and t in sb:
                    holding = (pick[0], t)
        if holding is not None:
            pk.append((holding[0], holding[1], min(WIN_END, R.delivery_day(holding[0]))))
        held = sum((b - a) // DAY for _, a, b in pk)
        by_part = Counter()
        for _, a, b in pk:
            for t in range(a, b, DAY):
                by_part["first" if t < HALF else "second"] += 1
                if t >= LAST12:
                    by_part["last12"] += 1
        out[coin] = {"packages": len(pk), "daysHeld": held, "daysHeldByPart": dict(by_part),
                     "contractsUsed": sorted({c for c, _, _ in pk}),
                     "note": "counts of the one-at-a-time rule; no basis level, return or P&L is written"}
    return out


# ───────────────────────────────────────────────────────────── H3 CARRY-X (counts)


def h3(d) -> dict:
    perp = {s: bars_by_day(rows) for s, rows in d["perp"].items()}
    spot = {s: bars_by_day(rows) for s, rows in d["spot"].items()}
    perp_first = {s: min(b) for s, b in perp.items() if b}
    spot_first = {s: min(b) for s, b in spot.items() if b}
    pairs = {p: s for p, s in d["pairs"].items() if p.endswith("USDT")}
    crypto = crypto_set(d)
    fund = {}

    def a3(p, t):
        if p not in fund:
            rows = d["funding"].get(p)
            fund[p] = R.Funding.of(rows) if rows else None
        f = fund[p]
        return None if f is None else f.trailing_annualised(t, R.H3_TRAIL_DAYS)

    ucache = {}

    def universe(t, top):
        key = (t, top)
        if key not in ucache:
            ucache[key] = R.h3_universe(t, perp, perp_first, spot, spot_first, pairs, top, crypto)
        return ucache[key]

    def guard_hit(p, entry_day, t):
        pb = perp.get(p, {})
        prev = t - DAY
        if entry_day not in pb or prev not in pb or prev < entry_day:
            return False
        return pb[prev][2] >= R.H3_GUARD * pb[entry_day][1]

    pk = R.h3_run(DAYS, universe, a3, guard_hit)
    lengths = [((p.exit_day if p.exit_day is not None else WIN_END) - p.entry_day) / DAY for p in pk]
    by_part = Counter("first" if p.entry_day < HALF else "second" for p in pk)
    by_part["last12"] = sum(1 for p in pk if p.entry_day >= LAST12)
    slot_days = Counter()
    for p in pk:
        end = p.exit_day if p.exit_day is not None else WIN_END
        for t in range(p.entry_day, end, DAY):
            slot_days["first" if t < HALF else "second"] += 1
            if t >= LAST12:
                slot_days["last12"] += 1
    # the universe's size over time (how many perpetuals pass every filter), counts only
    sizes = [len(universe(t, 10_000)) for t in DAYS[::30]]
    # unconditional volatility of the daily open-to-open basis change of the universe's members (no rule): the
    # median over coins of each coin's SD across the window
    sds, fsds = [], []
    for p, s in pairs.items():
        pb, sb = perp.get(p, {}), spot.get(s, {})
        b = [pb[t][1] / sb[t][1] - 1 for t in DAYS if t in pb and t in sb]
        if len(b) > 200:
            db = [b[i + 1] - b[i] for i in range(len(b) - 1)]
            sds.append(statistics.pstdev(db))
            rows = d["funding"].get(p)   # the coin's own daily funding sum, no rule applied
            if rows:
                F = R.Funding.of(rows)
                fd = [F.sum_between(t, t + DAY) for t in DAYS if t in pb]
                if len(fd) > 200:
                    fsds.append(statistics.pstdev(fd))
    return {
        "packages": len(pk), "packagesByPart": dict(by_part), "howClosed": dict(Counter(p.how for p in pk)),
        "distinctCoins": len({p.perp for p in pk}),
        "holdDays": {"median": r(statistics.median(lengths), 1) if lengths else None,
                     "p25": r(sorted(lengths)[len(lengths) // 4], 1) if lengths else None,
                     "p75": r(sorted(lengths)[3 * len(lengths) // 4], 1) if lengths else None},
        "slotDaysByPart": dict(slot_days), "slotDaysAvailable": len(DAYS) * R.H3_SLOTS,
        "eligibleUniverseSizeEvery30Days": sizes,
        "medianCoinSdDailyBasisChange": r(statistics.median(sds), 6) if sds else None,
        "coinsWithBasisSeries": len(sds),
        "medianCoinSdDailyFundingSum": r(statistics.median(fsds), 6) if fsds else None,
        "coinsWithFundingSeries": len(fsds),
    }


# ───────────────────────────────────────────────────────────── H5 DELIST-S and H6 LIST-S (counts)


def crypto_set(d) -> set[str]:
    return R.crypto_contracts(d["perp"].keys(), d["xinfo"]["um"]["symbols"])


def h5(d) -> dict:
    perps = {p for p in d["perp"] if p.endswith("USDT")}
    pb = {p: bars_by_day(d["perp"][p]) for p in perps}
    ev = R.delist_events(d["ann"]["texts"], WIN_FROM, WIN_END)
    rows = []
    for e in ev:
        p = R.perp_for_token(e["token"], perps)
        day = e["published"] // DAY * DAY
        entry, exit_day = R.delist_entry_exit(e)
        alive = p is not None and day in pb[p] and entry in pb[p]
        last = max(pb[p]) if p is not None and pb[p] else None
        rows.append({"token": e["token"], "perp": p, "announced": iso(e["published"]), "cease": iso(e["cease"]),
                     "entry": iso(entry), "plannedExit": iso(exit_day), "perpAlive": alive,
                     "perpLastBar": iso(last) if last else None,
                     "perpEndsBeforePlannedExit": bool(alive and last is not None and last < exit_day),
                     "plannedDays": (exit_day - entry) // DAY})
    alive = [x for x in rows if x["perpAlive"]]
    open_on = Counter()
    for x in alive:
        e0 = ms(*map(int, x["entry"].split("-")))
        e1 = ms(*map(int, x["plannedExit"].split("-")))
        for t in range(e0, e1, DAY):
            open_on[t] += 1
    return {
        "announcementTokens": len(rows), "withPerpAliveAtEntry": len(alive),
        "byYear": dict(sorted(Counter(x["announced"][:4] for x in alive).items())),
        "byHalf": dict(Counter("first" if x["announced"] < iso(HALF) else "second" for x in alive)),
        "perpEndsBeforePlannedExit": sum(1 for x in alive if x["perpEndsBeforePlannedExit"]),
        "plannedDays": {"median": statistics.median([x["plannedDays"] for x in alive]) if alive else None,
                        "min": min([x["plannedDays"] for x in alive]) if alive else None,
                        "max": max([x["plannedDays"] for x in alive]) if alive else None},
        "peakConcurrentEvents": max(open_on.values()) if open_on else 0,
        "events": rows,
    }


def h6(d) -> dict:
    crypto = crypto_set(d)
    first = {p: int(rows[0][0]) for p, rows in d["perp"].items() if rows}
    ev = R.listing_events(first, crypto, WIN_FROM, ms(2026, 8, 25))
    by_year = Counter(iso(e["listed"])[:4] for e in ev)
    by_half = Counter("first" if e["entry"] < HALF else "second" for e in ev)
    # how many had a full 30-day hold in the archive, and how many stopped trading earlier (counts only)
    full = 0
    ended = 0
    for e in ev:
        b = bars_by_day(d["perp"][e["perp"]])
        if e["entry"] + R.H6_HOLD_DAYS * DAY in b:
            full += 1
        elif max(b) < e["entry"] + R.H6_HOLD_DAYS * DAY:
            ended += 1
    # concurrency: the most events open on one day (the capital a $100-per-event rule ties up)
    open_on = Counter()
    for e in ev:
        for t in range(e["entry"], e["entry"] + R.H6_HOLD_DAYS * DAY, DAY):
            open_on[t] += 1
    # unconditional daily volatility of established crypto perpetuals over the window (no rule): median across coins
    sds = []
    for p in crypto:
        if not p.endswith("USDT"):
            continue
        rows = [x for x in d["perp"][p] if WIN_FROM <= x[0] <= WIN_END]
        if len(rows) > 300:
            rets = [math.log(rows[i + 1][1] / rows[i][1]) for i in range(len(rows) - 1) if rows[i][1] > 0 and rows[i + 1][1] > 0]
            sds.append(statistics.pstdev(rets))
    return {"events": len(ev), "byYear": dict(sorted(by_year.items())), "byHalf": dict(by_half),
            "withFull30DaysOfBars": full, "stoppedTradingWithin30Days": ended,
            "peakConcurrentEvents": max(open_on.values()) if open_on else 0,
            "medianDailySdOfEstablishedPerps": r(statistics.median(sds), 5) if sds else None,
            "perpsInSdSample": len(sds)}


def kills(d) -> dict:
    """Measurements that close ideas before any P&L."""
    out = {}
    # the perpetuals' order filters: minimum notional and how far from the mark a limit order may rest
    xs = {s["symbol"]: s for s in d["xinfo"]["um"]["symbols"]}
    rows = {}
    for p in ("BTCUSDT", "ETHUSDT", "SOLUSDT", "AVAXUSDT", "XRPUSDT", "BNBUSDT", "DOGEUSDT", "TRXUSDT", "BTCUSDC", "ETHUSDC"):
        s = xs.get(p)
        if not s:
            continue
        f = {x["filterType"]: x for x in s["filters"]}
        rows[p] = {"minNotional": f.get("MIN_NOTIONAL", {}).get("notional"),
                   "percentPriceDown": f.get("PERCENT_PRICE", {}).get("multiplierDown"),
                   "percentPriceUp": f.get("PERCENT_PRICE", {}).get("multiplierUp"),
                   "liquidationFee": s.get("liquidationFee"), "marketTakeBound": s.get("marketTakeBound")}
    out["perpFilters_2026-09-26"] = rows
    # USDT-margined against USDC-margined funding on the same coin: how often the trailing 7-day difference,
    # annualised, is large enough to pay a perp-against-perp package (a count of days, no P&L)
    spread = {}
    for coin in ("BTC", "ETH"):
        fu, fc = d["funding"].get(f"{coin}USDT"), d["funding"].get(f"{coin}USDC")
        if not fu or not fc:
            continue
        FU, FC = R.Funding.of(fu), R.Funding.of(fc)
        first_c = FC.buckets[0]
        days = [t for t in DAYS if t - 7 * DAY >= first_c]
        diffs = [abs(FU.trailing_annualised(t, 7) - FC.trailing_annualised(t, 7)) for t in days]
        spread[coin] = {"days": len(days), "from": iso(days[0]) if days else None,
                        "daysAbsDiffAtLeast5pct": sum(1 for x in diffs if x >= 0.05),
                        "daysAbsDiffAtLeast10pct": sum(1 for x in diffs if x >= 0.10)}
    out["usdtVsUsdcFunding7d"] = spread
    return out


if __name__ == "__main__":
    d = load()
    out = {"h1": h1(d), "h2": h2(d), "h3": h3(d), "h5": h5(d), "h6": h6(d), "kills": kills(d)}
    (HERE / "measurements.json").write_text(json.dumps(out, indent=1, sort_keys=True) + "\n")
    print(json.dumps(out, indent=1, sort_keys=True)[:6000])
