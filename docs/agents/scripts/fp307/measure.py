"""Score the fp307 screen. 2023 entries only.

    python3 docs/agents/scripts/fp307/measure.py
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
DATA = Path(os.environ.get("FP307_DATA", "/tmp/fp307/data"))
PROTOCOL = ROOT / "docs/agents/reviews/2026-09-25-fp307-protocol.md"
NOTE = 'Fair value is the BitMEX XBTUSD daily close. The finished coin-margined close was strictly under that close, so the next coin-margined open is a price that finished cheap to BitMEX. Buy the coin-margined book for seven days. The other trade buys the coin-margined book for seven days on these same prices when that discount is absent. Same prices, same side, the edge turned off. One leg. Funding cash is not added. The null is not an unconditional hold and it is not the opposite side. The traded open is the fill only. A book ticker is not read.'
FIELDS = {"coin", "book", "side", "entry_ms", "exit_ms", "gross", "net", "pnl"}


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def load_rows(path: Path, width: int, max_ts: int) -> dict[int, tuple]:
    rows = json.loads(path.read_text())
    out = {}
    for row in rows:
        if len(row) != width + 1:
            raise SystemExit(f"{path.name} carries a field this rule does not use")
        ts = int(row[0])
        if ts > max_ts or ts > c.fp5.SCREEN_END_MS:
            raise SystemExit(f"{path.name} goes past the window")
        out[ts] = tuple(float(x) for x in row[1:])
    if not out or max(out) != max_ts:
        raise SystemExit(path.name + " stops on the wrong day")
    return out


def check_common(trade: dict, book_name: str, side: str) -> None:
    if set(trade) != FIELDS:
        raise SystemExit("a fill carries a field this rule does not use")
    if trade["coin"] != "BTCUSDT" or trade["book"] != book_name or trade["side"] != side:
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
    if trade["side"] == "long":
        gross = exit_px / entry_px - 1.0
        net = c.fp5.net_return(entry_px, exit_px)
    elif trade["side"] == "short":
        gross = entry_px / exit_px - 1.0
        net = c.short_net(entry_px, exit_px)
    else:
        raise SystemExit("side")
    if abs(trade["gross"] - gross) > 1e-12 or abs(trade["net"] - net) > 1e-12:
        raise SystemExit("the fill is not this contract's open")


def check_shape(rule_spans, null_spans) -> None:
    if c.NULL_KIND == "filter_off":
        raise SystemExit("the null is the filter turned off")
    if c.NULL_KIND == "other_side":
        raise SystemExit("the other trade is the opposite side")
    hold = c.HOLD_DAYS * c.fp5.DAY_MS
    for entry, exit_ms in list(rule_spans) + list(null_spans):
        if exit_ms - entry != hold or exit_ms - entry <= c.fp5.DAY_MS:
            raise SystemExit("a hold moved")
    rule_entries = [entry for entry, _exit in rule_spans]
    null_entries = [entry for entry, _exit in null_spans]
    if c.MODE != "regime":
        raise SystemExit("mode")
    if set(rule_entries) & set(null_entries):
        raise SystemExit("a day is in both trades")
    if len(null_entries) < len(rule_entries):
        raise SystemExit("the other trade is shorter than the rule")


def run() -> None:
    end = c.fp5.SCREEN_END_MS
    books = {}
    inputs = {}
    for key, (rel, traded) in c.FILES.items():
        max_ts = end if traded else c.FAIR_LAST_MS
        books[key] = load_rows(DATA / rel, 2, max_ts)
        inputs[key] = sha256(DATA / rel)
    spot = books.get("spot", {})
    um = books.get("um", {})
    cm = books.get("cm", {})
    fair = books[c.FAIR_KEY]
    trades = c.rule_trades(spot, um, cm, fair)
    nulls = c.null_trades(spot, um, cm, fair)
    spans = c.rule_spans(spot, um, cm, fair)
    pool_spans = c.null_spans(spot, um, cm, fair)
    if [t["entry_ms"] for t in trades] != [entry for entry, _exit in spans]:
        raise SystemExit("the fills and the spans diverged")
    if not trades:
        raise SystemExit("the rule has no fill")
    traded_book = books[c.RULE_BOOK]
    for trade in trades:
        check_common(trade, c.RULE_BOOK, c.RULE_SIDE)
        check_prices(trade, traded_book)
        if not c._rule_on(spot, um, cm, fair, trade["entry_ms"]):
            raise SystemExit("the signal was not already finished")
    for trade in nulls:
        check_common(trade, c.NULL_BOOK, c.NULL_SIDE)
        check_prices(trade, traded_book)
    check_shape(spans, pool_spans)
    if len(pool_spans) < len(spans):
        raise SystemExit("the other trade is shorter than the rule")
    if len(spans) >= c.fillable(traded_book):
        raise SystemExit("the rule is every fillable day")
    if len(pool_spans) >= c.fillable(traded_book):
        raise SystemExit("the null is every fillable day")
    if c.IDEA != 'MEXCH' or c.MIN_N != 30 or c.HOLD_DAYS != 7 or c.NULL_KIND != "other_regime":
        raise SystemExit("the frozen name or the count moved")
    if c.FAIR_KEY in ("spot", "um", "cm", "cb", "db"):
        raise SystemExit("the fair value is a Binance line or a reused venue")
    if c.EDGE not in ("cheap", "rich") or c.WIDEN_LAG != 0:
        raise SystemExit("the edge is not this price")
    pool = [trade["net"] for trade in nulls]
    row = c.fp5.summarise(c.IDEA, trades, pool, c.MIN_N, NOTE)
    payload = {
        "protocol_sha256": sha256(PROTOCOL),
        "code_sha256": {
            "fp307_common": sha256(Path(__file__).resolve().parent / "common.py"),
            "fp307_measure": sha256(Path(__file__)),
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
    out = ROOT / "docs/agents/backtests/fp307/screen_2023.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(text)
    print(text, end="")


def main() -> None:
    if os.environ.get("FP307_OOS"):
        raise SystemExit("this scorer is the 2023 screen")
    if not PROTOCOL.is_file():
        raise SystemExit("the protocol file is not on disk; do not score without it")
    run()


if __name__ == "__main__":
    main()
