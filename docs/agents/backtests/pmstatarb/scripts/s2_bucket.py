"""BUCKET-DIST on the frozen spec. No parameter is chosen from this file's output.

Universe: $PM_DATA/data/bucket_s2_universe.csv. Headline is title_end
2025-01-01 through 2026-08-31. September 2026 is not read. 2024 is not pulled.

The threshold is 4 probability points, flat. It is not max(threshold, fee + 2
ticks). The fee is still charged on the stake. Fills are the first taker BUY
of the bought outcome at or after entry, plus one tick, capped at 1.

usage: python3 -I docs/agents/backtests/pmstatarb/scripts/s2_bucket.py
       python3 -I docs/agents/backtests/pmstatarb/scripts/s2_bucket.py --self-test
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

# Frozen with FROZEN-S2-bucket-dist.md. Not retuned after a result.
SEED = 20261014
HORIZONS = (24, 12, 48)
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
PAIR = {"BTC": "BTCUSDT", "ETH": "ETHUSDT"}
CELLS = (
    ("centre", "yes", "centre-bought"),
    ("centre", "no", "centre-sold"),
    ("tail", "yes", "tail-bought"),
    ("tail", "no", "tail-sold"),
    ("other", "yes", "other-bought"),
    ("other", "no", "other-sold"),
)


def _f(text):
    try:
        return float(text)
    except (TypeError, ValueError):
        return None


def _ms(iso):
    t = dt.datetime.fromisoformat(iso.replace("Z", "+00:00"))
    return int(t.timestamp() * 1000)


def _bounds(row):
    lo = _f(row.get("bound_lo")) if row.get("bound_lo") else None
    hi = _f(row.get("bound_hi")) if row.get("bound_hi") else None
    return lo, hi


def norm_cdf(z):
    return 0.5 * (1.0 + math.erf(z / math.sqrt(2.0)))


def bucket_prob(spot, sigma, years, lo, hi):
    """Driftless lognormal. A price on a strike belongs to the higher bracket.

    Open low is S < hi. An interior is lo <= S < hi. Open high is S >= lo.
    """
    if spot is None or spot <= 0 or sigma is None or sigma <= 0 or years <= 0:
        return None
    if lo is None and hi is None:
        return None
    mu = -0.5 * sigma * sigma * years
    scale = sigma * math.sqrt(years)
    if scale <= 0:
        return None

    def z(bound):
        if bound is None or bound <= 0:
            return None
        return (math.log(bound / spot) - mu) / scale

    if lo is None:
        zh = z(hi)
        return None if zh is None else norm_cdf(zh)
    if hi is None:
        zl = z(lo)
        return None if zl is None else 1.0 - norm_cdf(zl)
    zl, zh = z(lo), z(hi)
    if zl is None or zh is None:
        return None
    return norm_cdf(zh) - norm_cdf(zl)


def contains(lo, hi, spot):
    if lo is None and hi is None:
        return False
    if lo is None:
        return spot < hi
    if hi is None:
        return spot >= lo
    return lo <= spot < hi


def role(lo, hi, spot):
    """Centre is the one bounded bucket that contains the spot.

    An open wing is a tail even when the spot sits inside it. Any other
    bounded bucket is other: it can trade, and it is not in the one-sided test.
    """
    if lo is None or hi is None:
        return "tail"
    if contains(lo, hi, spot):
        return "centre"
    return "other"


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


def load_universe():
    path = os.environ.get("PM_UNIVERSE") or os.path.join(net.DATA, "data", "bucket_s2_universe.csv")
    rows = []
    with open(path, newline="") as f:
        for row in csv.DictReader(f):
            rows.append(row)
    return rows


def load_capped():
    path = os.path.join(net.DATA, "g2", "trades.capped.txt")
    if not os.path.exists(path):
        return set()
    with open(path) as f:
        return {line.strip() for line in f if line.strip()}


def load_prints():
    """Prints keyed by condition id: (timestamp, price, outcome, taker side)."""
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
    """Earliest print of this outcome at or after entry, on the taker side.

    Ties keep the later row. An empty side is not a fill.
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
    """The larger edge at or above the flat threshold. Equal edges keep YES.

    rate, exponent and tick are accepted so the call matches the fill path.
    They do not raise the threshold. The tick is already inside the fill.
    """
    del rate, exponent, tick
    cands = []
    if yes_fill is not None:
        edge = model - yes_fill
        dev = abs(yes_fill - model)
        if edge >= threshold:
            cands.append(("yes", yes_fill, edge, dev))
    if no_fill is not None:
        model_no = 1.0 - model
        edge = model_no - no_fill
        dev = abs(no_fill - model_no)
        if edge >= threshold:
            cands.append(("no", no_fill, edge, dev))
    if not cands:
        return None
    cands.sort(key=lambda c: c[2], reverse=True)
    side, fill, edge, dev = cands[0]
    return {"side": side, "fill": fill, "edge": edge, "dev": dev, "threshold": threshold}


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
    """Resample whole title_end days. A day keeps every asset and bucket on it."""
    by = defaultdict(list)
    for t in trades:
        by[t["title_end"]].append(t)
    days = list(by)
    if not days:
        return None
    rng = random.Random(SEED)
    means = []
    n = len(days)
    for _ in range(DRAWS):
        draw = [days[rng.randrange(n)] for _ in range(n)]
        rois = [t["roi"] for day in draw for t in by[day]]
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
    """Same market and month shares as S1. The market is one bucket."""
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
    # A negative total makes pnl/total select the worst month and can exceed 1.
    # That ratio is not a concentration, so the printed month line is N/A.
    # The boolean stays the frozen test.
    ok = top_share <= BAR_MARKET_SHARE and month_share <= BAR_MONTH_SHARE
    month_line = f"{month} {month_share:.4f}"
    if total < 0:
        month_line = f"N/A {month_line} total pnl negative"
    return ok, f"{top_id} {top_share:.4f}", month_line


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


def earns(trades):
    if not trades:
        return False, 0, None
    mean = sum(t["roi"] for t in trades) / len(trades)
    return mean > 0, len(trades), mean


def calibration(rows):
    bins = defaultdict(lambda: [0, 0.0, 0.0])
    for model, payout in rows:
        b = min(9, int(model * 10))
        if b < 0:
            b = 0
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


def _fee(row):
    if row.get("fees_enabled") != "1":
        return 0.0, 1.0
    return _f(row.get("fee_rate")), _f(row.get("fee_exponent"))


def build(universe, prints, spots, capped=None):
    capped = capped or set()
    trades = defaultdict(list)
    cal = []
    sums = {}
    counts = defaultdict(int)
    for row in universe:
        counts["rows"] += 1
        if row.get("pull") != "1" or row.get("sample") != "headline":
            counts["not_pulled"] += 1
            continue
        if row["conditionId"] in capped:
            counts["tape_capped"] += 1
            continue
        if row.get("clause_ok") != "1" or row.get("field") != "Close" or not row.get("settlement_utc"):
            counts["no_clause"] += 1
            continue
        if row.get("pair") != PAIR.get(row.get("asset")):
            counts["pair"] += 1
            continue
        lo, hi = _bounds(row)
        if lo is None and hi is None:
            counts["bounds"] += 1
            continue
        rate, exponent = _fee(row)
        if rate is None or exponent is None:
            counts["fee_unknown"] += 1
            continue
        tick = _f(row.get("tick"))
        if tick is None or tick <= 0:
            counts["tick"] += 1
            continue
        payout = _f(row.get("payout_yes"))
        if payout not in (0.0, 1.0):
            counts["unpriced"] += 1
            continue
        symbol = PAIR[row["asset"]]
        opens, closes, daily, _last = spots[symbol]
        if not opens:
            counts["no_spot_file"] += 1
            continue
        settle_ms = _ms(row["settlement_utc"])
        book = prints.get(row["conditionId"], [])
        part = (row["asset"], row["title_end"], row.get("event_title") or "")
        for hours in HORIZONS:
            entry_ms = settle_ms - hours * 3600 * 1000
            entry_s = entry_ms // 1000
            spot = spot_at(opens, closes, entry_ms)
            sigma = None if spot is None else realised_vol(daily, entry_ms)
            if spot is None or sigma is None:
                counts[f"no_spot_{hours}"] += 1
                continue
            years = (settle_ms - entry_ms) / 1000 / YEAR_SECONDS
            model = bucket_prob(spot, sigma, years, lo, hi)
            if model is None:
                counts["model"] += 1
                continue
            where = role(lo, hi, spot)
            if hours == HEADLINE_H:
                cal.append((model, payout))
                slot = sums.get(part)
                if slot is None:
                    slot = [0, 0.0, 0, 0.0]
                    sums[part] = slot
                slot[0] += 1
                slot[1] += model
                yes = first_print(book, entry_s, "yes")
                if yes is not None:
                    slot[2] += 1
                    slot[3] += yes[1]
            else:
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
                    trades[(hours, thr, tag)].append({
                        "conditionId": row["conditionId"],
                        "title_end": row["title_end"],
                        "asset": row["asset"],
                        "event_title": row.get("event_title") or "",
                        "role": where,
                        "side": chosen["side"],
                        "bound_lo": row.get("bound_lo") or "",
                        "bound_hi": row.get("bound_hi") or "",
                        "fill": chosen["fill"],
                        "model": model,
                        "roi": roi,
                        "pnl": pnl,
                        "fee": fee,
                    })
    return trades, cal, sums, counts


def _fmt(x):
    return "" if x is None else f"{x:.4f}"


def verdict_of(stats, share_ok, years_ok, neighbour_ok, one_sided):
    if stats["n"] < BAR_TRADES or stats["markets"] < BAR_MARKETS:
        return "not run, coverage"
    passed = (
        stats["mean"] is not None and stats["mean"] > 0
        and stats["bound"] is not None and stats["bound"] > BAR_BOUND
        and neighbour_ok
        and share_ok
        and years_ok
    )
    if passed and one_sided:
        return "one-sided"
    return "PASS" if passed else "FAIL"


def _decision(name):
    if name == "one-sided":
        return "Davies judges the one-sided result. It is not a PASS."
    if name == "not run, coverage":
        return "Coverage is short of the bar. The window is not widened and the threshold is not retuned."
    if name == "PASS":
        return "A PASS is a study result. Nothing is armed."
    return "A FAIL closes this parameter set. A follow-on is a new proposal, not a re-run."


def write_report(trades, cal, sums, counts, spot_last):
    headline = trades[(HEADLINE_H, HEADLINE_THR, "s20")]
    stats = evaluate(headline)
    share_ok, market_line, month_line = shares_ok(headline)
    years_good, year_lines = year_ok(headline)
    sign = None if stats["mean"] is None else (1 if stats["mean"] > 0 else -1 if stats["mean"] < 0 else 0)
    neighbour_lines = []
    neighbour_ok = True
    for hours in HORIZONS:
        for thr in THRESHOLDS:
            if hours == HEADLINE_H and thr == HEADLINE_THR:
                continue
            st = evaluate(trades[(hours, thr, "s20")])
            s = None if st["mean"] is None else (1 if st["mean"] > 0 else -1 if st["mean"] < 0 else 0)
            same = sign is not None and s == sign and sign != 0
            if not same:
                neighbour_ok = False
            neighbour_lines.append(
                f"h {hours} thr {thr} n {st['n']} markets {st['markets']} mean {_fmt(st['mean'])} "
                f"p05 {_fmt(st['bound'])} same_sign {int(same)}"
            )
    stake50 = evaluate(trades[(HEADLINE_H, HEADLINE_THR, "s50")])
    centre = [t for t in headline if t["role"] == "centre"]
    tail = [t for t in headline if t["role"] == "tail"]
    centre_earns, centre_n, centre_mean = earns(centre)
    tail_earns, tail_n, tail_mean = earns(tail)
    one_sided = centre_earns ^ tail_earns
    name = verdict_of(stats, share_ok, years_good, neighbour_ok, one_sided)
    lines = [
        f"verdict {name}",
        "sample title_end 2025-01-01 through 2026-08-31",
        "held out title_end on or after 2026-09-01. The September cursor was not sent again.",
        "2024 was not pulled",
        f"headline horizon {HEADLINE_H}h threshold {HEADLINE_THR} stake {STAKE:.0f} seed {SEED} draws {DRAWS}",
        "threshold is 4 points flat. The fee is charged and does not raise the threshold.",
        "bootstrap resamples whole title_end days",
        f"n {stats['n']} markets {stats['markets']} mean_roi {_fmt(stats['mean'])} "
        f"p05 {_fmt(stats['bound'])} pnl {stats['pnl']:.2f}",
        f"stake50 n {stake50['n']} mean_roi {_fmt(stake50['mean'])} p05 {_fmt(stake50['bound'])}",
        f"bar trades {int(stats['n'] >= BAR_TRADES)} markets {int(stats['markets'] >= BAR_MARKETS)} "
        f"mean_positive {int(stats['mean'] is not None and stats['mean'] > 0)} "
        f"bound {int(stats['bound'] is not None and stats['bound'] > BAR_BOUND)} "
        f"neighbours {int(neighbour_ok)} share {int(share_ok)} years {int(years_good)} "
        f"one_sided {int(one_sided)}",
        f"top_market_share {market_line}",
        f"top_month_share {month_line}",
        "years",
        *year_lines,
        f"centre n {centre_n} mean_roi {_fmt(centre_mean)} earns {int(centre_earns)}",
        f"tail n {tail_n} mean_roi {_fmt(tail_mean)} earns {int(tail_earns)}",
        "cells are headline stake 20. other is in the bar and not in the one-sided test.",
    ]
    for role_name, side, label in CELLS:
        cell = [t for t in headline if t["role"] == role_name and t["side"] == side]
        earned, n, mean = earns(cell)
        lines.append(f"{label} n {n} mean_roi {_fmt(mean)} earns {int(earned)}")
    lines.append(
        "market sum is the sum of first taker-BUY YES prints at or after T-24h, not a mid, and not a filter"
    )
    lines.append("model sum is over eligible buckets with a model at that same entry")
    lines.append("spot files are the ones already on disk from data-api.binance.vision. api.binance.com overlap was not re-measured.")
    lines.append("september family mix is results/s2_gap_mix.txt. The unretrieved id tail has an unknown family mix.")
    lines.append(_decision(name))
    lines.append("neighbours")
    lines.extend(neighbour_lines)
    lines.append("counts")
    for key in sorted(counts):
        lines.append(f"{key} {counts[key]}")
    lines.append("spot_last_close_ms " + " ".join(f"{sym} {spot_last[sym]}" for sym in spot_last))
    lines.append("calibration headline T-24h model decile, all modelled eligible buckets, not only trades")
    lines.extend(calibration(cal))
    text = "\n".join(lines) + "\n"
    os.makedirs(g1_pull.RESULTS, exist_ok=True)
    path = os.path.join(g1_pull.RESULTS, "s2_verdict.txt")
    with open(path, "w") as f:
        f.write(text)
    trade_path = os.path.join(g1_pull.RESULTS, "s2_headline_trades.csv")
    fields = [
        "conditionId", "title_end", "asset", "event_title", "role", "side",
        "bound_lo", "bound_hi", "fill", "model", "roi", "pnl", "fee",
    ]
    with open(trade_path, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fields, lineterminator="\n")
        w.writeheader()
        for t in sorted(headline, key=lambda r: (r["title_end"], r["conditionId"])):
            w.writerow({k: (f"{t[k]:.6f}" if isinstance(t[k], float) else t[k]) for k in fields})
    sum_path = os.path.join(g1_pull.RESULTS, "s2_partition_sums.txt")
    with open(sum_path, "w") as f:
        f.write("asset title_end event_title n_model model_sum n_yes_print print_sum\n")
        for key in sorted(sums):
            n_model, model_sum, n_print, print_sum = sums[key]
            title = key[2].replace("\t", " ")
            f.write(
                f"{key[0]}\t{key[1]}\t{title}\t{n_model}\t{model_sum:.6f}\t{n_print}\t{print_sum:.6f}\n"
            )
    print(text, end="", flush=True)
    return name


def ready(universe, spot_last, capped=None):
    capped = capped if capped is not None else load_capped()
    done_path = os.path.join(net.DATA, "g2", "trades.done.txt")
    done = set()
    if os.path.exists(done_path):
        with open(done_path) as f:
            done = {line.strip() for line in f if line.strip()}
    need = [r["conditionId"] for r in universe if r.get("pull") == "1"]
    missing = [cid for cid in need if cid not in done and cid not in capped]
    if missing:
        print(f"prints incomplete {len(missing)} of {len(need)}", flush=True)
        return False
    latest = 0
    for row in universe:
        if row.get("pull") == "1" and row.get("settlement_utc"):
            latest = max(latest, _ms(row["settlement_utc"]))
    for sym, last in spot_last.items():
        if last is None or last < latest:
            print(f"spot incomplete {sym} last {last} need {latest}", flush=True)
            return False
    return True


def self_test():
    assert HORIZONS == (24, 12, 48) and HEADLINE_H == 24
    assert THRESHOLDS == (0.04, 0.03, 0.05) and HEADLINE_THR == 0.04
    assert SEED == 20261014 and DRAWS == 10000
    assert abs(dollar_fee(100.0, 0.07, 1.0, 0.5) - 1.75) < 1e-12
    assert abs(dollar_fee(100.0, 0.25, 2.0, 0.5) - 1.5625) < 1e-12
    # fee + 2 ticks is 0.055625, above 4 points. An edge of 0.045 is between them.
    fee_gate = 0.25 * (0.5 * 0.5) ** 2 + 2.0 * 0.02
    assert fee_gate > 0.04
    chosen = decide(0.545, 0.50, None, 0.25, 2.0, 0.02, 0.04)
    assert chosen is not None and chosen["side"] == "yes", chosen
    assert abs(chosen["edge"] - 0.045) < 1e-12
    assert chosen["edge"] < fee_gate
    assert chosen["threshold"] == 0.04
    assert decide(0.53, 0.50, None, 0.0, 1.0, 0.01, 0.04) is None
    tied = decide(0.55, 0.45, 0.35, 0.0, 1.0, 0.01, 0.04)
    assert tied["side"] == "yes" and abs(tied["edge"] - 0.10) < 1e-12
    richer = decide(0.55, 0.50, 0.30, 0.0, 1.0, 0.01, 0.04)
    assert richer["side"] == "no" and abs(richer["edge"] - 0.15) < 1e-12
    book = [(100, 0.20, "Yes", "SELL"), (110, 0.40, "Yes", "BUY"), (105, 0.30, "Yes", "BUY")]
    assert first_print(book, 100, "yes") == (105, 0.30)
    assert first_print([(100, 0.20, "Yes", "SELL")], 100, "yes") is None
    assert first_print([(100, 0.20, "Yes", "")], 100, "yes") is None
    assert first_print([(100, 0.20, "No", "BUY")], 100, "yes") is None
    assert abs(worsen(0.40, 0.01) - 0.41) < 1e-12
    assert worsen(0.999, 0.01) == 1.0
    years = 24 / (365 * 24)
    brackets = [(None, 90.0), (90.0, 100.0), (100.0, 110.0), (110.0, None)]
    total = sum(bucket_prob(100.0, 0.8, years, lo, hi) for lo, hi in brackets)
    assert abs(total - 1.0) < 1e-9, total
    assert contains(None, 100.0, 100.0) is False
    assert contains(100.0, None, 100.0) is True
    assert contains(90.0, 100.0, 100.0) is False
    assert contains(100.0, 110.0, 100.0) is True
    assert role(None, 100.0, 50.0) == "tail"
    assert contains(None, 100.0, 50.0) is True
    assert role(110.0, None, 200.0) == "tail"
    assert role(90.0, 100.0, 95.0) == "centre"
    assert role(100.0, 110.0, 100.0) == "centre"
    assert role(90.0, 100.0, 100.0) == "other"
    assert role(90.0, 100.0, 80.0) == "other"
    low = bucket_prob(100.0, 0.5, years, None, 1.0)
    high = bucket_prob(100.0, 0.5, years, None, 100000.0)
    assert low < 0.01 and high > 0.99
    daily = {}
    px = 100.0
    start = dt.date(2025, 1, 1)
    for i in range(40):
        day = start + dt.timedelta(days=i)
        open_ms = int(dt.datetime(day.year, day.month, day.day, 23, 59, tzinfo=dt.timezone.utc).timestamp()) * 1000
        daily[day.isoformat()] = (open_ms, px)
        px *= math.exp(0.01)
    entry = daily[(start + dt.timedelta(days=39)).isoformat()][0] + 60_000
    assert realised_vol(daily, entry) is None
    del daily[(start + dt.timedelta(days=20)).isoformat()]
    assert realised_vol(daily, entry) is None
    opens = [0, 60_000, 120_000]
    closes = [1.0, 2.0, 3.0]
    assert spot_at(opens, closes, 180_000) == 3.0
    assert spot_at(opens, closes, 180_000 + STALE_MS + 1) is None
    neg = [
        {"conditionId": "a", "title_end": "2026-08-01", "pnl": -10.0},
        {"conditionId": "b", "title_end": "2026-07-01", "pnl": -1.0},
    ]
    neg_ok, neg_market, neg_month = shares_ok(neg)
    assert neg_ok is False and neg_market.startswith("a ")
    assert neg_month == "N/A 2026-08 0.9091 total pnl negative", neg_month
    pos = [
        {"conditionId": "a", "title_end": "2026-08-01", "pnl": 1.0},
        {"conditionId": "b", "title_end": "2026-08-02", "pnl": 1.0},
        {"conditionId": "c", "title_end": "2026-07-01", "pnl": 1.0},
        {"conditionId": "d", "title_end": "2026-07-02", "pnl": 1.0},
    ]
    pos_ok, _, pos_month = shares_ok(pos)
    assert pos_ok is True and pos_month == "2026-08 0.5000", pos_month
    one_day = bootstrap([{"title_end": "2026-07-03", "roi": 0.1}])
    assert abs(one_day - 0.1) < 1e-12
    assert earns([{"roi": 0.1}])[0] is True
    assert earns([{"roi": -0.1}])[0] is False
    assert earns([])[0] is False
    covered = {"n": 10, "markets": 10, "mean": 0.1, "bound": 0.0}
    assert verdict_of(covered, True, True, True, False) == "not run, coverage"
    clear = {"n": 200, "markets": 150, "mean": 0.1, "bound": 0.0}
    assert verdict_of(clear, True, True, True, False) == "PASS"
    assert verdict_of(clear, True, True, True, True) == "one-sided"
    assert verdict_of(clear, True, True, False, False) == "FAIL"
    print("s2_bucket self-test ok")


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
    trades, cal, sums, counts = build(universe, prints, spots, capped)
    write_report(trades, cal, sums, counts, spot_last)


if __name__ == "__main__":
    main()
