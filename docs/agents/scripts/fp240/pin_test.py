from __future__ import annotations

"""Pins for the fp240 rule. No file and no return from 2023 is read."""

import sys
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import common as c


def _long(entry: Decimal, exit_px: Decimal) -> Decimal:
    fee = Decimal("0.001")
    return (exit_px * (1 - fee)) / (entry * (1 + fee)) - 1


def _put(book, ts, open_px, close_px):
    book[ts] = (float(open_px), float(close_px))


def test_coin_margined_finished_ahead() -> None:
    if c.IDEA != "LEAD" or c.MIN_N != 30 or c.HOLD_DAYS != 5:
        raise SystemExit("the idea moved")
    day = c.fp5.DAY_MS
    entry = c.fp5.SCREEN_START_MS + 40 * day
    missed = entry + 80 * day
    cm, spot = {}, {}
    yesterday = entry - day
    _put(cm, yesterday, 1, 110)
    _put(cm, yesterday - 8 * day, 1, 100)
    _put(spot, yesterday, 1, 100)
    _put(spot, yesterday - 8 * day, 1, 100)
    _put(spot, entry, 30, 200)
    _put(spot, entry + 5 * day, 40, 1)
    prior = missed - day
    _put(cm, prior, 1, 110)
    _put(cm, prior - 8 * day, 1, 100)
    _put(spot, prior, 1, 130)
    _put(spot, prior - 8 * day, 1, 100)
    _put(spot, missed, 25, 90)
    _put(spot, missed + 5 * day, 25, 1)
    trades = c.signal_trades(cm, spot)
    if len(trades) != 1 or trades[0]["entry_ms"] != entry:
        raise SystemExit("spot was bought when it had not lagged")
    want = _long(Decimal(30), Decimal(40))
    if abs(trades[0]["net"] - float(want)) > 1e-12:
        raise SystemExit("the one-leg long moved")
    pool = {stamp for stamp, _exit in c.pool_spans(cm, spot)}
    if entry not in pool or missed not in pool:
        raise SystemExit("the null dropped a five-day long")
    if c.signal_trades({}, {c.fp5.SCREEN_END_MS: (100.0, 100.0)}):
        raise SystemExit("a 2024 open was an entry")


def main() -> None:
    test_coin_margined_finished_ahead()
    print("fp240 pins ok")


if __name__ == "__main__":
    main()
