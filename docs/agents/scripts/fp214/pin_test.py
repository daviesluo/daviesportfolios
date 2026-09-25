from __future__ import annotations

"""Pins for the fp214 rule. No file and no return from 2023 is read."""

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


def test_opposite_residuals_pick_the_laggard() -> None:
    if c.IDEA != "MRK" or c.MIN_N != 30:
        raise SystemExit("the idea moved")
    signal = c.fp5.SCREEN_START_MS - c.fp5.DAY_MS
    entry = c.fp5.SCREEN_START_MS
    later = entry + c.fp5.DAY_MS
    after = later + c.fp5.DAY_MS
    mark = {signal: (100.0, 100.0), entry: (100.0, 100.0)}
    spot_sig = {signal: (100.0, 90.0), entry: (100.0, 120.0)}
    um_sig = {signal: (100.0, 110.0), entry: (100.0, 110.0)}
    spot_px = {entry: (80.0,), later: (100.0,), after: (90.0,)}
    um_px = {entry: (50.0,), later: (40.0,), after: (30.0,)}
    trades = c.signal_trades(spot_sig, um_sig, mark, spot_px, um_px)
    if len(trades) != 1 or trades[0]["entry_ms"] != entry or trades[0]["exit_ms"] != later:
        raise SystemExit("the next close-to-close spread did not fill")
    long_leg = _long(Decimal(80), Decimal(100))
    short_leg = _short(Decimal(50), Decimal(40))
    want = long_leg + short_leg
    gross = (100.0 / 80.0 - 1.0) + (50.0 / 40.0 - 1.0)
    if abs(trades[0]["net"] - float(want)) > 1e-12:
        raise SystemExit("the two-leg fill moved")
    if abs(trades[0]["gross"] - gross) > 1e-12:
        raise SystemExit("the gross is not the two legs")
    if abs(trades[0]["gross"] - (90.0 / 100.0 - 1.0)) < 1e-9:
        raise SystemExit("the gross is the signal-day ratio")
    if abs(trades[0]["net"] - float(long_leg)) <= 1e-12:
        raise SystemExit("the short leg was dropped")
    if abs(trades[0]["net"] - float(short_leg)) <= 1e-12:
        raise SystemExit("the long leg was dropped")
    if abs(trades[0]["pnl"] - 100.0 * trades[0]["net"]) > 1e-9:
        raise SystemExit("the dollar result is not a hundred dollars on each leg")
    swapped = c.signal_trades(
        {signal: (100.0, 110.0), entry: (100.0, 120.0)},
        {signal: (100.0, 90.0), entry: (100.0, 110.0)},
        mark, spot_px, um_px,
    )
    swapped_net = _long(Decimal(50), Decimal(40)) + _short(Decimal(80), Decimal(100))
    if len(swapped) != 1 or abs(swapped[0]["net"] - float(swapped_net)) > 1e-12:
        raise SystemExit("swapped residuals did not swap the legs")
    if c.signal_trades(
        {signal: (100.0, 100.0)}, {signal: (100.0, 110.0)}, {signal: (100.0, 100.0)},
        spot_px, um_px,
    ):
        raise SystemExit("a zero residual fired")
    if c.signal_trades(
        {signal: (100.0, 120.0)}, {signal: (100.0, 110.0)}, {signal: (100.0, 100.0)},
        spot_px, um_px,
    ):
        raise SystemExit("two positive residuals fired")
    late = c.fp5.SCREEN_END_MS - c.fp5.DAY_MS
    if c.signal_trades(
        {late: (100.0, 90.0)}, {late: (100.0, 110.0)}, {late: (100.0, 100.0)},
        {c.fp5.SCREEN_END_MS: (80.0,)}, {c.fp5.SCREEN_END_MS: (50.0,)},
    ):
        raise SystemExit("a 2024 open was an entry")
    pool = c.pool_nets(spot_sig, um_sig, mark, spot_px, um_px)
    if len(pool) != 2 or abs(pool[0] - float(want)) > 1e-12:
        raise SystemExit("the null is not every differing residual")
    if abs(pool[0] - float(long_leg)) <= 1e-12:
        raise SystemExit("the null dropped the short leg")


def main() -> None:
    test_opposite_residuals_pick_the_laggard()
    print("fp214 pins ok")


if __name__ == "__main__":
    main()
