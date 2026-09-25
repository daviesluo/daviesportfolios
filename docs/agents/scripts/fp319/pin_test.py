from __future__ import annotations

"""Pins for the fp319 rule. No file and no return from 2023 is read."""

import sys
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import common as c


def _long(entry: Decimal, exit_px: Decimal) -> Decimal:
    fee = Decimal("0.001")
    return (exit_px * (1 - fee)) / (entry * (1 + fee)) - 1


def test_rule() -> None:
    if c.IDEA != "ESOFR" or c.HOLD_DAYS != 2 or c.NULL_KIND != "other_regime":
        raise SystemExit("the idea moved")
    if c.MODE != "regime" or c.RULE_SIDE != "long" or c.RULE_BOOK != "um":
        raise SystemExit("the leg moved")
    if c.FAIR_KIND != "sofr" or c.COIN != "ETHUSDT":
        raise SystemExit("the fair value moved")
    day = c.fp5.DAY_MS
    entry = c.fp5.SCREEN_START_MS + 80 * day
    off = entry + 40 * day
    book = {}
    fund = {}
    book[entry] = (50.0,)
    book[entry + c.HOLD_DAYS * day] = (55.0,)
    book[off] = (40.0,)
    book[off + c.HOLD_DAYS * day] = (42.0,)

    sofr = {}
    # Published the day before the entry. 4.31% is about 0.0000399 per eight hours.
    sofr[entry - day] = "4.31"
    sofr[off - day] = "4.31"
    # A publication stamped on the entry itself is not already out.
    sofr[entry] = "0.01"
    fund[entry - 8 * 3_600_000] = 0.00001
    fund[off - 8 * 3_600_000] = 0.001
    if abs(c.sofr_eight("4.31") - float(Decimal("4.31") / Decimal(100) * Decimal(8) / Decimal(24) / Decimal(360))) > 1e-18:
        raise SystemExit("the SOFR eight-hour rate moved")
    paired = c.pair_sofr([("2023-01-13", "4.30"), ("2023-01-17", "4.31"), ("2023-01-18", "4.30")])
    if paired[0] != (c.utc_ms(2023, 1, 17, 13), "4.30"):
        raise SystemExit("a Friday SOFR print was published before the next business morning")
    if c.pair_sofr([("2023-12-29", "5.38"), ("2024-01-02", "5.40")]):
        raise SystemExit("a SOFR print published in 2024 was stored")

    rules = c.rule_trades(book, fund, sofr)
    nulls = c.null_trades(book, fund, sofr)
    if [t["entry_ms"] for t in rules] != [entry] or rules[0]["book"] != c.RULE_BOOK or rules[0]["side"] != "long":
        raise SystemExit("the price edge was not the traded leg")
    if [t["entry_ms"] for t in nulls] != [off] or nulls[0]["side"] != "long" or nulls[0]["book"] != c.RULE_BOOK:
        raise SystemExit("the edge-off trade was not the same leg")
    if abs(rules[0]["net"] - float(_long(Decimal(50), Decimal(55)))) > 1e-12:
        raise SystemExit("the edge fill moved")
    if abs(nulls[0]["net"] - float(_long(Decimal(40), Decimal(42)))) > 1e-12:
        raise SystemExit("the edge-off fill moved")
    late = dict(fund)
    late[entry] = -1.0 if c.FAIR_KIND == "index" else 1.0
    if [t["entry_ms"] for t in c.rule_trades(book, late, sofr)] != [entry]:
        raise SystemExit("a rate stamped on the entry was used")
    missing = dict(fund)
    del missing[entry - 8 * 3_600_000]
    if any(t["entry_ms"] == entry for t in c.rule_trades(book, missing, sofr)):
        raise SystemExit("a rate that was not yet settled was used")
    wrecked = dict(book)
    wrecked[entry] = (500.0,)
    if [t["entry_ms"] for t in c.rule_trades(wrecked, fund, sofr)] != [entry]:
        raise SystemExit("the entry open moved the edge")
    thin = dict(book)
    del thin[entry + c.HOLD_DAYS * day]
    if any(t["entry_ms"] == entry for t in c.rule_trades(thin, fund, sofr)):
        raise SystemExit("a missing open was borrowed")
    empty = {c.fp5.SCREEN_END_MS: (100.0,)}
    if c.rule_trades(empty, fund, sofr):
        raise SystemExit("a 2024 open was an entry")


def main() -> None:
    test_rule()
    print("fp319 pins ok")


if __name__ == "__main__":
    main()
