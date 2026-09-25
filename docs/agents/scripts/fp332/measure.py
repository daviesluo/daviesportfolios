"""Score the quarterly basis on 2023. The result is the basis change."""

from __future__ import annotations

import hashlib
import json
import os
import statistics
import sys
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import common as c

FOLDER = Path(__file__).resolve().parent.name
ROOT = Path(__file__).resolve().parents[4]
DATA = Path(os.environ.get("FP332_DATA", "/tmp/fp332/data"))
PROTOCOL = ROOT / "docs" / "agents" / "reviews" / "2026-09-25-fp332-protocol.md"

SHAPES = {
    "spot.json": (427, 1669852800000, "17165.53000000", "16977.37000000", 1711843200000, "69582.17000000", "71280.01000000"),
    "BTCUSDT_230331.json": (99, 1671753600000, "16765.2", "16820.0", 1680220800000, "28018.0", "27807.8"),
    "BTCUSDT_230630.json": (96, 1679875200000, "27854.0", "27340.4", 1688083200000, "30442.9", "30661.0"),
    "BTCUSDT_230929.json": (143, 1687651200000, "30711.4", "30880.3", 1699920000000, "27108.4", "27108.4"),
    "BTCUSDT_231229.json": (136, 1692316800000, "27367.0", "26547.8", 1703980800000, "42374.0", "42374.0"),
    "BTCUSDT_240329.json": (123, 1695945600000, "27738.4", "27535.7", 1711670400000, "70776.7", "69819.7"),
}


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def load_book(path: Path) -> dict[int, tuple[str, str]]:
    rows = json.loads(path.read_text())
    shape = SHAPES[path.name]
    out = {}
    for row in rows:
        if len(row) != 3:
            raise SystemExit(f"{path.name} carries a field this rule does not use")
        out[int(row[0])] = (row[1], row[2])
    stamps = sorted(out)
    if (
        len(stamps) != shape[0]
        or stamps[0] != shape[1]
        or out[stamps[0]] != (shape[2], shape[3])
        or stamps[-1] != shape[4]
        or out[stamps[-1]] != (shape[5], shape[6])
    ):
        raise SystemExit(path.name + " does not have the frozen shape")
    return out


def run() -> None:
    spot = load_book(DATA / "spot.json")
    books = {symbol: load_book(DATA / f"{symbol}.json") for symbol in c.EXPIRY}
    explained = c.paths(spot, books)
    trades = c.rule_trades(spot, books)
    nulls = c.null_trades(spot, books)
    if len(trades) != c.RULE_N or len(nulls) != c.NULL_N:
        raise SystemExit("the scored count does not match the freeze")
    if len(explained) != c.FILLABLE_N:
        raise SystemExit("a 2023 day was dropped")
    if [row["entry_ms"] for row in trades] != [row["entry_ms"] for row in explained if row["on"]]:
        raise SystemExit("the fills and the paths diverged")
    rule_paths = [row for row in explained if row["on"]]
    for trade, path in zip(trades, rule_paths):
        if set(trade) != set(c.FIELDS):
            raise SystemExit("a fill carries a field this rule does not use")
        if trade["coin"] != c.COIN or trade["side"] != c.RULE_SIDE or trade["book"] != c.RULE_BOOK:
            raise SystemExit("the package moved")
        if not c.fp5.in_screen(trade["entry_ms"]):
            raise SystemExit("a 2024 open was read as an entry")
        entry_bps = path["entry_bps"]
        exit_bps = path["exit_bps"]
        gross = (entry_bps - exit_bps) / Decimal(10000)
        net = gross - c.COST
        if abs(Decimal(str(trade["net"])) - net) > Decimal("1e-9"):
            raise SystemExit("the basis change was not the result")
        if abs(trade["pnl"] - 100.0 * trade["net"]) > 1e-9:
            raise SystemExit("the dollar result is not a hundred dollars times the net")
        spot_move = Decimal(spot[trade["exit_ms"]][0]) / Decimal(spot[trade["entry_ms"]][0]) - 1
        if abs(gross - spot_move) > Decimal("0.01") and abs(Decimal(str(trade["gross"])) - spot_move) < Decimal("1e-9"):
            raise SystemExit("the spot move was scored")
        if path["signal_bps"] < c.THRESHOLD_BPS:
            raise SystemExit("the signal was not already finished")
    pool = [row["net"] for row in nulls]
    summary = c.fp5.summarise(
        c.IDEA,
        trades,
        pool,
        c.MIN_N,
        "Short the front quarterly, long Binance spot, until the expiry-day open. "
        "The result is the change in the basis. Forty basis points of fills are taken off.",
    )
    payload = {
        "protocol_sha256": sha256(PROTOCOL),
        "code_sha256": {
            "fp332_common": sha256(Path(__file__).resolve().parent / "common.py"),
            "fp332_measure": sha256(Path(__file__)),
            "fp5_common": sha256(Path(__file__).resolve().parents[1] / "fp5" / "common.py"),
        },
        "input_sha256": {name: sha256(DATA / name) for name in SHAPES},
        "null_kind": c.NULL_KIND,
        "null_n": len(pool),
        "null_mean_bps": round(c.fp5.bps(sum(pool) / len(pool)), 4),
        "discount": {
            "median_entry_bps": round(statistics.median(float(row["entry_bps"]) for row in rule_paths), 4),
            "median_exit_bps": round(statistics.median(float(row["exit_bps"]) for row in rule_paths), 4),
            "median_signal_bps": round(statistics.median(float(row["signal_bps"]) for row in rule_paths), 4),
        },
        "ideas": [summary],
        "passed": [summary["idea"]] if summary["passes_screen"] else [],
    }
    text = json.dumps(payload, indent=2, sort_keys=True) + "\n"
    out = ROOT / "docs" / "agents" / "backtests" / FOLDER / "screen_2023.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(text)
    print(text, end="")


def main() -> None:
    if os.environ.get("FP332_OOS"):
        raise SystemExit("this scorer is the 2023 screen")
    if not PROTOCOL.is_file():
        raise SystemExit("the protocol file is not on disk; do not score without it")
    run()


if __name__ == "__main__":
    main()
