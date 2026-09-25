from __future__ import annotations

"""Pins for the fp218 rule. No file and no return from 2023 is read."""

import sys
from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import common as c


def _net(entry: Decimal, exit_px: Decimal) -> Decimal:
    fee = Decimal("0.001")
    return (exit_px * (1 - fee)) / (entry * (1 + fee)) - 1


def _toy(entry: int, hold: int, net: float) -> dict:
    return {
        "coin": "BTCUSDT",
        "entry_ms": entry,
        "exit_ms": entry + hold * c.fp5.DAY_MS,
        "gross": net,
        "net": net,
        "pnl": 100.0 * net,
    }


def test_the_first_week_is_held_to_the_next_month() -> None:
    if c.IDEA != "MTH" or c.MIN_N != 30 or c.HOLD_MIN != 22 or c.HOLD_MAX != 31:
        raise SystemExit("the idea moved")
    if hasattr(c, "POOL_MIN"):
        raise SystemExit("the seven-day floor is still the null")
    start = c.fp5.SCREEN_START_MS
    day3 = start + 2 * c.fp5.DAY_MS
    if datetime.fromtimestamp(day3 / 1000, timezone.utc).day != 3:
        raise SystemExit("the third of January moved")
    exit_ms = c._next_month(day3)
    if datetime.fromtimestamp(exit_ms / 1000, timezone.utc).day != 1:
        raise SystemExit("the exit is not the next month")
    hold = (exit_ms - day3) // c.fp5.DAY_MS
    if hold != 29:
        raise SystemExit("January the third is not a 29-day hold")
    day20 = start + 19 * c.fp5.DAY_MS
    day28 = start + 27 * c.fp5.DAY_MS
    peer = day20 + hold * c.fp5.DAY_MS
    short = day28 + 7 * c.fp5.DAY_MS
    if datetime.fromtimestamp(peer / 1000, timezone.utc).day != 18:
        raise SystemExit("the same-length peer moved")
    um = {
        day3: (100.0,),
        day20: (50.0,),
        day28: (70.0,),
        exit_ms: (90.0,),
        peer: (40.0,),
        short: (80.0,),
    }
    trades = c.signal_trades(um)
    if len(trades) != 1 or trades[0]["entry_ms"] != day3 or trades[0]["exit_ms"] != exit_ms:
        raise SystemExit("the first week did not hold to the next month")
    if (trades[0]["exit_ms"] - trades[0]["entry_ms"]) // c.fp5.DAY_MS != 29:
        raise SystemExit("the month hold moved")
    want = _net(Decimal(100), Decimal(90))
    if abs(trades[0]["net"] - float(want)) > 1e-12:
        raise SystemExit("the one-leg fill moved")
    if abs(trades[0]["gross"] - (90.0 / 100.0 - 1.0)) > 1e-12:
        raise SystemExit("the gross is not the one leg")
    spans = c.pool_spans(um)
    span_set = set(spans)
    if (day3, exit_ms) not in span_set or (day20, peer) not in span_set:
        raise SystemExit("a same-length day is missing from the null")
    if (day20, exit_ms) in span_set or (day28, short) in span_set or (day28, exit_ms) in span_set:
        raise SystemExit("a shorter hold is still in the null")
    lengths = {(exit_at - entry) // c.fp5.DAY_MS for entry, exit_at in spans}
    if lengths != {29}:
        raise SystemExit("the null used a length the rule did not")
    if spans != sorted(spans, key=lambda pair: ((pair[1] - pair[0]) // c.fp5.DAY_MS, pair[0])):
        raise SystemExit("the pool order moved")
    by_hold = c.pool_by_hold(um)
    if set(by_hold) != {29} or len(by_hold[29]) != 2:
        raise SystemExit("the length pool is not the same-length days")
    if c.signal_trades({c.fp5.SCREEN_END_MS: (100.0,)}):
        raise SystemExit("a 2024 open was an entry")


def test_the_draw_keeps_each_length() -> None:
    if c.fp5.p95_index(c.fp5.NULL_DRAWS) != 190 or c.fp5.NULL_SEED != 20250925:
        raise SystemExit("the null index moved")
    start = c.fp5.SCREEN_START_MS
    trades = [_toy(start + i * c.fp5.DAY_MS, 29, 0.02) for i in range(30)]
    quiet = {29: [0.01] * 40, 7: [9.0] * 40}
    loud = {29: [0.03] * 40}
    if c.matched_null_p95(trades, quiet) != c.matched_null_p95(trades, quiet):
        raise SystemExit("the same-length null moved between two calls")
    if c.matched_null_p95(trades, quiet) != 0.01:
        raise SystemExit("a length the rule did not use was drawn")
    row = c.screen_row(trades, quiet, "toy")
    if row["n"] != 30 or row["passes_screen"] is not True:
        raise SystemExit("a positive mean above its own length's null did not pass")
    if c.screen_row(trades, loud, "toy")["passes_screen"] is not False:
        raise SystemExit("a mean under its own length's null passed")
    tied = [_toy(start + i * c.fp5.DAY_MS, 29, 0.01) for i in range(30)]
    if c.screen_row(tied, quiet, "toy")["passes_screen"] is not False:
        raise SystemExit("a mean equal to the null passed")
    short = {29: [0.01] * 29}
    if c.matched_null_p95(trades, short) is not None:
        raise SystemExit("a short length pool still produced a cutoff")
    mixed = [
        _toy(start, 22, 0.02),
        _toy(start + c.fp5.DAY_MS, 31, 0.02),
    ]
    if c.matched_null_p95(mixed, {22: [], 31: [0.0, 0.0]}) is not None:
        raise SystemExit("a missing length still produced a cutoff")
    both = {22: [0.0, 0.0], 31: [0.0, 0.0]}
    if c.matched_null_p95(mixed, both) != 0.0:
        raise SystemExit("the two lengths were not both drawn")


def main() -> None:
    test_the_first_week_is_held_to_the_next_month()
    test_the_draw_keeps_each_length()
    print("fp218 pins ok")


if __name__ == "__main__":
    main()
