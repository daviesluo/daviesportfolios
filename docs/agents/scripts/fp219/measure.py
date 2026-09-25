"""Score the fp219 screen. 2023 entries only.

    python3 docs/agents/scripts/fp219/measure.py
"""

from __future__ import annotations

import hashlib
import json
import os
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import common as c

ROOT = Path(__file__).resolve().parents[4]
DATA = Path(os.environ.get("FP219_DATA", "/tmp/fp219/data"))
PROTOCOL = ROOT / "docs/agents/reviews/2026-09-25-fp219-protocol.md"
NOTE = "The front quarterly is bought when 7 to 35 days remain and sold at the expiry open. One leg. Funding cash is not added. The null holds that contract to expiry whenever at least seven days remain."
FIELDS = {"coin", "entry_ms", "exit_ms", "gross", "net", "pnl"}


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def load_rows(path: Path, expiry: int) -> dict[int, tuple]:
    rows = json.loads(path.read_text())
    out = {}
    for row in rows:
        if len(row) != 2:
            raise SystemExit(f"{path.name} carries a field this rule does not use")
        ts = int(row[0])
        if ts > expiry or ts > c.fp5.SCREEN_END_MS:
            raise SystemExit(f"{path.name} goes past the expiry")
        out[ts] = (float(row[1]),)
    if expiry not in out:
        raise SystemExit(path.name + " has no expiry bar")
    return out


def check_common(trade: dict) -> None:
    if set(trade) != FIELDS:
        raise SystemExit("a fill carries a field this rule does not use")
    if trade["coin"] != "BTCUSDT":
        raise SystemExit("a fill is not BTC")
    if not (c.fp5.SCREEN_START_MS <= trade["entry_ms"] < c.fp5.SCREEN_END_MS):
        raise SystemExit("a 2024 open was read as an entry")
    if trade["exit_ms"] - trade["entry_ms"] < 7 * c.fp5.DAY_MS:
        raise SystemExit("the hold is under seven days")
    if abs(trade["pnl"] - 100.0 * trade["net"]) > 1e-9:
        raise SystemExit("the dollar result is not a hundred dollars times the net")


def assert_subset(trades, pool, spans, pool_spans) -> None:
    if not trades:
        raise SystemExit("the rule has no fill")
    if len(pool_spans) <= len(spans):
        raise SystemExit("the null is not a larger pool than the rule")
    pool_entries = {entry for entry, _exit in pool_spans}
    counts = Counter(pool)
    for trade, (entry, _exit) in zip(trades, spans):
        if entry not in pool_entries or counts[trade["net"]] <= 0:
            raise SystemExit("a fill is not in the null pool")
        counts[trade["net"]] -= 1


def run() -> None:
    books = {}
    inputs = {}
    for expiry, symbol in c.QUARTERS:
        path = DATA / "cm1d" / f"{symbol}.json"
        books[symbol] = load_rows(path, expiry)
        inputs[symbol] = sha256(path)
    trades = c.signal_trades(books)
    spans = c.signal_spans(books)
    if [t["entry_ms"] for t in trades] != [entry for entry, _exit in spans]:
        raise SystemExit("the fills and the spans diverged")
    expiries = {expiry for expiry, _symbol in c.QUARTERS}
    for trade in trades:
        check_common(trade)
        if trade["exit_ms"] not in expiries:
            raise SystemExit("the exit is not an expiry")
        found = c.front(trade["entry_ms"])
        if found is None or found[0] != trade["exit_ms"]:
            raise SystemExit("the fill is not the front contract")
        hold = (trade["exit_ms"] - trade["entry_ms"]) // c.fp5.DAY_MS
        if hold < 7 or hold > 35:
            raise SystemExit("the expiry window moved")
        book = books[found[1]]
        entry_px = book[trade["entry_ms"]][0]
        exit_px = book[trade["exit_ms"]][0]
        if abs(trade["gross"] - (exit_px / entry_px - 1.0)) > 1e-12:
            raise SystemExit("the gross is not the one quarterly")
        if abs(trade["net"] - c.fp5.net_return(entry_px, exit_px)) > 1e-12:
            raise SystemExit("the net is not the one quarterly")
    pool_spans = c.pool_spans(books)
    pool = c.pool_nets(books)
    if c.IDEA != "XEXP" or c.MIN_N != 30:
        raise SystemExit("the frozen name or the count moved")
    assert_subset(trades, pool, spans, pool_spans)
    row = c.fp5.summarise(c.IDEA, trades, pool, c.MIN_N, NOTE)
    payload = {
        "protocol_sha256": sha256(PROTOCOL),
        "code_sha256": {
            "fp219_common": sha256(Path(__file__).resolve().parent / "common.py"),
            "fp219_measure": sha256(Path(__file__)),
            "fp5_common": sha256(Path(__file__).resolve().parents[1] / "fp5" / "common.py"),
        },
        "input_sha256": inputs,
        "ideas": [row],
        "passed": [row["idea"]] if row["passes_screen"] else [],
    }
    text = json.dumps(payload, indent=2, sort_keys=True) + "\n"
    out = ROOT / "docs/agents/backtests/fp219/screen_2023.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(text)
    print(text, end="")


def main() -> None:
    if os.environ.get("FP219_OOS"):
        raise SystemExit("this scorer is the 2023 screen")
    if not PROTOCOL.is_file():
        raise SystemExit("the protocol file is not on disk; do not score without it")
    run()


if __name__ == "__main__":
    main()
