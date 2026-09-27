"""fp6 phase 2: H2 CARRY-Q and H3 CARRY-X, scored exactly as frozen.

    python3 docs/agents/backtests/fp6/score_carry.py h2     # writes carry_quarterly.json
    python3 docs/agents/backtests/fp6/score_carry.py h3     # writes carry_xs.json

Pre-registrations: docs/agents/reviews/2026-09-26-fp6-prereg-carry-quarterly.md (H2) and
…-carry-xs.md (H3), frozen on main by d856fd2e. Before anything is priced this script
  1. checks the sha256 of the prereg, of rules.py and of measurements.json against the frozen bytes;
  2. checks every input it reads against manifest.json;
  3. recomputes the phase-1 counts with the phase-1 code (measure.py, unchanged) and stops unless they equal
     measurements.json field for field;
  4. derives its own packages with the frozen rule (rules.py, unchanged) and stops unless they give the same counts.
Then it prices, tests and writes the result with sorted keys, fixed rounding and no clock. Run twice: byte-identical.

Readings the preregs left open, taken once here and named in the study:
* P&L of day t is the change of the marks from t's open (before its trades) to t+1's open (before its trades), so a
  cost at t's open is day t's; the closing trades at 2026-09-25's open are the last window day's (2026-09-24).
* H2: a quarterly is "the nearest-delivery quarterly listed that day" when no other ETH quarterly with a bar that day
  and not yet past its delivery day delivers earlier (on a delivery day the delivering contract is still listed, so a
  new contract sold that day pays the farther half-spread).
* H3: the guard's "entry price" is the perpetual's open on the entry day (rules.py's guard); at the guard the spot is
  sold at the guard level × (spot close / perpetual close) of that day, less its own half-spread and fee; a leg with
  no bar on a day it must be priced (a delisted coin) takes its last daily close before that day.
* H3's null: a guard package's holding length is its days to the guard day plus that day; an "end" package's is its
  days to 2026-09-25.
"""

from __future__ import annotations

import bisect
import json
import math
import random
import statistics
import sys
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import measure as M  # noqa: E402  (the phase-1 counting code, unchanged)
import rules as R  # noqa: E402
import vision as V  # noqa: E402

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[3]
IN = HERE / "inputs"
DAY = R.DAY
WIN_FROM, WIN_LAST, WIN_END, HALF, LAST12 = M.WIN_FROM, M.WIN_LAST, M.WIN_END, M.HALF, M.LAST12
DAYS = M.DAYS                        # 2023-01-01 … 2026-09-24: the 1,363 decision days
SPOT_FEE, PERP_FEE = 0.001, 0.0005   # regular tier, taker, no BNB
LINE, CASH = 0.08, 0.04

FROZEN = {
    "h2": ("docs/agents/reviews/2026-09-26-fp6-prereg-carry-quarterly.md",
           "387f133226df0371d0d144f27aa3d614d405f5f9f85ab6973ee37a6cd893be29"),
    "h3": ("docs/agents/reviews/2026-09-26-fp6-prereg-carry-xs.md",
           "ab61cf7bc1ab3061e33625e05c707cbf574b53cb91d4e1d6d088044e4707ee1b"),
    "rules": ("docs/agents/backtests/fp6/rules.py", "89fad439a015f5b6722861a71d925a2817cfd7110b4c1094fe0d350179ea296a"),
    "measure": ("docs/agents/backtests/fp6/measure.py", "a8d67ca41be1e61f75a37a52111734ccf3b656ba6efb1ba7ce26768116d94275"),
    "measurements": ("docs/agents/backtests/fp6/measurements.json",
                     "e94488462d1f3169b7006ea02c88f154ae79b38e59f3be91e231e0b59fc1ba7a"),
}


def iso(t: int) -> str:
    return datetime.fromtimestamp(t / 1000, tz=timezone.utc).strftime("%Y-%m-%d")


def r(x, k=6):
    return None if x is None else round(float(x), k)


def check_frozen(which: str) -> dict:
    out = {}
    for key in (which, "rules", "measure", "measurements"):
        rel, want = FROZEN[key]
        got = V.sha256_file(ROOT / rel)
        if got != want:
            raise SystemExit(f"{rel} is {got}, frozen as {want}: stop")
        out[rel] = got
    man = json.loads((HERE / "manifest.json").read_text())["inputs"]
    for name, row in man.items():
        if V.sha256_file(IN / name) != row["sha256"]:
            raise SystemExit(f"inputs/{name} does not match manifest.json: stop")
    out["manifest.json inputs"] = "all match"
    return out


# ───────────────────────────────────────────────────────────── statistics the bars share


def cbb_p(daily_pnl: list[float], capital: float, seed: str, line: float = LINE, block: int = 30, B: int = 10_000):
    """Circular block bootstrap of the daily P&L; H0 "the annualised mean <= line".
    p = (1 + #{m*_b - m_hat >= m_hat - line}) / (1 + B). random.Random(str) is seeded by sha512: the same every run."""
    x = [v / capital * 365.0 for v in daily_pnl]
    n = len(x)
    m_hat = sum(x) / n
    ext = x + x[:block]
    pre = [0.0]
    for v in ext:
        pre.append(pre[-1] + v)
    rng = random.Random(seed)
    nb = math.ceil(n / block)
    hits = 0
    for _ in range(B):
        s, k = 0.0, 0
        for _j in range(nb):
            st = rng.randrange(n)
            take = min(block, n - k)
            s += pre[st + take] - pre[st]
            k += take
        if s / n - m_hat >= m_hat - line:
            hits += 1
    return (1 + hits) / (1 + B), m_hat


def ann(pnl: float, capital: float, days: int) -> float:
    return pnl / capital * 365.0 / days


def parts(daily: dict[int, float]) -> dict:
    first = [v for t, v in daily.items() if t < HALF]
    second = [v for t, v in daily.items() if t >= HALF]
    last12 = [v for t, v in daily.items() if t >= LAST12]
    return {"first": (sum(first), len(first)), "second": (sum(second), len(second)), "last12": (sum(last12), len(last12))}


def months(daily: dict[int, float]) -> dict[str, float]:
    m = defaultdict(float)
    for t, v in daily.items():
        m[iso(t)[:7]] += v
    return dict(sorted(m.items()))


def concentration(daily: dict[int, float]) -> dict:
    m = months(daily)
    tot = sum(m.values())
    best = max(m.items(), key=lambda kv: (kv[1], kv[0]))
    ok = tot > 0 and best[1] <= 0.4 * tot and (tot - best[1]) > 0
    return {"total": r(tot, 4), "bestMonth": best[0], "bestMonthPnl": r(best[1], 4),
            "bestShare": r(best[1] / tot, 4) if tot > 0 else None, "restPnl": r(tot - best[1], 4), "holds": ok}


def max_dd(marks: list[float], capital: float) -> float:
    peak, dd = marks[0], 0.0
    for e in marks:
        peak = max(peak, e)
        dd = max(dd, (peak - e) / capital)
    return dd


def pnl_by_day(e_pre: dict[int, float], e_final: float) -> dict[int, float]:
    out = {}
    for i, t in enumerate(DAYS):
        nxt = e_pre[DAYS[i + 1]] if i + 1 < len(DAYS) else e_final
        out[t] = nxt - e_pre[t]
    return out


# ───────────────────────────────────────────────────────────── half-spreads (inputs/books, inputs/qbooks)


def median_hs(samples: list[dict], side: str, sym: str) -> float | None:
    vals = []
    for s in samples:
        x = s[side].get(sym)
        if not x:
            continue
        bid, ask = float(x[0]), float(x[1])
        if bid > 0 and ask >= bid:
            vals.append((ask - bid) / ((ask + bid) / 2) / 2)
    return statistics.median(vals) if vals else None


def p90(xs: list[float]) -> float:
    s = sorted(xs)
    return s[int(0.9 * (len(s) - 1))]


def book_tables(d) -> dict:
    b = d["books"]
    xinfo = {s["symbol"]: s for s in d["xinfo"]["um"]["symbols"]}
    perp_all = {s: median_hs(b, "perp", s) for s in sorted(b[0]["perp"])}
    spot_all = {s: median_hs(b, "spot", s) for s in sorted(b[0]["spot"])}
    trading = [v for s, v in perp_all.items() if v is not None and xinfo.get(s, {}).get("underlyingType") == "COIN"
               and xinfo.get(s, {}).get("contractType") == "PERPETUAL" and xinfo.get(s, {}).get("status") == "TRADING"]
    spot_listed = [v for v in spot_all.values() if v is not None]
    return {"perp": perp_all, "spot": spot_all, "perpP90": p90(trading), "perpN": len(trading),
            "spotP90": p90(spot_listed), "spotN": len(spot_listed)}


# ───────────────────────────────────────────────────────────── H2 CARRY-Q


def h2_packages(sb: dict, qs: dict) -> list[dict]:
    """The frozen rule, as measure.py's h2 runs it: one package at a time, to delivery."""
    pk, holding = [], None
    for t in DAYS:
        if holding is not None and t >= R.delivery_day(holding[0]):
            pk.append({"contract": holding[0], "entry": holding[1], "exit": R.delivery_day(holding[0]), "y": holding[2]})
            holding = None
        if holding is None:
            prev = t - DAY
            closes = {c: q[prev][4] for c, q in qs.items() if prev in q and t in q and t < R.delivery_day(c)}
            s_prev = sb[prev][4] if prev in sb else None
            pick = R.h2_pick(t, s_prev, closes)
            if pick is not None and t in sb:
                holding = (pick[0], t, pick[1])
    if holding is not None:
        pk.append({"contract": holding[0], "entry": holding[1], "exit": min(WIN_END, R.delivery_day(holding[0])),
                   "y": holding[2]})
    return pk


def h2_counts(pk: list[dict]) -> dict:
    by_part = Counter()
    for p in pk:
        for t in range(p["entry"], p["exit"], DAY):
            by_part["first" if t < HALF else "second"] += 1
            if t >= LAST12:
                by_part["last12"] += 1
    return {"packages": len(pk), "daysHeld": sum((p["exit"] - p["entry"]) // DAY for p in pk),
            "daysHeldByPart": dict(by_part), "contractsUsed": sorted({p["contract"] for p in pk})}


def h2_price(pk, sb, qs, coin, hs_spot, hs_near, hs_far, mult=1.0) -> dict:
    """Account the packages: $1,000; spot q costs $1,000 / 1.1 with its fee; q of the quarterly sold; closed at the
    delivery day's opens (spot kept when the next package opens the same day)."""
    sfee, qfee = SPOT_FEE * mult, PERP_FEE * mult
    hs_s = hs_spot * mult

    def hs_q(c: str, t: int) -> float:
        live = [x for x, q in qs.items() if t in q and t <= R.delivery_day(x)]
        nearest = min(live, key=R.delivery_day)
        return (hs_near if c == nearest else hs_far) * mult

    opens = {p["entry"]: p for p in pk}
    closes = {p["exit"]: p for p in pk}
    usdt, qty, fut = 1000.0, 0.0, None     # fut = (contract, entry price after half-spread)
    e_pre, costs = {}, 0.0
    trades = []
    for t in DAYS + [WIN_END]:
        if t not in sb:
            raise SystemExit(f"{coin} spot has no bar on {iso(t)}")
        s_open = sb[t][1]
        f_open = None
        if fut is not None:
            q = qs[fut[0]]
            if t not in q:
                raise SystemExit(f"{fut[0]} has no bar on {iso(t)}")
            f_open = q[t][1]
        if t != WIN_END:
            e_pre[t] = usdt + qty * s_open + (qty * (fut[1] - f_open) if fut is not None else 0.0)
        # 1. a package whose delivery day this is (or the window's end) is closed at the opens
        closing = fut is not None and (t == WIN_END or (t in closes and closes[t]["contract"] == fut[0]))
        reopen = t in opens and t != WIN_END
        if closing:
            px = f_open * (1 + hs_q(fut[0], t))
            usdt += qty * (fut[1] - px) - qty * px * qfee
            costs += qty * f_open * hs_q(fut[0], t) + qty * px * qfee
            trades.append({"day": iso(t), "what": "buy back " + fut[0]})
            fut = None
            if not reopen:
                ps = s_open * (1 - hs_s)
                usdt += qty * ps * (1 - sfee)
                costs += qty * s_open * hs_s + qty * ps * sfee
                trades.append({"day": iso(t), "what": "sell spot"})
                qty = 0.0
        # 2. a package that opens today: spot bought (unless kept from a roll), the quarterly sold
        if reopen:
            c = opens[t]["contract"]
            q = qs[c]
            if qty == 0.0:
                pb = s_open * (1 + hs_s)
                qty = (1000.0 / 1.1) / (pb * (1 + sfee))
                usdt -= qty * pb * (1 + sfee)
                costs += qty * s_open * hs_s + qty * pb * sfee
                trades.append({"day": iso(t), "what": "buy spot"})
            pf = q[t][1] * (1 - hs_q(c, t))
            usdt -= qty * pf * qfee
            costs += qty * q[t][1] * hs_q(c, t) + qty * pf * qfee
            fut = (c, pf)
            trades.append({"day": iso(t), "what": "sell " + c})
    if fut is not None or qty != 0.0:
        raise SystemExit("a package is still open after the window's end")
    e_final = usdt
    daily = pnl_by_day(e_pre, e_final)
    marks = [e_pre[t] for t in DAYS] + [e_final]
    return {"daily": daily, "marks": marks, "final": e_final, "costs": costs, "trades": trades}


def h2_spqtr(sb, qs) -> dict:
    """Descriptive: SPQTR's own rule on ETH — a $100 package every day the FRONT quarterly's previous-close basis is at
    least 100 bp, gross = entry-open basis minus the delivery-day-open basis, less 40 bp; annualised on the peak capital
    its overlapping packages tie up. The front: the nearest-delivery contract with bars on d-1 and d, before delivery."""
    pnl, open_on = [], Counter()
    for t in DAYS:
        prev = t - DAY
        live = [c for c, q in qs.items() if prev in q and t in q and t < R.delivery_day(c)]
        if not live or prev not in sb or t not in sb:
            continue
        c = min(live, key=R.delivery_day)
        if qs[c][prev][4] / sb[prev][4] - 1 < 0.01:
            continue
        x = R.delivery_day(c)
        if x > WIN_END or x not in qs[c] or x not in sb:
            continue
        gross = (qs[c][t][1] / sb[t][1] - 1) - (qs[c][x][1] / sb[x][1] - 1)
        pnl.append(100.0 * (gross - 0.004))
        for u in range(t, x, DAY):
            open_on[u] += 1
    peak = max(open_on.values()) if open_on else 0
    return {"packages": len(pnl), "pnlUsd": r(sum(pnl), 4), "positive": sum(1 for v in pnl if v > 0),
            "peakOpen": peak, "annualisedOnPeakCapital": r(ann(sum(pnl), peak * 100.0, len(DAYS)), 4) if peak else None,
            "note": "SPQTR's rule re-implemented from its protocol text on ETH; its exits are the delivery day's opens"}


def score_h2(d) -> dict:
    meas = json.loads((HERE / "measurements.json").read_text())
    # the phase-1 counts, recomputed by the phase-1 code
    if M.h2(d) != meas["h2"]:
        raise SystemExit("measure.py's h2 no longer gives measurements.json's h2: stop")
    books = book_tables(d)
    qb = d["qbooks"]

    def qhs(c):
        return median_hs([{"q": s["quarterly"]} for s in qb], "q", c)

    hs = {"ETHUSDT": {"spot": books["spot"]["ETHUSDT"], "near": qhs("ETHUSDT_261225"), "far": qhs("ETHUSDT_270326")},
          "BTCUSDT": {"spot": books["spot"]["BTCUSDT"], "near": qhs("BTCUSDT_261225"), "far": qhs("BTCUSDT_270326")}}
    frozen_bp = {"ETHUSDT": {"spot": 0.019, "near": 0.442, "far": 5.191}, "BTCUSDT": {"spot": 0.0006, "near": 0.346, "far": 3.680}}
    for coin, want in frozen_bp.items():
        for k, v in want.items():
            got = hs[coin][k] * 1e4
            nd = 4 if v < 0.01 else 3
            if round(got, nd) != v:
                raise SystemExit(f"{coin} {k} half-spread {got} bp is not the prereg's {v}: stop")
    out = {"hypothesis": "fp6-H2 CARRY-Q", "halfSpreadsBp": {c: {k: r(v * 1e4, 4) for k, v in x.items()} for c, x in hs.items()}}
    per = {}
    for coin in ("ETHUSDT", "BTCUSDT"):
        sb = M.bars_by_day(d["spot"][coin])
        qs = {c: M.bars_by_day(rows) for c, rows in d["quarterly"].items() if c.startswith(coin + "_")}
        pk = h2_packages(sb, qs)
        cnt = h2_counts(pk)
        if {k: meas["h2"][coin][k] for k in cnt} != cnt:
            raise SystemExit(f"{coin}: the scorer's packages do not give phase 1's counts: stop")
        base = h2_price(pk, sb, qs, coin, hs[coin]["spot"], hs[coin]["near"], hs[coin]["far"])
        dbl = h2_price(pk, sb, qs, coin, hs[coin]["spot"], hs[coin]["near"], hs[coin]["far"], mult=2.0)
        per[coin] = {"pk": pk, "counts": cnt, "base": base, "double": dbl, "sb": sb, "qs": qs}
    eth = per["ETHUSDT"]
    daily = eth["base"]["daily"]
    total = sum(daily.values())
    ps = parts(daily)
    p_boot, m_hat = cbb_p([daily[t] for t in DAYS], 1000.0, "fp6-carry-quarterly")
    a1 = ann(total, 1000.0, len(DAYS))
    a_dbl = ann(sum(eth["double"]["daily"].values()), 1000.0, len(DAYS))
    conc = concentration(daily)
    dd = max_dd(eth["base"]["marks"], 1000.0)
    halves = {k: r(ann(v[0], 1000.0, v[1]), 6) for k, v in ps.items()}
    conds = {
        "c1_annualised_ge_8pct": {"value": r(a1, 6), "holds": a1 >= LINE},
        "c2_bootstrap": {"p": r(p_boot, 6), "annualisedMean": r(m_hat, 6), "holmStep": "applied by holm.py"},
        "c3_each_half_ge_4pct": {"first": halves["first"], "second": halves["second"],
                                 "holds": halves["first"] >= CASH and halves["second"] >= CASH},
        "c4_last12_ge_4pct": {"value": halves["last12"], "holds": halves["last12"] >= CASH},
        "c5_c1_with_costs_doubled": {"value": r(a_dbl, 6), "holds": a_dbl >= LINE},
        "c6_best_month_le_40pct_rest_positive": conc,
        "c7_max_drawdown_le_10pct": {"value": r(dd, 6), "holds": dd <= 0.10},
    }
    out["conditions"] = conds
    out["pBootstrap"] = r(p_boot, 6)
    out["passesOtherThanHolm"] = all(v["holds"] for k, v in conds.items() if k != "c2_bootstrap")
    out["pnlUsd"] = r(total, 4)
    out["packages"] = [{"contract": p["contract"], "entry": iso(p["entry"]), "exit": iso(p["exit"]),
                        "entryNetBasisAnnualised": r(p["y"], 6), "days": (p["exit"] - p["entry"]) // DAY} for p in eth["pk"]]
    out["costsUsd"] = r(eth["base"]["costs"], 4)
    out["trades"] = eth["base"]["trades"]
    out["pnlByMonth"] = {k: r(v, 4) for k, v in months(daily).items()}
    out["countsRecomputed"] = {"ETHUSDT": eth["counts"], "BTCUSDT": per["BTCUSDT"]["counts"], "equalPhase1": True}
    btc = per["BTCUSDT"]
    bd = btc["base"]["daily"]
    out["descriptive"] = {
        "btcSameRule": {"annualised": r(ann(sum(bd.values()), 1000.0, len(DAYS)), 6),
                        "halves": {k: r(ann(v[0], 1000.0, v[1]), 6) for k, v in parts(bd).items()},
                        "packages": [{"contract": p["contract"], "entry": iso(p["entry"]), "y": r(p["y"], 6)} for p in btc["pk"]]},
        "spqtrRuleOnEth": h2_spqtr(eth["sb"], eth["qs"]),
        "daysHeld": eth["counts"]["daysHeld"],
        "entryYDistribution": sorted(r(p["y"], 6) for p in eth["pk"]),
        "sofrMeanOverWindowPct": sofr_mean(),
    }
    return out


def sofr_mean():
    rows = V.read_gz(ROOT / "docs/agents/backtests/fund/inputs/sofr.json.gz")
    lo, hi = iso(WIN_FROM), iso(WIN_END)
    xs = [float(v) for dte, v in rows if lo <= dte < hi]
    return r(sum(xs) / len(xs), 4) if xs else None


# ───────────────────────────────────────────────────────────── H3 CARRY-X


class H3Env:
    """The frozen rule's inputs, built exactly as measure.py's h3 builds them."""

    def __init__(self, d):
        self.perp = {s: M.bars_by_day(rows) for s, rows in d["perp"].items()}
        self.spot = {s: M.bars_by_day(rows) for s, rows in d["spot"].items()}
        self.perp_first = {s: min(b) for s, b in self.perp.items() if b}
        self.spot_first = {s: min(b) for s, b in self.spot.items() if b}
        self.pairs = {p: s for p, s in d["pairs"].items() if p.endswith("USDT")}
        self.crypto = M.crypto_set(d)
        self.fund_rows = d["funding"]
        self.fund: dict = {}
        self.ucache: dict = {}
        self.perp_days = {s: sorted(b) for s, b in self.perp.items()}
        self.spot_days = {s: sorted(b) for s, b in self.spot.items()}
        self.fallbacks = Counter()

    def F(self, p):
        if p not in self.fund:
            rows = self.fund_rows.get(p)
            self.fund[p] = R.Funding.of(rows) if rows else None
        return self.fund[p]

    def a3(self, p, t):
        f = self.F(p)
        return None if f is None else f.trailing_annualised(t, R.H3_TRAIL_DAYS)

    def universe(self, t, top):
        key = (t, top)
        if key not in self.ucache:
            self.ucache[key] = R.h3_universe(t, self.perp, self.perp_first, self.spot, self.spot_first, self.pairs,
                                             top, self.crypto)
        return self.ucache[key]

    def guard_hit(self, p, entry_day, t):
        pb = self.perp.get(p, {})
        prev = t - DAY
        if entry_day not in pb or prev not in pb or prev < entry_day:
            return False
        return pb[prev][2] >= R.H3_GUARD * pb[entry_day][1]

    def open_px(self, bars, days, t, what):
        """The day's open; a leg with no bar that day (delisted) takes its last close before it."""
        if t in bars:
            return bars[t][1]
        i = bisect.bisect_left(days, t) - 1
        if i < 0:
            raise SystemExit(f"{what}: no bar at or before {iso(t)}")
        self.fallbacks[what] += 1
        return bars[days[i]][4]


def h3_counts(pk) -> dict:
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
    return {"packages": len(pk), "packagesByPart": dict(by_part), "howClosed": dict(Counter(p.how for p in pk)),
            "distinctCoins": len({p.perp for p in pk}),
            "holdDays": {"median": M.r(statistics.median(lengths), 1), "p25": M.r(sorted(lengths)[len(lengths) // 4], 1),
                         "p75": M.r(sorted(lengths)[3 * len(lengths) // 4], 1)},
            "slotDaysByPart": dict(slot_days), "slotDaysAvailable": len(DAYS) * R.H3_SLOTS}


def h3_hs(env: H3Env, tables: dict, perp: str) -> tuple[float, float]:
    s = env.pairs[perp]
    hs_p = tables["perp"].get(perp)
    hs_s = tables["spot"].get(s)
    hs_p = tables["perpP90"] if hs_p is None else hs_p
    hs_s = tables["spotP90"] if hs_s is None else hs_s
    return max(hs_s, 1e-4), max(hs_p, 0.5e-4)


def h3_package(env: H3Env, tables, perp: str, entry: int, planned_exit: int, how: str, guard_day: int | None,
               mult: float = 1.0, marks: bool = True, apply_guard: bool = False) -> dict:
    """One package: $1,000 = spot for $666.67 with its fee + $333.33 USDT margin; the perpetual sold at equal notional.
    Rule / universe / end closes at `planned_exit`'s opens; the guard closes during `guard_day` at the level.
    With apply_guard (the null), the guard is looked for on every held day, as the rule's own is."""
    sp = env.pairs[perp]
    pb, sbars = env.perp[perp], env.spot[sp]
    pdays, sdays = env.perp_days[perp], env.spot_days[sp]
    fb_before = sum(env.fallbacks.values())
    above_high = False
    hs_s, hs_p = h3_hs(env, tables, perp)
    hs_s, hs_p = hs_s * mult, hs_p * mult
    sfee, pfee = SPOT_FEE * mult, PERP_FEE * mult
    s0 = env.open_px(sbars, sdays, entry, "spot entry")
    p0 = env.open_px(pb, pdays, entry, "perp entry")
    s_fill = s0 * (1 + hs_s)
    qs = (2000.0 / 3.0) / (s_fill * (1 + sfee))
    qp = qs * s0 / p0
    p_entry = p0 * (1 - hs_p)
    fee_in = qs * s_fill * sfee + qp * p_entry * pfee
    hs_cost = qs * s0 * hs_s + qp * p0 * hs_p
    usdt = 1000.0 - qs * s_fill * (1 + sfee) - qp * p_entry * pfee
    if apply_guard:
        guard_day = None
        for t in range(entry, planned_exit, DAY):
            if t in pb and pb[t][2] >= R.H3_GUARD * p0:
                guard_day = t
                break
        how = "guard" if guard_day is not None else how
    f = env.F(perp)
    fund_end = (guard_day + DAY - 1) if guard_day is not None else planned_exit
    held = f.held_between(entry, fund_end) if f is not None else []
    fund_paid = [(b, qp * env.open_px(pb, pdays, b // DAY * DAY, "perp funding mark") * rate) for b, rate in held]
    funding = sum(v for _, v in fund_paid)
    path = {}
    if marks:
        last_mark_day = guard_day if guard_day is not None else planned_exit
        j = 0
        acc = 0.0
        for t in range(entry + DAY, last_mark_day + DAY, DAY):
            while j < len(fund_paid) and fund_paid[j][0] <= t:
                acc += fund_paid[j][1]
                j += 1
            path[t] = usdt + acc + qs * env.open_px(sbars, sdays, t, "spot mark") + qp * (p_entry - env.open_px(pb, pdays, t, "perp mark"))
    if guard_day is not None:
        g = guard_day
        level = max(R.H3_GUARD * p0, env.open_px(pb, pdays, g, "perp guard"))
        px = level * (1 + hs_p)
        pc = pb[g][4] if g in pb else env.open_px(pb, pdays, g, "perp guard close")
        sc = sbars[g][4] if g in sbars else env.open_px(sbars, sdays, g, "spot guard close")
        s_raw = level * (sc / pc)
        # A check the prereg did not foresee: on a day the spot closes far from the perpetual (a delisting spike),
        # "level x spot close / perp close" can sit above the spot's own high. The frozen price is kept; the
        # study reports these fills and the P&L they would lose at the spot's high.
        above_high = g in sbars and s_raw > sbars[g][2]
        s_capped = min(s_raw, sbars[g][2]) if g in sbars else s_raw
        s_exit_raw, p_exit_raw = s_raw, level
        exit_mark_day = g + DAY
    else:
        x = planned_exit
        s_exit_raw = env.open_px(sbars, sdays, x, "spot exit")
        p_exit_raw = env.open_px(pb, pdays, x, "perp exit")
        px = p_exit_raw * (1 + hs_p)
        exit_mark_day = x + DAY
    ps = s_exit_raw * (1 - hs_s)
    final = usdt + funding + qs * ps * (1 - sfee) + qp * (p_entry - px) - qp * px * pfee
    fee_out = qs * ps * sfee + qp * px * pfee
    hs_cost += qs * s_exit_raw * hs_s + qp * p_exit_raw * hs_p
    basis = qs * (s_exit_raw - s0) + qp * (p0 - p_exit_raw)
    capped_loss = 0.0
    if above_high:
        capped_loss = qs * (s_exit_raw - s_capped) * (1 - hs_s) * (1 - sfee)
    return {"perp": perp, "entry": entry, "how": how, "guardDay": guard_day, "plannedExit": planned_exit,
            "pnl": final - 1000.0, "funding": funding, "basis": basis, "costs": fee_in + fee_out + hs_cost,
            "path": path, "finalFrom": exit_mark_day, "final": final,
            "fallbackPrices": sum(env.fallbacks.values()) - fb_before, "guardSpotAboveHigh": above_high,
            "pnlGivenBackAtSpotHigh": capped_loss}


def h3_sleeve(pkgs: list[dict], slots: int) -> tuple[dict, dict, float, list[float]]:
    cap = 1000.0 * slots
    delta = defaultdict(float)     # E_pre(t) - capital, built from each package's value path
    for p in pkgs:
        for t, v in p["path"].items():
            if t <= DAYS[-1]:
                delta[t] += v - 1000.0
        for t in DAYS:
            if t >= p["finalFrom"]:
                delta[t] += p["final"] - 1000.0
    e_pre = {t: cap + delta[t] for t in DAYS}
    e_final = cap + sum(p["final"] - 1000.0 for p in pkgs)
    daily = pnl_by_day(e_pre, e_final)
    return e_pre, daily, e_final, [e_pre[t] for t in DAYS] + [e_final]


def price_rule_packages(env, tables, pk, mult=1.0) -> list[dict]:
    out = []
    for p in pk:
        if p.how == "guard":
            out.append(h3_package(env, tables, p.perp, p.entry_day, p.exit_day + DAY, "guard", p.exit_day, mult))
        else:
            x = p.exit_day if p.exit_day is not None else WIN_END
            out.append(h3_package(env, tables, p.perp, p.entry_day, x, p.how, None, mult))
    return out


def score_h3(d) -> dict:
    meas = json.loads((HERE / "measurements.json").read_text())
    if M.h3(d) != meas["h3"]:
        raise SystemExit("measure.py's h3 no longer gives measurements.json's h3: stop")
    tables = book_tables(d)
    if (round(tables["spotP90"] * 1e4, 2), tables["spotN"], round(tables["perpP90"] * 1e4, 2), tables["perpN"]) != (11.79, 496, 3.56, 525):
        raise SystemExit("the fallback half-spreads are not the prereg's 11.79 bp / 496 and 3.56 bp / 525: stop")
    env = H3Env(d)
    pk = R.h3_run(DAYS, env.universe, env.a3, env.guard_hit)
    cnt = h3_counts(pk)
    if any(meas["h3"][k] != v for k, v in cnt.items()):
        raise SystemExit("the scorer's packages do not give phase 1's counts: stop")
    base = price_rule_packages(env, tables, pk)
    rule_fallbacks = dict(sorted(env.fallbacks.items()))
    dbl = price_rule_packages(env, tables, pk, mult=2.0)
    _, daily, e_final, marks = h3_sleeve(base, R.H3_SLOTS)
    _, daily2, _, _ = h3_sleeve(dbl, R.H3_SLOTS)
    cap = 1000.0 * R.H3_SLOTS
    total = sum(daily.values())
    if abs(total - sum(p["pnl"] for p in base)) > 1e-6:
        raise SystemExit("the sleeve's P&L is not the packages' P&L: stop")
    ps = parts(daily)
    halves = {k: r(ann(v[0], cap, v[1]), 6) for k, v in ps.items()}
    p_boot, m_hat = cbb_p([daily[t] for t in DAYS], cap, "fp6-carry-xs-boot")
    a1 = ann(total, cap, len(DAYS))
    a_dbl = ann(sum(daily2.values()), cap, len(DAYS))
    conc = concentration(daily)
    dd = max_dd(marks, cap)
    # condition 8: the same packages on coins drawn at random from U(entry day) less the coins the rule held that day
    held_on = defaultdict(set)
    for p in pk:
        end = p.exit_day + DAY if p.how == "guard" else (p.exit_day if p.exit_day is not None else WIN_END)
        for t in range(p.entry_day, end, DAY):
            held_on[t].add(p.perp)
    cand_pnl = []
    for p in sorted(pk, key=lambda q: (q.entry_day, q.perp)):
        if p.how == "guard":
            length = p.exit_day + DAY - p.entry_day
        else:
            length = (p.exit_day if p.exit_day is not None else WIN_END) - p.entry_day
        how = p.how if p.how != "guard" else "rule"
        cands = [c for c in env.universe(p.entry_day, R.H3_TOP_N) if c not in held_on[p.entry_day]]
        cand_pnl.append([h3_package(env, tables, c, p.entry_day, p.entry_day + length, how, None, marks=False,
                                    apply_guard=True)["pnl"] for c in cands])
    rule_sum = sum(p["pnl"] for p in base)
    rng = random.Random("fp6-carry-xs")
    nulls = []
    for _ in range(2000):
        nulls.append(sum(c[rng.randrange(len(c))] for c in cand_pnl))
    ge = sum(1 for v in nulls if v >= rule_sum)
    p_sel = (1 + ge) / 2001
    conds = {
        "c1_annualised_ge_8pct": {"value": r(a1, 6), "holds": a1 >= LINE},
        "c2_bootstrap": {"p": r(p_boot, 6), "annualisedMean": r(m_hat, 6), "holmStep": "applied by holm.py"},
        "c3_each_half_ge_4pct": {"first": halves["first"], "second": halves["second"],
                                 "holds": halves["first"] >= CASH and halves["second"] >= CASH},
        "c4_last12_ge_4pct": {"value": halves["last12"], "holds": halves["last12"] >= CASH},
        "c5_c1_with_costs_doubled": {"value": r(a_dbl, 6), "holds": a_dbl >= LINE},
        "c6_best_month_le_40pct_rest_positive": conc,
        "c7_max_drawdown_le_20pct": {"value": r(dd, 6), "holds": dd <= 0.20},
        "c8_selection_beats_random": {"pSel": r(p_sel, 6), "ruleSumUsd": r(rule_sum, 4),
                                      "nullMeanUsd": r(statistics.fmean(nulls), 4),
                                      "nullP95Usd": r(sorted(nulls)[int(0.95 * (len(nulls) - 1))], 4),
                                      "holds": p_sel <= 0.05},
    }
    out = {"hypothesis": "fp6-H3 CARRY-X", "conditions": conds, "pBootstrap": r(p_boot, 6),
           "passesOtherThanHolm": all(v["holds"] for k, v in conds.items() if k != "c2_bootstrap"),
           "pnlUsd": r(total, 4), "countsRecomputed": cnt | {"equalPhase1": True},
           "fallbackHalfSpreadsBp": {"spotP90": r(tables["spotP90"] * 1e4, 4), "perpP90": r(tables["perpP90"] * 1e4, 4)}}
    out["split"] = {"fundingUsd": r(sum(p["funding"] for p in base), 4), "basisUsd": r(sum(p["basis"] for p in base), 4),
                    "costsUsd": r(sum(p["costs"] for p in base), 4)}
    out["byHow"] = {h: {"packages": sum(1 for p in base if p["how"] == h), "pnlUsd": r(sum(p["pnl"] for p in base if p["how"] == h), 4),
                        "fundingUsd": r(sum(p["funding"] for p in base if p["how"] == h), 4)}
                    for h in sorted({p["how"] for p in base})}
    out["packages"] = [{"perp": p["perp"], "entry": iso(p["entry"]), "how": p["how"],
                        "exit": iso(p["guardDay"]) if p["guardDay"] is not None else iso(p["plannedExit"]),
                        "pnl": r(p["pnl"], 4), "funding": r(p["funding"], 4), "basis": r(p["basis"], 4),
                        "costs": r(p["costs"], 4), "fallbackPrices": p["fallbackPrices"],
                        "guardSpotAboveHigh": p["guardSpotAboveHigh"]} for p in base]
    out["pnlByMonth"] = {k: r(v, 4) for k, v in months(daily).items()}
    out["fallbackPrices"] = rule_fallbacks
    above = [p for p in base if p["guardSpotAboveHigh"]]
    given_back = sum(p["pnlGivenBackAtSpotHigh"] for p in above)
    fb = [p for p in base if p["fallbackPrices"]]
    out["checks"] = {
        "guardSpotSaleAboveTheSpotHigh": {
            "packages": [{"perp": p["perp"], "entry": iso(p["entry"]), "pnl": r(p["pnl"], 4),
                          "givenBackAtTheHigh": r(p["pnlGivenBackAtSpotHigh"], 4)} for p in above],
            "annualisedWithTheseCappedAtTheSpotHigh": r(ann(total - given_back, cap, len(DAYS)), 6)},
        "packagesPricedWithALastClose": {
            "packages": [{"perp": p["perp"], "entry": iso(p["entry"]), "how": p["how"], "pnl": r(p["pnl"], 4),
                          "prices": p["fallbackPrices"]} for p in fb],
            "annualisedWithoutThem": r(ann(total - sum(p["pnl"] for p in fb), cap, len(DAYS)), 6)},
    }
    # descriptive plateau: the entry line and the slots, never deciding
    grid = {}
    for line in (0.10, 0.25, 0.50):
        for slots in (3, 5, 10):
            R.H3_ENTER, R.H3_SLOTS = line, slots
            try:
                gpk = R.h3_run(DAYS, env.universe, env.a3, env.guard_hit)
            finally:
                R.H3_ENTER, R.H3_SLOTS = 0.25, 5
            gp = price_rule_packages(env, tables, gpk)
            grid[f"enter{int(line * 100)}_slots{slots}"] = {
                "packages": len(gpk), "annualised": r(ann(sum(p["pnl"] for p in gp), 1000.0 * slots, len(DAYS)), 6)}
    out["descriptive"] = {"grid": grid, "usdcTwins": "not computed (descriptive only)"}
    return out


# ───────────────────────────────────────────────────────────── main


def main(argv: list[str]) -> int:
    which = argv[0] if argv else ""
    if which not in ("h2", "h3"):
        raise SystemExit("usage: score_carry.py h2|h3")
    frozen = check_frozen(which)
    d = M.load()
    d["books"] = V.read_gz(IN / "books.json.gz")
    d["qbooks"] = V.read_gz(IN / "qbooks.json.gz")
    res = score_h2(d) if which == "h2" else score_h3(d)
    res["frozenFiles"] = frozen
    name = "carry_quarterly.json" if which == "h2" else "carry_xs.json"
    (HERE / name).write_text(json.dumps(res, indent=1, sort_keys=True, ensure_ascii=False) + "\n")
    c = res["conditions"]
    print(name, json.dumps({k: {kk: vv for kk, vv in v.items() if kk in ("value", "holds", "p", "pSel", "first", "second", "bestShare")}
                            for k, v in c.items()}, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
