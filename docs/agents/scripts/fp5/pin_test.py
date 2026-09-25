"""Pins for the fp5 screen rules. Each expected number is computed here, not copied out of common.py.

Run from the repository root: python3 docs/agents/scripts/fp5/pin_test.py
"""

from __future__ import annotations

import random
import sys
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import common as c


def _eq(got: float, expected: Decimal, label: str) -> None:
    if abs(Decimal(str(got)) - expected) > Decimal("1e-9"):
        # str(float) can round. Compare as floats against the Decimal.
        if abs(got - float(expected)) > 1e-9:
            raise SystemExit(f"{label}: got {got} expected {expected}")


def test_round_trip() -> None:
    # Buy 110 at +10 bps, sell 105 at −10 bps.
    bought = Decimal(110) * (Decimal(1) + Decimal("0.001"))
    sold = Decimal(105) * (Decimal(1) - Decimal("0.001"))
    expected = sold / bought - 1
    _eq(c.net_return(110.0, 105.0), expected, "round trip")
    _eq(c.net_return(110.0, 105.0) * 100.0, expected * 100, "pnl on 100")


def test_bucket() -> None:
    boundary = 1_717_257_600_000
    if c.bucket_8h(boundary + 1) != boundary:
        raise SystemExit("a millisecond past an 8h boundary still belongs to it")
    if c.bucket_8h(boundary + 120_000) != boundary:
        raise SystemExit("two minutes is still the boundary")
    if c.bucket_8h(boundary + 120_001) is not None:
        raise SystemExit("beyond two minutes is not a funding stamp")


def test_quantile() -> None:
    # sorted[floor(0.10 * (n - 1))]
    ten = [float(i) for i in range(1, 11)]
    if c.rank_threshold(ten, 0.10, 10) != 1.0:
        raise SystemExit("10-point 10th percentile is the lowest point")
    eleven = [float(i) for i in range(11)]
    if c.rank_threshold(eleven, 0.10, 11) != 1.0:
        raise SystemExit("11-point 10th percentile is index 1")
    if c.rank_threshold(ten, 0.10, 11) is not None:
        raise SystemExit("a short history is not a threshold")


def test_null_matches_the_spec() -> None:
    if c.p95_index(200) != 190:
        raise SystemExit("p95 index of 200 draws is 190, floor(0.95 * 200)")
    pool = [0.01, -0.02, 0.03, 0.0, 0.02, -0.01]
    rng = random.Random(20250925)
    means = sorted(sum(rng.sample(pool, 3)) / 3 for _ in range(200))
    got = c.null_p95(pool, 3)
    if got != means[190]:
        raise SystemExit(f"null p95 {got} != spec {means[190]}")
    if c.null_p95(pool, 7) is not None:
        raise SystemExit("a sample larger than the pool is not a null")


def test_screen_gate() -> None:
    try:
        c.assert_screen_trades([{"entry_ms": c.SCREEN_END_MS}])
    except RuntimeError:
        pass
    else:
        raise SystemExit("an entry on 2024-01-01 must be refused")
    try:
        c.assert_price_horizon([c.PRICE_HORIZON_MS + 1])
    except RuntimeError:
        pass
    else:
        raise SystemExit("a price after the horizon must be refused")
    # 2023-01-02 was a Monday.
    if c._utc_weekday(1_672_617_600_000) != 0:
        raise SystemExit("2023-01-02 did not read as Monday")


def test_fr_own_one_trade() -> None:
    settle = c.SCREEN_START_MS - c.EIGHT_H_MS
    events = []
    for k in range(1, 101):
        events.append((settle - k * c.EIGHT_H_MS, 0.0001))
    events.append((settle, -0.01))
    entry = c.SCREEN_START_MS
    exit_ = entry + c.EIGHT_H_MS
    bars = {
        "BTCUSDT": {
            entry: (100.0, 100.0, 100.0, 100.0, 1.0),
            exit_: (110.0, 110.0, 110.0, 110.0, 1.0),
        }
    }
    # The other basket names are absent: they add no trades.
    trades = c.fr_own({"BTCUSDT": events}, bars)
    if len(trades) != 1:
        raise SystemExit(f"expected one funding trade, got {len(trades)}")
    bought = Decimal(100) * Decimal("1.001")
    sold = Decimal(110) * Decimal("0.999")
    expected = sold / bought - 1
    _eq(trades[0]["net"], expected, "funding trade")
    _eq(trades[0]["pnl"], expected * 100, "funding pnl")
    # A settlement whose entry is the first instant of 2024 is not a 2023 trade.
    late = c.SCREEN_END_MS - c.EIGHT_H_MS
    events.append((late, -0.01))
    bars["BTCUSDT"][c.SCREEN_END_MS] = (100.0, 100.0, 100.0, 100.0, 1.0)
    bars["BTCUSDT"][c.SCREEN_END_MS + c.EIGHT_H_MS] = (100.0, 100.0, 100.0, 100.0, 1.0)
    again = c.fr_own({"BTCUSDT": events}, bars)
    if len(again) != 1:
        raise SystemExit("the 2024 entry was scored")


def test_xs_tie_is_alphabetical() -> None:
    settle = c.SCREEN_START_MS - c.EIGHT_H_MS
    hist = [(settle - k * c.EIGHT_H_MS, 0.0001) for k in range(1, 101)]
    funding = {}
    bars = {}
    entry = c.SCREEN_START_MS
    exit_ = entry + c.EIGHT_H_MS
    for coin in ("ETHUSDT", "BTCUSDT"):
        funding[coin] = hist + [(settle, -0.01)]
        bars[coin] = {
            entry: (50.0, 50.0, 50.0, 50.0, 1.0),
            exit_: (55.0, 55.0, 55.0, 55.0, 1.0),
        }
    trades = c.fr_xs(funding, bars)
    if len(trades) != 1 or trades[0]["coin"] != "BTCUSDT":
        raise SystemExit(f"a tie must take the alphabetical coin, got {trades}")


def main() -> None:
    test_round_trip()
    test_bucket()
    test_quantile()
    test_null_matches_the_spec()
    test_screen_gate()
    test_fr_own_one_trade()
    test_xs_tie_is_alphabetical()
    print("fp5 pins ok")


if __name__ == "__main__":
    main()
