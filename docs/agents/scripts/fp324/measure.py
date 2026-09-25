"""Score this rule on 2023. No later year is an entry."""

from __future__ import annotations

import hashlib
import json
import os
import sys
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import common as c

FOLDER = Path(__file__).resolve().parent.name
ROOT = Path(__file__).resolve().parents[4]
DATA = Path(os.environ.get(f"{FOLDER.upper()}_DATA", f"/tmp/{FOLDER}/data"))
PROTOCOL = ROOT / "docs" / "agents" / "reviews" / f"2026-09-25-{FOLDER}-protocol.md"
FIELDS = {"coin", "book", "side", "entry_ms", "exit_ms", "gross", "net", "pnl"}


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def load_book(path: Path) -> dict[int, tuple[Decimal, Decimal]]:
    rows = json.loads(path.read_text())
    out = {}
    for row in rows:
        if len(row) != 3:
            raise SystemExit(f"{path.name} carries a field this rule does not use")
        ts = int(row[0])
        if ts >= c.fp5.SCREEN_END_MS:
            raise SystemExit(f"{path.name} goes past the window")
        opened, closed = Decimal(row[1]), Decimal(row[2])
        if opened <= 0 or closed <= 0:
            raise SystemExit("a bar is not a price")
        out[ts] = (opened, closed)
    if len(out) != c.BOOK_ROWS or min(out) != c.BOOK_FIRST or max(out) != c.BOOK_LAST:
        raise SystemExit(path.name + " stops on the wrong day")
    if max(out) - min(out) != (len(out) - 1) * c.fp5.DAY_MS:
        raise SystemExit("an interior day is missing")
    if out[c.BOOK_FIRST] != (Decimal(c.BOOK_FIRST_OPEN), Decimal(c.BOOK_FIRST_CLOSE)):
        raise SystemExit("the first bar moved")
    if out[c.BOOK_LAST] != (Decimal(c.BOOK_LAST_OPEN), Decimal(c.BOOK_LAST_CLOSE)):
        raise SystemExit("the last bar moved")
    return out


def load_part(path: Path, shape: dict) -> dict[int, Decimal]:
    rows = json.loads(path.read_text())
    out = {}
    for row in rows:
        if len(row) != 2:
            raise SystemExit("the fair value carries a field this rule does not use")
        ts = int(row[0])
        if ts >= c.fp5.SCREEN_END_MS:
            raise SystemExit("a fair value published on the exit day was stored")
        px = Decimal(row[1])
        if px <= 0:
            raise SystemExit("a fair value is not a price")
        out[ts] = px
    stamps = sorted(out)
    if (
        len(stamps) != shape["n"]
        or stamps[0] != shape["first"]
        or stamps[-1] != shape["last"]
        or format(out[stamps[0]], "f") != shape["first_px"]
        or format(out[stamps[-1]], "f") != shape["last_px"]
    ):
        raise SystemExit(path.name + " does not have the frozen shape")
    return out


def check_common(trade: dict) -> None:
    if set(trade) != FIELDS:
        raise SystemExit("a fill carries a field this rule does not use")
    if trade["coin"] != c.COIN or trade["book"] != c.RULE_BOOK or trade["side"] != "long":
        raise SystemExit("the leg moved")
    if not (c.fp5.SCREEN_START_MS <= trade["entry_ms"] < c.fp5.SCREEN_END_MS):
        raise SystemExit("a 2024 open was read as an entry")
    if trade["exit_ms"] - trade["entry_ms"] != c.HOLD_DAYS * c.fp5.DAY_MS:
        raise SystemExit("the hold moved")
    if trade["exit_ms"] - trade["entry_ms"] <= c.fp5.DAY_MS:
        raise SystemExit("the hold is one day or overnight")
    if abs(trade["pnl"] - 100.0 * trade["net"]) > 1e-9:
        raise SystemExit("the dollar result is not a hundred dollars times the net")


def check_prices(trade: dict, book: dict) -> None:
    entry_px = float(book[trade["entry_ms"]][0])
    exit_px = float(book[trade["exit_ms"]][0])
    gross = exit_px / entry_px - 1.0
    net = c.fp5.net_return(entry_px, exit_px)
    if abs(trade["gross"] - gross) > 1e-12 or abs(trade["net"] - net) > 1e-12:
        raise SystemExit("the fill is not this contract's open")


def check_shape(rule_spans, null_spans, book) -> None:
    if c.NULL_KIND != "other_regime" or c.MODE != "regime":
        raise SystemExit("the null is not the edge turned off")
    hold = c.HOLD_DAYS * c.fp5.DAY_MS
    for entry, exit_ms in list(rule_spans) + list(null_spans):
        if exit_ms - entry != hold or exit_ms - entry <= c.fp5.DAY_MS:
            raise SystemExit("a hold moved")
    rule_entries = [entry for entry, _exit in rule_spans]
    null_entries = [entry for entry, _exit in null_spans]
    if set(rule_entries) & set(null_entries):
        raise SystemExit("a day is in both trades")
    if len(null_entries) < len(rule_entries):
        raise SystemExit("the other trade is shorter than the rule")
    if len(rule_entries) != c.RULE_N or len(null_entries) != c.NULL_N:
        raise SystemExit("the scored count does not match the freeze")
    if c.fillable(book) != c.FILLABLE_N:
        raise SystemExit("the fillable count moved")
    if c.FILLABLE_N - len(rule_entries) - len(null_entries) != c.NEITHER_N:
        raise SystemExit("a missing print was scored as the other trade")


def run() -> None:
    book_path = DATA / c.BOOK_DIR / f"{c.SYMBOL}.json"
    book = load_book(book_path)
    inputs = {"book": sha256(book_path)}
    parts = {}
    for name, shape in c.PARTS.items():
        path = DATA / "fair" / shape["file"]
        parts[name] = load_part(path, shape)
        inputs[name] = sha256(path)
    trades = c.rule_trades(book, parts)
    nulls = c.null_trades(book, parts)
    spans = c.rule_spans(book, parts)
    pool_spans = c.null_spans(book, parts)
    if [t["entry_ms"] for t in trades] != [entry for entry, _exit in spans]:
        raise SystemExit("the fills and the spans diverged")
    if not trades:
        raise SystemExit("the rule has no fill")
    for trade in trades:
        check_common(trade)
        check_prices(trade, book)
        if not c._rule_on(book, parts, trade["entry_ms"]):
            raise SystemExit("the signal was not already finished")
    for trade in nulls:
        check_common(trade)
        check_prices(trade, book)
    check_shape(spans, pool_spans, book)
    if c.MIN_N != 30 or c.HOLD_DAYS != 2 or c.RULE_SIDE != "long":
        raise SystemExit("the frozen name or the count moved")
    pool = [trade["net"] for trade in nulls]
    row = c.fp5.summarise(c.IDEA, trades, pool, c.MIN_N, c.NOTE)
    payload = {
        "protocol_sha256": sha256(PROTOCOL),
        "code_sha256": {
            f"{FOLDER}_common": sha256(Path(__file__).resolve().parent / "common.py"),
            f"{FOLDER}_measure": sha256(Path(__file__)),
            "fp5_common": sha256(Path(__file__).resolve().parents[1] / "fp5" / "common.py"),
        },
        "input_sha256": inputs,
        "null_kind": c.NULL_KIND,
        "null_n": len(pool),
        "null_mean_bps": round(c.fp5.bps(sum(pool) / len(pool)), 4),
        "ideas": [row],
        "passed": [row["idea"]] if row["passes_screen"] else [],
    }
    text = json.dumps(payload, indent=2, sort_keys=True) + "\n"
    out = ROOT / "docs" / "agents" / "backtests" / FOLDER / "screen_2023.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(text)
    print(text, end="")


def main() -> None:
    if os.environ.get(f"{FOLDER.upper()}_OOS"):
        raise SystemExit("this scorer is the 2023 screen")
    if not PROTOCOL.is_file():
        raise SystemExit("the protocol file is not on disk; do not score without it")
    run()


if __name__ == "__main__":
    main()
