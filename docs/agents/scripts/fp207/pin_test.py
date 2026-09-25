from __future__ import annotations

"""Pins for the fp207 rule. No file and no return from 2023 is read."""

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


def test_um_above_index() -> None:
    if c.IDEA != "UMX" or c.MIN_N != 30:
        raise SystemExit("the idea moved")
    signal = c.fp5.SCREEN_START_MS - c.fp5.DAY_MS
    entry = c.fp5.SCREEN_START_MS
    exit_ms = entry + c.fp5.DAY_MS
    later = exit_ms + c.fp5.DAY_MS
    um = {signal: (20.0,), entry: (10.0,), exit_ms: (10.0,)}
    index = {signal: (15.0,), entry: (15.0,), exit_ms: (15.0,)}
    spot = {entry: (100.0,), exit_ms: (80.0,), later: (70.0,)}
    trades = c.signal_trades(um, index, spot)
    if len(trades) != 1 or trades[0]["entry_ms"] != entry or trades[0]["exit_ms"] != exit_ms:
        raise SystemExit("the next close short did not fill")
    want = _short(Decimal(100), Decimal(80))
    if abs(trades[0]["net"] - float(want)) > 1e-12:
        raise SystemExit("the short fill moved")
    if abs(trades[0]["gross"] - (100.0 / 80.0 - 1.0)) > 1e-12:
        raise SystemExit("the gross is not the short")
    if abs(trades[0]["gross"] - (20.0 / 15.0 - 1.0)) < 1e-9:
        raise SystemExit("the gross is the signal-day ratio")
    if abs(trades[0]["net"] - float(_long(Decimal(100), Decimal(80)))) < 1e-9:
        raise SystemExit("the fill is an unconditional long")
    if c.signal_trades({signal: (15.0,)}, {signal: (15.0,)}, spot):
        raise SystemExit("an equal close fired")
    if c.signal_trades({signal: (10.0,)}, {signal: (15.0,)}, spot):
        raise SystemExit("a close under the index fired")
    late = c.fp5.SCREEN_END_MS - c.fp5.DAY_MS
    if c.signal_trades({late: (20.0,)}, {late: (15.0,)}, {c.fp5.SCREEN_END_MS: (100.0,)}):
        raise SystemExit("a 2024 open was an entry")
    last_signal = c.fp5.SCREEN_END_MS - 2 * c.fp5.DAY_MS
    last_entry = c.fp5.SCREEN_END_MS - c.fp5.DAY_MS
    last = c.signal_trades(
        {last_signal: (20.0,), last_entry: (10.0,)},
        {last_signal: (15.0,), last_entry: (15.0,)},
        {last_entry: (100.0,), c.fp5.SCREEN_END_MS: (80.0,)},
    )
    if len(last) != 1 or last[0]["entry_ms"] != last_entry or last[0]["exit_ms"] != c.fp5.SCREEN_END_MS:
        raise SystemExit("the 2024 close was not a cover")
    pool = c.pool_nets(spot)
    if len(pool) != 2 or abs(pool[0] - float(want)) > 1e-12:
        raise SystemExit("the null is not every close short")
    if abs(pool[0] - float(_long(Decimal(100), Decimal(80)))) < 1e-9:
        raise SystemExit("the null is an unconditional long")


def main() -> None:
    test_um_above_index()
    print("fp207 pins ok")


if __name__ == "__main__":
    main()
