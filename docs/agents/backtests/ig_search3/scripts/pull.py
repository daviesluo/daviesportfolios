"""Round 3's data, keyless, every answer's sha256 in inputs/pull_log_<part>.json. Rules: ../params/frozen.json.

  python3 -P pull.py fxcm      FXCM weekly 1-minute bid/ask, 2012 on -> inputs/fxcm_<PAIR>_weekends.csv.gz
  python3 -P pull.py hd_fx     HistData 1-minute bid bars, FX           -> inputs/hd_<PAIR>_weekends.csv.gz
  python3 -P pull.py hd_index  HistData 1-minute bars, index CFDs, WTI  -> inputs/hd_<MKT>_days.csv.gz, inputs/hd_tzcheck.json
  python3 -P pull.py small     Yahoo 1-hour bars and BLS release calendars -> inputs/yahoo_1h_<SYM>.json.gz, inputs/bls_dates.json

Raw answers are cached outside the repository (--raw DIR, default the session scratch area) and not committed; what is
committed is the derived tables above, built here so a re-run from the same bytes gives the same files.
"""
import csv, gzip, hashlib, io, json, os, re, sys, time, zipfile
import datetime as dt
import urllib.request, urllib.error, urllib.parse
from concurrent.futures import ThreadPoolExecutor
from zoneinfo import ZoneInfo

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
INP = os.path.join(HERE, "inputs")
BT = os.path.dirname(HERE)
RAW = sys.argv[sys.argv.index("--raw") + 1] if "--raw" in sys.argv else \
    "/tmp/claude-0/-home-user-daviesportfolios/66f2e96b-1f9a-594f-8046-5bffba951be8/scratchpad/ig_search3_raw"
UTC = dt.timezone.utc
EST = dt.timezone(dt.timedelta(hours=-5))          # what HistData's FAQ says its stamps are (no daylight saving) ...
# ... but they are New York local time: deviation 2 in ../params/frozen.json (US 500's last half hour against SPY's on
# summer days correlates 0.998 read as New York time, 0.05 read as fixed EST, 2024-2025)
HD_TZ = ZoneInfo("America/New_York")
NY, BER, LON = ZoneInfo("America/New_York"), ZoneInfo("Europe/Berlin"), ZoneInfo("Europe/London")
UA = "daviesportfolios-research/1.0 (public market data)"
FX_PAIRS = ["AUDUSD", "EURUSD", "GBPUSD", "USDJPY", "NZDUSD", "AUDJPY", "NZDJPY", "AUDNZD", "EURAUD", "EURJPY", "GBPJPY",
            "USDCAD", "USDCHF", "EURGBP"]
HD_INDEX = {"US500": "SPXUSD", "USTECH": "NSXUSD", "DE40": "GRXEUR", "UK100": "UKXGBP", "WTI": "WTIUSD"}
HD_MONTHS_2026 = range(1, 10)
LOG = []


def write_gz(name, text):
    open(os.path.join(INP, name), "wb").write(gzip.compress(text.encode(), mtime=0))


def http(url, data=None, headers=None, tries=4, timeout=90):
    for a in range(tries):
        try:
            req = urllib.request.Request(url, data=data, headers={"User-Agent": UA, **(headers or {})})
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return 200, r.read()
        except urllib.error.HTTPError as e:
            if e.code in (400, 403, 404):
                return e.code, b""
            time.sleep(3 * (a + 1))
        except Exception:  # noqa: BLE001
            time.sleep(3 * (a + 1))
    return -1, b""


def cached(key, fetch):
    os.makedirs(RAW, exist_ok=True)
    path = os.path.join(RAW, hashlib.sha256(key.encode()).hexdigest()[:24])
    if os.path.exists(path):
        body = open(path, "rb").read()
        return 200, body
    st, body = fetch()
    if st == 200 and body:
        open(path, "wb").write(body)
    return st, body


def logged(key, fetch):
    st, body = cached(key, fetch)
    LOG.append({"url": key, "status": st, "bytes": len(body), "sha256": hashlib.sha256(body).hexdigest() if body else ""})
    return st, body


def save_log(part):
    LOG.sort(key=lambda r: r["url"])
    json.dump(LOG, open(os.path.join(INP, f"pull_log_{part}.json"), "w"), indent=0, sort_keys=True)
    ok = sum(1 for r in LOG if r["status"] == 200)
    print(part, ok, "of", len(LOG), "answered 200", file=sys.stderr)


# ---------------------------------------------------------------------------------------------------------------- FXCM

def fxcm_file(pair, year, week):
    """One weekly file reduced to what FXW needs: its first minute and the next 24 h, its last minute. Raw not kept."""
    url = f"https://candledata.fxcorporate.com/m1/{pair}/{year}/{week}.csv.gz"
    side = os.path.join(RAW, "fxcm_red", f"{pair}_{year}_{week}.json.gz")
    if os.path.exists(side):
        try:
            return json.loads(gzip.decompress(open(side, "rb").read()))
        except (EOFError, OSError, ValueError):  # a reduction cut short when a run was stopped: read the file again
            os.remove(side)
    for attempt in range(3):  # a transfer cut short is read again, twice at most, then logged, not guessed at
        st, body = http(url, timeout=60)
        out = {"url": url, "status": st, "sha256": hashlib.sha256(body).hexdigest() if body else "", "rows": None}
        if st != 200 or not body:
            break
        try:
            raw = gzip.decompress(body)
            break
        except (EOFError, OSError) as e:
            out["status"] = f"truncated {e.__class__.__name__}"
    if out["status"] != 200:
        return out
    if st == 200 and body:
        txt = raw.decode("utf-16") if raw[:2] in (b"\xff\xfe", b"\xfe\xff") else raw.decode()
        rows = []
        for ln in txt.splitlines()[1:]:
            p = ln.split(",")
            if len(p) < 9:
                continue
            t = dt.datetime.strptime(p[0][:19], "%m/%d/%Y %H:%M:%S").replace(tzinfo=UTC)
            rows.append([int(t.timestamp())] + [float(v) for v in p[1:9]])
        rows.sort()
        if rows:
            t0 = rows[0][0]
            # the first 24 h as [ts, mid close, mid high, mid low]: all FXW's path needs
            out["rows"] = {"first": rows[0], "last": rows[-1],
                           "day": [[r[0], (r[4] + r[8]) / 2, (r[2] + r[6]) / 2, (r[3] + r[7]) / 2]
                                   for r in rows if r[0] < t0 + 24 * 3600 + 60]}
    os.makedirs(os.path.dirname(side), exist_ok=True)
    if st in (200, 404):
        open(side, "wb").write(gzip.compress(json.dumps(out).encode(), mtime=0))
    return out


def fxcm():
    head = "fri_utc,fri_bid,fri_ask,sun_utc,sun_bid_open,sun_ask_open,mid_1h,mid_4h,mid_24h,fill_min,hi_24h,lo_24h,hi_to_exit,lo_to_exit\n"
    for pair in FX_PAIRS:
        jobs = [(pair, y, w) for y in range(2012, 2027) for w in range(1, 54)]
        with ThreadPoolExecutor(12) as ex:
            files = list(ex.map(lambda a: fxcm_file(*a), jobs))
        for f in files:
            LOG.append({"url": f["url"], "status": f["status"], "sha256": f["sha256"]})
        weeks = sorted((f["rows"] for f in files if f["rows"]), key=lambda r: r["first"][0])
        buf = io.StringIO()
        buf.write(head)
        for a, b in zip(weeks, weeks[1:]):
            fl, s = a["last"], b["first"]
            if s[0] - fl[0] < 24 * 3600:
                continue
            fri_mid = (fl[4] + fl[8]) / 2
            sun_mid = (s[1] + s[5]) / 2
            day = b["day"]
            def at(sec):
                v = None
                for r in day:
                    if r[0] <= s[0] + sec:
                        v = r[1]
                return v
            fill, hi, lo = "", -1e9, 1e9
            hx, lx = -1e9, 1e9
            for r in day:
                if r[0] >= s[0] + 24 * 3600:
                    break
                mh, ml = r[2], r[3]
                hi, lo = max(hi, mh), min(lo, ml)
                if fill == "":
                    hx, lx = max(hx, mh), min(lx, ml)
                    if (sun_mid > fri_mid and ml <= fri_mid) or (sun_mid < fri_mid and mh >= fri_mid):
                        fill = (r[0] - s[0]) // 60
            buf.write(f"{fl[0]},{fl[4]},{fl[8]},{s[0]},{s[1]},{s[5]},{at(3600)},{at(4*3600)},{at(24*3600)},{fill},"
                      f"{hi},{lo},{hx},{lx}\n")
        write_gz(f"fxcm_{pair}_weekends.csv.gz", buf.getvalue())
        print(pair, len(weeks), "weeks", file=sys.stderr)
    save_log("fxcm")


# ------------------------------------------------------------------------------------------------------------ HistData

_LAST = [0.0]


def hd_zip(sym, year, month=None):
    page = f"https://www.histdata.com/download-free-forex-historical-data/?/ascii/1-minute-bar-quotes/{sym.lower()}/{year}"
    if month:
        page += f"/{month}"
    key = f"histdata:{sym}:{year}:{month or ''}"

    def fetch():
        for a in range(4):
            wait = _LAST[0] + 2.0 - time.time()
            if wait > 0:
                time.sleep(wait)
            _LAST[0] = time.time()
            st, html = http(page, headers={"User-Agent": "Mozilla/5.0"})
            m = re.search(rb'name="tk" id="tk" value="([0-9a-f]+)"', html or b"")
            if not m:
                time.sleep(10)
                continue
            form = {"tk": m.group(1).decode(), "date": str(year), "datemonth": f"{year}{month:02d}" if month else str(year),
                    "platform": "ASCII", "timeframe": "M1", "fxpair": sym}
            time.sleep(1.0)
            st, body = http("https://www.histdata.com/get.php", data=urllib.parse.urlencode(form).encode(),
                            headers={"User-Agent": "Mozilla/5.0", "Referer": page})
            if st == 200 and body[:2] == b"PK":
                return 200, body
            time.sleep(10)
        return -1, b""
    return logged(key, fetch)


def hd_bars(sym, years):
    """Every 1-minute bar of `sym` for `years` as (utc_ts, o, h, l, c), sorted. Stamps are bar starts in EST (UTC-5)."""
    out = {}
    for y in years:
        parts = [(y, m) for m in HD_MONTHS_2026] if y == 2026 else [(y, None)]
        for yy, mm in parts:
            st, body = hd_zip(sym, yy, mm)
            if st != 200:
                continue
            z = zipfile.ZipFile(io.BytesIO(body))
            for name in z.namelist():
                if not name.endswith(".csv"):
                    continue
                for ln in z.read(name).decode().splitlines():
                    p = ln.split(";")
                    if len(p) < 5:
                        continue
                    t = dt.datetime.strptime(p[0], "%Y%m%d %H%M%S").replace(tzinfo=HD_TZ)
                    out[int(t.timestamp())] = tuple(float(v) for v in p[1:5])
    ts = sorted(out)
    return [(t,) + out[t] for t in ts]


def hd_fx():
    head = "fri_utc,fri_bid,sun_utc,sun_bid_open,bid_24h,fill_min,hi_24h,lo_24h,hi_to_exit,lo_to_exit\n"
    for pair in FX_PAIRS:
        bars = hd_bars(pair, range(2012, 2027))
        buf = io.StringIO()
        buf.write(head)
        n = 0
        for i in range(1, len(bars)):
            if bars[i][0] - bars[i - 1][0] < 24 * 3600:
                continue
            f, s = bars[i - 1], bars[i]
            fri, sun = f[4], s[1]
            fill, hi, lo, hx, lx, last = "", -1e9, 1e9, -1e9, 1e9, None
            j = i
            while j < len(bars) and bars[j][0] < s[0] + 24 * 3600:
                r = bars[j]
                hi, lo, last = max(hi, r[2]), min(lo, r[3]), r[4]
                if fill == "":
                    hx, lx = max(hx, r[2]), min(lx, r[3])
                    if (sun > fri and r[3] <= fri) or (sun < fri and r[2] >= fri):
                        fill = (r[0] - s[0]) // 60
                j += 1
            buf.write(f"{f[0]},{fri},{s[0]},{sun},{last},{fill},{hi},{lo},{hx},{lx}\n")
            n += 1
        write_gz(f"hd_{pair}_weekends.csv.gz", buf.getvalue())
        print(pair, len(bars), "bars", n, "weekends", file=sys.stderr)
    save_log("hd_fx")


SESS = {"US500": (NY, (9, 30), (16, 0)), "USTECH": (NY, (9, 30), (16, 0)), "DE40": (BER, (9, 0), (17, 30)),
        "UK100": (LON, (8, 0), (16, 30)), "WTI": (NY, (9, 30), (16, 0))}
TIMES = {"US500": ["08:30", "09:30", "10:00", "12:25", "12:30", "12:35", "13:55", "14:00", "14:05", "14:10", "14:15",
                   "14:20", "15:30", "16:00"],
         "DE40": ["09:00", "09:30", "17:00", "17:30"], "UK100": ["08:00", "08:30", "16:00", "16:30"],
         "WTI": ["10:30", "10:35", "14:30"]}
TIMES["USTECH"] = TIMES["US500"]


def calendar(mkt):
    col = {"US500": "Y:^GSPC", "USTECH": "Y:^GSPC", "WTI": "Y:^GSPC", "DE40": "Y:^GDAXI", "UK100": "Y:^FTSE"}[mkt]
    days = set()
    with gzip.open(os.path.join(BT, "ig_search", "inputs", "daily.csv.gz"), "rt") as fh:
        for r in csv.DictReader(fh):
            if r[col]:
                days.add(r["date"])
    return days, max(days)


def hd_index():
    tz_out = {}
    for mkt, sym in HD_INDEX.items():
        bars = hd_bars(sym, range(2010, 2027))
        tz, (oh, om), (ch, cm) = SESS[mkt]
        cal, cal_end = calendar(mkt)
        by_day = {}
        for b in bars:
            d = dt.datetime.fromtimestamp(b[0], UTC).astimezone(tz).date()
            by_day.setdefault(d, []).append(b)
        # time-zone check: mean |1-minute log return| by local minute of the day, 2010 on
        acc = {}
        prev = None
        for b in bars:
            if prev and b[0] - prev[0] == 60:
                lt = dt.datetime.fromtimestamp(b[0], UTC).astimezone(tz)
                k = lt.hour * 60 + lt.minute
                s, n = acc.get(k, (0.0, 0))
                acc[k] = (s + abs(b[4] / prev[4] - 1), n + 1)
            prev = b
        prof = {k: s / n for k, (s, n) in acc.items() if n >= 500}
        top = sorted(prof, key=lambda k: -prof[k])[:5]
        tz_out[mkt] = {"top5_local_minutes": [f"{k // 60:02d}:{k % 60:02d}" for k in top],
                       "cash_open": f"{oh:02d}:{om:02d}", "bars": len(bars), "by_year_season": {}}
        # deviation 2: the same check for each year, summer (April-October) and winter apart
        acc2 = {}
        prev = None
        for b in bars:
            if prev and b[0] - prev[0] == 60:
                lt = dt.datetime.fromtimestamp(b[0], UTC).astimezone(tz)
                key = (lt.year, "summer" if 4 <= lt.month <= 10 else "winter")
                k = lt.hour * 60 + lt.minute
                s, n = acc2.setdefault(key, {}).get(k, (0.0, 0))
                acc2[key][k] = (s + abs(b[4] / prev[4] - 1), n + 1)
            prev = b
        for key in sorted(acc2):
            prof2 = {k: s / n for k, (s, n) in acc2[key].items() if n >= 30}
            if prof2:
                k = max(prof2, key=lambda k: prof2[k])
                tz_out[mkt]["by_year_season"][f"{key[0]}-{key[1]}"] = f"{k // 60:02d}:{k % 60:02d}"
        fields = ["date", "dow", "cash_bars", "last_hour_bars"] + [f"p{t.replace(':', '')}" for t in TIMES[mkt]] + \
                 ["p_open", "p_close", "orb_hi", "orb_lo", "orb_dir", "orb_entry", "orb_entry_min", "orb_exit", "orb_stopped",
                  "gap_touch_up", "gap_touch_up_min", "gap_touch_dn", "gap_touch_dn_min", "day_hi", "day_lo"]
        buf = io.StringIO()
        w = csv.writer(buf, lineterminator="\n")
        w.writerow(fields)
        prev_close = None
        for d in sorted(by_day):
            if d.weekday() >= 5:
                continue
            if d.isoformat() <= cal_end and d.isoformat() not in cal:
                continue
            day = by_day[d]
            o_t = int(dt.datetime(d.year, d.month, d.day, oh, om, tzinfo=tz).timestamp())
            c_t = int(dt.datetime(d.year, d.month, d.day, ch, cm, tzinfo=tz).timestamp())
            cash = [b for b in day if o_t <= b[0] < c_t]
            if len(cash) < 0.75 * (c_t - o_t) / 60:
                continue
            last_hour = sum(1 for b in cash if b[0] >= c_t - 3600)

            def price_at(t):
                v = None
                for b in day:
                    if t - 300 <= b[0] <= t - 60:
                        v = b[4]
                return v
            pts = []
            for s in TIMES[mkt]:
                hh, mm = map(int, s.split(":"))
                pts.append(price_at(int(dt.datetime(d.year, d.month, d.day, hh, mm, tzinfo=tz).timestamp())))
            p_open, p_close = price_at(o_t), price_at(c_t)
            # ORB30
            rng = [b for b in cash if b[0] < o_t + 1800]
            orb = ["", "", "", "", "", "", ""]
            if len(rng) >= 20:
                hi, lo = max(b[2] for b in rng), min(b[3] for b in rng)
                orb = [hi, lo, "", "", "", "", ""]
                after = [b for b in cash if b[0] >= o_t + 1800]
                for k, b in enumerate(after):
                    if b[0] >= c_t - 300:
                        break
                    if b[4] > hi or b[4] < lo:
                        dr = 1 if b[4] > hi else -1
                        exit_px, stopped = p_close, 0
                        for b2 in after[k + 1:]:
                            if dr == 1 and b2[3] <= lo:
                                exit_px, stopped = min(lo, b2[1]), 1
                                break
                            if dr == -1 and b2[2] >= hi:
                                exit_px, stopped = max(hi, b2[1]), 1
                                break
                        orb = [hi, lo, dr, b[4], (b[0] + 60 - o_t) // 60, exit_px, stopped]
                        break
            # gap target touches against yesterday's cash close (both directions recorded)
            tu = td = ""
            tum = tdm = ""
            if prev_close is not None:
                for b in cash:
                    if tu == "" and b[2] >= prev_close:
                        tu, tum = 1, (b[0] - o_t) // 60
                    if td == "" and b[3] <= prev_close:
                        td, tdm = 1, (b[0] - o_t) // 60
            row = [d.isoformat(), d.weekday(), len(cash), last_hour] + ["" if v is None else v for v in pts] + \
                  ["" if p_open is None else p_open, "" if p_close is None else p_close] + orb + [tu, tum, td, tdm,
                  max(b[2] for b in cash), min(b[3] for b in cash)]
            w.writerow(row)
            if p_close is not None:
                prev_close = p_close
        write_gz(f"hd_{mkt}_days.csv.gz", buf.getvalue())
        print(mkt, len(bars), "bars", file=sys.stderr)
    json.dump(tz_out, open(os.path.join(INP, "hd_tzcheck.json"), "w"), indent=1, sort_keys=True)
    save_log("hd_index")


# --------------------------------------------------------------------------------------------------------------- small

def small():
    for sym in ["SPY", "QQQ", "DIA", "^GDAXI", "^FTSE", "CL=F", "ES=F", "NQ=F", "YM=F"]:
        url = f"https://query1.finance.yahoo.com/v8/finance/chart/{urllib.parse.quote(sym)}?range=730d&interval=1h&includePrePost=false"
        st, body = logged(url, lambda: http(url, headers={"User-Agent": "Mozilla/5.0 (X11; Linux x86_64)"}))
        if st == 200:
            safe = sym.replace("^", "").replace("=", "_")
            open(os.path.join(INP, f"yahoo_1h_{safe}.json.gz"), "wb").write(gzip.compress(body, mtime=0))
    dates = {"Employment Situation": [], "Consumer Price Index": []}
    for y in range(2010, 2027):
        url = f"https://www.bls.gov/schedule/{y}/home.htm"
        st, body = logged(url, lambda: http(url))
        if st != 200:
            continue
        txt = re.sub(r"\s+", " ", re.sub(r"<[^>]+>", "|", body.decode("utf-8", "replace")))
        for m in re.finditer(r"\|(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday), ([A-Za-z]+) (\d{1,2}), (\d{4})\|"
                             r"[| ]*(?:&nbsp;)?[| ]*(\d{2}:\d{2} [AP]M)?[| ]*\|*([^|]+)\|", txt):
            name = m.group(6).strip()
            if name in dates:
                d = dt.datetime.strptime(f"{m.group(2)} {m.group(3)} {m.group(4)}", "%B %d %Y").date().isoformat()
                dates[name].append({"date": d, "time": m.group(5)})
    for k in dates:
        seen, uniq = set(), []
        for r in sorted(dates[k], key=lambda r: r["date"]):
            if r["date"] not in seen:
                seen.add(r["date"])
                uniq.append(r)
        dates[k] = uniq
    json.dump(dates, open(os.path.join(INP, "bls_dates.json"), "w"), indent=0, sort_keys=True)
    print({k: len(v) for k, v in dates.items()}, file=sys.stderr)
    save_log("small")


if __name__ == "__main__":
    os.makedirs(INP, exist_ok=True)
    {"fxcm": fxcm, "hd_fx": hd_fx, "hd_index": hd_index, "small": small}[sys.argv[1]]()
