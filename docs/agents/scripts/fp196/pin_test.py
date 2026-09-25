from __future__ import annotations

"""Pins for the fp196 rule. No file and no return from 2023 is read."""

import sys
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import common as c


def _long(entry: Decimal, exit_px: Decimal) -> Decimal:
    fee = Decimal("0.001")
    return (exit_px * (1 - fee)) / (entry * (1 + fee)) - 1


def _short(entry: Decimal, exit_px: Decimal) -> Decimal:
    fee = Decimal("0.001")
    return (entry * (1 - fee)) / (exit_px * (1 + fee)) - 1


def test_cm_rich() -> None:
    if c.IDEA != "CMH" or c.MIN_N != 30:
        raise SystemExit("the idea moved")
    signal = c.fp5.SCREEN_START_MS - c.fp5.DAY_MS
    entry = c.fp5.SCREEN_START_MS
    later = entry + c.fp5.DAY_MS
    spot = {signal: (10.0, 100.0), entry: (100.0, 220.0), later: (50.0, 80.0)}
    cm = {signal: (10.0, 101.0), entry: (200.0, 180.0), later: (80.0, 70.0)}
    trades = c.signal_trades(spot, cm)
    if len(trades) != 1 or trades[0]["entry_ms"] != entry or trades[0]["exit_ms"] != entry:
        raise SystemExit("the next hedge did not fill")
    want = _long(Decimal(100), Decimal(220)) + _short(Decimal(200), Decimal(180))
    if abs(trades[0]["net"] - float(want)) > 1e-12:
        raise SystemExit("the hedge fill moved")
    gross = (220.0 / 100.0 - 1.0) + (200.0 / 180.0 - 1.0)
    if abs(trades[0]["gross"] - gross) > 1e-12:
        raise SystemExit("the gross is not both legs")
    if abs(trades[0]["gross"] - (101.0 / 100.0 - 1.0)) < 1e-12:
        raise SystemExit("the gross is the signal-day close ratio")
    if abs(trades[0]["net"] - float(_long(Decimal(100), Decimal(220)))) < 1e-9:
        raise SystemExit("the short leg was dropped")
    if c.signal_trades(spot, {signal: (10.0, 100.0), entry: cm[entry]}):
        raise SystemExit("an equal close fired")
    if c.signal_trades(spot, {signal: (10.0, 99.0), entry: cm[entry]}):
        raise SystemExit("a cheaper coin-margined close fired")
    late = c.fp5.SCREEN_END_MS - c.fp5.DAY_MS
    if c.signal_trades(
        {late: (10.0, 100.0), c.fp5.SCREEN_END_MS: (100.0, 110.0)},
        {late: (10.0, 140.0), c.fp5.SCREEN_END_MS: (200.0, 180.0)},
    ):
        raise SystemExit("a 2024 open was an entry")
    pool = c.pool_nets(spot, cm)
    if len(pool) != 2 or abs(pool[0] - float(want)) > 1e-12:
        raise SystemExit("the null is not the hedge on every day")


def main() -> None:
    test_cm_rich()
    print("fp196 pins ok")


if __name__ == "__main__":
    main()
