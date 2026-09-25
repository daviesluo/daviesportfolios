"""Score TRB funding cash on 2023. The result is the cash, not the coin."""

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
DATA = Path(os.environ.get("FP334_DATA", "/tmp/fp334/data"))
PROTOCOL = ROOT / "docs" / "agents" / "reviews" / "2026-09-25-fp334-protocol.md"

SHAPES = {
    "spot.json": (8759, 1672531200000, "12.20000000", "12.16000000", 1704063600000, "232.94000000", "192.91000000"),
    "perp.json": (8760, 1672531200000, "12.180", "12.130", 1704063600000, "174.480", "194.740"),
    "funding.json": (1337, 1672531200000, "0.00010000", 1704052800000, "-0.01951228"),
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


def load_funding(path: Path) -> dict[int, tuple[int, Decimal]]:
    rows = json.loads(path.read_text())
    shape = SHAPES[path.name]
    out = {}
    for row in rows:
        if len(row) != 3:
            raise SystemExit("the funding file carries a field this rule does not use")
        out[int(row[0])] = (int(row[1]), Decimal(row[2]))
    stamps = sorted(out)
    if (
        len(stamps) != shape[0]
        or stamps[0] != shape[1]
        or format(out[stamps[0]][1], "f") != shape[2]
        or stamps[-1] != shape[3]
        or format(out[stamps[-1]][1], "f") != shape[4]
    ):
        raise SystemExit("funding.json does not have the frozen shape")
    return out


def run() -> None:
    spot = load_book(DATA / "spot.json")
    perp = load_book(DATA / "perp.json")
    funding = load_funding(DATA / "funding.json")
    explained = c.paths(spot, perp, funding)
    trades = c.rule_trades(spot, perp, funding)
    nulls = c.null_trades(spot, perp, funding)
    rule_paths = [row for row in explained if row["on"]]
    if len(trades) != c.RULE_N or len(nulls) != c.NULL_N:
        raise SystemExit("the scored count does not match the freeze")
    days = {row["entry_ms"] // c.fp5.DAY_MS for row in rule_paths}
    if len(days) != c.RULE_DAYS:
        raise SystemExit("the cheap-day count moved")
    for trade, path in zip(trades, rule_paths):
        if set(trade) != set(c.FIELDS):
            raise SystemExit("a fill carries a field this rule does not use")
        if trade["side"] != c.RULE_SIDE:
            raise SystemExit("the package moved")
        if path["exit_bps"] != 0:
            raise SystemExit("the settlement still had cash outstanding")
        gross = path["entry_bps"] / Decimal(10000)
        net = gross - c.COST
        if abs(Decimal(str(trade["net"])) - net) > Decimal("1e-9"):
            raise SystemExit("the cash was not the result")
        if abs(trade["pnl"] - 100.0 * trade["net"]) > 1e-9:
            raise SystemExit("the dollar result is not a hundred dollars times the net")
        spot_move = Decimal(spot[trade["exit_ms"]][0]) / Decimal(spot[trade["entry_ms"]][0]) - 1
        if abs(gross - spot_move) > Decimal("0.01") and abs(Decimal(str(trade["gross"])) - spot_move) < Decimal("1e-9"):
            raise SystemExit("the spot move was scored")
        if path["signal_bps"] > -c.THRESHOLD_BPS:
            raise SystemExit("the signal was not already finished")
    pool = [row["net"] for row in nulls]
    summary = c.fp5.summarise(
        c.IDEA,
        trades,
        pool,
        c.MIN_N,
        "Long TRBUSDT and short TRB spot across one funding settlement. "
        "The result is the cash the long receives. Forty basis points of fills are taken off. "
        "The coin's move is not added.",
    )
    payload = {
        "protocol_sha256": sha256(PROTOCOL),
        "code_sha256": {
            "fp334_common": sha256(Path(__file__).resolve().parent / "common.py"),
            "fp334_measure": sha256(Path(__file__)),
            "fp5_common": sha256(Path(__file__).resolve().parents[1] / "fp5" / "common.py"),
        },
        "input_sha256": {name: sha256(DATA / name) for name in ("spot.json", "perp.json", "funding.json")},
        "null_kind": c.NULL_KIND,
        "null_n": len(pool),
        "null_mean_bps": round(c.fp5.bps(sum(pool) / len(pool)), 4),
        "discount": {
            "median_cash_bps": round(statistics.median(float(row["entry_bps"]) for row in rule_paths), 4),
            "median_exit_bps": 0,
            "median_signal_bps": round(statistics.median(float(row["signal_bps"]) for row in rule_paths), 4),
            "median_open_premium_bps": round(statistics.median(float(row["open_bps"]) for row in rule_paths), 4),
            "cheap_days": len(days),
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
    if os.environ.get("FP334_OOS"):
        raise SystemExit("this scorer is the 2023 screen")
    if not PROTOCOL.is_file():
        raise SystemExit("the protocol file is not on disk; do not score without it")
    run()


if __name__ == "__main__":
    main()
