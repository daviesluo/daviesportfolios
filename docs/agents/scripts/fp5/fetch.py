"""Pull the public series the fp5 screen is allowed to see.

Nothing after 2023 is stored, except the single open that lets the last 2023
entry exit (2024-01-01 00:00 UTC). A later bar is a bug in this puller.
Keyless reads only. No Binance account, no signed call.

    python3 docs/agents/scripts/fp5/fetch.py

Writes under $FP5_DATA (default /tmp/fp5/data).
"""

from __future__ import annotations

import csv
import io
import json
import os
import sys
import time
import urllib.error
import urllib.request
import zipfile
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import common as c

DATA = Path(os.environ.get("FP5_DATA", "/tmp/fp5/data"))
VISION = "https://data.binance.vision"
MARKET = "https://data-api.binance.vision"
LOOKBACK_MS = 1_664_582_400_000  # 2022-10-01 00:00 UTC
# The exit print of the last in-screen entry. Not an entry.
EXIT_PRINT_MS = c.SCREEN_END_MS
UA = {"User-Agent": "daviesportfolios-fp5-research"}


def get(url: str, tries: int = 6) -> bytes | None:
    for k in range(tries):
        try:
            req = urllib.request.Request(url, headers=UA)
            with urllib.request.urlopen(req, timeout=60) as res:
                return res.read()
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return None
            if e.code in (418, 429, 500, 502, 503) and k + 1 < tries:
                time.sleep(1.5 * (k + 1))
                continue
            if k + 1 == tries:
                raise
        except Exception:
            if k + 1 == tries:
                raise
            time.sleep(1.0 * (k + 1))
    return None


def months(start_ym: tuple[int, int], end_ym: tuple[int, int]) -> list[str]:
    y, m = start_ym
    out = []
    while (y, m) <= end_ym:
        out.append(f"{y:04d}-{m:02d}")
        m += 1
        if m == 13:
            y, m = y + 1, 1
    return out


def days(start_ms: int, end_ms: int) -> list[str]:
    out = []
    t = start_ms
    while t <= end_ms:
        days_ = t // c.DAY_MS
        # Reconstruct the calendar date without importing a timezone.
        # 1970-01-01 plus `days_` days.
        import datetime as dt
        d = dt.datetime.fromtimestamp(0, dt.timezone.utc) + dt.timedelta(days=days_)
        # fromtimestamp(0) is the epoch; adding days is exact.
        out.append(d.strftime("%Y-%m-%d"))
        t += c.DAY_MS
    return out


def klines(symbol: str, interval: str, start_ms: int, end_ms: int) -> dict[int, tuple]:
    step = c.EIGHT_H_MS if interval == "8h" else c.DAY_MS
    cursor = start_ms
    rows: dict[int, tuple] = {}
    while cursor <= end_ms:
        url = (
            f"{MARKET}/api/v3/klines?symbol={symbol}&interval={interval}"
            f"&startTime={cursor}&endTime={end_ms}&limit=1000"
        )
        raw = get(url)
        if raw is None:
            return {}
        batch = json.loads(raw)
        if not batch:
            break
        for k in batch:
            open_ms = int(k[0])
            if open_ms > end_ms:
                continue
            rows[open_ms] = (float(k[1]), float(k[2]), float(k[3]), float(k[4]), float(k[7]))
        last = int(batch[-1][0])
        nxt = last + step
        if nxt <= cursor:
            break
        cursor = nxt
        if len(batch) < 1000:
            break
    return rows


def save_json(path: Path, obj: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, separators=(",", ":")))


def pull_spot(symbol: str) -> str:
    out8 = DATA / "spot8h" / f"{symbol}.json"
    out1 = DATA / "spot1d" / f"{symbol}.json"
    if out8.exists() and out1.exists():
        return f"{symbol} cached"
    h = klines(symbol, "8h", LOOKBACK_MS, EXIT_PRINT_MS)
    d = klines(symbol, "1d", LOOKBACK_MS, EXIT_PRINT_MS)
    # Lists of [open_ms, open, high, low, close, quote], sorted.
    save_json(out8, [[t, *h[t]] for t in sorted(h)])
    save_json(out1, [[t, *d[t]] for t in sorted(d)])
    latest = max(list(h) + list(d), default=0)
    if latest > c.PRICE_HORIZON_MS:
        raise SystemExit(f"{symbol} returned a bar past the screen horizon: {latest}")
    return f"{symbol} 8h={len(h)} 1d={len(d)}"


# The spot name and the perpetual name differ when the perp is on a 1000-token contract.
# The funding figure is a rate, so the contract multiplier does not scale it.
FUNDING_ALIAS = {"PEPEUSDT": "1000PEPEUSDT", "SHIBUSDT": "1000SHIBUSDT"}


def pull_funding(symbol: str) -> str:
    out = DATA / "funding" / f"{symbol}.json"
    if out.exists() and out.stat().st_size > 2:
        return f"{symbol} funding cached"
    source = FUNDING_ALIAS.get(symbol, symbol)
    points: dict[int, float] = {}
    for ym in months((2022, 10), (2023, 12)):
        url = f"{VISION}/data/futures/um/monthly/fundingRate/{source}/{source}-fundingRate-{ym}.zip"
        raw = get(url)
        if raw is None:
            continue
        zf = zipfile.ZipFile(io.BytesIO(raw))
        text = zf.read(zf.namelist()[0]).decode()
        for row in csv.DictReader(io.StringIO(text)):
            bucket = c.bucket_8h(int(row["calc_time"]))
            if bucket is None or bucket > EXIT_PRINT_MS:
                continue
            points[bucket] = float(row["last_funding_rate"])
    save_json(out, [[t, points[t]] for t in sorted(points)])
    return f"{symbol} funding {len(points)}"


def pull_metrics() -> str:
    out = DATA / "metrics_btc.json"
    if out.exists():
        return "metrics cached"
    rows = []
    for day in days(LOOKBACK_MS, c.SCREEN_END_MS - c.DAY_MS):
        url = f"{VISION}/data/futures/um/daily/metrics/BTCUSDT/BTCUSDT-metrics-{day}.zip"
        raw = get(url)
        if raw is None:
            continue
        zf = zipfile.ZipFile(io.BytesIO(raw))
        text = zf.read(zf.namelist()[0]).decode().splitlines()
        parsed = list(csv.DictReader(text))
        if not parsed:
            continue
        row = metric_row(day, parsed[-1])
        if row is not None:
            rows.append(row)
    save_json(out, rows)
    return f"metrics {len(rows)}"


def _zip_klines(url: str, end_ms: int) -> dict[int, tuple]:
    raw = get(url)
    if raw is None:
        return {}
    zf = zipfile.ZipFile(io.BytesIO(raw))
    text = zf.read(zf.namelist()[0]).decode().splitlines()
    reader = csv.DictReader(text)
    rows: dict[int, tuple] = {}
    for row in reader:
        open_ms = int(row["open_time"])
        if open_ms > end_ms:
            continue
        rows[open_ms] = (
            float(row["open"]), float(row["high"]), float(row["low"]), float(row["close"]),
            float(row.get("quote_volume") or 0),
        )
    return rows


def pull_mark_index() -> str:
    out_m = DATA / "mark8h_btc.json"
    out_i = DATA / "index8h_btc.json"
    if out_m.exists() and out_i.exists():
        return "mark cached"
    mark: dict[int, tuple] = {}
    index: dict[int, tuple] = {}
    for ym in months((2022, 10), (2023, 12)):
        base = f"{VISION}/data/futures/um/monthly"
        mark.update(_zip_klines(f"{base}/markPriceKlines/BTCUSDT/8h/BTCUSDT-8h-{ym}.zip", EXIT_PRINT_MS))
        index.update(_zip_klines(f"{base}/indexPriceKlines/BTCUSDT/8h/BTCUSDT-8h-{ym}.zip", EXIT_PRINT_MS))
    save_json(out_m, [[t, *mark[t]] for t in sorted(mark)])
    save_json(out_i, [[t, *index[t]] for t in sorted(index)])
    return f"mark {len(mark)} index {len(index)}"


def pull_fng() -> str:
    out = DATA / "fng.json"
    if out.exists():
        return "fng cached"
    raw = get("https://api.alternative.me/fng/?limit=0")
    if raw is None:
        raise SystemExit("fear and greed returned nothing")
    payload = json.loads(raw)
    # Unix seconds. Drop anything on or after 2024 so the file cannot be read ahead.
    cutoff = c.SCREEN_END_MS // 1000
    points = []
    for row in payload["data"]:
        ts = int(row["timestamp"])
        if ts >= cutoff:
            continue
        points.append([ts, float(row["value"])])
    points.sort()
    save_json(out, points)
    return f"fng {len(points)}"


def pull_dvol() -> str:
    out = DATA / "dvol_btc.json"
    if out.exists():
        return "dvol cached"
    points: dict[int, float] = {}
    start = LOOKBACK_MS
    while start < c.SCREEN_END_MS:
        end = min(start + 120 * c.DAY_MS, c.SCREEN_END_MS)
        url = (
            "https://www.deribit.com/api/v2/public/get_volatility_index_data"
            f"?currency=BTC&resolution=1D&start_timestamp={start}&end_timestamp={end - 1}"
        )
        raw = get(url)
        if raw is None:
            break
        data = json.loads(raw)["result"]["data"]
        for row in data:
            # [timestamp_ms, open, high, low, close]
            day = int(row[0])
            if day >= c.SCREEN_END_MS:
                continue
            points[day] = float(row[4])
        start = end
    save_json(out, [[t, points[t]] for t in sorted(points)])
    return f"dvol {len(points)}"


def pull_coinbase() -> str:
    out = DATA / "coinbase_btc_1d.json"
    if out.exists():
        return "coinbase cached"
    points: dict[int, float] = {}
    start = LOOKBACK_MS // 1000
    end_s = EXIT_PRINT_MS // 1000
    while start < end_s:
        chunk = min(start + 250 * 86_400, end_s)
        url = (
            "https://api.exchange.coinbase.com/products/BTC-USD/candles"
            f"?granularity=86400&start={start}&end={chunk}"
        )
        raw = get(url)
        if raw is None:
            break
        for row in json.loads(raw):
            # [time_s, low, high, open, close, volume]
            day_ms = int(row[0]) * 1000
            if day_ms > EXIT_PRINT_MS:
                continue
            points[day_ms] = float(row[4])
        start = chunk
    save_json(out, [[t, points[t]] for t in sorted(points)])
    return f"coinbase {len(points)}"


def pull_supply() -> str:
    out = DATA / "stable_supply.json"
    if out.exists():
        return "supply cached"
    raw = get("https://stablecoins.llama.fi/stablecoincharts/all")
    if raw is None:
        raise SystemExit("stablecoin supply returned nothing")
    points = []
    cutoff = c.SCREEN_END_MS // 1000
    for row in json.loads(raw):
        ts = int(row["date"])
        if ts >= cutoff:
            continue
        usd = row.get("totalCirculatingUSD") or {}
        val = usd.get("peggedUSD")
        if val is None:
            continue
        points.append([ts * 1000, float(val)])
    points.sort()
    save_json(out, points)
    return f"supply {len(points)}"


def metric_row(day: str, last: dict) -> dict | None:
    """One UTC day's last metrics line. A blank field is missing, not zero."""
    import datetime as dt

    def num(field: str) -> float | None:
        text = (last.get(field) or "").strip()
        if text == "":
            return None
        return float(text)

    oi = num("sum_open_interest_value")
    if oi is None:
        return None
    retail = num("count_long_short_ratio")
    top = num("count_toptrader_long_short_ratio")
    y, m, d = (int(x) for x in day.split("-"))
    day_ms = int(dt.datetime(y, m, d, tzinfo=dt.timezone.utc).timestamp() * 1000)
    return {
        "day_ms": day_ms,
        "oi": oi,
        "count_ls": retail,
        "top_over_retail": None if retail in (None, 0.0) or top is None else top / retail,
        "taker": num("sum_taker_long_short_vol_ratio"),
    }


def pull_metric_day(day: str) -> dict | None:
    url = f"{VISION}/data/futures/um/daily/metrics/BTCUSDT/BTCUSDT-metrics-{day}.zip"
    raw = get(url)
    if raw is None:
        return None
    zf = zipfile.ZipFile(io.BytesIO(raw))
    parsed = list(csv.DictReader(zf.read(zf.namelist()[0]).decode().splitlines()))
    if not parsed:
        return None
    return metric_row(day, parsed[-1])


def pull_oos() -> None:
    """BTC daily bars and metrics for the LS-FADE test window. Not used by the screen."""
    import datetime as dt
    out_m = DATA / "oos_metrics_btc.json"
    out_d = DATA / "oos_spot1d_btc.json"
    start = dt.date(2024, 1, 1)
    end = dt.date(2026, 9, 24)
    wanted = []
    d = start
    while d <= end:
        wanted.append(d.isoformat())
        d += dt.timedelta(days=1)
    rows = []
    with ThreadPoolExecutor(max_workers=12) as pool:
        futures = {pool.submit(pull_metric_day, day): day for day in wanted}
        for fut in as_completed(futures):
            row = fut.result()
            if row is not None:
                rows.append(row)
    rows.sort(key=lambda r: r["day_ms"])
    save_json(out_m, rows)
    # The exit open of an entry on 2026-09-24 is 2026-09-25.
    end_ms = int(dt.datetime(2026, 9, 25, tzinfo=dt.timezone.utc).timestamp() * 1000)
    start_ms = int(dt.datetime(2024, 1, 1, tzinfo=dt.timezone.utc).timestamp() * 1000)
    bars = klines("BTCUSDT", "1d", start_ms, end_ms)
    save_json(out_d, [[t, *bars[t]] for t in sorted(bars)])
    print(f"oos metrics {len(rows)} daily {len(bars)}", flush=True)


def main() -> None:
    DATA.mkdir(parents=True, exist_ok=True)
    jobs = []
    with ThreadPoolExecutor(max_workers=8) as pool:
        futures = [pool.submit(pull_spot, s) for s in c.BASKET]
        futures += [pool.submit(pull_funding, s) for s in c.BASKET]
        futures += [
            pool.submit(pull_metrics), pool.submit(pull_mark_index),
            pool.submit(pull_fng), pool.submit(pull_dvol),
            pool.submit(pull_coinbase), pool.submit(pull_supply),
        ]
        for fut in as_completed(futures):
            jobs.append(fut.result())
            print(jobs[-1], flush=True)
    print(f"done {len(jobs)} pulls")


if __name__ == "__main__":
    if "--oos" in sys.argv:
        pull_oos()
    else:
        main()
