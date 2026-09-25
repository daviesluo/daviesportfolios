from __future__ import annotations

"""Pins for the fp212 rule. No file and no return from 2023 is read."""

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


def test_front_quarter_is_the_same_contract() -> None:
    if c.IDEA != "CAL" or c.MIN_N != 30:
        raise SystemExit("the idea moved")
    if c.front_symbol(1_680_220_800_000) != "BTCUSD_230331":
        raise SystemExit("the expiry day left the expiring contract")
    if c.front_symbol(1_680_220_800_000 + c.fp5.DAY_MS) != "BTCUSD_230630":
        raise SystemExit("the day after expiry kept the expired contract")
    if c.front_symbol(1_711_670_400_000) != "BTCUSD_240329":
        raise SystemExit("the last quarterly moved")
    # The roll: signal day is 2023-03-31, entry is 2023-04-01. front(entry) is 230630.
    signal = 1_680_220_800_000
    entry = signal + c.fp5.DAY_MS
    later = entry + c.fp5.DAY_MS
    q331 = {signal: (100.0, 105.0), entry: (5.0, 9.0)}
    q630 = {signal: (100.0, 130.0), entry: (40.0, 20.0), later: (10.0, 12.0)}
    perp_sig = {signal: (100.0, 110.0), entry: (200.0, 250.0)}
    perp_fill = {entry: (200.0, 250.0), later: (8.0, 9.0)}
    quarters = {"BTCUSD_230331": q331, "BTCUSD_230630": q630}
    trades = c.signal_trades(perp_sig, quarters, perp_fill)
    if len(trades) != 1 or trades[0]["entry_ms"] != entry or trades[0]["exit_ms"] != entry:
        raise SystemExit("the next session did not fill")
    long_leg = _long(Decimal(200), Decimal(250))
    short_leg = _short(Decimal(40), Decimal(20))
    want = long_leg + short_leg
    gross = (250.0 / 200.0 - 1.0) + (40.0 / 20.0 - 1.0)
    if abs(trades[0]["net"] - float(want)) > 1e-12:
        raise SystemExit("the fill did not use the entry day's front contract")
    if abs(trades[0]["gross"] - gross) > 1e-12:
        raise SystemExit("the gross is not the two legs")
    if abs(trades[0]["gross"] - (130.0 / 100.0 - 1.0)) < 1e-9:
        raise SystemExit("the gross is the signal-day ratio")
    if abs(trades[0]["net"] - float(long_leg)) <= 1e-12:
        raise SystemExit("the short leg was dropped")
    if abs(trades[0]["net"] - float(short_leg)) <= 1e-12:
        raise SystemExit("the long leg was dropped")
    decoy = _short(Decimal(5), Decimal(9))
    if abs(trades[0]["net"] - float(long_leg + decoy)) < 1e-9:
        raise SystemExit("the expired contract was the short leg")
    if abs(trades[0]["pnl"] - 100.0 * trades[0]["net"]) > 1e-9:
        raise SystemExit("the dollar result is not a hundred dollars on each leg")
    weaker = dict(q630)
    weaker[signal] = (100.0, 105.0)
    if c.signal_trades(perp_sig, {"BTCUSD_230630": weaker}, perp_fill):
        raise SystemExit("a weaker quarterly return fired")
    same = dict(q630)
    same[signal] = (100.0, 110.0)
    if c.signal_trades(perp_sig, {"BTCUSD_230630": same}, perp_fill):
        raise SystemExit("an equal return fired")
    late = c.fp5.SCREEN_END_MS - c.fp5.DAY_MS
    if c.signal_trades(
        {late: (100.0, 110.0)},
        {"BTCUSD_240329": {late: (100.0, 140.0)}},
        {c.fp5.SCREEN_END_MS: (200.0, 250.0)},
    ):
        raise SystemExit("a 2024 open was an entry")
    pool = c.pool_nets(quarters, perp_fill)
    if len(pool) != 2 or abs(pool[0] - float(want)) > 1e-12:
        raise SystemExit("the null is not every front spread")
    if abs(pool[0] - float(long_leg)) <= 1e-12:
        raise SystemExit("the null dropped the short leg")


def main() -> None:
    test_front_quarter_is_the_same_contract()
    print("fp212 pins ok")


if __name__ == "__main__":
    main()
