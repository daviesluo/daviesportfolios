from __future__ import annotations

"""Pins for the fp206 rule. No file and no return from 2023 is read."""

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


def test_sign_change() -> None:
    if c.IDEA != "CMFN" or c.MIN_N != 30:
        raise SystemExit("the idea moved")
    day = c.fp5.SCREEN_START_MS
    nxt = day + c.fp5.DAY_MS
    later = nxt + c.fp5.DAY_MS
    bars = {day: (10.0, 100.0), nxt: (80.0, 50.0), later: (40.0, 30.0)}
    afternoon = day + 2 * c.fp5.EIGHT_H_MS
    morning = day + c.fp5.EIGHT_H_MS
    # The 08:00 print is present and ignored. The next day does not change sign.
    funding = {day: -0.001, morning: 99.0, afternoon: 0.001, nxt: 0.001, nxt + 2 * c.fp5.EIGHT_H_MS: 0.001}
    trades = c.signal_trades(bars, funding)
    if len(trades) != 1 or trades[0]["entry_ms"] != day or trades[0]["exit_ms"] != nxt:
        raise SystemExit("the overnight short did not fill")
    want = _short(Decimal(100), Decimal(80))
    if abs(trades[0]["net"] - float(want)) > 1e-12:
        raise SystemExit("the short fill moved")
    if abs(trades[0]["gross"] - (100.0 / 80.0 - 1.0)) > 1e-12:
        raise SystemExit("the gross is not the overnight short")
    if abs(trades[0]["gross"] - (10.0 / 100.0 - 1.0)) < 1e-9:
        raise SystemExit("the gross is the session")
    if abs(trades[0]["net"] - float(_long(Decimal(100), Decimal(80)))) < 1e-9:
        raise SystemExit("the fill is an unconditional long")
    if c.signal_trades(bars, {day: 0.0, afternoon: 0.001}):
        raise SystemExit("a zero morning rate fired")
    if c.signal_trades(bars, {day: -0.001, afternoon: 0.0}):
        raise SystemExit("a zero afternoon rate fired")
    if c.signal_trades(bars, {day: 0.001, afternoon: -0.001}):
        raise SystemExit("the opposite signs fired")
    last = c.ENTRY_LAST_MS
    last_bars = {last: (1.0, 100.0), c.fp5.SCREEN_END_MS: (80.0, 70.0)}
    last_fund = {last: -0.001, last + 2 * c.fp5.EIGHT_H_MS: 0.001}
    last_trades = c.signal_trades(last_bars, last_fund)
    if len(last_trades) != 1 or last_trades[0]["exit_ms"] != c.fp5.SCREEN_END_MS:
        raise SystemExit("the last 2023 close was not sold")
    year = c.fp5.SCREEN_END_MS
    if c.signal_trades(
        {year: (1.0, 100.0), year + c.fp5.DAY_MS: (80.0, 70.0)},
        {year: -0.001, year + 2 * c.fp5.EIGHT_H_MS: 0.001},
    ):
        raise SystemExit("a 2024 open was an entry")
    pool = c.pool_nets(bars)
    if len(pool) != 2 or abs(pool[0] - float(want)) > 1e-12:
        raise SystemExit("the null is not every overnight short")
    if abs(pool[0] - float(_long(Decimal(100), Decimal(80)))) < 1e-9:
        raise SystemExit("the null is an unconditional long")


def main() -> None:
    test_sign_change()
    print("fp206 pins ok")


if __name__ == "__main__":
    main()
