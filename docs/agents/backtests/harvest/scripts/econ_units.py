"""HARVEST, economic releases: the confirmation instant C and the confirmed outcome of every exploration market, from
the publishers, not from the market.

C is the publisher's release instant: the rules' release date (parsed from the rules, checked against RELEASE_DAY) at
the publisher's standard time — BLS (CPI, egg prices, payrolls, unemployment), BEA (GDP) and DOL (claims) at 08:30
New York; the FOMC statement at 14:00 New York; the Bank of Canada at 09:45 New York; the Bank of England at 12:00
London; the ECB at 14:15 Frankfurt.

The confirmed outcome is what the publisher's first release said, read keylessly:
* ALFRED vintages (alfred.stlouisfed.org/graph/alfredgraph.csv?id=<series>&vintage_date=<release day>): the series as
  the release day left it — CPIAUCNS (annual CPI, not seasonally adjusted, one decimal), CPIAUCSL (monthly CPI,
  seasonally adjusted, one decimal), APU0000708111 (eggs, three decimals), PAYEMS (payroll change, thousands), UNRATE,
  A191RL1Q225SBEA (GDP, advance), ICSA (initial claims);
* the Fed's target range (FRED DFEDTARU) and the statement's own vote (federalreserve.gov press release): dissents on
  the rate are the members "voting against" who preferred a different target range; a member who "supported
  maintaining the target range" but voted against the statement is not one (the markets' rules count dissents "on the
  Fed Funds Rate decision");
* the Bank of Canada's Valet series V39079, the Bank of England's IUDBEDR, FRED's ECBDFR.

Each market's bracket is read from its group title; the confirmed outcome is YES when the published value is in it.
A market whose resolution differs from that is a trap. Writes the units (one per market) and the print floors
(C − 1 h per event).

usage: econ_units.py <universe econ> <universe other> <split json> <out units json> <out floors json>
"""
import csv
import html
import io
import os
import re
import sys
from datetime import datetime
from zoneinfo import ZoneInfo

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import hcommon as H  # noqa: E402

NY, LDN, FRA = ZoneInfo("America/New_York"), ZoneInfo("Europe/London"), ZoneInfo("Europe/Berlin")
TIMES = {  # series -> (hour, minute, zone)
    "us-annual-inflation": (8, 30, NY), "us-monthly-inflation": (8, 30, NY), "egg-prices-monthly": (8, 30, NY),
    "jobs-added": (8, 30, NY), "unemployment": (8, 30, NY), "gdp-quarterly": (8, 30, NY),
    "weekly-jobless-claims": (8, 30, NY), "fomc": (14, 0, NY), "dissent-at-fed-meeting": (14, 0, NY),
    "bank-of-canada-decision": (9, 45, NY), "bank-of-england-decision": (12, 0, LDN), "ecb-interest-rates": (14, 15, FRA),
}
MONTHS = {m: i for i, m in enumerate(["january", "february", "march", "april", "may", "june", "july", "august",
                                      "september", "october", "november", "december"], 1)}
DATE = re.compile(r"(January|February|March|April|May|June|July|August|September|October|November|December)\s+"
                  r"(\d{1,2})(?:\s*-\s*(\d{1,2}))?,?\s+(20\d\d)")
ALFRED = "https://alfred.stlouisfed.org/graph/alfredgraph.csv"
FRED = "https://fred.stlouisfed.org/graph/fredgraph.csv"


def release_day(e, ser):
    """The release day from the rules: the date after "scheduled" / "released on" / "after its … meeting" / "meeting
    scheduled for", the second day of a two-day FOMC meeting; else the event's end date."""
    d = e["desc"] or ""
    for pat in (r"scheduled (?:to be released )?(?:on |for )", r"released on ", r"after its ", r"announced at [^.]*? on ",
                r"presently scheduled for ", r"currently scheduled (?:to be released )?(?:on |for )"):
        m = re.search(pat + r"\s*" + DATE.pattern, d)
        if m:
            g = m.groups()[-4:]
            day = int(g[2]) if g[2] else int(g[1])
            return f"{int(g[3]):04d}-{MONTHS[g[0].lower()]:02d}-{day:02d}"
    m = DATE.search(d)
    if m and ser in ("fomc", "dissent-at-fed-meeting"):
        g = m.groups()
        day = int(g[2]) if g[2] else int(g[1])
        return f"{int(g[3]):04d}-{MONTHS[g[0].lower()]:02d}-{day:02d}"
    return H.day(e["end"])


def instant(day, ser):
    h, mi, tz = TIMES[ser]
    y, mo, d = (int(x) for x in day.split("-"))
    return datetime(y, mo, d, h, mi, tzinfo=tz).timestamp()


def csv_rows(url, params, name):
    path = os.path.join(H.DATA, "pub", name + ".json")
    if H.exists(path):
        return H.load(path)["rows"]
    body = H.pmnet.get(url, params, raw=True).decode()
    rows = [r for r in csv.reader(io.StringIO(body))]
    H.dump(path, {"url": url, "params": params, "rows": rows})
    return rows


def alfred(series, vintage):
    rows = csv_rows(ALFRED, {"id": series, "vintage_date": vintage}, f"alfred_{series}_{vintage}")
    return {r[0]: float(r[1]) for r in rows[1:] if len(r) > 1 and r[1] not in ("", ".")}


def fred(series, d0, d1):
    rows = csv_rows(FRED, {"id": series, "cosd": d0, "coed": d1}, f"fred_{series}_{d0}_{d1}")
    return {r[0]: float(r[1]) for r in rows[1:] if len(r) > 1 and r[1] not in ("", ".")}


def boc(d0, d1):
    path = os.path.join(H.DATA, "pub", f"boc_V39079_{d0}_{d1}.json")
    if not H.exists(path):
        H.dump(path, H.pmnet.get("https://www.bankofcanada.ca/valet/observations/V39079/json",
                                 {"start_date": d0, "end_date": d1}))
    return {o["d"]: float(o["V39079"]["v"]) for o in H.load(path)["observations"]}


def boe(d0, d1):
    path = os.path.join(H.DATA, "pub", f"boe_IUDBEDR_{d0}_{d1}.json")
    if not H.exists(path):
        f = lambda s: datetime.fromisoformat(s).strftime("%d/%b/%Y")  # noqa: E731
        body = H.pmnet.get("https://www.bankofengland.co.uk/boeapps/database/_iadb-fromshowcolumns.asp",
                           {"csv.x": "yes", "Datefrom": f(d0), "Dateto": f(d1), "SeriesCodes": "IUDBEDR", "CSVF": "TN",
                            "UsingCodes": "Y", "VPD": "Y", "VFD": "N"}, raw=True).decode()
        H.dump(path, {"csv": body})
    out = {}
    for r in list(csv.reader(io.StringIO(H.load(path)["csv"])))[1:]:
        if len(r) > 1 and r[1]:
            out[datetime.strptime(r[0], "%d %b %Y").strftime("%Y-%m-%d")] = float(r[1])
    return out


def fed_dissents(day):
    """Dissents on the rate from the statement of `day`: the names in the "Voting against" clause, less any group
    that "supported maintaining the target range"."""
    path = os.path.join(H.DATA, "pub", f"fomc_{day}.json")
    if not H.exists(path):
        url = f"https://www.federalreserve.gov/newsevents/pressreleases/monetary{day.replace('-', '')}a.htm"
        H.dump(path, {"url": url, "html": H.pmnet.get(url, raw=True).decode(errors="replace")})
    t = re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", H.load(path)["html"])))
    m = re.search(r"Voting against (?:this|the) action (?:was|were) (.*?)(?: For media inquiries|$)", t)
    if not m:
        return 0, ""
    clause = m.group(1)
    n = 0
    for grp in clause.split(";"):
        if "supported maintaining the target range" in grp:
            continue
        who = grp.split(", who")[0]
        n += len([x for x in re.split(r",\s*|\s+and\s+", who.replace("and ", " and ")) if re.search(r"[A-Z]\.", x)])
    return n, clause[:400]


def prev_month(d):
    y, m = int(d[:4]), int(d[5:7])
    return f"{y - 1 if m == 1 else y:04d}-{12 if m == 1 else m - 1:02d}-01"


def ref_month(e):
    """The reference month (first day) of a monthly release from the title ("February Inflation US", "How many jobs
    added in February?"), the year from the release day (a January release refers to December of the year before)."""
    m = re.search(r"(January|February|March|April|May|June|July|August|September|October|November|December)",
                  e["title"])
    return MONTHS[m.group(1).lower()] if m else None


NUM = re.compile(r"-?\d+(?:\.\d+)?")


def bracket(title):
    """A title's bracket as (lo, hi, lo_incl, hi_incl) on the value's own scale, or ('eq', v). "2.4%" is equal to 2.4
    at one decimal; "≤2.0%" (-inf, 2.0]; "≥2.8%" / "175k+" / "250k+" [x, inf); "<25k" / "<$2.30" (-inf, x);
    "25k–50k" / "$2.30–2.40" / "-150k – -100k" [lo, hi) — "falls exactly between two brackets … the higher range"."""
    s = title.replace("−", "-").replace("–", "-").replace("—", "-").replace(",", "").replace("$", "").strip()
    k = 1000.0 if re.search(r"\dk\b", s) else 1.0
    s2 = s.replace("k", "")
    nums = [float(x) * k for x in NUM.findall(s2)]
    if s.startswith("≤"):
        return (None, nums[0], False, True)
    if s.startswith("≥") or s.endswith("+"):
        return (nums[0], None, True, False)
    if s.startswith("<"):
        return (None, nums[0], False, False)
    m = re.match(r"^\s*(-?\d+(?:\.\d+)?)k?\s*-\s*(-?\d+(?:\.\d+)?)k?\s*%?$", s)
    if m:
        return (float(m.group(1)) * k, float(m.group(2)) * k, True, False)
    if len(nums) == 1:
        return ("eq", nums[0])
    return None


def inside(b, v):
    if b is None:
        return None
    if b[0] == "eq":
        return abs(v - b[1]) < 1e-9
    lo, hi, li, hi_i = b
    if lo is not None and (v < lo or (v == lo and not li)):
        return False
    if hi is not None and (v > hi or (v == hi and not hi_i)):
        return False
    return True


RATE_TITLES = {"50+ bps decrease": lambda c: c <= -50, "25 bps decrease": lambda c: -50 < c < 0,
               "No change": lambda c: c == 0, "25+ bps increase": lambda c: c > 0, "Increase": lambda c: c > 0}


def value_of(e, ser, day):
    """The published value that decides the event, and a note of where it came from."""
    if ser in ("fomc", "bank-of-canada-decision", "bank-of-england-decision", "ecb-interest-rates"):
        d0, d1 = "2026-02-01", "2026-06-30"
        s = (fred("DFEDTARU", d0, d1) if ser == "fomc" else boc(d0, d1) if ser == "bank-of-canada-decision" else
             boe(d0, d1) if ser == "bank-of-england-decision" else fred("ECBDFR", d0, d1))
        before = [v for k2, v in sorted(s.items()) if k2 < day]
        after = [v for k2, v in sorted(s.items()) if k2 > day]
        return round((after[0] - before[-1]) * 100), f"rate change, bps ({ser})"
    if ser == "dissent-at-fed-meeting":
        n, clause = fed_dissents(day)
        return n, "dissents on the rate: " + clause
    mo = ref_month(e)
    y = int(day[:4]) - (1 if mo == 12 and day[5:7] == "01" else 0)
    ref = f"{y:04d}-{mo:02d}-01" if mo else None
    if ser == "us-annual-inflation":
        s = alfred("CPIAUCNS", day)
        a = f"{y - 1:04d}-{mo:02d}-01"
        return round((s[ref] / s[a] - 1) * 100 + 1e-12, 1), f"CPIAUCNS {ref}/{a} vintage {day}"
    if ser == "us-monthly-inflation":
        s = alfred("CPIAUCSL", day)
        return round((s[ref] / s[prev_month(ref)] - 1) * 100 + 1e-12, 1), f"CPIAUCSL {ref} vintage {day}"
    if ser == "egg-prices-monthly":
        s = alfred("APU0000708111", day)
        return s[ref], f"APU0000708111 {ref} vintage {day}"
    if ser == "jobs-added":
        s = alfred("PAYEMS", day)
        return (s[ref] - s[prev_month(ref)]) * 1000.0, f"PAYEMS {ref} change vintage {day}"
    if ser == "unemployment":
        s = alfred("UNRATE", day)
        return s[ref], f"UNRATE {ref} vintage {day}"
    if ser == "gdp-quarterly":
        s = alfred("A191RL1Q225SBEA", day)
        q = re.search(r"Q(\d) (?:of )?(20\d\d)", e["title"] + " " + (e["desc"] or ""))
        k2 = f"{q.group(2)}-{(int(q.group(1)) - 1) * 3 + 1:02d}-01"
        return s[k2], f"A191RL1Q225SBEA {k2} vintage {day}"
    if ser == "weekly-jobless-claims":
        s = alfred("ICSA", day)
        m = re.search(r"week ending (\w+ \d+)", e["title"])
        wk = datetime.strptime(m.group(1) + " " + day[:4], "%b %d %Y").strftime("%Y-%m-%d")
        return s[wk], f"ICSA week ending {wk} vintage {day}"
    raise ValueError(ser)


def main():
    uni = {}
    for f in sys.argv[1:3]:
        for k2, v in H.jfile(f)["events"].items():
            uni.setdefault(k2, v)
    split = H.jfile(sys.argv[3])
    units, floors, releases = [], {}, {}
    for eid in sorted(split["categories"]["econ"]["exploration"], key=int):
        e = uni[eid]
        ser = e["series"][0]
        day = release_day(e, ser)
        c = instant(day, ser)
        val, note = value_of(e, ser, day)
        floors[eid] = int(c - 3600)
        releases[eid] = {"series": ser, "title": e["title"], "day": day, "C": c, "C_iso": H.iso(c), "value": val,
                         "source": note}
        for m in e["markets"]:
            title = m["title"] or ""
            if ser in ("fomc", "bank-of-canada-decision", "bank-of-england-decision", "ecb-interest-rates"):
                f = RATE_TITLES.get(title.strip())
                yes = f(val) if f else None
            elif ser == "dissent-at-fed-meeting":
                t = title.strip()
                yes = (val >= int(t[:-1])) if t.endswith("+") else (val == int(t))
            else:
                v = val
                yes = inside(bracket(title), v)
            if yes is None:
                continue
            units.append({"cat": "econ", "event": eid, "cond": m["cond"], "title": title, "q": m["q"][:120],
                          "C": c, "w": 0 if yes else 1, "r": H.winner_index(m), "closed": m["closed_time"],
                          "fees": m["fees"], "fee_rate": m["fee_rate"], "fee_exp": m["fee_exp"] or 1,
                          "rebate": m["rebate"], "tick": m["tick"], "series": ser, "day": day})
    H.write_json(sys.argv[4], {"category": "econ", "releases": releases, "units": units})
    H.write_json(sys.argv[5], {"floors": floors})
    traps = [u for u in units if u["r"] is not None and u["w"] != u["r"]]
    print("events", len(releases), "units", len(units), "traps", len(traps))
    for eid, r in sorted(releases.items(), key=lambda x: x[1]["C"]):
        print(eid, r["C_iso"], r["series"], r["value"], r["source"][:70])
    for u in traps:
        print("TRAP", u["event"], u["title"], u["w"], u["r"])


if __name__ == "__main__":
    main()
