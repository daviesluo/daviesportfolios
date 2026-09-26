#!/usr/bin/env python3
"""Score eight queue or exit rules. None is a filter on the one-tick-under queue.

Pass 79 posted one quote step under a chosen sell and then swapped the
signal. That filter is not reused. Each rule below changes the join price,
the cancel, the exit, or which print posts the bid. The signal print is
not a fill. Stress is one quote step against the entry print and one quote
step against the exit print.
"""

from __future__ import annotations

import hashlib
import json
import random
import sys
from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path

import screen_pass79 as pass79

ROOT = Path(__file__).resolve().parents[4]
TAPE = ROOT / "docs/agents/backtests/inputs/fp5_2026-09-25/pass78"
SUMMARY = ROOT / "docs/agents/backtests/fp5/summary_pass80.json"
PRIOR = ROOT / "docs/agents/backtests/fp5/summary_pass79.json"
RULES = ROOT / "docs/agents/scripts/fp5"
FROZEN = RULES / "pass80.frozen_at"
META = TAPE / "thresholds.json"

RULE_SHA = {
    "rxat": "98d811ebd330955c1c570ae687678ef40ecd94bd934849dbd3a294bcd405e9da",
    "rxprev": "d21dd5cfdfb836cbfa26978804696d5870785ac02f08fba7ec30364a0d2248da",
    "rxfloor": "316610f8c2051882ae86b50a20fd222cdc0dffd1a97a930f1b65688829cdaefa",
    "rxstay": "4a5e857900fc350933858d60ea0ffda0907c5ee645a0bdff7978bbe910d2d4e4",
    "rxclock": "eb19186b8796ba70d0cc60922aee8c65bbafbb44a2d1bffb05ec69e9a5b14247",
    "rxtwo": "abc2ae731c2f56e94855ddd10f9969868535452b2cc867a2f2915324ea22bce6",
    "rxnext": "fe091ade61b7cd6bfe42421a8c799a70cc0bf4639d54d13f63b4c9a0e23740cd",
    "rxpost": "0cd7c0d38d614202e81993d6b2c5e3f5d5a57015b58618c40da585ba3294dc8f",
}
FROZEN_AT = "2026-09-26 00:07:26 UTC"
BOOKS = ("BTC-USD", "XRP-USD")
STEPS = {
    "BTC-USD": Decimal("0.01"),
    "XRP-USD": Decimal("0.0001"),
}
# name, trigger, bid mode, cancel on a buy, exit mode, time-cancel
SPECS = (
    ("rxat", "sell", "at", True, "plus1", False),
    ("rxprev", "sell", "prev_minus1", True, "plus1", False),
    ("rxfloor", "sell", "floor", True, "plus1", False),
    ("rxstay", "sell", "minus1", False, "plus1", False),
    ("rxclock", "sell", "minus1", True, "plus1", True),
    ("rxtwo", "sell", "minus1", True, "plus2", False),
    ("rxnext", "sell", "minus1", True, "next", False),
    ("rxpost", "buy", "minus1", True, "plus1", False),
)
# Pass 79's every-sell queue. It is the comparison, not a ninth rule.
BASELINE = ("sell", "minus1", True, "plus1")


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def month_key(ms: int) -> str:
    stamp = datetime.fromtimestamp(ms / 1000, timezone.utc)
    return f"{stamp.year:04d}-{stamp.month:02d}"


def fnum(value: Decimal) -> float:
    return float(format(value, ".10f"))


def load_prints(name: str, start: int, end: int):
    payload = json.loads((TAPE / f"{name}.json").read_text())
    if payload["symbol"] != name or payload["region"] != "UK":
        raise SystemExit("tape %s" % name)
    if int(payload["start"]) != start or int(payload["end"]) != end:
        raise SystemExit("window %s" % name)
    rows = []
    last = -1
    for row in payload["rows"]:
        side = row["side"]
        if side not in ("buy", "sell"):
            raise SystemExit("side %s" % side)
        ts = int(row["timestamp"])
        if ts < last:
            raise SystemExit("unsorted %s" % name)
        last = ts
        rows.append((ts, Decimal(row["price"]), Decimal(row["quantity"]), side))
    return rows


def make_bid(mode: str, price: Decimal, prev: Decimal | None, step: Decimal, unit: Decimal):
    if mode == "at":
        return price
    if mode == "minus1":
        return price - step
    if mode == "prev_minus1":
        if prev is None:
            return None
        return prev - step
    if mode == "floor":
        floored = (price // unit) * unit
        if floored >= price:
            floored -= unit
        return floored
    raise SystemExit("bid mode %s" % mode)


def walk(prints, step: Decimal, unit: Decimal, time_ms, trigger: str, bid_mode: str, cancel_on_buy: bool, exit_mode: str):
    """One resting bid. The print that posts it is not a fill.

    time_ms cancels a working bid when a later print is strictly further
    than that many milliseconds from the post, and that print does not fill.
    """
    if step <= 0 or unit <= 0:
        raise SystemExit("step")
    if trigger not in ("buy", "sell") or exit_mode not in ("plus1", "plus2", "next"):
        raise SystemExit("spec")
    trips = []
    counts = {
        "triggers": sum(1 for row in prints if row[3] == trigger),
        "acted": 0,
        "fills": 0,
        "cancels": 0,
        "time_cancels": 0,
        "exits": 0,
        "marks": 0,
        "left_working": 0,
    }
    state = "flat"
    bid = None
    ask = None
    entry = None
    posted_at = None
    prev = None
    for print_ in prints:
        ts, price, _qty, side = print_
        if state == "flat" and side == trigger:
            new_bid = make_bid(bid_mode, price, prev, step, unit)
            prev = price
            if new_bid is not None and new_bid > 0:
                state = "working"
                bid = new_bid
                posted_at = ts
                counts["acted"] += 1
            continue
        if state == "working":
            if time_ms is not None and ts - posted_at > time_ms:
                state = "flat"
                bid = None
                posted_at = None
                counts["time_cancels"] += 1
                prev = price
                continue
            if side == "sell" and price <= bid:
                state = "long"
                entry = print_
                if exit_mode == "plus1":
                    ask = price + step
                elif exit_mode == "plus2":
                    ask = price + step + step
                else:
                    ask = None
                counts["fills"] += 1
                prev = price
                continue
            if side == "buy" and cancel_on_buy:
                state = "flat"
                bid = None
                posted_at = None
                counts["cancels"] += 1
            prev = price
            continue
        if state == "long" and side == "buy" and (exit_mode == "next" or price >= ask):
            trips.append((entry, print_, "exit"))
            counts["exits"] += 1
            state = "flat"
            entry = None
            ask = None
        prev = price
    if state == "long":
        trips.append((entry, prints[-1], "mark"))
        counts["marks"] += 1
    elif state == "working":
        counts["left_working"] += 1
    return trips, counts


def bps(entry_price: Decimal, exit_price: Decimal) -> Decimal:
    return (exit_price / entry_price - 1) * Decimal(10000)


def stress_bps(entry_price: Decimal, exit_price: Decimal, step: Decimal) -> Decimal:
    buy = entry_price + step
    sell = exit_price - step
    if buy <= 0 or sell <= 0:
        raise SystemExit("stress price")
    return (sell / buy - 1) * Decimal(10000)


def summarise(trips, step: Decimal):
    total = Decimal(0)
    stressed = Decimal(0)
    exits = 0
    marks = 0
    for entry, exit_, kind in trips:
        total += bps(entry[1], exit_[1])
        stressed += stress_bps(entry[1], exit_[1], step)
        if kind == "exit":
            exits += 1
        else:
            marks += 1
    return total, stressed, len(trips), exits, marks


def month_share(book_trips: dict, pool: Decimal):
    if pool <= 0:
        return None, None
    months: dict[str, Decimal] = {}
    for trips in book_trips.values():
        for entry, _exit, _kind in trips:
            key = month_key(entry[0])
            months[key] = months.get(key, Decimal(0)) + bps(entry[1], _exit[1]) / Decimal(2)
    if not months:
        return None, None
    key, pnl = max(months.items(), key=lambda kv: kv[1])
    return pnl / pool, key


def null_p95(left: list[Decimal], right: list[Decimal], n: int):
    if int(Decimal("0.95") * 500) - 1 != 474:
        raise SystemExit("null index moved")
    if n <= 0:
        return Decimal(0), True
    if n > len(left) or n > len(right):
        return None, False
    rng = random.Random(20260925)
    pools = []
    for _ in range(500):
        a = rng.sample(left, n)
        b = rng.sample(right, n)
        pools.append((sum(a, Decimal(0)) + sum(b, Decimal(0))) / Decimal(2))
    pools.sort()
    return pools[474], True


def reasons_for(pool, stress, n, left, right, p95, share, null_ok: bool) -> list[str]:
    reasons = []
    if not pool > 0:
        reasons.append("pooled P&L is not positive")
    if not stress > 0:
        reasons.append("one quote step against each fill is not positive")
    if n < 60:
        reasons.append("lesser trip count is under 60")
    if not left > 0 or not right > 0:
        reasons.append("one book is not positive")
    if not null_ok or p95 is None or not pool > p95:
        reasons.append("pooled P&L does not beat the null p95")
    if share is None or share > Decimal("0.40"):
        reasons.append("one month is more than 40% of pooled P&L")
    if not pool > 400:
        reasons.append("pooled P&L does not exceed 400 bps")
    return reasons


def same_trips(left, right) -> bool:
    if len(left) != len(right):
        return False
    for a, b in zip(left, right):
        if a[0][1] != b[0][1] or a[1][1] != b[1][1] or a[2] != b[2]:
            return False
    return True


def self_check() -> None:
    step = Decimal(1)
    unit = Decimal(1)
    keys = []
    for spec in SPECS:
        keys.append(spec[1:])
    if len(keys) != 8 or len(set(keys)) != 8:
        raise SystemExit("specs collapsed")
    if ("sell", "minus1", True, "plus1", False) in keys:
        raise SystemExit("baseline queue was scored as a rule")
    same = [
        (1, Decimal("100"), Decimal("1"), "sell"),
        (2, Decimal("100"), Decimal("1"), "sell"),
        (3, Decimal("101"), Decimal("1"), "buy"),
    ]
    base, _ = walk(same, step, unit, None, *BASELINE)
    at, at_counts = walk(same, step, unit, None, "sell", "at", True, "plus1")
    if base or len(at) != 1 or at[0][0][1] != Decimal("100") or at[0][1][1] != Decimal("101"):
        raise SystemExit("at-price queue matched one tick under %s %s" % (base, at))
    if at_counts["fills"] != 1:
        raise SystemExit("at fill")
    prior, _ = pass79.queue_walk(same, {0, 1, 2}, step)
    if not same_trips(base, prior):
        raise SystemExit("baseline walk drifted from pass 79")
    prev_tape = [
        (1, Decimal("100"), Decimal("1"), "buy"),
        (2, Decimal("90"), Decimal("1"), "sell"),
        (3, Decimal("99"), Decimal("1"), "sell"),
        (4, Decimal("100"), Decimal("1"), "buy"),
    ]
    prev, _ = walk(prev_tape, step, unit, None, "sell", "prev_minus1", True, "plus1")
    under, _ = walk(prev_tape, step, unit, None, *BASELINE)
    if under or len(prev) != 1 or prev[0][0][1] != Decimal("99"):
        raise SystemExit("previous-price queue %s %s" % (prev, under))
    floored_tape = [
        (1, Decimal("100.4"), Decimal("1"), "sell"),
        (2, Decimal("100"), Decimal("1"), "sell"),
        (3, Decimal("101"), Decimal("1"), "buy"),
    ]
    floored, _ = walk(floored_tape, step, unit, None, "sell", "floor", True, "plus1")
    if len(floored) != 1 or floored[0][0][1] != Decimal("100"):
        raise SystemExit("floor queue %s" % floored)
    exact = [
        (1, Decimal("100"), Decimal("1"), "sell"),
        (2, Decimal("100"), Decimal("1"), "sell"),
    ]
    exact_trips, exact_counts = walk(exact, step, unit, None, "sell", "floor", True, "plus1")
    if exact_trips or exact_counts["fills"] != 0 or exact_counts["left_working"] != 1:
        raise SystemExit("round print filled itself")
    stay_tape = [
        (1, Decimal("100"), Decimal("1"), "sell"),
        (2, Decimal("101"), Decimal("1"), "buy"),
        (3, Decimal("99"), Decimal("1"), "sell"),
        (4, Decimal("100"), Decimal("1"), "buy"),
    ]
    stay, _ = walk(stay_tape, step, unit, None, "sell", "minus1", False, "plus1")
    cancelled, _ = walk(stay_tape, step, unit, None, *BASELINE)
    if cancelled or len(stay) != 1 or stay[0][0][1] != Decimal("99"):
        raise SystemExit("stay %s %s" % (stay, cancelled))
    two_tape = [
        (1, Decimal("100"), Decimal("1"), "sell"),
        (2, Decimal("99"), Decimal("1"), "sell"),
        (3, Decimal("100"), Decimal("1"), "buy"),
        (4, Decimal("102"), Decimal("1"), "buy"),
    ]
    two, _ = walk(two_tape, step, unit, None, "sell", "minus1", True, "plus2")
    one, _ = walk(two_tape, step, unit, None, *BASELINE)
    if len(two) != 1 or two[0][1][1] != Decimal("102"):
        raise SystemExit("two-step exit %s" % two)
    if len(one) != 1 or one[0][1][1] != Decimal("100"):
        raise SystemExit("baseline exit moved %s" % one)
    nxt_tape = [
        (1, Decimal("100"), Decimal("1"), "sell"),
        (2, Decimal("99"), Decimal("1"), "sell"),
        (3, Decimal("98"), Decimal("1"), "buy"),
        (4, Decimal("101"), Decimal("1"), "buy"),
    ]
    nxt, _ = walk(nxt_tape, step, unit, None, "sell", "minus1", True, "next")
    held, _ = walk(nxt_tape, step, unit, None, *BASELINE)
    if len(nxt) != 1 or nxt[0][1][1] != Decimal("98") or held[0][1][1] != Decimal("101"):
        raise SystemExit("next exit %s %s" % (nxt, held))
    late = [
        (0, Decimal("100"), Decimal("1"), "sell"),
        (1000, Decimal("99"), Decimal("1"), "sell"),
    ]
    late_trips, late_counts = walk(late, step, unit, 500, "sell", "minus1", True, "plus1")
    if late_trips or late_counts["time_cancels"] != 1 or late_counts["fills"] != 0:
        raise SystemExit("clock %s %s" % (late_trips, late_counts))
    clocked = [
        (0, Decimal("100"), Decimal("1"), "sell"),
        (400, Decimal("99"), Decimal("1"), "sell"),
        (800, Decimal("100"), Decimal("1"), "buy"),
    ]
    clock_trips, _ = walk(clocked, step, unit, 500, "sell", "minus1", True, "plus1")
    if len(clock_trips) != 1 or clock_trips[0][0][1] != Decimal("99"):
        raise SystemExit("clock fill")
    posted = [
        (1, Decimal("100"), Decimal("1"), "sell"),
        (2, Decimal("101"), Decimal("1"), "buy"),
        (3, Decimal("100"), Decimal("1"), "sell"),
        (4, Decimal("102"), Decimal("1"), "buy"),
    ]
    post, post_counts = walk(posted, step, unit, None, "buy", "minus1", True, "plus1")
    if len(post) != 1 or post[0][0][1] != Decimal("100") or post_counts["acted"] != 1:
        raise SystemExit("post after buy %s %s" % (post, post_counts))
    if stress_bps(Decimal("99"), Decimal("100"), step) != Decimal("-100"):
        raise SystemExit("stress")
    marked = [
        (1, Decimal("100"), Decimal("1"), "sell"),
        (2, Decimal("99"), Decimal("1"), "sell"),
    ]
    mark_trips, _ = walk(marked, step, unit, None, "sell", "minus1", True, "plus1")
    if len(mark_trips) != 1 or mark_trips[0][2] != "mark" or bps(mark_trips[0][0][1], mark_trips[0][1][1]) != 0:
        raise SystemExit("mark")
    if not stress_bps(mark_trips[0][0][1], mark_trips[0][1][1], step) < 0:
        raise SystemExit("mark stress")


def why_for(book: str, prints, counts: dict) -> str:
    sells = sum(1 for row in prints if row[3] == "sell")
    buys = sum(1 for row in prints if row[3] == "buy")
    return (
        "%s prints %d, sells %d, buys %d, triggers %d, acted %d, fills %d, "
        "cancels %d, time_cancels %d, exits %d, marks %d, left_working %d"
        % (
            book,
            len(prints),
            sells,
            buys,
            counts["triggers"],
            counts["acted"],
            counts["fills"],
            counts["cancels"],
            counts["time_cancels"],
            counts["exits"],
            counts["marks"],
            counts["left_working"],
        )
    )


def score_one(name, trips_by_book, baseline: Decimal, steps) -> dict:
    names = list(trips_by_book)
    sums = {}
    stress_sums = {}
    counts = {}
    detail = {}
    for book, trips in trips_by_book.items():
        total, stressed, n, exits, marks = summarise(trips, steps[book])
        sums[book] = total
        stress_sums[book] = stressed
        counts[book] = n
        detail[book] = {
            "trips": n,
            "exits": exits,
            "marks": marks,
            "bps": fnum(total),
            "stress_bps": fnum(stressed),
        }
    pool = (sums[names[0]] + sums[names[1]]) / Decimal(2)
    stress = (stress_sums[names[0]] + stress_sums[names[1]]) / Decimal(2)
    n = min(counts.values())
    share, month = month_share(trips_by_book, pool)
    left_moves = [bps(a[1], b[1]) for a, b, _k in trips_by_book[names[0]]]
    right_moves = [bps(a[1], b[1]) for a, b, _k in trips_by_book[names[1]]]
    p95, null_ok = null_p95(left_moves, right_moves, n)
    delta = pool - baseline
    if delta > 0:
        versus = "more"
    elif delta < 0:
        versus = "less"
    else:
        versus = "same"
    first = None
    for book in names:
        for entry, exit_, kind in trips_by_book[book]:
            row = {
                "book": book,
                "kind": kind,
                "entry_price": format(entry[1], "f"),
                "exit_price": format(exit_[1], "f"),
                "entry_ms": entry[0],
                "exit_ms": exit_[0],
                "base_bps": fnum(bps(entry[1], exit_[1])),
                "stress_bps": fnum(stress_bps(entry[1], exit_[1], steps[book])),
            }
            if first is None or entry[0] < first["entry_ms"]:
                first = row
    return {
        "rule": name,
        "rule_sha256": RULE_SHA[name],
        "books": list(names),
        "maker_fee_bps": 0,
        "stress": "entry print plus one quote step, exit print minus one quote step",
        "trips": n,
        "pool_bps": fnum(pool),
        "stress_bps": fnum(stress),
        "null_p95_bps": None if p95 is None else fnum(p95),
        "null_defined": null_ok,
        "every_sell_queue_bps": fnum(baseline),
        "versus_every_sell_queue": versus,
        "versus_every_sell_queue_bps": fnum(delta),
        "month": month,
        "month_share": None if share is None else fnum(share),
        "books_detail": detail,
        "first_trip": first,
        "reasons": reasons_for(pool, stress, n, sums[names[0]], sums[names[1]], p95, share, null_ok),
        "reached_preregistration": False,
        "testing_row": False,
    }


def queue_text(spec) -> str:
    _name, trigger, bid_mode, cancel_on_buy, exit_mode, use_time = spec
    posted = "every aggressor sell" if trigger == "sell" else "every aggressor buy"
    if bid_mode == "at":
        price = "the triggering print"
    elif bid_mode == "minus1":
        price = "the triggering print minus one quote step"
    elif bid_mode == "prev_minus1":
        price = "the previous print minus one quote step"
    elif bid_mode == "floor":
        price = "the round unit strictly below the triggering print"
    else:
        raise SystemExit("queue text")
    cancel = "a buy before the fill cancels the bid" if cancel_on_buy else "a buy does not cancel the bid"
    if use_time:
        cancel += "; a print strictly later than the book's quiet cutoff cancels the bid and does not fill"
    if exit_mode == "plus1":
        exit_ = "the first later buy at or above the fill plus one quote step"
    elif exit_mode == "plus2":
        exit_ = "the first later buy at or above the fill plus two quote steps"
    else:
        exit_ = "the next aggressor buy at that buy's price"
    return "%s posts a bid at %s; %s; exit is %s" % (posted, price, cancel, exit_)


def score() -> dict:
    self_check()
    for name, digest in RULE_SHA.items():
        if sha256(RULES / f"pass80_{name}_rule.txt") != digest:
            raise SystemExit("rule hash moved %s" % name)
    if FROZEN.read_text().strip() != FROZEN_AT:
        raise SystemExit("frozen_at moved")
    meta = json.loads(META.read_text())
    score_start = int(meta["score_start"])
    score_end = int(meta["score_end"])
    tapes = {}
    units = {}
    quiet = {}
    for name in BOOKS:
        tapes[name] = load_prints(name, score_start, score_end)
        if Decimal(meta["quote_step"][name]) != STEPS[name]:
            raise SystemExit("step moved %s" % name)
        units[name] = Decimal(meta["round_unit"][name])
        if units[name] != STEPS[name] * 100:
            raise SystemExit("unit moved %s" % name)
        quiet[name] = int(meta["quiet_ms"][name])
    if quiet["BTC-USD"] != 322180 or quiet["XRP-USD"] != 1072376:
        raise SystemExit("quiet moved")
    prior = json.loads(PRIOR.read_text())
    recorded = None
    for row in prior["rules"]:
        if row["rule"] == "rxbounce":
            recorded = format(Decimal(str(row["edge_off_bps"])), "f")
    if recorded != "1687.4610546575":
        raise SystemExit("recorded queue moved")
    baseline_sums = []
    for book in BOOKS:
        step = STEPS[book]
        mine, _counts = walk(tapes[book], step, units[book], None, *BASELINE)
        signals = {i for i, row in enumerate(tapes[book]) if row[3] == "sell"}
        theirs, _prior_counts = pass79.queue_walk(tapes[book], signals, step)
        if not same_trips(mine, theirs):
            raise SystemExit("baseline drift %s" % book)
        total, _stressed, _n, _exits, _marks = summarise(mine, step)
        baseline_sums.append(total)
    baseline = (baseline_sums[0] + baseline_sums[1]) / Decimal(2)
    if format(baseline, ".10f") != recorded:
        raise SystemExit("baseline pool %s" % format(baseline, ".10f"))
    scored = []
    for spec in SPECS:
        name, trigger, bid_mode, cancel_on_buy, exit_mode, use_time = spec
        trips_by = {}
        why_parts = [queue_text(spec)]
        for book in BOOKS:
            time_ms = quiet[book] if use_time else None
            trips, counts = walk(
                tapes[book], STEPS[book], units[book], time_ms, trigger, bid_mode, cancel_on_buy, exit_mode
            )
            trips_by[book] = trips
            why_parts.append(why_for(book, tapes[book], counts))
        row = score_one(name, trips_by, baseline, STEPS)
        row["queue_exit"] = queue_text(spec)
        row["why"] = " ".join(why_parts)
        scored.append(row)
    return {
        "frozen_at": FROZEN_AT,
        "maker_fee_bps": 0,
        "stress": "one quote step worse on the entry print and on the exit print",
        "every_sell_queue_bps": fnum(baseline),
        "every_sell_queue": "pass 79: every sell posts one quote step under itself; a later sell at or under that bid fills; a buy cancels; exit is one step above the fill",
        "pass79_filters_reused": False,
        "pass78_fill_reused": False,
        "rxpar_rescored": False,
        "reached_preregistration": False,
        "testing_row": False,
        "rules_scored": len(scored),
        "rules": scored,
    }


def main() -> None:
    if "--check" in sys.argv:
        got = json.dumps(score(), indent=2, sort_keys=True) + "\n"
        have = SUMMARY.read_text()
        if got != have:
            raise SystemExit("summary drifted")
        print("CHECK_OK")
        return
    payload = score()
    SUMMARY.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n")
    print("rules", payload["rules_scored"], "queue", payload["every_sell_queue_bps"])
    for row in payload["rules"]:
        print(
            row["rule"],
            row["trips"],
            row["pool_bps"],
            row["stress_bps"],
            row["versus_every_sell_queue"],
            row["versus_every_sell_queue_bps"],
            row["reasons"],
        )


if __name__ == "__main__":
    main()
