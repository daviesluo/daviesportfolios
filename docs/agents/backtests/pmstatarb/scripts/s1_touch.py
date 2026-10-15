"""TOUCH-CAL on the frozen spec. No parameter is chosen from this file's output.

Universe: data/touch_s1_universe.csv (title_end through 2026-08-31).
Headline is 2025-01-01 through 2026-08-31. 2024 is reported beside the bar
and is not used to pass it. September 2026 is not read.

Choices the spec left open, fixed here before any result:
- Spot at entry is the last 1-minute close whose candle has closed
  (open time + 60s <= entry). A close older than 5 minutes is not used.
- A daily close is the last 1-minute close of that UTC date.
- Vol is the sample standard deviation (divisor n-1) of the last 30
  consecutive daily log returns whose daily close is strictly before entry,
  times sqrt(365). A hole in those 30 dates skips the market.
- Reach contracts must settle on High, dip contracts on Low. Another field
  is excluded, not repriced.
- Fee is shares × rate × (p × (1−p))^exponent, from that market's feeSchedule.
  Exponent 1 is the published crypto formula. A disabled schedule charges 0.
  An enabled schedule missing rate or exponent is excluded. 0.07 is not filled in.
  The dollar fee is rounded half-up to 5 decimals; a positive fee that rounds
  to 0 is charged 0.00001. The threshold uses the unrounded per-share fee.
- Tick is the market's orderPriceMinTickSize. A missing tick is excluded.
- One tick worse is the print price plus the tick, capped at 1.
- Month and year are the title_end calendar month and year.
- The cheap side is the outcome whose worsened fill is below the model.
  Deviation is measured at that fill.

usage: python3 -I docs/agents/backtests/pmstatarb/scripts/s1_touch.py
       python3 -I docs/agents/backtests/pmstatarb/scripts/s1_touch.py --self-test
"""
import csv
import datetime as dt
import json
import math
import os
import random
import sys
from collections import defaultdict
from decimal import Decimal, ROUND_HALF_UP

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import g1_pull  # noqa: E402
import net  # noqa: E402
import touch_model  # noqa: E402

# Frozen with SPEC-for-verification.md. Not retuned after a result.
SEED = 20261014
HORIZONS = (72, 24, 12)
HEADLINE_H = 24
THRESHOLDS = (0.04, 0.03, 0.05)
HEADLINE_THR = 0.04
STAKE = 20.0
STAKE_BESIDE = 50.0
DRAWS = 10000
BAR_TRADES = 150
BAR_MARKETS = 100
BAR_BOUND = -0.02
BAR_MARKET_SHARE = 0.25
BAR_MONTH_SHARE = 0.50
BAR_YEAR = -0.05
STALE_MS = 5 * 60 * 1000
VOL_RETURNS = 30
YEAR_SECONDS = 365 * 24 * 3600
FIELD_OK = {"touch_up": "High", "touch_dn": "Low"}
PAIR_OK = {"BTC": "BTCUSDT", "ETH": "ETHUSDT"}


def _f(text):
    try:
        return float(text)
    except (TypeError, ValueError):
        return None


def _ms(iso):
    t = dt.datetime.fromisoformat(iso.replace("Z", "+00:00"))
    return int(t.timestamp() * 1000)


def load_spot(symbol):
    path = os.path.join(net.DATA, "g2", symbol + ".csv")
    opens, closes = [], []
    daily = {}
    if not os.path.exists(path):
        return opens, closes, daily, None
    last = None
    with open(path, newline="") as f:
        for row in csv.DictReader(f):
            if not row["open_ms"].isdigit():
                continue
            open_ms = int(row["open_ms"])
            px = float(row["close"])
            opens.append(open_ms)
            closes.append(px)
            day = dt.datetime.fromtimestamp(open_ms / 1000, dt.timezone.utc).strftime("%Y-%m-%d")
            prev = daily.get(day)
            if prev is None or open_ms >= prev[0]:
                daily[day] = (open_ms, px)
            last = open_ms + 60_000
    return opens, closes, daily, last


def spot_at(opens, closes, entry_ms):
    lo, hi = 0, len(opens)
    # last open_ms <= entry_ms - 60000
    target = entry_ms - 60_000
    while lo < hi:
        mid = (lo + hi) // 2
        if opens[mid] <= target:
            lo = mid + 1
        else:
            hi = mid
    i = lo - 1
    if i < 0:
        return None
    close_ms = opens[i] + 60_000
    if entry_ms - close_ms > STALE_MS:
        return None
    return closes[i]


def realised_vol(daily, entry_ms):
    days = sorted(day for day, (open_ms, _px) in daily.items() if open_ms + 60_000 <= entry_ms)
    need = VOL_RETURNS + 1
    if len(days) < need:
        return None
    window = days[-need:]
    dates = [dt.date.fromisoformat(day) for day in window]
    for a, b in zip(dates, dates[1:]):
        if (b - a).days != 1:
            return None
    px = [daily[day][1] for day in window]
    rets = [math.log(px[i] / px[i - 1]) for i in range(1, len(px))]
    n = len(rets)
    mean = sum(rets) / n
    var = sum((x - mean) ** 2 for x in rets) / (n - 1)
    if var <= 0:
        return None
    return math.sqrt(var * 365)


def _iso(ms):
    return dt.datetime.fromtimestamp(ms / 1000, dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def load_universe():
    path = os.path.join(g1_pull.DATA, "touch_s1_universe.csv")
    rows = []
    with open(path, newline="") as f:
        for row in csv.DictReader(f):
            rows.append(row)
    return rows


def load_capped():
    """Markets whose print walk hit the page cap. Their tape is not complete."""
    path = os.path.join(net.DATA, "g2", "trades.capped.txt")
    if not os.path.exists(path):
        return set()
    with open(path) as f:
        return {line.strip() for line in f if line.strip()}


def load_prints():
    """Prints keyed by condition id: (timestamp, price, outcome, taker side).

    data-api `side` is the taker's side. The fill keeps it. A row with no
    side is stored and then skipped by first_print, so it cannot be a fill.
    """
    path = os.path.join(net.DATA, "g2", "trades.jsonl")
    by = defaultdict(list)
    if not os.path.exists(path):
        return by
    with open(path) as f:
        for line in f:
            if not line.strip():
                continue
            row = json.loads(line)
            ts = row.get("timestamp")
            price = _f(row.get("price"))
            if ts is None or price is None:
                continue
            by[row["conditionId"]].append((
                int(ts), price, str(row.get("outcome") or ""), str(row.get("side") or ""),
            ))
    return by


def first_print(prints, entry_s, outcome, taker_side="BUY"):
    """Earliest print of this outcome at or after entry, on the side we take.

    Buying an outcome lifts a BUY of that outcome. A SELL print is the other
    side of the book and is not a fill. Ties keep the later row.
    """
    found = None
    want = taker_side.upper()
    for ts, price, name, side in prints:
        if name.lower() != outcome or ts < entry_s or str(side).upper() != want:
            continue
        if found is None or ts < found[0] or ts == found[0]:
            found = (ts, price)
    return found


def worsen(price, tick):
    fill = price + tick
    if fill > 1:
        fill = 1.0
    if fill <= 0:
        return None
    return fill


def fee_per_share(rate, exponent, fill):
    return rate * (fill * (1.0 - fill)) ** exponent


def dollar_fee(shares, rate, exponent, fill):
    raw = shares * fee_per_share(rate, exponent, fill)
    q = Decimal(str(raw)).quantize(Decimal("0.00001"), rounding=ROUND_HALF_UP)
    if raw > 0 and q == 0:
        q = Decimal("0.00001")
    return float(q)


def roi_of(fill, rate, exponent, payout, stake):
    shares = stake / fill
    fee = dollar_fee(shares, rate, exponent, fill)
    pnl = shares * payout - stake - fee
    return pnl / stake, pnl, fee


def decide(model, yes_fill, no_fill, rate, exponent, tick, threshold):
    """Return a trade dict or None. model is P(YES)."""
    cands = []
    if yes_fill is not None:
        edge = model - yes_fill
        dev = abs(yes_fill - model)
        fee_ps = fee_per_share(rate, exponent, yes_fill)
        cands.append(("yes", yes_fill, edge, dev, fee_ps))
    if no_fill is not None:
        model_no = 1.0 - model
        edge = model_no - no_fill
        dev = abs(no_fill - model_no)
        fee_ps = fee_per_share(rate, exponent, no_fill)
        cands.append(("no", no_fill, edge, dev, fee_ps))
    cands = [c for c in cands if c[2] > 0 and c[3] >= max(threshold, c[4] + 2.0 * tick)]
    if not cands:
        return None
    cands.sort(key=lambda c: c[2], reverse=True)
    side, fill, edge, dev, fee_ps = cands[0]
    return {"side": side, "fill": fill, "edge": edge, "dev": dev, "threshold": max(threshold, fee_ps + 2.0 * tick)}


def percentile(values, p):
    if not values:
        return None
    xs = sorted(values)
    k = (len(xs) - 1) * p
    lo = int(math.floor(k))
    hi = int(math.ceil(k))
    if lo == hi:
        return xs[lo]
    return xs[lo] * (hi - k) + xs[hi] * (k - lo)


def bootstrap(trades):
    """Resample whole markets. One trade per market at a single horizon."""
    by = defaultdict(list)
    for t in trades:
        by[t["conditionId"]].append(t)
    ids = list(by)
    if not ids:
        return None
    rng = random.Random(SEED)
    means = []
    n = len(ids)
    for _ in range(DRAWS):
        draw = [ids[rng.randrange(n)] for _ in range(n)]
        rois = [t["roi"] for i in draw for t in by[i]]
        means.append(sum(rois) / len(rois))
    return percentile(means, 0.05)


def evaluate(trades):
    if not trades:
        return {"n": 0, "markets": 0, "mean": None, "bound": None, "pnl": 0.0}
    mean = sum(t["roi"] for t in trades) / len(trades)
    pnl = sum(t["pnl"] for t in trades)
    return {
        "n": len(trades),
        "markets": len({t["conditionId"] for t in trades}),
        "mean": mean,
        "bound": bootstrap(trades),
        "pnl": pnl,
    }


def shares_ok(trades):
    if not trades:
        return True, "", ""
    total = sum(t["pnl"] for t in trades)
    by_m = defaultdict(float)
    by_month = defaultdict(float)
    for t in trades:
        by_m[t["conditionId"]] += t["pnl"]
        by_month[t["title_end"][:7]] += t["pnl"]
    if abs(total) < 1e-9:
        return True, "total pnl ~ 0", "total pnl ~ 0"
    top_id, top = max(by_m.items(), key=lambda kv: kv[1] / total)
    top_share = top / total
    month, mp = max(by_month.items(), key=lambda kv: kv[1] / total)
    month_share = mp / total
    return top_share <= BAR_MARKET_SHARE and month_share <= BAR_MONTH_SHARE, (
        f"{top_id} {top_share:.4f}"
    ), f"{month} {month_share:.4f}"


def year_ok(trades):
    by = defaultdict(list)
    for t in trades:
        by[t["title_end"][:4]].append(t["roi"])
    lines = []
    ok = True
    for year in sorted(by):
        mean = sum(by[year]) / len(by[year])
        lines.append(f"{year} n {len(by[year])} mean {mean:.4f}")
        if mean < BAR_YEAR:
            ok = False
    return ok, lines


def calibration(rows):
    bins = defaultdict(lambda: [0, 0.0, 0.0])
    for model, payout in rows:
        b = min(9, int(model * 10))
        bins[b][0] += 1
        bins[b][1] += model
        bins[b][2] += payout
    lines = ["decile n mean_model realised"]
    for b in range(10):
        n, s, r = bins[b]
        if n == 0:
            lines.append(f"{b} 0")
            continue
        lines.append(f"{b} {n} {s / n:.4f} {r / n:.4f}")
    return lines


def build(universe, prints, spots, capped=None):
    """Return trades[(hours, threshold, sample)] and calibration rows and counts."""
    capped = capped or set()
    trades = defaultdict(list)
    cal = defaultdict(list)
    counts = defaultdict(int)
    for row in universe:
        sample = row["sample"]
        counts["rows"] += 1
        if row["conditionId"] in capped:
            counts["tape_capped"] += 1
            continue
        if row.get("clause_ok") != "1" or not row.get("settlement_utc"):
            counts["no_clause"] += 1
            continue
        if row.get("field") != FIELD_OK.get(row.get("type")):
            counts["field"] += 1
            continue
        if row.get("pair") != PAIR_OK.get(row.get("asset")):
            counts["pair"] += 1
            continue
        if row.get("fees_enabled") == "1" and (not row.get("fee_rate") or not row.get("fee_exponent")):
            counts["fee_unknown"] += 1
            continue
        tick = _f(row.get("tick"))
        if tick is None or tick <= 0:
            counts["tick"] += 1
            continue
        if row.get("fees_enabled") != "1":
            rate, exponent = 0.0, 1.0
        else:
            rate, exponent = _f(row.get("fee_rate")), _f(row.get("fee_exponent"))
        if rate is None or exponent is None:
            counts["fee_unknown"] += 1
            continue
        strike = _f(row.get("strike"))
        payout = _f(row.get("payout_yes"))
        if strike is None or payout not in (0.0, 1.0):
            counts["unpriced"] += 1
            continue
        side = "up" if row["type"] == "touch_up" else "down"
        symbol = PAIR_OK[row["asset"]]
        opens, closes, daily, _last = spots[symbol]
        if not opens:
            counts["no_spot_file"] += 1
            continue
        settle_ms = _ms(row["settlement_utc"])
        book = prints.get(row["conditionId"], [])
        for hours in HORIZONS:
            entry_ms = settle_ms - hours * 3600 * 1000
            entry_s = entry_ms // 1000
            spot = spot_at(opens, closes, entry_ms)
            sigma = None if spot is None else realised_vol(daily, entry_ms)
            if spot is None or sigma is None:
                counts[f"no_spot_{hours}"] += 1
                continue
            years = (settle_ms - entry_ms) / 1000 / YEAR_SECONDS
            model = touch_model.one_touch(spot, strike, sigma, years, side, discrete=True)
            if model is None:
                counts["model"] += 1
                continue
            if hours == HEADLINE_H and sample == "headline":
                cal[sample].append((model, payout))
            if hours == HEADLINE_H and sample == "y2024":
                cal[sample].append((model, payout))
            yes = first_print(book, entry_s, "yes")
            no = first_print(book, entry_s, "no")
            yes_fill = None if yes is None else worsen(yes[1], tick)
            no_fill = None if no is None else worsen(no[1], tick)
            if yes_fill is None and no_fill is None:
                counts[f"no_print_{hours}"] += 1
                continue
            for thr in THRESHOLDS:
                chosen = decide(model, yes_fill, no_fill, rate, exponent, tick, thr)
                if chosen is None:
                    continue
                pay = payout if chosen["side"] == "yes" else 1.0 - payout
                for stake, tag in ((STAKE, "s20"), (STAKE_BESIDE, "s50")):
                    roi, pnl, fee = roi_of(chosen["fill"], rate, exponent, pay, stake)
                    trades[(hours, thr, sample, tag)].append({
                        "conditionId": row["conditionId"],
                        "title_end": row["title_end"],
                        "family": row["family"],
                        "asset": row["asset"],
                        "side": chosen["side"],
                        "fill": chosen["fill"],
                        "model": model,
                        "roi": roi,
                        "pnl": pnl,
                        "fee": fee,
                    })
    return trades, cal, counts


def _fmt(x):
    return "" if x is None else f"{x:.4f}"


def verdict_of(stats, share_ok, years_ok, neighbour_ok):
    if stats["n"] < BAR_TRADES or stats["markets"] < BAR_MARKETS:
        return "not run, coverage"
    mean = stats["mean"]
    bound = stats["bound"]
    passed = (
        mean is not None and mean > 0
        and bound is not None and bound > BAR_BOUND
        and neighbour_ok
        and share_ok
        and years_ok
    )
    return "PASS" if passed else "FAIL"


def write_report(trades, cal, counts, spot_last):
    headline = trades[(HEADLINE_H, HEADLINE_THR, "headline", "s20")]
    stats = evaluate(headline)
    share_ok, market_line, month_line = shares_ok(headline)
    years_good, year_lines = year_ok(headline)
    neighbour_lines = []
    neighbour_ok = True
    sign = None if stats["mean"] is None else (1 if stats["mean"] > 0 else -1 if stats["mean"] < 0 else 0)
    for hours in HORIZONS:
        for thr in THRESHOLDS:
            if hours == HEADLINE_H and thr == HEADLINE_THR:
                continue
            st = evaluate(trades[(hours, thr, "headline", "s20")])
            s = None if st["mean"] is None else (1 if st["mean"] > 0 else -1 if st["mean"] < 0 else 0)
            same = sign is not None and s == sign and sign != 0
            if not same:
                neighbour_ok = False
            neighbour_lines.append(
                f"h {hours} thr {thr} n {st['n']} markets {st['markets']} mean {_fmt(st['mean'])} "
                f"p05 {_fmt(st['bound'])} same_sign {int(same)}"
            )
    beside = evaluate(trades[(HEADLINE_H, HEADLINE_THR, "y2024", "s20")])
    stake50 = evaluate(trades[(HEADLINE_H, HEADLINE_THR, "headline", "s50")])
    name = verdict_of(stats, share_ok, years_good, neighbour_ok)
    lines = [
        f"verdict {name}",
        "sample title_end 2025-01-01 through 2026-08-31",
        "held out title_end on or after 2026-09-01, including the incomplete September pull and the October tail",
        "2024 is beside the bar, not part of it",
        f"headline horizon {HEADLINE_H}h threshold {HEADLINE_THR} stake {STAKE:.0f} seed {SEED} draws {DRAWS}",
        f"n {stats['n']} markets {stats['markets']} mean_roi {_fmt(stats['mean'])} "
        f"p05 {_fmt(stats['bound'])} pnl {stats['pnl']:.2f}",
        f"stake50 mean_roi {_fmt(stake50['mean'])} n {stake50['n']}",
        f"bar trades {int(stats['n'] >= BAR_TRADES)} markets {int(stats['markets'] >= BAR_MARKETS)} "
        f"mean_positive {int(stats['mean'] is not None and stats['mean'] > 0)} "
        f"bound {int(stats['bound'] is not None and stats['bound'] > BAR_BOUND)} "
        f"neighbours {int(neighbour_ok)} share {int(share_ok)} years {int(years_good)}",
        f"top_market_share {market_line}",
        f"top_month_share {month_line}",
        "years",
        *year_lines,
        "coverage complete Gamma months 2024-01 through 2026-08. Title ends on or after 2026-09-01 are held out.",
        "september numbers are in results/g1_gap_mix.txt",
        f"label the bar word is {name}. If that word is FAIL, the other name is FAIL on available sample. Davies chooses.",
        "neighbours",
        *neighbour_lines,
        f"y2024 n {beside['n']} markets {beside['markets']} mean_roi {_fmt(beside['mean'])} p05 {_fmt(beside['bound'])}",
        "counts",
    ]
    for key in sorted(counts):
        lines.append(f"{key} {counts[key]}")
    lines.append("spot_last_close_ms " + " ".join(f"{sym} {spot_last[sym]}" for sym in spot_last))
    lines.append("calibration headline T-24h model decile, all modelled markets, not only trades")
    lines.extend(calibration(cal["headline"]))
    lines.append("calibration y2024")
    lines.extend(calibration(cal["y2024"]))
    lines.append("not checked: prices-history fill counterfactual")
    lines.append("not checked: touch/terminal mid ratio (terminal prints were not pulled)")
    text = "\n".join(lines) + "\n"
    path = os.path.join(g1_pull.RESULTS, "s1_verdict.txt")
    with open(path, "w") as f:
        f.write(text)
    trade_path = os.path.join(g1_pull.RESULTS, "s1_headline_trades.csv")
    with open(trade_path, "w", newline="") as f:
        fields = ["conditionId", "title_end", "family", "asset", "side", "fill", "model", "roi", "pnl", "fee"]
        w = csv.DictWriter(f, fieldnames=fields, lineterminator="\n")
        w.writeheader()
        for t in sorted(headline, key=lambda r: r["conditionId"]):
            w.writerow({k: (f"{t[k]:.6f}" if isinstance(t[k], float) else t[k]) for k in fields})
    print(text, end="", flush=True)
    return name


def ready(universe, spot_last, capped=None):
    capped = capped if capped is not None else load_capped()
    done_path = os.path.join(net.DATA, "g2", "trades.done.txt")
    done = set()
    if os.path.exists(done_path):
        with open(done_path) as f:
            done = {line.strip() for line in f if line.strip()}
    need = [r["conditionId"] for r in universe if r.get("settlement_utc") and r.get("clause_ok") == "1"]
    # A capped walk is a known hole, not a finished tape. It does not count as done.
    missing = [cid for cid in need if cid not in done and cid not in capped]
    if missing:
        print(f"prints incomplete {len(missing)} of {len(need)}", flush=True)
        return False
    latest = 0
    for row in universe:
        if row.get("settlement_utc"):
            latest = max(latest, _ms(row["settlement_utc"]))
    for sym, last in spot_last.items():
        if last is None or last < latest:
            print(f"spot incomplete {sym} last {last} need {latest}", flush=True)
            return False
    return True


def self_test():
    roi, pnl, fee = roi_of(0.5, 0.0, 1.0, 1.0, 20.0)
    assert abs(roi - 1.0) < 1e-12 and abs(pnl - 20.0) < 1e-12 and fee == 0.0
    # Docs crypto table: 100 shares at 0.50, rate 0.07, exponent 1 → 1.75.
    assert abs(dollar_fee(100.0, 0.07, 1.0, 0.5) - 1.75) < 1e-12
    # Exponent 2 with rate 0.25: 100 * 0.25 * (0.5*0.5)**2 = 1.5625.
    assert abs(dollar_fee(100.0, 0.25, 2.0, 0.5) - 1.5625) < 1e-12
    roi, pnl, fee = roi_of(0.5, 0.07, 1.0, 1.0, 20.0)
    assert abs(fee - 0.7) < 1e-12, fee
    assert abs(roi - 0.965) < 1e-12, roi
    roi, _pnl, _fee = roi_of(0.5, 0.0, 1.0, 0.0, 20.0)
    assert abs(roi - -1.0) < 1e-12
    # Stake scales out of ROI when the fee scales with shares.
    a, _, _ = roi_of(0.4, 0.07, 1.0, 1.0, 20.0)
    b, _, _ = roi_of(0.4, 0.07, 1.0, 1.0, 50.0)
    assert abs(a - b) < 1e-12
    # 30 identical-length dates, known vol.
    daily = {}
    px = 100.0
    start = dt.date(2025, 1, 1)
    for i in range(40):
        day = start + dt.timedelta(days=i)
        open_ms = int(dt.datetime(day.year, day.month, day.day, 23, 59, tzinfo=dt.timezone.utc).timestamp()) * 1000
        daily[day.isoformat()] = (open_ms, px)
        px *= math.exp(0.01)
    entry = daily[(start + dt.timedelta(days=39)).isoformat()][0] + 60_000
    sigma = realised_vol(daily, entry)
    # Constant log return 0.01 has sample stdev 0, so vol is refused.
    assert sigma is None
    # A one-day hole refuses the trail.
    del daily[(start + dt.timedelta(days=20)).isoformat()]
    assert realised_vol(daily, entry) is None
    opens = [0, 60_000, 120_000]
    closes = [1.0, 2.0, 3.0]
    assert spot_at(opens, closes, 180_000) == 3.0
    assert spot_at(opens, closes, 180_000 + STALE_MS + 1) is None
    chosen = decide(0.50, 0.31, None, 0.0, 1.0, 0.01, 0.04)
    assert chosen["side"] == "yes" and abs(chosen["fill"] - 0.31) < 1e-12
    assert decide(0.50, 0.49, 0.49, 0.0, 1.0, 0.01, 0.04) is None
    # A SELL before the first BUY is the other side. The fill is the BUY.
    book = [(100, 0.20, "Yes", "SELL"), (110, 0.40, "Yes", "BUY"), (105, 0.30, "Yes", "BUY")]
    got = first_print(book, 100, "yes")
    assert got == (105, 0.30), got
    assert first_print([(100, 0.20, "Yes", "SELL")], 100, "yes") is None
    assert first_print([(100, 0.20, "Yes", "")], 100, "yes") is None
    assert first_print([(100, 0.20, "No", "BUY")], 100, "yes") is None
    print("s1_touch self-test ok")


def main():
    if "--self-test" in sys.argv:
        self_test()
        return
    universe = load_universe()
    spots = {}
    spot_last = {}
    for sym in ("BTCUSDT", "ETHUSDT"):
        opens, closes, daily, last = load_spot(sym)
        spots[sym] = (opens, closes, daily, last)
        spot_last[sym] = last
    capped = load_capped()
    if not ready(universe, spot_last, capped):
        sys.exit(3)
    prints = load_prints()
    trades, cal, counts = build(universe, prints, spots, capped)
    write_report(trades, cal, counts, spot_last)


if __name__ == "__main__":
    main()
