"""Score the fp221 screen. 2023 entries only.

    python3 docs/agents/scripts/fp221/measure.py
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
DATA = Path(os.environ.get("FP221_DATA", "/tmp/fp221/data"))
PROTOCOL = ROOT / "docs/agents/reviews/2026-09-25-fp221-protocol.md"
NOTE = "Spot's close finished strictly above its close seven days earlier. The next open is bought and sold seven days later. One spot leg. Funding cash is not added. The null is that seven-day long on every day the two closes exist."
FIELDS = {"coin", "entry_ms", "exit_ms", "gross", "net", "pnl"}


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def load_rows(path: Path) -> dict[int, tuple]:
    rows = json.loads(path.read_text())
    out = {}
    for row in rows:
        if len(row) != 3:
            raise SystemExit(f"{path.name} carries a field this rule does not use")
        ts = int(row[0])
        if ts > c.fp5.SCREEN_END_MS:
            raise SystemExit(f"{path.name} goes past the window")
        out[ts] = (float(row[1]), float(row[2]))
    if not out or max(out) != c.fp5.SCREEN_END_MS:
        raise SystemExit(path.name + " stops on the wrong day")
    return out


def check_common(trade: dict) -> None:
    if set(trade) != FIELDS:
        raise SystemExit("a fill carries a field this rule does not use")
    if trade["coin"] != "BTCUSDT":
        raise SystemExit("a fill is not BTC")
    if not (c.fp5.SCREEN_START_MS <= trade["entry_ms"] < c.fp5.SCREEN_END_MS):
        raise SystemExit("a 2024 open was read as an entry")
    if trade["exit_ms"] - trade["entry_ms"] != 7 * c.fp5.DAY_MS:
        raise SystemExit("the hold is not seven days")
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
    spot = load_rows(DATA / "spot1d/BTCUSDT.json")
    trades = c.signal_trades(spot)
    spans = c.signal_spans(spot)
    if [t["entry_ms"] for t in trades] != [entry for entry, _exit in spans]:
        raise SystemExit("the fills and the spans diverged")
    for trade in trades:
        check_common(trade)
        entry = trade["entry_ms"]
        earlier = entry - 8 * c.fp5.DAY_MS
        later = entry - c.fp5.DAY_MS
        if later >= c.fp5.SCREEN_END_MS or earlier >= c.fp5.SCREEN_END_MS:
            raise SystemExit("a 2024 close was a signal")
        if spot[later][1] <= spot[earlier][1]:
            raise SystemExit("the finished week was not up")
        entry_px = spot[entry][0]
        exit_px = spot[trade["exit_ms"]][0]
        if abs(trade["gross"] - (exit_px / entry_px - 1.0)) > 1e-12:
            raise SystemExit("the gross is not the one leg")
        if abs(trade["net"] - c.fp5.net_return(entry_px, exit_px)) > 1e-12:
            raise SystemExit("the net is not the one leg")
    pool_spans = c.pool_spans(spot)
    pool = c.pool_nets(spot)
    if c.IDEA != "SMO" or c.MIN_N != 30:
        raise SystemExit("the frozen name or the count moved")
    assert_subset(trades, pool, spans, pool_spans)
    row = c.fp5.summarise(c.IDEA, trades, pool, c.MIN_N, NOTE)
    payload = {
        "protocol_sha256": sha256(PROTOCOL),
        "code_sha256": {
            "fp221_common": sha256(Path(__file__).resolve().parent / "common.py"),
            "fp221_measure": sha256(Path(__file__)),
            "fp5_common": sha256(Path(__file__).resolve().parents[1] / "fp5" / "common.py"),
        },
        "input_sha256": {"spot": sha256(DATA / "spot1d/BTCUSDT.json")},
        "ideas": [row],
        "passed": [row["idea"]] if row["passes_screen"] else [],
    }
    text = json.dumps(payload, indent=2, sort_keys=True) + "\n"
    out = ROOT / "docs/agents/backtests/fp221/screen_2023.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(text)
    print(text, end="")


def main() -> None:
    if os.environ.get("FP221_OOS"):
        raise SystemExit("this scorer is the 2023 screen")
    if not PROTOCOL.is_file():
        raise SystemExit("the protocol file is not on disk; do not score without it")
    run()


if __name__ == "__main__":
    main()
