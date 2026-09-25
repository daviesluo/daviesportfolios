from __future__ import annotations

"""Pins for the fp224 rule. No file and no return from 2023 is read."""

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


def _weeks(entry: int, cm_later: float, um_later: float) -> tuple[dict, dict]:
    cm = {
        entry - 8 * c.fp5.DAY_MS: (10.0, 100.0),
        entry - c.fp5.DAY_MS: (10.0, cm_later),
        entry: (200.0, 1.0),
        entry + 7 * c.fp5.DAY_MS: (180.0, 1.0),
    }
    um = {
        entry - 8 * c.fp5.DAY_MS: (100.0,),
        entry - c.fp5.DAY_MS: (um_later,),
        entry: (999.0,),
    }
    return cm, um


def test_a_lagging_week_is_one_short() -> None:
    if c.IDEA != "CMS" or c.MIN_N != 30 or c.HOLD_DAYS != 7:
        raise SystemExit("the idea moved")
    entry = c.fp5.SCREEN_START_MS + 10 * c.fp5.DAY_MS
    led = entry + 16 * c.fp5.DAY_MS
    flat = entry + 32 * c.fp5.DAY_MS
    cm, um = _weeks(entry, 105.0, 110.0)
    cm2, um2 = _weeks(led, 120.0, 110.0)
    cm3, um3 = _weeks(flat, 110.0, 110.0)
    cm.update(cm2)
    cm.update(cm3)
    um.update(um2)
    um.update(um3)
    trades = c.signal_trades(cm, um)
    if len(trades) != 1 or trades[0]["entry_ms"] != entry:
        raise SystemExit("the lagging week did not fill")
    if trades[0]["exit_ms"] - trades[0]["entry_ms"] != 7 * c.fp5.DAY_MS:
        raise SystemExit("the hold is not seven days")
    want = _short(Decimal(200), Decimal(180))
    if abs(trades[0]["net"] - float(want)) > 1e-12:
        raise SystemExit("the short fill moved")
    if abs(trades[0]["net"] - float(_long(Decimal(200), Decimal(180)))) <= 1e-12:
        raise SystemExit("the short was scored as a long")
    if abs(trades[0]["gross"] - (200.0 / 180.0 - 1.0)) > 1e-12:
        raise SystemExit("the gross is not the one short")
    if abs(trades[0]["gross"] - ((200.0 / 180.0 - 1.0) + (999.0 / 110.0 - 1.0))) < 1e-9:
        raise SystemExit("the USDT book was a second leg")
    spans = {day for day, _exit in c.pool_spans(cm, um)}
    if entry not in spans or led not in spans or flat not in spans:
        raise SystemExit("the null dropped a leading week or a flat week")
    if len(c.pool_nets(cm, um)) <= len(trades):
        raise SystemExit("the null is not larger than the rule")
    late_cm, late_um = _weeks(c.fp5.SCREEN_END_MS, 105.0, 110.0)
    if c.signal_trades(late_cm, late_um):
        raise SystemExit("a 2024 open was an entry")


def main() -> None:
    test_a_lagging_week_is_one_short()
    print("fp224 pins ok")


if __name__ == "__main__":
    main()
