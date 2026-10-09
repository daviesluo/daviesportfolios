"""Shared loaders, IG's published costs and the statistics every IG-study scorer uses.

IG's costs are quoted from its UK help centre on 2026-10-09 (product details dated 2026-09-08; the review's §A has the
links and the words). They are applied at today's index levels as bps, so history is charged what a trade costs now.
"""
import csv, gzip, io, json, math, os, statistics as st
import datetime as dt

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
INP = os.path.join(HERE, "inputs")
RES = os.path.join(HERE, "results")

# --- IG UK spread-bet costs (DFB = daily funded bet), 2026-09-08 product details ------------------------------------
# Index DFB spreads in points by UK-time band; the levels convert them to bps at the 2026-10-08 close.
LEVEL = {"US500": 7765.36, "UK100": 10441.60, "DE40": 24806.97, "USTECH": 30725.81}
SPREAD_PTS = {  # (in cash hours, out of hours)
    "US500": (0.4, 0.6),    # 14.30-21.00 0.4; 21.00-14.30 0.6; 22.00-23.00 1.5
    "UK100": (1.0, 4.0),    # 08.00-16.30 1; 16.30-21.00 2; 21.00-01.00 4; 01.00-07.00 3
    "DE40": (1.2, 5.0),     # 08.00-16.30 1.2; 16.30-21.00 2; 21.00-00.15 5; 00.15-07.00 4
    "USTECH": (1.0, 2.0),   # 14.30-21.00 1; 21.00-14.30 2; 22.00-23.00 5
}
ADMIN_FEE = 0.034          # spread-bet admin fee on index DFBs, a year, on top of the benchmark (CFD: 3 %)
FX_ADMIN_FEE = 0.015       # spread-bet FX and spot metals: tom-next +/- 1.5 % a year
DIVISOR = {"US500": 360, "UK100": 365, "DE40": 360, "USTECH": 360}


def spread_bps(mkt, out_of_hours=False):
    return 1e4 * SPREAD_PTS[mkt][1 if out_of_hours else 0] / LEVEL[mkt]


# --- loaders ----------------------------------------------------------------------------------------------------------
def read_csv_gz(path):
    return list(csv.DictReader(io.StringIO(gzip.open(path).read().decode())))


def daily(sym):
    """{date: (open, close, div)} from inputs/yahoo_d, rows with a usable open and close only."""
    out = {}
    for r in read_csv_gz(os.path.join(INP, "yahoo_d", sym.replace("^", "_") + ".csv.gz")):
        try:
            o, c = float(r["open"]), float(r["close"])
        except (TypeError, ValueError):
            continue
        if o > 0 and c > 0:
            out[r["t"]] = (o, c, float(r["div"]) if r["div"] else 0.0)
    return out


def fred(sid):
    out = {}
    for r in read_csv_gz(os.path.join(INP, "fred", sid + ".csv.gz")):
        v = r.get(sid)
        if v not in (None, "", "."):
            out[r["observation_date"]] = float(v) / 100
    return out


class Rate:
    """The benchmark a DFB's funding uses, as of a date (last value on or before it)."""

    def __init__(self, ccy):
        if ccy == "USD":
            s = fred("SOFR")
            d = fred("DFF")  # fed funds before SOFR (2018-04-03)
            self.v = {k: d[k] for k in d if k < "2018-04-03"}
            self.v.update(s)
        elif ccy == "GBP":
            self.v = fred("IUDSOIA")
        elif ccy == "EUR":
            self.v = fred("ECBDFR")
        self.k = sorted(self.v)

    def at(self, day):
        import bisect
        i = bisect.bisect_right(self.k, day) - 1
        return self.v[self.k[i]] if i >= 0 else None


def cboe(idx):
    out = {}
    for r in read_csv_gz(os.path.join(INP, "cboe", idx + ".csv.gz")):
        m, d, y = r["DATE"].split("/")
        col = "CLOSE" if "CLOSE" in r else idx
        try:
            out[f"{y}-{m}-{d}"] = float(r[col])
        except (TypeError, ValueError):
            pass
    return out


# --- statistics -------------------------------------------------------------------------------------------------------
def summ(x, per_year=None):
    """x: per-trade returns as fractions. Returns bps figures, t, hit rate, and the worst drawdown of the running sum."""
    n = len(x)
    if n < 2:
        return {"n": n}
    m = sum(x) / n
    sd = st.pstdev(x)
    cum, peak, mdd = 0.0, 0.0, 0.0
    for v in x:
        cum += v
        peak = max(peak, cum)
        mdd = min(mdd, cum - peak)
    out = {"n": n, "mean_bps": round(1e4 * m, 2), "sd_bps": round(1e4 * sd, 1),
           "t": round(m / (sd / math.sqrt(n)), 2) if sd else None, "hit": round(sum(v > 0 for v in x) / n, 3),
           "total_bps": round(1e4 * sum(x), 0), "max_dd_bps": round(1e4 * mdd, 0)}
    if per_year:
        out["per_year"] = round(per_year, 2)
        out["annual_bps"] = round(1e4 * m * per_year, 1)
        out["annual_sharpe"] = round(m / sd * math.sqrt(per_year), 2) if sd else None
    return out


def by_era(rows, eras):
    """rows: [(date, value)]; eras: {name: (lo, hi)} inclusive ISO dates."""
    out = {}
    for name, (lo, hi) in eras.items():
        x = [v for d, v in rows if lo <= d <= hi]
        yrs = max(1e-9, (dt.date.fromisoformat(min(hi, rows[-1][0])) - dt.date.fromisoformat(max(lo, rows[0][0]))).days / 365.25) if x else 1
        out[name] = summ(x, len(x) / yrs if x else None)
    return out


def by_year(rows):
    acc = {}
    for d, v in rows:
        acc.setdefault(d[:4], []).append(v)
    return {y: round(1e4 * sum(v), 0) for y, v in sorted(acc.items())}


def dump(name, obj):
    os.makedirs(RES, exist_ok=True)
    with open(os.path.join(RES, name), "w") as f:
        json.dump(obj, f, indent=1, sort_keys=True)
        f.write("\n")
