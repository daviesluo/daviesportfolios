"""Rules for the sixth search (fp6), Binance only.

The fill, the null and the screen window are fp5's. This file only decides
which entries those functions are asked to price. Nothing here reads the
network or a file.
"""

from __future__ import annotations

import importlib.util
from decimal import Decimal
from pathlib import Path

_SPEC = importlib.util.spec_from_file_location(
    "fp5_common",
    Path(__file__).resolve().parents[1] / "fp5" / "common.py",
)
fp5 = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(fp5)

# One round trip under par, and one round trip of cheapness on the BTC pair.
# Both are the fee, not a searched distance.
USDC_CHEAP = 0.998
GAP_CHEAP = -0.002
MIN_N = 30


def forward(coin: str, daily: dict[int, tuple], signal_days: list[int], hold_days: int = 1) -> list[dict]:
    """Enter the next daily open after the signal day. A missing day is a skip."""
    trades: list[dict] = []
    for day in signal_days:
        entry = day + fp5.DAY_MS
        exit_ = entry + hold_days * fp5.DAY_MS
        trade = fp5._trade(coin, entry, exit_, daily)
        if trade is not None:
            trades.append(trade)
    return trades


def usdc_cheap_days(daily: dict[int, tuple]) -> list[int]:
    """Days whose close is strictly below one round trip under par."""
    out = []
    for day in sorted(daily):
        if Decimal(str(daily[day][3])) < Decimal(str(USDC_CHEAP)):
            out.append(day)
    return out


def gap_days(btcusdc: dict[int, tuple], btcusdt: dict[int, tuple]) -> list[int]:
    """Days BTCUSDC's close is strictly more than a round trip under BTCUSDT's."""
    out = []
    for day in sorted(set(btcusdc) & set(btcusdt)):
        usdt = btcusdt[day][3]
        if usdt <= 0:
            continue
        gap = Decimal(str(btcusdc[day][3])) / Decimal(str(usdt)) - 1
        if gap < Decimal(str(GAP_CHEAP)):
            out.append(day)
    return out


def fund_gap_trades(
    binance: list[tuple[int, float]],
    deribit: dict[int, float],
    bars: dict[int, tuple],
) -> list[dict]:
    """Binance funding minus Deribit, below its own trailing 10th. FR-OWN's lag."""
    events = []
    for ts, rate in binance:
        if ts not in deribit:
            continue
        events.append((ts, rate - deribit[ts]))
    events.sort()
    trades: list[dict] = []
    for ts, diff in events:
        hist = [d for ht, d in events if ts - 90 * fp5.DAY_MS <= ht < ts]
        thr = fp5.rank_threshold(hist, 0.10, 90)
        if thr is None or not diff < thr:
            continue
        entry = ts + fp5.EIGHT_H_MS
        exit_ = entry + fp5.EIGHT_H_MS
        trade = fp5._trade("BTCUSDT", entry, exit_, bars)
        if trade is not None:
            trades.append(trade)
    return trades


def weekday_entries(daily: dict[int, tuple], weekday: int) -> list[dict]:
    """Hold BTC from that UTC weekday's open to the next day's open."""
    trades = []
    for day in sorted(daily):
        if fp5._utc_weekday(day) != weekday:
            continue
        trade = fp5._trade("BTCUSDT", day, day + fp5.DAY_MS, daily)
        if trade is not None:
            trades.append(trade)
    return trades


def quiet_days(daily: dict[int, tuple]) -> list[int]:
    """Days whose range is strictly below its own trailing-90-day 10th."""
    days = sorted(daily)
    out = []
    for i, day in enumerate(days):
        open_ = daily[day][0]
        if open_ <= 0:
            continue
        hist = []
        for prev in days[:i]:
            if not day - 90 * fp5.DAY_MS <= prev < day:
                continue
            popen = daily[prev][0]
            if popen <= 0:
                continue
            hist.append((daily[prev][1] - daily[prev][2]) / popen)
        thr = fp5.rank_threshold(hist, 0.10, 90)
        if thr is None:
            continue
        rng = (daily[day][1] - daily[day][2]) / open_
        if rng < thr:
            out.append(day)
    return out
