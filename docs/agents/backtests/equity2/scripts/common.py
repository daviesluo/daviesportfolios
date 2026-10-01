"""Shared readers for the EQ2 screen. Every series is CUT at 2015-12-31 the
moment it is parsed (the held-out window 2016-01 -> 2026-08 is never read),
exactly as EQ1's screen_french.py does, and an assertion stops the run if a
later row survives."""
import gzip, math, os
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
INP = os.path.join(HERE, "..", "inputs")
SCREEN_END = 20151231      # inclusive, daily key
SCREEN_END_M = 201512      # inclusive, monthly key


def read_block(name, header_contains, daily, block_title=None):
    """(dates, columns, matrix in decimals) for the first block whose header
    row starts with ',' and contains header_contains; if block_title is given,
    the block must follow a title line containing it. Cut at the screen end."""
    rows, cols, started, title_ok = [], None, False, block_title is None
    with gzip.open(os.path.join(INP, name + ".csv.gz"), "rt", encoding="latin-1") as f:
        for line in f:
            s = line.strip()
            if not started:
                if block_title is not None and block_title in s:
                    title_ok = True
                if title_ok and s.startswith(",") and header_contains in s:
                    cols = [c.strip() for c in s.split(",")[1:]]
                    started = True
                continue
            if not s or not s[0].isdigit():
                break
            parts = [p.strip() for p in s.split(",")]
            if daily and len(parts[0]) != 8:
                break
            if not daily and len(parts[0]) != 6:
                break
            key = int(parts[0])
            if key > (SCREEN_END if daily else SCREEN_END_M):
                continue                                   # THE CUT: never stored
            rows.append((key, [float(x) for x in parts[1:]]))
    end = SCREEN_END if daily else SCREEN_END_M
    assert rows and max(r[0] for r in rows) <= end
    dates = np.array([r[0] for r in rows])
    raw = np.array([r[1] for r in rows])
    # Missing codes are -99.99 and -999 in the RAW file. Compare before dividing:
    # -99.99 / 100 is -0.99990000000000001, which is NOT <= -0.9999, so EQ1's
    # `m[m <= -0.9999] = np.nan` (screen_french.py) lets -99.99 through as a
    # -99.99 % return. EQ1's own four inputs carry no such code to 2015, so its
    # results stand; the 49-industry file does.
    raw[raw <= -99.98] = np.nan
    m = raw / 100.0
    return dates, cols, m


def month_turns(dates):
    """For a daily calendar, the index of T (last trading day) of every month
    that has a following month in the data. Returns list of (k_T, ym)."""
    ym = dates // 100
    last = np.nonzero(np.diff(ym))[0]          # index where month changes after
    return [(int(i), int(ym[i])) for i in last]


def window_sum(x, kT, lo, hi):
    """Sum of x over trading days T+lo .. T+hi (inclusive), None if out of range.
    T+0 is the last trading day of the month; T+1 the first of the next."""
    a, b = kT + lo, kT + hi
    if a < 0 or b >= len(x):
        return None
    return float(np.nansum(x[a:b + 1]))


def ann(x, per_year):
    x = np.asarray(x, float)
    x = x[~np.isnan(x)]
    mu, sd = x.mean(), x.std(ddof=1)
    return {"n": int(len(x)), "mean_ann_pct": round(100 * mu * per_year, 3),
            "sd_ann_pct": round(100 * sd * math.sqrt(per_year), 3),
            "ir": round(mu / sd * math.sqrt(per_year), 3) if sd > 0 else None,
            "t": round(mu / sd * math.sqrt(len(x)), 2) if sd > 0 else None}


def tstat(x):
    x = np.asarray(x, float)
    x = x[~np.isnan(x)]
    return float(x.mean() / x.std(ddof=1) * math.sqrt(len(x)))


def r(v, k=3):
    return None if v is None else round(float(v), k)
