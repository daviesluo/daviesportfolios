from __future__ import annotations

"""Pins for the fp229 rule. No file and no return from 2023 is read."""

import sys
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import common as c


def _short(entry: Decimal, exit_px: Decimal) -> Decimal:
    fee = Decimal("0.001")
    return (entry * (1 - fee)) / (exit_px * (1 + fee)) - 1


def test_spot_led_on_a_finished_close() -> None:
    if c.IDEA != "SLD" or c.MIN_N != 30 or c.HOLD_DAYS != 14 or c.LOOKBACK != 10:
        raise SystemExit("the idea moved")
    day = c.fp5.DAY_MS
    entry = c.fp5.SCREEN_START_MS + 40 * day
    missed = entry + 80 * day
    spot = {}
    um = {}
    yesterday = entry - day
    spot[yesterday - 10 * day] = (1.0, 80.0)
    spot[yesterday] = (1.0, 100.0)
    um[yesterday - 10 * day] = (80.0,)
    um[yesterday] = (90.0,)
    spot[entry] = (40.0, 1.0)
    spot[entry + 14 * day] = (30.0, 1.0)
    prior = missed - day
    spot[prior - 10 * day] = (1.0, 100.0)
    spot[prior] = (1.0, 90.0)
    um[prior - 10 * day] = (50.0,)
    um[prior] = (80.0,)
    spot[missed] = (20.0, 200.0)
    spot[missed + 14 * day] = (20.0, 1.0)
    um[missed] = (1.0,)
    trades = c.signal_trades(spot, um)
    if len(trades) != 1 or trades[0]["entry_ms"] != entry:
        raise SystemExit("the lead was not yesterday's closes")
    if trades[0]["exit_ms"] - trades[0]["entry_ms"] != 14 * day:
        raise SystemExit("the hold is not fourteen days")
    want = _short(Decimal(40), Decimal(30))
    if abs(trades[0]["net"] - float(want)) > 1e-12:
        raise SystemExit("the one-leg short moved")
    pool = {stamp for stamp, _exit in c.pool_spans(spot)}
    if entry not in pool or missed not in pool:
        raise SystemExit("the null dropped a fourteen-day spot short")
    if c.signal_trades({c.fp5.SCREEN_END_MS: (100.0, 100.0)}, {}):
        raise SystemExit("a 2024 open was an entry")


def main() -> None:
    test_spot_led_on_a_finished_close()
    print("fp229 pins ok")


if __name__ == "__main__":
    main()
