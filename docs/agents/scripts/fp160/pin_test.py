from __future__ import annotations

"""Pins for the fp160 rule. No file and no return from 2023 is read."""

import sys
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import common as c


def _bars(entry: int, exit_ms: int) -> dict[int, tuple]:
    out = {}
    day = entry
    while day <= exit_ms:
        out[day] = (100.0 if day == entry else 101.0,)
        day += c.fp5.DAY_MS
    return out


def test_cross_and_the_return() -> None:
    if c.IDEA != "TAKX" or c.MAX_HOLD != 5:
        raise SystemExit("the cap moved")
    prev = c.fp5.SCREEN_START_MS - 2 * c.fp5.DAY_MS
    cross = c.fp5.SCREEN_START_MS - c.fp5.DAY_MS
    entry = c.fp5.SCREEN_START_MS
    back = entry + c.fp5.DAY_MS
    exit_ms = entry + 2 * c.fp5.DAY_MS
    taker = {
        prev: (0.5,),
        cross: (1.2,),
        entry: (1.5,),
        back: (0.9,),
    }
    trades = c.signal_trades(taker, _bars(entry, exit_ms))
    if len(trades) != 1 or trades[0]["exit_ms"] != exit_ms:
        raise SystemExit("the exit was not the open after the ratio came back")
    fee = Decimal("0.001")
    want = (Decimal(101) * (1 - fee)) / (Decimal(100) * (1 + fee)) - 1
    if abs(trades[0]["net"] - float(want)) > 1e-12:
        raise SystemExit("the fill is not fp5's")
    if c.signal_trades({prev: (1.0,), cross: (1.0,)}, _bars(entry, exit_ms)):
        raise SystemExit("a ratio that stayed at one fired")
    if c.signal_trades({cross: (1.2,)}, _bars(entry, exit_ms)):
        raise SystemExit("a missing previous day was treated as under one")
    stayed = {prev: (0.5,), cross: (1.2,)}
    for k in range(5):
        stayed[entry + k * c.fp5.DAY_MS] = (2.0,)
    cap_exit = entry + 5 * c.fp5.DAY_MS
    capped = c.signal_trades(stayed, _bars(entry, cap_exit))
    if len(capped) != 1 or capped[0]["exit_ms"] != cap_exit:
        raise SystemExit("the five-day cap did not exit")
    if c.signal_trades(
        {c.fp5.SCREEN_END_MS - c.fp5.DAY_MS: (0.5,), c.fp5.SCREEN_END_MS: (1.2,)},
        {},
    ):
        raise SystemExit("a 2024 entry was kept")


def test_a_missing_print_drops_the_trade() -> None:
    prev = c.fp5.SCREEN_START_MS - 2 * c.fp5.DAY_MS
    cross = c.fp5.SCREEN_START_MS - c.fp5.DAY_MS
    entry = c.fp5.SCREEN_START_MS
    taker = {prev: (0.2,), cross: (1.4,)}
    if c.signal_trades(taker, _bars(entry, entry + 5 * c.fp5.DAY_MS)):
        raise SystemExit("a hold with no later ratio was invented")


def main() -> None:
    test_cross_and_the_return()
    test_a_missing_print_drops_the_trade()
    print("fp160 pins ok")


if __name__ == "__main__":
    main()
