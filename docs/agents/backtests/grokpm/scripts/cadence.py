"""GROKPM cadence study, step 2: how long the openings categories A and B trade on last, in the markets they may trade.

Run from the repository root:  python3 -I docs/agents/backtests/grokpm/scripts/cadence.py > docs/agents/backtests/grokpm/results/cadence.txt
Reads data/markets.json and data/prices.json.gz (fetch.py). Deterministic: no randomness but the bootstrap's seed.

A. The last approach (category A's proxy). For a market that resolved y, q(t) is the WINNING token's price and the gap
   g(t) = 1 - q(t). Category A buys a known outcome while the price still lags it by at least 8 points; the moment the
   outcome became known is not observable, so the measure is the time the price spent in the final approach between a
   gap of BAND_HI and the 8-point bar: from just after the last point with g >= BAND_HI to the first point after it with
   g < 0.08. A checker that wakes every P minutes at a random phase sees the market inside that window with probability
   min(1, D / P), and that is its catch rate. BAND_HI is 0.30 (headline) and 0.50 (sensitivity). A market whose gap never
   reached BAND_HI in its last 7 days has no such approach and is counted apart.
   The approach's start is also tallied by UTC hour, against the US data releases' slots (08:30 ET = 12:30 UTC in
   daylight time, 13:30 UTC in standard time; 10:00 ET = 14:00/15:00 UTC; FOMC 14:00 ET = 18:00/19:00 UTC).

B. How long a price level stands (category B's proxy). Over the last 7 days less the final 24 hours, from every point
   whose price is between 0.05 and 0.95, sampled each hour: the time until the price first leaves p(t) +- 0.12 (a 12-point
   move, B's bar), censored at the window's end, and the share of points whose price stays within +-0.03 for h minutes.
"""
import gzip, json, math, random, statistics as st
from datetime import datetime, timezone

DATA = "docs/agents/backtests/grokpm/data"
CADENCES = [15, 30, 60, 120, 240]
SEED = 20261015


def ts(s):
    s = s.replace(" ", "T")
    if s.endswith("+00"):
        s += ":00"
    return datetime.fromisoformat(s.replace("Z", "+00:00")).timestamp()


def q(xs, f):
    if not xs:
        return float("nan")
    xs = sorted(xs)
    k = (len(xs) - 1) * f
    lo, hi = math.floor(k), math.ceil(k)
    return xs[lo] + (xs[hi] - xs[lo]) * (k - lo)


def approach(series, y, band_hi):
    """Minutes in the final approach from a gap of band_hi to the 8-point bar, or None without one."""
    pts = [(t, (p if y == 1 else 1 - p)) for t, p in series]
    last_hi = None
    for i, (t, w) in enumerate(pts):
        if 1 - w >= band_hi:
            last_hi = i
    if last_hi is None or last_hi + 1 >= len(pts):
        return None
    start = pts[last_hi + 1][0]
    for t, w in pts[last_hi + 1:]:
        if 1 - w < 0.08:
            return (t - pts[last_hi][0]) / 60.0, pts[last_hi][0], start
    return None


def main():
    meta = json.load(open(f"{DATA}/markets.json"))
    markets = meta["markets"]
    prices = json.load(gzip.open(f"{DATA}/prices.json.gz", "rt"))
    print("GROKPM cadence study")
    print(f"pulled {meta['meta']['pulled_at']}; candidates {meta['meta']['candidates']} (thin {meta['meta']['thin_candidates']}, low {meta['meta']['low_candidates']}, high {meta['meta']['high_candidates']}); params {json.dumps(meta['meta']['params'])}")
    out = {}
    for stratum in ["thin", "low", "high"]:
        ms = [m for m in markets if m["stratum"] == stratum]
        withp = [m for m in ms if len(prices.get(m["cond"], [])) >= 20]
        print(f"\n== {stratum} attention: {len(ms)} drawn, {len(withp)} with at least 20 prices in their last 7 days; median volume ${st.median([m['volume'] for m in withp]):,.0f}")
        for band in [0.30, 0.50]:
            ds, hours, none = [], [], 0
            for m in withp:
                s = sorted(prices[m["cond"]])
                a = approach(s, m["y"], band)
                if a is None:
                    none += 1
                    continue
                d, t_last, _ = a
                ds.append(d)
                hours.append(datetime.fromtimestamp(t_last, timezone.utc).hour + datetime.fromtimestamp(t_last, timezone.utc).minute / 60)
            print(f"-- A, final approach from a gap of {band:.2f} to under 0.08: {len(ds)} markets ({none} never had a gap of {band:.2f} in their last 7 days)")
            if not ds:
                continue
            print(f"   minutes: p10 {q(ds,0.1):.0f}  p25 {q(ds,0.25):.0f}  median {q(ds,0.5):.0f}  p75 {q(ds,0.75):.0f}  p90 {q(ds,0.9):.0f}")
            print(f"   one 5-minute bar or less (no checker can catch it): {sum(1 for d in ds if d <= 5)} of {len(ds)} ({100*sum(1 for d in ds if d <= 5)/len(ds):.0f} %)")
            rng = random.Random(SEED)
            for P in CADENCES:
                catch = [min(1.0, d / P) for d in ds]
                boots = []
                for _ in range(2000):
                    smp = [catch[rng.randrange(len(catch))] for _ in catch]
                    boots.append(sum(smp) / len(smp))
                print(f"   checker every {P:>3} min: catches {100*sum(catch)/len(catch):5.1f} % of approaches  [90 % bootstrap {100*q(boots,0.05):.1f}, {100*q(boots,0.95):.1f}]")
            if band == 0.30:
                slots = [12.5, 13.5, 14.0, 15.0, 18.0, 19.0]
                near = sum(1 for h in hours if any(0 <= h - s < 1.0 for s in slots))
                # The six one-hour windows overlap (13:30-14:30 with 14:00-15:00): their union is the share of a day they cover.
                cover = sum(1 for k in range(24 * 60) if any(0 <= k / 60 - s < 1.0 for s in slots)) / (24 * 60)
                print(f"   approach starts in the hour after a US release slot (12:30, 13:30, 14:00, 15:00, 18:00, 19:00 UTC): {near} of {len(hours)} ({100*near/len(hours):.0f} %), against {100*cover:.0f} % by chance")
                byh = [0] * 24
                for h in hours:
                    byh[int(h)] += 1
                print("   by UTC hour: " + " ".join(f"{i:02d}:{c}" for i, c in enumerate(byh)))
                out[stratum] = ds
        # B
        fp, stay = [], {h: [0, 0] for h in [30, 60, 120, 240, 480]}
        exited = {h: 0 for h in [30, 60, 120, 240, 480, 1440]}
        total = 0
        for m in withp:
            s = sorted(prices[m["cond"]])
            end = ts(m["closed"]) - 86400
            s = [(t, p) for t, p in s if t < end]
            if len(s) < 10:
                continue
            last_hour = None
            for i, (t, p) in enumerate(s):
                if not 0.05 <= p <= 0.95:
                    continue
                if last_hour is not None and t - last_hour < 3600:
                    continue
                last_hour = t
                total += 1
                t_exit = None
                for t2, p2 in s[i + 1:]:
                    if abs(p2 - p) >= 0.12:
                        t_exit = (t2 - t) / 60.0
                        break
                for h in exited:
                    if t_exit is not None and t_exit <= h:
                        exited[h] += 1
                for h in stay:
                    if t + h * 60 > s[-1][0]:
                        continue
                    stay[h][1] += 1
                    if all(abs(p2 - p) < 0.03 for t2, p2 in s[i + 1:] if t2 <= t + h * 60):
                        stay[h][0] += 1
        print(f"-- B, from {total} hourly points priced 0.05-0.95 (last 7 days less the final 24 h):")
        print("   a 12-point move has happened within: " + ", ".join(f"{h} min {100*exited[h]/max(total,1):.1f} %" for h in exited))
        print("   price stays within +-3 points for: " + ", ".join(f"{h} min {100*a/max(n,1):.0f} % (n {n})" for h, (a, n) in stay.items()))
    print("\nReading: see docs/agents/reviews/2026-10-15-grokpm-prereg.md, section 7.")


if __name__ == "__main__":
    main()
