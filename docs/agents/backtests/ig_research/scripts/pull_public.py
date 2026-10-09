"""Pull the keyless public data the IG study reads (2026-10-09). Nothing here is IG's: IG serves no price history
without a key. Every source is a public market-data or statistics endpoint; no key, no signed call.

  inputs/yahoo_d/<sym>.csv.gz   Yahoo chart API, daily bars to 2026-10-09 with dividends (date,open,high,low,close,
                                adjclose,volume,div). The indices and ETFs IG's index spread bets track.
  inputs/yahoo_1h/<sym>.csv.gz  Yahoo chart API, hourly bars, the last 730 days (ES=F: the futures IG's US 500 follows
                                out of hours; the Sunday-night gap).
  inputs/cboe/<IDX>.csv.gz      CBOE's daily index histories (cdn-api.cboe.com): VIX, VIX1D, VIX9D, VIX3M and the
                                option-strategy benchmarks PUT, BXM, CNDR, WPUT.
  inputs/fred/<id>.csv.gz       FRED: SOFR, SONIA (IUDSOIA), effective fed funds (DFF), 3-month bill (DTB3).
  inputs/cboe/VX_monthly.csv.gz  CBOE's VIX futures settlements (cdn.cboe.com), every monthly contract expiring
                                2013-01 -> 2026-12, one row per (trade date, expiry): the roll a short VIX bet earns.
  inputs/fomc_dates.json        FOMC scheduled-meeting statement days 1994 ->, parsed from federalreserve.gov.
A re-run reads later data; the committed files are what the results were computed from (MANIFEST.json has each sha256).
"""
import csv, gzip, io, json, os, re, subprocess, sys, datetime as dt

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from netget import get

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
INP = os.path.join(HERE, "inputs")
END = 1791504000  # 2026-10-09 00:00 UTC
DAILY = ["^GSPC", "SPY", "^FTSE", "^GDAXI", "^NDX", "QQQ", "ES=F", "ISF.L", "^VIX"]
HOURLY = ["ES=F"]
CBOE = ["VIX", "VIX1D", "VIX9D", "VIX3M", "PUT", "BXM", "CNDR", "WPUT"]
FRED = ["SOFR", "IUDSOIA", "DFF", "DTB3", "ECBDFR"]
MONTHS = {m: i + 1 for i, m in enumerate(["january", "february", "march", "april", "may", "june", "july", "august",
                                           "september", "october", "november", "december"])}
UA = "Mozilla/5.0 (research; public market data)"


def wgz(path, text):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with gzip.GzipFile(path, "wb", mtime=0) as f:
        f.write(text.encode())


def yahoo(sym, interval, rng):
    url = (f"https://query1.finance.yahoo.com/v8/finance/chart/{sym.replace('^', '%5E')}?{rng}"
           f"&interval={interval}&events=div&includePrePost=false")
    st, body = get(url, ua=UA)
    assert st == 200, (sym, st)
    r = json.loads(body)["chart"]["result"][0]
    q = r["indicators"]["quote"][0]
    adj = (r["indicators"].get("adjclose") or [{}])[0].get("adjclose") or [None] * len(r["timestamp"])
    divs = {}
    for v in ((r.get("events") or {}).get("dividends") or {}).values():
        divs[dt.datetime.utcfromtimestamp(v["date"]).date().isoformat()] = v["amount"]
    off = r["meta"].get("gmtoffset", 0)
    out = io.StringIO()
    w = csv.writer(out, lineterminator="\n")
    w.writerow(["t", "open", "high", "low", "close", "adjclose", "volume", "div"])
    for i, t in enumerate(r["timestamp"]):
        if q["close"][i] is None:
            continue
        key = dt.datetime.utcfromtimestamp(t + off).date().isoformat() if interval == "1d" else str(t)
        w.writerow([key] + [q[k][i] for k in ("open", "high", "low", "close")] + [adj[i], q["volume"][i],
                   divs.get(dt.datetime.utcfromtimestamp(t + off).date().isoformat(), "") if interval == "1d" else ""])
    return out.getvalue(), r["meta"].get("exchangeTimezoneName")


def fomc():
    """Scheduled meetings' last day (the statement day since 1994). Unscheduled calls are left out."""
    days = []
    for y in range(1994, 2021):
        st, body = get(f"https://www.federalreserve.gov/monetarypolicy/fomchistorical{y}.htm", ua=UA)
        if st != 200:
            continue
        for h in re.findall(r"<h5[^>]*>\s*([^<]*?)\s*</h5>", body.decode("utf-8", "replace")):
            m = re.match(r"([A-Za-z]+)(?:/([A-Za-z]+))?\s+(\d+)(?:\s*-\s*(\d+))?\s+(?:\(?)Meeting", h.replace("–", "-"))
            if not m:
                continue
            mon = m.group(2) or m.group(1)
            d = int(m.group(4) or m.group(3))
            mi = next(v for k, v in MONTHS.items() if k.startswith(mon.lower()[:3]))
            days.append(dt.date(y, mi, d).isoformat())
    st, body = get("https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm", ua=UA)
    html = body.decode("utf-8", "replace")
    year = None
    for tok in re.finditer(r"(\d{4}) FOMC Meetings|fomc-meeting__month[^>]*><strong>([^<]+)</strong>|"
                           r"fomc-meeting__date[^>]*>([^<]+)<", html):
        if tok.group(1):
            year = int(tok.group(1))
        elif tok.group(2):
            mon = tok.group(2).strip().split("/")[-1].split("-")[-1]
        elif tok.group(3) and year:
            ds = re.findall(r"\d+", tok.group(3))
            if not ds or "(" in tok.group(3):
                continue  # unscheduled / notation votes carry parentheses
            mi = next((v for k, v in MONTHS.items() if k.startswith(mon.lower()[:3])), None)
            if mi:
                days.append(dt.date(year, mi, int(ds[-1])).isoformat())
    days = sorted(set(d for d in days if "1994-01-01" <= d))
    return days


def main(stages):
    logp = os.path.join(INP, "pull_log.json")
    log = json.load(open(logp)) if os.path.exists(logp) else {}
    for s in (DAILY if "yahoo" in stages else []):
        txt, tz = yahoo(s, "1d", f"period1=-2208988800&period2={END}")
        wgz(os.path.join(INP, "yahoo_d", s.replace("^", "_") + ".csv.gz"), txt)
        log[s] = {"interval": "1d", "tz": tz, "rows": txt.count("\n") - 1}
    for s in (HOURLY if "yahoo" in stages else []):
        txt, tz = yahoo(s, "1h", "range=730d")
        wgz(os.path.join(INP, "yahoo_1h", s.replace("^", "_") + ".csv.gz"), txt)
        log[s + " 1h"] = {"interval": "1h", "tz": tz, "rows": txt.count("\n") - 1}
    for c in (CBOE if "cboe" in stages else []):
        st, body = get(f"https://cdn-api.cboe.com/api/global/us_indices/daily_prices/{c}_History.csv", ua=UA)
        log["cboe " + c] = {"status": st, "bytes": len(body)}
        if st == 200:
            wgz(os.path.join(INP, "cboe", c + ".csv.gz"), body.decode())
    for f in (FRED if "fred" in stages else []):
        # FRED drops HTTP/2 streams through this machine's proxy; curl over HTTP/1.1 is served.
        r = subprocess.run(["curl", "-sS", "--http1.1", "--max-time", "120",  # FRED refuses a browser-like UA here
                            f"https://fred.stlouisfed.org/graph/fredgraph.csv?id={f}"], capture_output=True)
        log["fred " + f] = {"status": r.returncode, "bytes": len(r.stdout)}
        if r.returncode == 0 and r.stdout.startswith(b"observation_date"):
            wgz(os.path.join(INP, "fred", f + ".csv.gz"), r.stdout.decode())
    if "vx" in stages:
        st, body = get("https://www.cboe.com/us/futures/market_statistics/historical_data/product/list/VX/", ua=UA)
        lst = [c for y, cs in json.loads(body).items() for c in cs
               if c["duration_type"] == "M" and "2013-01-01" <= c["expire_date"] <= "2026-12-31"]
        rows = ["trade_date,expiry,high,low,settle,volume,open_interest"]
        for c in sorted(lst, key=lambda c: c["expire_date"]):
            st, b = get("https://cdn.cboe.com/" + c["path"], ua=UA)
            if st != 200:
                log.setdefault("vx_missing", []).append(c["expire_date"])
                continue
            for r in csv.DictReader(io.StringIO(b.decode())):
                if float(r["Settle"] or 0) > 0:
                    rows.append(f'{r["Trade Date"]},{c["expire_date"]},{r["High"]},{r["Low"]},{r["Settle"]},'
                                f'{r["Total Volume"]},{r["Open Interest"]}')
        wgz(os.path.join(INP, "cboe", "VX_monthly.csv.gz"), "\n".join(rows) + "\n")
        log["cboe VX monthly"] = {"contracts": len(lst), "rows": len(rows) - 1}
    if "fomc" not in stages:
        json.dump(log, open(logp, "w"), indent=1, sort_keys=True)
        return
    days = fomc()
    json.dump({"source": "federalreserve.gov fomchistorical{1994..2020}.htm and fomccalendars.htm, scheduled meetings",
               "days": days}, open(os.path.join(INP, "fomc_dates.json"), "w"), indent=0)
    log["fomc"] = {"n": len(days), "first": days[0], "last": days[-1]}
    json.dump(log, open(logp, "w"), indent=1, sort_keys=True)
    print(json.dumps(log, indent=1))


if __name__ == "__main__":
    # stages: yahoo cboe fred fomc (all by default); the committed inputs were pulled 2026-10-09 22:09-22:30 UTC
    main(sys.argv[1:] or ["yahoo", "cboe", "vx", "fred", "fomc"])
