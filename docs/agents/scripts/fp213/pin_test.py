from __future__ import annotations

"""Pins for the fp213 rule. No file and no return from 2023 is read."""

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


def test_opposite_funding_changes_pick_the_fall() -> None:
    if c.IDEA != "FCH" or c.MIN_N != 30:
        raise SystemExit("the idea moved")
    signal = c.fp5.SCREEN_START_MS - c.fp5.DAY_MS
    yday = signal - c.fp5.DAY_MS
    entry = c.fp5.SCREEN_START_MS
    later = entry + c.fp5.DAY_MS
    um_rate = {yday: 0.01, signal: 0.00, entry: 0.02}
    cm_rate = {yday: 0.01, signal: 0.02, entry: 0.05}
    um_fill = {entry: (100.0, 80.0), later: (10.0, 12.0)}
    cm_fill = {entry: (50.0, 40.0), later: (20.0, 16.0)}
    trades = c.signal_trades(um_rate, cm_rate, um_fill, cm_fill)
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
    if abs(trades[0]["net"] - float(long_leg)) <= 1e-12:
        raise SystemExit("the short leg was dropped")
    if abs(trades[0]["net"] - float(short_leg)) <= 1e-12:
        raise SystemExit("the long leg was dropped")
    if abs(trades[0]["pnl"] - 100.0 * trades[0]["net"]) > 1e-9:
        raise SystemExit("the dollar result is not a hundred dollars on each leg")
    swapped = c.signal_trades(
        {yday: 0.01, signal: 0.02, entry: 0.04},
        {yday: 0.01, signal: 0.00, entry: 0.01},
        um_fill, cm_fill,
    )
    swapped_net = _long(Decimal(50), Decimal(40)) + _short(Decimal(100), Decimal(80))
    if len(swapped) != 1 or abs(swapped[0]["net"] - float(swapped_net)) > 1e-12:
        raise SystemExit("swapped changes did not swap the legs")
    if c.signal_trades({yday: 0.01, signal: 0.02}, {yday: 0.01, signal: 0.02}, um_fill, cm_fill):
        raise SystemExit("an equal change fired")
    if c.signal_trades({yday: 0.01, signal: 0.02}, {yday: 0.01, signal: 0.03}, um_fill, cm_fill):
        raise SystemExit("two rises fired")
    if c.signal_trades({yday: 0.01, signal: 0.01}, {yday: 0.01, signal: 0.03}, um_fill, cm_fill):
        raise SystemExit("a zero change fired")
    late = c.fp5.SCREEN_END_MS - c.fp5.DAY_MS
    prev = late - c.fp5.DAY_MS
    if c.signal_trades(
        {prev: 0.01, late: 0.00},
        {prev: 0.01, late: 0.03},
        {c.fp5.SCREEN_END_MS: (100.0, 80.0)},
        {c.fp5.SCREEN_END_MS: (50.0, 40.0)},
    ):
        raise SystemExit("a 2024 open was an entry")
    pool = c.pool_nets(um_rate, cm_rate, um_fill, cm_fill)
    if len(pool) != 2 or abs(pool[0] - float(want)) > 1e-12:
        raise SystemExit("the null is not every unequal change")
    if abs(pool[0] - float(long_leg)) <= 1e-12:
        raise SystemExit("the null dropped the short leg")


def main() -> None:
    test_opposite_funding_changes_pick_the_fall()
    print("fp213 pins ok")


if __name__ == "__main__":
    main()
