"""FXW (fade the weekend gap) and FIX (reversal after the London 4 pm fix at month end), from inputs/fx/.

FXW, the rule written before the first run: g = ln(Sunday's first mid / Friday's last mid). A true weekend only: Friday's
last minute on a Friday (UTC), the Sunday open 40-60 h later (a missing week or a holiday is not a weekend). When
|g| >= G (G in 5, 10, 20, 40 bps), trade against the gap:
  E0: at the Sunday open, at the ACTUAL first-minute bid/ask (FXCM's own spread); take profit when the mid touches
      Friday's close (the minute recorded by the pull), else close at +24 h's mid; exit cost 1 bp (a normal spread).
  E1: one hour later, at the +1 h mid plus 1 bp; close at +24 h's mid plus 1 bp (no take-profit; spreads have normalised).
FIX: on each month's last London weekday, r_pre = ln(m16:00 / m15:00); at 16:05 trade against r_pre's sign, close at
  18:00; 1.5 bps round trip. The same rule on every other weekday is the control (is month end special?). Also the
  absolute pre-fix move on month ends against other days.
Output: results/fx_weekend_fix.json (deterministic).
"""
import csv, gzip, io, json, math, os, statistics as st
import datetime as dt

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FX = os.path.join(HERE, "inputs", "fx")
PAIRS = ["EURUSD", "GBPUSD", "USDJPY", "AUDUSD"]


def rows(name):
    return list(csv.DictReader(io.StringIO(gzip.open(os.path.join(FX, name)).read().decode())))


def summ(x):
    if not x:
        return {"n": 0}
    m = sum(x) / len(x)
    sd = st.pstdev(x) if len(x) > 1 else 0
    return {"n": len(x), "mean_bps": round(1e4 * m, 2), "t": round(m / (sd / math.sqrt(len(x))), 2) if sd else None,
            "hit": round(sum(1 for v in x if v > 0) / len(x), 3), "total_bps": round(1e4 * sum(x), 1)}


def fx1():
    out = {}
    for p in PAIRS:
        res = {}
        wk = []
        for r in rows(f"fxcm_{p}_weekends.csv.gz"):
            fri, sun = int(r["fri_utc"]), int(r["sun_utc"])
            if dt.datetime.utcfromtimestamp(fri).weekday() != 4 or not (40 * 3600 <= sun - fri <= 60 * 3600):
                continue
            fmid = (float(r["fri_bid"]) + float(r["fri_ask"])) / 2
            sb, sa = float(r["sun_bid_open"]), float(r["sun_ask_open"])
            smid = (sb + sa) / 2
            wk.append(dict(year=dt.datetime.utcfromtimestamp(sun).year, g=math.log(smid / fmid), fmid=fmid, sb=sb, sa=sa,
                           smid=smid, m1=float(r["mid_1h"]), m24=float(r["mid_24h"]),
                           fill=(int(r["fill_min"]) if r["fill_min"] else None), spread_bps=1e4 * (sa - sb) / smid))
        res["weekends"] = len(wk)
        res["gap_abs_bps"] = {"median": round(1e4 * st.median(abs(w["g"]) for w in wk), 2),
                              "p90": round(1e4 * sorted(abs(w["g"]) for w in wk)[int(0.9 * len(wk))], 2)}
        res["sunday_open_spread_bps_median"] = round(st.median(w["spread_bps"] for w in wk), 2)
        for G in (0.0005, 0.001, 0.002, 0.004):
            e0, e1, e0b, byyear = [], [], [], {}
            for w in wk:
                if abs(w["g"]) < G:
                    continue
                d = -1 if w["g"] > 0 else 1  # fade
                entry = w["sa"] if d == 1 else w["sb"]
                if w["fill"] is not None and w["fill"] <= 24 * 60:
                    pnl0 = d * math.log(w["fmid"] / entry) - 1e-4
                else:
                    pnl0 = d * math.log(w["m24"] / entry) - 1e-4
                pnl1 = d * math.log(w["m24"] / w["m1"]) - 2e-4
                e0b.append(d * math.log(w["m24"] / entry) - 1e-4)
                e0.append(pnl0)
                e1.append(pnl1)
                byyear.setdefault(w["year"], []).append(pnl0)
            res[f"G{G*1e4:g}bp"] = {"E0_at_open": summ(e0), "E1_one_hour_later": summ(e1),
                                     "E0b_at_open_no_take_profit (added after the first run)": summ(e0b),
                                     "E0_by_year_bps": {y: round(1e4 * sum(v), 1) for y, v in sorted(byyear.items())}}
        out[p] = res
    return out


def fx2():
    out = {}
    for p in PAIRS:
        days = []
        for r in rows(f"fxcm_{p}_fix.csv.gz"):
            try:
                v = {k: float(r[k]) for k in ("l1500", "l1600", "l1605", "l1800")}
            except ValueError:
                continue
            days.append((dt.date.fromisoformat(r["date"]), v))
        last_of_month = {}
        for d, _ in days:
            k = (d.year, d.month)
            last_of_month[k] = max(last_of_month.get(k, d), d)
        me, other, me_abs, other_abs, by_year = [], [], [], [], {}
        for d, v in days:
            pre = math.log(v["l1600"] / v["l1500"])
            post = math.log(v["l1800"] / v["l1605"])
            if pre == 0:
                continue
            pnl = (-1 if pre > 0 else 1) * post - 1.5e-4
            if d == last_of_month[(d.year, d.month)]:
                me.append(pnl)
                me_abs.append(abs(pre))
                by_year.setdefault(d.year, []).append(pnl)
            else:
                other.append(pnl)
                other_abs.append(abs(pre))
        out[p] = {"month_ends": summ(me), "other_days": summ(other),
                  "pre_fix_abs_move_bps_median": {"month_end": round(1e4 * st.median(me_abs), 2),
                                                  "other": round(1e4 * st.median(other_abs), 2)},
                  "month_end_by_year_bps": {y: round(1e4 * sum(v), 1) for y, v in sorted(by_year.items())}}
    return out


if __name__ == "__main__":
    res = {"FXW_weekend_gap": fx1(), "FIX_month_end_fix": fx2()}
    json.dump(res, open(os.path.join(HERE, "results", "fx_weekend_fix.json"), "w"), indent=1, sort_keys=True)
    for p, r in res["FXW_weekend_gap"].items():
        print(p, r["weekends"], r["gap_abs_bps"], "spread", r["sunday_open_spread_bps_median"])
        for G in ("G5bp", "G10bp", "G20bp", "G40bp"):
            print("  ", G, "E0", r[G]["E0_at_open"], "E0b", r[G]["E0b_at_open_no_take_profit (added after the first run)"], "E1", r[G]["E1_one_hour_later"], r[G]["E0_by_year_bps"] if p == "AUDUSD" else "")
    for p, r in res["FIX_month_end_fix"].items():
        print(p, r)
