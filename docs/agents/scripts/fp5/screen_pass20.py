"""Eight frozen Revolut X screens. Candles can kill a rule. They cannot pass one.

Reads the eight rule texts hashed at 2026-09-25 03:34:46 UTC, before any of
their series was joined to a return, and writes
docs/agents/backtests/fp5/summary_pass20.json. Public archives only.
Nothing here places an order or reads a key.

    python3 docs/agents/scripts/fp5/screen_pass20.py
    python3 docs/agents/scripts/fp5/screen_pass20.py --check
"""
import csv, hashlib, json, os, sys, urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone

import screen_pass5 as p5

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..", ".."))
RULES = os.path.join(ROOT, "docs/agents/scripts/fp5")
INP = os.path.join(ROOT, "docs/agents/backtests/inputs/fp5_2026-09-25/pass20")
OUT = os.path.join(ROOT, "docs/agents/backtests/fp5/summary_pass20.json")
SHA = {
    "covid": "584fb64e5ec34e2a21af19ce9a19758624f89429cc57b4e7b8b9aa2ef162d658",
    "debt": "52b50ea21f84b6f84237a8945882b92de6db899cba8a28425c3d091cc3e32a78",
    "nao": "cd39a6f5d6e83922a68dbc5bdd6e47b58977af233fb918bf9d8c1ab6e3eef652",
    "bfx": "9799f5a780106b311d519dae4cdd30a1a63a64d57d98e5bc9da5ba1cb3a2c7c3",
    "copper": "42b23f767f2f498e02dd7c2ba5566d5aa713ba65a3121059fbad976dcbc545b9",
    "wheat": "f07fddfd0221e574f01f22f8a1b9063a16c1a3c13062d9fb6e78de0e459b0e13",
    "temp": "0902e4e3bf67e9859cb8569702d6ae68bbb6c15986e60f2157ca5f21d82d5e0b",
    "rain": "bf1fe5a1e4d8866c6133f578a41cb8dbf0b595d4ba467497159933c186ddd269",
}
JHU = "https://raw.githubusercontent.com/CSSEGISandData/COVID-19/master/csse_covid_19_data/csse_covid_19_time_series/time_series_covid19_confirmed_global.csv"
DEBT = ("https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v2/accounting/od/debt_to_penny"
        "?fields=record_date,tot_pub_debt_out_amt&sort=record_date&page[size]=10000")
NAO = "https://ftp.cpc.ncep.noaa.gov/cwlinks/norm.daily.nao.index.b500101.current.ascii"
BFX = "https://api-pub.bitfinex.com/v2/candles/trade:1D:tBTCUSD/hist?limit=10000&sort=1"
YAHOO = "https://query1.finance.yahoo.com/v8/finance/chart/%s?period1=1483228800&period2=1546387200&interval=1d"
METEO = ("https://archive-api.open-meteo.com/v1/archive?latitude=40.7128&longitude=-74.0060"
         "&start_date=2017-01-01&end_date=2018-12-31&daily=temperature_2m_mean,precipitation_sum"
         "&temperature_unit=fahrenheit&timezone=UTC")


def sha256_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 16), b""):
            h.update(chunk)
    return h.hexdigest()


def require_rules():
    found = {}
    for name, digest in SHA.items():
        have = sha256_file(os.path.join(RULES, name + "_rule.txt"))
        if have != digest:
            raise SystemExit("rule text moved after the freeze: %s %s" % (name, have))
        found[name] = have
    return found


def fetch_bytes(url):
    req = urllib.request.Request(url, headers={"User-Agent": "fp5-screen/1.0"})
    with urllib.request.urlopen(req, timeout=120) as r:
        return r.read()


def agreed(url, parse):
    for _ in range(2):
        first, second = parse(fetch_bytes(url)), parse(fetch_bytes(url))
        if first == second:
            return first
    raise SystemExit("two pulls disagree: %s" % url)


def dump_levels(path, header, levels):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    lines = [header]
    for day in sorted(levels):
        lines.append("%s,%s" % (day, format(levels[day], ".17g")))
    with open(path, "w") as f:
        f.write("\n".join(lines) + "\n")


def load_levels(path, header, first_day, last_day=None, cover=None):
    lines = open(path).read().splitlines()
    if not lines or lines[0] != header:
        raise SystemExit("header %s" % header)
    levels = {}
    for line in lines[1:]:
        day, cell = line.split(",")
        if day in levels:
            raise SystemExit("duplicate day %s" % day)
        levels[day] = float(cell)
    if not levels or min(levels) != first_day:
        raise SystemExit("archive start %s: %s" % (path, min(levels) if levels else None))
    if last_day is not None and max(levels) != last_day:
        raise SystemExit("archive end %s: %s" % (path, max(levels)))
    if cover is not None and max(levels) < cover:
        raise SystemExit("archive %s does not cover %s" % (path, cover))
    return levels


def yy_date(cell):
    month, day, year = cell.split("/")
    y = int(year)
    if y < 100:
        y += 2000
    return "%04d-%02d-%02d" % (y, int(month), int(day))


def new_cases(dates, cumulative):
    levels = {}
    for i in range(1, len(dates)):
        prev = p5.ymd(p5.parse_ymd(dates[i]) - timedelta(days=1))
        if prev != dates[i - 1]:
            raise SystemExit("covid dates are not consecutive")
        diff = cumulative[i] - cumulative[i - 1]
        if diff > 0:
            levels[dates[i]] = float(diff)
    return levels


def parse_covid(body):
    rows = list(csv.reader(body.decode("utf-8").splitlines()))
    if not rows or rows[0][1] != "Country/Region":
        raise SystemExit("covid header")
    dates = [yy_date(cell) for cell in rows[0][4:]]
    if dates[0] != "2020-01-22" or dates[-1] != "2023-03-09":
        raise SystemExit("covid bounds %s .. %s" % (dates[0], dates[-1]))
    if "2021-01-02" not in dates:
        raise SystemExit("covid dropped a Saturday")
    us = [row for row in rows[1:] if len(row) > 1 and row[1] == "US"]
    if len(us) != 1:
        raise SystemExit("covid US rows %d" % len(us))
    cumulative = [float(cell) for cell in us[0][4:]]
    if len(cumulative) != len(dates):
        raise SystemExit("covid width")
    return new_cases(dates, cumulative)


def parse_debt(body):
    obj = json.loads(body.decode("utf-8"))
    rows = obj["data"]
    if obj["meta"].get("total-count") != len(rows):
        raise SystemExit("debt page is short")
    levels = {}
    for row in rows:
        day = row["record_date"]
        if day in levels:
            raise SystemExit("duplicate debt day %s" % day)
        raw = row["tot_pub_debt_out_amt"]
        if raw is None or raw == "" or raw == "null":
            continue
        amount = float(raw)
        if amount > 0:
            levels[day] = amount
    if min(levels) != "1993-04-01":
        raise SystemExit("debt does not start 1993-04-01")
    return levels


def parse_nao(body):
    levels = {}
    for line in body.decode("utf-8", "replace").splitlines():
        parts = line.split()
        if len(parts) != 4:
            continue
        year, month, day, raw = parts
        if raw.startswith("-99"):
            continue
        stamp = "%04d-%02d-%02d" % (int(year), int(month), int(day))
        if stamp in levels:
            raise SystemExit("duplicate nao day %s" % stamp)
        levels[stamp] = float(raw)
    if not levels or min(levels) != "1950-01-01" or max(levels) < "2018-12-31":
        raise SystemExit("nao bounds")
    if "2018-01-06" not in levels:
        raise SystemExit("nao dropped a Saturday")
    n2017 = sum(1 for day in levels if day.startswith("2017-"))
    n2018 = sum(1 for day in levels if day.startswith("2018-"))
    if n2017 != 365 or n2018 != 365:
        raise SystemExit("nao year length %d %d" % (n2017, n2018))
    return levels


def parse_yahoo(body):
    obj = json.loads(body.decode("utf-8"))
    result = obj["chart"]["result"][0]
    levels = {}
    for ts, close in zip(result["timestamp"], result["indicators"]["quote"][0]["close"]):
        if close is None:
            continue
        day = datetime.fromtimestamp(ts, timezone.utc).strftime("%Y-%m-%d")
        if day in levels:
            raise SystemExit("duplicate yahoo day %s" % day)
        levels[day] = float(close)
    return levels


def parse_meteo(body):
    daily = json.loads(body.decode("utf-8"))["daily"]
    temp, rain = {}, {}
    for day, degrees, milli in zip(daily["time"], daily["temperature_2m_mean"], daily["precipitation_sum"]):
        if degrees is None or milli is None:
            raise SystemExit("meteo gap %s" % day)
        if day in temp:
            raise SystemExit("duplicate meteo day %s" % day)
        temp[day] = float(degrees)
        rain[day] = float(milli)
    return temp, rain


def parse_bfx(body):
    rows = json.loads(body.decode("utf-8"))
    if not rows or len(rows[0]) != 6:
        raise SystemExit("bitfinex width")
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    levels = {}
    for row in rows:
        day = datetime.fromtimestamp(row[0] / 1000, timezone.utc).strftime("%Y-%m-%d")
        if day >= today or day > "2018-12-31":
            continue
        if day in levels:
            raise SystemExit("duplicate bitfinex day %s" % day)
        levels[day] = float(row[5])
    if min(levels) != "2013-03-31":
        raise SystemExit("bitfinex does not start 2013-03-31")
    return levels


def stamp_of(ts):
    ts = ts / 1_000_000 if ts > 10**14 else ts / 1000
    return datetime.fromtimestamp(ts, timezone.utc)


def iter_kline_rows(folder):
    if not os.path.isdir(folder):
        raise SystemExit("missing klines %s" % folder)
    for name in sorted(os.listdir(folder)):
        if not name.endswith(".zip"):
            continue
        for line in p5.zip_text(os.path.join(folder, name)).splitlines():
            if not line or line.startswith("open"):
                continue
            yield line.split(",")


def load_field(folder, index, need):
    values = {}
    first = None
    for parts in iter_kline_rows(folder):
        if len(parts) < need:
            raise SystemExit("kline gap: field %d absent (%d fields)" % (need, len(parts)))
        day = p5.ymd(stamp_of(int(parts[0])))
        if day in values:
            raise SystemExit("duplicate day %s" % day)
        values[day] = float(parts[index])
        if first is None or day < first:
            first = day
    return first, values


def volume_ratios(numer, denom):
    ratios = {}
    for day, num in numer.items():
        if day in denom and num >= 0 and denom[day] > 0:
            ratios[day] = num / denom[day]
    return ratios


def level_changes(levels):
    changes = {}
    for day, level in levels.items():
        prev = p5.ymd(p5.parse_ymd(day) - timedelta(days=1))
        if prev in levels and levels[prev] > 0:
            changes[day] = level / levels[prev] - 1.0
    return changes


def level_diffs(levels):
    changes = {}
    for day, level in levels.items():
        prev = p5.ymd(p5.parse_ymd(day) - timedelta(days=1))
        if prev in levels:
            changes[day] = level - levels[prev]
    return changes


def ensure_inputs():
    jobs = []
    spans = (p5.months("2017-08", "2018-12"), p5.months("2020-12", "2021-12"))
    for sym in ("BTCUSDT", "ETHUSDT"):
        for ym in spans[0] + spans[1]:
            name = "%s-1d-%s.zip" % (sym, ym)
            url = p5.VISION + "spot/monthly/klines/%s/1d/%s" % (sym, name)
            jobs.append((url, os.path.join(INP, "klines", "spot", sym, "1d", name)))
    with ThreadPoolExecutor(max_workers=12) as pool:
        list(pool.map(lambda job: p5.fetch(*job), jobs))
    dump_levels(os.path.join(INP, "covid.csv"), "day,cases", agreed(JHU, parse_covid))
    dump_levels(os.path.join(INP, "debt.csv"), "day,usd", agreed(DEBT, parse_debt))
    dump_levels(os.path.join(INP, "nao.csv"), "day,index", agreed(NAO, parse_nao))
    dump_levels(os.path.join(INP, "bfx.csv"), "day,btc", agreed(BFX, parse_bfx))
    dump_levels(os.path.join(INP, "copper.csv"), "day,close", agreed(YAHOO % "HG%3DF", parse_yahoo))
    dump_levels(os.path.join(INP, "wheat.csv"), "day,close", agreed(YAHOO % "ZW%3DF", parse_yahoo))
    temp, rain = agreed(METEO, parse_meteo)
    dump_levels(os.path.join(INP, "temp.csv"), "day,f", temp)
    dump_levels(os.path.join(INP, "rain.csv"), "day,mm", rain)


def run_rule(name, marked, btc, eth, floor):
    exec_days, flags = [], []
    for day, take in marked:
        if day not in btc or day not in eth:
            continue
        exec_days.append(day)
        flags.append(take)
    if not exec_days:
        raise SystemExit("no execution days for %s" % name)
    base = p5.score(exec_days, flags, btc, eth, 20.0)
    stress = p5.score(exec_days, flags, btc, eth, 40.0)
    base["stress"] = stress["pool"]
    p50, p95 = p5.null_band(exec_days, base["long_days"], btc, eth, 20.0)
    reasons = []
    share, month, month_pnl = p5.month_share(base)
    if not base["pool"] > 0:
        reasons.append("pooled P&L is not positive")
    if not base["stress"] > 0:
        reasons.append("doubled cost is not positive")
    if base["trips"] < 60:
        reasons.append("fewer than 60 round trips")
    if not (base["btc"] > 0 and base["eth"] > 0):
        reasons.append("one book is not positive")
    if not base["pool"] > p95:
        reasons.append("does not beat the random-day null")
    if share is not None and share > 0.40:
        reasons.append("one month is more than 40% of P&L")
    if not base["pool"] > floor:
        reasons.append("pooled P&L does not exceed %d bps" % floor)
    return {
        "name": name,
        "pool_bps": round(base["pool"], 1),
        "stress_bps": round(base["stress"], 1),
        "trips": base["trips"],
        "long_days": base["long_days"],
        "execution_days": len(exec_days),
        "btc_bps": round(base["btc"], 1),
        "eth_bps": round(base["eth"], 1),
        "null_p50_bps": round(p50, 1),
        "null_p95_bps": round(p95, 1),
        "month_share": None if share is None else round(share, 3),
        "top_month": month,
        "top_month_bps": None if month_pnl is None else round(month_pnl, 1),
        "candle_bar_clear": len(reasons) == 0,
        "why": "; ".join(reasons) if reasons else "candle bar is clear; closes still cannot pass",
    }


def self_check():
    p5.self_check()
    series = {p5.ymd(p5.parse_ymd("2020-01-01") + timedelta(days=i)): float(i + 1) for i in range(100)}
    signal = p5.ymd(p5.parse_ymd("2020-01-01") + timedelta(days=90))
    if p5.trailing_threshold(series, signal, 90, 71) != 72.0:
        raise SystemExit("top-quintile index")
    changes = level_changes({"2018-01-01": 10.0, "2018-01-02": 12.0, "2018-01-04": 15.0, "2018-01-05": 0.0, "2018-01-06": 1.0})
    if abs(changes.get("2018-01-02", 0) - 0.2) > 1e-9 or set(changes) != {"2018-01-02", "2018-01-05"}:
        raise SystemExit("level change: %s" % changes)
    diffs = level_diffs({"2018-01-01": 10.0, "2018-01-02": 12.0, "2018-01-03": 10.0, "2018-01-05": 7.0})
    if set(diffs) != {"2018-01-02", "2018-01-03"} or abs(diffs["2018-01-02"] - 2.0) > 1e-12 or abs(diffs["2018-01-03"] + 2.0) > 1e-12:
        raise SystemExit("level diff: %s" % diffs)
    ratios = volume_ratios({"2018-01-01": 0.0, "2018-01-02": 5.0}, {"2018-01-01": 10.0, "2018-01-02": 0.0})
    if ratios.get("2018-01-01") != 0.0 or "2018-01-02" in ratios:
        raise SystemExit("volume ratio: %s" % ratios)
    cases = new_cases(["2020-01-22", "2020-01-23", "2020-01-24"], [1.0, 1.0, 5.0])
    if cases != {"2020-01-24": 4.0}:
        raise SystemExit("new cases: %s" % cases)
    if yy_date("1/22/20") != "2020-01-22":
        raise SystemExit("yy date")
    us = datetime.fromtimestamp(1735689600000000 / 1_000_000, timezone.utc)
    ms = datetime.fromtimestamp(1606780800000 / 1000, timezone.utc)
    if p5.ymd(us) != "2025-01-01" or p5.ymd(ms) != "2020-12-01":
        raise SystemExit("kline timestamp unit")


def require_history(name, changes, day):
    prior = sum(1 for item in changes if item < day)
    if prior < 90:
        raise SystemExit("%s has %d changes before %s" % (name, prior, day))


def main():
    check = "--check" in sys.argv
    found = require_rules()
    self_check()
    if not check:
        ensure_inputs()
    btc_first, btc_base = load_field(os.path.join(INP, "klines", "spot", "BTCUSDT", "1d"), 5, 6)
    _, btc_closes = load_field(os.path.join(INP, "klines", "spot", "BTCUSDT", "1d"), 4, 5)
    eth_first, eth_closes = load_field(os.path.join(INP, "klines", "spot", "ETHUSDT", "1d"), 4, 5)
    if btc_first != "2017-08-17" or eth_first != "2017-08-17":
        raise SystemExit("spot archive does not start 2017-08-17")
    covid_path = os.path.join(INP, "covid.csv")
    covid_first = open(covid_path).read().splitlines()[1].split(",")[0]
    covid = load_levels(covid_path, "day,cases", covid_first, cover="2021-12-31")
    debt = load_levels(os.path.join(INP, "debt.csv"), "day,usd", "1993-04-01", cover="2018-12-31")
    nao = load_levels(os.path.join(INP, "nao.csv"), "day,index", "1950-01-01", cover="2018-12-31")
    bfx = load_levels(os.path.join(INP, "bfx.csv"), "day,btc", "2013-03-31", last_day="2018-12-31")
    copper = load_levels(os.path.join(INP, "copper.csv"), "day,close", "2017-01-03", last_day="2018-12-31")
    wheat = load_levels(os.path.join(INP, "wheat.csv"), "day,close", "2017-01-03", last_day="2018-12-31")
    temp = load_levels(os.path.join(INP, "temp.csv"), "day,f", "2017-01-01", last_day="2018-12-31")
    rain = load_levels(os.path.join(INP, "rain.csv"), "day,mm", "2017-01-01", last_day="2018-12-31")
    if min(covid) < "2020-01-23" or max(covid) > "2023-03-09" or max(covid) < "2021-12-31":
        raise SystemExit("covid levels %s .. %s" % (min(covid), max(covid)))
    for name, levels in (("debt", debt), ("copper", copper), ("wheat", wheat)):
        if "2018-01-06" in levels:
            raise SystemExit("%s printed a Saturday" % name)
    for name, levels in (("temp", temp), ("rain", rain), ("bfx", bfx), ("nao", nao)):
        if "2018-01-06" not in levels:
            raise SystemExit("%s dropped a Saturday" % name)
    btc_2018 = p5.returns_between(btc_closes, "2018-01-01", "2018-12-31")
    eth_2018 = p5.returns_between(eth_closes, "2018-01-01", "2018-12-31")
    btc_2021 = p5.returns_between(btc_closes, "2021-01-01", "2021-12-31")
    eth_2021 = p5.returns_between(eth_closes, "2021-01-01", "2021-12-31")
    specs = (
        ("us_covid_cases_2021", level_changes(covid), "2021-01-01", "2021-12-31", btc_2021, eth_2021),
        ("public_debt_2018", level_changes(debt), "2018-01-01", "2018-12-31", btc_2018, eth_2018),
        ("nao_index_2018", level_diffs(nao), "2018-01-01", "2018-12-31", btc_2018, eth_2018),
        ("bitfinex_base_share_2018", level_changes(volume_ratios(bfx, btc_base)), "2018-01-01", "2018-12-31", btc_2018, eth_2018),
        ("copper_close_2018", level_changes(copper), "2018-01-01", "2018-12-31", btc_2018, eth_2018),
        ("wheat_close_2018", level_changes(wheat), "2018-01-01", "2018-12-31", btc_2018, eth_2018),
        ("nyc_temperature_2018", level_diffs(temp), "2018-01-01", "2018-12-31", btc_2018, eth_2018),
        ("nyc_precipitation_2018", level_diffs(rain), "2018-01-01", "2018-12-31", btc_2018, eth_2018),
    )
    kills = {}
    for name, changes, start, end, btc, eth in specs:
        require_history(name, changes, start)
        marked = p5.long_days_for(changes, start, end, 90, 71, False)
        kills[name] = run_rule(name, marked, btc, eth, 400)
    summary = {
        "reached_preregistration": False,
        "note": "Each rule was hashed before its own result. Daily closes can kill a rule. None is a pass.",
        "rules": {name + "_rule_sha256": digest for name, digest in found.items()},
        "kills": kills,
    }
    text = json.dumps(summary, indent=2, sort_keys=True) + "\n"
    if check:
        with open(OUT) as f:
            have = f.read()
        if have != text:
            raise SystemExit("summary_pass20.json does not match a fresh run")
        return
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w") as f:
        f.write(text)


if __name__ == "__main__":
    main()
