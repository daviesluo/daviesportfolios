"""Score the fp278 screen. 2023 entries only.

    python3 docs/agents/scripts/fp278/measure.py
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
DATA = Path(os.environ.get("FP278_DATA", "/tmp/fp278/data"))
PROTOCOL = ROOT / "docs/agents/reviews/2026-09-25-fp278-protocol.md"
NOTE = 'Spot and the USDT book both finished a nine-day decline. The next USDT open is sold and bought back twenty-eight days later. The other trade sells the coin-margined book for those same twenty-eight days. One leg. Funding cash is not added. The null is not that USDT short with the two declines turned off.'
FIELDS = {"coin", "book", "side", "entry_ms", "exit_ms", "gross", "net", "pnl"}
HOLD = c.HOLD_DAYS


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
    hold = c.HOLD_DAYS * c.fp5.DAY_MS
    for entry, exit_ms in list(rule_spans) + list(null_spans):
        if exit_ms - entry != hold or exit_ms - entry <= c.fp5.DAY_MS:
            raise SystemExit("a hold moved")
    rule_entries = [entry for entry, _exit in rule_spans]
    null_entries = [entry for entry, _exit in null_spans]
    if c.MODE == "paired":
        if rule_entries != null_entries:
            raise SystemExit("the two trades did not share the entries")
        if c.RULE_BOOK == c.NULL_BOOK and c.RULE_SIDE == c.NULL_SIDE:
            raise SystemExit("the other trade is the same leg")
    elif c.MODE == "shifted":
        shift = hold
        if null_entries != [entry + shift for entry in rule_entries]:
            raise SystemExit("the other trade did not start later")
    elif c.MODE == "regime":
        if set(rule_entries) & set(null_entries):
            raise SystemExit("a day is in both trades")
        if len(null_entries) < len(rule_entries):
            raise SystemExit("the other trade is shorter than the rule")
    else:
        raise SystemExit("mode")


def run() -> None:
    end = c.fp5.SCREEN_END_MS
    books = {}
    inputs = {}
    for key, (rel, traded) in c.FILES.items():
        max_ts = end if traded else end - c.fp5.DAY_MS
        books[key] = load_rows(DATA / rel, 2, max_ts)
        inputs[key] = sha256(DATA / rel)
    spot = books.get("spot", {})
    um = books.get("um", {})
    cm = books.get("cm", {})
    trades = c.rule_trades(spot, um, cm)
    nulls = c.null_trades(spot, um, cm)
    spans = c.rule_spans(spot, um, cm)
    pool_spans = c.null_spans(spot, um, cm)
    if [t["entry_ms"] for t in trades] != [entry for entry, _exit in spans]:
        raise SystemExit("the fills and the spans diverged")
    if not trades:
        raise SystemExit("the rule has no fill")
    for trade in trades:
        check_common(trade, c.RULE_BOOK, c.RULE_SIDE)
        check_prices(trade, books[c.RULE_BOOK])
        if not c._rule_on(spot, um, cm, trade["entry_ms"]):
            raise SystemExit("the signal was not already finished")
    for trade in nulls:
        check_common(trade, c.NULL_BOOK, c.NULL_SIDE)
        check_prices(trade, books[c.NULL_BOOK])
    check_shape(spans, pool_spans)
    if len(pool_spans) < len(spans):
        raise SystemExit("the other trade is shorter than the rule")
    if len(spans) >= c.fillable(books[c.RULE_BOOK]):
        raise SystemExit("the rule is every fillable day")
    if len(pool_spans) >= c.fillable(books[c.NULL_BOOK]):
        raise SystemExit("the null is every fillable day")
    if c.IDEA != 'BOTHDOWN' or c.MIN_N != 30 or c.HOLD_DAYS != 28:
        raise SystemExit("the frozen name or the count moved")
    pool = [trade["net"] for trade in nulls]
    row = c.fp5.summarise(c.IDEA, trades, pool, c.MIN_N, NOTE)
    payload = {
        "protocol_sha256": sha256(PROTOCOL),
        "code_sha256": {
            "fp278_common": sha256(Path(__file__).resolve().parent / "common.py"),
            "fp278_measure": sha256(Path(__file__)),
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
    out = ROOT / "docs/agents/backtests/fp278/screen_2023.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(text)
    print(text, end="")


def main() -> None:
    if os.environ.get("FP278_OOS"):
        raise SystemExit("this scorer is the 2023 screen")
    if not PROTOCOL.is_file():
        raise SystemExit("the protocol file is not on disk; do not score without it")
    run()


if __name__ == "__main__":
    main()
