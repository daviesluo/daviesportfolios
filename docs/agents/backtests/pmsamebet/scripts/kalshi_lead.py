"""PMSAMEBET step 8: does Kalshi lead Polymarket at the minute scale on the same bet? (Kalshi as a reference only.)

Matched pairs (resolution texts compared in the review §5): the Fed's October 2026 decision (no change, +25 bps),
Senate and House control after the 2026 midterms, and the Texas Senate race (Republican).

Kalshi: keyless 1-minute candles (`/series/{s}/markets/{t}/candlesticks`, period 1), the mid = (yes bid close + yes ask
close) / 2. Polymarket: the keyless data API's taker prints (the newest, to the API's offset cap), each turned into the
YES price (a NO print at q is 1 − q), a minute's price the size-weighted mean of its prints, carried forward.

Measured over the minutes both series cover:
  - the correlation of one-minute changes, Kalshi at t against Polymarket at t + k, k = −5…+5;
  - the same for five-minute changes, Polymarket shifted by k five-minute steps, k = −3…+3;
  - event study: every Kalshi minute whose mid moved >= 1 cent (THRESH); Polymarket's move in the same direction from the
    minute before to t + h (h = 0, 1, 2, 5, 15), as a share of Kalshi's move, and whether Polymarket moved first;
  - a Polymarket-only rule: after such a Kalshi minute, if Polymarket has moved less than half of it, buy Polymarket in
    the direction at the first ask print (a taker BUY of that side) in the next two minutes, marked at Polymarket's
    minute price 15 and 60 minutes later; politics and Fed markets charge no taker fee (Gamma's feeSchedule rate 0).

usage: PM_DATA=<scratch> python3 -I docs/agents/backtests/pmsamebet/scripts/kalshi_lead.py <results dir>
"""
import json
import os
import statistics
import sys
import time
from collections import defaultdict

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pmnet  # noqa: E402

pmnet.MIN_GAP["api.elections.kalshi.com"] = 2.5
DAYS = 7  # the joint window ends at the newest print and reaches back at most this far
THRESH = 0.01  # a Kalshi minute whose mid moved this much (both books tick in cents) is an event
K = "https://api.elections.kalshi.com/trade-api/v2"
DATA_API = "https://data-api.polymarket.com"
GAMMA = "https://gamma-api.polymarket.com"

PAIRS = [
    ("FED-OCT-HOLD", "KXFEDDECISION", "KXFEDDECISION-26OCT-H0", "fed-decision-in-october-20260617190323537", "no change"),
    ("FED-OCT-H25", "KXFEDDECISION", "KXFEDDECISION-26OCT-H25", "fed-decision-in-october-20260617190323537", "increase interest rates by 25"),
    ("SENATE-R", "CONTROLS", "CONTROLS-2026-R", "which-party-will-win-the-senate-in-2026", "Republican Party control"),
    ("HOUSE-R", "CONTROLH", "CONTROLH-2026-R", "which-party-will-win-the-house-in-2026", "Republican Party control"),
    ("TXSEN-R", "SENATETX", "SENATETX-26-R", "texas-senate-election-winner", "Republicans win"),
]


def pm_market(slug, pat):
    e = pmnet.get(GAMMA + "/events", {"slug": slug})[0]
    for m in e["markets"]:
        if pat.lower() in m["question"].lower():
            return m
    raise SystemExit(f"no market {pat} in {slug}")


def pm_prints(cid, yes_token):
    cache = os.path.join(pmnet.DATA, f"pmprints_{cid}_{int(time.time()) // 3600}.json")
    if os.path.exists(cache):
        return [tuple(x) for x in pmnet.load(cache)]
    rows = _pm_prints(cid, yes_token)
    pmnet.dump(cache, rows)
    return rows


def _pm_prints(cid, yes_token):
    out, offset = [], 0
    while offset <= 10000:
        try:
            d = pmnet.get(DATA_API + "/trades", {"market": cid, "limit": 500, "offset": offset, "takerOnly": "true"})
        except RuntimeError:
            break
        if not d:
            break
        out += d
        if len(d) < 500:
            break
        offset += 500
    rows = []
    for x in out:
        p = float(x["price"])
        yes = p if x["asset"] == yes_token else 1.0 - p
        # which side's ask the print shows: a BUY of YES or a SELL of NO shows the YES ask; the others the NO ask
        shows_yes_ask = (x["side"] == "BUY") == (x["asset"] == yes_token)
        rows.append((int(x["timestamp"]), yes, float(x["size"]), shows_yes_ask))
    rows.sort()
    return rows


def k_get(url, params):
    """Kalshi's public API answers a burst with 429 for a while: wait up to ~4 minutes before giving up."""
    for i in range(8):
        try:
            return pmnet.get(url, params, tries=2)
        except RuntimeError as e:
            if "429" not in str(e) or i == 7:
                raise
            time.sleep(30)


def k_candles(series, ticker, t0, t1):
    cache = os.path.join(pmnet.DATA, f"kalshi_{ticker}_{t0}_{t1}.json")
    if os.path.exists(cache):
        return {int(k): v for k, v in pmnet.load(cache).items()}
    out = {}
    s = t0
    while s < t1:
        e = min(t1, s + 86400)
        d = k_get(f"{K}/series/{series}/markets/{ticker}/candlesticks",
                  {"start_ts": s, "end_ts": e, "period_interval": 1})
        for c in d.get("candlesticks") or []:
            try:
                b = float(c["yes_bid"]["close_dollars"])
                a = float(c["yes_ask"]["close_dollars"])
            except (KeyError, TypeError, ValueError):
                continue
            if a > 0 and a >= b:
                out[int(c["end_period_ts"]) // 60] = (a + b) / 2
        s = e
    pmnet.dump(cache, {str(k): v for k, v in out.items()})
    return out


def corr(x, y):
    if len(x) < 30:
        return None
    mx, my = statistics.fmean(x), statistics.fmean(y)
    vx = sum((a - mx) ** 2 for a in x)
    vy = sum((b - my) ** 2 for b in y)
    if vx == 0 or vy == 0:
        return None
    return sum((a - mx) * (b - my) for a, b in zip(x, y)) / (vx * vy) ** 0.5


def main():
    res = sys.argv[1]
    lines = [f"read {time.strftime('%Y-%m-%dT%H:%MZ', time.gmtime())}"]
    allrows = {}
    for name, series, kt, slug, pat in PAIRS:
        m = pm_market(slug, pat)
        yes_tok = json.loads(m["clobTokenIds"])[0]
        pr = pm_prints(m["conditionId"], yes_tok)
        if not pr:
            lines.append(f"{name}: no Polymarket prints")
            continue
        t1 = pr[-1][0]
        pr = [x for x in pr if x[0] >= t1 - DAYS * 86400]
        t0 = pr[0][0]
        t0, t1 = t0 - t0 % 3600, t1 - t1 % 3600 + 3600
        kc = k_candles(series, kt, t0, t1)
        # Polymarket minute price: size-weighted mean of the minute's YES prices, carried forward
        pm_min = defaultdict(lambda: [0.0, 0.0])
        for ts, yes, sz, _ in pr:
            pm_min[ts // 60][0] += yes * sz
            pm_min[ts // 60][1] += sz
        m0, m1 = t0 // 60, t1 // 60
        P, K_ = {}, {}
        last_p = last_k = None
        for mm in range(m0, m1 + 1):
            if mm in pm_min and pm_min[mm][1] > 0:
                last_p = pm_min[mm][0] / pm_min[mm][1]
            if mm in kc:
                last_k = kc[mm]
            if last_p is not None and last_k is not None:
                P[mm], K_[mm] = last_p, last_k
        mins = sorted(P)
        dP = {mm: P[mm] - P[mm - 1] for mm in mins if mm - 1 in P}
        dK = {mm: K_[mm] - K_[mm - 1] for mm in mins if mm - 1 in K_}
        # the levels and hourly changes, as a check that the two series follow the same thing at all
        diffs = [abs(K_[mm] - P[mm]) for mm in mins]
        hrs = [mm for mm in mins if mm % 60 == 0 and mm - 60 in P]
        cch = corr([K_[mm] - K_[mm - 60] for mm in hrs], [P[mm] - P[mm - 60] for mm in hrs])
        level = {"mean_abs_gap": round(statistics.fmean(diffs), 4), "median_abs_gap": round(statistics.median(diffs), 4),
                 "hourly_change_corr": None if cch is None else round(cch, 3), "hours": len(hrs),
                 "kalshi_range": [round(min(K_.values()), 3), round(max(K_.values()), 3)],
                 "poly_range": [round(min(P.values()), 3), round(max(P.values()), 3)]}
        # five-minute changes too: a print price bounces between bid and ask, which buries a one-minute signal
        cc5 = {}
        for k in range(-3, 4):
            xs, ys = [], []
            for mm in mins:
                if mm % 5 or mm - 5 not in K_ or mm + 5 * k not in P or mm + 5 * k - 5 not in P:
                    continue
                xs.append(K_[mm] - K_[mm - 5])
                ys.append(P[mm + 5 * k] - P[mm + 5 * k - 5])
            c = corr(xs, ys)
            cc5[k] = None if c is None else round(c, 3)
        cc = {}
        for k in range(-5, 6):
            xs, ys = [], []
            for mm, v in dK.items():
                if mm + k in dP:
                    xs.append(v)
                    ys.append(dP[mm + k])
            c = corr(xs, ys)
            cc[k] = None if c is None else round(c, 3)
        # event study and the Polymarket-only rule
        ev = []
        for mm, v in dK.items():
            if abs(v) < THRESH or mm - 1 not in P:
                continue
            sgn = 1 if v > 0 else -1
            base = P[mm - 1]
            row = {"m": mm, "dk": round(v, 4)}
            for h in (0, 1, 2, 5, 15):
                if mm + h in P:
                    row[f"f{h}"] = round(sgn * (P[mm + h] - base) / abs(v), 3)
            row["pm_first"] = (mm - 2 in P) and sgn * (P[mm - 1] - P[mm - 2]) >= 0.5 * abs(v)
            # rule: Polymarket has moved less than half by the end of minute mm
            if mm in P and sgn * (P[mm] - base) < 0.5 * abs(v):
                lo, hi = (mm + 1) * 60, (mm + 3) * 60
                entry = None
                for ts, yes, sz, shows_yes_ask in pr:
                    if ts < lo:
                        continue
                    if ts >= hi:
                        break
                    if sgn > 0 and shows_yes_ask:
                        entry = yes
                        break
                    if sgn < 0 and not shows_yes_ask:
                        entry = yes      # a NO bought at 1 − yes
                        break
                if entry is not None:
                    for h in (15, 60):
                        if mm + h in P:
                            row[f"pnl{h}"] = round(sgn * (P[mm + h] - entry), 4)
            ev.append(row)
        allrows[name] = {"t0": t0, "t1": t1, "pm_prints": len(pr), "k_minutes": len(kc), "both_minutes": len(P),
                         "cc": cc, "cc5": cc5, "level": level, "events": ev}
        span_h = (t1 - t0) / 3600
        lines.append(f"\n{name}: Polymarket {m['question']} ({len(pr)} prints over {span_h:.1f} h, "
                     f"{time.strftime('%m-%d %H:%M', time.gmtime(t0))} to {time.strftime('%m-%d %H:%M', time.gmtime(t1))} UTC); "
                     f"Kalshi {kt} candles {len(kc)}; joint minutes {len(P)}")
        lines.append(f"  levels: |Kalshi mid − Polymarket| mean {level['mean_abs_gap']}, median {level['median_abs_gap']}; "
                     f"Kalshi {level['kalshi_range']}, Polymarket {level['poly_range']}; "
                     f"hourly changes corr {level['hourly_change_corr']} over {level['hours']} hours")
        lines.append("  corr(dKalshi_t, dPoly_t+k): " + ", ".join(f"k={k}:{cc[k]}" for k in range(-5, 6)))
        lines.append("  corr of 5-minute changes, Polymarket shifted by k five-minute steps: "
                     + ", ".join(f"k={k}:{cc5[k]}" for k in range(-3, 4)))
        n = len(ev)
        lines.append(f"  Kalshi minutes moving >= {100 * THRESH:.0f}c: {n}; Polymarket moved first (>= half, the minute before) in "
                     f"{sum(1 for e in ev if e['pm_first'])}")
        for h in (0, 1, 2, 5, 15):
            xs = [e[f'f{h}'] for e in ev if f'f{h}' in e]
            if xs:
                lines.append(f"  share of Kalshi's move Polymarket made by t+{h}: median {statistics.median(xs):.2f}, mean {statistics.fmean(xs):.2f} (n {len(xs)})")
        for h in (15, 60):
            xs = [e[f'pnl{h}'] for e in ev if f'pnl{h}' in e]
            if xs:
                lines.append(f"  rule P&L a share, marked at t+{h}: n {len(xs)}, mean {statistics.fmean(xs):+.4f}, "
                             f"median {statistics.median(xs):+.4f}, positive {sum(1 for x in xs if x > 0)}, sum {sum(xs):+.3f}")
    pmnet.dump(os.path.join(pmnet.DATA, "kalshi_lead.json"), allrows)
    with open(os.path.join(res, "kalshi_lead.txt"), "w") as f:
        f.write("\n".join(lines) + "\n")
    print("\n".join(lines))


if __name__ == "__main__":
    main()
