"""Eight frozen Revolut X screens. Candles can kill a rule. They cannot pass one.

Reads the eight rule texts hashed at 2026-09-25 04:16:27 UTC, before any of
their series was joined to a return, and writes
docs/agents/backtests/fp5/summary_pass22.json. Public archives only.
Nothing here places an order or reads a key.

    python3 docs/agents/scripts/fp5/screen_pass22.py
    python3 docs/agents/scripts/fp5/screen_pass22.py --check
"""
import gzip, hashlib, json, os, sys, time, urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone

import screen_pass5 as p5

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..", ".."))
RULES = os.path.join(ROOT, "docs/agents/scripts/fp5")
INP = os.path.join(ROOT, "docs/agents/backtests/inputs/fp5_2026-09-25/pass22")
OUT = os.path.join(ROOT, "docs/agents/backtests/fp5/summary_pass22.json")
SHA = {
    "lod": "93937dfce6c2a2a0ed471035086204d8da00b0e6f2264537bb3d245ba1996126",
    "swspeed": "c5bf45c09e51cd858bf735134d8e6f89ce63205b5a27e97007cce58498127683",
    "lake": "98b2cd0dba5f773185b4f4fceb03f043771b3bbf904f0ac7d1b1ef23ad99da09",
    "inat": "0002c3d195039f47cc6d1ab7bfe39c7b169fffdd53e7ce58599b6a36fede63cc",
    "cve": "c4f580ab35bae04bf280ce927f76284791447e20bb405c5d254e21ea4ce84a35",
    "works": "a33ba2bb1b8df5dcb3d34087319da873479693df0eec470d8dd7e73ac4c31f35",
    "hn": "03cd9fee167670041ffa4ca71d25b3de6392635dd465c640319f243b707d2df6",
    "wave": "8ad1682a8d7a69ff046dc2045a490a3415ae25e6fbca6423c4a23e89e9550cd8",
}
LOD = "https://datacenter.iers.org/products/eop/long-term/c04_14/iau2000/eopc04_14_IAU2000.62-now"
WIND = "https://spdf.gsfc.nasa.gov/pub/data/omni/low_res_omni/omni_m_daily.dat"
LAKE = ("https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?product=daily_mean"
        "&application=fp5&begin_date=20170101&end_date=20181231&datum=IGLD&station=9087031"
        "&time_zone=GMT&units=metric&format=json")
INAT = ("https://api.inaturalist.org/v1/observations/histogram?date_field=observed_on"
        "&interval=day&d1=2017-01-01&d2=2018-12-31")
NVD = "https://nvd.nist.gov/feeds/json/cve/2.0/nvdcve-2.0-%d.json.gz"
WORKS = "https://api.openalex.org/works?filter=from_publication_date:%s,to_publication_date:%s&per-page=1"
HN = ("https://hn.algolia.com/api/v1/search?tags=story&hitsPerPage=0"
      "&numericFilters=created_at_i%%3E%%3D%d,created_at_i%%3C%d")
WAVE = "https://www.ndbc.noaa.gov/data/historical/stdmet/46026h%d.txt.gz"
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


def fetch_bytes(url):
    last = None
    for attempt in range(4):
        try:
            req = urllib.request.Request(url, headers=UA)
            with urllib.request.urlopen(req, timeout=600) as r:
                return r.read()
        except Exception as e:
            last = e
            time.sleep(1.5 * (attempt + 1))
    raise SystemExit("fetch failed %s: %s" % (url, last))


def fetch_json(url):
    last = None
    for attempt in range(4):
        try:
            req = urllib.request.Request(url, headers={**UA, "Accept": "application/json"})
            with urllib.request.urlopen(req, timeout=180) as r:
                return json.loads(r.read().decode("utf-8"))
        except Exception as e:
            last = e
            time.sleep(1.5 * (attempt + 1))
    raise SystemExit("fetch failed %s: %s" % (url, last))


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


def year_count(levels, year):
    return sum(1 for day in levels if day.startswith(year))


def window_days():
    return list(p5.daterange("2017-01-01", "2018-12-31"))


def parse_lod(body):
    levels = {}
    for line in body.decode("utf-8", "replace").splitlines():
        parts = line.split()
        if len(parts) != 16 or not (len(parts[0]) == 4 and parts[0].isdigit()):
            continue
        day = "%04d-%02d-%02d" % (int(parts[0]), int(parts[1]), int(parts[2]))
        if day in levels:
            raise SystemExit("duplicate lod day %s" % day)
        levels[day] = float(parts[7])
    if min(levels) != "1962-01-01" or max(levels) < "2018-12-31":
        raise SystemExit("lod bounds")
    if year_count(levels, "2017") != 365 or year_count(levels, "2018") != 365:
        raise SystemExit("lod year length")
    if "2018-01-06" not in levels:
        raise SystemExit("lod dropped a Saturday")
    return levels


def parse_wind(body):
    levels = {}
    for line in body.decode("ascii", "replace").splitlines():
        parts = line.split()
        if len(parts) != 14 or not parts[0].isdigit():
            continue
        if float(parts[9]) >= 9999:
            continue
        year, doy = int(parts[0]), int(parts[1])
        day = (datetime(year, 1, 1) + timedelta(days=doy - 1)).strftime("%Y-%m-%d")
        if day in levels:
            raise SystemExit("duplicate wind day %s" % day)
        speed = float(parts[9])
        if speed > 0:
            levels[day] = speed
    if min(levels) != "1963-11-27" or max(levels) < "2018-12-31":
        raise SystemExit("wind bounds")
    if year_count(levels, "2017") != 365 or year_count(levels, "2018") != 365:
        raise SystemExit("wind year length")
    if "2018-01-06" not in levels:
        raise SystemExit("wind dropped a Saturday")
    return levels


def parse_lake(body):
    meta = json.loads(body.decode("utf-8"))
    if meta.get("metadata", {}).get("id") != "9087031":
        raise SystemExit("lake station")
    if meta.get("metadata", {}).get("name") != "Holland":
        raise SystemExit("lake name")
    levels = {}
    for row in meta["data"]:
        day = row["t"][:10]
        if day in levels:
            raise SystemExit("duplicate lake day %s" % day)
        level = float(row["v"])
        if level > 0:
            levels[day] = level
    if min(levels) != "2017-01-01" or max(levels) != "2018-12-31":
        raise SystemExit("lake bounds")
    if year_count(levels, "2017") != 365 or year_count(levels, "2018") != 365:
        raise SystemExit("lake year length")
    if "2018-01-06" not in levels:
        raise SystemExit("lake dropped a Saturday")
    return levels


def parse_inat(body):
    days = json.loads(body.decode("utf-8"))["results"]["day"]
    levels = {}
    for day, count in days.items():
        if day in levels:
            raise SystemExit("duplicate inat day %s" % day)
        amount = float(count)
        if amount > 0:
            levels[day] = amount
    if min(levels) != "2017-01-01" or max(levels) != "2018-12-31":
        raise SystemExit("inat bounds")
    if year_count(levels, "2017") != 365 or year_count(levels, "2018") != 365:
        raise SystemExit("inat year length")
    if "2018-01-06" not in levels:
        raise SystemExit("inat dropped a Saturday")
    return levels


def parse_cve_feeds():
    counts = {}
    seen = set()
    years = list(range(2015, 2021))
    bodies = [fetch_bytes(NVD % year) for year in years]
    for year, body in zip(years, bodies):
        doc = json.loads(gzip.decompress(body))
        rows = doc.get("vulnerabilities") or []
        if not rows:
            raise SystemExit("empty cve feed %d" % year)
        for item in rows:
            cve = item["cve"]
            ident = cve["id"]
            if ident in seen:
                continue
            seen.add(ident)
            day = cve["published"][:10]
            if "2017-01-01" <= day <= "2018-12-31":
                counts[day] = counts.get(day, 0.0) + 1.0
        del doc
    levels = {}
    for day in window_days():
        levels[day] = counts.get(day, 0.0)
    if sum(levels.values()) < 1000:
        raise SystemExit("cve feed did not cover the window")
    if year_count(levels, "2017") != 365 or year_count(levels, "2018") != 365:
        raise SystemExit("cve year length")
    if "2018-01-06" not in levels:
        raise SystemExit("cve dropped a Saturday")
    return levels


def agreed_cve():
    for _ in range(2):
        first, second = parse_cve_feeds(), parse_cve_feeds()
        if first == second:
            return first
    raise SystemExit("two pulls disagree: nvd")


def one_works(day):
    meta = fetch_json(WORKS % (day, day))["meta"]
    if "count" not in meta:
        raise SystemExit("works count missing")
    return float(meta["count"])


def one_hn(day):
    start = int(datetime.strptime(day, "%Y-%m-%d").replace(tzinfo=timezone.utc).timestamp())
    body = fetch_json(HN % (start, start + 86400))
    if body.get("exhaustiveNbHits") is not True:
        raise SystemExit("hn count is capped %s" % day)
    return float(body["nbHits"])


def agreed_days(fetch_one, label):
    days = window_days()
    def pull():
        found = {}
        with ThreadPoolExecutor(max_workers=6) as pool:
            for day, value in pool.map(lambda item: (item, fetch_one(item)), days):
                found[day] = value
        if set(found) != set(days):
            raise SystemExit("%s dropped a day" % label)
        return found
    for _ in range(2):
        first, second = pull(), pull()
        if first == second:
            return first
    raise SystemExit("two pulls disagree: %s" % label)


def parse_wave_year(body, year):
    lines = gzip.decompress(body).decode("ascii", "replace").splitlines()
    header = lines[0].split()
    if "WVHT" not in header:
        raise SystemExit("wave header %s" % header)
    index = header.index("WVHT")
    buckets = {}
    for line in lines[1:]:
        if not line or line.startswith("#"):
            continue
        parts = line.split()
        if len(parts) <= index:
            continue
        yy, month, day = int(parts[0]), int(parts[1]), int(parts[2])
        full = yy if yy >= 100 else 2000 + yy
        if full != year:
            continue
        height = float(parts[index])
        if height >= 99:
            continue
        stamp = "%04d-%02d-%02d" % (full, month, day)
        buckets.setdefault(stamp, []).append(height)
    levels = {}
    for stamp, values in buckets.items():
        if len(values) >= 20:
            levels[stamp] = sum(values) / float(len(values))
    return levels


def agreed_wave():
    def pull():
        levels = {}
        for year in (2017, 2018):
            levels.update(parse_wave_year(fetch_bytes(WAVE % year), year))
        if year_count(levels, "2017") != 363 or year_count(levels, "2018") != 363:
            raise SystemExit("wave year length")
        if "2018-01-06" not in levels or "2017-01-01" not in levels or "2018-12-31" not in levels:
            raise SystemExit("wave bounds")
        return levels
    for _ in range(2):
        first, second = pull(), pull()
        if first == second:
            return first
    raise SystemExit("two pulls disagree: wave")


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
        for ym in p5.months("2017-12", "2018-12"):
            name = "%s-1d-%s.zip" % (sym, ym)
            url = p5.VISION + "spot/monthly/klines/%s/1d/%s" % (sym, name)
            jobs.append((url, os.path.join(INP, "klines", "spot", sym, "1d", name)))
    with ThreadPoolExecutor(max_workers=8) as pool:
        list(pool.map(lambda job: p5.fetch(*job), jobs))
    steps = (
        ("lod.csv", "day,seconds", lambda: agreed(LOD, parse_lod)),
        ("wind.csv", "day,kms", lambda: agreed(WIND, parse_wind)),
        ("lake.csv", "day,metres", lambda: agreed(LAKE, parse_lake)),
        ("inat.csv", "day,observations", lambda: agreed(INAT, parse_inat)),
        ("cve.csv", "day,count", agreed_cve),
        ("works.csv", "day,count", lambda: agreed_days(one_works, "works")),
        ("hn.csv", "day,stories", lambda: agreed_days(one_hn, "hn")),
        ("wave.csv", "day,metres", agreed_wave),
    )
    for name, header, pull in steps:
        path = os.path.join(INP, name)
        if os.path.exists(path) and os.path.getsize(path) > 0:
            print("pass22 keep", name, flush=True)
            continue
        print("pass22 fetch", name, flush=True)
        dump_levels(path, header, pull())
    print("pass22 inputs ready", flush=True)


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
    if "2017-12-31" not in btc_closes or "2018-12-31" not in btc_closes:
        raise SystemExit("btc spot does not cover the screen")
    if "2017-12-31" not in eth_closes or "2018-12-31" not in eth_closes:
        raise SystemExit("eth spot does not cover the screen")
    lod = load_levels(os.path.join(INP, "lod.csv"), "day,seconds", "1962-01-01", cover="2018-12-31")
    wind = load_levels(os.path.join(INP, "wind.csv"), "day,kms", "1963-11-27", cover="2018-12-31")
    lake = load_levels(os.path.join(INP, "lake.csv"), "day,metres", "2017-01-01", last_day="2018-12-31")
    inat = load_levels(os.path.join(INP, "inat.csv"), "day,observations", "2017-01-01", last_day="2018-12-31")
    cve = load_levels(os.path.join(INP, "cve.csv"), "day,count", "2017-01-01", last_day="2018-12-31")
    works = load_levels(os.path.join(INP, "works.csv"), "day,count", "2017-01-01", last_day="2018-12-31")
    hn = load_levels(os.path.join(INP, "hn.csv"), "day,stories", "2017-01-01", last_day="2018-12-31")
    wave = load_levels(os.path.join(INP, "wave.csv"), "day,metres", "2017-01-01", last_day="2018-12-31")
    for name, levels in (("lod", lod), ("wind", wind), ("lake", lake), ("inat", inat), ("cve", cve), ("works", works), ("hn", hn), ("wave", wave)):
        if "2018-01-06" not in levels:
            raise SystemExit("%s dropped a Saturday" % name)
    btc = p5.returns_between(btc_closes, "2018-01-01", "2018-12-31")
    eth = p5.returns_between(eth_closes, "2018-01-01", "2018-12-31")
    specs = (
        ("length_of_day_2018", level_diffs(lod)),
        ("solar_wind_speed_2018", level_changes(wind)),
        ("holland_level_2018", level_changes(lake)),
        ("inaturalist_observations_2018", level_changes(inat)),
        ("cve_published_2018", level_diffs(cve)),
        ("openalex_works_2018", level_diffs(works)),
        ("hacker_news_stories_2018", level_diffs(hn)),
        ("buoy_wave_height_2018", level_changes(wave)),
    )
    kills = {}
    for name, changes in specs:
        require_history(name, changes, "2018-01-01")
        marked = p5.long_days_for(changes, "2018-01-01", "2018-12-31", 90, 71, False)
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
            raise SystemExit("summary_pass22.json does not match a fresh run")
        return
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w") as f:
        f.write(text)


if __name__ == "__main__":
    main()
