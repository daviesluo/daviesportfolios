"""Pins for the fp24 rule. No file and no return from 2023 is read.

    python3 docs/agents/scripts/fp24/pin_test.py
"""

from __future__ import annotations

import sys
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import common as c


def flat_then(last: float, n_hist: int = 90) -> list[tuple[int, float]]:
    """n_hist days of 1 BTC in fees, then one day at `last`. The last day is inside 2023."""
    start = c.fp5.SCREEN_START_MS - n_hist * c.fp5.DAY_MS
    points = [(start + i * c.fp5.DAY_MS, 1.0) for i in range(n_hist)]
    points.append((start + n_hist * c.fp5.DAY_MS, last))
    return points


def test_formula() -> None:
    start = c.fp5.SCREEN_START_MS
    one = c.fee_prints([(start, 2.5)])
    if one != [(start, 2.5)]:
        raise SystemExit("a positive fee was not a print")
    if c.fee_prints([(start, 0.0)]) or c.fee_prints([(start, -1.0)]):
        raise SystemExit("a non-positive fee was a print")
    if c.fee_prints([(c.fp5.SCREEN_END_MS, 9.0)]):
        raise SystemExit("a 2024 stamp was a print")
    dup = c.fee_prints([(start, 1.0), (start, 2.0)])
    if dup:
        raise SystemExit("a duplicate day was a print")
    scaled = [(start, 3.0), (start + c.fp5.DAY_MS, 6.0)]
    if [v for _, v in c.fee_prints(scaled)] != [3.0, 6.0]:
        raise SystemExit("the fee level was dropped")
    book = flat_then(2.0)
    if book[-1][0] not in c.fee_signal_days(book):
        raise SystemExit("a doubled fee did not fire before the scale check")
    if c.fee_signal_days([(d, f * 3.0) for d, f in book]) != c.fee_signal_days(book):
        raise SystemExit("scaling every day moved the signal")


def test_strict_quantile() -> None:
    tied = flat_then(1.0)
    if c.fee_signal_days(tied):
        raise SystemExit("a fee equal to its own 90th fired")
    hot = flat_then(1.01)
    if hot[-1][0] not in c.fee_signal_days(hot):
        raise SystemExit("a fee above its own 90th did not fire")
    short = flat_then(5.0, n_hist=89)
    if c.fee_signal_days(short):
        raise SystemExit("89 prints were enough")
    start = c.fp5.SCREEN_START_MS - 90 * c.fp5.DAY_MS
    ladder = [(start + i * c.fp5.DAY_MS, 1.0) for i in range(80)]
    ladder += [(start + i * c.fp5.DAY_MS, 10.0) for i in range(80, 90)]
    last = start + 90 * c.fp5.DAY_MS
    if last in c.fee_signal_days(ladder + [(last, 2.0)]):
        raise SystemExit("the 80th neighbour was treated as the screen cut")
    if last not in c.fee_signal_days(ladder + [(last, 2.0)], q=0.80):
        raise SystemExit("2 did not clear the 80th neighbour")
    if last in c.fee_signal_days(ladder + [(last, 10.0)]):
        raise SystemExit("a fee equal to the 90th of a split book fired")
    if last not in c.fee_signal_days(ladder + [(last, 10.01)]):
        raise SystemExit("a fee above the split book's 90th did not fire")
    cheap = flat_then(0.01)
    if c.fee_signal_days(cheap):
        raise SystemExit("a cheap-fee day was returned")
    zeroed = flat_then(5.0)
    zeroed.insert(-1, (zeroed[-1][0] - c.fp5.DAY_MS // 2, 0.0))
    # The inserted stamp is not on the daily grid and is non-positive, so the 90 history days remain.
    if zeroed[-1][0] not in c.fee_signal_days(zeroed):
        raise SystemExit("a non-positive stamp removed a real day")
    dropped = [(d, f) for d, f in flat_then(5.0) if d != flat_then(5.0)[-2][0]]
    if c.fee_signal_days(dropped):
        raise SystemExit("89 positive days plus a gap were enough")


def test_window_and_fill() -> None:
    points = flat_then(2.0)
    signal = points[-1][0]
    entry = signal + c.fp5.DAY_MS
    exit_ = entry + c.fp5.DAY_MS
    if not (c.fp5.SCREEN_START_MS <= entry < c.fp5.SCREEN_END_MS):
        raise SystemExit("the fixture's entry is outside 2023")
    daily = {
        signal: (50.0, 9.0e9),
        entry: (100.0, 1.0),
        exit_: (101.0, 1.0),
    }
    if c.fee_signal_days(points) != [signal]:
        raise SystemExit("the hot day did not fire on its own")
    filled = [t for t in c.fee_trades(daily, points) if t["entry_ms"] == entry]
    if len(filled) != 1:
        raise SystemExit(f"entry must be the next daily open: {filled}")
    if any(t["entry_ms"] == signal for t in c.fee_trades(daily, points)):
        raise SystemExit("the signal day was the entry")
    if filled[0]["coin"] != "BTCUSDT":
        raise SystemExit("the coin is not BTCUSDT")
    if filled[0]["exit_ms"] - filled[0]["entry_ms"] != c.fp5.DAY_MS:
        raise SystemExit("the hold is not one day")
    bought = Decimal(100) * Decimal("1.001")
    sold = Decimal(101) * Decimal("0.999")
    if abs(filled[0]["net"] - float(sold / bought - 1)) > 1e-12:
        raise SystemExit("the fill is not fp5's")
    leaked = dict(daily)
    leaked[signal] = (1.0, 0.0)
    again = [t for t in c.fee_trades(leaked, points) if t["entry_ms"] == entry]
    if len(again) != 1 or abs(again[0]["net"] - filled[0]["net"]) > 1e-12:
        raise SystemExit("the signal day's open leaked into the fill")
    del daily[exit_]
    if any(t["entry_ms"] == entry for t in c.fee_trades(daily, points)):
        raise SystemExit("a hold crossed a missing day")

    boundary = c.fp5.SCREEN_END_MS - c.fp5.DAY_MS
    hist = [(boundary - (90 - i) * c.fp5.DAY_MS, 1.0) for i in range(90)]
    late = hist + [(boundary, 5.0)]
    if boundary not in c.fee_signal_days(late):
        raise SystemExit("the last 2023 signal should be a candidate")
    late_daily = {
        c.fp5.SCREEN_END_MS: (100.0,),
        c.fp5.SCREEN_END_MS + c.fp5.DAY_MS: (101.0,),
    }
    if any(t["entry_ms"] >= c.fp5.SCREEN_END_MS for t in c.fee_trades(late_daily, late)):
        raise SystemExit("an entry at 2024-01-01 was kept")
    if any(ts >= c.fp5.SCREEN_END_MS for ts, _ in c.fee_prints(late + [(c.fp5.SCREEN_END_MS, 9.0)])):
        raise SystemExit("a 2024 day was a print")


def main() -> None:
    test_formula()
    test_strict_quantile()
    test_window_and_fill()
    print("fp24 pins ok")


if __name__ == "__main__":
    main()
