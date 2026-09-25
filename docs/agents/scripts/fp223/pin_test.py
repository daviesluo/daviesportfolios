from __future__ import annotations

"""Pins for the fp223 rule. No file and no return from 2023 is read."""

import sys
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import common as c


def _net(entry: Decimal, exit_px: Decimal) -> Decimal:
    fee = Decimal("0.001")
    return (exit_px * (1 - fee)) / (entry * (1 + fee)) - 1


def _case(entry: int, earlier: float, later: float) -> tuple[dict, dict]:
    um = {entry: (100.0,), entry + 7 * c.fp5.DAY_MS: (130.0,)}
    fund = {
        entry - 8 * c.fp5.DAY_MS: (earlier,),
        entry - c.fp5.DAY_MS: (later,),
    }
    return um, fund


def test_a_funding_decline_is_a_seven_day_long() -> None:
    if c.IDEA != "FWK" or c.MIN_N != 30 or c.HOLD_DAYS != 7:
        raise SystemExit("the idea moved")
    entry = c.fp5.SCREEN_START_MS + 10 * c.fp5.DAY_MS
    rose = entry + c.fp5.DAY_MS
    flat = entry + 2 * c.fp5.DAY_MS
    um, fund = _case(entry, 0.001, -0.0002)
    um.update(_case(rose, 0.001, 0.002)[0])
    fund.update(_case(rose, 0.001, 0.002)[1])
    um.update(_case(flat, 0.001, 0.001)[0])
    fund.update(_case(flat, 0.001, 0.001)[1])
    trades = c.signal_trades(um, fund)
    if len(trades) != 1 or trades[0]["entry_ms"] != entry:
        raise SystemExit("the funding decline did not fill")
    if trades[0]["exit_ms"] - trades[0]["entry_ms"] != 7 * c.fp5.DAY_MS:
        raise SystemExit("the hold is not seven days")
    want = _net(Decimal(100), Decimal(130))
    if abs(trades[0]["net"] - float(want)) > 1e-12:
        raise SystemExit("the one-leg fill moved")
    if abs(trades[0]["gross"] - (130.0 / 100.0 - 1.0)) > 1e-12:
        raise SystemExit("the gross is not the seven-day open")
    if abs(trades[0]["gross"] - (0.001 - -0.0002)) < 1e-6:
        raise SystemExit("the gross is the funding change")
    spans = {day for day, _exit in c.pool_spans(um, fund)}
    if entry not in spans or rose not in spans or flat not in spans:
        raise SystemExit("the null dropped a rise or a flat week")
    missing = {entry: (100.0,), entry + 7 * c.fp5.DAY_MS: (130.0,)}
    if c.signal_trades(missing, {entry - c.fp5.DAY_MS: (0.0,)}):
        raise SystemExit("a missing week-ago print fired")
    if c.signal_trades(*_case(c.fp5.SCREEN_END_MS, 0.001, -0.001)):
        raise SystemExit("a 2024 open was an entry")


def main() -> None:
    test_a_funding_decline_is_a_seven_day_long()
    print("fp223 pins ok")


if __name__ == "__main__":
    main()
