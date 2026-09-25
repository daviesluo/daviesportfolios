from __future__ import annotations

"""Pins for the fp158 rule. No file and no return from 2023 is read."""

import sys
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import common as c


def test_stop_is_two_percent() -> None:
    if c.IDEA != "UPSTOP" or c.STOP != 0.02:
        raise SystemExit("the stop moved")
    signal = c.fp5.SCREEN_START_MS - c.fp5.DAY_MS
    entry = c.fp5.SCREEN_START_MS
    nxt = entry + c.fp5.DAY_MS
    # open, low, close
    up = (10.0, 9.0, 11.0)
    held = {
        signal: up,
        entry: (100.0, 99.0, 100.0),
        nxt: (101.0, 100.0, 100.0),
    }
    quiet = c.signal_trades(held)
    if len(quiet) != 1 or quiet[0]["stopped"]:
        raise SystemExit("a low above the stop was stopped")
    fee = Decimal("0.001")
    want = (Decimal(101) * (1 - fee)) / (Decimal(100) * (1 + fee)) - 1
    if abs(quiet[0]["net"] - float(want)) > 1e-12:
        raise SystemExit("an unstopped fill moved")
    hit = dict(held)
    hit[entry] = (100.0, 97.0, 100.0)
    stopped = c.signal_trades(hit)
    if len(stopped) != 1 or not stopped[0]["stopped"]:
        raise SystemExit("a low under the stop was kept to the next open")
    stop_px = Decimal(100) * (Decimal(1) - Decimal("0.02"))
    want_stop = (stop_px * (1 - fee)) / (Decimal(100) * (1 + fee)) - 1
    if abs(stopped[0]["net"] - float(want_stop)) > 1e-12:
        raise SystemExit("the stop price moved")
    if abs(stopped[0]["net"] - c.fp5.net_return(100.0, 101.0)) < 1e-9:
        raise SystemExit("the next open replaced the stop")
    exact = dict(held)
    exact[entry] = (100.0, 100.0 * (1.0 - 0.02), 100.0)
    if not c.signal_trades(exact)[0]["stopped"]:
        raise SystemExit("a low on the stop was a miss")
    flat = dict(held)
    flat[signal] = (11.0, 9.0, 11.0)
    if c.signal_trades(flat):
        raise SystemExit("a flat candle fired")
    down = dict(held)
    down[signal] = (11.0, 9.0, 10.0)
    if c.signal_trades(down):
        raise SystemExit("a down candle was bought")


def main() -> None:
    test_stop_is_two_percent()
    print("fp158 pins ok")


if __name__ == "__main__":
    main()
