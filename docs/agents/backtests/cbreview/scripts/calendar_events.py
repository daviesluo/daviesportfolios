"""The scheduled-release calendar for the fast-move study (docs/agents/reviews/2026-10-15-coinbase-fast-move.md, section 4):
2024-10-01 -> 2026-10-31, UTC instants of the releases Davies named: US CPI and NFP (08:30 New York), FOMC statements (14:00
New York), ECB decisions (14:15 Frankfurt) and BoE MPC decisions (12:00 London). Writes ../inputs/events.json and checks it.

SOURCES, honestly. The Federal Reserve's FOMC calendar page was fetched on 2026-10-15 (the statement days below are parsed from it,
`FOMC` is a list of its second meeting days); the Bank of England's page lists its 2026 dates (fetched the same day; the 2024-25
dates are from its published calendar as I know it, not fetched); the ECB's page was fetched but lists only one date in its text
(10 September 2026, which agrees with the list below), so its other dates are from the published calendar as I know it. The BLS
release schedule (CPI, Employment Situation) is BLOCKED from this machine (HTTP 403 from bls.gov, and its mirrors and FRED do not
answer): the CPI and NFP dates below are the published schedule as I recall it, including the 2025 shutdown's delays, and the
last (2026-10-14) was confirmed by tradingeconomics.com's "next release" for US CPI, fetched the same day. A recalled date can be
wrong, so every one is CHECKED here against the market's own move at its minute: `check()` compares the largest one-minute
EUR/USD move within +-2 minutes of the release with the same clock minutes of the ten weekdays before and after, and reports
how many events stand out (an event that does not is listed, not dropped; the BoE is checked on GBP/USD, which is the pair it
moves, the others on EUR/USD, and after the screen's Yahoo series ends on the exchange-implied rate of pull_cb_candles.py). The check
earned its keep once: the first draft had US CPI on 2026-02-11, the same instant as that month's NFP, and the 08:30 New York minute
of 2026-02-13 stood out (17.5 bp) where 02-12 did not, so the date was corrected. The study's results are given with this calendar as it
stands, and with the checked-only subset.
usage: python3 -I calendar_events.py
"""
import datetime, json, os, statistics, sys
import zoneinfo

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
NY, LON, FRA = (zoneinfo.ZoneInfo(z) for z in ("America/New_York", "Europe/London", "Europe/Berlin"))
UTC = datetime.timezone.utc

CPI = """2024-10-10 2024-11-13 2024-12-11 2025-01-15 2025-02-12 2025-03-12 2025-04-10 2025-05-13 2025-06-11 2025-07-15 2025-08-12
2025-09-11 2025-10-24 2025-12-18 2026-01-13 2026-02-13 2026-03-11 2026-04-10 2026-05-12 2026-06-10 2026-07-14 2026-08-12 2026-09-11 2026-10-14""".split()
NFP = """2024-10-04 2024-11-01 2024-12-06 2025-01-10 2025-02-07 2025-03-07 2025-04-04 2025-05-02 2025-06-06 2025-07-03 2025-08-01
2025-09-05 2025-11-20 2025-12-16 2026-01-09 2026-02-11 2026-03-06 2026-04-03 2026-05-08 2026-06-05 2026-07-02 2026-08-07 2026-09-04 2026-10-02""".split()
FOMC = """2024-11-07 2024-12-18 2025-01-29 2025-03-19 2025-05-07 2025-06-18 2025-07-30 2025-09-17 2025-10-29 2025-12-10 2026-01-28 2026-03-18
2026-04-29 2026-06-17 2026-07-29 2026-09-16""".split()
ECB = """2024-10-17 2024-12-12 2025-01-30 2025-03-06 2025-04-17 2025-06-05 2025-07-24 2025-09-11 2025-10-30 2025-12-18 2026-02-05 2026-03-19
2026-04-30 2026-06-11 2026-07-23 2026-09-10""".split()
BOE = """2024-11-07 2024-12-19 2025-02-06 2025-03-20 2025-05-08 2025-06-19 2025-08-07 2025-09-18 2025-11-06 2025-12-18 2026-02-05 2026-03-19
2026-04-30 2026-06-18 2026-07-30 2026-09-17""".split()
SPEC = {"cpi": (CPI, NY, (8, 30)), "nfp": (NFP, NY, (8, 30)), "fomc": (FOMC, NY, (14, 0)), "ecb": (ECB, FRA, (14, 15)), "boe": (BOE, LON, (12, 0))}


def instant(day, tz, hm):
    y, m, d = map(int, day.split("-"))
    return int(datetime.datetime(y, m, d, hm[0], hm[1], tzinfo=tz).astimezone(UTC).timestamp() * 1000)


def events():
    out = [{"kind": k, "day": day, "t": instant(day, tz, hm), "utc": datetime.datetime.fromtimestamp(instant(day, tz, hm) / 1000, UTC).strftime("%Y-%m-%dT%H:%MZ")}
           for k, (days, tz, hm) in SPEC.items() for day in days]
    return sorted(out, key=lambda e: e["t"])


def check(evs):
    """Per event: the largest 1-minute |EUR/USD move| (GBP/USD for the BoE) within +-2 minutes, against the same clock minutes on the ten weekdays either side."""
    sys.path.insert(0, os.path.normpath(os.path.join(HERE, "../../scq_venues/scripts")))
    import sv_sim as S  # noqa: E402
    M = 60000
    import gzip
    t, v = S.SI.load_eurusd()
    ser = dict(zip(t, v))
    last = t[-1]
    # after the screen's Yahoo series ends (2026-10-08 23:59) the exchange-implied rate (USDT-USD / USDT-EUR candles, pull_cb_candles.py) stands in;
    # it is sparse (USDT-EUR prints in about half the minutes), so a "one-minute" move there is a move from the last printed minute <= 3 minutes before
    d = json.load(gzip.open(os.path.join(ROOT, "inputs", "cb_implied_eurusd.json.gz"), "rt"))
    imp = {d["t0"] + i * M: u / e for i, (u, e) in enumerate(zip(d["usd"], d["eur"])) if u is not None and e is not None}

    gt, gv = S.CI.load_fx()                         # GBP/USD: the pound's own release (the BoE) moves it, not EUR/USD
    gser = dict(zip(gt, gv))

    def move(at, kind="eur"):
        best = 0.0
        if kind == "boe":
            for k in range(-2, 3):
                a, b = gser.get(at + k * M), gser.get(at + (k - 1) * M)
                if a is not None and b is not None:
                    best = max(best, abs(a / b - 1) * 1e4)
            return best
        if at > last:
            for k in range(-2, 3):
                a = imp.get(at + k * M)
                b = next((imp[at + (k - j) * M] for j in range(1, 4) if (at + (k - j) * M) in imp), None)
                if a is not None and b is not None:
                    best = max(best, abs(a / b - 1) * 1e4)
            return best
        for k in range(-2, 3):
            a = ser.get(at + k * M)
            b = ser.get(at + (k - 1) * M)
            if a is not None and b is not None:
                best = max(best, abs(a / b - 1) * 1e4)
        return best

    res = []
    for e in evs:
        m = move(e["t"], e["kind"])
        ctrl = []
        d = datetime.datetime.fromtimestamp(e["t"] / 1000, UTC)
        for off in list(range(-14, -3)) + list(range(4, 15)):
            c = d + datetime.timedelta(days=off)
            if c.weekday() < 5:
                ctrl.append(move(int(c.timestamp() * 1000), e["kind"]))
        ctrl = [x for x in ctrl if x > 0] or [0.0]
        res.append({**e, "move_bps": round(m, 2), "control_p90_bps": round(sorted(ctrl)[int(0.9 * (len(ctrl) - 1))], 2), "stands_out": m > sorted(ctrl)[int(0.9 * (len(ctrl) - 1))]})
    return res


def main():
    evs = events()
    lo, hi = instant("2024-10-01", UTC, (0, 0)), instant("2026-10-15", UTC, (0, 0))
    inside = [e for e in evs if lo <= e["t"] <= hi]
    res = check(inside)
    by = {}
    for r in res:
        b = by.setdefault(r["kind"], {"events": 0, "stand_out": 0, "listed_not_standing_out": []})
        b["events"] += 1
        b["stand_out"] += int(r["stands_out"])
        if not r["stands_out"]:
            b["listed_not_standing_out"].append(r["day"])
    json.dump({"about": "calendar_events.py: scheduled releases, UTC; `checked` is the market's own move at the minute against ten weekdays either side (not a selection of the calendar)",
               "events": [{k: r[k] for k in ("kind", "day", "t", "utc", "move_bps", "control_p90_bps", "stands_out")} for r in res], "summary": by},
              open(os.path.join(ROOT, "inputs", "events.json"), "w"), indent=1, sort_keys=True)
    print(json.dumps(by, indent=1, sort_keys=True))


if __name__ == "__main__":
    main()
