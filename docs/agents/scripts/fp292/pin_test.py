from __future__ import annotations

"""Pins for the fp292 rule. No file and no return from 2023 is read."""

import sys
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import common as c


def _long(entry: Decimal, exit_px: Decimal) -> Decimal:
    fee = Decimal("0.001")
    return (exit_px * (1 - fee)) / (entry * (1 + fee)) - 1


def _short(entry: Decimal, exit_px: Decimal) -> Decimal:
    fee = Decimal("0.001")
    return (entry * (1 - fee)) / (exit_px * (1 + fee)) - 1


def _put(book, ts, open_px, close_px):
    book[ts] = (float(open_px), float(close_px))



def test_rule() -> None:
    if c.IDEA != 'WIDEN' or c.HOLD_DAYS != 8 or c.NULL_KIND != "other_regime":
        raise SystemExit("the idea moved")
    if c.DISCOUNT is not None or c.RULE_SIDE != "short" or c.RULE_BOOK != 'um':
        raise SystemExit("the basis moved")
    day = c.fp5.DAY_MS
    entry = c.fp5.SCREEN_START_MS + 80 * day
    off = entry + 40 * day
    spot, um, cm = {}, {}, {}
    books = {"spot": spot, "um": um, "cm": cm}
    traded = books['um']
    fair = books['spot']
    _put(traded, entry - day, 1, 101)
    _put(fair, entry - day, 1, 100)
    _put(traded, entry - day - 5 * day, 1, 100)
    _put(fair, entry - day - 5 * day, 1, 100)
    _put(traded, entry, 50, 1)
    _put(traded, entry + 8 * day, 45, 1)
    for ts in (off - day, off - day - 5 * day):
        _put(traded, ts, 1, 100)
        _put(fair, ts, 1, 100)
    _put(traded, off, 40, 1)
    _put(traded, off + 8 * day, 42, 1)
    rules = c.rule_trades(spot, um, cm)
    nulls = c.null_trades(spot, um, cm)
    if [t["entry_ms"] for t in rules] != [entry] or rules[0]["side"] != "short":
        raise SystemExit("the wider basis was not sold")
    if [t["entry_ms"] for t in nulls] != [off]:
        raise SystemExit("the edge-off trade was not the same short")
    if abs(rules[0]["net"] - float(_short(Decimal(50), Decimal(45)))) > 1e-12:
        raise SystemExit("the edge fill moved")
    if abs(nulls[0]["net"] - float(_short(Decimal(40), Decimal(42)))) > 1e-12:
        raise SystemExit("the edge-off fill moved")
    blind = dict(fair)
    del blind[entry - day]
    args = {"spot": spot, "um": um, "cm": cm}
    args['spot'] = blind
    if any(t["entry_ms"] == entry for t in c.rule_trades(args["spot"], args["um"], args["cm"])):
        raise SystemExit("a missing fair-value close was filled in")
    wrecked = dict(traded)
    wrecked[entry] = (500.0, wrecked[entry][1])
    args = {"spot": spot, "um": um, "cm": cm}
    args['um'] = wrecked
    if [t["entry_ms"] for t in c.rule_trades(args["spot"], args["um"], args["cm"])] != [entry]:
        raise SystemExit("the entry open moved the edge")
    thin = dict(traded)
    del thin[entry + 8 * day]
    args = {"spot": spot, "um": um, "cm": cm}
    args['um'] = thin
    if any(t["entry_ms"] == entry for t in c.rule_trades(args["spot"], args["um"], args["cm"])):
        raise SystemExit("a missing open was borrowed")
    if c.rule_trades({c.fp5.SCREEN_END_MS: (100.0, 100.0)}, {c.fp5.SCREEN_END_MS: (100.0, 100.0)}, {c.fp5.SCREEN_END_MS: (100.0, 100.0)}):
        raise SystemExit("a 2024 open was an entry")


def main() -> None:
    test_rule()
    print("fp292 pins ok")


if __name__ == "__main__":
    main()
