"""Pins for the fp37 rule. No file and no return from 2023 is read."""

from __future__ import annotations

import sys
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import common as c


def near(got: float | None, want: float) -> bool:
    return got is not None and abs(got - want) <= 1e-9


def pair(start: int, btc_close: float, eth_close: float, btc0: float = 100.0, eth0: float = 50.0):
    nxt = start + c.fp5.DAY_MS
    btc = {start: (1.0, btc0), nxt: (1.0, btc_close)}
    eth = {start: (1.0, eth0), nxt: (1.0, eth_close)}
    return btc, eth, nxt


def test_formula() -> None:
    start = c.fp5.SCREEN_START_MS
    btc, eth, nxt = pair(start, 110.0, 50.0)
    if not near(c.rel_at(btc, eth, nxt), 0.1):
        raise SystemExit("BTC up 10% and ETH flat was not 0.1")
    btc, eth, nxt = pair(start, 110.0, 55.0)
    if not near(c.rel_at(btc, eth, nxt), 0.0):
        raise SystemExit("equal returns were not 0")
    btc, eth, nxt = pair(start, 200.0, 100.0, 100.0, 50.0)
    if not near(c.rel_at(btc, eth, nxt), 0.0):
        raise SystemExit("the price-ratio level was the signal")
    btc, eth, nxt = pair(start, 110.0, 50.0)
    eth[start - c.fp5.DAY_MS] = (1.0, 10.0)
    if not near(c.rel_at(btc, eth, nxt), 0.1):
        raise SystemExit("ETH's previous day entered the signal")
    if c.rel_at(btc, {}, nxt) is not None:
        raise SystemExit("a missing ETH day was a print")
    later_day = c.fp5.SCREEN_END_MS
    btc = {later_day - c.fp5.DAY_MS: (1.0, 100.0), later_day: (1.0, 110.0)}
    eth = {later_day - c.fp5.DAY_MS: (1.0, 50.0), later_day: (1.0, 50.0)}
    if c.rel_at(btc, eth, later_day) is not None:
        raise SystemExit("a 2024 day was a print")
    if not near(c.rel_at(btc, eth, later_day, later_day + c.fp5.DAY_MS), 0.1):
        raise SystemExit("a later horizon still dropped the 2024 day")


def test_strict_quantile() -> None:
    points = [(i * c.fp5.DAY_MS, 0.0) for i in range(91)]
    if c._upper(points, 0.90):
        raise SystemExit("a value equal to its own 90th fired")
    points[-1] = (points[-1][0], 0.01)
    if points[-1][0] not in c._upper(points, 0.90):
        raise SystemExit("a value above its own 90th did not fire")
    points[-1] = (points[-1][0], -0.05)
    if c._upper(points, 0.90):
        raise SystemExit("a day ETH outran BTC was returned")


def test_tail_and_fill() -> None:
    start = c.fp5.SCREEN_START_MS - 40 * c.fp5.DAY_MS
    btc = {}
    eth = {}
    for i in range(121):
        btc[start + i * c.fp5.DAY_MS] = (1.0, 100.0)
        eth[start + i * c.fp5.DAY_MS] = (1.0, 50.0)
    last = start + 120 * c.fp5.DAY_MS
    btc[last] = (1.0, 110.0)
    if c.rel_signal_days(btc, eth) != [last]:
        raise SystemExit("a day BTC outran ETH did not fire on its own")
    entry = last + c.fp5.DAY_MS
    exit_ = entry + c.fp5.DAY_MS
    btc[entry] = (100.0, 100.0)
    btc[exit_] = (101.0, 101.0)
    eth[entry] = (1.0, 50.0)
    eth[exit_] = (1.0, 50.0)
    filled = [t for t in c.rel_trades(btc, eth) if t["entry_ms"] == entry]
    if len(filled) != 1:
        raise SystemExit("entry must be the next BTC open")
    if filled[0]["coin"] != "BTCUSDT":
        raise SystemExit("the coin is not BTCUSDT")
    bought = Decimal(100) * Decimal("1.001")
    sold = Decimal(101) * Decimal("0.999")
    if abs(filled[0]["net"] - float(sold / bought - 1)) > 1e-12:
        raise SystemExit("the fill is not fp5's")


def main() -> None:
    test_formula()
    test_strict_quantile()
    test_tail_and_fill()
    print("fp37 pins ok")


if __name__ == "__main__":
    main()
