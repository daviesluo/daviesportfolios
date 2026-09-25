from __future__ import annotations

"""Pins for the fp193 rule. No file and no return from 2023 is read."""

import sys
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import common as c


def _short(entry: Decimal, exit_px: Decimal) -> Decimal:
    fee = Decimal("0.001")
    return (entry * (1 - fee)) / (exit_px * (1 + fee)) - 1


def _long(entry: Decimal, exit_px: Decimal) -> Decimal:
    fee = Decimal("0.001")
    return (exit_px * (1 - fee)) / (entry * (1 + fee)) - 1


def test_ask_heavy() -> None:
    if c.IDEA != "ASKSH" or c.MIN_N != 30:
        raise SystemExit("the idea moved")
    signal = c.fp5.SCREEN_START_MS - c.fp5.DAY_MS
    entry = c.fp5.SCREEN_START_MS
    later = entry + c.fp5.DAY_MS
    bars = {entry: (100.0, 80.0), later: (50.0, 40.0)}
    book = {signal: (4.0, 5.0)}
    trades = c.signal_trades(bars, book)
    if len(trades) != 1 or trades[0]["entry_ms"] != entry or trades[0]["exit_ms"] != entry:
        raise SystemExit("the next session short did not fill")
    want = _short(Decimal(100), Decimal(80))
    if abs(trades[0]["net"] - float(want)) > 1e-12:
        raise SystemExit("the short fill moved")
    if abs(trades[0]["gross"] - (100.0 / 80.0 - 1.0)) > 1e-12:
        raise SystemExit("the gross is not the short")
    if abs(trades[0]["net"] - float(_long(Decimal(100), Decimal(80)))) < 1e-9:
        raise SystemExit("the fill is an unconditional long")
    if c.signal_trades(bars, {signal: (5.0, 5.0)}):
        raise SystemExit("an equal book fired")
    if c.signal_trades(bars, {signal: (6.0, 5.0)}):
        raise SystemExit("a bid-heavy book fired")
    late = {c.fp5.SCREEN_END_MS - c.fp5.DAY_MS: (4.0, 9.0)}
    if c.signal_trades({c.fp5.SCREEN_END_MS: (100.0, 80.0)}, late):
        raise SystemExit("a 2024 open was an entry")
    pool = c.pool_nets(bars)
    if len(pool) != 2 or abs(pool[0] - float(want)) > 1e-12:
        raise SystemExit("the null is not every session short")
    if abs(pool[0] - float(_long(Decimal(100), Decimal(80)))) < 1e-9:
        raise SystemExit("the null is an unconditional long")


def main() -> None:
    test_ask_heavy()
    print("fp193 pins ok")


if __name__ == "__main__":
    main()
