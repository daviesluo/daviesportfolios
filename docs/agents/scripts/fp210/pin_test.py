from __future__ import annotations

"""Pins for the fp210 rule. No file and no return from 2023 is read."""

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


def test_wider_return_picks_the_lower_book() -> None:
    if c.IDEA != "UCR" or c.MIN_N != 30:
        raise SystemExit("the idea moved")
    signal = c.fp5.SCREEN_START_MS - c.fp5.DAY_MS
    yday = signal - c.fp5.DAY_MS
    entry = c.fp5.SCREEN_START_MS
    later = entry + c.fp5.DAY_MS
    # close/open is the score. Yesterday is flat. The signal gaps by 1. The entry day gaps by 0.2.
    um_sig = {yday: (100.0, 100.0), signal: (100.0, 100.0), entry: (100.0, 120.0)}
    cm_sig = {yday: (100.0, 100.0), signal: (100.0, 200.0), entry: (100.0, 100.0)}
    um_fill = {entry: (100.0, 80.0), later: (10.0, 12.0)}
    cm_fill = {entry: (50.0, 40.0), later: (20.0, 16.0)}
    trades = c.signal_trades(um_sig, cm_sig, um_fill, cm_fill)
    if len(trades) != 1 or trades[0]["entry_ms"] != entry or trades[0]["exit_ms"] != entry:
        raise SystemExit("the next session did not fill")
    long_leg = _long(Decimal(100), Decimal(80))
    short_leg = _short(Decimal(50), Decimal(40))
    want = long_leg + short_leg
    gross = (80.0 / 100.0 - 1.0) + (50.0 / 40.0 - 1.0)
    if abs(trades[0]["net"] - float(want)) > 1e-12:
        raise SystemExit("the two-leg fill moved")
    if abs(trades[0]["gross"] - gross) > 1e-12:
        raise SystemExit("the gross is not the two legs")
    if abs(trades[0]["gross"] - (200.0 / 100.0 - 1.0)) < 1e-9:
        raise SystemExit("the gross is the signal-day ratio")
    if abs(trades[0]["net"] - float(long_leg)) <= 1e-12:
        raise SystemExit("the short leg was dropped")
    if abs(trades[0]["net"] - float(short_leg)) <= 1e-12:
        raise SystemExit("the long leg was dropped")
    swapped = c.signal_trades(
        {yday: (100.0, 100.0), signal: (100.0, 200.0), entry: (100.0, 120.0)},
        {yday: (100.0, 100.0), signal: (100.0, 100.0), entry: (100.0, 100.0)},
        um_fill, cm_fill,
    )
    swapped_net = _long(Decimal(50), Decimal(40)) + _short(Decimal(100), Decimal(80))
    if len(swapped) != 1 or abs(swapped[0]["net"] - float(swapped_net)) > 1e-12:
        raise SystemExit("swapped returns did not swap the legs")
    flat = {yday: (100.0, 100.0), signal: (100.0, 110.0), entry: (100.0, 100.0)}
    if c.signal_trades(flat, flat, um_fill, cm_fill):
        raise SystemExit("an equal return fired")
    if c.signal_trades(
        {yday: (100.0, 100.0), signal: (100.0, 110.0), entry: (100.0, 100.0)},
        {yday: (100.0, 200.0), signal: (100.0, 150.0), entry: (100.0, 100.0)},
        um_fill, cm_fill,
    ):
        raise SystemExit("a narrower gap fired")
    late = c.fp5.SCREEN_END_MS - c.fp5.DAY_MS
    prev = late - c.fp5.DAY_MS
    if c.signal_trades(
        {prev: (100.0, 100.0), late: (100.0, 100.0)},
        {prev: (100.0, 100.0), late: (100.0, 180.0)},
        {c.fp5.SCREEN_END_MS: (100.0, 80.0)},
        {c.fp5.SCREEN_END_MS: (50.0, 40.0)},
    ):
        raise SystemExit("a 2024 open was an entry")
    pool = c.pool_nets(um_sig, cm_sig, um_fill, cm_fill)
    if len(pool) != 2 or abs(pool[0] - float(want)) > 1e-12:
        raise SystemExit("the null is not the wider spread")
    if abs(pool[0] - float(long_leg)) <= 1e-12:
        raise SystemExit("the null dropped the short leg")


def main() -> None:
    test_wider_return_picks_the_lower_book()
    print("fp210 pins ok")


if __name__ == "__main__":
    main()
