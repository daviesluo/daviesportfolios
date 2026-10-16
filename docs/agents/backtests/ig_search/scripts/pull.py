"""Pull every public source the IG strategy search reads, keyless, and keep what the tests need.

Raw answers go to a cache outside the repository (`--raw DIR`, default the session's scratch area) and are pinned by
sha256 in inputs/pull_log.json; what is committed is small and derived:
  inputs/daily.csv.gz        one row a calendar date, one column a series: Yahoo closes (and SPY/QQQ opens), FRED series,
                             Dukascopy daily closes (indices, gold, WTI)
  inputs/fx_events.csv.gz    FXCM hourly bid/ask (2012 on; deviation 1) at the clock times the FX tests read (14:00/16:00 London on every
                             weekday, the session legs' ends), mid and spread, per pair
  inputs/fomc_dates.json     scheduled FOMC statement days, parsed from federalreserve.gov
  inputs/cot.csv.gz          CFTC legacy futures-only rows of the six markets the COT test reads
Sources: query1.finance.yahoo.com (chart API), fred.stlouisfed.org (fredgraph.csv), datafeed.dukascopy.com (bi5 candles),
www.federalreserve.gov, www.cftc.gov. Run: python3 -I docs/agents/backtests/ig_search/scripts/pull.py [--raw DIR]
"""
import csv
import datetime as dt
import gzip
import hashlib
import io
import json
import lzma
import os
import re
import struct
import sys
import time
import urllib.request
import zipfile
from zoneinfo import ZoneInfo

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
INP = os.path.join(HERE, "inputs")
RAW = sys.argv[sys.argv.index("--raw") + 1] if "--raw" in sys.argv else "/tmp/claude-0/-home-user-daviesportfolios/66f2e96b-1f9a-594f-8046-5bffba951be8/scratchpad/ig_search_raw"
UTC = dt.timezone.utc
LON = ZoneInfo("Europe/London")
ET = ZoneInfo("America/New_York")
NOW = int(dt.datetime(2026, 10, 16, tzinfo=UTC).timestamp())

YAHOO = ["^GSPC", "^FTSE", "^GDAXI", "^N225", "^AXJO", "^STOXX50E", "GC=F", "CL=F", "^TNX", "^VIX", "SPY", "QQQ",
         "EURUSD=X", "GBPUSD=X", "JPY=X", "AUDUSD=X"]
FRED = ["SP500", "DEXUSEU", "DEXUSUK", "DEXJPUS", "DEXUSAL", "DCOILWTICO", "DGS10", "DTB3", "DFII10", "DBAA", "VIXCLS",
        "SOFR", "IUDSOIA", "IR3TIB01USM156N", "IR3TIB01GBM156N", "IR3TIB01EZM156N", "IR3TIB01JPM156N", "IR3TIB01AUM156N",
        "ECBDFR"]
DUKA_DAILY = {"USA500IDXUSD": 2012, "GBRIDXGBP": 2012, "DEUIDXEUR": 2012, "JPNIDXJPY": 2012, "XAUUSD": 2003, "LIGHTCMDUSD": 2012}
FX_PAIRS = ["EURUSD", "GBPUSD", "USDJPY", "AUDUSD"]
COT_MARKETS = {"GOLD": "088691", "WTI": "067651", "SP500_EMINI": "13874A", "UST10": "043602", "EUR": "099741", "JPY": "097741"}
LOG = []


_LAST = [0.0]


def get(url, tries=5, ua="daviesportfolios-research/1.0"):
    """A cached GET. Dukascopy answers 429 to a fast reader: its requests go one at a time, at least 1.1 s apart, and a
    429 or a dropped connection waits 20 s more each time. Its 503 means it holds no such file."""
    os.makedirs(RAW, exist_ok=True)
    path = os.path.join(RAW, hashlib.sha256(url.encode()).hexdigest()[:24])
    if os.path.exists(path):
        return 200, open(path, "rb").read()
    duka = "dukascopy" in url
    for a in range(tries):
        if duka:
            wait = _LAST[0] + 3.0 - time.time()
            if wait > 0:
                time.sleep(wait)
            _LAST[0] = time.time()
        try:
            req = urllib.request.Request(url, headers={"User-Agent": ua})
            with urllib.request.urlopen(req, timeout=60) as r:
                body = r.read()
            open(path, "wb").write(body)
            return 200, body
        except urllib.error.HTTPError as e:
            if e.code in (400, 404) or (duka and e.code == 503):
                return e.code, b""
            time.sleep(60 if duka else 1.5 * (a + 1))
        except Exception:  # noqa: BLE001
            time.sleep(60 if duka else 1.5 * (a + 1))
    return -1, b""


def logged(url, **kw):
    st, body = get(url, **kw)
    LOG.append({"url": url, "status": st, "bytes": len(body), "sha256": hashlib.sha256(body).hexdigest() if body else ""})
    return st, body


# ------------------------------------------------------------------------------------------------------------------

def yahoo(sym):
    st, body = logged(f"https://query1.finance.yahoo.com/v8/finance/chart/{sym}?period1=0&period2={NOW}&interval=1d",
                      ua="Mozilla/5.0 (X11; Linux x86_64)")
    out = {}
    if st != 200:
        return out
    r = json.loads(body)["chart"]["result"][0]
    q = r["indicators"]["quote"][0]
    for i, t in enumerate(r.get("timestamp") or []):
        d = dt.datetime.fromtimestamp(t + r["meta"].get("gmtoffset", 0), UTC).date().isoformat()
        o, c = q["open"][i], q["close"][i]
        if c is not None and c > 0:
            out[d] = (o, c)
    return out


def fred(sid):
    st, body = logged(f"https://fred.stlouisfed.org/graph/fredgraph.csv?id={sid}")
    out = {}
    if st == 200:
        for r in csv.DictReader(io.StringIO(body.decode())):
            k = list(r)
            if r[k[1]] not in ("", "."):
                out[r[k[0]]] = float(r[k[1]])
    return out


def bi5(body, factor):
    """Dukascopy candles: big-endian (seconds from the file's start, open, close, low, high as ints; volume float)."""
    if not body:
        return []
    raw = lzma.decompress(body)
    return [(t, o / factor, c / factor, lo / factor, hi / factor) for t, o, c, lo, hi, _ in struct.iter_unpack(">5if", raw)]


def duka_daily(sym, y0):
    out = {}
    for y in range(y0, 2027):
        st, body = logged(f"https://datafeed.dukascopy.com/datafeed/{sym}/{y}/BID_candles_day_1.bi5")
        if st != 200 or not body:
            continue
        base = dt.datetime(y, 1, 1, tzinfo=UTC)
        for t, o, c, lo, hi in bi5(body, 1.0):
            out[(base + dt.timedelta(seconds=t)).date().isoformat()] = c
    return out


def scale(series, ref_level):
    """Dukascopy's integer prices carry an instrument-specific factor: the power of ten that brings the median near the
    reference level (a Yahoo or FRED median over the same years)."""
    vals = sorted(v for v in series.values())
    med = vals[len(vals) // 2] if vals else 1
    best = min((10 ** k for k in range(0, 7)), key=lambda f: abs((med / f) / ref_level - 1))
    return best


# ------------------------------------------------------------------------------------------------------------------

def fomc():
    """Scheduled FOMC meetings' last (statement) day. Historical pages: "<Month> <d>[-[<Month> ]<d>] Meeting - <year>";
    the current calendar page: a month cell and a date cell per meeting. Conference calls, notation votes and meetings
    marked unscheduled are left out."""
    days = set()
    month = "(January|February|March|April|May|June|July|August|September|October|November|December)"
    for y in range(1994, 2021):
        st, body = logged(f"https://www.federalreserve.gov/monetarypolicy/fomchistorical{y}.htm", ua="Mozilla/5.0 (X11; Linux x86_64)")
        if st != 200:
            continue
        s = re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", body.decode("utf-8", "replace")))
        for m in re.finditer(month + r" (\d{1,2})(?:-(?:" + month + r" )?(\d{1,2}))? (\(unscheduled\) )?Meeting - (\d{4})", s):
            if m.group(5):
                continue
            mon, d = (m.group(3) or m.group(1)), (m.group(4) or m.group(2))
            days.add(dt.datetime.strptime(f"{mon} {d} {m.group(6)}", "%B %d %Y").date().isoformat())
        # Spanning meetings are also written "Jan/Feb 31-1 Meeting - 2017": the statement day is the second month's.
        for m in re.finditer(r"([A-Z][a-z]{2})/([A-Z][a-z]{2}) (\d{1,2})-(\d{1,2}) (\(unscheduled\) )?Meeting - (\d{4})", s):
            if not m.group(5):
                days.add(dt.datetime.strptime(f"{m.group(2)} {m.group(4)} {m.group(6)}", "%b %d %Y").date().isoformat())
    st, body = logged("https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm", ua="Mozilla/5.0 (X11; Linux x86_64)")
    if st == 200:
        h = body.decode("utf-8", "replace")
        for blk in re.finditer(r"(\d{4}) FOMC Meetings(.*?)(?=\d{4} FOMC Meetings|$)", h, re.S):
            y = int(blk.group(1))
            cells = re.findall(r'fomc-meeting__month[^>]*><strong>([^<]*)</strong>.*?fomc-meeting__date[^>]*>([^<]*)<', blk.group(2), re.S)
            for mon, d in cells:
                if "unscheduled" in d.lower() or "notation" in d.lower() or "conference" in d.lower():
                    continue
                mm = re.match(r"\s*(\d{1,2})(?:-(\d{1,2}))?", d)
                if not mm:
                    continue
                last_mon = mon.split("/")[-1].strip()
                last_day = mm.group(2) or mm.group(1)
                fmt = "%B %d %Y" if len(last_mon) > 3 else "%b %d %Y"
                try:
                    days.add(dt.datetime.strptime(f"{last_mon} {last_day} {y}", fmt).date().isoformat())
                except ValueError:
                    pass
    out = sorted(d for d in days if "1994-01-01" <= d <= "2026-10-15")
    # Two listed days a day or two apart are one decision (2003-09-15 and -16): the later is the statement day.
    return [d for i, d in enumerate(out) if not (i + 1 < len(out) and (dt.date.fromisoformat(out[i + 1]) - dt.date.fromisoformat(d)).days <= 3)]


def cot():
    rows = []
    for y in range(2003, 2027):
        st, body = logged(f"https://www.cftc.gov/files/dea/history/deacot{y}.zip", ua="Mozilla/5.0 (X11; Linux x86_64)")
        if st != 200:
            continue
        z = zipfile.ZipFile(io.BytesIO(body))
        txt = z.read(z.namelist()[0]).decode("latin-1")
        for r in csv.DictReader(io.StringIO(txt)):
            code = (r.get("CFTC Contract Market Code") or "").strip()
            for name, c in COT_MARKETS.items():
                if code == c:
                    rows.append({"market": name, "date": r["As of Date in Form YYYY-MM-DD"].strip(),
                                 "oi": r["Open Interest (All)"].strip(),
                                 "nc_long": r["Noncommercial Positions-Long (All)"].strip(),
                                 "nc_short": r["Noncommercial Positions-Short (All)"].strip()})
    return rows


def write_gz(name, text):
    with gzip.GzipFile(os.path.join(INP, name), "wb", mtime=0) as fh:
        fh.write(text.encode())


def main():
    os.makedirs(INP, exist_ok=True)
    cols = {}
    for s in YAHOO:
        y = yahoo(s)
        cols[f"Y:{s}"] = {d: v[1] for d, v in y.items()}
        if s in ("SPY", "QQQ"):
            cols[f"Y:{s}:open"] = {d: v[0] for d, v in y.items() if v[0]}
    for s in FRED:
        cols[f"F:{s}"] = fred(s)
    refs = {"USA500IDXUSD": "Y:^GSPC", "GBRIDXGBP": "Y:^FTSE", "DEUIDXEUR": "Y:^GDAXI", "JPNIDXJPY": "Y:^N225", "XAUUSD": "Y:GC=F", "LIGHTCMDUSD": "Y:CL=F"}
    for sym, y0 in DUKA_DAILY.items():
        raw = duka_daily(sym, y0)
        ref = [v for d, v in cols[refs[sym]].items() if d >= f"{y0}-01-01"]
        f = scale(raw, sorted(ref)[len(ref) // 2])
        cols[f"D:{sym}"] = {d: v / f for d, v in raw.items()}
    dates = sorted(set().union(*cols.values()))
    names = sorted(cols)
    buf = io.StringIO()
    w = csv.writer(buf, lineterminator="\n")
    w.writerow(["date"] + names)
    for d in dates:
        w.writerow([d] + [("%.8g" % cols[n][d]) if d in cols[n] else "" for n in names])
    write_gz("daily.csv.gz", buf.getvalue())

    # FX hourly (deviation 1): FXCM's public weekly H1 bid/ask files, 2012 on, at the clock times the month-end and session
    # tests read. Dukascopy throttled this machine (429 and dropped connections) after a few dozen reads.
    times = {(14, 0), (16, 0), (7, 0), (12, 0), (0, 0), (6, 0), (23, 0), (5, 0)}
    fxbuf = io.StringIO()
    w = csv.writer(fxbuf, lineterminator="\n")
    w.writerow(["pair", "t_utc", "london", "bid_open", "ask_open"])
    from concurrent.futures import ThreadPoolExecutor
    for pair in FX_PAIRS:
        urls = [f"https://candledata.fxcorporate.com/H1/{pair}/{y}/{wk}.csv.gz" for y in range(2012, 2027) for wk in range(1, 54)]
        with ThreadPoolExecutor(6) as ex:
            got = list(ex.map(get, urls))
        rows = {}
        for url, (st, body) in zip(urls, got):
            LOG.append({"url": url, "status": st, "bytes": len(body), "sha256": hashlib.sha256(body).hexdigest() if body else ""})
            if st != 200 or not body:
                continue
            raw = gzip.decompress(body)
            txt = raw.decode("utf-16") if raw[:2] in (b"\xff\xfe", b"\xfe\xff") else raw.decode()
            for ln in txt.splitlines()[1:]:
                q = ln.split(",")
                if len(q) < 9:
                    continue
                t = dt.datetime.strptime(q[0][:19], "%m/%d/%Y %H:%M:%S").replace(tzinfo=UTC)
                rows[int(t.timestamp())] = (float(q[1]), float(q[5]))
        for t in sorted(rows):
            lon = dt.datetime.fromtimestamp(t, LON)
            if (lon.hour, lon.minute) in times:
                w.writerow([pair, t, lon.strftime("%Y-%m-%d %H:%M %a"), "%.6f" % rows[t][0], "%.6f" % rows[t][1]])
    write_gz("fx_events.csv.gz", fxbuf.getvalue())

    with open(os.path.join(INP, "fomc_dates.json"), "w") as fh:
        json.dump(fomc(), fh, indent=0)
        fh.write("\n")
    cb = io.StringIO()
    w = csv.DictWriter(cb, fieldnames=["market", "date", "oi", "nc_long", "nc_short"], lineterminator="\n")
    w.writeheader()
    w.writerows(sorted(cot(), key=lambda r: (r["market"], r["date"])))
    write_gz("cot.csv.gz", cb.getvalue())
    with open(os.path.join(INP, "pull_log.json"), "w") as fh:
        json.dump(sorted(LOG, key=lambda x: x["url"]), fh, indent=0)
        fh.write("\n")
    print("files", len(LOG), "ok", sum(x["status"] == 200 for x in LOG))


if __name__ == "__main__":
    main()
