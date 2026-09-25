"""The premium change is the result. A spot move is not. The cheap side is not a second rule."""

from __future__ import annotations

import inspect
import sys
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import common as c


def _px(spot: str, premium_bps: Decimal) -> str:
    """Perpetual price for one thousand coins, at a premium over `spot`."""
    coin = Decimal(spot) * (Decimal(1) + premium_bps / Decimal(10000))
    return format(coin * c.MULTIPLIER, "f")


def test_rule() -> None:
    if "net_return" in inspect.getsource(c.paths):
        raise SystemExit("the spot move was scored")
    if c.THRESHOLD_BPS != Decimal("50") or c.MULTIPLIER != Decimal(1000):
        raise SystemExit("the threshold or the multiplier moved")
    if c.RULE_N != 48 or c.NULL_N != 191:
        raise SystemExit("the freeze moved")
    day = c.fp5.DAY_MS
    entry = c.fp5.SCREEN_START_MS + 200 * day
    other = entry + 2 * day
    cheap = entry + 4 * day
    # The rule exits on the open of entry+day. That same bar's close is the
    # other trade's previous close, so the two prices are not the same number.
    spot = {
        entry - day: ("100", "100"),
        entry: ("100", "110"),
        entry + day: ("200", "100"),
        other: ("100", "100"),
        other + day: ("100", "100"),
        cheap - day: ("100", "100"),
        cheap: ("100", "100"),
        cheap + day: ("100", "100"),
    }
    perp = {
        entry - day: (_px("100", Decimal(50)), _px("100", Decimal(50))),
        entry: (_px("100", Decimal(100)), _px("100", Decimal(100))),
        entry + day: (_px("200", Decimal(0)), _px("100", Decimal(10))),
        other: (_px("100", Decimal(10)), _px("100", Decimal(10))),
        other + day: (_px("100", Decimal(10)), _px("100", Decimal(10))),
        cheap - day: (_px("100", Decimal(-80)), _px("100", Decimal(-80))),
        cheap: (_px("100", Decimal(-80)), _px("100", Decimal(-80))),
        cheap + day: (_px("100", Decimal(0)), _px("100", Decimal(0))),
    }
    rules = c.rule_trades(spot, perp)
    nulls = c.null_trades(spot, perp)
    if [row["entry_ms"] for row in rules] != [entry]:
        raise SystemExit("a 50 bp previous premium was not the package")
    if cheap in [row["entry_ms"] for row in rules]:
        raise SystemExit("the cheap perpetual was scored as a second rule")
    null_entries = [row["entry_ms"] for row in nulls]
    if other not in null_entries or cheap not in null_entries:
        raise SystemExit("the edge-off package was not the same side")
    if any(row["side"] != "short_premium" for row in nulls):
        raise SystemExit("the edge-off package was not the same side")
    expected = (Decimal(100) - Decimal(0) - Decimal(40)) / Decimal(10000)
    if abs(Decimal(str(rules[0]["net"])) - expected) > Decimal("1e-9"):
        raise SystemExit("the premium change was not the result")
    spot_move = Decimal(200) / Decimal(100) - 1
    if abs(Decimal(str(rules[0]["gross"])) - spot_move) < Decimal("0.01"):
        raise SystemExit("the spot move was scored")
    if rules[0]["exit_ms"] - rules[0]["entry_ms"] != day:
        raise SystemExit("the hold is not the next daily open")
    moved = dict(spot)
    moved[entry] = ("50", "110")
    if [row["entry_ms"] for row in c.rule_trades(moved, perp)] != [entry]:
        raise SystemExit("the entry open moved the signal")
    thin = dict(spot)
    del thin[entry + day]
    if any(row["entry_ms"] == entry for row in c.rule_trades(thin, perp)):
        raise SystemExit("a missing exit open was borrowed")
    wide = dict(perp)
    wide[entry - day] = (_px("100", Decimal(50)), _px("100", Decimal(50)), "9")
    try:
        c.rule_trades(spot, wide)
    except SystemExit as exc:
        if "high or a low" not in str(exc):
            raise
    else:
        raise SystemExit("a high or a low was read")


def main() -> None:
    test_rule()
    print("fp333 pins ok")


if __name__ == "__main__":
    main()
