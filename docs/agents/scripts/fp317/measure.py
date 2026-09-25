"""Score the fp317 screen. 2023 entries only.

    python3 docs/agents/scripts/fp317/measure.py
"""

from __future__ import annotations

import hashlib
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import common as c

ROOT = Path(__file__).resolve().parents[4]
DATA = Path(os.environ.get("FP317_DATA", "/tmp/fp317/data"))
PROTOCOL = ROOT / "docs/agents/reviews/2026-09-25-fp317-protocol.md"
NOTE = "Fair value is the price index grossed up by the already-published SOFR carry. The last settled BTCUSDT funding rate is strictly below that eight-hour SOFR rate, so the contract finished cheap to the cash-and-carry. Buy the USDT book for two days. The other trade buys it for two days when the settled rate is not below that SOFR rate. Same prices, same side, the edge turned off. One leg. Funding cash is not added. The null is not an unconditional hold and it is not the opposite side. The traded open is the fill only. Another venue's close is not an input. A book ticker is not read."
FIELDS = {"coin", "book", "side", "entry_ms", "exit_ms", "gross", "net", "pnl"}


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def load_opens(path: Path) -> dict[int, tuple]:
    rows = json.loads(path.read_text())
    out = {}
    for row in rows:
        if len(row) != 2:
            raise SystemExit(f"{path.name} carries a field this rule does not use")
        ts = int(row[0])
        if ts > c.fp5.SCREEN_END_MS:
            raise SystemExit(f"{path.name} goes past the window")
        px = float(row[1])
        if px <= 0.0:
            raise SystemExit("a fill is not a price")
        out[ts] = (px,)
    if len(out) != c.BOOK_ROWS or max(out) != c.fp5.SCREEN_END_MS:
        raise SystemExit(path.name + " stops on the wrong day")
    return out


def load_fund(path: Path) -> dict[int, float]:
    rows = json.loads(path.read_text())
    out = {}
    for row in rows:
        if len(row) != 2:
            raise SystemExit("funding carries a field this rule does not use")
        ts = int(row[0])
        if ts >= c.fp5.SCREEN_END_MS:
            raise SystemExit("a later funding print was stored")
        out[ts] = float(row[1])
    stamps = sorted(out)
    if len(stamps) != c.FUND_N or stamps[0] != c.FUND_FIRST or stamps[-1] != c.FUND_LAST:
        raise SystemExit("funding does not have the frozen shape")
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
    entry_px = book[trade["entry_ms"]][0]
    exit_px = book[trade["exit_ms"]][0]
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
    if len(rule_entries) >= c.fillable(book) or len(null_entries) >= c.fillable(book):
        raise SystemExit("the rule is every fillable day")


def run() -> None:
    book = load_opens(DATA / "um1d" / "BTCUSDT.json")
    fund = load_fund(DATA / "fund" / "BTCUSDT.json")
    inputs = {
        "um": sha256(DATA / "um1d" / "BTCUSDT.json"),
        "fund": sha256(DATA / "fund" / "BTCUSDT.json"),
    }

    sofr_rows = json.loads((DATA / "sofr.json").read_text())
    sofr = {}
    for row in sofr_rows:
        if len(row) != 2 or not isinstance(row[1], str):
            raise SystemExit("the SOFR percent was precomputed")
        ts = int(row[0])
        if ts >= c.fp5.SCREEN_END_MS:
            raise SystemExit("a later SOFR publication was stored")
        sofr[ts] = row[1]
    if len(sofr) != c.SOFR_ROWS:
        raise SystemExit("SOFR does not have the frozen row count")
    inputs["sofr"] = sha256(DATA / "sofr.json")

    trades = c.rule_trades(book, fund, sofr)
    nulls = c.null_trades(book, fund, sofr)
    spans = c.rule_spans(book, fund, sofr)
    pool_spans = c.null_spans(book, fund, sofr)
    if [t["entry_ms"] for t in trades] != [entry for entry, _exit in spans]:
        raise SystemExit("the fills and the spans diverged")
    if not trades:
        raise SystemExit("the rule has no fill")
    for trade in trades:
        check_common(trade)
        check_prices(trade, book)
        if not c._rule_on(book, fund, sofr, trade["entry_ms"]):
            raise SystemExit("the signal was not already finished")
    for trade in nulls:
        check_common(trade)
        check_prices(trade, book)
    check_shape(spans, pool_spans, book)
    if c.IDEA != "USOFR" or c.MIN_N != 30 or c.HOLD_DAYS != 2 or c.FAIR_KIND != "sofr":
        raise SystemExit("the frozen name or the count moved")
    pool = [trade["net"] for trade in nulls]
    row = c.fp5.summarise(c.IDEA, trades, pool, c.MIN_N, NOTE)
    payload = {
        "protocol_sha256": sha256(PROTOCOL),
        "code_sha256": {
            "fp317_common": sha256(Path(__file__).resolve().parent / "common.py"),
            "fp317_measure": sha256(Path(__file__)),
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
    out = ROOT / "docs/agents/backtests/fp317/screen_2023.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(text)
    print(text, end="")


def main() -> None:
    if os.environ.get("FP317_OOS"):
        raise SystemExit("this scorer is the 2023 screen")
    if not PROTOCOL.is_file():
        raise SystemExit("the protocol file is not on disk; do not score without it")
    run()


if __name__ == "__main__":
    main()
