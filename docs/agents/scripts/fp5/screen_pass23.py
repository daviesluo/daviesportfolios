"""Eight frozen Revolut X screens. Candles can kill a rule. They cannot pass one.

Reads the eight rule texts hashed at 2026-09-25 05:21:47 UTC, before any of
their series was joined to a return, and writes
docs/agents/backtests/fp5/summary_pass23.json. Public archives only.
Nothing here places an order or reads a key.

    python3 docs/agents/scripts/fp5/screen_pass23.py
    python3 docs/agents/scripts/fp5/screen_pass23.py --check
"""
import csv, gzip, hashlib, io, json, os, sys, time, urllib.error, urllib.parse, urllib.request, zipfile
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone

import screen_pass5 as p5

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..", ".."))
RULES = os.path.join(ROOT, "docs/agents/scripts/fp5")
INP = os.path.join(ROOT, "docs/agents/backtests/inputs/fp5_2026-09-25/pass23")
OUT = os.path.join(ROOT, "docs/agents/backtests/fp5/summary_pass23.json")
SHA = {
    "eso": "bb052c240888bd78da9ce16d0fb5c037087b68d9a93fc392ea571d113f37c07f",
    "fda": "5849cf254f2b228926509b9d460c816b097f24de5ff22f5a0c77ef47476ded82",
    "storm": "1a360099e1830f0dd5fdfa14cb07ddf3c9d51b30fbab1e4308fdce494acf531c",
    "nyc311": "26c2053aec8f2626bfec7864f9b9171437beefbd4118adb10949ca3e02fd9b61",
    "trial": "c2e42408276689215e9fda976116bba41a4822ec1e713ce8df933b25b6d0aca8",
    "fire": "a9e756ee9582f2487122bf9fffc51b03d458e8b379c24b1b18bd3dc40dc75d02",
    "subway": "bc324e3e7d7ebe21541b7404b11bbcb81ae7f8e52392818f7a58a42a15966d7e",
    "bike": "f73ff19a8e4e065529c4929f38d81d98f2223f2c536e0b7801947908b8089d63",
}
ESO = {
    "2017": "https://api.neso.energy/dataset/8f2fe0af-871c-488d-8bad-960426f24601/resource/2f0f75b8-39c5-46ff-a914-ae38088ed022/download/demanddata_2017.csv",
    "2018": "https://api.neso.energy/dataset/8f2fe0af-871c-488d-8bad-960426f24601/resource/fcb12133-0db0-4f27-a4a5-1669fd9f6d33/download/demanddata_2018.csv",
}
FDA = "https://api.fda.gov/drug/event.json?search=receivedate:[20170101+TO+20181231]&count=receivedate"
STORM = {
    "2017": "https://www.ncei.noaa.gov/pub/data/swdi/stormevents/csvfiles/StormEvents_details-ftp_v1.0_d2017_c20260519.csv.gz",
    "2018": "https://www.ncei.noaa.gov/pub/data/swdi/stormevents/csvfiles/StormEvents_details-ftp_v1.0_d2018_c20260323.csv.gz",
}
HMS = "https://satepsanone.nesdis.noaa.gov/pub/FIRE/web/HMS/Fire_Points/Text/%d/%02d/hms_fire%s.txt"
BIKE = "https://s3.amazonaws.com/hubway-data/%s-%s-tripdata.zip"
UA = {"User-Agent": "fp5-screen/1.0 (daviesluo@gmail.com)"}


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


def fetch_status(url, timeout=180):
    last = None
    for attempt in range(4):
        try:
            req = urllib.request.Request(url, headers=UA)
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return r.status, r.read()
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return 404, b""
            last = e
            time.sleep(1.5 * (attempt + 1))
        except Exception as e:
            last = e
            time.sleep(1.5 * (attempt + 1))
    raise SystemExit("fetch failed %s: %s" % (url, last))


def fetch_bytes(url, timeout=180):
    status, body = fetch_status(url, timeout)
    if status != 200:
        raise SystemExit("fetch failed %s: %s" % (url, status))
    return body


def fetch_json(url, timeout=120):
    last = None
    for attempt in range(4):
        try:
            req = urllib.request.Request(url, headers={**UA, "Accept": "application/json"})
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return json.loads(r.read().decode("utf-8"))
        except Exception as e:
            last = e
            time.sleep(1.5 * (attempt + 1))
    raise SystemExit("fetch failed %s: %s" % (url, last))


def agreed(pull, label):
    for _ in range(2):
        first, second = pull(), pull()
        if first == second:
            return first
    raise SystemExit("two pulls disagree: %s" % label)


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


def year_count(levels, year):
    return sum(1 for day in levels if day.startswith(year))


def require_year(levels, year, days, saturday):
    if year_count(levels, year) != days:
        raise SystemExit("%s year length %s" % (year, year_count(levels, year)))
    if saturday not in levels:
        raise SystemExit("dropped a Saturday %s" % saturday)


def window_days(start, end):
    return list(p5.daterange(start, end))


def parse_eso():
    levels = {}
    for url in (ESO["2017"], ESO["2018"]):
        rows = csv.DictReader(io.StringIO(fetch_bytes(url).decode("utf-8-sig")))
        buckets = {}
        for row in rows:
            day = datetime.strptime(row["SETTLEMENT_DATE"], "%d-%b-%Y").strftime("%Y-%m-%d")
            try:
                value = float(row["ND"])
            except (TypeError, ValueError):
                continue
            if value > 0:
                buckets.setdefault(day, []).append(value)
        for day, values in buckets.items():
            if len(values) < 46:
                continue
            if day in levels:
                raise SystemExit("duplicate demand day %s" % day)
            levels[day] = sum(values) / len(values)
    if min(levels) != "2017-01-01" or max(levels) != "2018-12-31":
        raise SystemExit("demand bounds")
    require_year(levels, "2017", 365, "2017-01-07")
    require_year(levels, "2018", 365, "2018-01-06")
    return levels


def parse_fda():
    data = fetch_json(FDA)
    levels = {}
    for row in data["results"]:
        token = row["time"]
        day = "%s-%s-%s" % (token[:4], token[4:6], token[6:8])
        count = row["count"]
        if day in levels:
            raise SystemExit("duplicate fda day %s" % day)
        if not isinstance(count, int) or count <= 0:
            raise SystemExit("fda level %s" % day)
        levels[day] = float(count)
    if min(levels) != "2017-01-01" or max(levels) != "2018-12-31":
        raise SystemExit("fda bounds")
    require_year(levels, "2017", 365, "2017-01-07")
    require_year(levels, "2018", 365, "2018-01-06")
    return levels


def parse_storm():
    levels = {}
    for year, url in STORM.items():
        text = gzip.GzipFile(fileobj=io.BytesIO(fetch_bytes(url))).read().decode("utf-8", "replace")
        for row in csv.DictReader(io.StringIO(text)):
            token = (row.get("BEGIN_DATE_TIME") or "").strip()
            if not token:
                raise SystemExit("storm blank date")
            day = datetime.strptime(token, "%d-%b-%y %H:%M:%S").strftime("%Y-%m-%d")
            if not day.startswith(year):
                raise SystemExit("storm date outside %s %s" % (year, day))
            levels[day] = levels.get(day, 0.0) + 1.0
    if min(levels) != "2017-01-01" or max(levels) != "2018-12-31":
        raise SystemExit("storm bounds")
    require_year(levels, "2017", 365, "2017-01-07")
    require_year(levels, "2018", 365, "2018-01-06")
    return levels


def parse_nyc():
    url = (
        "https://data.cityofnewyork.us/resource/erm2-nwe9.json?$select="
        + urllib.parse.quote("date_trunc_ymd(created_date) as day, count(*) as n")
        + "&$where="
        + urllib.parse.quote("created_date >= '2020-01-01T00:00:00' AND created_date < '2022-01-01T00:00:00'")
        + "&$group=day&$order=day&$limit=800"
    )
    rows = fetch_json(url, timeout=180)
    levels = {}
    for row in rows:
        day = row["day"][:10]
        count = int(row["n"])
        if day in levels:
            raise SystemExit("duplicate 311 day %s" % day)
        if count <= 0:
            raise SystemExit("311 level %s" % day)
        levels[day] = float(count)
    if min(levels) != "2020-01-01" or max(levels) != "2021-12-31":
        raise SystemExit("311 bounds")
    require_year(levels, "2020", 366, "2020-01-04")
    require_year(levels, "2021", 365, "2021-01-02")
    return levels


def trial_count(day):
    url = (
        "https://clinicaltrials.gov/api/v2/studies?query.term="
        + urllib.parse.quote("AREA[StudyFirstPostDate]RANGE[%s,%s]" % (day, day))
        + "&countTotal=true&pageSize=1"
    )
    data = fetch_json(url)
    count = data.get("totalCount")
    if not isinstance(count, int) or count < 0:
        raise SystemExit("trial level %s" % day)
    return float(count)


def pull_days(days, one):
    out = {}
    with ThreadPoolExecutor(max_workers=6) as pool:
        for day, value in pool.map(lambda item: (item, one(item)), days):
            out[day] = value
    return out


def parse_trials():
    days = window_days("2017-01-01", "2018-12-31")
    levels = pull_days(days, trial_count)
    if min(levels) != "2017-01-01" or max(levels) != "2018-12-31" or len(levels) != 730:
        raise SystemExit("trial bounds")
    if "2018-01-06" not in levels:
        raise SystemExit("trial dropped a Saturday")
    return levels


def parse_subway():
    url = (
        "https://data.ny.gov/resource/vxuj-8kew.json?$select="
        + urllib.parse.quote("date_trunc_ymd(date) as day, subways_total_estimated_ridership as n")
        + "&$where="
        + urllib.parse.quote("date >= '2020-03-01T00:00:00' AND date < '2022-01-01T00:00:00'")
        + "&$order=day&$limit=800"
    )
    rows = fetch_json(url, timeout=180)
    levels = {}
    for row in rows:
        day = row["day"][:10]
        count = int(row["n"])
        if day in levels:
            raise SystemExit("duplicate subway day %s" % day)
        if count <= 0:
            raise SystemExit("subway level %s" % day)
        levels[day] = float(count)
    if min(levels) != "2020-03-01" or max(levels) != "2021-12-31":
        raise SystemExit("subway bounds")
    require_year(levels, "2020", 306, "2020-03-07")
    require_year(levels, "2021", 365, "2021-01-02")
    return levels


def fire_count(day):
    dt = p5.parse_ymd(day)
    url = HMS % (dt.year, dt.month, dt.strftime("%Y%m%d"))
    status, body = fetch_status(url, timeout=60)
    if status == 404:
        return None
    if status != 200:
        raise SystemExit("fire status %s %s" % (day, status))
    text = body.decode("utf-8", "replace")
    if "Lon" not in text or "Lat" not in text:
        raise SystemExit("fire header %s" % day)
    count = 0
    for line in text.splitlines():
        if not line.strip():
            continue
        if "Lon" in line and "Lat" in line:
            continue
        count += 1
    return float(count)


def parse_fire():
    days = window_days("2017-01-01", "2018-12-31")
    pulled = pull_days(days, fire_count)
    levels = {day: value for day, value in pulled.items() if value is not None}
    if "2017-01-01" not in levels or "2018-01-06" not in levels:
        raise SystemExit("fire missing a pinned day")
    if year_count(levels, "2017") < 300 or year_count(levels, "2018") < 300:
        raise SystemExit("fire year length")
    return levels


def bike_url(ym):
    year, month = int(ym[:4]), int(ym[4:])
    kind = "hubway" if (year, month) <= (2018, 4) else "bluebikes"
    return BIKE % (ym, kind)


def parse_bike():
    levels = {day: 0.0 for day in window_days("2017-01-01", "2018-12-31")}
    for year in (2017, 2018):
        for month in range(1, 13):
            ym = "%04d%02d" % (year, month)
            blob = fetch_bytes(bike_url(ym))
            archive = zipfile.ZipFile(io.BytesIO(blob))
            names = [name for name in archive.namelist() if name.lower().endswith("tripdata.csv")]
            if len(names) != 1:
                raise SystemExit("bike csv %s" % ym)
            reader = csv.DictReader(io.StringIO(archive.read(names[0]).decode("utf-8")))
            if "starttime" not in (reader.fieldnames or []):
                raise SystemExit("bike column %s" % ym)
            for row in reader:
                token = row["starttime"]
                if len(token) < 10 or token[4] != "-" or token[7] != "-":
                    raise SystemExit("bike time %s" % ym)
                day = token[:10]
                if day in levels:
                    levels[day] += 1.0
    require_year(levels, "2017", 365, "2017-01-07")
    require_year(levels, "2018", 365, "2018-01-06")
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
    for parts in iter_kline_rows(folder):
        if len(parts) < need:
            raise SystemExit("kline gap: field %d absent (%d fields)" % (need, len(parts)))
        day = p5.ymd(stamp_of(int(parts[0])))
        if day in values:
            raise SystemExit("duplicate day %s" % day)
        values[day] = float(parts[index])
    return values


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
    for sym in ("BTCUSDT", "ETHUSDT"):
        for start, end in (("2017-12", "2018-12"), ("2020-12", "2021-12")):
            for ym in p5.months(start, end):
                name = "%s-1d-%s.zip" % (sym, ym)
                url = p5.VISION + "spot/monthly/klines/%s/1d/%s" % (sym, name)
                jobs.append((url, os.path.join(INP, "klines", "spot", sym, "1d", name)))
    with ThreadPoolExecutor(max_workers=8) as pool:
        list(pool.map(lambda job: p5.fetch(*job), jobs))
    steps = (
        ("eso.csv", "day,mw", lambda: agreed(parse_eso, "eso")),
        ("fda.csv", "day,reports", lambda: agreed(parse_fda, "fda")),
        ("storm.csv", "day,events", lambda: agreed(parse_storm, "storm")),
        ("nyc311.csv", "day,requests", lambda: agreed(parse_nyc, "nyc311")),
        ("bike.csv", "day,trips", lambda: agreed(parse_bike, "bike")),
        ("fire.csv", "day,points", lambda: agreed(parse_fire, "fire")),
        ("trial.csv", "day,studies", lambda: agreed(parse_trials, "trial")),
        ("subway.csv", "day,riders", lambda: agreed(parse_subway, "subway")),
    )
    for name, header, pull in steps:
        path = os.path.join(INP, name)
        if os.path.exists(path) and os.path.getsize(path) > 0:
            print("pass23 keep", name, flush=True)
            continue
        print("pass23 fetch", name, flush=True)
        dump_levels(path, header, pull())
    print("pass23 inputs ready", flush=True)


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
    if base["trips"] < 1 or base["long_days"] < 1:
        raise SystemExit("no entries for %s" % name)
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
    changes = level_changes({"2018-01-01": 10.0, "2018-01-02": 12.0, "2018-01-04": 15.0})
    if abs(changes.get("2018-01-02", 0) - 0.2) > 1e-9 or set(changes) != {"2018-01-02"}:
        raise SystemExit("level change")
    diffs = level_diffs({"2018-01-01": 10.0, "2018-01-02": 12.0, "2018-01-03": 10.0})
    if set(diffs) != {"2018-01-02", "2018-01-03"}:
        raise SystemExit("level diff")
    if bike_url("201804") != BIKE % ("201804", "hubway"):
        raise SystemExit("bike hubway name")
    if bike_url("201805") != BIKE % ("201805", "bluebikes"):
        raise SystemExit("bike bluebikes name")
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
    btc_closes = load_field(os.path.join(INP, "klines", "spot", "BTCUSDT", "1d"), 4, 5)
    eth_closes = load_field(os.path.join(INP, "klines", "spot", "ETHUSDT", "1d"), 4, 5)
    for day in ("2017-12-31", "2018-12-31", "2020-12-31", "2021-12-31"):
        if day not in btc_closes or day not in eth_closes:
            raise SystemExit("spot does not cover %s" % day)
    eso = load_levels(os.path.join(INP, "eso.csv"), "day,mw", "2017-01-01", last_day="2018-12-31")
    fda = load_levels(os.path.join(INP, "fda.csv"), "day,reports", "2017-01-01", last_day="2018-12-31")
    storm = load_levels(os.path.join(INP, "storm.csv"), "day,events", "2017-01-01", last_day="2018-12-31")
    nyc = load_levels(os.path.join(INP, "nyc311.csv"), "day,requests", "2020-01-01", last_day="2021-12-31")
    bike = load_levels(os.path.join(INP, "bike.csv"), "day,trips", "2017-01-01", last_day="2018-12-31")
    fire = load_levels(os.path.join(INP, "fire.csv"), "day,points", "2017-01-01", cover="2018-12-01")
    trial = load_levels(os.path.join(INP, "trial.csv"), "day,studies", "2017-01-01", last_day="2018-12-31")
    subway = load_levels(os.path.join(INP, "subway.csv"), "day,riders", "2020-03-01", last_day="2021-12-31")
    if "2018-01-06" not in fire:
        raise SystemExit("fire dropped a Saturday")
    btc18 = p5.returns_between(btc_closes, "2018-01-01", "2018-12-31")
    eth18 = p5.returns_between(eth_closes, "2018-01-01", "2018-12-31")
    btc21 = p5.returns_between(btc_closes, "2021-01-01", "2021-12-31")
    eth21 = p5.returns_between(eth_closes, "2021-01-01", "2021-12-31")
    specs = (
        ("neso_demand_2018", level_changes(eso), "2018-01-01", "2018-12-31", btc18, eth18),
        ("fda_reports_2018", level_changes(fda), "2018-01-01", "2018-12-31", btc18, eth18),
        ("storm_events_2018", level_changes(storm), "2018-01-01", "2018-12-31", btc18, eth18),
        ("nyc311_requests_2021", level_changes(nyc), "2021-01-01", "2021-12-31", btc21, eth21),
        ("trial_postings_2018", level_diffs(trial), "2018-01-01", "2018-12-31", btc18, eth18),
        ("hms_fire_points_2018", level_diffs(fire), "2018-01-01", "2018-12-31", btc18, eth18),
        ("subway_ridership_2021", level_changes(subway), "2021-01-01", "2021-12-31", btc21, eth21),
        ("bluebikes_trips_2018", level_diffs(bike), "2018-01-01", "2018-12-31", btc18, eth18),
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
            raise SystemExit("summary_pass23.json does not match a fresh run")
        return
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w") as f:
        f.write(text)


if __name__ == "__main__":
    main()
