"""The basis change is the result. A spot move is not."""

from __future__ import annotations

import inspect
import sys
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import common as c


def _bars():
    day = c.fp5.DAY_MS
    entry = c.fp5.SCREEN_START_MS + 30 * day
    other = entry + 10 * day
    expiry = c.EXPIRY["BTCUSDT_230331"]
    if not (entry < expiry and other < expiry):
        raise SystemExit("the pin dates are past delivery")
    spot = {
        entry - day: ("100", "100"),
        entry: ("100", "100"),
        other - day: ("100", "100"),
        other: ("40", "40"),
        expiry: ("200", "200"),
    }
    future = {
        entry - day: ("100", "101"),
        entry: ("102", "102"),
        other - day: ("100", "100.5"),
        other: ("40.2", "40.2"),
        expiry: ("200", "200"),
    }
    return entry, other, expiry, spot, {"BTCUSDT_230331": future}


def test_rule() -> None:
    if "net_return" in inspect.getsource(c.paths):
        raise SystemExit("the spot move was scored")
    if c.THRESHOLD_BPS != Decimal("100") or c.COST != Decimal("0.004"):
        raise SystemExit("the threshold or the cost moved")
    if c.RULE_N != 125 or c.NULL_N != 240:
        raise SystemExit("the freeze moved")
    entry, other, expiry, spot, books = _bars()
    rules = c.rule_trades(spot, books)
    nulls = c.null_trades(spot, books)
    if [row["entry_ms"] for row in rules] != [entry]:
        raise SystemExit("a 100 bp previous close was not the package")
    if [row["entry_ms"] for row in nulls] != [other]:
        raise SystemExit("the edge-off package was not the same side")
    if rules[0]["side"] != "short_basis" or rules[0]["exit_ms"] != expiry:
        raise SystemExit("the exit is not the expiry open")
    expected = (Decimal(200) - Decimal(0) - Decimal(40)) / Decimal(10000)
    if abs(Decimal(str(rules[0]["net"])) - expected) > Decimal("1e-12"):
        raise SystemExit("the basis change was not the result")
    spot_move = Decimal(200) / Decimal(100) - 1
    if abs(Decimal(str(rules[0]["gross"])) - spot_move) < Decimal("0.01"):
        raise SystemExit("the spot move was scored")
    moved = dict(spot)
    moved[entry] = ("999", "100")
    if [row["entry_ms"] for row in c.rule_trades(moved, books)] != [entry]:
        raise SystemExit("the entry open moved the signal")
    opened = dict(books["BTCUSDT_230331"])
    opened[entry - c.fp5.DAY_MS] = ("1", "101")
    books_open = {"BTCUSDT_230331": opened}
    if [row["entry_ms"] for row in c.rule_trades(spot, books_open)] != [entry]:
        raise SystemExit("the previous open was read as the close")
    wide = dict(books["BTCUSDT_230331"])
    wide[entry - c.fp5.DAY_MS] = ("100", "101", "999")
    try:
        c.rule_trades(spot, {"BTCUSDT_230331": wide})
    except SystemExit as exc:
        if "high or a low" not in str(exc):
            raise
    else:
        raise SystemExit("a high or a low was read")
    thin = dict(books["BTCUSDT_230331"])
    del thin[expiry]
    if c.rule_trades(spot, {"BTCUSDT_230331": thin}):
        raise SystemExit("a missing expiry open was borrowed")
    late = c.EXPIRY["BTCUSDT_230331"] + c.fp5.DAY_MS
    if late < c.fp5.SCREEN_END_MS:
        after = dict(spot)
        after[late] = ("100", "100")
        after[late - c.fp5.DAY_MS] = ("100", "100")
        fut = dict(books["BTCUSDT_230331"])
        fut[late] = ("200", "200")
        fut[late - c.fp5.DAY_MS] = ("100", "200")
        if any(row["entry_ms"] == late for row in c.rule_trades(after, {"BTCUSDT_230331": fut})):
            raise SystemExit("an expired contract was still the front")


def main() -> None:
    test_rule()
    print("fp332 pins ok")


if __name__ == "__main__":
    main()
