from __future__ import annotations

"""Pins for the fp204 rule. No file and no return from 2023 is read."""

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


def test_mark_above_coin() -> None:
    if c.IDEA != "MKCM" or c.MIN_N != 30:
        raise SystemExit("the idea moved")
    signal = c.fp5.SCREEN_START_MS - c.fp5.DAY_MS
    entry = c.fp5.SCREEN_START_MS
    exit_ms = entry + c.fp5.DAY_MS
    later = exit_ms + c.fp5.DAY_MS
    mark = {signal: (100.0, 130.0), entry: (100.0, 100.0), exit_ms: (100.0, 100.0)}
    cm_sig = {signal: (100.0, 110.0), entry: (100.0, 120.0), exit_ms: (100.0, 120.0)}
    cm = {entry: (100.0,), exit_ms: (80.0,), later: (70.0,)}
    um = {entry: (50.0,), exit_ms: (40.0,), later: (30.0,)}
    trades = c.signal_trades(mark, cm_sig, cm, um)
    if len(trades) != 1 or trades[0]["entry_ms"] != entry or trades[0]["exit_ms"] != exit_ms:
        raise SystemExit("the next spread did not fill")
    long_leg = _long(Decimal(100), Decimal(80))
    short_leg = _short(Decimal(50), Decimal(40))
    want = long_leg + short_leg
    gross = (80.0 / 100.0 - 1.0) + (50.0 / 40.0 - 1.0)
    if abs(trades[0]["net"] - float(want)) > 1e-12:
        raise SystemExit("the two-leg fill moved")
    if abs(trades[0]["gross"] - gross) > 1e-12:
        raise SystemExit("the gross is not the two legs")
    if abs(trades[0]["gross"] - (130.0 / 100.0 - 1.0)) < 1e-9:
        raise SystemExit("the gross is the signal-day ratio")
    if abs(trades[0]["net"] - float(long_leg)) <= 1e-12:
        raise SystemExit("the short leg was dropped")
    if abs(trades[0]["net"] - float(_long(Decimal(100), Decimal(80)))) < 1e-12 and abs(float(short_leg)) < 1e-12:
        raise SystemExit("the fill is an unconditional long")
    if abs(trades[0]["pnl"] - 100.0 * trades[0]["net"]) > 1e-9:
        raise SystemExit("the dollar result is not a hundred dollars on each leg")
    if c.signal_trades({signal: (100.0, 110.0)}, {signal: (100.0, 110.0)}, cm, um):
        raise SystemExit("an equal return fired")
    if c.signal_trades({signal: (100.0, 105.0)}, {signal: (100.0, 120.0)}, cm, um):
        raise SystemExit("a weaker mark return fired")
    late = c.fp5.SCREEN_END_MS - c.fp5.DAY_MS
    if c.signal_trades(
        {late: (100.0, 130.0)}, {late: (100.0, 110.0)},
        {c.fp5.SCREEN_END_MS: (100.0,)}, {c.fp5.SCREEN_END_MS: (50.0,)},
    ):
        raise SystemExit("a 2024 open was an entry")
    pool = c.pool_nets(cm, um)
    if len(pool) != 2 or abs(pool[0] - float(want)) > 1e-12:
        raise SystemExit("the null is not every spread")
    if abs(pool[0] - float(long_leg)) <= 1e-12:
        raise SystemExit("the null dropped the short leg")


def main() -> None:
    test_mark_above_coin()
    print("fp204 pins ok")


if __name__ == "__main__":
    main()
