"""The exact scheduled-release calendar for the Coinbase blackout (docs/agents/reviews/2026-10-15-coinbase-blackout.md, §1):
US CPI and Employment Situation (NFP) at 08:30 New York, FOMC statements 14:00 New York, ECB monetary-policy decisions 14:15
Frankfurt, BoE MPC announcements 12:00 London, from 2024-10-01 to 2026-12-31, every instant in UTC through `zoneinfo` (DST as it
was). Writes ../inputs/release_calendar.json (each event with its source, status and the market check, and the log of every URL
tried, with the answer) and ../inputs/events.json (the study's input, same shape as before plus `source`).

WHERE EACH COMES FROM, by what answered from this container on 2026-10-15:
* FOMC: federalreserve.gov/monetarypolicy/fomccalendars.htm (2024 to 2027; the statement is the second day of a meeting, "Apr/May 30-1"
  is 1 May; a notation vote is not a meeting). FIRST-PARTY.
* ECB: the date inside the press-release URL of every monetary-policy decision (`ecb.mpYYMMDD~…`), from
  ecb.europa.eu/press/govcdec/mopo/<year>/html/index_include.en.html for 2024, 2025 and 2026, and the Governing Council calendar
  (ecb.europa.eu/press/calendars/mgcgc/html/index.en.html) for the meetings still to come. FIRST-PARTY.
* BoE: the publication date of each "Monetary policy summary and minutes" page (bankofengland.co.uk/monetary-policy-summary-and-minutes/
  <year>/<month>-<year>) for what has happened, and bankofengland.co.uk/monetary-policy/upcoming-mpc-dates for 2026 and 2027. FIRST-PARTY.
* US CPI and NFP: **bls.gov REFUSED** (HTTP 403 "Access Denied" from the site's own edge on www.bls.gov, download.bls.gov and stats.bls.gov, for the
  schedule pages, the .ics files and the news-release pages; data.bls.gov redirects its schedule URLs to www.bls.gov; api.bls.gov and
  data.bls.gov answer but carry no release dates). FRED/ALFRED (fred.stlouisfed.org, alfred.stlouisfed.org) did not connect from this container,
  api.stlouisfed.org answers but wants a registration key, web.archive.org's tunnel was reset. So the CPI and NFP dates are NOT from the
  source: they are the published schedule as recalled (the lists below), and every one is CHECKED two ways here: the market's own move at 08:30
  New York (against the same clock minutes of the ten weekdays either side), and, for NFP, BLS's published rule (the third Friday after the
  end of the reference week, the week with the 12th). A date that fails either is listed under `disagreements`, not dropped or altered
  without saying so. The October-2026 NFP (6 Nov) is also on tradingeconomics.com's calendar (not a first party) and so is the CPI of 14 Oct.
* Yahoo Finance (the site's own data source, the one the fundamentals function reads with the fc.yahoo.com cookie and the getcrumb flow):
  `query1.finance.yahoo.com/ws/screeners/v1/finance/calendar-events?modules=economicEvents`, a cross-check of every release inside its
  coverage (dense only from about late September to early November 2026; 2024, 2025 and December 2026 come back empty), to the minute.
  From this container the crumb answered 429 (Too Many Requests) on every try on 2026-10-15, so the live pull is logged as refused; the
  script reads ../inputs/yahoo_calendar.json instead when it exists (the raw records of a pull made elsewhere, e.g. from the deployed
  function's network), and says which it used.
usage: python3 -I release_calendar.py  (needs outbound HTTPS to the sites above; about 2 minutes)  -> ../inputs/release_calendar.json, ../inputs/events.json
"""
import calendar, datetime, gzip, html as htmllib, json, os, re, subprocess, sys
import zoneinfo

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, os.path.normpath(os.path.join(ROOT, "..", "scq_venues", "scripts")))
NY, LON, FRA = (zoneinfo.ZoneInfo(z) for z in ("America/New_York", "Europe/London", "Europe/Berlin"))
UTC = datetime.timezone.utc
UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120 Safari/537.36"
M = 60000
LO, HI = "2024-10-01", "2026-12-31"
LOG = []
MONTHS = {m.lower(): i for i, m in enumerate(calendar.month_name) if m}
MONTHS.update({m.lower(): i for i, m in enumerate(calendar.month_abbr) if m})

# US CPI and the Employment Situation as the published schedule is recalled (bls.gov refused), 2025's shutdown delays included; the last
# three of each are the schedule for after 2026-10-15 as recalled (CPI 10 Nov and 10 Dec, NFP 6 Nov and 4 Dec) and are confirmed by nothing here
# but the rule (NFP) and tradingeconomics' calendar (NFP 6 Nov).
CPI = """2024-10-10 2024-11-13 2024-12-11 2025-01-15 2025-02-12 2025-03-12 2025-04-10 2025-05-13 2025-06-11 2025-07-15 2025-08-12
2025-09-11 2025-10-24 2025-12-18 2026-01-13 2026-02-13 2026-03-11 2026-04-10 2026-05-12 2026-06-10 2026-07-14 2026-08-12 2026-09-11
2026-10-14 2026-11-10 2026-12-10""".split()
NFP = """2024-10-04 2024-11-01 2024-12-06 2025-01-10 2025-02-07 2025-03-07 2025-04-04 2025-05-02 2025-06-06 2025-07-03 2025-08-01
2025-09-05 2025-11-20 2025-12-16 2026-01-09 2026-02-11 2026-03-06 2026-04-03 2026-05-08 2026-06-05 2026-07-02 2026-08-07 2026-09-04 2026-10-02
2026-11-06 2026-12-04""".split()
# the first-party lists above must agree with what this machine recalled before it could fetch them; kept to report any disagreement
RECALLED = {
    "fomc": "2024-11-07 2024-12-18 2025-01-29 2025-03-19 2025-05-07 2025-06-18 2025-07-30 2025-09-17 2025-10-29 2025-12-10 2026-01-28 2026-03-18 2026-04-29 2026-06-17 2026-07-29 2026-09-16".split(),
    "ecb": "2024-10-17 2024-12-12 2025-01-30 2025-03-06 2025-04-17 2025-06-05 2025-07-24 2025-09-11 2025-10-30 2025-12-18 2026-02-05 2026-03-19 2026-04-30 2026-06-11 2026-07-23 2026-09-10".split(),
    "boe": "2024-11-07 2024-12-19 2025-02-06 2025-03-20 2025-05-08 2025-06-19 2025-08-07 2025-09-18 2025-11-06 2025-12-18 2026-02-05 2026-03-19 2026-04-30 2026-06-18 2026-07-30 2026-09-17".split(),
}
SPEC = {"cpi": (NY, (8, 30)), "nfp": (NY, (8, 30)), "fomc": (NY, (14, 0)), "ecb": (FRA, (14, 15)), "boe": (LON, (12, 0))}


def instant(day, tz, hm):
    y, m, d = map(int, day.split("-"))
    return int(datetime.datetime(y, m, d, hm[0], hm[1], tzinfo=tz).astimezone(UTC).timestamp() * 1000)


def get(url, purpose, binary=False):
    r = subprocess.run(["curl", "-sS", "-m", "60", "-A", UA, "-w", "\n%{http_code}", url], capture_output=True, text=True, errors="replace")
    body, _, code = r.stdout.rpartition("\n")
    LOG.append({"url": url, "http": code if code.isdigit() else r.stderr.strip()[:80], "bytes": len(body), "for": purpose})
    return body if code == "200" else None


def text(html):
    t = re.sub(r"<script.*?</script>|<style.*?</style>", " ", html, flags=re.S)
    return re.sub(r"\s+", " ", htmllib.unescape(re.sub(r"<[^>]+>", " ", t)))


def probe_refused():
    """What bls.gov, FRED and the archive answered: logged, never worked around."""
    for u, why in (("https://www.bls.gov/schedule/news_release/cpi.htm", "CPI release schedule"), ("https://www.bls.gov/schedule/news_release/empsit.htm", "Employment Situation schedule"),
                   ("https://www.bls.gov/schedule/news_release/bls.ics", "BLS iCal feed"), ("https://www.bls.gov/schedule/news_release/cpi.ics", "CPI iCal feed"),
                   ("https://download.bls.gov/pub/time.series/cu/", "BLS flat files"), ("https://stats.bls.gov/schedule/news_release/cpi.htm", "BLS schedule, stats host"),
                   ("https://data.bls.gov/schedule/news_release/cpi.htm", "BLS schedule, data host (redirects)"), ("https://api.bls.gov/publicAPI/v2/surveys", "BLS API (no release dates in it)"),
                   ("https://fred.stlouisfed.org/release/dates?rid=10", "FRED release dates, CPI (rid 10)"), ("https://fred.stlouisfed.org/release/dates?rid=50", "FRED release dates, Employment Situation (rid 50)"),
                   ("https://alfred.stlouisfed.org/release/downloaddates?rid=10", "ALFRED release dates"),
                   ("https://api.stlouisfed.org/fred/release/dates?release_id=10&file_type=json", "FRED API (needs a registration key)"),
                   ("https://web.archive.org/web/2025/https://www.bls.gov/schedule/news_release/cpi.htm", "Wayback copy of the BLS schedule")):
        get(u, why)


def fomc():
    html = get("https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm", "FOMC meetings 2024 to 2027")
    t = text(html)
    out = []
    for y in (2024, 2025, 2026):
        a = t.find(f"{y} FOMC Meetings")
        b = t.find("FOMC Meetings", a + 20)
        seg = t[a:b if b > 0 else a + 4000]
        for m in re.finditer(r"((?:[A-Z][a-z]+/)?[A-Z][a-z]+) (\d{1,2})-(\d{1,2})\*?", seg):
            mon = m.group(1).split("/")[-1].lower()
            out.append(f"{y}-{MONTHS[mon]:02d}-{int(m.group(3)):02d}")
    return sorted(set(out))


def ecb():
    days = set()
    for y in (2024, 2025, 2026):
        html = get(f"https://www.ecb.europa.eu/press/govcdec/mopo/{y}/html/index_include.en.html", f"ECB monetary policy decisions {y}")
        for m in re.finditer(r"ecb\.mp(\d{2})(\d{2})(\d{2})~", html or ""):
            days.add(f"20{m.group(1)}-{m.group(2)}-{m.group(3)}")
    html = get("https://www.ecb.europa.eu/press/calendars/mgcgc/html/index.en.html", "ECB Governing Council calendar (meetings to come)")
    t = text(html or "")
    for m in re.finditer(r"(\d{2})/(\d{2})/(\d{4}) Governing Council of the ECB: monetary policy meeting in Frankfurt \(Day 2\)", t):
        days.add(f"{m.group(3)}-{m.group(2)}-{m.group(1)}")
    return sorted(d for d in days if LO <= d <= HI)


def boe():
    days = set()
    for y, mo in (("2024", "november"), ("2024", "december"), ("2025", "february"), ("2025", "march"), ("2025", "may"), ("2025", "june"), ("2025", "august"), ("2025", "september"),
                  ("2025", "november"), ("2025", "december"), ("2026", "february"), ("2026", "march"), ("2026", "april"), ("2026", "june"), ("2026", "july"), ("2026", "september")):
        t = text(get(f"https://www.bankofengland.co.uk/monetary-policy-summary-and-minutes/{y}/{mo}-{y}", f"BoE MPC summary and minutes, {mo} {y}") or "")
        m = re.search(r"(?i)published on (\d{1,2}) (\w+) (\d{4})", t) or re.search(r"(\d{1,2}) (January|February|March|April|May|June|July|August|September|October|November|December) (\d{4})", t)
        if m:
            days.add(f"{m.group(3)}-{MONTHS[m.group(2).lower()]:02d}-{int(m.group(1)):02d}")
    t = text(get("https://www.bankofengland.co.uk/monetary-policy/upcoming-mpc-dates", "BoE MPC dates for 2026 and 2027") or "")
    a = t.find("2026 confirmed dates")
    b = t.find("2027", a + 30)
    for m in re.finditer(r"Thursday (\d{1,2}) (\w+)", t[a:b if b > 0 else a + 1500]):
        days.add(f"2026-{MONTHS[m.group(2).lower()]:02d}-{int(m.group(1)):02d}")
    return sorted(d for d in days if LO <= d <= HI)


def nfp_rule(year, month):
    """BLS's rule for the Employment Situation: the third Friday after the end of the reference week (the Sunday-Saturday week with the 12th)."""
    d12 = datetime.date(year, month, 12)
    end = d12 + datetime.timedelta(days=(5 - d12.weekday()) % 7 if d12.weekday() != 6 else 6)   # the Saturday that ends the week holding the 12th
    fr = end + datetime.timedelta(days=(4 - end.weekday()) % 7 or 7)
    return (fr + datetime.timedelta(days=14)).isoformat()


def market_check(evs):
    """The largest 1-minute |rate move| within +-2 minutes of each instant (EUR/USD; GBP/USD for the BoE; after the screen's series ends, the exchange-implied EUR/USD) against the same
    clock minutes of the ten weekdays either side."""
    import sv_sim as S
    t, v = S.SI.load_eurusd()
    ser, last = dict(zip(t, v)), t[-1]
    gt, gv = S.CI.load_fx()
    gser = dict(zip(gt, gv))
    d = json.load(gzip.open(os.path.join(ROOT, "inputs", "cb_implied_eurusd.json.gz"), "rt"))
    imp = {d["t0"] + i * M: u / e for i, (u, e) in enumerate(zip(d["usd"], d["eur"])) if u is not None and e is not None}

    def move(at, kind):
        best = 0.0
        for k in range(-2, 3):
            if kind == "boe":
                a, b = gser.get(at + k * M), gser.get(at + (k - 1) * M)
            elif at > last:
                a = imp.get(at + k * M)
                b = next((imp[at + (k - j) * M] for j in range(1, 4) if (at + (k - j) * M) in imp), None)
            else:
                a, b = ser.get(at + k * M), ser.get(at + (k - 1) * M)
            if a is not None and b is not None:
                best = max(best, abs(a / b - 1) * 1e4)
        return best

    now = int(datetime.datetime(2026, 10, 15, tzinfo=UTC).timestamp() * 1000)
    for e in evs:
        if e["t"] >= now:
            e.update(move_bps=None, control_p90_bps=None, stands_out=None)
            continue
        m = move(e["t"], e["kind"])
        dt = datetime.datetime.fromtimestamp(e["t"] / 1000, UTC)
        ctrl = [move(int((dt + datetime.timedelta(days=o)).timestamp() * 1000), e["kind"]) for o in list(range(-14, -3)) + list(range(4, 15)) if (dt + datetime.timedelta(days=o)).weekday() < 5]
        ctrl = sorted(x for x in ctrl if x > 0) or [0.0]
        p90 = ctrl[int(0.9 * (len(ctrl) - 1))]
        e.update(move_bps=round(m, 2), control_p90_bps=round(p90, 2), stands_out=bool(m > p90))
    return evs


def unexplained_spikes(known_days, top=25):
    """08:30 New York minutes (weekdays) with a large EUR/USD move on a day that is NOT in the CPI/NFP list: another 08:30 release (PPI, retail sales,
    GDP, claims) or a missing CPI/NFP date. Informational."""
    import sv_sim as S
    t, v = S.SI.load_eurusd()
    ser = dict(zip(t, v))
    out = []
    day = datetime.date.fromisoformat(LO)
    while day <= datetime.date(2026, 10, 8):
        if day.weekday() < 5 and day.isoformat() not in known_days:
            at = instant(day.isoformat(), NY, (8, 30))
            m = max((abs(ser[at + k * M] / ser[at + (k - 1) * M] - 1) * 1e4 for k in range(-2, 3) if (at + k * M) in ser and (at + (k - 1) * M) in ser), default=0)
            out.append((round(m, 1), day.isoformat()))
        day += datetime.timedelta(days=1)
    return sorted(out, reverse=True)[:top]


YAHOO_MATCH = {                      # our kind -> (Yahoo country codes, regex on its `event`)
    "cpi": ({"US"}, r"\bCPI\b"), "nfp": ({"US"}, r"non[- ]?farm payrolls"), "fomc": ({"US"}, r"fed funds|fomc"),
    "ecb": ({"EU", "DE", "EZ", "EA"}, r"\bECB\b.*(rate|decision)|deposit"), "boe": ({"GB", "UK"}, r"\bBoE\b|bank rate|boe interest"),
}


def _records(node, out):
    """Every dict carrying `eventTime` and `event`, wherever the answer nests them."""
    if isinstance(node, dict):
        if "eventTime" in node and "event" in node:
            out.append(node)
        for v in node.values():
            _records(v, out)
    elif isinstance(node, list):
        for v in node:
            _records(v, out)
    return out


def yahoo_pull():
    """The calendar-events answer for 2026-09-01 .. 2026-12-31, a week at a time, US and unfiltered. Returns (records, how)."""
    saved = os.path.join(ROOT, "inputs", "yahoo_calendar.json")
    jar = os.path.join(ROOT, "inputs", ".yahoo_jar")
    try:
        subprocess.run(["curl", "-sS", "-m", "30", "-c", jar, "-A", UA, "-o", "/dev/null", "https://fc.yahoo.com/"], capture_output=True, text=True)
        r = subprocess.run(["curl", "-sS", "-m", "30", "-b", jar, "-A", UA, "-w", "\n%{http_code}", "https://query1.finance.yahoo.com/v1/test/getcrumb"], capture_output=True, text=True)
        crumb, _, code = r.stdout.rpartition("\n")
        LOG.append({"url": "https://query1.finance.yahoo.com/v1/test/getcrumb", "http": code, "bytes": len(crumb), "for": "Yahoo crumb (after the fc.yahoo.com cookie)"})
        if code != "200":
            raise RuntimeError(f"crumb {code}")
        import urllib.parse
        recs = []
        day = datetime.date(2026, 9, 1)
        while day <= datetime.date(2026, 12, 31):
            a = int(datetime.datetime(day.year, day.month, day.day, tzinfo=UTC).timestamp() * 1000)
            b = a + 7 * 86400000
            for region in ("&economicEventsRegionFilter=US", ""):
                url = ("https://query1.finance.yahoo.com/ws/screeners/v1/finance/calendar-events?countPerDay=99&modules=economicEvents"
                       f"{region}&startDate={a}&endDate={b}&crumb={urllib.parse.quote(crumb.strip())}")
                rr = subprocess.run(["curl", "-sS", "-m", "40", "-b", jar, "-A", UA, "-w", "\n%{http_code}", url], capture_output=True, text=True)
                body, _, c = rr.stdout.rpartition("\n")
                LOG.append({"url": url.split("?")[0] + f"?{region[1:] or 'all regions'}&week={day}", "http": c, "bytes": len(body), "for": "Yahoo economic events"})
                if c == "200":
                    recs += _records(json.loads(body), [])
            day += datetime.timedelta(days=7)
        if recs:
            json.dump(recs, open(saved, "w"), sort_keys=True)
            return recs, "live pull (saved to inputs/yahoo_calendar.json)"
    except Exception as e:  # noqa: BLE001
        LOG.append({"url": "yahoo flow", "http": "failed", "bytes": 0, "for": f"Yahoo calendar-events: {str(e)[:80]}"})
    finally:
        if os.path.exists(jar):
            os.remove(jar)
    if os.path.exists(saved):
        return json.load(open(saved)), "inputs/yahoo_calendar.json (a pull made elsewhere)"
    return [], "none: the live pull was refused and no saved pull exists"


def yahoo_check(events, dis):
    recs, how = yahoo_pull()
    out = {"how": how, "records": len(recs), "coverage_utc": None, "events_checked": 0, "match": 0, "mismatch": [], "not_found": [], "uncovered": 0}
    if not recs:
        for e in events:
            e["yahoo"] = {"status": "uncovered"}
        out["uncovered"] = len(events)
        return out
    ts = [int(r["eventTime"]) for r in recs]
    lo, hi = min(ts), max(ts)
    out["coverage_utc"] = [datetime.datetime.fromtimestamp(lo / 1000, UTC).isoformat(), datetime.datetime.fromtimestamp(hi / 1000, UTC).isoformat()]
    for e in events:
        day0 = e["t"] - (e["t"] % 86400000)
        if not (lo - 86400000 <= e["t"] <= hi + 86400000):
            e["yahoo"] = {"status": "uncovered"}
            out["uncovered"] += 1
            continue
        cc, pat = YAHOO_MATCH[e["kind"]]
        same_day = [r for r in recs if day0 - 86400000 <= int(r["eventTime"]) < day0 + 2 * 86400000 and str(r.get("countryCode", "")).upper() in cc and re.search(pat, str(r["event"]), re.I)]
        out["events_checked"] += 1
        exact = [r for r in same_day if abs(int(r["eventTime"]) - e["t"]) < 60000]
        if exact:
            e["yahoo"] = {"status": "match", "event": exact[0]["event"]}
            out["match"] += 1
        elif same_day:
            r = same_day[0]
            e["yahoo"] = {"status": "mismatch", "event": r["event"], "yahoo_utc": datetime.datetime.fromtimestamp(int(r["eventTime"]) / 1000, UTC).strftime("%Y-%m-%dT%H:%MZ")}
            out["mismatch"].append({"kind": e["kind"], "ours": e["utc"], **e["yahoo"]})
            dis.append({"kind": e["kind"], "day": e["day"], "what": f"Yahoo has {r['event']!r} at {e['yahoo']['yahoo_utc']}, ours is {e['utc']}"})
        else:
            e["yahoo"] = {"status": "not_found"}
            out["not_found"].append({"kind": e["kind"], "ours": e["utc"]})
    return out


def main():
    probe_refused()
    first = {"fomc": fomc(), "ecb": ecb(), "boe": boe()}
    events, dis = [], []
    for kind, days in first.items():
        rec = set(RECALLED[kind])
        got = {d for d in days if LO <= d <= "2026-10-15"}
        for d in sorted(rec - got):
            dis.append({"kind": kind, "day": d, "what": "recalled before the fetch but not in the first-party list"})
        for d in sorted(got - rec):
            dis.append({"kind": kind, "day": d, "what": "in the first-party list but not recalled (added)"})
        for d in days:
            events.append({"kind": kind, "day": d, "source": "first-party", "status": "published"})
    for kind, days in (("cpi", CPI), ("nfp", NFP)):
        for d in days:
            ev = {"kind": kind, "day": d, "source": "recalled (bls.gov refused)", "status": "recalled"}
            if kind == "nfp":
                y, m = map(int, d.split("-")[:2])
                ref = (datetime.date(y, m, 1) - datetime.timedelta(days=1))          # the reference month is the one before the release's month
                rule = nfp_rule(ref.year, ref.month)
                ev["bls_rule_day"] = rule
                if rule != d:
                    dis.append({"kind": "nfp", "day": d, "what": f"BLS's third-Friday rule gives {rule} (a delay, a holiday or a wrong recall)"})
            events.append(ev)
    for e in events:
        tz, hm = SPEC[e["kind"]]
        e["t"] = instant(e["day"], tz, hm)
        e["utc"] = datetime.datetime.fromtimestamp(e["t"] / 1000, UTC).strftime("%Y-%m-%dT%H:%MZ")
    events = sorted([e for e in events if LO <= e["day"] <= HI], key=lambda e: e["t"])
    market_check(events)
    for e in events:
        if e["stands_out"] is False and e["kind"] in ("cpi", "nfp", "fomc", "boe"):
            dis.append({"kind": e["kind"], "day": e["day"], "what": f"the market did not move at the minute ({e['move_bps']} bp against a control 90th percentile of {e['control_p90_bps']})"})
    yh = yahoo_check(events, dis)
    spikes = unexplained_spikes({e["day"] for e in events if e["kind"] in ("cpi", "nfp")})
    summary = {}
    for e in events:
        s = summary.setdefault(e["kind"], {"events": 0, "stand_out": 0, "not_standing_out": [], "future": 0})
        if e["stands_out"] is None:
            s["future"] += 1
            continue
        s["events"] += 1
        s["stand_out"] += int(e["stands_out"])
        if not e["stands_out"]:
            s["not_standing_out"].append(e["day"])
    json.dump({"about": "release_calendar.py: scheduled releases 2024-10-01 .. 2026-12-31 in UTC; `source` says who answered, `status` published (first-party) or recalled; the market check is the largest 1-minute move at the minute against the same minutes on ten weekdays either side",
               "source_log": LOG, "yahoo": yh, "events": events, "disagreements": dis, "summary": summary, "unexplained_0830_spikes_bp_day": spikes},
              open(os.path.join(ROOT, "inputs", "release_calendar.json"), "w"), indent=1, sort_keys=True)
    json.dump({"about": "release_calendar.py: the study's input (past events only; the future ones are in release_calendar.json)",
               "events": [{k: e[k] for k in ("kind", "day", "t", "utc", "move_bps", "control_p90_bps", "stands_out", "source")} for e in events if e["stands_out"] is not None], "summary": summary},
              open(os.path.join(ROOT, "inputs", "events.json"), "w"), indent=1, sort_keys=True)
    print(json.dumps(summary, indent=1, sort_keys=True))
    print("yahoo:", json.dumps({k: v for k, v in yh.items()}, sort_keys=True)[:600])
    print("disagreements:", len(dis))
    for d in dis:
        print("  ", d)
    print("answered / refused:", sorted({(x["url"].split("/")[2] if "://" in x["url"] else x["url"], x["http"]) for x in LOG}))
    print("spikes:", spikes[:12])


if __name__ == "__main__":
    main()
