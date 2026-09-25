"""Pure rules for the fifth search (fp5), Binance only.

Nothing here reads the network or a file. The screen scores 2023 and refuses
an entry outside that year, so a later window cannot be computed by calling
these functions with a wider range: in_screen is the gate.
"""

from __future__ import annotations

import random
import statistics

# 10 bps a side, this account's measured Binance spot fee. A taker round trip
# is the two of them. Doubling is the stress arm, not the screen.
FEE = 0.001
ROUND_TRIP_BPS = 20.0

EIGHT_H_MS = 8 * 3_600_000
DAY_MS = 24 * 3_600_000

# The screen window. Entries on [start, end). The open at `end` may be an
# exit print for the last 2023 entry; it is not itself an entry.
SCREEN_START_MS = 1_672_531_200_000  # 2023-01-01 00:00 UTC
SCREEN_END_MS = 1_704_067_200_000  # 2024-01-01 00:00 UTC

# Prices may be loaded through the first daily open after the screen, so the
# last entry can exit. Anything later is a different year and is refused.
PRICE_HORIZON_MS = SCREEN_END_MS + DAY_MS

NULL_DRAWS = 200
NULL_SEED = 20250925

BASKET = (
    "BTCUSDT", "ETHUSDT", "BNBUSDT", "SOLUSDT", "XRPUSDT", "DOGEUSDT", "ADAUSDT",
    "AVAXUSDT", "LINKUSDT", "DOTUSDT", "MATICUSDT", "LTCUSDT", "BCHUSDT", "TRXUSDT",
    "ATOMUSDT", "NEARUSDT", "APTUSDT", "SUIUSDT", "FILUSDT", "ARBUSDT", "OPUSDT",
    "INJUSDT", "TIAUSDT", "SEIUSDT", "WLDUSDT", "PEPEUSDT", "SHIBUSDT", "UNIUSDT",
    "AAVEUSDT", "LUNAUSDT", "FTTUSDT", "LUNCUSDT", "POLUSDT",
)

# Ideas already priced, named so this search does not run them again.
ALREADY_PRICED = (
    "cross-sectional momentum (§3.24)",
    "cross-sectional reversal and low volatility (§3.25)",
    "cascade bids, including the post-cap slice (§3.29)",
    "zero-fee stablecoin quotes (§3.29)",
    "delisting window and new-listing drift (§3.29)",
    "launchpool carry (§3.29)",
    "funding-hour average drift (§3.29 B8)",
    "U-book and triangle quoting (§3.29)",
    "DVOL and funding as gates on trend-4h (§3.21)",
    "volatility-sized slots (§3.21)",
    "BTC-regime entry filter (§3.30)",
    "maker-only rules on Revolut X (§3.23)",
)


def net_return(entry_open: float, exit_open: float, fee: float = FEE) -> float:
    """Buy the open at `fee` above it, sell the later open at `fee` below it."""
    if entry_open <= 0 or exit_open <= 0:
        raise ValueError("a fill needs a positive price")
    bought = entry_open * (1.0 + fee)
    sold = exit_open * (1.0 - fee)
    return sold / bought - 1.0


def bucket_8h(ts_ms: int) -> int | None:
    """Nearest 8h boundary, or None when the stamp is more than two minutes off.

    Funding files sometimes write the boundary plus a millisecond. A stamp
    that is not that boundary is a different event and is dropped.
    """
    q, r = divmod(int(ts_ms), EIGHT_H_MS)
    if r > EIGHT_H_MS - r:
        q += 1
        distance = EIGHT_H_MS - r
    else:
        distance = r
    if distance > 120_000:
        return None
    return q * EIGHT_H_MS


def rank_threshold(values: list[float], q: float, min_n: int) -> float | None:
    """Empirical quantile: sorted[floor(q * (n - 1))]. None when the history is short."""
    if len(values) < min_n:
        return None
    if not 0.0 <= q <= 1.0:
        raise ValueError("q must sit in [0, 1]")
    ordered = sorted(values)
    return ordered[int(q * (len(ordered) - 1))]


def p95_index(draws: int) -> int:
    """The house null's index: floor(0.95 * draws), the same one fp3's CB used."""
    if draws < 1:
        raise ValueError("a null needs a draw")
    return int(0.95 * draws)


def null_p95(pool: list[float], n: int, draws: int = NULL_DRAWS, seed: int = NULL_SEED) -> float | None:
    """Mean of `n` pool returns, drawn without replacement, `draws` times. The p95 of those means."""
    if n < 1 or len(pool) < n:
        return None
    rng = random.Random(seed)
    means = sorted(sum(rng.sample(pool, n)) / n for _ in range(draws))
    return means[p95_index(draws)]


def in_screen(entry_ms: int) -> bool:
    return SCREEN_START_MS <= int(entry_ms) < SCREEN_END_MS


def assert_screen_trades(trades: list[dict]) -> None:
    for t in trades:
        if not in_screen(t["entry_ms"]):
            raise RuntimeError(f"entry outside the 2023 screen: {t['entry_ms']}")


def assert_price_horizon(open_times_ms: list[int]) -> None:
    if not open_times_ms:
        return
    latest = max(open_times_ms)
    if latest > PRICE_HORIZON_MS:
        raise RuntimeError(f"price {latest} is past the screen horizon {PRICE_HORIZON_MS}")


def bps(x: float) -> float:
    return x * 10_000.0


def summarise(name: str, trades: list[dict], pool: list[float], min_n: int, note: str) -> dict:
    """The screen verdict. A pass is all three: enough trades, mean net above zero, mean net above the null p95."""
    assert_screen_trades(trades)
    n = len(trades)
    mean_net = sum(t["net"] for t in trades) / n if n else 0.0
    mean_gross = sum(t["gross"] for t in trades) / n if n else 0.0
    total = sum(t["pnl"] for t in trades)
    cutoff = null_p95(pool, n) if n else None
    passes = bool(n >= min_n and mean_net > 0.0 and cutoff is not None and mean_net > cutoff)
    return {
        "idea": name,
        "n": n,
        "min_n": min_n,
        "mean_gross_bps": round(bps(mean_gross), 4) if n else None,
        "mean_net_bps": round(bps(mean_net), 4) if n else None,
        "total_pnl_usd": round(total, 4),
        "null_p95_bps": None if cutoff is None else round(bps(cutoff), 4),
        "passes_screen": passes,
        "note": note,
    }


def _trade(
    coin: str, entry_ms: int, exit_ms: int, bars: dict[int, tuple], fee: float = FEE,
    start_ms: int = SCREEN_START_MS, end_ms: int = SCREEN_END_MS,
) -> dict | None:
    if entry_ms not in bars or exit_ms not in bars:
        return None
    if not (start_ms <= int(entry_ms) < end_ms):
        return None
    entry_open = bars[entry_ms][0]
    exit_open = bars[exit_ms][0]
    gross = exit_open / entry_open - 1.0
    net = net_return(entry_open, exit_open, fee)
    return {
        "coin": coin,
        "entry_ms": entry_ms,
        "exit_ms": exit_ms,
        "gross": gross,
        "net": net,
        "pnl": 100.0 * net,
    }


def pool_from_bars(bars_by_coin: dict[str, dict[int, tuple]], coins: tuple[str, ...] | list[str], step_ms: int) -> list[float]:
    """Every in-screen hold of exactly `step_ms` on these coins. The null draws from this."""
    pool: list[float] = []
    for coin in coins:
        bars = bars_by_coin.get(coin) or {}
        for t in bars:
            trade = _trade(coin, t, t + step_ms, bars)
            if trade is not None:
                pool.append(trade["net"])
    return pool


def fr_own(funding: dict[str, list[tuple[int, float]]], bars: dict[str, dict[int, tuple]]) -> list[dict]:
    """Own-coin extreme negative funding. History is strictly before the settlement."""
    trades: list[dict] = []
    for coin in BASKET:
        events = funding.get(coin) or []
        series = bars.get(coin) or {}
        for t, rate in events:
            hist = [r for ht, r in events if t - 90 * DAY_MS <= ht < t]
            thr = rank_threshold(hist, 0.10, 90)
            if thr is None or not rate < thr:
                continue
            entry = t + EIGHT_H_MS
            exit_ = entry + EIGHT_H_MS
            if entry not in series or exit_ not in series:
                continue
            trade = _trade(coin, entry, exit_, series)
            if trade is not None:
                trades.append(trade)
    return trades


def fr_xs(funding: dict[str, list[tuple[int, float]]], bars: dict[str, dict[int, tuple]]) -> list[dict]:
    """One coin per settlement: the most negative rate, if it is negative and below its own 10th."""
    by_time: dict[int, list[tuple[str, float]]] = {}
    for coin in BASKET:
        for t, rate in funding.get(coin) or []:
            by_time.setdefault(t, []).append((coin, rate))
    trades: list[dict] = []
    for t in sorted(by_time):
        ranked: list[tuple[str, float]] = []
        for coin, rate in by_time[t]:
            events = funding.get(coin) or []
            hist = [r for ht, r in events if t - 90 * DAY_MS <= ht < t]
            thr = rank_threshold(hist, 0.10, 90)
            if thr is None or not rate < thr or not rate < 0.0:
                continue
            ranked.append((coin, rate))
        if not ranked:
            continue
        ranked.sort(key=lambda row: (row[1], row[0]))
        coin, _rate = ranked[0]
        series = bars.get(coin) or {}
        entry = t + EIGHT_H_MS
        exit_ = entry + EIGHT_H_MS
        trade = _trade(coin, entry, exit_, series)
        if trade is not None:
            trades.append(trade)
    return trades


def vol_climax(bars: dict[str, dict[int, tuple]], volume_multiple: float | None) -> list[dict]:
    """Close-to-close drop of 3% on an 8h bar. `volume_multiple` None is the control (no volume test)."""
    trades: list[dict] = []
    for coin in BASKET:
        series = bars.get(coin) or {}
        times = sorted(series)
        for i in range(1, len(times)):
            prev, t = times[i - 1], times[i]
            if t - prev != EIGHT_H_MS:
                continue
            prev_close = series[prev][3]
            close = series[t][3]
            if prev_close <= 0:
                continue
            if close / prev_close - 1.0 >= -0.03:
                continue
            if volume_multiple is not None:
                start = t - 90 * DAY_MS
                vols = [series[h][4] for h in times if start <= h < t and series[h][4] > 0]
                if len(vols) < 90:
                    continue
                if series[t][4] <= volume_multiple * statistics.median(vols):
                    continue
            entry = t + EIGHT_H_MS
            exit_ = entry + EIGHT_H_MS
            # Decide at the close of `t`. The next open is exactly one bar later.
            trade = _trade(coin, entry, exit_, series)
            if trade is not None:
                trades.append(trade)
    return trades


def season_slots(bars: dict[str, dict[int, tuple]]) -> dict[int, list[dict]]:
    """BTC 8h bars split by the UTC hour of their open. Each trade holds to the next open."""
    series = bars.get("BTCUSDT") or {}
    times = sorted(series)
    out: dict[int, list[dict]] = {0: [], 8: [], 16: []}
    for t in times:
        hour = (t // 3_600_000) % 24
        if hour not in out:
            continue
        trade = _trade("BTCUSDT", t, t + EIGHT_H_MS, series)
        if trade is not None:
            out[hour].append(trade)
    return out


def daily_forward(
    daily: dict[int, tuple], signal_days: list[int], hold_days: int = 1, fee: float = FEE,
    start_ms: int = SCREEN_START_MS, end_ms: int = SCREEN_END_MS,
) -> list[dict]:
    """Enter the daily open `hold` days after the signal day? No: enter the next open after the signal day.

    `signal_days` are the UTC midnights on which the signal is known at the close.
    Entry is the following midnight, exit is `hold_days` midnights after entry.
    A missing day is skipped rather than held across the hole.
    """
    trades: list[dict] = []
    for day in signal_days:
        if day not in daily:
            continue
        entry = day + DAY_MS
        exit_ = entry + hold_days * DAY_MS
        trade = _trade("BTCUSDT", entry, exit_, daily, fee=fee, start_ms=start_ms, end_ms=end_ms)
        if trade is not None:
            trades.append(trade)
    return trades


def oi_signals(metrics: list[dict], daily: dict[int, tuple]) -> list[int]:
    """Days whose open interest fell at least 5% and whose spot close fell. The day is the signal day."""
    by_day = {m["day_ms"]: m for m in metrics}
    days = sorted(by_day)
    closes = daily
    out: list[int] = []
    for i in range(1, len(days)):
        prev, day = days[i - 1], days[i]
        if day - prev != DAY_MS:
            continue
        oi0, oi1 = by_day[prev]["oi"], by_day[day]["oi"]
        if oi0 <= 0 or not oi1 / oi0 - 1.0 <= -0.05:
            continue
        if day not in closes or prev not in closes:
            continue
        if closes[day][3] >= closes[prev][3]:
            continue
        out.append(day)
    return out


def ratio_signals(metrics: list[dict], key: str, q: float, below: bool) -> list[int]:
    """A daily ratio against its own trailing 90 days. `below` selects the left tail."""
    days = sorted(metrics, key=lambda m: m["day_ms"])
    out: list[int] = []
    for i, row in enumerate(days):
        hist = [
            days[j][key] for j in range(i)
            if days[j][key] is not None and row["day_ms"] - 90 * DAY_MS <= days[j]["day_ms"] < row["day_ms"]
        ]
        thr = rank_threshold(hist, q, 30)
        if thr is None:
            continue
        value = row[key]
        if value is None:
            continue
        if below and value < thr:
            out.append(row["day_ms"])
        if not below and value > thr:
            out.append(row["day_ms"])
    return out


def fng_signals(points: list[tuple[int, float]]) -> list[int]:
    """Extreme fear is the published cut of 20. The day is the reading's UTC midnight."""
    out: list[int] = []
    for ts_s, value in points:
        if value < 20.0:
            out.append((ts_s // 86_400) * DAY_MS)
    return out


def dvol_signals(rows: list[tuple[int, float]]) -> list[int]:
    """DVOL close above its own trailing-90-day 90th. `rows` are (day_ms, close)."""
    rows = sorted(rows)
    out: list[int] = []
    for i, (day, close) in enumerate(rows):
        hist = [rows[j][1] for j in range(i) if day - 90 * DAY_MS <= rows[j][0] < day]
        thr = rank_threshold(hist, 0.90, 30)
        if thr is None or not close > thr:
            continue
        out.append(day)
    return out


def coinbase_premium_signals(binance: dict[int, tuple], coinbase: dict[int, float]) -> list[int]:
    """Days the Coinbase daily close sits more than 15 bps above Binance's."""
    out: list[int] = []
    for day, px in coinbase.items():
        if day not in binance:
            continue
        bn = binance[day][3]
        if bn <= 0:
            continue
        if px / bn - 1.0 > 0.0015:
            out.append(day)
    return sorted(out)


def prem_rev(mark: dict[int, tuple], index: dict[int, tuple], spot: dict[int, tuple]) -> list[dict]:
    """Perp cheap versus the index by more than 10 bps at the 8h close: buy spot at the next open."""
    times = sorted(set(mark) & set(index))
    trades: list[dict] = []
    for t in times:
        idx = index[t][3]
        if idx <= 0:
            continue
        premium = mark[t][3] / idx - 1.0
        if premium >= -0.001:
            continue
        # The close of the bar that opened at t is known at t+8h, which is the next open.
        entry = t + EIGHT_H_MS
        exit_ = entry + EIGHT_H_MS
        trade = _trade("BTCUSDT", entry, exit_, spot)
        if trade is not None:
            trades.append(trade)
    return trades


def eth_btc(daily: dict[str, dict[int, tuple]]) -> list[dict]:
    """ETH/BTC a close more than two trailing-30-day standard deviations under its mean: hold ETH one day.

    The account pays 20 bps on ETH. The figure that has to clear zero is ETH's net return minus BTC's
    gross return over the same day: holding ETH instead of BTC.
    """
    eth = daily.get("ETHUSDT") or {}
    btc = daily.get("BTCUSDT") or {}
    days = sorted(set(eth) & set(btc))
    trades: list[dict] = []
    for i in range(len(days)):
        day = days[i]
        window = [d for d in days if day - 30 * DAY_MS <= d < day]
        if len(window) < 30:
            continue
        ratios = []
        for d in window:
            if btc[d][3] <= 0:
                continue
            ratios.append(eth[d][3] / btc[d][3])
        if len(ratios) < 30:
            continue
        mean = sum(ratios) / len(ratios)
        var = sum((x - mean) ** 2 for x in ratios) / (len(ratios) - 1)
        std = var ** 0.5
        if std <= 0 or btc[day][3] <= 0:
            continue
        ratio = eth[day][3] / btc[day][3]
        if ratio >= mean - 2.0 * std:
            continue
        if i + 2 >= len(days):
            continue
        entry_day, exit_day = days[i + 1], days[i + 2]
        if entry_day - day != DAY_MS or exit_day - entry_day != DAY_MS:
            continue
        eth_trade = _trade("ETHUSDT", entry_day, exit_day, eth)
        if eth_trade is None or exit_day not in btc or entry_day not in btc:
            continue
        if not in_screen(entry_day):
            continue
        btc_gross = btc[exit_day][0] / btc[entry_day][0] - 1.0
        excess = eth_trade["net"] - btc_gross
        trades.append({
            "coin": "ETHUSDT",
            "entry_ms": entry_day,
            "exit_ms": exit_day,
            "gross": eth_trade["gross"] - btc_gross,
            "net": excess,
            "pnl": 100.0 * excess,
        })
    return trades


def supply_mondays(supply: list[tuple[int, float]], daily: dict[int, tuple]) -> tuple[list[dict], list[dict]]:
    """Monday entries. The signal is a 30-day rise in stablecoin supply, known before that Monday.

    Returns (signalled trades, every Monday trade). The screen compares them.
    """
    supply = sorted(supply)
    times = sorted(daily)
    mondays = [t for t in times if _utc_weekday(t) == 0]
    all_trades: list[dict] = []
    signalled: list[dict] = []
    for i, day in enumerate(mondays):
        if i + 1 >= len(mondays):
            break
        exit_day = mondays[i + 1]
        if exit_day - day != 7 * DAY_MS:
            continue
        trade = _trade("BTCUSDT", day, exit_day, daily)
        if trade is None:
            continue
        all_trades.append(trade)
        # Supply through the previous day: the last point strictly before `day`.
        latest = [p for p in supply if p[0] < day]
        if not latest:
            continue
        now = latest[-1][1]
        then_cut = day - 30 * DAY_MS
        prior = [p for p in latest if p[0] <= then_cut]
        if not prior or prior[-1][1] <= 0:
            continue
        if now / prior[-1][1] - 1.0 > 0.0:
            signalled.append(trade)
    return signalled, all_trades


def _utc_weekday(day_ms: int) -> int:
    # 1970-01-01 was a Thursday. Monday is 0 in the rule's calendar.
    days = day_ms // DAY_MS
    return (days + 3) % 7  # Thursday=3 → (0+3)%7=3, Monday (3 days later, days=4) → 7%7=0. 1970-01-05 was Monday.


def passes_season(slots: dict[str, dict]) -> bool:
    """Every UTC slot has to clear the screen. One lucky hour is not a strategy."""
    return all(row["passes_screen"] for row in slots.values())
