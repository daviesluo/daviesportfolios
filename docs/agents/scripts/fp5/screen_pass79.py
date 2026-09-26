#!/usr/bin/env python3
"""Score eight mechanisms with a queue. The signal print is not our fill.

Pass 78 treated every matching aggressor sell as our bid. A public print is
not this account's order. That fill is not reused. rxpar is not recomputed.
Maker fee stays 0. Stress is one quote step against the entry print and one
quote step against the exit print.
"""

from __future__ import annotations

import hashlib
import json
import random
import sys
from datetime import datetime, timezone
from decimal import Decimal, ROUND_CEILING
from pathlib import Path

ROOT = Path(__file__).resolve().parents[4]
TAPE = ROOT / "docs/agents/backtests/inputs/fp5_2026-09-25/pass78"
SUMMARY = ROOT / "docs/agents/backtests/fp5/summary_pass79.json"
RULES = ROOT / "docs/agents/scripts/fp5"
FROZEN = RULES / "pass79.frozen_at"
META = TAPE / "thresholds.json"

RULE_SHA = {
    "rxbounce": "0cc9f9ce559acaf300a8345d661eb2dbac4143949a73c8eead3b8a47eaa89fc1",
    "rxadverse": "e513edd57d7ee994ae96346e8156a1f884cdfcd95708e5bdc576b7f533cba027",
    "rximpact": "8c21dfc5ab2817a6223efa88f6801a64fa5f4e2ee8f9dc645bf5ff5b73d43c9c",
    "rxround": "83575d8f2acea4eb1f96b1ffd569fbff90437867202d6dd4f16a4729cdb764a4",
    "rxgap": "a7e2c3c7baaecf70f0956d7f067522bf519da4e331d4cf04334298ab5f42bc5c",
    "rxlag": "6d131a5dab3cd7271b7101671ff89c5f82158e4034f56ce9eba7d0f85c2a5937",
    "rxmonday": "4ec36944b527ca4374b1300babc68eb002a3b6e5af49143e3c713638f6b2b032",
    "rxquiet": "49897e6bfb938bc8499420674cda8271d4c3110a2cb0610355ce908bc6a50053",
}
FROZEN_AT = "2026-09-25 23:57:45 UTC"
GAP = Decimal("0.001")
LEAD = Decimal("0.0001")
BOOKS = ("BTC-USD", "XRP-USD")
LAG_BOOKS = ("ETH-USD", "SOL-USD")
LEADER = "BTC-USD"
STEPS = {
    "BTC-USD": Decimal("0.01"),
    "ETH-USD": Decimal("0.01"),
    "SOL-USD": Decimal("0.001"),
    "XRP-USD": Decimal("0.0001"),
}


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def month_key(ms: int) -> str:
    stamp = datetime.fromtimestamp(ms / 1000, timezone.utc)
    return f"{stamp.year:04d}-{stamp.month:02d}"


def fnum(value: Decimal) -> float:
    return float(format(value, ".10f"))


def nearest_rank(values: list, fraction: Decimal):
    if not values:
        raise SystemExit("empty percentile")
    ordered = sorted(values)
    rank = int((fraction * len(ordered)).to_integral_value(rounding=ROUND_CEILING)) - 1
    rank = max(0, min(rank, len(ordered) - 1))
    return ordered[rank]


def lower_median(values: list[int]) -> int:
    ordered = sorted(values)
    return ordered[(len(ordered) - 1) // 2]


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


def load_prints_named(stem: str, start: int, end: int):
    payload = json.loads((TAPE / f"{stem}.json").read_text())
    if payload["region"] != "UK":
        raise SystemExit("region")
    if int(payload["start"]) != start or int(payload["end"]) != end:
        raise SystemExit("threshold window %s" % stem)
    rows = []
    for row in payload["rows"]:
        rows.append(
            (int(row["timestamp"]), Decimal(row["price"]), Decimal(row["quantity"]), row["side"])
        )
    return rows


def queue_walk(prints, signals: set[int], step: Decimal):
    """Join after the signal. The signal print is not a fill.

    Bid is one quote step under the signal. A later sell at or under that bid
    fills us, unless a buy prints first and cancels the bid. The ask is one
    quote step above the fill. A later buy at or above that ask is the exit.
    A bid still working at the end is not a trip. A long with no exit is marked
    to the last print.
    """
    if step <= 0:
        raise SystemExit("step")
    trips = []
    counts = {
        "signals": len(signals),
        "acted": 0,
        "fills": 0,
        "cancels": 0,
        "exits": 0,
        "marks": 0,
        "left_working": 0,
    }
    state = "flat"
    bid = None
    ask = None
    entry = None
    for index, print_ in enumerate(prints):
        _ts, price, _qty, side = print_
        if state == "flat":
            if index in signals and side == "sell":
                state = "working"
                bid = price - step
                counts["acted"] += 1
            continue
        if state == "working":
            if side == "sell" and price <= bid:
                state = "long"
                entry = print_
                ask = price + step
                counts["fills"] += 1
                continue
            if side == "buy":
                state = "flat"
                bid = None
                counts["cancels"] += 1
            continue
        if side == "buy" and price >= ask:
            trips.append((entry, print_, "exit"))
            counts["exits"] += 1
            state = "flat"
            entry = None
            ask = None
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


def sell_entries(prints, pred) -> set[int]:
    found = set()
    for index, print_ in enumerate(prints):
        if print_[3] == "sell" and pred(prints, index):
            found.add(index)
    return found


def prev_side(prints, index, side: str) -> bool:
    if index == 0:
        return False
    return prints[index - 1][3] == side


def is_round(price: Decimal, unit: Decimal) -> bool:
    if unit <= 0:
        return False
    return price % unit == 0


def lag_entries(follower, leader, window_ms: int) -> set[int]:
    ups = []
    for index in range(1, len(leader)):
        ts, price, _qty, side = leader[index]
        prev = leader[index - 1][1]
        if side == "buy" and price > prev * (1 + LEAD):
            ups.append(ts)
    found = set()
    cursor = 0
    for index, print_ in enumerate(follower):
        if print_[3] != "sell":
            continue
        ts = print_[0]
        while cursor < len(ups) and ups[cursor] + window_ms < ts:
            cursor += 1
        look = cursor
        while look < len(ups) and ups[look] < ts:
            if ts - ups[look] <= window_ms:
                found.add(index)
                break
            look += 1
    return found


def population_signals(prints) -> set[int]:
    return {i for i, row in enumerate(prints) if row[3] == "sell"}


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
        for entry, exit_, _kind in trips:
            key = month_key(entry[0])
            months[key] = months.get(key, Decimal(0)) + bps(entry[1], exit_[1]) / Decimal(2)
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


def score_pair(name, trips_by_book, stress_by_book, pops_by_book, why: str, steps) -> dict:
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
    left_moves = [bps(a[1], b[1]) for a, b, _k in pops_by_book[names[0]]]
    right_moves = [bps(a[1], b[1]) for a, b, _k in pops_by_book[names[1]]]
    p95, null_ok = null_p95(left_moves, right_moves, n)
    if left_moves or right_moves:
        edge = (sum(left_moves, Decimal(0)) + sum(right_moves, Decimal(0))) / Decimal(2)
    else:
        edge = Decimal(0)
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
        "edge_off_bps": fnum(edge),
        "month": month,
        "month_share": None if share is None else fnum(share),
        "books_detail": detail,
        "first_trip": first,
        "reasons": reasons_for(
            pool, stress, n, sums[names[0]], sums[names[1]], p95, share, null_ok
        ),
        "why": why,
        "reached_preregistration": False,
        "testing_row": False,
    }


def self_check() -> None:
    step = Decimal(1)
    missed = [
        (1, Decimal("100"), Decimal("1"), "sell"),
        (2, Decimal("101"), Decimal("1"), "buy"),
    ]
    trips, counts = queue_walk(missed, {0}, step)
    if trips or counts["fills"] != 0 or counts["cancels"] != 1:
        raise SystemExit("signal print was taken %s %s" % (trips, counts))
    filled = [
        (1, Decimal("100"), Decimal("1"), "sell"),
        (2, Decimal("99"), Decimal("1"), "sell"),
        (3, Decimal("100"), Decimal("1"), "buy"),
    ]
    trips, counts = queue_walk(filled, {0}, step)
    if len(trips) != 1 or trips[0][2] != "exit" or trips[0][0][1] != Decimal("99"):
        raise SystemExit("queue fill %s" % trips)
    if bps(trips[0][0][1], trips[0][1][1]) != (Decimal("100") / Decimal("99") - 1) * Decimal(10000):
        raise SystemExit("base bps")
    if stress_bps(Decimal("99"), Decimal("100"), step) != Decimal("-100"):
        raise SystemExit("stress bps")
    above = [
        (1, Decimal("100"), Decimal("1"), "sell"),
        (2, Decimal("99.5"), Decimal("1"), "sell"),
        (3, Decimal("101"), Decimal("1"), "buy"),
    ]
    trips, counts = queue_walk(above, {0}, step)
    if trips or counts["fills"] != 0 or counts["cancels"] != 1:
        raise SystemExit("sell above the bid filled")
    same = [
        (1, Decimal("100"), Decimal("1"), "sell"),
        (2, Decimal("100"), Decimal("1"), "sell"),
        (3, Decimal("100"), Decimal("1"), "sell"),
    ]
    trips, counts = queue_walk(same, {0, 1, 2}, step)
    if trips or counts["fills"] != 0 or counts["left_working"] != 1:
        raise SystemExit("every sell was a fill")
    marked = [
        (1, Decimal("100"), Decimal("1"), "sell"),
        (2, Decimal("99"), Decimal("1"), "sell"),
    ]
    trips, counts = queue_walk(marked, {0}, step)
    if len(trips) != 1 or trips[0][2] != "mark" or bps(trips[0][0][1], trips[0][1][1]) != 0:
        raise SystemExit("mark")
    if not stress_bps(trips[0][0][1], trips[0][1][1], step) < 0:
        raise SystemExit("mark stress")
    if is_round(Decimal("100"), Decimal("1")) and not is_round(Decimal("100.5"), Decimal("1")):
        pass
    else:
        raise SystemExit("round")


def predicate_counts(prints, signals: set[int], counts: dict) -> str:
    sells = sum(1 for row in prints if row[3] == "sell")
    buys = sum(1 for row in prints if row[3] == "buy")
    return (
        "prints %d, sells %d, buys %d, signals %d, acted %d, fills %d, cancels %d, "
        "exits %d, marks %d, left_working %d"
        % (
            len(prints),
            sells,
            buys,
            len(signals),
            counts["acted"],
            counts["fills"],
            counts["cancels"],
            counts["exits"],
            counts["marks"],
            counts["left_working"],
        )
    )


def score() -> dict:
    self_check()
    for name, digest in RULE_SHA.items():
        if sha256(RULES / f"pass79_{name}_rule.txt") != digest:
            raise SystemExit("rule hash moved %s" % name)
    if FROZEN.read_text().strip() != FROZEN_AT:
        raise SystemExit("frozen_at moved")
    meta = json.loads(META.read_text())
    for name, step in STEPS.items():
        if Decimal(meta["quote_step"][name]) != step:
            raise SystemExit("step moved %s" % name)
    score_start = int(meta["score_start"])
    score_end = int(meta["score_end"])
    tapes = {}
    for name in ("BTC-USD", "ETH-USD", "SOL-USD", "XRP-USD"):
        tapes[name] = load_prints(name, score_start, score_end)
        if not tapes[name]:
            raise SystemExit("empty %s" % name)
    for name in BOOKS:
        rows = load_prints_named(
            name + "_threshold", int(meta["threshold_start"]), int(meta["threshold_end"])
        )
        sells = [row[2] for row in rows if row[3] == "sell"]
        gaps = [rows[i][0] - rows[i - 1][0] for i in range(1, len(rows))]
        if Decimal(meta["impact_qty"][name]) != nearest_rank(sells, Decimal("0.95")):
            raise SystemExit("impact moved %s" % name)
        if int(meta["quiet_ms"][name]) != nearest_rank(gaps, Decimal("0.95")):
            raise SystemExit("quiet moved %s" % name)
    for name in LAG_BOOKS:
        rows = load_prints_named(
            name + "_threshold", int(meta["threshold_start"]), int(meta["threshold_end"])
        )
        gaps = [rows[i][0] - rows[i - 1][0] for i in range(1, len(rows))]
        window = min(60000, max(1000, lower_median(gaps)))
        if int(meta["lag_w_ms"][name]) != window:
            raise SystemExit("lag window moved %s" % name)
    units = {name: Decimal(meta["round_unit"][name]) for name in BOOKS}
    specs = build_specs(tapes, meta, units)
    scored = []
    for spec in specs:
        why_parts = []
        trips_by = {}
        pops_by = {}
        for book in spec["books"]:
            tape = tapes[book]
            step = STEPS[book]
            signals = spec["entries"][book]
            trips, counts = queue_walk(tape, signals, step)
            trips_by[book] = trips
            pop_trips, _pop_counts = queue_walk(tape, population_signals(tape), step)
            pops_by[book] = pop_trips
            why_parts.append("%s %s" % (book, predicate_counts(tape, signals, counts)))
        if spec["name"] == "rxlag":
            why_parts.append(spec["extra"])
        row = score_pair(spec["name"], trips_by, None, pops_by, " ".join(why_parts), STEPS)
        row["source"] = spec["source"]
        scored.append(row)
    return {
        "frozen_at": FROZEN_AT,
        "maker_fee_bps": 0,
        "stress": "one quote step worse on the entry print and on the exit print",
        "queue": "signal print is not a fill; bid is one quote step under it; a later sell at or under that bid fills; a buy before that cancels",
        "fill": "later UK public trade print, after the queued order",
        "pass78_fill_reused": False,
        "rxpar_rescored": False,
        "reached_preregistration": False,
        "testing_row": False,
        "rules_scored": len(scored),
        "rules": scored,
        "tape_sha256": {
            name: sha256(TAPE / f"{name}.json")
            for name in ("BTC-USD", "ETH-USD", "SOL-USD", "XRP-USD")
        },
    }


def build_specs(tapes, meta, units):
    impact = {book: Decimal(meta["impact_qty"][book]) for book in BOOKS}
    quiet = {book: int(meta["quiet_ms"][book]) for book in BOOKS}
    windows = {book: int(meta["lag_w_ms"][book]) for book in LAG_BOOKS}
    single = {"BTC-USD": tapes["BTC-USD"], "XRP-USD": tapes["XRP-USD"]}

    def entries_for(pred):
        return {book: sell_entries(tape, pred) for book, tape in single.items()}

    lag = {
        "ETH-USD": lag_entries(tapes["ETH-USD"], tapes[LEADER], windows["ETH-USD"]),
        "SOL-USD": lag_entries(tapes["SOL-USD"], tapes[LEADER], windows["SOL-USD"]),
    }
    return [
        {
            "name": "rxbounce",
            "books": list(BOOKS),
            "entries": entries_for(lambda rows, i: prev_side(rows, i, "buy")),
            "source": "Roll 1984 Journal of Finance 39(4); https://hftradingbook.com/data/bid-ask-bounce",
        },
        {
            "name": "rxadverse",
            "books": list(BOOKS),
            "entries": entries_for(lambda rows, i: prev_side(rows, i, "sell")),
            "source": "https://papers.ssrn.com/sol3/papers.cfm?abstract_id=4175306",
        },
        {
            "name": "rximpact",
            "books": list(BOOKS),
            "entries": {
                book: sell_entries(tape, lambda rows, i, book=book: rows[i][2] >= impact[book])
                for book, tape in single.items()
            },
            "source": "https://arxiv.org/abs/2608.21888",
        },
        {
            "name": "rxround",
            "books": list(BOOKS),
            "entries": {
                book: sell_entries(tape, lambda rows, i, book=book: is_round(rows[i][1], units[book]))
                for book, tape in single.items()
            },
            "source": "https://doi.org/10.1016/j.econlet.2017.07.035",
        },
        {
            "name": "rxgap",
            "books": list(BOOKS),
            "entries": entries_for(
                lambda rows, i: i > 0 and rows[i][1] <= rows[i - 1][1] * (1 - GAP)
            ),
            "source": "https://hftradingbook.com/strategies/intraday-mean-reversion",
        },
        {
            "name": "rxlag",
            "books": list(LAG_BOOKS),
            "entries": lag,
            "extra": "leader BTC-USD up-buy of at least 1 bp; ETH window %d ms; SOL window %d ms"
            % (windows["ETH-USD"], windows["SOL-USD"]),
            "source": "https://www.sotofranco.dev/articles/posts/btc-eth-lead-lag",
        },
        {
            "name": "rxmonday",
            "books": list(BOOKS),
            "entries": entries_for(
                lambda rows, i: datetime.fromtimestamp(rows[i][0] / 1000, timezone.utc).weekday() == 0
            ),
            "source": "https://www.sciencedirect.com/science/article/pii/S1544612318304240",
        },
        {
            "name": "rxquiet",
            "books": list(BOOKS),
            "entries": {
                book: sell_entries(
                    tape,
                    lambda rows, i, book=book: i > 0 and rows[i][0] - rows[i - 1][0] >= quiet[book],
                )
                for book, tape in single.items()
            },
            "source": "https://learn.greeks.live/area/stale-price/",
        },
    ]


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
    print("rules", payload["rules_scored"])
    for row in payload["rules"]:
        print(row["rule"], row["trips"], row["pool_bps"], row["stress_bps"], row["reasons"])


if __name__ == "__main__":
    main()
