"""The pre-registered LOUDER test. Entries from 2024-01-01 through 2026-09-04.

The buy and the sell stay where the screen put them. The other trade stays
the quieter twenty-one-day USDT long. The cutoff stays the sample p95. It
is not the quieter mean. The 2026-09-25 bar is an exit open. It is not an
entry. A close after 2026-09-03 is not a signal. Refuses to run until the
pre-registration's sha256 matches the sidecar written when it was frozen.
Re-running the 2023 screen is a check, not the bar.

    python3 docs/agents/scripts/fp268/louder_test.py
"""

from __future__ import annotations

import hashlib
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import common as c
import oos_fetch

ROOT = Path(__file__).resolve().parents[4]
DATA = Path(os.environ.get("FP268_DATA", "/tmp/fp268/data"))
PREREG = ROOT / "docs/agents/reviews/2026-09-25-fp268-prereg-louder.md"
SIDECAR = ROOT / "docs/agents/reviews/2026-09-25-fp268-prereg-louder.sha256"
SCREEN = ROOT / "docs/agents/backtests/fp268/screen_2023.json"

UM_BID = 84066.00
UM_ASK = 84066.10
UM_HALF = (UM_ASK - UM_BID) / (UM_ASK + UM_BID)
if UM_HALF != 5.947704216257381e-07:
    raise SystemExit("the frozen USDT half-spread does not match the frozen book")
FEE = c.fp5.FEE + UM_HALF
FEE_DOUBLE = 0.002 + UM_HALF

OOS_START = int(datetime(2024, 1, 1, tzinfo=timezone.utc).timestamp() * 1000)
OOS_SPLIT = int(datetime(2025, 1, 1, tzinfo=timezone.utc).timestamp() * 1000)
EXIT_OPEN = int(datetime(2026, 9, 25, tzinfo=timezone.utc).timestamp() * 1000)
LAST_ENTRY = EXIT_OPEN - c.HOLD_DAYS * c.fp5.DAY_MS
ENTRY_END = LAST_ENTRY + c.fp5.DAY_MS
SIGNAL_LAST = LAST_ENTRY - c.fp5.DAY_MS
NULL_DRAWS = 1000
NULL_SEED = 20260925
# One basis point of mean net is $0.01 of mean pnl on the locked $100.
GAP_BPS = 10.0


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def load_bars(path: Path, width: int, last_ms: int) -> dict[int, tuple]:
    rows = json.loads(path.read_text())
    out = {}
    for row in rows:
        if len(row) != width + 1:
            raise SystemExit(f"{path.name} carries a field this rule does not use")
        ts = int(row[0])
        if ts > last_ms:
            raise SystemExit("a bar after the frozen window was stored")
        out[ts] = tuple(float(x) for x in row[1:])
    if not out:
        raise SystemExit(f"{path.name} is empty")
    return out


def month_of(entry_ms: int) -> str:
    stamp = datetime.fromtimestamp(entry_ms / 1000, timezone.utc)
    return f"{stamp.year:04d}-{stamp.month:02d}"


def fill(entry: int, book: dict, fee: float) -> dict | None:
    exit_ms = entry + c.HOLD_DAYS * c.fp5.DAY_MS
    if not (OOS_START <= entry < ENTRY_END):
        return None
    if exit_ms != entry + 21 * c.fp5.DAY_MS or exit_ms > EXIT_OPEN:
        return None
    entry_px = c._px(book, entry, 0)
    exit_px = c._px(book, exit_ms, 0)
    if entry_px is None or exit_px is None:
        return None
    net = c.fp5.net_return(entry_px, exit_px, fee)
    return {
        "coin": "BTCUSDT",
        "book": "um",
        "side": "long",
        "entry_ms": entry,
        "exit_ms": exit_ms,
        "gross": exit_px / entry_px - 1.0,
        "net": net,
        "pnl": 100.0 * net,
    }


def collect(spot: dict, um: dict, fee: float) -> tuple[list[dict], list[dict]]:
    rules = []
    nulls = []
    entry = OOS_START
    while entry < ENTRY_END:
        if c._rule_signal(spot, um, {}, entry):
            trade = fill(entry, um, fee)
            if trade is not None:
                rules.append(trade)
        if c._null_signal(spot, um, {}, entry):
            trade = fill(entry, um, fee)
            if trade is not None:
                nulls.append(trade)
        entry += c.fp5.DAY_MS
    return rules, nulls


def fillable(um: dict, fee: float) -> int:
    n = 0
    entry = OOS_START
    while entry < ENTRY_END:
        if fill(entry, um, fee) is not None:
            n += 1
        entry += c.fp5.DAY_MS
    return n


def check_trade(spot: dict, um: dict, trade: dict, fee: float, louder: bool) -> None:
    entry = trade["entry_ms"]
    if entry > LAST_ENTRY or entry >= ENTRY_END:
        raise SystemExit("an entry is after 2026-09-04")
    if trade["book"] != "um" or trade["side"] != "long" or trade["coin"] != "BTCUSDT":
        raise SystemExit("the leg moved")
    if trade["exit_ms"] - entry != c.HOLD_DAYS * c.fp5.DAY_MS:
        raise SystemExit("the hold moved")
    if trade["exit_ms"] > EXIT_OPEN:
        raise SystemExit("an exit is after the 2026-09-25 open")
    recent_end = entry - c.fp5.DAY_MS
    recent_start = recent_end - 3 * c.fp5.DAY_MS
    prior_end = entry - 4 * c.fp5.DAY_MS
    prior_start = prior_end - 3 * c.fp5.DAY_MS
    for ts in (recent_start, recent_end, prior_start, prior_end):
        if ts > SIGNAL_LAST:
            raise SystemExit("a signal close is after 2026-09-03")
        if c._px(spot, ts, 1) is None:
            raise SystemExit("a signal close is missing")
    if louder:
        if not c._rule_signal(spot, um, {}, entry):
            raise SystemExit("the louder move did not fire")
        if c._null_signal(spot, um, {}, entry):
            raise SystemExit("a louder day is also the quieter trade")
    else:
        if not c._null_signal(spot, um, {}, entry):
            raise SystemExit("the quieter move did not fire")
        if c._rule_signal(spot, um, {}, entry):
            raise SystemExit("a quieter day is also the louder trade")
    net = c.fp5.net_return(um[entry][0], um[trade["exit_ms"]][0], fee)
    if abs(trade["net"] - net) > 1e-12:
        raise SystemExit("a fill is not this contract's own open")


def summarise(trades: list[dict], pool: list[float]) -> dict:
    n = len(trades)
    total = sum(t["pnl"] for t in trades)
    mean = total / n if n else 0.0
    cutoff = c.fp5.null_p95(pool, n, draws=NULL_DRAWS, seed=NULL_SEED) if n else None
    by_month: dict[str, float] = {}
    for trade in trades:
        key = month_of(trade["entry_ms"])
        by_month[key] = by_month.get(key, 0.0) + trade["pnl"]
    best_month = max(by_month, key=by_month.get) if by_month else None
    best = by_month[best_month] if best_month else 0.0
    share = (best / total) if total else None
    gap_bps = None if cutoff is None else (mean - cutoff) * 100.0
    return {
        "n": n,
        "total_pnl_usd": round(total, 4),
        "mean_pnl_usd": round(mean, 6) if n else None,
        "null_p95_pnl_usd": None if cutoff is None else round(cutoff, 4),
        "gap_bps": None if gap_bps is None else round(gap_bps, 4),
        "beats_null": bool(cutoff is not None and mean > cutoff),
        "clears_by_more_than_10bps": bool(gap_bps is not None and gap_bps > GAP_BPS),
        "best_month": best_month,
        "best_month_pnl_usd": round(best, 4),
        "best_month_share": None if share is None else round(share, 4),
        "without_best_month_usd": round(total - best, 4),
        "by_month": {key: round(value, 4) for key, value in sorted(by_month.items())},
    }


def window_total(trades: list[dict], start: int, end: int) -> float:
    return sum(t["pnl"] for t in trades if start <= t["entry_ms"] < end)


def merge(screen: dict, later: dict) -> dict:
    for ts, bar in later.items():
        if ts in screen and screen[ts] != bar:
            raise SystemExit("an overlapping day does not match the screen")
    out = dict(screen)
    out.update(later)
    return out


def main() -> None:
    digest = sha256(PREREG)
    if digest != SIDECAR.read_text().strip():
        raise SystemExit("the pre-registration does not match its frozen sha256")
    prereg = PREREG.read_text()
    for phrase in (
        "bid 84066.00, ask 84066.10, half-spread 5.947704216257381e-07",
        "the book's own time was 1790343592111",
        "strictly more than 10 bps",
    ):
        if phrase not in prereg:
            raise SystemExit("the frozen book is not the pre-registration")
    screen_doc = json.loads(SCREEN.read_text())
    common_path = Path(__file__).resolve().parent / "common.py"
    if sha256(common_path) != screen_doc["code_sha256"]["fp268_common"]:
        raise SystemExit("the rule file moved after the screen")
    if c.IDEA != "LOUDER" or c.HOLD_DAYS != 21 or c.MIN_N != 30:
        raise SystemExit("the frozen name, hold or count moved")
    if c.NULL_KIND != "other_regime" or c.MODE != "regime":
        raise SystemExit("the null is not the quieter regime")
    if c.RULE_BOOK != "um" or c.NULL_BOOK != "um" or c.RULE_SIDE != "long" or c.NULL_SIDE != "long":
        raise SystemExit("the legs moved")
    if LAST_ENTRY != int(datetime(2026, 9, 4, tzinfo=timezone.utc).timestamp() * 1000):
        raise SystemExit("the last entry is not 2026-09-04")
    if ENTRY_END != int(datetime(2026, 9, 5, tzinfo=timezone.utc).timestamp() * 1000):
        raise SystemExit("the entry window does not stop on 2026-09-05")
    if SIGNAL_LAST != int(datetime(2026, 9, 3, tzinfo=timezone.utc).timestamp() * 1000):
        raise SystemExit("the last signal close is not 2026-09-03")
    screen_spot_path = DATA / "spot1d" / "BTCUSDT.json"
    screen_um_path = DATA / "um1d" / "BTCUSDT.json"
    if sha256(screen_spot_path) != screen_doc["input_sha256"]["spot"]:
        raise SystemExit("the 2023 spot prices are not the screen's file")
    if sha256(screen_um_path) != screen_doc["input_sha256"]["um"]:
        raise SystemExit("the 2023 USDT prices are not the screen's file")
    screen_last_spot = c.fp5.SCREEN_END_MS - c.fp5.DAY_MS
    screen_spot = load_bars(screen_spot_path, 2, screen_last_spot)
    screen_um = load_bars(screen_um_path, 2, c.fp5.SCREEN_END_MS)
    if max(screen_spot) != screen_last_spot or max(screen_um) != c.fp5.SCREEN_END_MS:
        raise SystemExit("the screen files do not stop on the frozen days")
    screen = c.rule_trades(screen_spot, screen_um, {})
    screen_null = c.null_trades(screen_spot, screen_um, {})
    screen_total = round(sum(t["pnl"] for t in screen), 4)
    if len(screen) != 170 or abs(screen_total - 1021.9923) > 0.01:
        raise SystemExit(f"2023 did not reproduce: n={len(screen)} total={screen_total}")
    if len(screen_null) != 175:
        raise SystemExit("the 2023 quieter trade is not 175")
    if set(t["entry_ms"] for t in screen) & set(t["entry_ms"] for t in screen_null):
        raise SystemExit("a 2023 day is in both trades")
    rule_bps = sum(t["net"] for t in screen) / 170 * 10_000.0
    null_bps = sum(t["net"] for t in screen_null) / 175 * 10_000.0
    screen_cutoff = c.fp5.null_p95([t["net"] for t in screen_null], 170)
    cutoff_bps = None if screen_cutoff is None else screen_cutoff * 10_000.0
    if abs(rule_bps - 601.172) > 0.0001 or abs(null_bps - 529.6739) > 0.0001:
        raise SystemExit("the 2023 means did not reproduce")
    if cutoff_bps is None or abs(cutoff_bps - 551.9241) > 0.0001:
        raise SystemExit("the 2023 cutoff is not the sample p95")
    quieter_mean_net = sum(t["net"] for t in screen_null) / 175
    if abs(screen_cutoff - quieter_mean_net) < 1e-15:
        raise SystemExit("the 2023 cutoff collapsed onto the quieter mean")
    for trade in screen:
        if trade["entry_ms"] >= OOS_START:
            raise SystemExit("a 2024 open was read as a 2023 entry")
        if trade["book"] != "um":
            raise SystemExit("a 2023 fill is not the USDT book")

    oos_spot_path = DATA / "oos_spot1d" / "BTCUSDT.json"
    oos_um_path = DATA / "oos_um1d" / "BTCUSDT.json"
    if not oos_spot_path.exists() or not oos_um_path.exists():
        oos_fetch.pull()
    oos_spot = load_bars(oos_spot_path, 2, SIGNAL_LAST)
    oos_um = load_bars(oos_um_path, 2, EXIT_OPEN)
    if min(oos_spot) != OOS_START or max(oos_spot) != SIGNAL_LAST:
        raise SystemExit("the spot window is wrong")
    if min(oos_um) != OOS_START or max(oos_um) != EXIT_OPEN:
        raise SystemExit("the USDT window is wrong")
    day = OOS_START
    while day <= SIGNAL_LAST:
        if day not in oos_spot:
            raise SystemExit("spot is missing a signal day")
        day += c.fp5.DAY_MS
    day = OOS_START
    while day <= EXIT_OPEN:
        if day not in oos_um:
            raise SystemExit("the USDT book is missing a day")
        day += c.fp5.DAY_MS
    spot = merge(screen_spot, oos_spot)
    um = merge(screen_um, oos_um)
    primary, nulls = collect(spot, um, FEE)
    doubled, doubled_nulls = collect(spot, um, FEE_DOUBLE)
    if not primary:
        raise SystemExit("the out-of-sample run has no fill")
    if [t["entry_ms"] for t in primary] != [t["entry_ms"] for t in doubled]:
        raise SystemExit("the doubled-cost entries moved")
    if [t["entry_ms"] for t in nulls] != [t["entry_ms"] for t in doubled_nulls]:
        raise SystemExit("the doubled-cost quieter entries moved")
    if set(t["entry_ms"] for t in primary) & set(t["entry_ms"] for t in nulls):
        raise SystemExit("a day is in both trades")
    if max(t["entry_ms"] for t in primary) > LAST_ENTRY:
        raise SystemExit("an entry is after 2026-09-04")
    if len(primary) >= fillable(um, FEE) or len(nulls) >= fillable(um, FEE):
        raise SystemExit("a regime is every USDT day")
    wrecked_spot = dict(spot)
    wrecked_um = dict(um)
    for trade in primary:
        row = wrecked_um[trade["entry_ms"]]
        wrecked_um[trade["entry_ms"]] = (row[0] * 10.0, row[1])
    for ts, row in list(wrecked_spot.items()):
        if ts > SIGNAL_LAST:
            wrecked_spot[ts] = (row[0], row[1] * 7.0)
    wrecked_rules, _wrecked_nulls = collect(wrecked_spot, wrecked_um, FEE)
    if [t["entry_ms"] for t in wrecked_rules] != [t["entry_ms"] for t in primary]:
        raise SystemExit("a later close or the entry open moved a buy")
    sample = primary[0]
    thin_um = dict(um)
    del thin_um[sample["exit_ms"]]
    thin_rules, _thin_nulls = collect(spot, thin_um, FEE)
    if any(t["entry_ms"] == sample["entry_ms"] for t in thin_rules):
        raise SystemExit("a missing USDT open was filled from another book")
    for trade in primary:
        check_trade(spot, um, trade, FEE, True)
    for trade in nulls:
        check_trade(spot, um, trade, FEE, False)
    for trade in doubled:
        check_trade(spot, um, trade, FEE_DOUBLE, True)
    pool = [t["pnl"] for t in nulls]
    holds = {trade["exit_ms"] - trade["entry_ms"] for trade in primary}
    if holds != {c.HOLD_DAYS * c.fp5.DAY_MS}:
        raise SystemExit("the rule hold is not twenty-one days")
    primary_sum = summarise(primary, pool)
    house = c.fp5.null_p95(pool, len(primary), draws=NULL_DRAWS, seed=NULL_SEED)
    if house is None:
        if primary_sum["null_p95_pnl_usd"] is not None or primary_sum["beats_null"]:
            raise SystemExit("a short quieter set was replaced with its mean")
    elif abs(primary_sum["null_p95_pnl_usd"] - round(house, 4)) > 1e-9:
        raise SystemExit("the cutoff is not the sample p95")
    other_mean = sum(pool) / len(pool) if pool else None
    if house is not None and other_mean is not None and len(pool) > len(primary):
        if abs(house - other_mean) < 1e-12:
            raise SystemExit("the cutoff collapsed onto the quieter mean")
    oos1 = window_total(primary, OOS_START, OOS_SPLIT)
    oos2 = window_total(primary, OOS_SPLIT, ENTRY_END)
    oos_days = (datetime(2026, 9, 25, tzinfo=timezone.utc) - datetime(2024, 1, 1, tzinfo=timezone.utc)).days
    if oos_days != 998:
        raise SystemExit(f"the pre-registration's 998 days came out as {oos_days}")
    ann = (primary_sum["total_pnl_usd"] / 100.0) * (365.0 / oos_days)
    doubled_total = sum(t["pnl"] for t in doubled)
    share = primary_sum["best_month_share"]
    conditions = {
        "both_subwindows_positive": oos1 > 0 and oos2 > 0 and primary_sum["total_pnl_usd"] > 0,
        "beats_null": primary_sum["beats_null"],
        "doubled_costs_positive": doubled_total > 0,
        "at_least_30": primary_sum["n"] >= 30,
        "not_one_month": bool(
            share is not None and share <= 0.40 and primary_sum["without_best_month_usd"] > 0
        ),
        "above_cash": ann > 0.04,
        "clears_by_more_than_10bps": primary_sum["clears_by_more_than_10bps"],
    }
    payload = {
        "prereg_sha256": digest,
        "screen_reproduction": {
            "n": len(screen),
            "total_pnl_usd": screen_total,
            "mean_net_bps": round(rule_bps, 4),
            "null_n": len(screen_null),
            "null_mean_bps": round(null_bps, 4),
            "null_p95_bps": round(cutoff_bps, 4),
        },
        "oos1_pnl_usd": round(oos1, 4),
        "oos2_pnl_usd": round(oos2, 4),
        "oos_days": oos_days,
        "annualised": round(ann, 6),
        "primary": primary_sum,
        "null_n": len(nulls),
        "null_mean_pnl_usd": None if other_mean is None else round(other_mean, 6),
        "doubled_pnl_usd": round(doubled_total, 4),
        "conditions": conditions,
        "passes": all(conditions.values()),
        "um_half_spread": UM_HALF,
        "null_kind": "other_regime",
        "last_entry_ms": LAST_ENTRY,
        "exit_open_ms": EXIT_OPEN,
        "signal_last_ms": SIGNAL_LAST,
        "input_sha256": {
            "screen_spot": sha256(screen_spot_path),
            "screen_um": sha256(screen_um_path),
            "oos_spot": sha256(oos_spot_path),
            "oos_um": sha256(oos_um_path),
        },
        "code_sha256": {
            "fp268_common": sha256(common_path),
            "fp268_louder_test": sha256(Path(__file__)),
            "fp268_oos_fetch": sha256(Path(oos_fetch.__file__)),
        },
    }
    text = json.dumps(payload, indent=2, sort_keys=True) + "\n"
    out = ROOT / "docs/agents/backtests/fp268/louder_oos.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(text)
    print(text, end="")


if __name__ == "__main__":
    main()
