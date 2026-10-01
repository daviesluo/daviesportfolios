"""Shared readers for the DAT study. Every reader of a price series CUTS it at the screen end (2024-12-31) as it
parses and asserts that no later row survives, unless it is asked for the held-out years explicitly by the held-out
scorer (which this study never runs)."""
import datetime as dt, gzip, hashlib, html, json, math, os, re
from zoneinfo import ZoneInfo
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
INP = os.path.join(HERE, "..", "inputs")
RES = os.path.join(HERE, "..", "results")
DESIGN = os.path.join(HERE, "..", "design.md")
ET = ZoneInfo("America/New_York")
SCREEN_FIRST, SCREEN_END = "2020-08-11", "2024-12-31"
# NYSE early closes (13:00 ET) inside the screen, from the exchange's published holiday calendars
EARLY_CLOSE = {"2020-11-27", "2020-12-24", "2021-11-26", "2022-11-25", "2023-07-03", "2023-11-24", "2024-07-03",
               "2024-11-29", "2024-12-24"}
FF_DAILY = os.path.join(HERE, "..", "..", "equity", "inputs", "F-F_Research_Data_Factors_daily.csv.gz")


def sha256(path):
    return hashlib.sha256(open(path, "rb").read()).hexdigest()


def design_sha():
    return sha256(DESIGN)


def html_text(raw):
    t = raw.decode("utf-8", "replace") if isinstance(raw, bytes) else raw
    t = re.sub(r"(?is)<(script|style).*?</\1>", " ", t)
    t = re.sub(r"(?s)<[^>]+>", " ", t)
    return re.sub(r"\s+", " ", html.unescape(t))


def read_mstr_daily(end=SCREEN_END):
    """[(date, open, close)] from the screen pull, cut at `end` as parsed."""
    j = json.load(gzip.open(os.path.join(INP, "yahoo_MSTR_1d_screen.json.gz")))
    rows = [(r[0], float(r[2]), float(r[5])) for r in j["rows"] if r[0] <= end and r[2] is not None]
    assert rows and max(r[0] for r in rows) <= end
    return rows


def read_btc_15m(end=SCREEN_END):
    """{start_epoch: close} for Coinbase BTC-USD 15-minute candles, cut at `end` (ET date of the candle's end)."""
    cut = dt.datetime.fromisoformat(end).replace(tzinfo=ET) + dt.timedelta(days=1)
    rows = json.load(gzip.open(os.path.join(INP, "coinbase_BTC-USD_15m_screen.json.gz")))
    out = {int(r[0]): float(r[4]) for r in rows if r[0] + 900 <= cut.timestamp()}
    assert out and max(out) + 900 <= cut.timestamp()
    return out


def btc_at(c15, day, hh, mm):
    """BTC close of the 15-minute candle ENDING at hh:mm ET on `day`; if missing, the last close before it."""
    end = dt.datetime.fromisoformat(day).replace(hour=hh, minute=mm, tzinfo=ET)
    t = int(end.timestamp()) - 900
    for k in range(0, 96):
        v = c15.get(t - 900 * k)
        if v is not None:
            return v, k
    raise ValueError(f"no BTC candle near {day} {hh}:{mm}")


def read_rf(end=SCREEN_END):
    """{YYYY-MM-DD: daily RF in decimals} from Ken French's committed daily file, cut at `end` as parsed."""
    out, started = {}, False
    lim = int(end.replace("-", ""))
    with gzip.open(FF_DAILY, "rt", encoding="latin-1") as f:
        for line in f:
            s = line.strip()
            if not started:
                started = s.startswith(",") and "Mkt-RF" in s
                continue
            if not s or not s[0].isdigit():
                break
            p = [v.strip() for v in s.split(",")]
            k = int(p[0])
            if k > lim:
                continue                                   # THE CUT: never stored
            v = float(p[4])
            if v <= -99.98:
                continue
            out[f"{p[0][:4]}-{p[0][4:6]}-{p[0][6:]}"] = v / 100.0
    assert out and max(out) <= end
    return out


def ols(y, X):
    """OLS with an intercept column already in X; returns (beta, residuals, (X'X)^-1)."""
    X = np.asarray(X, float); y = np.asarray(y, float)
    XtXi = np.linalg.inv(X.T @ X)
    b = XtXi @ X.T @ y
    return b, y - X @ b, XtXi


def newey_west_se(y, X, lag):
    """Newey-West (Bartlett) standard errors of OLS coefficients."""
    b, e, XtXi = ols(y, X)
    X = np.asarray(X, float)
    n = len(e)
    Xe = X * e[:, None]
    S = Xe.T @ Xe
    for L in range(1, lag + 1):
        w = 1 - L / (lag + 1)
        G = Xe[L:].T @ Xe[:-L]
        S += w * (G + G.T)
    V = XtXi @ S @ XtXi
    return b, np.sqrt(np.diag(V)), n


def write_json(name, obj):
    os.makedirs(RES, exist_ok=True)
    with open(os.path.join(RES, name), "w") as f:
        json.dump(obj, f, indent=1, sort_keys=True, default=lambda v: float(v) if isinstance(v, np.floating) else int(v)
                  if isinstance(v, np.integer) else str(v))
        f.write("\n")


def r6(v):
    return None if v is None or (isinstance(v, float) and not math.isfinite(v)) else round(float(v), 6)
