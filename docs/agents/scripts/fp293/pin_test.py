from __future__ import annotations

"""Pins for the fp293 rule. No file and no return from 2023 is read."""

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
    if c.IDEA != 'CHEAPC' or c.HOLD_DAYS != 11 or c.NULL_KIND != "other_regime":
        raise SystemExit("the idea moved")
    if c.MODE != "regime" or c.RULE_SIDE != 'long' or c.RULE_BOOK != 'cm':
        raise SystemExit("the leg moved")
    if c.DISCOUNT != None:
        raise SystemExit("the discount moved")
    day = c.fp5.DAY_MS
    entry = c.fp5.SCREEN_START_MS + 80 * day
    off = entry + 40 * day
    spot, um, cm = {}, {}, {}
    books = {"spot": spot, "um": um, "cm": cm}
    traded = books['cm']
    fair = books['um']
    _put(traded, entry - day, 1, 99.0)
    _put(fair, entry - day, 1, 100.0)
    _put(traded, entry, 50, 1)
    _put(traded, entry + 11 * day, 55, 1)
    _put(traded, off - day, 1, 100.0)
    _put(fair, off - day, 1, 100.0)
    _put(traded, off, 40, 1)
    _put(traded, off + 11 * day, 44, 1)
    rules = c.rule_trades(spot, um, cm)
    nulls = c.null_trades(spot, um, cm)
    if [t["entry_ms"] for t in rules] != [entry] or rules[0]["book"] != 'cm' or rules[0]["side"] != 'long':
        raise SystemExit("the price edge was not the traded leg")
    if [t["entry_ms"] for t in nulls] != [off] or nulls[0]["side"] != 'long':
        raise SystemExit("the edge-off trade was not the same leg")
    if abs(rules[0]["net"] - float(_long(Decimal(50), Decimal(55)))) > 1e-12:
        raise SystemExit("the edge fill moved")
    if abs(nulls[0]["net"] - float(_long(Decimal(40), Decimal(44)))) > 1e-12:
        raise SystemExit("the edge-off fill moved")
    blind = dict(fair)
    del blind[entry - day]
    args = {"spot": spot, "um": um, "cm": cm}
    args['um'] = blind
    if any(t["entry_ms"] == entry for t in c.rule_trades(args["spot"], args["um"], args["cm"])):
        raise SystemExit("a missing fair-value close was filled in")
    wrecked = dict(traded)
    wrecked[entry] = (500.0, wrecked[entry][1])
    args = {"spot": spot, "um": um, "cm": cm}
    args['cm'] = wrecked
    if [t["entry_ms"] for t in c.rule_trades(args["spot"], args["um"], args["cm"])] != [entry]:
        raise SystemExit("the entry open moved the edge")
    thin = dict(traded)
    del thin[entry + 11 * day]
    args = {"spot": spot, "um": um, "cm": cm}
    args['cm'] = thin
    if any(t["entry_ms"] == entry for t in c.rule_trades(args["spot"], args["um"], args["cm"])):
        raise SystemExit("a missing open was borrowed")
    if c.rule_trades({c.fp5.SCREEN_END_MS: (100.0, 100.0)}, {c.fp5.SCREEN_END_MS: (100.0, 100.0)}, {c.fp5.SCREEN_END_MS: (100.0, 100.0)}):
        raise SystemExit("a 2024 open was an entry")


def main() -> None:
    test_rule()
    print("fp293 pins ok")


if __name__ == "__main__":
    main()
