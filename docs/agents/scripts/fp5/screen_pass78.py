#!/usr/bin/env python3
"""Score eight print-level mechanisms on UK Revolut X trades.

A fill is a public trade print. An hourly close is not a fill. rxpar is not
recomputed. Maker fee is 0 on both legs. The 9 bp taker schedule is not
applied to a resting fill.
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
SUMMARY = ROOT / "docs/agents/backtests/fp5/summary_pass78.json"
RULES = ROOT / "docs/agents/scripts/fp5"
FROZEN = RULES / "pass78.frozen_at"
META = TAPE / "thresholds.json"

# Filled after the rule texts are written and before the score run.
RULE_SHA = {
    "rxbounce": "824a01e5bd4bfc7873b4b5ba767a2fde849500ba3a96b28c483059a58faf40ec",
    "rxadverse": "bc350ecd524267c5f8a72b6561e94fa7030f4f49b69ebf84f7cc1ceb29818517",
    "rximpact": "bbf8a1c5892bcd977caca9b7841c20df7977b67f5ca22373e02b0e55f49fa8cf",
    "rxround": "c9f56c571a960653764c4fc8ee31378139dd4753eaad281f3e419ca2b5d6d1ff",
    "rxgap": "be4d7979fbc9daad1d22d6d762d8f2e6f8eab97deb8e54dcdded034a026e0604",
    "rxlag": "46dc308d36ea2bdfa1c0288210c39a806098ab913e68ea27b4f98cbc8046361e",
    "rxmonday": "fe5adbd564c3423e30ea8143ca18cd6e2133dabd082d67ceb773caab4c17b092",
    "rxquiet": "60b6cecad959baf91a288b7e1e1d61bf4b2e99df4d6af6028f545efe44dcec04",
}
FROZEN_AT = "2026-09-25 22:40:17 UTC"
MAKER_BPS = Decimal(0)
GAP = Decimal("0.001")  # 10 bp
LEAD = Decimal("0.0001")  # 1 bp
BOOKS = ("BTC-USD", "XRP-USD")
LAG_BOOKS = ("ETH-USD", "SOL-USD")
LEADER = "BTC-USD"


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


def load_prints(name: str, start: int, end: int) -> list[tuple[int, Decimal, Decimal, str]]:
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


def walk(prints, entries: set[int]):
    """Non-overlapping maker buys. Exit is the next aggressor buy. A leftover is marked."""
    held = None
    out = []
    for index, print_ in enumerate(prints):
        if held is None:
            if index in entries:
                held = print_
            continue
        if print_[3] == "buy":
            out.append((held, print_, "exit"))
            held = None
    if held is not None:
        out.append((held, prints[-1], "mark"))
    return out


def bps(entry, exit_) -> Decimal:
    return (exit_[1] / entry[1] - 1) * Decimal(10000)


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
        # A leader buy strictly before this sell, still inside the window.
        look = cursor
        while look < len(ups) and ups[look] < ts:
            if ts - ups[look] <= window_ms:
                found.add(index)
                break
            look += 1
    return found


def population(prints):
    """Every sell, non-overlapping, exit on the next buy. The filter-off book."""
    return walk(prints, {i for i, row in enumerate(prints) if row[3] == "sell"})


def summarise(trips) -> tuple[Decimal, int, int, int]:
    total = Decimal(0)
    exits = 0
    marks = 0
    for entry, exit_, kind in trips:
        total += bps(entry, exit_)
        if kind == "exit":
            exits += 1
        else:
            marks += 1
    return total, len(trips), exits, marks


def month_share(book_trips: dict[str, list], pool: Decimal):
    if pool <= 0:
        return None, None
    months: dict[str, Decimal] = {}
    for trips in book_trips.values():
        for entry, exit_, _kind in trips:
            key = month_key(entry[0])
            months[key] = months.get(key, Decimal(0)) + bps(entry, exit_) / Decimal(2)
    if not months:
        return None, None
    key, pnl = max(months.items(), key=lambda kv: kv[1])
    return pnl / pool, key


def null_p95(left: list[Decimal], right: list[Decimal], n: int) -> Decimal:
    if int(Decimal("0.95") * 500) - 1 != 474:
        raise SystemExit("null index moved")
    if n <= 0:
        return Decimal(0)
    if n > len(left) or n > len(right):
        raise SystemExit("null sample longer than the window")
    rng = random.Random(20260925)
    pools = []
    for _ in range(500):
        a = rng.sample(left, n)
        b = rng.sample(right, n)
        pools.append((sum(a, Decimal(0)) + sum(b, Decimal(0))) / Decimal(2))
    pools.sort()
    return pools[474]


def reasons_for(pool, stress, n, left, right, p95, share) -> list[str]:
    reasons = []
    if not pool > 0:
        reasons.append("pooled P&L is not positive")
    if not stress > 0:
        reasons.append("doubled maker fee is not positive")
    if n < 60:
        reasons.append("lesser trip count is under 60")
    if not left > 0 or not right > 0:
        reasons.append("one book is not positive")
    if not pool > p95:
        reasons.append("pooled P&L does not beat the null p95")
    if share is None or share > Decimal("0.40"):
        reasons.append("one month is more than 40% of pooled P&L")
    if not pool > 400:
        reasons.append("pooled P&L does not exceed 400 bps")
    return reasons


def score_pair(name, trips_by_book, pops_by_book, why: str) -> dict:
    names = list(trips_by_book)
    sums = {}
    counts = {}
    detail = {}
    for book, trips in trips_by_book.items():
        total, n, exits, marks = summarise(trips)
        sums[book] = total
        counts[book] = n
        detail[book] = {"trips": n, "exits": exits, "marks": marks, "bps": fnum(total)}
    pool = (sums[names[0]] + sums[names[1]]) / Decimal(2)
    n = min(counts.values())
    stress = pool - (MAKER_BPS + MAKER_BPS) * Decimal(n)
    share, month = month_share(trips_by_book, pool)
    left_moves = [bps(a, b) for a, b, _k in pops_by_book[names[0]]]
    right_moves = [bps(a, b) for a, b, _k in pops_by_book[names[1]]]
    p95 = null_p95(left_moves, right_moves, n)
    edge = (sum(left_moves, Decimal(0)) + sum(right_moves, Decimal(0))) / Decimal(2)
    return {
        "rule": name,
        "rule_sha256": RULE_SHA[name],
        "books": list(names),
        "maker_fee_bps": 0,
        "trips": n,
        "pool_bps": fnum(pool),
        "stress_bps": fnum(stress),
        "null_p95_bps": fnum(p95),
        "edge_off_bps": fnum(edge),
        "month": month,
        "month_share": None if share is None else fnum(share),
        "books_detail": detail,
        "reasons": reasons_for(pool, stress, n, sums[names[0]], sums[names[1]], p95, share),
        "why": why,
        "reached_preregistration": False,
        "testing_row": False,
    }


def self_check() -> None:
    prints = [
        (1, Decimal("100"), Decimal("1"), "buy"),
        (2, Decimal("100"), Decimal("1"), "sell"),
        (3, Decimal("99"), Decimal("5"), "sell"),
        (4, Decimal("102"), Decimal("1"), "buy"),
    ]
    bounce = walk(prints, sell_entries(prints, lambda rows, i: prev_side(rows, i, "buy")))
    if len(bounce) != 1 or bounce[0][2] != "exit":
        raise SystemExit("bounce fixture")
    if bps(bounce[0][0], bounce[0][1]) != Decimal("200"):
        raise SystemExit("bounce bps %s" % bps(bounce[0][0], bounce[0][1]))
    adverse = walk(prints, sell_entries(prints, lambda rows, i: prev_side(rows, i, "sell")))
    # The second sell is 99, the next buy is 102.
    hand = (Decimal("102") / Decimal("99") - 1) * Decimal(10000)
    if len(adverse) != 1 or bps(adverse[0][0], adverse[0][1]) != hand:
        raise SystemExit("adverse fixture %s" % adverse)
    marked = [
        (1, Decimal("100"), Decimal("1"), "buy"),
        (2, Decimal("100"), Decimal("1"), "sell"),
        (3, Decimal("90"), Decimal("1"), "sell"),
    ]
    leftover = walk(marked, sell_entries(marked, lambda rows, i: prev_side(rows, i, "buy")))
    if len(leftover) != 1 or leftover[0][2] != "mark":
        raise SystemExit("mark missing")
    if bps(leftover[0][0], leftover[0][1]) != Decimal("-1000"):
        raise SystemExit("mark bps")
    if is_round(Decimal("100"), Decimal("1")) and not is_round(Decimal("100.5"), Decimal("1")):
        pass
    else:
        raise SystemExit("round")
    gap_rows = [
        (1, Decimal("100"), Decimal("1"), "buy"),
        (2, Decimal("98"), Decimal("1"), "sell"),
    ]
    entered = sell_entries(
        gap_rows,
        lambda rows, i: i > 0 and rows[i][1] <= rows[i - 1][1] * (1 - GAP),
    )
    if entered != {1}:
        raise SystemExit("gap")
    quiet_rows = [
        (0, Decimal("100"), Decimal("1"), "buy"),
        (5_000, Decimal("100"), Decimal("1"), "sell"),
        (5_100, Decimal("100"), Decimal("1"), "sell"),
    ]
    quiet = sell_entries(
        quiet_rows, lambda rows, i: i > 0 and rows[i][0] - rows[i - 1][0] >= 1000
    )
    if quiet != {1}:
        raise SystemExit("quiet")
    # 2026-09-21 00:00:30 UTC is a Monday. 2026-09-22 is a Tuesday.
    monday_ms = int(datetime(2026, 9, 21, 0, 0, 30, tzinfo=timezone.utc).timestamp() * 1000)
    tuesday_ms = monday_ms + 86400000
    if datetime.fromtimestamp(monday_ms / 1000, timezone.utc).weekday() != 0:
        raise SystemExit("monday")
    clock = [
        (monday_ms, Decimal("10"), Decimal("1"), "sell"),
        (tuesday_ms, Decimal("10"), Decimal("1"), "sell"),
    ]
    mondays = sell_entries(
        clock,
        lambda rows, i: datetime.fromtimestamp(rows[i][0] / 1000, timezone.utc).weekday() == 0,
    )
    if mondays != {0}:
        raise SystemExit("monday filter")
    leader = [
        (10, Decimal("100"), Decimal("1"), "buy"),
        (20, Decimal("101"), Decimal("1"), "buy"),
    ]
    follower = [
        (25, Decimal("50"), Decimal("1"), "sell"),
        (40, Decimal("51"), Decimal("1"), "buy"),
    ]
    # 101 > 100 * 1.0001, so the second buy leads. The sell at 25 is inside 60 ms.
    found = lag_entries(follower, leader, 60)
    if found != {0}:
        raise SystemExit("lag %s" % found)
    trips = walk(follower, found)
    if len(trips) != 1 or bps(trips[0][0], trips[0][1]) != Decimal("200"):
        raise SystemExit("lag bps")


def predicate_counts(prints, entries: set[int]) -> str:
    sells = sum(1 for row in prints if row[3] == "sell")
    buys = sum(1 for row in prints if row[3] == "buy")
    return "prints %d, sells %d, buys %d, predicate %d" % (len(prints), sells, buys, len(entries))


def score() -> dict:
    self_check()
    for name, digest in RULE_SHA.items():
        if sha256(RULES / f"pass78_{name}_rule.txt") != digest:
            raise SystemExit("rule hash moved %s" % name)
    if FROZEN.read_text().strip() != FROZEN_AT:
        raise SystemExit("frozen_at moved")
    meta = json.loads(META.read_text())
    score_start = int(meta["score_start"])
    score_end = int(meta["score_end"])
    tapes = {}
    for name in ("BTC-USD", "ETH-USD", "SOL-USD", "XRP-USD"):
        tapes[name] = load_prints(name, score_start, score_end)
        if not tapes[name]:
            raise SystemExit("empty %s" % name)
    # Thresholds are recomputed from the threshold-day files, not from the score.
    threshold = {}
    for name in BOOKS:
        rows = load_prints_named(
            name + "_threshold", int(meta["threshold_start"]), int(meta["threshold_end"])
        )
        sells = [row[2] for row in rows if row[3] == "sell"]
        gaps = [rows[i][0] - rows[i - 1][0] for i in range(1, len(rows))]
        threshold[name] = {
            "impact_qty": nearest_rank(sells, Decimal("0.95")),
            "quiet_ms": nearest_rank(gaps, Decimal("0.95")),
        }
        if Decimal(meta["impact_qty"][name]) != threshold[name]["impact_qty"]:
            raise SystemExit("impact moved %s" % name)
        if int(meta["quiet_ms"][name]) != threshold[name]["quiet_ms"]:
            raise SystemExit("quiet moved %s" % name)
    for name in LAG_BOOKS:
        rows = load_prints_named(
            name + "_threshold", int(meta["threshold_start"]), int(meta["threshold_end"])
        )
        gaps = [rows[i][0] - rows[i - 1][0] for i in range(1, len(rows))]
        median = lower_median(gaps)
        window = min(60000, max(1000, median))
        if int(meta["lag_w_ms"][name]) != window:
            raise SystemExit("lag window moved %s" % name)
    units = {name: Decimal(meta["round_unit"][name]) for name in BOOKS}
    btc, xrp = tapes["BTC-USD"], tapes["XRP-USD"]
    eth, sol = tapes["ETH-USD"], tapes["SOL-USD"]
    leader = tapes[LEADER]
    specs = build_specs(btc, xrp, eth, sol, leader, meta, units)
    scored = []
    for spec in specs:
        why_parts = []
        trips_by = {}
        pops_by = {}
        for book in spec["books"]:
            tape = tapes[book]
            entries = spec["entries"][book]
            trips_by[book] = walk(tape, entries)
            pops_by[book] = population(tape)
            _total, n, exits, marks = summarise(trips_by[book])
            why_parts.append(
                "%s %s; entries %d, exits %d, marks %d"
                % (book, predicate_counts(tape, entries), n, exits, marks)
            )
        if spec["name"] == "rxlag":
            why_parts.append(spec["extra"])
        row = score_pair(spec["name"], trips_by, pops_by, " ".join(why_parts))
        row["source"] = spec["source"]
        scored.append(row)
    return {
        "frozen_at": FROZEN_AT,
        "maker_fee_bps": 0,
        "taker_fee_not_applied_bps": "0.09",
        "fee_page_archive": "https://web.archive.org/web/20250813002900/https://www.revolut.com/legal/crypto-exchange-fees/",
        "fill": "public trade print, region UK",
        "reached_preregistration": False,
        "testing_row": False,
        "rules_scored": len(scored),
        "rxpar_rescored": False,
        "rules": scored,
        "tape_sha256": {
            name: sha256(TAPE / f"{name}.json")
            for name in ("BTC-USD", "ETH-USD", "SOL-USD", "XRP-USD")
        },
        "threshold_sha256": {
            name: sha256(TAPE / f"{name}_threshold.json")
            for name in ("BTC-USD", "ETH-USD", "SOL-USD", "XRP-USD")
        },
        "continuity_sha256": sha256(TAPE / "continuity.json"),
        "density_sha256": sha256(TAPE / "density.json"),
        "prior_day_sha256": {
            name: sha256(TAPE / f"{name}_20250917.json")
            for name in ("BTC-USD", "ETH-USD", "SOL-USD", "XRP-USD")
        },
    }


def load_prints_named(stem: str, start: int, end: int):
    payload = json.loads((TAPE / f"{stem}.json").read_text())
    if payload["region"] != "UK":
        raise SystemExit("region")
    if int(payload["start"]) != start or int(payload["end"]) != end:
        raise SystemExit("threshold window %s" % stem)
    rows = []
    for row in payload["rows"]:
        rows.append((int(row["timestamp"]), Decimal(row["price"]), Decimal(row["quantity"]), row["side"]))
    return rows


def build_specs(btc, xrp, eth, sol, leader, meta, units):
    impact = {book: Decimal(meta["impact_qty"][book]) for book in BOOKS}
    quiet = {book: int(meta["quiet_ms"][book]) for book in BOOKS}
    windows = {book: int(meta["lag_w_ms"][book]) for book in LAG_BOOKS}
    single = {"BTC-USD": btc, "XRP-USD": xrp}

    def entries_for(pred):
        return {book: sell_entries(tape, pred) for book, tape in single.items()}

    lag = {
        "ETH-USD": lag_entries(eth, leader, windows["ETH-USD"]),
        "SOL-USD": lag_entries(sol, leader, windows["SOL-USD"]),
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
            "source": "https://arxiv.org/abs/2608.21888 ; https://hftradingbook.com/strategies/intraday-mean-reversion",
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
            "source": "https://doi.org/10.1016/j.frl.2024.105429",
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
        print(row["rule"], row["trips"], row["pool_bps"], row["reasons"])


if __name__ == "__main__":
    main()
