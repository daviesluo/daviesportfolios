"""Score the PEPE premium on 2023. The result is the premium change."""

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
DATA = Path(os.environ.get("FP333_DATA", "/tmp/fp333/data"))
PROTOCOL = ROOT / "docs" / "agents" / "reviews" / "2026-09-25-fp333-protocol.md"

SHAPES = {
    "spot.json": (241, 1683244800000, "0.00000197", "0.00000373", 1703980800000, "0.00000131", "0.00000130"),
    "perp.json": (241, 1683244800000, "0.0039485", "0.0037211", 1703980800000, "0.0013091", "0.0012956"),
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
    perp = load_book(DATA / "perp.json")
    explained = c.paths(spot, perp)
    trades = c.rule_trades(spot, perp)
    nulls = c.null_trades(spot, perp)
    if len(trades) != c.RULE_N or len(nulls) != c.NULL_N or len(explained) != c.FILLABLE_N:
        raise SystemExit("the scored count does not match the freeze")
    rule_paths = [row for row in explained if row["on"]]
    for trade, path in zip(trades, rule_paths):
        if set(trade) != set(c.FIELDS):
            raise SystemExit("a fill carries a field this rule does not use")
        if trade["side"] != c.RULE_SIDE or trade["book"] != c.RULE_BOOK:
            raise SystemExit("the package moved")
        if trade["exit_ms"] - trade["entry_ms"] != c.fp5.DAY_MS:
            raise SystemExit("the hold is not the next daily open")
        gross = (path["entry_bps"] - path["exit_bps"]) / Decimal(10000)
        net = gross - c.COST
        if abs(Decimal(str(trade["net"])) - net) > Decimal("1e-9"):
            raise SystemExit("the premium change was not the result")
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
        "Short 1000PEPEUSDT and long PEPEUSDT for one day. "
        "The result is the change in the premium. Forty basis points of fills are taken off. "
        "Funding cash is not added.",
    )
    payload = {
        "protocol_sha256": sha256(PROTOCOL),
        "code_sha256": {
            "fp333_common": sha256(Path(__file__).resolve().parent / "common.py"),
            "fp333_measure": sha256(Path(__file__)),
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
    if os.environ.get("FP333_OOS"):
        raise SystemExit("this scorer is the 2023 screen")
    if not PROTOCOL.is_file():
        raise SystemExit("the protocol file is not on disk; do not score without it")
    run()


if __name__ == "__main__":
    main()
