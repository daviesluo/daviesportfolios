"""Pull the inputs this rule stores. No later year is requested as an entry."""

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
from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path
from zoneinfo import ZoneInfo

sys.path.insert(0, str(Path(__file__).resolve().parent))

import common as c

FOLDER = Path(__file__).resolve().parent.name
DATA = Path(os.environ.get(f"{FOLDER.upper()}_DATA", f"/tmp/{FOLDER}/data"))
VISION = "https://data.binance.vision"
UA = {"User-Agent": f"Mozilla/5.0 daviesportfolios-{FOLDER}-research"}
LONDON = ZoneInfo("Europe/London")
BERLIN = ZoneInfo("Europe/Berlin")


def get(url: str, body: bytes | None = None) -> bytes:
    if url.startswith("https://fapi.binance.com") or url.startswith("https://dapi.binance.com"):
        raise SystemExit("that host is not the one this pull measured")
    headers = dict(UA)
    if body is not None:
        headers["Content-Type"] = "application/json"
    last = None
    for k in range(6):
        try:
            req = urllib.request.Request(url, data=body, headers=headers)
            with urllib.request.urlopen(req, timeout=90) as res:
                return res.read()
        except urllib.error.HTTPError as exc:
            last = exc
            if exc.code == 404 or exc.code not in (418, 429, 500, 502, 503) or k + 1 == 6:
                raise
        except Exception as exc:
            last = exc
            if k + 1 == 6:
                raise
        time.sleep(1.0 * (k + 1))
    raise RuntimeError(f"get failed {last}")


def utc(year: int, month: int, day: int) -> int:
    return int(datetime(year, month, day, tzinfo=timezone.utc).timestamp() * 1000)


def add_month(year: int, month: int, k: int) -> tuple[int, int]:
    month = month + k
    year += (month - 1) // 12
    month = (month - 1) % 12 + 1
    return year, month


def months() -> list[str]:
    out = []
    year, month = 2023, 1
    while (year, month) <= (2023, 12):
        out.append(f"{year:04d}-{month:02d}")
        month += 1
        if month == 13:
            year, month = year + 1, 1
    return out


def read_zip_rows(raw: bytes) -> list[list[str]]:
    zf = zipfile.ZipFile(io.BytesIO(raw))
    return list(csv.reader(io.StringIO(zf.read(zf.namelist()[0]).decode())))


def kline_url(ym: str) -> str:
    symbol = c.SYMBOL
    return f"{VISION}/data/spot/monthly/klines/{symbol}/1d/{symbol}-1d-{ym}.zip"


def exit_url() -> str:
    symbol = c.SYMBOL
    return f"{VISION}/data/spot/daily/klines/{symbol}/1d/{symbol}-1d-2024-01-01.zip"


def take_bar(row: list[str], rows: dict[int, tuple[str, str]]) -> None:
    if not row or row[0] == "open_time":
        return
    ts = int(row[0])
    if ts >= c.fp5.SCREEN_END_MS:
        raise SystemExit("a later year was requested")
    opened, closed = row[1], row[4]
    if Decimal(opened) <= 0 or Decimal(closed) <= 0:
        raise SystemExit("a bar is not a price")
    if ts in rows and rows[ts] != (opened, closed):
        raise SystemExit("two bars at one stamp")
    rows[ts] = (opened, closed)


def pull_opens() -> dict[int, tuple[str, str]]:
    rows: dict[int, tuple[str, str]] = {}
    seen = False
    for ym in months():
        try:
            raw = get(kline_url(ym))
        except urllib.error.HTTPError as exc:
            if exc.code == 404 and not seen:
                continue
            if exc.code == 404 and seen and c.LISTING_ENDS:
                break
            raise
        seen = True
        for row in read_zip_rows(raw):
            take_bar(row, rows)
    if not seen:
        raise SystemExit("no month was published")
    try:
        get(exit_url())
    except urllib.error.HTTPError as exc:
        if exc.code != 404:
            raise
    else:
        raise SystemExit("the 2024 open was published and this freeze did not store it")
    if c.fp5.SCREEN_END_MS in rows:
        raise SystemExit("the exit day was stored")
    stamps = sorted(rows)
    if (
        len(stamps) != c.BOOK_ROWS
        or stamps[0] != c.BOOK_FIRST
        or stamps[-1] != c.BOOK_LAST
        or rows[stamps[0]] != (c.BOOK_FIRST_OPEN, c.BOOK_FIRST_CLOSE)
        or rows[stamps[-1]] != (c.BOOK_LAST_OPEN, c.BOOK_LAST_CLOSE)
    ):
        raise SystemExit(c.SYMBOL + " stops on the wrong day")
    if stamps[-1] - stamps[0] != (len(stamps) - 1) * c.fp5.DAY_MS:
        raise SystemExit("an interior day is missing")
    path = DATA / c.BOOK_DIR / f"{c.SYMBOL}.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps([[t, rows[t][0], rows[t][1]] for t in stamps], separators=(",", ":")))
    return rows


def _keep(rows: dict[int, str], ts: int, px: str) -> None:
    if ts >= c.fp5.SCREEN_END_MS:
        return
    if Decimal(px) <= 0:
        raise SystemExit("a fair value is not a price")
    if ts in rows and rows[ts] != px:
        raise SystemExit("two fair values at one stamp")
    rows[ts] = px


def store_part(name: str, rows: dict[int, str]) -> None:
    shape = c.PARTS[name]
    stamps = sorted(rows)
    if not stamps:
        raise SystemExit(name + " was not published")
    if (
        len(stamps) != shape["n"]
        or stamps[0] != shape["first"]
        or stamps[-1] != shape["last"]
        or format(Decimal(rows[stamps[0]]), "f") != shape["first_px"]
        or format(Decimal(rows[stamps[-1]]), "f") != shape["last_px"]
    ):
        raise SystemExit(name + " does not have the frozen shape")
    path = DATA / "fair" / shape["file"]
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps([[t, rows[t]] for t in stamps], separators=(",", ":")))


def select_busd(payload: dict) -> dict[int, str]:
    rows: dict[int, str] = {}
    for row in payload["data"]:
        if row.get("asset") != "busd":
            raise SystemExit("the bridge is not BUSD")
        px = row.get("PriceUSD")
        if px in (None, ""):
            continue
        _keep(rows, int(row["AssetEODCompletionTime"]) * 1000, str(px))
    return rows


def pull_busd() -> dict[int, str]:
    url = (
        "https://community-api.coinmetrics.io/v4/timeseries/asset-metrics"
        "?assets=busd&metrics=PriceUSD,AssetEODCompletionTime&frequency=1d"
        "&start_time=2022-11-01&end_time=2024-01-06&page_size=10000"
    )
    rows: dict[int, str] = {}
    while url:
        payload = json.loads(get(url).decode())
        for ts, px in select_busd(payload).items():
            _keep(rows, ts, px)
        url = payload.get("next_page_url") or ""
    store_part("busd", rows)
    return rows


def select_lbma(payload: list) -> dict[int, str]:
    rows: dict[int, str] = {}
    for row in payload:
        usd = row["v"][0]
        if usd is None or row["d"] < "2022-11-01":
            continue
        year, month, day = (int(part) for part in row["d"].split("-"))
        stamp = int(datetime(year, month, day, 16, 0, tzinfo=LONDON).timestamp() * 1000)
        _keep(rows, stamp, str(usd))
    return rows


def pull_lbma() -> dict[int, str]:
    rows = select_lbma(json.loads(get("https://prices.lbma.org.uk/json/gold_pm.json").decode()))
    store_part("usd", rows)
    return rows


def select_ecbfx(text: str) -> dict[int, str]:
    rows: dict[int, str] = {}
    for row in csv.DictReader(io.StringIO(text)):
        if row.get("KEY") != "EXR.D.USD.EUR.SP00.A":
            raise SystemExit("the reference rate is not USD per EUR")
        day = row.get("TIME_PERIOD")
        val = row.get("OBS_VALUE")
        if not day or not val:
            continue
        year, month, d = (int(part) for part in day.split("-"))
        stamp = int(datetime(year, month, d, 17, 0, tzinfo=BERLIN).timestamp() * 1000)
        _keep(rows, stamp, val)
    return rows


def pull_ecbfx() -> dict[int, str]:
    url = (
        "https://data-api.ecb.europa.eu/service/data/EXR/"
        "D.USD.EUR.SP00.A?startPeriod=2022-11-01&endPeriod=2024-01-10&format=csvdata"
    )
    rows = select_ecbfx(get(url).decode())
    base = int(datetime(2022, 12, 30, 17, 0, tzinfo=BERLIN).timestamp() * 1000)
    if rows.get(base) != "1.0666":
        raise SystemExit("the 2022-12-30 reference rate moved")
    store_part("usd", rows)
    return rows


def select_bigmac(text: str) -> dict[int, str]:
    us_px: dict[str, str] = {}
    euz_px: dict[str, str] = {}
    for row in csv.DictReader(io.StringIO(text)):
        if row["iso_a3"] == "USA":
            us_px[row["date"]] = row["local_price"]
        elif row["iso_a3"] == "EUZ":
            euz_px[row["date"]] = row["local_price"]
    rows: dict[int, str] = {}
    seen = set()
    for day, (us, euz) in c.BIG_PAIRS:
        if us_px.get(day) != us or euz_px.get(day) != euz:
            raise SystemExit("a Big Mac local price moved")
        seen.add(day)
        year, month, d = (int(part) for part in day.split("-"))
        py, pm = add_month(year, month, 1)
        ratio = Decimal(us) / Decimal(euz)
        _keep(rows, utc(py, pm, 1), format(ratio, "f"))
    for day in set(us_px) & set(euz_px):
        if day < "2022-01-01" or day in seen:
            continue
        year, month, d = (int(part) for part in day.split("-"))
        py, pm = add_month(year, month, 1)
        if utc(py, pm, 1) < c.fp5.SCREEN_END_MS:
            raise SystemExit("an extra Big Mac vintage was published inside the window")
    return rows


def pull_bigmac() -> dict[int, str]:
    url = (
        "https://raw.githubusercontent.com/TheEconomist/big-mac-data/"
        "master/output-data/big-mac-raw-index.csv"
    )
    rows = select_bigmac(get(url).decode())
    store_part("usd", rows)
    return rows


def select_bls(payload: dict) -> dict[int, str]:
    if payload.get("status") != "REQUEST_SUCCEEDED":
        raise SystemExit("the BLS series was refused")
    series = next(row for row in payload["Results"]["series"] if row["seriesID"] == c.BLS_ID)
    rows: dict[int, str] = {}
    for obs in series["data"]:
        year = int(obs["year"])
        month = int(obs["period"][1:])
        if (year, month) < (2022, 12):
            continue
        py, pm = add_month(year, month, 1)
        _keep(rows, utc(py, pm, c.BLS_PUB_DAY), obs["value"])
    return rows


def pull_bls() -> dict[int, str]:
    body = json.dumps({"seriesid": [c.BLS_ID], "startyear": "2022", "endyear": "2023"}).encode()
    rows = select_bls(json.loads(get("https://api.bls.gov/publicAPI/v2/timeseries/data/", body).decode()))
    store_part("us", rows)
    return rows


def select_ecb_index(text: str) -> dict[int, str]:
    rows: dict[int, str] = {}
    for row in csv.DictReader(io.StringIO(text)):
        if row.get("KEY") != c.ECB_KEY:
            raise SystemExit("the euro-area index is not the frozen series")
        period = row.get("TIME_PERIOD")
        val = row.get("OBS_VALUE")
        if not period or not val:
            continue
        year, month = (int(part) for part in period.split("-"))
        if (year, month) < (2022, 11):
            continue
        py, pm = add_month(year, month, c.ECB_LAG)
        _keep(rows, utc(py, pm, c.ECB_PUB_DAY), val)
    return rows


def pull_ecb_index() -> dict[int, str]:
    url = (
        "https://data-api.ecb.europa.eu/service/data/"
        f"{c.ECB_SERIES}?startPeriod=2022-10&endPeriod=2024-02&format=csvdata"
    )
    rows = select_ecb_index(get(url).decode())
    store_part("ea", rows)
    return rows


def quarter_pub(year: int, quarter: int) -> int:
    end = {1: 3, 2: 6, 3: 9, 4: 12}[quarter]
    py, pm = add_month(year, end, 4)
    return utc(py, pm, 1)


def select_lci(payload: dict) -> dict[int, str]:
    dim = payload["dimension"]
    if dim["s_adj"]["category"]["index"] != {"CA": 0}:
        raise SystemExit("the wage index is not calendar adjusted")
    if dim["unit"]["category"]["index"] != {"I20": 0}:
        raise SystemExit("the wage index is not 2020=100")
    if dim["geo"]["category"]["index"] != {"EA": 0}:
        raise SystemExit("the wage index is not the euro area")
    if dim["nace_r2"]["category"]["index"] != {"B-S": 0}:
        raise SystemExit("the wage index is not B-S")
    if dim["lcstruct"]["category"]["index"] != {"D11": 0}:
        raise SystemExit("the wage index is not wages and salaries")
    rows: dict[int, str] = {}
    for label, index in dim["time"]["category"]["index"].items():
        key = str(index)
        if key not in payload["value"] or label < "2022-Q3":
            continue
        year = int(label[:4])
        quarter = int(label[-1])
        _keep(rows, quarter_pub(year, quarter), str(payload["value"][key]))
    return rows


def pull_lci() -> dict[int, str]:
    url = (
        "https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/lc_lci_r2_q"
        "?format=JSON&geo=EA&unit=I20&s_adj=CA&nace_r2=B-S&lcstruct=D11&sinceTimePeriod=2022-Q3"
    )
    rows = select_lci(json.loads(get(url).decode()))
    store_part("ea", rows)
    return rows


def main() -> None:
    if os.environ.get(f"{FOLDER.upper()}_OOS"):
        raise SystemExit("this pull does not request a later year")
    pull_opens()
    pull_busd()
    if c.PULL == "lbma":
        pull_lbma()
    elif c.PULL == "ecbfx":
        pull_ecbfx()
    elif c.PULL == "bigmac":
        pull_bigmac()
    elif c.PULL == "bls":
        pull_bls()
        if c.EA_SOURCE == "ecb":
            pull_ecb_index()
        elif c.EA_SOURCE == "lci":
            pull_lci()
        else:
            raise SystemExit("the euro-area series is not named")
    else:
        raise SystemExit("the fair value is not named")
    print(FOLDER, "pulled")


if __name__ == "__main__":
    main()
