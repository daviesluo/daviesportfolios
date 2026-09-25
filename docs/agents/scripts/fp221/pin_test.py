from __future__ import annotations

"""Pins for the fp221 rule. No file and no return from 2023 is read."""

import sys
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import common as c


def _net(entry: Decimal, exit_px: Decimal) -> Decimal:
    fee = Decimal("0.001")
    return (exit_px * (1 - fee)) / (entry * (1 + fee)) - 1


def _book(entry: int, earlier: float, later: float) -> dict:
    return {
        entry - 8 * c.fp5.DAY_MS: (10.0, earlier),
        entry - c.fp5.DAY_MS: (10.0, later),
        entry: (50.0, 1.0),
        entry + 7 * c.fp5.DAY_MS: (40.0, 1.0),
    }


def test_an_up_week_is_a_seven_day_spot_long() -> None:
    if c.IDEA != "SMO" or c.MIN_N != 30 or c.HOLD_DAYS != 7:
        raise SystemExit("the idea moved")
    entry = c.fp5.SCREEN_START_MS + 10 * c.fp5.DAY_MS
    down = entry + 16 * c.fp5.DAY_MS
    flat = entry + 32 * c.fp5.DAY_MS
    spot = {}
    spot.update(_book(entry, 100.0, 110.0))
    spot.update(_book(down, 110.0, 100.0))
    spot.update(_book(flat, 100.0, 100.0))
    trades = c.signal_trades(spot)
    if len(trades) != 1 or trades[0]["entry_ms"] != entry:
        raise SystemExit("the up week did not fill")
    if trades[0]["exit_ms"] - trades[0]["entry_ms"] != 7 * c.fp5.DAY_MS:
        raise SystemExit("the hold is not seven days")
    want = _net(Decimal(50), Decimal(40))
    if abs(trades[0]["net"] - float(want)) > 1e-12:
        raise SystemExit("the one-leg fill moved")
    if abs(trades[0]["gross"] - (40.0 / 50.0 - 1.0)) > 1e-12:
        raise SystemExit("the gross is not the seven-day open")
    if abs(trades[0]["gross"] - (110.0 / 100.0 - 1.0)) < 1e-9:
        raise SystemExit("the gross is the signal week")
    spans = {day for day, _exit in c.pool_spans(spot)}
    if entry not in spans or down not in spans or flat not in spans:
        raise SystemExit("the null dropped a down week or a flat week")
    if len(c.pool_nets(spot)) <= len(trades):
        raise SystemExit("the null is not larger than the rule")
    if c.signal_trades(_book(c.fp5.SCREEN_END_MS, 100.0, 110.0)):
        raise SystemExit("a 2024 open was an entry")


def main() -> None:
    test_an_up_week_is_a_seven_day_spot_long()
    print("fp221 pins ok")


if __name__ == "__main__":
    main()
