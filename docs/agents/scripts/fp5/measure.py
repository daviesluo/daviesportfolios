"""Score the fp5 screen on 2023 only.

Refuses a price past the screen horizon, and refuses an entry outside 2023.
There is no flag that scores a later year: that is a different program, and
it needs its own pre-registration, committed before it runs.

    python3 docs/agents/scripts/fp5/measure.py --out docs/agents/backtests/fp5/screen_2023.json
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import common as c

ROOT = Path(__file__).resolve().parents[4]
DATA = Path(os.environ.get("FP5_DATA", "/tmp/fp5/data"))
PROTOCOL = ROOT / "docs/agents/reviews/2026-09-25-fp5-protocol.md"


def load_bars(path: Path) -> dict[int, tuple]:
    if not path.exists():
        return {}
    rows = json.loads(path.read_text())
    out = {int(r[0]): (float(r[1]), float(r[2]), float(r[3]), float(r[4]), float(r[5])) for r in rows}
    c.assert_price_horizon(list(out))
    return out


def load_pairs(path: Path) -> list:
    if not path.exists():
        return []
    return json.loads(path.read_text())


def sha256_file(path: Path) -> str | None:
    if not path.exists():
        return None
    h = hashlib.sha256()
    h.update(path.read_bytes())
    return h.hexdigest()


def hashes() -> dict[str, str | None]:
    files = [PROTOCOL, Path(__file__), ROOT / "docs/agents/scripts/fp5/common.py"]
    for symbol in c.BASKET:
        files.append(DATA / "spot8h" / f"{symbol}.json")
        files.append(DATA / "spot1d" / f"{symbol}.json")
        files.append(DATA / "funding" / f"{symbol}.json")
    for name in ("metrics_btc.json", "mark8h_btc.json", "index8h_btc.json", "fng.json", "dvol_btc.json", "coinbase_btc_1d.json", "stable_supply.json"):
        files.append(DATA / name)
    out = {}
    for path in files:
        key = str(path.relative_to(DATA)) if str(path).startswith(str(DATA)) else path.name
        out[key] = sha256_file(path)
    return out


def main() -> None:
    if os.environ.get("FP5_OOS"):
        raise SystemExit("this program scores 2023 only")
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", required=True)
    args = parser.parse_args()
    if not PROTOCOL.exists():
        raise SystemExit("the protocol file is not on disk; do not score without it")

    spot8 = {s: load_bars(DATA / "spot8h" / f"{s}.json") for s in c.BASKET}
    spot1 = {s: load_bars(DATA / "spot1d" / f"{s}.json") for s in c.BASKET}
    funding = {}
    for s in c.BASKET:
        raw = load_pairs(DATA / "funding" / f"{s}.json")
        funding[s] = [(int(t), float(r)) for t, r in raw if int(t) <= c.SCREEN_END_MS]

    btc8 = {"BTCUSDT": spot8.get("BTCUSDT") or {}}
    btc1 = spot1.get("BTCUSDT") or {}
    pool8 = c.pool_from_bars(spot8, c.BASKET, c.EIGHT_H_MS)
    pool_btc8 = c.pool_from_bars(btc8, ("BTCUSDT",), c.EIGHT_H_MS)
    pool_btc1 = c.pool_from_bars({"BTCUSDT": btc1}, ("BTCUSDT",), c.DAY_MS)

    results = []

    own = c.fr_own(funding, spot8)
    results.append(c.summarise(
        "FR-OWN", own, pool8, 30,
        "Own-coin funding below its trailing-90-day 10th. Enter one 8h bar later, hold one bar, 20 bps.",
    ))
    xs = c.fr_xs(funding, spot8)
    results.append(c.summarise(
        "FR-XS", xs, pool8, 30,
        "The basket's most negative funding, when it is negative and below its own 10th. One coin, alphabetical on a tie.",
    ))

    climax = c.vol_climax(spot8, 3.0)
    control = c.vol_climax(spot8, None)
    climax_row = c.summarise(
        "VOL-CLIMAX", climax, pool8, 30,
        "An 8h close-to-close drop of 3% on at least 3× the trailing-90-day median quote volume. Next bar, 20 bps.",
    )
    control_row = c.summarise(
        "VOL-DROP-CONTROL", control, pool8, 30,
        "The same drop with no volume test. The climax idea also has to beat this mean. Not a candidate on its own.",
    )
    if climax_row["passes_screen"] and control_row["mean_net_bps"] is not None and climax_row["mean_net_bps"] is not None:
        if climax_row["mean_net_bps"] <= control_row["mean_net_bps"]:
            climax_row["passes_screen"] = False
            climax_row["note"] += " Failed the volume control: the drop without the volume test did at least as well."
    results.append(climax_row)
    results.append(control_row)

    slots = c.season_slots(spot8)
    slot_rows = {}
    for hour, trades in slots.items():
        row = c.summarise(
            f"SEASON-{hour:02d}", trades, pool_btc8, 30,
            "BTC held one 8h bar from this UTC hour. All three hours must pass, or the idea is dead.",
        )
        slot_rows[str(hour)] = row
        results.append(row)
    results.append({
        "idea": "SEASON",
        "passes_screen": c.passes_season(slot_rows),
        "note": "Passes only when 00:00, 08:00 and 16:00 each beat the null on their own.",
        "slots": list(slot_rows),
    })

    metrics = json.loads((DATA / "metrics_btc.json").read_text()) if (DATA / "metrics_btc.json").exists() else []
    # Metrics days are allowed through 2023-12-31. A later day would be a puller bug.
    for row in metrics:
        if int(row["day_ms"]) >= c.SCREEN_END_MS:
            raise SystemExit("metrics contain a 2024 day")

    oi_days = c.oi_signals(metrics, btc1)
    results.append(c.summarise(
        "OI-FLUSH", c.daily_forward(btc1, oi_days, 1), pool_btc1, 30,
        "BTC open interest down at least 5% on a day the spot close also fell. Next day, 20 bps.",
    ))
    results.append(c.summarise(
        "LS-FADE", c.daily_forward(btc1, c.ratio_signals(metrics, "count_ls", 0.10, True), 1), pool_btc1, 30,
        "Retail long/short ratio below its trailing-90-day 10th (crowded shorts). Next day, long BTC, 20 bps.",
    ))
    results.append(c.summarise(
        "TOP-RETAIL", c.daily_forward(btc1, c.ratio_signals(metrics, "top_over_retail", 0.90, False), 1), pool_btc1, 30,
        "Top-trader long/short over the retail ratio, above its trailing 90th. Next day, long BTC, 20 bps.",
    ))
    results.append(c.summarise(
        "TAKER", c.daily_forward(btc1, c.ratio_signals(metrics, "taker", 0.10, True), 1), pool_btc1, 30,
        "Taker buy/sell volume ratio below its trailing 10th. Next day, long BTC, 20 bps.",
    ))

    fng = [(int(t), float(v)) for t, v in load_pairs(DATA / "fng.json")]
    fng = [(t, v) for t, v in fng if t * 1000 < c.SCREEN_END_MS]
    results.append(c.summarise(
        "FNG", c.daily_forward(btc1, c.fng_signals(fng), 1), pool_btc1, 30,
        "Fear and greed below the published extreme-fear cut of 20. Next day, long BTC, 20 bps.",
    ))

    dvol = [(int(t), float(v)) for t, v in load_pairs(DATA / "dvol_btc.json")]
    dvol = [(t, v) for t, v in dvol if t < c.SCREEN_END_MS]
    results.append(c.summarise(
        "DVOL-BUY", c.daily_forward(btc1, c.dvol_signals(dvol), 1), pool_btc1, 30,
        "Deribit BTC DVOL close above its trailing-90-day 90th. Next day, long BTC, 20 bps. A cousin of §3.21's gate, the opposite trade.",
    ))

    # Signals stop at the end of 2023. The 2024-01-01 print is a Binance exit, not a Coinbase signal.
    coinbase = {
        int(t): float(v)
        for t, v in load_pairs(DATA / "coinbase_btc_1d.json")
        if int(t) < c.SCREEN_END_MS
    }
    results.append(c.summarise(
        "CB-PREMIUM", c.daily_forward(btc1, c.coinbase_premium_signals(btc1, coinbase), 1), pool_btc1, 30,
        "Coinbase's daily close more than 15 bps above Binance's. Next day, long BTC on Binance, 20 bps.",
    ))

    mark = load_bars(DATA / "mark8h_btc.json")
    index = load_bars(DATA / "index8h_btc.json")
    results.append(c.summarise(
        "PREM-REV", c.prem_rev(mark, index, btc8["BTCUSDT"]), pool_btc8, 30,
        "BTC perp mark more than 10 bps under the index at the 8h close. Buy spot at the next open, hold one bar, 20 bps.",
    ))

    eth = c.eth_btc(spot1)
    # The null is the same excess on every intact day, not raw BTC returns.
    eth_pool = []
    eth_bars = spot1.get("ETHUSDT") or {}
    btc_bars = spot1.get("BTCUSDT") or {}
    for entry in set(eth_bars) & set(btc_bars):
        exit_ = entry + c.DAY_MS
        if exit_ not in eth_bars or exit_ not in btc_bars or btc_bars[entry][0] <= 0:
            continue
        trade = c._trade("ETHUSDT", entry, exit_, eth_bars)
        if trade is None:
            continue
        btc_gross = btc_bars[exit_][0] / btc_bars[entry][0] - 1.0
        eth_pool.append(trade["net"] - btc_gross)
    results.append(c.summarise(
        "ETH-BTC", eth, eth_pool, 30,
        "ETH/BTC more than 2 trailing-30-day standard deviations under its mean. Hold ETH one day. The number is ETH after 20 bps minus BTC.",
    ))

    supply = [(int(t), float(v)) for t, v in load_pairs(DATA / "stable_supply.json") if int(t) < c.SCREEN_END_MS]
    signalled, every = c.supply_mondays(supply, btc1)
    supply_row = c.summarise(
        "SUPPLY", signalled, [t["net"] for t in every], 15,
        "Monday long BTC when stablecoin supply rose over the prior 30 days. Hold to the next Monday, 20 bps. The null is other Mondays.",
    )
    if supply_row["passes_screen"] and every:
        every_mean = sum(t["net"] for t in every) / len(every)
        sig_mean = sum(t["net"] for t in signalled) / len(signalled) if signalled else 0.0
        if sig_mean <= every_mean:
            supply_row["passes_screen"] = False
            supply_row["note"] += " Failed the every-Monday control."
    results.append(supply_row)

    # Hour slots are reported and are not candidates: one lucky hour is not a rule.
    candidates = {
        "FR-OWN", "FR-XS", "VOL-CLIMAX", "VOL-DROP-CONTROL", "SEASON",
        "OI-FLUSH", "LS-FADE", "TOP-RETAIL", "TAKER", "FNG", "DVOL-BUY",
        "CB-PREMIUM", "PREM-REV", "ETH-BTC", "SUPPLY",
    }
    passed = [r["idea"] for r in results if r.get("passes_screen") and r["idea"] in candidates]
    payload = {
        "screen": "2023-01-01 → 2023-12-31 entries, exit print through 2024-01-01 00:00 UTC",
        "fee_bps_a_side": 10,
        "null": {"draws": c.NULL_DRAWS, "seed": c.NULL_SEED, "index": c.p95_index(c.NULL_DRAWS)},
        "passed": passed,
        "results": results,
        "sha256": hashes(),
    }
    text = json.dumps(payload, indent=2, sort_keys=True) + "\n"
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(text)
    print(text)


if __name__ == "__main__":
    main()
