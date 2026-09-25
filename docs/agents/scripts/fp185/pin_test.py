from __future__ import annotations

"""Pins for the fp185 rule. No file and no return from 2023 is read."""

import sys
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import common as c

def test_bid_up() -> None:
    if c.IDEA != "BIDUP" or c.MIN_N != 30:
        raise SystemExit("the idea moved")
    signal = c.fp5.SCREEN_START_MS - c.fp5.DAY_MS
    entry = c.fp5.SCREEN_START_MS
    bars = {entry: (100.0, 102.0)}
    book = {signal: (1.0, 2.0, 3.0, 1.0)}
    trades = c.signal_trades(bars, book)
    if len(trades) != 1 or trades[0]["entry_ms"] != entry:
        raise SystemExit("the next session did not fill")
    fee = Decimal("0.001")
    want = (Decimal(102) * (1 - fee)) / (Decimal(100) * (1 + fee)) - 1
    if abs(trades[0]["net"] - float(want)) > 1e-12:
        raise SystemExit("the session fill moved")
    flat = {signal: (1.0, 2.0, 1.0, 1.0)}
    if c.signal_trades(bars, flat):
        raise SystemExit("an equal bid fired")
    ask_up = {signal: (1.0, 2.0, 3.0, 2.5)}
    if c.signal_trades(bars, ask_up):
        raise SystemExit("a rising ask fired")
    late = {c.fp5.SCREEN_END_MS - c.fp5.DAY_MS: (1.0, 2.0, 3.0, 1.0)}
    if c.signal_trades({c.fp5.SCREEN_END_MS: (100.0, 102.0)}, late):
        raise SystemExit("a 2024 open was an entry")


def main() -> None:
    test_bid_up()
    print("fp185 pins ok")


if __name__ == "__main__":
    main()
