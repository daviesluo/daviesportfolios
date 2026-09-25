from __future__ import annotations

"""Pins for the fp203 rule. No file and no return from 2023 is read."""

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


def test_coin_above_index() -> None:
    if c.IDEA != "CMIDX" or c.MIN_N != 30:
        raise SystemExit("the idea moved")
    signal = c.fp5.SCREEN_START_MS - c.fp5.DAY_MS
    entry = c.fp5.SCREEN_START_MS
    later = entry + c.fp5.DAY_MS
    cm = {signal: (100.0, 120.0), entry: (100.0, 100.0), later: (100.0, 100.0)}
    index = {signal: (100.0, 110.0), entry: (100.0, 110.0), later: (100.0, 110.0)}
    um = {entry: (100.0, 80.0), later: (50.0, 40.0)}
    trades = c.signal_trades(cm, index, um)
    if len(trades) != 1 or trades[0]["entry_ms"] != entry or trades[0]["exit_ms"] != entry:
        raise SystemExit("the next session short did not fill")
    want = _short(Decimal(100), Decimal(80))
    if abs(trades[0]["net"] - float(want)) > 1e-12:
        raise SystemExit("the short fill moved")
    if abs(trades[0]["gross"] - (100.0 / 80.0 - 1.0)) > 1e-12:
        raise SystemExit("the gross is not the short")
    if abs(trades[0]["gross"] - (120.0 / 100.0 - 1.0)) < 1e-9:
        raise SystemExit("the gross is the signal-day ratio")
    if abs(trades[0]["net"] - float(_long(Decimal(100), Decimal(80)))) < 1e-9:
        raise SystemExit("the fill is an unconditional long")
    if c.signal_trades({signal: (100.0, 110.0)}, {signal: (100.0, 110.0)}, um):
        raise SystemExit("an equal return fired")
    if c.signal_trades({signal: (100.0, 105.0)}, {signal: (100.0, 120.0)}, um):
        raise SystemExit("a weaker coin return fired")
    late = c.fp5.SCREEN_END_MS - c.fp5.DAY_MS
    if c.signal_trades({late: (100.0, 120.0)}, {late: (100.0, 110.0)}, {c.fp5.SCREEN_END_MS: (100.0, 80.0)}):
        raise SystemExit("a 2024 open was an entry")
    pool = c.pool_nets(um)
    if len(pool) != 2 or abs(pool[0] - float(want)) > 1e-12:
        raise SystemExit("the null is not every session short")
    if abs(pool[0] - float(_long(Decimal(100), Decimal(80)))) < 1e-9:
        raise SystemExit("the null is an unconditional long")


def main() -> None:
    test_coin_above_index()
    print("fp203 pins ok")


if __name__ == "__main__":
    main()
