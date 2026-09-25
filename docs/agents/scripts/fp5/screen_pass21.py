"""Eight frozen Revolut X screens. Candles can kill a rule. They cannot pass one.

Reads the eight rule texts hashed at 2026-09-25 03:56:11 UTC, before any of
their series was joined to a return, and writes
docs/agents/backtests/fp5/summary_pass21.json. Public archives only.
Nothing here places an order or reads a key.

    python3 docs/agents/scripts/fp5/screen_pass21.py
    python3 docs/agents/scripts/fp5/screen_pass21.py --check
"""
import hashlib, io, json, os, re, sys, urllib.request, zipfile
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from xml.etree import ElementTree as ET

import screen_pass5 as p5

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..", ".."))
RULES = os.path.join(ROOT, "docs/agents/scripts/fp5")
INP = os.path.join(ROOT, "docs/agents/backtests/inputs/fp5_2026-09-25/pass21")
OUT = os.path.join(ROOT, "docs/agents/backtests/fp5/summary_pass21.json")
SHA = {
    "sun": "97da14fe4ac3b8e968c10f7edaeb8cc332032efb08b8eeb0b9449f8336bd134d",
    "quake": "027b7d40d7174e834371f01fccdcec4e41b77bb0b563adbcc26c22267b653ed2",
    "river": "b0d44eb3e0a29f89ae3812123a19bceec682bcb21503c59000301c6c49d8b2dc",
    "shield": "16588a98f3d826b1322fc92441fa95769a7ce55dd9795c2ea089e4b4ab42766e",
    "npm": "da0b5cfb3a76d43db7c6cc9ae9ccafcc667a976e42982a08860f17ef504fbaab",
    "tsa": "438ce3ea36a51cf4357c4e3fb401bd946a34ad4e5f3b1aba0d3ac574abbe80c3",
    "ap": "82292e52b3ba843e9685b2dce717f5f191fe931f2340ab24225219ecf580cb0d",
    "ads": "719e5a124ea5fa6f79d8e2dedcd6af29bfb88f6d601a791dde4ee07164770656",
}
SUN = "https://www.sidc.be/SILSO/DATA/SN_d_tot_V2.0.csv"
QUAKE = ("https://earthquake.usgs.gov/fdsnws/event/1/query?format=csv"
         "&starttime=2017-01-01&endtime=2019-01-01&minmagnitude=4.5&orderby=time-asc")
RIVER = ("https://waterservices.usgs.gov/nwis/dv/?format=json&sites=01646500"
         "&startDT=2017-01-01&endDT=2018-12-31&parameterCd=00060&siteStatus=all")
SHIELD = "https://isc.sans.edu/api/dailysummary/2017-01-01/2018-12-31?json"
NPM = "https://api.npmjs.org/downloads/range/2017-06-30:2018-12-31/bitcoinjs-lib"
TSA = "https://www.tsa.gov/travel/passenger-volumes/%s"
AP = "https://kp.gfz.de/app/files/Kp_ap_Ap_SN_F107_since_1932.txt"
ADS = "https://www.philadelphiafed.org/-/media/frbp/assets/surveys-and-data/ads/ads_index_most_current_vintage.xlsx"
NS = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}


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


def year_count(levels, year):
    return sum(1 for day in levels if day.startswith(year))


def parse_sun(body):
    levels = {}
    for line in body.decode("utf-8", "replace").splitlines():
        if not line or line.startswith("#") or ";" not in line:
            continue
        parts = [cell.strip() for cell in line.split(";")]
        if len(parts) < 5:
            continue
        day = "%04d-%02d-%02d" % (int(parts[0]), int(parts[1]), int(parts[2]))
        number = float(parts[4])
        if number < 0:
            continue
        if day in levels:
            raise SystemExit("duplicate sunspot day %s" % day)
        levels[day] = number
    if min(levels) != "1818-01-08" or max(levels) < "2018-12-31":
        raise SystemExit("sunspot bounds")
    if year_count(levels, "2017") != 365 or year_count(levels, "2018") != 365:
        raise SystemExit("sunspot year length")
    if "2018-01-06" not in levels:
        raise SystemExit("sunspot dropped a Saturday")
    return levels


def fill_days(start, end):
    levels = {}
    day = p5.parse_ymd(start)
    last = p5.parse_ymd(end)
    while day <= last:
        levels[p5.ymd(day)] = 0.0
        day += timedelta(days=1)
    return levels


def parse_quake(body):
    levels = fill_days("2017-01-01", "2018-12-31")
    lines = body.decode("utf-8", "replace").splitlines()
    if not lines or not lines[0].startswith("time,"):
        raise SystemExit("quake header")
    for line in lines[1:]:
        if not line:
            continue
        day = line.split(",")[0][:10]
        if day in levels:
            levels[day] += 1.0
    if year_count(levels, "2017") != 365 or year_count(levels, "2018") != 365:
        raise SystemExit("quake year length")
    if "2018-01-06" not in levels:
        raise SystemExit("quake dropped a Saturday")
    return levels


def parse_river(body):
    series = json.loads(body.decode("utf-8"))["value"]["timeSeries"]
    if len(series) != 1:
        raise SystemExit("river series")
    levels = {}
    for row in series[0]["values"][0]["value"]:
        day = row["dateTime"][:10]
        if day in levels:
            raise SystemExit("duplicate river day %s" % day)
        amount = float(row["value"])
        if amount > 0:
            levels[day] = amount
    if min(levels) != "2017-01-01" or max(levels) != "2018-12-31":
        raise SystemExit("river bounds")
    if year_count(levels, "2017") != 365 or year_count(levels, "2018") != 365:
        raise SystemExit("river year length")
    if "2018-01-06" not in levels:
        raise SystemExit("river dropped a Saturday")
    return levels


def parse_shield(body):
    rows = json.loads(body.decode("utf-8"))
    levels = {}
    for row in rows:
        day = row["date"]
        if day in levels:
            raise SystemExit("duplicate shield day %s" % day)
        count = float(row["sources"])
        if count > 0:
            levels[day] = count
    if min(levels) != "2017-01-01" or max(levels) != "2018-12-31":
        raise SystemExit("shield bounds")
    if year_count(levels, "2017") != 365 or year_count(levels, "2018") != 308:
        raise SystemExit("shield year length %d %d" % (year_count(levels, "2017"), year_count(levels, "2018")))
    if "2018-01-06" not in levels:
        raise SystemExit("shield dropped the pinned Saturday")
    return levels


def parse_npm(body):
    rows = json.loads(body.decode("utf-8"))["downloads"]
    levels = {}
    for row in rows:
        day = row["day"]
        if day in levels:
            raise SystemExit("duplicate npm day %s" % day)
        count = float(row["downloads"])
        if count > 0:
            levels[day] = count
    if min(levels) != "2017-06-30" or max(levels) != "2018-12-31" or len(levels) != 550:
        raise SystemExit("npm bounds")
    if "2018-01-06" not in levels:
        raise SystemExit("npm dropped a Saturday")
    return levels


def parse_tsa(body):
    html = body.decode("utf-8", "replace")
    pairs = re.findall(
        r'<td class="text-align-center">(\d{1,2}/\d{1,2}/\d{4})</td><td class="text-align-center">([0-9,]+)</td>',
        html,
    )
    levels = {}
    for cell, num in pairs:
        month, day, year = cell.split("/")
        stamp = "%04d-%02d-%02d" % (int(year), int(month), int(day))
        if stamp in levels:
            raise SystemExit("duplicate tsa day %s" % stamp)
        count = float(num.replace(",", ""))
        if count > 0:
            levels[stamp] = count
    return levels


def parse_tsa_window():
    levels = {}
    y2019 = agreed(TSA % "2019", parse_tsa)
    y2020 = agreed(TSA % "2020", parse_tsa)
    if year_count(y2019, "2019") != 365 or min(y2019) != "2019-01-01" or max(y2019) != "2019-12-31":
        raise SystemExit("tsa 2019")
    if year_count(y2020, "2020") != 366 or min(y2020) != "2020-01-01" or max(y2020) != "2020-12-31":
        raise SystemExit("tsa 2020")
    if "2020-01-04" not in y2020:
        raise SystemExit("tsa dropped a Saturday")
    levels.update(y2019)
    levels.update(y2020)
    return levels


def parse_ap(body):
    levels = {}
    checked = False
    for line in body.decode("utf-8", "replace").splitlines():
        if not line or line.startswith("#"):
            continue
        parts = line.split()
        if len(parts) != 28:
            raise SystemExit("ap width %d" % len(parts))
        if not checked:
            mean = sum(float(parts[i]) for i in range(15, 23)) / 8.0
            if abs(float(parts[23]) - mean) > 0.51:
                raise SystemExit("Ap column is not the daily mean of ap")
            checked = True
        day = "%04d-%02d-%02d" % (int(parts[0]), int(parts[1]), int(parts[2]))
        amount = float(parts[23])
        if amount < 0:
            continue
        if day in levels:
            raise SystemExit("duplicate ap day %s" % day)
        levels[day] = amount
    if min(levels) != "1932-01-01" or max(levels) < "2018-12-31":
        raise SystemExit("ap bounds")
    if year_count(levels, "2017") != 365 or year_count(levels, "2018") != 365:
        raise SystemExit("ap year length")
    if "2018-01-06" not in levels:
        raise SystemExit("ap dropped a Saturday")
    return levels


def parse_ads(body):
    book = zipfile.ZipFile(io.BytesIO(body))
    root = ET.fromstring(book.read("xl/sharedStrings.xml"))
    strings = ["".join(node.itertext()) for node in root.findall(".//m:si", NS)]
    sheet = ET.fromstring(book.read("xl/worksheets/sheet1.xml"))
    header = sheet.findall("m:sheetData/m:row", NS)[0].findall("m:c", NS)
    names = [strings[int(cell.find("m:v", NS).text)] for cell in header[:2]]
    if names != ["Date", "ADS_Index"]:
        raise SystemExit("ads header %s" % names)
    levels = {}
    for row in sheet.findall("m:sheetData/m:row", NS)[1:]:
        cells = row.findall("m:c", NS)
        if len(cells) < 2:
            continue
        raw = strings[int(cells[0].find("m:v", NS).text)]
        year, month, day = raw.split(":")
        stamp = "%s-%s-%s" % (year, month, day)
        if stamp in levels:
            raise SystemExit("duplicate ads day %s" % stamp)
        levels[stamp] = float(cells[1].find("m:v", NS).text)
    if min(levels) != "1960-03-01" or max(levels) < "2018-12-31":
        raise SystemExit("ads bounds")
    if year_count(levels, "2017") != 365 or year_count(levels, "2018") != 365:
        raise SystemExit("ads year length")
    if "2018-01-06" not in levels:
        raise SystemExit("ads dropped a Saturday")
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
    spans = (p5.months("2017-08", "2018-12"), p5.months("2019-12", "2020-12"))
    for sym in ("BTCUSDT", "ETHUSDT"):
        for ym in spans[0] + spans[1]:
            name = "%s-1d-%s.zip" % (sym, ym)
            url = p5.VISION + "spot/monthly/klines/%s/1d/%s" % (sym, name)
            jobs.append((url, os.path.join(INP, "klines", "spot", sym, "1d", name)))
    with ThreadPoolExecutor(max_workers=12) as pool:
        list(pool.map(lambda job: p5.fetch(*job), jobs))
    dump_levels(os.path.join(INP, "sun.csv"), "day,number", agreed(SUN, parse_sun))
    dump_levels(os.path.join(INP, "quake.csv"), "day,count", agreed(QUAKE, parse_quake))
    dump_levels(os.path.join(INP, "river.csv"), "day,cfs", agreed(RIVER, parse_river))
    dump_levels(os.path.join(INP, "shield.csv"), "day,sources", agreed(SHIELD, parse_shield))
    dump_levels(os.path.join(INP, "npm.csv"), "day,downloads", agreed(NPM, parse_npm))
    dump_levels(os.path.join(INP, "tsa.csv"), "day,passengers", parse_tsa_window())
    dump_levels(os.path.join(INP, "ap.csv"), "day,ap", agreed(AP, parse_ap))
    dump_levels(os.path.join(INP, "ads.csv"), "day,index", agreed(ADS, parse_ads))


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
    counted = fill_days("2018-01-01", "2018-01-03")
    counted["2018-01-01"] = 2.0
    if counted != {"2018-01-01": 2.0, "2018-01-02": 0.0, "2018-01-03": 0.0}:
        raise SystemExit("zero count")
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
    btc_first, btc_closes = load_field(os.path.join(INP, "klines", "spot", "BTCUSDT", "1d"), 4, 5)
    eth_first, eth_closes = load_field(os.path.join(INP, "klines", "spot", "ETHUSDT", "1d"), 4, 5)
    if btc_first != "2017-08-17" or eth_first != "2017-08-17":
        raise SystemExit("spot archive does not start 2017-08-17")
    sun = load_levels(os.path.join(INP, "sun.csv"), "day,number", "1818-01-08", cover="2018-12-31")
    quake = load_levels(os.path.join(INP, "quake.csv"), "day,count", "2017-01-01", last_day="2018-12-31")
    river = load_levels(os.path.join(INP, "river.csv"), "day,cfs", "2017-01-01", last_day="2018-12-31")
    shield = load_levels(os.path.join(INP, "shield.csv"), "day,sources", "2017-01-01", last_day="2018-12-31")
    npm = load_levels(os.path.join(INP, "npm.csv"), "day,downloads", "2017-06-30", last_day="2018-12-31")
    tsa = load_levels(os.path.join(INP, "tsa.csv"), "day,passengers", "2019-01-01", last_day="2020-12-31")
    ap = load_levels(os.path.join(INP, "ap.csv"), "day,ap", "1932-01-01", cover="2018-12-31")
    ads = load_levels(os.path.join(INP, "ads.csv"), "day,index", "1960-03-01", cover="2018-12-31")
    for name, levels in (("sun", sun), ("quake", quake), ("river", river), ("npm", npm), ("ap", ap), ("ads", ads)):
        if "2018-01-06" not in levels:
            raise SystemExit("%s dropped a Saturday" % name)
    if "2018-01-06" not in shield:
        raise SystemExit("shield dropped the pinned Saturday")
    if "2020-01-04" not in tsa:
        raise SystemExit("tsa dropped a Saturday")
    btc_2018 = p5.returns_between(btc_closes, "2018-01-01", "2018-12-31")
    eth_2018 = p5.returns_between(eth_closes, "2018-01-01", "2018-12-31")
    btc_2020 = p5.returns_between(btc_closes, "2020-01-01", "2020-12-31")
    eth_2020 = p5.returns_between(eth_closes, "2020-01-01", "2020-12-31")
    specs = (
        ("sunspot_number_2018", level_diffs(sun), "2018-01-01", "2018-12-31", btc_2018, eth_2018),
        ("quake_count_2018", level_diffs(quake), "2018-01-01", "2018-12-31", btc_2018, eth_2018),
        ("potomac_flow_2018", level_changes(river), "2018-01-01", "2018-12-31", btc_2018, eth_2018),
        ("dshield_sources_2018", level_changes(shield), "2018-01-01", "2018-12-31", btc_2018, eth_2018),
        ("npm_downloads_2018", level_changes(npm), "2018-01-01", "2018-12-31", btc_2018, eth_2018),
        ("tsa_throughput_2020", level_changes(tsa), "2020-01-01", "2020-12-31", btc_2020, eth_2020),
        ("geomagnetic_ap_2018", level_diffs(ap), "2018-01-01", "2018-12-31", btc_2018, eth_2018),
        ("ads_index_2018", level_diffs(ads), "2018-01-01", "2018-12-31", btc_2018, eth_2018),
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
            raise SystemExit("summary_pass21.json does not match a fresh run")
        return
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w") as f:
        f.write(text)


if __name__ == "__main__":
    main()
