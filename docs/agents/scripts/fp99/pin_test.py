"""Pins for the fp99 rule. No file and no return from 2023 is read."""

from __future__ import annotations

import sys
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import common as c


def near(got: float | None, want: float) -> bool:
    return got is not None and abs(got - want) <= 1e-9


def test_formula() -> None:
    day = c.fp5.SCREEN_START_MS
    # Opens sit at 7 and 9000 and are not inputs. Quotes 40 and 100.
    alt = {day: (7.0, 40.0)}
    btc = {day: (9000.0, 100.0)}
    if not near(c.relq_at(alt, btc, day), 0.4):
        raise SystemExit("ADA quote over BTC quote was wrong")
    if near(c.relq_at(alt, btc, day), 40.0):
        raise SystemExit("the quote level replaced the ratio")
    if near(c.relq_at(alt, btc, day), 100.0 / 40.0):
        raise SystemExit("BTC quote over ADA quote replaced the ratio")
    if c.relq_at({day: (7.0, 0.0)}, btc, day) is not None:
        raise SystemExit("a day with no ADA quote was a print")
    if c.relq_at(alt, {day: (9000.0, 0.0)}, day) is not None:
        raise SystemExit("a day with no BTC quote was a print")
    if c.relq_at(alt, {}, day) is not None:
        raise SystemExit("a day with no BTC bar was a print")
    later = c.fp5.SCREEN_END_MS
    if c.relq_at({later: (7.0, 40.0)}, {later: (9000.0, 100.0)}, later) is not None:
        raise SystemExit("a 2024 day was a print")


def test_strict_quantile() -> None:
    points = [(i * c.fp5.DAY_MS, 0.2) for i in range(91)]
    if c._upper(points, 0.90):
        raise SystemExit("a value equal to its own 90th fired")
    points[-1] = (points[-1][0], 0.9)
    if points[-1][0] not in c._upper(points, 0.90):
        raise SystemExit("a value above its own 90th did not fire")


def test_tail_and_fill() -> None:
    start = c.fp5.SCREEN_START_MS - 40 * c.fp5.DAY_MS
    alt = {}
    btc = {}
    for i in range(121):
        day = start + i * c.fp5.DAY_MS
        quote = 20.0 if i < 120 else 90.0
        alt[day] = (100.0, quote)
        btc[day] = (100.0, 100.0)
    last = start + 120 * c.fp5.DAY_MS
    if c.relq_signal_days(alt, btc) != [last]:
        raise SystemExit("the extreme day did not fire on its own")
    entry = last + c.fp5.DAY_MS
    exit_ = entry + c.fp5.DAY_MS
    alt[entry] = (100.0, 20.0)
    alt[exit_] = (101.0, 20.0)
    btc[entry] = (100.0, 100.0)
    btc[exit_] = (101.0, 100.0)
    filled = [t for t in c.relq_trades(alt, btc) if t["entry_ms"] == entry]
    if len(filled) != 1:
        raise SystemExit("entry must be the next daily open")
    if filled[0]["coin"] != c.COIN:
        raise SystemExit("the fill is not ADA")
    bought = Decimal(100) * Decimal("1.001")
    sold = Decimal(101) * Decimal("0.999")
    if abs(filled[0]["net"] - float(sold / bought - 1)) > 1e-12:
        raise SystemExit("the fill is not fp5's")


def main() -> None:
    test_formula()
    test_strict_quantile()
    test_tail_and_fill()
    print("fp99 pins ok")


if __name__ == "__main__":
    main()
