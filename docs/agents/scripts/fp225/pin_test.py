from __future__ import annotations

"""Pins for the fp225 rule. No file and no return from 2023 is read."""

import sys
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import common as c


def _net(entry: Decimal, exit_px: Decimal) -> Decimal:
    fee = Decimal("0.001")
    return (exit_px * (1 - fee)) / (entry * (1 + fee)) - 1


def test_the_front_is_held_ten_days_and_not_to_expiry() -> None:
    if c.IDEA != "QFAR" or c.MIN_N != 30 or c.HOLD_DAYS != 10:
        raise SystemExit("the idea moved")
    expiry, symbol = c.QUARTERS[0]
    day = c.fp5.DAY_MS
    books = {name: {} for _exp, name in c.QUARTERS}

    def add(entry, px, exit_px):
        books[symbol][entry] = (float(px),)
        books[symbol][entry + 10 * day] = (float(exit_px),)

    signal = expiry - 30 * day
    inside = expiry - 12 * day
    onto = expiry - 10 * day
    early = expiry - 36 * day
    near = expiry - 21 * day
    far = expiry - 35 * day
    add(signal, 100, 110)
    add(inside, 50, 80)
    add(onto, 40, 40)
    add(early, 70, 70)
    add(near, 60, 60)
    add(far, 90, 90)
    trades = c.signal_trades(books)
    entries = {trade["entry_ms"] for trade in trades}
    if entries != {signal, near, far}:
        raise SystemExit("the days-left window moved")
    held = trades[0]
    for trade in trades:
        if trade["entry_ms"] == signal:
            held = trade
    if held["exit_ms"] != signal + 10 * day or held["exit_ms"] >= expiry:
        raise SystemExit("the sale landed on expiry")
    if held["exit_ms"] - held["entry_ms"] == day:
        raise SystemExit("the hold is one day")
    want = _net(Decimal(100), Decimal(110))
    if abs(held["net"] - float(want)) > 1e-12:
        raise SystemExit("the one-leg fill moved")
    if abs(held["gross"] - (110.0 / 100.0 - 1.0)) > 1e-12:
        raise SystemExit("the gross is not the one leg")
    pool = {entry for entry, _exit in c.pool_spans(books)}
    if signal not in pool or inside not in pool or early not in pool or onto in pool:
        raise SystemExit("the null is not every ten-day hold that ends before expiry")
    if len(c.pool_nets(books)) <= len(trades):
        raise SystemExit("the null is not larger than the rule")
    after = c.QUARTERS[-1][0] + day
    if c.signal_trades({c.QUARTERS[-1][1]: {after: (100.0,), after + 10 * day: (100.0,)}}):
        raise SystemExit("a day with no listed front was an entry")


def main() -> None:
    test_the_front_is_held_ten_days_and_not_to_expiry()
    print("fp225 pins ok")


if __name__ == "__main__":
    main()
