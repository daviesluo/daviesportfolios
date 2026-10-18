"""Round 3's arms, from the committed inputs, exactly as ../params/frozen.json writes them. Writes results/search.json.

Run from anywhere: python3 -I docs/agents/backtests/ig_search3/scripts/search.py
Deterministic: the same inputs give the same bytes.
"""
import csv, gzip, json, math, os, random, statistics as st, sys
import datetime as dt
from zoneinfo import ZoneInfo

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
INP = os.path.join(HERE, "inputs")
BT = os.path.dirname(HERE)
P = json.load(open(os.path.join(HERE, "params", "frozen.json")))
UTC = dt.timezone.utc
NY, BER, LON = ZoneInfo("America/New_York"), ZoneInfo("Europe/Berlin"), ZoneInfo("Europe/London")
BPS = 1e4
SEED = P["bar"]["bootstrap"]["seed"]
ERA_I, ERA_F = P["eras"]["INDEX"], P["eras"]["FX"]
COST = P["costs"]
SESS = {"US500": (NY, "09:30", "16:00"), "USTECH": (NY, "09:30", "16:00"), "DE40": (BER, "09:00", "17:30"),
        "UK100": (LON, "08:00", "16:30"), "WTI": (NY, "09:30", "16:00"), "WALLST": (NY, "09:30", "16:00")}
# the price columns each market's table holds for its open + 30 min and close - 30 min
COLS = {"US500": ("p1000", "p1530"), "USTECH": ("p1000", "p1530"), "DE40": ("p0930", "p1700"), "UK100": ("p0830", "p1600")}
INDEX = ["US500", "USTECH", "DE40", "UK100"]
INCLUSIVE_CLOSE = "--inclusive-close" in sys.argv


# ----------------------------------------------------------------------------------------------------------- helpers

def stats(x, seed=SEED):
    n = len(x)
    if n == 0:
        return {"n": 0}
    m = sum(x) / n
    sd = math.sqrt(sum((v - m) ** 2 for v in x) / (n - 1)) if n > 1 else 0.0
    out = {"n": n, "mean_bps": round(BPS * m, 2), "sd_bps": round(BPS * sd, 1),
           "t": round(m / (sd / math.sqrt(n)), 2) if sd > 0 else None,
           "hit": round(sum(1 for v in x if v > 0) / n, 3), "worst_bps": round(BPS * min(x), 1),
           "best_bps": round(BPS * max(x), 1)}
    if n >= 5:
        rng = random.Random(seed)
        means = sorted(sum(x[rng.randrange(n)] for _ in range(n)) / n for _ in range(10000))
        out["boot95_bps"] = [round(BPS * means[250], 2), round(BPS * means[9749], 2)]
        out["min_detectable_bps_at_t2_5"] = round(BPS * 2.5 * sd / math.sqrt(n), 2)
    return out


def split(rows, era):
    tr = [r["ret"] for r in rows if era["train"][0] <= r["date"] <= era["train"][1]]
    te = [r["ret"] for r in rows if era["test"][0] <= r["date"] <= era["test"][1]]
    return tr, te


def verdict(train, test):
    c = P["bar"]
    ok_test = test.get("n", 0) > 1 and test["mean_bps"] > 0 and (test.get("t") or 0) >= 2.5 and \
        test.get("boot95_bps", [-1])[0] > 0
    ok_train = train.get("n", 0) > 1 and train["mean_bps"] > 0 and (train.get("t") or 0) >= 2.0
    if ok_test and ok_train:
        return "candidate"
    if test.get("n", 0) > 1 and test["mean_bps"] > 0 and (test.get("t") or 0) >= 2.0 and train.get("mean_bps", -1) > 0:
        return "demo-forward level"
    return "dead"


def report(rows, era, extra=None):
    tr, te = split(rows, era)
    s_tr, s_te = stats(tr), stats(te)
    by_year = {}
    for r in rows:
        by_year.setdefault(r["date"][:4], []).append(r["ret"])
    out = {"train": s_tr, "test": s_te, "verdict_first_source": verdict(s_tr, s_te),
           "by_year_total_bps": {y: round(BPS * sum(v), 1) for y, v in sorted(by_year.items())},
           "trades_per_year_test": round(len(te) / max(1e-9, years(era["test"])), 1),
           "gross_test_mean_bps": round(BPS * sum(r["gross"] for r in rows if era["test"][0] <= r["date"] <= era["test"][1])
                                        / max(1, len(te)), 2),
           "cost_test_mean_bps": round(BPS * sum(r["gross"] - r["ret"] for r in rows
                                                 if era["test"][0] <= r["date"] <= era["test"][1]) / max(1, len(te)), 2)}
    if extra:
        out.update(extra)
    return out


def years(span):
    a, b = (dt.date.fromisoformat(s) for s in span)
    return (b - a).days / 365.25


def sign(x):
    return 1 if x > 0 else (-1 if x < 0 else 0)


def f(v):
    return float(v) if v not in ("", None) else None


def tz_fails(mkt):
    """Deviation 3: the year-seasons whose cash-open volatility step is missing or an hour off (inputs/hd_tzcheck2.json,
    scripts/tzcheck.py). The frozen busiest-minute check (inputs/hd_tzcheck.json) is reported beside it, not applied."""
    chk = json.load(open(os.path.join(INP, "hd_tzcheck2.json")))[mkt]
    return {k for k, v in chk.items() if not v["pass"]}


def load_days(mkt):
    with gzip.open(os.path.join(INP, f"hd_{mkt}_days.csv.gz"), "rt") as fh:
        rows = list(csv.DictReader(fh))
    bad = tz_fails(mkt)
    out = []
    for r in rows:
        season = "summer" if 4 <= int(r["date"][5:7]) <= 10 else "winter"
        if f"{r['date'][:4]}-{season}" in bad:
            continue
        d = {k: (r[k] if k == "date" else f(r[k])) for k in r}
        out.append(d)
    return out


def uk_time(mkt, date, hhmm, plus_min=0):
    tz = SESS[mkt][0]
    y, m, dd = map(int, date.split("-"))
    hh, mm = map(int, hhmm.split(":"))
    t = dt.datetime(y, m, dd, hh, mm, tzinfo=tz) + dt.timedelta(minutes=plus_min)
    return t.astimezone(LON)


def half_spread_bps(mkt, t_uk):
    c = COST["index"][mkt]
    if mkt == "WTI":
        return 0.5 * c["spread_pt"] * c["point"] / c["level"] * BPS
    a, b = c["in_hours_uk"]
    hm = t_uk.strftime("%H:%M")
    # As frozen, a deal at the window's last minute (the cash close) pays the out-of-hours spread; `--inclusive-close`
    # (a reading added after the first run, written up as such) charges it in hours, as a deal a minute before would be.
    inside = (a <= hm <= b) if INCLUSIVE_CLOSE else (a <= hm < b)
    pt = c["in_hours_pt"] if inside else c["out_hours_pt"]
    return 0.5 * pt / c["level"] * BPS


def cost(mkt, date, entry_hhmm, exit_hhmm, entry_plus=0, exit_plus=0, stopped=False):
    s = COST["slippage_bps_per_side"]
    c = half_spread_bps(mkt, uk_time(mkt, date, entry_hhmm, entry_plus)) + \
        half_spread_bps(mkt, uk_time(mkt, date, exit_hhmm, exit_plus)) + 2 * s
    if stopped:
        c += COST["stop_slippage_bps_extra"]
    return c / BPS


def day_pairs(days):
    """(previous trading day, day) with the previous day's cash close present."""
    for a, b in zip(days, days[1:]):
        gap = (dt.date.fromisoformat(b["date"]) - dt.date.fromisoformat(a["date"])).days
        if a["p_close"] is not None and gap <= 5:
            yield a, b


def ok_day(d):
    return d["last_hour_bars"] is not None and d["last_hour_bars"] >= 30


# -------------------------------------------------------------------------------------------------------- index arms

def arm_imom(mkt, days, last_half=False):
    o30, c30 = COLS[mkt]
    _, op, cl = SESS[mkt]
    rows = []
    for a, b in day_pairs(days):
        if not ok_day(b) or None in (b[o30], b[c30], b["p_close"]):
            continue
        sig = math.log((b[c30] if last_half else b[o30]) / a["p_close"])
        s = sign(sig)
        if s == 0:
            continue
        g = s * math.log(b["p_close"] / b[c30])
        c = cost(mkt, b["date"], cl, cl, entry_plus=-30)
        rows.append({"date": b["date"], "gross": g, "ret": g - c})
    return rows


def arm_orb(mkt, days):
    _, op, cl = SESS[mkt]
    rows = []
    for b in days:
        if not ok_day(b) or b["orb_dir"] in (None, 0) or b["orb_entry"] is None or b["orb_exit"] is None:
            continue
        g = b["orb_dir"] * math.log(b["orb_exit"] / b["orb_entry"])
        c = cost(mkt, b["date"], op, cl, entry_plus=int(b["orb_entry_min"]), stopped=bool(b["orb_stopped"]))
        rows.append({"date": b["date"], "gross": g, "ret": g - c})
    return rows


def arm_gapfade(mkt, days, thr=0.003):
    _, op, cl = SESS[mkt]
    rows = []
    for a, b in day_pairs(days):
        if not ok_day(b) or None in (b["p_open"], b["p_close"]):
            continue
        g0 = math.log(b["p_open"] / a["p_close"])
        if abs(g0) < thr:
            continue
        d = -sign(g0)
        hit = b["gap_touch_dn"] if g0 > 0 else b["gap_touch_up"]
        px = a["p_close"] if hit else b["p_close"]
        g = d * math.log(px / b["p_open"])
        c = cost(mkt, b["date"], op, cl)
        rows.append({"date": b["date"], "gross": g, "ret": g - c, "filled": bool(hit)})
    return rows


def arm_dow(mkt, days):
    _, op, cl = SESS[mkt]
    base = []
    for b in days:
        if not ok_day(b) or None in (b["p_open"], b["p_close"]):
            continue
        base.append({"date": b["date"], "dow": int(b["dow"]), "r": math.log(b["p_close"] / b["p_open"]),
                     "c": cost(mkt, b["date"], op, cl)})
    pick, sel = {}, {}
    for wd in range(5):
        x = [r["r"] for r in base if r["dow"] == wd and ERA_I["train"][0] <= r["date"] <= ERA_I["train"][1]]
        s = stats(x)
        sel[wd] = {"train_mean_bps": s["mean_bps"], "train_t": s["t"], "n": s["n"]}
        if s["t"] is not None and abs(s["t"]) >= 2.0:
            pick[wd] = sign(s["mean_bps"])
    rows = [{"date": r["date"], "gross": pick[r["dow"]] * r["r"], "ret": pick[r["dow"]] * r["r"] - r["c"]}
            for r in base if r["dow"] in pick]
    return rows, {"weekday_selection_on_train": sel, "traded": {str(k): v for k, v in pick.items()}}


def arm_tom(mkt, days):
    _, op, cl = SESS[mkt]
    good = [b for b in days if ok_day(b) and None not in (b["p_open"], b["p_close"])]
    allday = [b["date"] for b in days]
    by_month = {}
    for d in allday:
        by_month.setdefault(d[:7], []).append(d)
    sel = set()
    months = sorted(by_month)
    for i, m in enumerate(months):
        sel.update(by_month[m][:3])
        if i + 1 < len(months):
            sel.add(by_month[m][-1])
    rows = []
    for b in good:
        if b["date"] in sel:
            g = math.log(b["p_close"] / b["p_open"])
            rows.append({"date": b["date"], "gross": g, "ret": g - cost(mkt, b["date"], op, cl)})
    return rows


FOMC = json.load(open(os.path.join(BT, "ig_search", "inputs", "fomc_dates.json")))
PC_1230 = {"2011-04-27", "2011-06-22", "2011-11-02", "2012-01-25", "2012-04-25", "2012-06-20", "2012-09-13", "2012-12-12"}


def stmt_cols(date):
    if date in PC_1230:
        return "p1225", "p1230", "p1235", "12:30"
    if date < "2013-01-01":
        return "p1410", "p1415", "p1420", "14:15"
    return "p1355", "p1400", "p1405", "14:00"


def arm_fomc(mkt, days, post=False):
    rows = []
    fs = set(FOMC)
    for b in days:
        if b["date"] not in fs or not ok_day(b):
            continue
        pre, at, after, hhmm = stmt_cols(b["date"])
        if not post:
            if None in (b["p_open"], b[pre]):
                continue
            g = math.log(b[pre] / b["p_open"])
            rows.append({"date": b["date"], "gross": g, "ret": g - cost(mkt, b["date"], "09:30", hhmm, exit_plus=-5)})
        else:
            if None in (b[at], b[after], b["p_close"]):
                continue
            s = sign(math.log(b[after] / b[at]))
            if s == 0:
                continue
            g = s * math.log(b["p_close"] / b[after])
            rows.append({"date": b["date"], "gross": g, "ret": g - cost(mkt, b["date"], hhmm, "16:00", entry_plus=5)})
    return rows


BLS = json.load(open(os.path.join(INP, "bls_dates.json")))
MACRO = sorted({r["date"] for k in ("Employment Situation", "Consumer Price Index") for r in BLS[k]})


def arm_macro(mkt, days, mom=False):
    ms = set(MACRO)
    base = []
    for b in days:
        if b["date"] not in ms or not ok_day(b) or None in (b["p_open"], b["p_close"]):
            continue
        r = math.log(b["p_close"] / b["p_open"])
        c = cost(mkt, b["date"], "09:30", "16:00")
        if not mom:
            base.append({"date": b["date"], "gross": r, "ret": r - c})
        elif b["p0830"] is not None and b["p0930"] is not None:
            s = sign(math.log(b["p0930"] / b["p0830"]))
            if s:
                base.append({"date": b["date"], "x": s * r, "c": c})
    if not mom:
        return base, None
    return train_signed(base)


def train_signed(base):
    tr = [r["x"] for r in base if ERA_I["train"][0] <= r["date"] <= ERA_I["train"][1]]
    s = stats(tr)
    k = 1 if (s.get("t") or 0) >= 2.0 and s["mean_bps"] > 0 else (-1 if (s.get("t") or 0) <= -2.0 else 0)
    info = {"train_follow_mean_bps": s.get("mean_bps"), "train_follow_t": s.get("t"),
            "chosen": {1: "follow", -1: "fade", 0: "not traded"}[k]}
    if k == 0:
        return [], info
    return [{"date": r["date"], "gross": k * r["x"], "ret": k * r["x"] - r["c"]} for r in base], info


def arm_eia(days_wti, us_days):
    us = {d["date"] for d in us_days}
    base = []
    for b in days_wti:
        d = dt.date.fromisoformat(b["date"])
        if d.weekday() != 2 or b["date"] not in us:
            continue
        mon, tue = (d - dt.timedelta(days=2)).isoformat(), (d - dt.timedelta(days=1)).isoformat()
        if mon not in us or tue not in us:
            continue
        if None in (b["p1030"], b["p1035"], b["p1430"]):
            continue
        s = sign(math.log(b["p1035"] / b["p1030"]))
        if not s:
            continue
        base.append({"date": b["date"], "x": s * math.log(b["p1430"] / b["p1035"]),
                     "c": cost("WTI", b["date"], "10:35", "14:30")})
    return train_signed(base)


# ------------------------------------------------------------------------------------------ Yahoo hourly, source B

YH_SYM = {"US500": "SPY", "USTECH": "QQQ", "WALLST": "DIA", "DE40": "GDAXI", "UK100": "FTSE", "WTI": "CL_F"}
YH_LAST = {"US500": "15:30", "USTECH": "15:30", "WALLST": "15:30", "DE40": "17:00", "UK100": "16:00"}
YH_FIRST = {"US500": "09:30", "USTECH": "09:30", "WALLST": "09:30", "DE40": "09:00", "UK100": "08:00"}


def yh_days(mkt):
    raw = json.loads(gzip.open(os.path.join(INP, f"yahoo_1h_{YH_SYM[mkt]}.json.gz")).read())["chart"]["result"][0]
    tz = ZoneInfo(raw["meta"]["exchangeTimezoneName"])
    q = raw["indicators"]["quote"][0]
    days = {}
    for i, t in enumerate(raw["timestamp"]):
        o, h, l, c = q["open"][i], q["high"][i], q["low"][i], q["close"][i]
        if None in (o, h, l, c):
            continue
        lt = dt.datetime.fromtimestamp(t, tz)
        days.setdefault(lt.date().isoformat(), {})[lt.strftime("%H:%M")] = (o, h, l, c)
    out = []
    for d in sorted(days):
        bars = days[d]
        if mkt == "WTI":
            out.append({"date": d, "bars": bars})
            continue
        first, last = YH_FIRST[mkt], YH_LAST[mkt]
        if first not in bars or last not in bars:
            continue
        hours = [k for k in sorted(bars) if first <= k <= last]
        out.append({"date": d, "bars": bars, "open": bars[first][0], "first_close": bars[first][3],
                    "last_open": bars[last][0], "close": bars[last][3],
                    "hi": max(bars[k][1] for k in hours), "lo": min(bars[k][2] for k in hours)})
    return out


def yh_arm(mkt, name, info=None):
    cm = "US500" if mkt == "WALLST" else mkt
    days = yh_days(mkt)
    _, op, cl = SESS.get(mkt, SESS["US500"])
    costm = mkt
    rows = []
    for a, b in zip(days, days[1:]):
        r = None
        if name in ("IMOM", "LASTHALF"):
            sig = math.log((b["last_open"] if name == "LASTHALF" else b["first_close"]) / a["close"])
            s = sign(sig)
            if s:
                r = (s * math.log(b["close"] / b["last_open"]), cost(costm, b["date"], cl, cl, entry_plus=-30))
        elif name == "GAPFADE":
            g0 = math.log(b["open"] / a["close"])
            if abs(g0) >= 0.003:
                d = -sign(g0)
                hit = (b["lo"] <= a["close"]) if g0 > 0 else (b["hi"] >= a["close"])
                px = a["close"] if hit else b["close"]
                r = (d * math.log(px / b["open"]), cost(costm, b["date"], op, cl))
        elif name == "DOW":
            wd = str(dt.date.fromisoformat(b["date"]).weekday())
            if info and wd in info["traded"]:
                s = info["traded"][wd]
                r = (s * math.log(b["close"] / b["open"]), cost(costm, b["date"], op, cl))
        elif name in ("TOM_ID", "MACRO_LONG", "FOMC_PRE"):
            if b["date"] in info:
                if name == "FOMC_PRE":
                    if "13:30" in b["bars"]:
                        r = (math.log(b["bars"]["13:30"][0] / b["open"]), cost(costm, b["date"], op, "13:30"))
                else:
                    r = (math.log(b["close"] / b["open"]), cost(costm, b["date"], op, cl))
        if r:
            rows.append({"date": b["date"], "gross": r[0], "ret": r[0] - r[1]})
    return rows


def yh_eia(sgn):
    rows = []
    for b in yh_days("WTI"):
        d = dt.date.fromisoformat(b["date"])
        if d.weekday() != 2 or "10:00" not in b["bars"] or "14:00" not in b["bars"]:
            continue
        s = sign(math.log(b["bars"]["10:00"][3] / b["bars"]["10:00"][0]))
        if s:
            g = sgn * s * math.log(b["bars"]["14:00"][3] / b["bars"]["10:00"][3])
            rows.append({"date": b["date"], "gross": g, "ret": g - cost("WTI", b["date"], "11:00", "15:00")})
    return rows


def compare(a_rows, b_rows):
    """Source B against A on the days both hold."""
    am = {r["date"]: r for r in a_rows}
    both = [(am[r["date"]]["gross"], r["gross"]) for r in b_rows if r["date"] in am]
    out = {"B": stats([r["ret"] for r in b_rows]), "B_span": [b_rows[0]["date"], b_rows[-1]["date"]] if b_rows else None,
           "common_days": len(both)}
    if len(both) >= 5:
        xa, xb = [p[0] for p in both], [p[1] for p in both]
        out["corr_gross_A_B"] = round(st.correlation(xa, xb), 3) if st.pstdev(xa) and st.pstdev(xb) else None
        out["A_on_common_mean_bps"] = round(BPS * sum(xa) / len(xa), 2)
        out["B_on_common_mean_bps"] = round(BPS * sum(xb) / len(xb), 2)
    if b_rows:
        out["B_agrees_in_sign"] = None
        out["second_source_bar"] = None
    return out


def second_source_bar(cmp, a_test_mean):
    if not cmp.get("B", {}).get("n"):
        return "no second source"
    same = sign(cmp["B"]["mean_bps"]) == sign(a_test_mean)
    corr_ok = (cmp.get("corr_gross_A_B") or 0) >= 0.6
    cmp["B_agrees_in_sign"] = same
    cmp["second_source_bar"] = "met" if same and corr_ok else ("sign agrees, feeds differ" if same else "not met")
    return cmp["second_source_bar"]


# ------------------------------------------------------------------------------------------------------ FX weekends

def fx_rows(pair):
    fx = COST["fx"]
    pip = 0.01 if pair.endswith("JPY") else 0.0001
    exit_c = max(1.0, fx["ig_avg_spread_pips"][pair] * pip / fx["levels"][pair] * BPS) / BPS
    out = []
    with gzip.open(os.path.join(INP, f"fxcm_{pair}_weekends.csv.gz"), "rt") as fh:
        for r in csv.DictReader(fh):
            fri, sun = int(r["fri_utc"]), int(r["sun_utc"])
            if dt.datetime.fromtimestamp(fri, UTC).weekday() != 4 or not 40 * 3600 <= sun - fri <= 60 * 3600:
                continue
            fmid = (float(r["fri_bid"]) + float(r["fri_ask"])) / 2
            sb, sa = float(r["sun_bid_open"]), float(r["sun_ask_open"])
            smid = (sb + sa) / 2
            g = math.log(smid / fmid)
            out.append({"sun": sun, "date": dt.datetime.fromtimestamp(sun, UTC).date().isoformat(), "g": g, "fmid": fmid,
                        "sb": sb, "sa": sa, "smid": smid, "m24": float(r["mid_24h"]),
                        "fill": int(r["fill_min"]) if r["fill_min"] else None, "spread_bps": BPS * (sa - sb) / smid,
                        "hx": f(r["hi_to_exit"]), "lx": f(r["lo_to_exit"]), "exit_c": exit_c})
    return out


def monday_2200_utc(sun):
    d = dt.datetime.fromtimestamp(sun, UTC).astimezone(LON).date() + dt.timedelta(days=1)
    while d.weekday() != 0:
        d += dt.timedelta(days=1)
    return int(dt.datetime(d.year, d.month, d.day, 22, 0, tzinfo=LON).timestamp())


def fxw(pair, mult=1.25, G=0.002):
    rows = []
    for w in fx_rows(pair):
        if abs(w["g"]) < G:
            continue
        d = -1 if w["g"] > 0 else 1
        half = (w["sa"] - w["sb"]) / 2 * mult
        entry = w["smid"] + half if d == 1 else w["smid"] - half
        hit = w["fill"] is not None and w["fill"] <= 24 * 60
        px = w["fmid"] if hit else w["m24"]
        exit_t = w["sun"] + (w["fill"] * 60 if hit else 24 * 3600)
        fund = 0.22 / BPS if exit_t > monday_2200_utc(w["sun"]) else 0.0
        gr = d * math.log(px / entry)
        # adverse excursion on the mid until the exit, from the entry
        adv = None
        if w["hx"] is not None and w["lx"] is not None:
            adv = (entry - w["lx"]) / entry if d == 1 else (w["hx"] - entry) / entry
        rows.append({"date": w["date"], "gross": gr, "ret": gr - w["exit_c"] - fund, "adverse": adv,
                     "spread_bps": w["spread_bps"]})
    return rows


def hd_fx_rows(pair, med_spread_bps, mult=1.25, G=0.002):
    fx = COST["fx"]
    pip = 0.01 if pair.endswith("JPY") else 0.0001
    exit_c = max(1.0, fx["ig_avg_spread_pips"][pair] * pip / fx["levels"][pair] * BPS) / BPS
    rows = []
    path = os.path.join(INP, f"hd_{pair}_weekends.csv.gz")
    if not os.path.exists(path):
        return rows, []
    gaps = []
    with gzip.open(path, "rt") as fh:
        for r in csv.DictReader(fh):
            fri, sun = int(r["fri_utc"]), int(r["sun_utc"])
            if dt.datetime.fromtimestamp(fri, UTC).weekday() != 4 or not 40 * 3600 <= sun - fri <= 60 * 3600:
                continue
            fb, sb = float(r["fri_bid"]), float(r["sun_bid_open"])
            g = math.log(sb / fb)
            date = dt.datetime.fromtimestamp(sun, UTC).date().isoformat()
            gaps.append((date, g))
            if abs(g) < G:
                continue
            d = -1 if g > 0 else 1
            hit = r["fill_min"] != "" and int(r["fill_min"]) <= 24 * 60
            px = fb if hit else float(r["bid_24h"])
            gr = d * math.log(px / sb) - med_spread_bps * mult / BPS / 2
            rows.append({"date": date, "gross": gr, "ret": gr - exit_c})
    return rows, gaps


# ---------------------------------------------------------------------------------------------------------- main

def main():
    out = {"params": "params/frozen.json", "arms": {}, "checks": {}}
    out["checks"]["hd_time_zone_frozen_check"] = json.load(open(os.path.join(INP, "hd_tzcheck.json")))
    out["checks"]["hd_time_zone_deviation_3"] = {m: sorted(tz_fails(m)) for m in INDEX + ["WTI"]}
    days = {m: load_days(m) for m in INDEX + ["WTI"]}
    out["checks"]["hd_days"] = {m: {"days": len(v), "first": v[0]["date"], "last": v[-1]["date"]} for m, v in days.items()}
    # the 08:30 ET release minute should move more on BLS days than on other days (a check of the dates and the clock)
    chk = {}
    for m in ("US500", "USTECH"):
        ms = set(MACRO)
        a = [abs(math.log(d["p0930"] / d["p0830"])) for d in days[m] if d["p0830"] and d["p0930"] and d["date"] in ms]
        b = [abs(math.log(d["p0930"] / d["p0830"])) for d in days[m] if d["p0830"] and d["p0930"] and d["date"] not in ms]
        chk[m] = {"release_days_median_abs_0830_0930_bps": round(BPS * st.median(a), 2),
                  "other_days_median_bps": round(BPS * st.median(b), 2), "n_release": len(a)}
    out["checks"]["release_day_move"] = chk

    A = out["arms"]
    yh_days_cache = {}
    for m in INDEX:
        d = days[m]
        for name, rows, info in (
                ("IMOM", arm_imom(m, d), None),
                ("LASTHALF", arm_imom(m, d, last_half=True), None),
                ("ORB30", arm_orb(m, d), None),
                ("GAPFADE", arm_gapfade(m, d), None),
                ("DOW",) + arm_dow(m, d),
                ("TOM_ID", arm_tom(m, d), None)):
            rep = report(rows, ERA_I, {"selection": info} if info else None)
            if name in ("IMOM", "LASTHALF", "GAPFADE", "DOW", "TOM_ID"):
                yinfo = info if name == "DOW" else None
                if name == "TOM_ID":
                    yinfo = {r["date"] for r in rows}
                b = yh_arm(m, name, yinfo)
                rep["second_source"] = compare(rows, b)
                second_source_bar(rep["second_source"], rep["test"].get("mean_bps", 0))
            if name == "GAPFADE":
                rep["fill_share"] = round(sum(r["filled"] for r in rows) / max(1, len(rows)), 3)
            A[f"{name}.{m}"] = rep
    for m in ("US500", "USTECH"):
        d = days[m]
        rows = arm_fomc(m, d)
        rep = report(rows, ERA_I)
        rep["second_source"] = compare(rows, yh_arm(m, "FOMC_PRE", set(FOMC)))
        second_source_bar(rep["second_source"], rep["test"].get("mean_bps", 0))
        A[f"FOMC_PRE.{m}"] = rep
        A[f"FOMC_POST.{m}"] = report(arm_fomc(m, d, post=True), ERA_I)
        rows, _ = arm_macro(m, d)
        rep = report(rows, ERA_I)
        rep["second_source"] = compare(rows, yh_arm(m, "MACRO_LONG", set(MACRO)))
        second_source_bar(rep["second_source"], rep["test"].get("mean_bps", 0))
        A[f"MACRO_LONG.{m}"] = rep
        rows, info = arm_macro(m, d, mom=True)
        A[f"MACRO_MOM.{m}"] = report(rows, ERA_I, {"selection": info}) if rows else {"selection": info, "verdict_first_source": "dead (no sign chosen on train)"}
    rows, info = arm_eia(days["WTI"], days["US500"])
    if rows:
        rep = report(rows, ERA_I, {"selection": info})
        rep["second_source"] = compare(rows, yh_eia(1 if info["chosen"] == "follow" else -1))
        second_source_bar(rep["second_source"], rep["test"].get("mean_bps", 0))
        A["EIA.WTI"] = rep
    else:
        A["EIA.WTI"] = {"selection": info, "verdict_first_source": "dead (no sign chosen on train)"}
    # Wall St: Yahoo DIA only, one short era
    for name in ("IMOM", "LASTHALF", "GAPFADE"):
        rows = yh_arm("WALLST", name)
        A[f"{name}.WALLST"] = {"YH_only": stats([r["ret"] for r in rows]),
                               "span": [rows[0]["date"], rows[-1]["date"]] if rows else None,
                               "verdict_first_source": "at most demo-forward (one two-year source)"}

    # FX Sunday open
    F = out["fx"] = {}
    for pair in P["families"]["FXW_X"]["pairs_new"] + list(P["families"]["FXW_X"]["pairs_extended"]):
        if not os.path.exists(os.path.join(INP, f"fxcm_{pair}_weekends.csv.gz")):
            F[pair] = {"missing": "no FXCM weekend table"}
            continue
        rows = fxw(pair)
        rows1 = fxw(pair, mult=1.0)
        alls = fx_rows(pair)
        med_sp = st.median(w["spread_bps"] for w in alls) if alls else None
        rep = report(rows, ERA_F)
        rep["fxcm_spread_x1_test"] = stats(split(rows1, ERA_F)[1])
        rep["weekends"] = len(alls)
        rep["sunday_open_spread_median_bps"] = round(med_sp, 2) if med_sp else None
        rep["pre_2016"] = stats([r["ret"] for r in rows if r["date"] < "2016-01-01"])
        # FXCM's 2012 files open every week at Friday's close (all 52 gaps exactly 0, every pair): no trade comes of them
        rep["zero_gap_weekends_by_year"] = {y: sum(1 for w in alls if w["date"][:4] == y and w["g"] == 0)
                                            for y in sorted({w["date"][:4] for w in alls})}
        rep["from_2016"] = stats([r["ret"] for r in rows if r["date"] >= "2016-01-01"])
        hrows, hgaps = hd_fx_rows(pair, med_sp or 0)
        cmpd = {"B": stats([r["ret"] for r in hrows]), "B_test": stats(split(hrows, ERA_F)[1]),
                "B_train": stats(split(hrows, ERA_F)[0]),
                "B_pre_2016": stats([r["ret"] for r in hrows if r["date"] < "2016-01-01"]),
                "B_from_2016": stats([r["ret"] for r in hrows if r["date"] >= "2016-01-01"])}
        gm = {r["date"]: r["g"] for r in alls}
        common = [(gm[d], g) for d, g in hgaps if d in gm]
        if len(common) > 10:
            cmpd["gap_corr_fxcm_hd"] = round(st.correlation([c[0] for c in common], [c[1] for c in common]), 3)
            cmpd["common_weekends"] = len(common)
        rep["second_source"] = cmpd
        if hrows:
            same = sign(cmpd["B_test"].get("mean_bps", 0) or 0) == sign(rep["test"].get("mean_bps", 0) or 0)
            cmpd["second_source_bar"] = "met" if same and (cmpd.get("gap_corr_fxcm_hd") or 0) >= 0.6 else \
                ("sign agrees, feeds differ" if same else "not met")
        adv = [r["adverse"] for r in rows if r["adverse"] is not None]
        if adv:
            adv.sort()
            rep["adverse_to_exit_bps"] = {"p50": round(BPS * adv[len(adv) // 2], 1), "p90": round(BPS * adv[int(0.9 * len(adv))], 1),
                                          "max": round(BPS * adv[-1], 1)}
        F[pair] = rep
    os.makedirs(os.path.join(HERE, "results"), exist_ok=True)
    name = "search_inclusive_close.json" if INCLUSIVE_CLOSE else "search.json"
    json.dump(out, open(os.path.join(HERE, "results", name), "w"), indent=1, sort_keys=True)


if __name__ == "__main__":
    main()
