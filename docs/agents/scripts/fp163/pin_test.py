from __future__ import annotations

"""Pins for the fp163 rule. No file and no return from 2023 is read."""

import sys
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import common as c


def test_target_or_the_close() -> None:
    if c.IDEA != "TAKTGT" or c.TARGET != 0.02:
        raise SystemExit("the target moved")
    signal = c.fp5.SCREEN_START_MS - c.fp5.DAY_MS
    entry = c.fp5.SCREEN_START_MS
    fee = Decimal("0.001")
    # open, high, close
    hit = {entry: (100.0, 105.0, 104.0)}
    trades = c.signal_trades({signal: (0.4, 0.9)}, hit)
    if len(trades) != 1 or trades[0]["exit_ms"] != entry:
        raise SystemExit("the exit left the session")
    target = Decimal(100) * (Decimal(1) + Decimal("0.02"))
    want = (target * (1 - fee)) / (Decimal(100) * (1 + fee)) - 1
    if abs(trades[0]["net"] - float(want)) > 1e-12:
        raise SystemExit("a high through the target did not sell there")
    if abs(trades[0]["net"] - c.fp5.net_return(100.0, 104.0)) < 1e-9:
        raise SystemExit("the close replaced the target")
    miss = {entry: (100.0, 101.0, 101.5)}
    quiet = c.signal_trades({signal: (0.4, 0.9)}, miss)
    want_close = (Decimal("101.5") * (1 - fee)) / (Decimal(100) * (1 + fee)) - 1
    if abs(quiet[0]["net"] - float(want_close)) > 1e-12:
        raise SystemExit("a high under the target did not sell the close")
    exact = {entry: (100.0, 102.0, 101.0)}
    if abs(c.signal_trades({signal: (0.4, 0.9)}, exact)[0]["net"] - float(want)) > 1e-12:
        raise SystemExit("a high on the target was a miss")
    if c.signal_trades({signal: (0.9, 0.9)}, hit):
        raise SystemExit("a flat ratio fired")
    if c.signal_trades({signal: (1.4, 0.8)}, hit):
        raise SystemExit("a falling ratio was bought")


def main() -> None:
    test_target_or_the_close()
    print("fp163 pins ok")


if __name__ == "__main__":
    main()
