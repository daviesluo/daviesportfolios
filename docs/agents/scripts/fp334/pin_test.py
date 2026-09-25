"""The funding cash is the result. The coin's move is not. The previous interval is not the signal."""

from __future__ import annotations

import inspect
import sys
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import common as c


def _book(stamps, spot, premium_bps):
    spot_bars = {}
    perp_bars = {}
    factor = Decimal(1) + premium_bps / Decimal(10000)
    for stamp in stamps:
        spot_bars[stamp] = (spot, spot)
        perp_bars[stamp] = (format(Decimal(spot) * factor, "f"), format(Decimal(spot) * factor, "f"))
    return spot_bars, perp_bars


def test_rule() -> None:
    if "net_return" in inspect.getsource(c.paths):
        raise SystemExit("the spot move was scored")
    if c.THRESHOLD_BPS != Decimal("50") or c.COST != Decimal("0.004"):
        raise SystemExit("the threshold or the cost moved")
    if c.RULE_N != 85 or c.NULL_N != 815 or c.RULE_DAYS != 36:
        raise SystemExit("the freeze moved")
    day = c.fp5.DAY_MS
    settle = c.fp5.SCREEN_START_MS + 20 * day + 8 * c.HOUR_MS
    entry = settle - c.HOUR_MS
    exit_ms = settle + c.HOUR_MS
    window = [settle - i * c.HOUR_MS for i in range(2, 9)]
    spot, perp = _book(window + [entry, exit_ms], "100", Decimal(-50))
    # The coin doubles into the exit. That move is not the result.
    spot[exit_ms] = ("200", "200")
    perp[exit_ms] = ("200", "200")
    funding = {settle: (8, Decimal("-0.008"))}
    rules = c.rule_trades(spot, perp, funding)
    if [row["entry_ms"] for row in rules] != [entry]:
        raise SystemExit("a 50 bp completed premium was not the cash")
    if rules[0]["exit_ms"] != exit_ms or rules[0]["side"] != "long_cash":
        raise SystemExit("the hedge was not held across the settlement")
    expected = (Decimal(80) - Decimal(40)) / Decimal(10000)
    if abs(Decimal(str(rules[0]["net"])) - expected) > Decimal("1e-12"):
        raise SystemExit("the cash was not the result")
    spot_move = Decimal(200) / Decimal(100) - 1
    if abs(Decimal(str(rules[0]["gross"])) - spot_move) < Decimal("0.01"):
        raise SystemExit("the spot move was scored")
    funded = {settle: (8, Decimal("-0.001"))}
    still = c.rule_trades(spot, perp, funded)
    if [row["entry_ms"] for row in still] != [entry]:
        raise SystemExit("the funding print was used as the signal")
    if abs(Decimal(str(still[0]["net"])) - (Decimal(10) - Decimal(40)) / Decimal(10000)) > Decimal("1e-12"):
        raise SystemExit("the cash result did not follow the print")
    # The hour before settlement is outside this interval's completed window.
    four_spot, four_perp = _book(
        [settle - i * c.HOUR_MS for i in range(2, 5)] + [entry, exit_ms],
        "100",
        Decimal(-10),
    )
    four_perp[settle - 5 * c.HOUR_MS] = ("80", "80")
    four_spot[settle - 5 * c.HOUR_MS] = ("100", "100")
    four = c.rule_trades(four_spot, four_perp, {settle: (4, Decimal("-0.020"))})
    if four:
        raise SystemExit("the previous interval was read as this settlement")
    rich_window = dict(perp)
    for stamp in window:
        rich_window[stamp] = ("100", "100")
    if c.rule_trades(spot, rich_window, funding):
        raise SystemExit("a premium that was not 50 bp cheap was taken")
    if not c.null_trades(spot, rich_window, funding):
        raise SystemExit("the edge-off package was dropped")
    thin = dict(spot)
    del thin[exit_ms]
    if c.rule_trades(thin, perp, funding):
        raise SystemExit("a missing exit open was borrowed")
    gap = dict(spot)
    del gap[window[0]]
    if c.rule_trades(gap, perp, funding) or c.null_trades(gap, perp, funding):
        raise SystemExit("a missing hour was filled in")


def main() -> None:
    test_rule()
    print("fp334 pins ok")


if __name__ == "__main__":
    main()
