"""Score the fp235 screen. 2023 entries only.

    python3 docs/agents/scripts/fp235/measure.py
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
DATA = Path(os.environ.get("FP235_DATA", "/tmp/fp235/data"))
PROTOCOL = ROOT / "docs/agents/reviews/2026-09-25-fp235-protocol.md"
NOTE = 'Spot, the USDT perpetual and the coin-margined perpetual each finished a six-day rise. The next coin-margined open is bought and sold seven days later. One coin-margined leg. Funding cash is not added. The null is that seven-day long on every day.'
FIELDS = {"coin", "entry_ms", "exit_ms", "gross", "net", "pnl"}
HOLD = 7


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


def check_common(trade: dict) -> None:
    if set(trade) != FIELDS:
        raise SystemExit("a fill carries a field this rule does not use")
    if trade["coin"] != "BTCUSDT":
        raise SystemExit("a fill is not BTC")
    if not (c.fp5.SCREEN_START_MS <= trade["entry_ms"] < c.fp5.SCREEN_END_MS):
        raise SystemExit("a 2024 open was read as an entry")
    if trade["exit_ms"] - trade["entry_ms"] != HOLD * c.fp5.DAY_MS:
        raise SystemExit("the hold moved")
    if trade["exit_ms"] - trade["entry_ms"] <= c.fp5.DAY_MS:
        raise SystemExit("the hold is one day or overnight")
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
    for entry, exit_ms in pool_spans:
        if exit_ms - entry != HOLD * c.fp5.DAY_MS:
            raise SystemExit("the null hold moved")


def check_signal(trade: dict, books: dict) -> None:
    moves = [c.finished(books[name], trade["entry_ms"], 6) for name in ("spot", "um", "cm")]
    if any(move is None or move <= 0.0 for move in moves):
        raise SystemExit("the three rises were not already finished")


def run() -> None:
    end = c.fp5.SCREEN_END_MS
    last = end - c.fp5.DAY_MS
    books = {
        "cm": load_rows(DATA / "cm1d/BTCUSD_PERP.json", 2, end),
        "spot": load_rows(DATA / "spot1d/BTCUSDT.json", 2, last),
        "um": load_rows(DATA / "um1d/BTCUSDT.json", 2, last),
    }
    trades = c.signal_trades(books['spot'], books['um'], books['cm'])
    spans = c.signal_spans(books['spot'], books['um'], books['cm'])
    if [t["entry_ms"] for t in trades] != [entry for entry, _exit in spans]:
        raise SystemExit("the fills and the spans diverged")
    for trade in trades:
        check_common(trade)
        check_signal(trade, books)
        entry_px = books["cm"][trade["entry_ms"]][0]
        exit_px = books["cm"][trade["exit_ms"]][0]
        if abs(trade["gross"] - (exit_px / entry_px - 1.0)) > 1e-12:
            raise SystemExit("the gross is not the one leg")
        if abs(trade["net"] - (c.fp5.net_return(entry_px, exit_px))) > 1e-12:
            raise SystemExit("the net is not the one leg")
    pool_spans = c.pool_spans(books['spot'], books['um'], books['cm'])
    pool = c.pool_nets(books['spot'], books['um'], books['cm'])
    if c.IDEA != 'TRI' or c.MIN_N != 30 or c.HOLD_DAYS != HOLD:
        raise SystemExit("the frozen name or the count moved")
    assert_subset(trades, pool, spans, pool_spans)
    row = c.fp5.summarise(c.IDEA, trades, pool, c.MIN_N, NOTE)
    payload = {
        "protocol_sha256": sha256(PROTOCOL),
        "code_sha256": {
            "fp235_common": sha256(Path(__file__).resolve().parent / "common.py"),
            "fp235_measure": sha256(Path(__file__)),
            "fp5_common": sha256(Path(__file__).resolve().parents[1] / "fp5" / "common.py"),
        },
        "input_sha256": {"cm": sha256(DATA / "cm1d/BTCUSD_PERP.json"), "spot": sha256(DATA / "spot1d/BTCUSDT.json"), "um": sha256(DATA / "um1d/BTCUSDT.json")},
        "ideas": [row],
        "passed": [row["idea"]] if row["passes_screen"] else [],
    }
    text = json.dumps(payload, indent=2, sort_keys=True) + "\n"
    out = ROOT / "docs/agents/backtests/fp235/screen_2023.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(text)
    print(text, end="")


def main() -> None:
    if os.environ.get("FP235_OOS"):
        raise SystemExit("this scorer is the 2023 screen")
    if not PROTOCOL.is_file():
        raise SystemExit("the protocol file is not on disk; do not score without it")
    run()


if __name__ == "__main__":
    main()
