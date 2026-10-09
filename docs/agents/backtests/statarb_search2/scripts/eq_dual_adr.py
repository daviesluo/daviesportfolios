"""DCS (dual-class switching) and ADRX (UK ordinary against its US ADR), from the committed Yahoo inputs.

DCS, the rule written before the first run: a holder who wants the company, not a pair, holds whichever class is cheap.
  x_t = ln(close_A / close_B) (split-adjusted closes); mu_t = the mean of x over the 60 trading days before t.
  Holding B, switch to A when x_t - mu_t < -k; holding A, switch to B when x_t - mu_t > +k; k in {0.5, 1, 2} %.
  The switch executes at the NEXT day's close (no look-ahead). Each switch pays c (both legs together):
  c in {5, 20, 35} bps (a USD account on liquid lines / thin lines / a GBP account's 2 x 0.15 % FX on top).
  Result: the held position's log return minus the static 50/50 mix's, per year, net of switches.
ADRX: the ADR premium p_t = ln(ADR_usd / (ratio x ord_pence / 100 x GBPUSD)) on 5-minute bars both lines print, de-meaned
  by its rolling median over the previous 5 days; how often |p - median| clears a GBP account's switch costs
  (ordinary -> ADR: 0.15 % FX; ADR -> ordinary: 0.15 % FX + 0.5 % stamp duty; a round trip 0.80 %), plus spreads.
Output: results/eq_dual_adr.json (deterministic).
"""
import gzip, json, math, os, statistics as st
import datetime as dt

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
Y = os.path.join(HERE, "inputs", "yahoo")
DUALS = [("GOOGL", "GOOG"), ("FOXA", "FOX"), ("NWSA", "NWS"), ("LBRDK", "LBRDA"), ("BF-B", "BF-A"), ("UAA", "UA"),
         ("Z", "ZG"), ("LEN", "LEN-B"), ("HEI", "HEI-A"), ("MOG-A", "MOG-B")]
ADRS = [("SHEL", "SHEL.L", 2), ("BP", "BP.L", 6), ("HSBC", "HSBA.L", 5), ("GSK", "GSK.L", 2), ("UL", "ULVR.L", 1),
        ("RIO", "RIO.L", 1), ("BTI", "BATS.L", 1), ("DEO", "DGE.L", 4), ("NGG", "NG.L", 5), ("BCS", "BARC.L", 4),
        ("LYG", "LLOY.L", 4), ("VOD", "VOD.L", 10)]


def series(setname, sym):
    p = os.path.join(Y, setname, sym + ".json.gz")
    if not os.path.exists(p):
        return {}
    j = json.loads(gzip.open(p).read())["chart"]["result"][0]
    ts, cl = j["timestamp"], j["indicators"]["quote"][0]["close"]
    return {t: c for t, c in zip(ts, cl) if c}


def zero_volume_share(sym, last=500):
    p = os.path.join(Y, "dual_d", sym + ".json.gz")
    q = json.loads(gzip.open(p).read())["chart"]["result"][0]["indicators"]["quote"][0]
    v = [x for x in q["volume"][-last:] if x is not None]
    return sum(1 for x in v if x == 0) / max(len(v), 1)


def daily(sym):
    s = series("dual_d", sym)
    return {dt.datetime.utcfromtimestamp(t).date(): c for t, c in s.items()}


def eq1():
    out = {}
    for a, b in DUALS:
        A, B = daily(a), daily(b)
        days = sorted(set(A) & set(B))
        if len(days) < 300:
            out[f"{a}/{b}"] = {"days": len(days), "skipped": "too short"}
            continue
        x = [math.log(A[d] / B[d]) for d in days]
        ra = [math.log(A[days[i]] / A[days[i - 1]]) for i in range(1, len(days))]
        rb = [math.log(B[days[i]] / B[days[i - 1]]) for i in range(1, len(days))]
        dev = [None] * len(days)
        for i in range(60, len(days)):
            dev[i] = x[i] - sum(x[i - 60:i]) / 60
        dd = [v for v in dev if v is not None]
        # AR(1) of dev
        pairs = [(dev[i - 1], dev[i]) for i in range(61, len(days))]
        mx = sum(p[0] for p in pairs) / len(pairs)
        my = sum(p[1] for p in pairs) / len(pairs)
        phi = sum((p[0] - mx) * (p[1] - my) for p in pairs) / sum((p[0] - mx) ** 2 for p in pairs)
        hl = math.log(0.5) / math.log(phi) if 0 < phi < 1 else None
        zv = max(zero_volume_share(a), zero_volume_share(b))
        res = {"from": str(days[0]), "to": str(days[-1]), "days": len(days),
               "zero_volume_share_last500": round(zv, 3),
               "void": ("a class prints no trade on more than 5 % of days: its closes are stale" if zv > 0.05 else None),
               "spread_now_pct": round(100 * x[-1], 2), "spread_mean_pct": round(100 * sum(x) / len(x), 2),
               "dev_sd_pct": round(100 * st.pstdev(dd), 3), "dev_p95_abs_pct": round(100 * sorted(abs(v) for v in dd)[int(0.95 * len(dd))], 3),
               "half_life_days": round(hl, 1) if hl else None, "rules": {}}
        years = (len(days) - 61) / 252
        last2 = [i for i, d in enumerate(days) if d >= days[-1] - dt.timedelta(days=730)][0]
        for k in (0.005, 0.01, 0.02):
            for c in (0.0005, 0.002, 0.0035):
                hold, switches, pnl, pnl2, sw2 = "B", 0, 0.0, 0.0, 0
                pending = None
                for i in range(61, len(days)):
                    r = (ra[i - 1] if hold == "A" else rb[i - 1]) - 0.5 * (ra[i - 1] + rb[i - 1])
                    pnl += r
                    if i >= last2:
                        pnl2 += r
                    if pending:  # the switch decided yesterday executes at today's close
                        hold = pending
                        pending = None
                        switches += 1
                        pnl -= c
                        if i >= last2:
                            pnl2 -= c
                            sw2 += 1
                    if dev[i] is not None:
                        if hold == "B" and dev[i] < -k:
                            pending = "A"
                        elif hold == "A" and dev[i] > k:
                            pending = "B"
                res["rules"][f"k{k*100:g}_c{c*1e4:g}bp"] = {
                    "switches_per_year": round(switches / years, 1), "excess_pct_per_year": round(100 * pnl / years, 3),
                    "last2y_excess_pct_per_year": round(100 * pnl2 / 2, 3), "last2y_switches": sw2}
        out[f"{a}/{b}"] = res
    return out


def eq2():
    fx = series("adr_5m", "GBPUSD=X")
    out = {}
    for adr, ordn, ratio in ADRS:
        A, O = series("adr_5m", adr), series("adr_5m", ordn)
        ts = sorted(t for t in set(A) & set(O))
        # the FX bar at or before t
        fxt = sorted(fx)
        j, prem = 0, []
        for t in ts:
            while j + 1 < len(fxt) and fxt[j + 1] <= t:
                j += 1
            if not fxt or fxt[j] > t or t - fxt[j] > 900:
                continue
            prem.append((t, math.log(A[t] / (ratio * O[t] / 100.0 * fx[fxt[j]]))))
        if len(prem) < 200:
            out[adr] = {"bars": len(prem), "skipped": "too few overlapping bars"}
            continue
        devs, day_of = [], []
        for i, (t, p) in enumerate(prem):
            hist = [q for (u, q) in prem[max(0, i - 400):i] if t - u <= 5 * 86400]
            if len(hist) >= 50:
                devs.append(p - st.median(hist))
                day_of.append(dt.datetime.utcfromtimestamp(t).date())
        # a whole day shifted (ex-dividend dates that differ between the lines, a stale FX day) is not an intraday
        # gap a switch can take: "transient" counts only bars whose own day's median |dev| is under 30 bps
        by_day = {}
        for d, v in zip(day_of, devs):
            by_day.setdefault(d, []).append(abs(v))
        calm = {d for d, v in by_day.items() if st.median(v) < 0.003}
        tdevs = [v for d, v in zip(day_of, devs) if d in calm]
        a = sorted(abs(v) for v in devs)
        def share_over(x):
            return round(sum(1 for v in devs if abs(v) > x) / len(devs), 4)
        out[adr] = {"ordinary": ordn, "ratio": ratio, "bars": len(prem), "scored_bars": len(devs),
                    "premium_median_pct": round(100 * st.median(p for _, p in prem), 3),
                    "dev_sd_bps": round(1e4 * st.pstdev(devs), 1), "dev_p95_abs_bps": round(1e4 * a[int(0.95 * len(a))], 1),
                    "dev_max_abs_bps": round(1e4 * a[-1], 1), "share_over_15bps": share_over(0.0015),
                    "share_over_65bps": share_over(0.0065), "share_over_80bps": share_over(0.008),
                    "shifted_days": sorted(str(d) for d in by_day if d not in calm),
                    "transient_share_over_65bps": round(sum(1 for v in tdevs if abs(v) > 0.0065) / max(len(tdevs), 1), 4),
                    "transient_share_over_80bps": round(sum(1 for v in tdevs if abs(v) > 0.008) / max(len(tdevs), 1), 4),
                    "transient_bars_over_80bps": sum(1 for v in tdevs if abs(v) > 0.008)}
    return out


if __name__ == "__main__":
    res = {"DCS_dual_class": eq1(), "ADRX_adr": eq2()}
    json.dump(res, open(os.path.join(HERE, "results", "eq_dual_adr.json"), "w"), indent=1, sort_keys=True)
    for k, v in res["DCS_dual_class"].items():
        if "rules" in v:
            r = v["rules"]
            print(f"{k:12s} {v['from']}..{v['to']} dev_sd {v['dev_sd_pct']}% hl {v['half_life_days']}d now {v['spread_now_pct']}% | "
                  + " ".join(f"{kk}:{r[kk]['excess_pct_per_year']:+.2f}/{r[kk]['last2y_excess_pct_per_year']:+.2f}({r[kk]['switches_per_year']})"
                             for kk in ("k1_c5bp", "k1_c20bp", "k2_c35bp")))
        else:
            print(k, v)
    for k, v in res["ADRX_adr"].items():
        print(k, v)
