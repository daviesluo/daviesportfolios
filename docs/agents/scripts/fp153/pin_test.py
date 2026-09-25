from __future__ import annotations

"""Pins for the fp153 rule. No file and no return from 2023 is read."""

import sys
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import common as c


def test_carry_is_not_a_long() -> None:
    if c.IDEA != "BASBOOK":
        raise SystemExit("the idea moved")
    fee = Decimal("0.001")
    long_net = (Decimal(101) * (1 - fee)) / (Decimal(100) * (1 + fee)) - 1
    short_net = (Decimal(200) * (1 - fee)) / (Decimal(202) * (1 + fee)) - 1
    want = long_net + short_net + Decimal("0.0002") + Decimal("0.0004")
    gross, net = c.carry_net(100.0, 101.0, 200.0, 202.0, 0.0002, 0.0004)
    if abs(net - float(want)) > 1e-12:
        raise SystemExit("the two-leg fill moved")
    if abs(net - c.fp5.net_return(100.0, 101.0)) < 1e-9:
        raise SystemExit("the book collapsed to a long")
    hand_gross = (101 / 100 - 1) + (200 / 202 - 1) + 0.0002 + 0.0004
    if abs(gross - hand_gross) > 1e-12:
        raise SystemExit("the gross dropped a leg")


def test_positive_close_only() -> None:
    day = c.fp5.SCREEN_START_MS - c.fp5.DAY_MS
    entry = c.fp5.SCREEN_START_MS
    later = entry + c.fp5.DAY_MS
    spot = {entry: (100.0,), later: (101.0,)}
    um = {entry: (200.0,), later: (202.0,)}
    events = [
        (entry, 0.0001),
        (entry + c.fp5.EIGHT_H_MS, 0.0002),
        (entry + 2 * c.fp5.EIGHT_H_MS, 0.0004),
    ]
    funding = c.funding_hours(events)
    trades = c.signal_trades({day: (0.001,)}, spot, um, funding)
    if len(trades) != 1 or trades[0]["entry_ms"] != entry:
        raise SystemExit("a positive premium close did not enter the next open")
    if trades[0]["exit_ms"] - trades[0]["entry_ms"] != c.fp5.DAY_MS:
        raise SystemExit("the hold is not one day")
    _, want = c.carry_net(100.0, 101.0, 200.0, 202.0, 0.0002, 0.0004)
    if abs(trades[0]["net"] - want) > 1e-12:
        raise SystemExit("the fill does not match the two legs")
    if c.signal_trades({day: (0.0,)}, spot, um, funding):
        raise SystemExit("a zero premium close fired")
    if c.signal_trades({day: (-0.01,)}, spot, um, funding):
        raise SystemExit("a negative premium close was longed")
    rich_jump = {day - c.fp5.DAY_MS: (-0.02,), day: (-0.001,)}
    if c.signal_days(rich_jump) :
        raise SystemExit("a jump that stayed negative fired")
    if c.signal_trades({c.fp5.SCREEN_END_MS: (0.01,)}, spot, um, funding):
        raise SystemExit("a 2024 premium day was an entry")
    # Funding on the signal day is not the cashflow of the hold.
    wrong = c.funding_hours([
        (day, 0.01),
        (day + c.fp5.EIGHT_H_MS, 0.01),
        (day + 2 * c.fp5.EIGHT_H_MS, 0.01),
    ])
    if c.signal_trades({day: (0.001,)}, spot, um, wrong):
        raise SystemExit("funding from the signal day filled the hold")


def test_duplicate_hour() -> None:
    entry = c.fp5.SCREEN_START_MS
    try:
        c.funding_hours([(entry, 0.0001), (entry + 1_000, 0.0002)])
    except ValueError:
        return
    raise SystemExit("two prints in one hour were kept")


def main() -> None:
    test_carry_is_not_a_long()
    test_positive_close_only()
    test_duplicate_hour()
    print("fp153 pins ok")


if __name__ == "__main__":
    main()
