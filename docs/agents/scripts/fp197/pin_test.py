from __future__ import annotations

"""Pins for the fp197 rule. No file and no return from 2023 is read."""

import sys
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import common as c


def _short(entry: Decimal, exit_px: Decimal) -> Decimal:
    fee = Decimal("0.001")
    return (entry * (1 - fee)) / (exit_px * (1 + fee)) - 1


def _rates(day: int, morning: float, afternoon: float, midnight: float | None = None) -> dict[int, float]:
    out = {
        day + c.fp5.EIGHT_H_MS: morning,
        day + 2 * c.fp5.EIGHT_H_MS: afternoon,
    }
    if midnight is not None:
        out[day] = midnight
    return out


def test_afternoon_richer() -> None:
    if c.IDEA != "ON16" or c.MIN_N != 30:
        raise SystemExit("the idea moved")
    day = c.fp5.SCREEN_START_MS
    nxt = day + c.fp5.DAY_MS
    bars = {day: (50.0, 100.0), nxt: (80.0, 70.0), nxt + c.fp5.DAY_MS: (60.0, 55.0)}
    funding = _rates(day, 0.0001, 0.0004, midnight=0.01)
    funding.update(_rates(nxt, 0.0002, 0.0001))
    trades = c.signal_trades(bars, funding)
    if len(trades) != 1 or trades[0]["entry_ms"] != day or trades[0]["exit_ms"] != nxt:
        raise SystemExit("the overnight short did not fill")
    want = _short(Decimal(100), Decimal(80))
    if abs(trades[0]["net"] - float(want)) > 1e-12:
        raise SystemExit("the short fill moved")
    if abs(trades[0]["gross"] - (100.0 / 80.0 - 1.0)) > 1e-12:
        raise SystemExit("the gross is not the overnight short")
    if abs(trades[0]["net"] - (float(want) + 0.0004)) < 1e-12:
        raise SystemExit("the funding cash was added")
    richer_close = dict(bars)
    richer_close[day] = (50.0, 130.0)
    other = c.signal_trades(richer_close, funding)
    if len(other) != 1 or abs(other[0]["net"] - float(_short(Decimal(130), Decimal(80)))) > 1e-12:
        raise SystemExit("the close was treated as an input to the decision")
    if c.signal_trades(bars, _rates(day, 0.0004, 0.0004)):
        raise SystemExit("an equal pair fired")
    if c.signal_trades(bars, _rates(day, 0.0004, 0.0001)):
        raise SystemExit("a lower 16:00 rate fired")
    last = c.fp5.SCREEN_END_MS - c.fp5.DAY_MS
    held = c.signal_trades(
        {last: (50.0, 100.0), c.fp5.SCREEN_END_MS: (80.0, 70.0)},
        _rates(last, 0.0001, 0.0004),
    )
    if len(held) != 1 or held[0]["entry_ms"] != last or held[0]["exit_ms"] != c.fp5.SCREEN_END_MS:
        raise SystemExit("the last close was not sold into the next open")
    if c.signal_trades(
        {c.fp5.SCREEN_END_MS: (50.0, 100.0)},
        _rates(c.fp5.SCREEN_END_MS, 0.0001, 0.0004),
    ):
        raise SystemExit("a 2024 open was an entry")
    pool = c.pool_nets(bars)
    if len(pool) != 2 or abs(pool[0] - float(want)) > 1e-12:
        raise SystemExit("the null is not every overnight short")


def main() -> None:
    test_afternoon_richer()
    print("fp197 pins ok")


if __name__ == "__main__":
    main()
