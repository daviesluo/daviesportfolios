from __future__ import annotations

"""Pins for the fp230 rule. No file and no return from 2023 is read."""

import sys
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import common as c


def _net(entry: Decimal, exit_px: Decimal) -> Decimal:
    fee = Decimal("0.001")
    return (exit_px * (1 - fee)) / (entry * (1 + fee)) - 1


def test_the_split_uses_finished_closes() -> None:
    if c.IDEA != "CMF" or c.MIN_N != 30 or c.HOLD_DAYS != 12 or c.LOOKBACK != 12:
        raise SystemExit("the idea moved")
    day = c.fp5.DAY_MS
    entry = c.fp5.SCREEN_START_MS + 40 * day
    missed = entry + 80 * day
    cm = {}
    spot = {}
    yesterday = entry - day
    cm[yesterday - 12 * day] = (1.0, 100.0)
    cm[yesterday] = (1.0, 80.0)
    spot[yesterday - 12 * day] = (70.0,)
    spot[yesterday] = (90.0,)
    cm[entry] = (50.0, 200.0)
    cm[entry + 12 * day] = (60.0, 1.0)
    prior = missed - day
    cm[prior - 12 * day] = (1.0, 100.0)
    cm[prior] = (1.0, 90.0)
    spot[prior - 12 * day] = (100.0,)
    spot[prior] = (70.0,)
    cm[missed] = (40.0, 10.0)
    cm[missed + 12 * day] = (40.0, 1.0)
    spot[missed] = (1.0,)
    trades = c.signal_trades(cm, spot)
    if len(trades) != 1 or trades[0]["entry_ms"] != entry:
        raise SystemExit("the split was not yesterday's closes")
    if trades[0]["exit_ms"] - trades[0]["entry_ms"] != 12 * day:
        raise SystemExit("the hold is not twelve days")
    want = _net(Decimal(50), Decimal(60))
    if abs(trades[0]["net"] - float(want)) > 1e-12:
        raise SystemExit("the one-leg fill moved")
    pool = {stamp for stamp, _exit in c.pool_spans(cm)}
    if entry not in pool or missed not in pool:
        raise SystemExit("the null dropped a twelve-day long")
    if c.signal_trades({c.fp5.SCREEN_END_MS: (100.0, 100.0)}, {}):
        raise SystemExit("a 2024 open was an entry")


def main() -> None:
    test_the_split_uses_finished_closes()
    print("fp230 pins ok")


if __name__ == "__main__":
    main()
