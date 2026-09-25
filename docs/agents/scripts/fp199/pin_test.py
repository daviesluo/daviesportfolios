from __future__ import annotations

"""Pins for the fp199 rule. No file and no return from 2023 is read."""

import sys
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import common as c


def _short(entry: Decimal, exit_px: Decimal) -> Decimal:
    fee = Decimal("0.001")
    return (entry * (1 - fee)) / (exit_px * (1 + fee)) - 1


def test_mark_outran() -> None:
    if c.IDEA != "MRKSH" or c.MIN_N != 30:
        raise SystemExit("the idea moved")
    signal = c.fp5.SCREEN_START_MS - c.fp5.DAY_MS
    entry = c.fp5.SCREEN_START_MS
    exit_ms = entry + c.fp5.DAY_MS
    um = {entry: (100.0,), exit_ms: (80.0,), exit_ms + c.fp5.DAY_MS: (60.0,)}
    mark = {signal: (10.0, 13.0)}
    index = {signal: (10.0, 11.0)}
    trades = c.signal_trades(um, mark, index)
    if len(trades) != 1 or trades[0]["entry_ms"] != entry or trades[0]["exit_ms"] != exit_ms:
        raise SystemExit("the next perpetual open was not sold")
    want = _short(Decimal(100), Decimal(80))
    if abs(trades[0]["net"] - float(want)) > 1e-12:
        raise SystemExit("the short fill moved")
    if abs(trades[0]["gross"] - (100.0 / 80.0 - 1.0)) > 1e-12:
        raise SystemExit("the gross is not the open-to-open short")
    if abs(trades[0]["gross"] - (13.0 / 11.0 - 1.0)) < 1e-12:
        raise SystemExit("the gross is the signal day")
    if c.signal_trades(um, {signal: (10.0, 11.0)}, index):
        raise SystemExit("an equal return fired")
    if c.signal_trades(um, {signal: (10.0, 10.5)}, index):
        raise SystemExit("a slower mark fired")
    last_signal = c.fp5.SCREEN_END_MS - 2 * c.fp5.DAY_MS
    held = c.signal_trades(
        {last_signal + c.fp5.DAY_MS: (100.0,), c.fp5.SCREEN_END_MS: (80.0,)},
        {last_signal: (10.0, 13.0)},
        {last_signal: (10.0, 11.0)},
    )
    if len(held) != 1 or held[0]["exit_ms"] != c.fp5.SCREEN_END_MS:
        raise SystemExit("the 2024 open was not kept as the cover")
    if held[0]["entry_ms"] >= c.fp5.SCREEN_END_MS:
        raise SystemExit("a 2024 open was an entry")
    if c.signal_trades(
        {c.fp5.SCREEN_END_MS: (100.0,)},
        {c.fp5.SCREEN_END_MS - c.fp5.DAY_MS: (10.0, 13.0)},
        {c.fp5.SCREEN_END_MS - c.fp5.DAY_MS: (10.0, 11.0)},
    ):
        raise SystemExit("a 2024 open was an entry")
    pool = c.pool_nets(um)
    if len(pool) != 2 or abs(pool[0] - float(want)) > 1e-12:
        raise SystemExit("the null is not every perpetual open-to-open short")


def main() -> None:
    test_mark_outran()
    print("fp199 pins ok")


if __name__ == "__main__":
    main()
