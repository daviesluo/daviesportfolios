"""fp6 phase 2: H5 DELIST-S and H6 LIST-S, scored exactly as frozen.

    python3 docs/agents/backtests/fp6/score_events.py h5     # writes delist_short.json
    python3 docs/agents/backtests/fp6/score_events.py h6     # writes listing_short.json

Pre-registrations: docs/agents/reviews/2026-09-26-fp6-prereg-delist-short.md (H5) and …-listing-short.md (H6),
frozen on main by d856fd2e. Before anything is priced this script checks the prereg's, rules.py's and
measurements.json's sha256 against the frozen bytes and every input against manifest.json, recomputes the phase-1
counts with the phase-1 code (measure.py, unchanged) and stops unless they equal measurements.json, and derives its
own events with the frozen rules (rules.py) and stops unless they give the same counts. It writes its result with
sorted keys, fixed rounding and no clock. Run twice: byte-identical.

Readings the preregs left open, taken once here and named in the study:
* The stop's "entry price" is the perpetual's open on the entry day (as rules.py's H3 guard reads its entry price);
  the stop is looked for on every held day from the entry day to the day before the exit.
* Funding for a stopped short runs to the end of the stop day (the stop's hour is unknown on daily bars; a squeezed
  short usually pays, and H3's frozen guard takes the same, costlier, reading). For a short whose perpetual stops
  trading it runs to the end of the last bar's day. Otherwise it is (entry, exit], as frozen.
* A settlement's "that day's open" is the perpetual's open on the settlement's UTC day (its last close when it has
  no bar that day).
* A donor is shorted over the event's planned span (entry day to planned exit day) under its own stop; for H5 a donor
  is "named in a delisting announcement within 60 days either side" when any parsed "Binance Will Delist" title
  published within 60 days of the event's entry day names its token.
* The capital of condition 6 is phase 1's `peakConcurrentEvents` × $100 (H5 $800, H6 $3,400), the figure both
  preregs quote; the peak over the holds actually taken is reported beside it.
"""

from __future__ import annotations

import bisect
import json
import random
import statistics
import sys
from collections import Counter, defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import measure as M  # noqa: E402  (the phase-1 counting code, unchanged)
import rules as R  # noqa: E402
import score_carry as SC  # noqa: E402  (the shared statistics and the half-spread table)
import vision as V  # noqa: E402

HERE = SC.HERE
ROOT = SC.ROOT
IN = SC.IN
DAY = R.DAY
WIN_FROM, WIN_END, HALF = M.WIN_FROM, M.WIN_END, M.HALF
WINDOW_DAYS = len(M.DAYS)              # 2023-01-01 → 2026-09-25: 1,363 days
FEE = 0.0005                           # USDⓈ-M taker, regular tier, no BNB
STAKE = 100.0

FROZEN = {
    "h5": ("docs/agents/reviews/2026-09-26-fp6-prereg-delist-short.md",
           "dbcd8b6e967c69087bbeb3200ed9331da582afe42f92af83455bd1347fb6ddc6"),
    "h6": ("docs/agents/reviews/2026-09-26-fp6-prereg-listing-short.md",
           "70b9ff4cabdd7146b999a9e255ea1fdfa6cdee24b689a60b6a377ef323960bbe"),
}

iso, r, ann, months = SC.iso, SC.r, SC.ann, SC.months


def check_frozen(which: str) -> dict:
    out = {}
    for rel, want in (FROZEN[which], SC.FROZEN["rules"], SC.FROZEN["measure"], SC.FROZEN["measurements"]):
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


class Env:
    def __init__(self, d):
        self.perp = {s: M.bars_by_day(rows) for s, rows in d["perp"].items()}
        self.days = {s: sorted(b) for s, b in self.perp.items()}
        self.first = {s: int(rows[0][0]) for s, rows in d["perp"].items() if rows}
        self.crypto = M.crypto_set(d)
        self.fund_rows = d["funding"]
        self.fund: dict = {}
        self.fallbacks = Counter()

    def F(self, p):
        if p not in self.fund:
            rows = self.fund_rows.get(p)
            self.fund[p] = R.Funding.of(rows) if rows else None
        return self.fund[p]

    def open_or_last(self, p, t):
        b = self.perp[p]
        if t in b:
            return b[t][1]
        days = self.days[p]
        i = bisect.bisect_left(days, t) - 1
        self.fallbacks["funding mark"] += 1
        return b[days[i]][4]


def short(env: Env, p: str, entry: int, planned_exit: int, hs: float, fee: float, stop_funding: str = "dayEnd") -> dict:
    """$100 short at the entry day's open (1x), closed at the planned exit's open, at the stop (1.5 x the entry open,
    filled at max(level, that day's open)), or at the close of the last bar if the perpetual stops trading first.
    stop_funding "dayEnd" (the reading taken) pays a stopped short's settlements to the end of the stop day;
    "dayOpen" (the other bound, reported as a sensitivity) only to the stop day's 00:00 settlement."""
    pb, days = env.perp[p], env.days[p]
    p0 = pb[entry][1]
    pf = p0 * (1 - hs)
    q = STAKE / pf
    level = (1 + R.H5_STOP) * p0          # H5_STOP and H6_STOP are both 0.50
    how, px_raw, fund_end, last_held = None, None, None, None
    for t in range(entry, planned_exit, DAY):
        if t not in pb:
            if days[-1] < t:
                last = days[bisect.bisect_left(days, t) - 1]
                how, px_raw, fund_end, last_held = "ended", pb[last][4], last + DAY - 1, last
                break
            continue
        if pb[t][2] >= level:
            how, px_raw, last_held = "stop", max(level, pb[t][1]), t
            fund_end = t + DAY - 1 if stop_funding == "dayEnd" else t
            break
    if how is None:
        if planned_exit in pb:
            how, px_raw, fund_end, last_held = "planned", pb[planned_exit][1], planned_exit, planned_exit - DAY
        else:
            last = days[bisect.bisect_left(days, planned_exit) - 1]
            how, px_raw, fund_end, last_held = "ended", pb[last][4], last + DAY - 1, last
    px = px_raw * (1 + hs)
    f = env.F(p)
    held = f.held_between(entry, fund_end) if f is not None else []
    funding = sum(q * env.open_or_last(p, b // DAY * DAY) * rate for b, rate in held)
    fees = q * pf * fee + q * px * fee
    pnl = q * (pf - px) - fees + funding
    return {"perp": p, "entry": entry, "how": how, "lastHeldDay": last_held, "pnl": pnl, "funding": funding,
            "price": q * (p0 - px_raw), "costs": fees + q * p0 * hs + q * px_raw * hs,
            "settlements": len(held)}


def event_stats(rows: list[dict], key_day: str, peak_capital: float) -> dict:
    tot = sum(x["pnl"] for x in rows)
    first = sum(x["pnl"] for x in rows if x[key_day] < HALF)
    second = sum(x["pnl"] for x in rows if x[key_day] >= HALF)
    by_month = defaultdict(float)
    for x in rows:
        by_month[iso(x[key_day])[:7]] += x["pnl"]
    best = max(by_month.items(), key=lambda kv: (kv[1], kv[0]))
    return {"total": tot, "first": first, "second": second, "byMonth": dict(sorted(by_month.items())), "best": best,
            "annualisedOnPeak": ann(tot, peak_capital, WINDOW_DAYS)}


def peak_open(rows: list[dict]) -> int:
    on = Counter()
    for x in rows:
        for t in range(x["entry"], x["lastHeldDay"] + DAY, DAY):
            on[t] += 1
    return max(on.values()) if on else 0


def score(d, which: str) -> dict:
    meas = json.loads((HERE / "measurements.json").read_text())
    env = Env(d)
    tables = SC.book_tables(d)
    hs = tables["perpP90"]
    if (round(hs * 1e4, 2), tables["perpN"]) != (3.56, 525):
        raise SystemExit("the events' half-spread is not the prereg's 3.56 bp over 525 perpetuals: stop")
    perps = {p for p in d["perp"] if p.endswith("USDT")}
    if which == "h5":
        if M.h5(d) != meas["h5"]:
            raise SystemExit("measure.py's h5 no longer gives measurements.json's h5: stop")
        ev = []
        for e in R.delist_events(d["ann"]["texts"], WIN_FROM, WIN_END):
            p = R.perp_for_token(e["token"], perps)
            day = e["published"] // DAY * DAY
            entry, exit_day = R.delist_entry_exit(e)
            if p is not None and day in env.perp[p] and entry in env.perp[p]:
                ev.append({"perp": p, "token": e["token"], "announced": e["published"], "entry": entry, "exit": exit_day})
        if len(ev) != meas["h5"]["withPerpAliveAtEntry"]:
            raise SystemExit("the scorer's events are not phase 1's: stop")
        peak_capital = meas["h5"]["peakConcurrentEvents"] * STAKE
        key_day = "announced"
        seed = "fp6-delist-short"
        named = defaultdict(list)          # perp -> announcement times naming its token (every parsed title)
        for e in R.delist_events(d["ann"]["texts"], 0, 10 ** 15):
            p = R.perp_for_token(e["token"], perps)
            if p is not None:
                named[p].append(e["published"])
    else:
        if M.h6(d) != meas["h6"]:
            raise SystemExit("measure.py's h6 no longer gives measurements.json's h6: stop")
        first = {p: int(rows[0][0]) for p, rows in d["perp"].items() if rows}
        ev = [{"perp": e["perp"], "listed": e["listed"], "entry": e["entry"], "exit": e["entry"] + R.H6_HOLD_DAYS * DAY}
              for e in R.listing_events(first, env.crypto, WIN_FROM, M.ms(2026, 8, 25))]
        if len(ev) != meas["h6"]["events"]:
            raise SystemExit("the scorer's events are not phase 1's: stop")
        peak_capital = meas["h6"]["peakConcurrentEvents"] * STAKE
        key_day = "entry"
        seed = "fp6-listing-short"
        named = {}
    ev.sort(key=lambda x: (x["entry"], x["perp"]))
    rule, dbl = [], []
    for e in ev:
        a = short(env, e["perp"], e["entry"], e["exit"], hs, FEE)
        rule.append(a | {k: e[k] for k in e if k not in a})
    rule_fallbacks = dict(env.fallbacks)
    for e in ev:
        b = short(env, e["perp"], e["entry"], e["exit"], 2 * hs, 2 * FEE)
        dbl.append(b | {k: e[k] for k in e if k not in b})
    # the null: a donor per event, uniformly with replacement from the eligible perpetuals, over the event's days
    donors_usdt = sorted(p for p in env.crypto if p.endswith("USDT"))
    names = []
    for e in ev:
        cs = []
        for p in donors_usdt:
            b = env.perp[p]
            if env.first[p] > e["entry"] - (R.H5_DONOR_MIN_AGE_DAYS * DAY) or e["entry"] not in b or e["exit"] not in b:
                continue
            if which == "h5" and any(abs(t - e["entry"]) <= R.H5_DONOR_EXCLUSION_DAYS * DAY for t in named.get(p, ())):
                continue
            cs.append(p)
        if not cs:
            raise SystemExit(f"no donor for {e['perp']} {iso(e['entry'])}")
        names.append(cs)

    def donor_pnls(reading: str, traded_only: bool) -> list[list[float]]:
        out_ = []
        for e, cs in zip(ev, names):
            if traded_only:
                cs = [p for p in cs if env.perp[p][e["entry"]][5] > 0 and env.perp[p][e["exit"]][5] > 0]
            out_.append([short(env, p, e["entry"], e["exit"], hs, FEE, reading)["pnl"] for p in cs])
        return out_

    def draw(c_: list[list[float]]) -> list[float]:
        rng_ = random.Random(seed)
        return [sum(c[rng_.randrange(len(c))] for c in c_) for _ in range(2000)]

    cand = donor_pnls("dayEnd", False)
    nulls = draw(cand)
    st = event_stats(rule, key_day, peak_capital)
    st2 = event_stats(dbl, key_day, peak_capital)
    ge = sum(1 for v in nulls if v >= st["total"])
    p = (1 + ge) / 2001
    best_m, best_v = st["best"]
    tot = st["total"]
    min_events = 30 if which == "h5" else 100
    conds = {
        "c1_sum_positive": {"value": r(tot, 4), "holds": tot > 0},
        "c2_null": {"p": r(p, 6), "nullMeanUsd": r(statistics.fmean(nulls), 4),
                    "nullP05Usd": r(sorted(nulls)[int(0.05 * (len(nulls) - 1))], 4),
                    "nullP95Usd": r(sorted(nulls)[int(0.95 * (len(nulls) - 1))], 4), "holmStep": "applied by holm.py"},
        "c3_each_half_positive": {"first": r(st["first"], 4), "second": r(st["second"], 4),
                                  "firstEvents": sum(1 for x in rule if x[key_day] < HALF),
                                  "secondEvents": sum(1 for x in rule if x[key_day] >= HALF),
                                  "holds": st["first"] > 0 and st["second"] > 0},
        "c4_positive_costs_doubled": {"value": r(st2["total"], 4), "holds": st2["total"] > 0},
        "c5_best_month_le_40pct_rest_positive": {"bestMonth": best_m, "bestMonthPnl": r(best_v, 4),
                                                 "bestShare": r(best_v / tot, 4) if tot > 0 else None,
                                                 "restPnl": r(tot - best_v, 4),
                                                 "holds": tot > 0 and best_v <= 0.4 * tot and tot - best_v > 0},
        "c6_worth_money_ge_8pct_on_peak_capital": {"peakCapitalUsd": peak_capital, "value": r(st["annualisedOnPeak"], 6),
                                                   "holds": st["annualisedOnPeak"] >= SC.LINE},
        "c7_enough_events": {"events": len(rule), "min": min_events, "holds": len(rule) >= min_events},
    }
    how = Counter(x["how"] for x in rule)
    out = {
        "hypothesis": "fp6-H5 DELIST-S" if which == "h5" else "fp6-H6 LIST-S",
        "conditions": conds, "pNull": r(p, 6),
        "passesOtherThanHolm": all(v["holds"] for k, v in conds.items() if k != "c2_null"),
        "halfSpreadBp": r(hs * 1e4, 4),
        "split": {"priceUsd": r(sum(x["price"] for x in rule), 4), "fundingUsd": r(sum(x["funding"] for x in rule), 4),
                  "costsUsd": r(sum(x["costs"] for x in rule), 4)},
        "exits": dict(sorted(how.items())),
        "peakOpenOnTheHoldsTaken": peak_open(rule),
        "pnlByMonth": {k: r(v, 4) for k, v in st["byMonth"].items()},
        "byYear": {y: {"events": sum(1 for x in rule if iso(x[key_day])[:4] == y),
                       "pnlUsd": r(sum(x["pnl"] for x in rule if iso(x[key_day])[:4] == y), 4)}
                   for y in sorted({iso(x[key_day])[:4] for x in rule})},
        "donorsPerEvent": {"min": min(len(c) for c in cand), "median": statistics.median(len(c) for c in cand),
                           "max": max(len(c) for c in cand)},
        "fallbackPrices": rule_fallbacks,
        "events": [{"perp": x["perp"], "entry": iso(x["entry"]), "how": x["how"], "lastHeldDay": iso(x["lastHeldDay"]),
                    "pnl": r(x["pnl"], 4), "funding": r(x["funding"], 4)}
                   | ({"announced": iso(x["announced"]), "token": x["token"]} if which == "h5" else {})
                   for x in rule],
    }
    if which == "h6":
        desc = {}
        for hold in (7, 14):
            rows = [short(env, e["perp"], e["entry"], e["entry"] + hold * DAY, hs, FEE) for e in ev]
            desc[f"hold{hold}Days"] = {"pnlUsd": r(sum(x["pnl"] for x in rows), 4),
                                       "positive": sum(1 for x in rows if x["pnl"] > 0)}
        out["descriptive"] = desc | {"fundingPaidUsd": r(sum(min(0.0, x["funding"]) for x in rule), 4),
                                     "fundingReceivedUsd": r(sum(max(0.0, x["funding"]) for x in rule), 4)}
    else:
        out["descriptive"] = {"fundingPaidUsd": r(sum(min(0.0, x["funding"]) for x in rule), 4),
                              "fundingReceivedUsd": r(sum(max(0.0, x["funding"]) for x in rule), 4)}
    # sensitivities to the readings the prereg left open (descriptive: they never decide)
    def summary(rows, nulls_):
        st_ = event_stats(rows, key_day, peak_capital)
        bm, bv = st_["best"]
        t_ = st_["total"]
        p_ = (1 + sum(1 for v in nulls_ if v >= t_)) / 2001
        return {"totalUsd": r(t_, 4), "firstUsd": r(st_["first"], 4), "secondUsd": r(st_["second"], 4),
                "bestMonth": bm, "bestShare": r(bv / t_, 4) if t_ > 0 else None,
                "annualisedOnPeak": r(st_["annualisedOnPeak"], 6), "pNull": r(p_, 6),
                "c1": t_ > 0, "c3": st_["first"] > 0 and st_["second"] > 0,
                "c5": t_ > 0 and bv <= 0.4 * t_ and t_ - bv > 0, "c6": st_["annualisedOnPeak"] >= SC.LINE}

    rule_open = [short(env, e["perp"], e["entry"], e["exit"], hs, FEE, "dayOpen") | {k: e[k] for k in e} for e in ev]
    out["sensitivities"] = {
        "stopFundingOnlyToTheStopDaysOpen": summary(rule_open, draw(donor_pnls("dayOpen", False))),
        "donorsThatTradedOnTheEntryAndExitDays": summary(rule, draw(donor_pnls("dayEnd", True))),
        "eventsWhosePerpetualHadNoVolumeOnTheEntryDay": [iso(x["entry"]) + " " + x["perp"] for x in rule
                                                         if env.perp[x["perp"]][x["entry"]][5] == 0],
    }
    out["countsRecomputed"] = {"events": len(rule), "equalPhase1": True}
    return out


def main(argv: list[str]) -> int:
    which = argv[0] if argv else ""
    if which not in ("h5", "h6"):
        raise SystemExit("usage: score_events.py h5|h6")
    frozen = check_frozen(which)
    d = M.load()
    d["books"] = V.read_gz(IN / "books.json.gz")
    res = score(d, which)
    res["frozenFiles"] = frozen
    name = "delist_short.json" if which == "h5" else "listing_short.json"
    (HERE / name).write_text(json.dumps(res, indent=1, sort_keys=True, ensure_ascii=False) + "\n")
    c = res["conditions"]
    print(name, json.dumps({k: {kk: vv for kk, vv in v.items() if kk in ("value", "holds", "p", "first", "second", "bestShare", "events")}
                            for k, v in c.items()}, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
