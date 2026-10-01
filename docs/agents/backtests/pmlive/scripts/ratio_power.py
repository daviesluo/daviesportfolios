"""Power of the live calibration: R = (rewards Polymarket pays) / (rewards the paper formula computes), by market-day.
Model (an assumption, not a measurement): per-market bias b_m ~ N(0, sb^2), per-market-day noise e ~ N(0, sw^2),
r = R * exp(b + e - (sb^2 + sw^2)/2); formula amounts f lognormal (mean $10, CV 0.8); each market seen `dpm` days.
Estimator: ratio of sums; CI: cluster (market) bootstrap, one-sided 95 % bounds. Seeded, deterministic."""
import random, math, statistics as st
def sim(R, n, sb, sw, dpm=2, reps=400, boots=400, seed=20261001):
    rng = random.Random(seed)
    M = max(2, round(n / dpm))
    lo_list, hi_list, hw = [], [], []
    for _ in range(reps):
        mk = []
        for m in range(M):
            b = rng.gauss(0, sb)
            rows = []
            for d in range(dpm):
                f = math.exp(rng.gauss(math.log(10) - 0.5 * math.log(1 + 0.8**2), math.sqrt(math.log(1 + 0.8**2))))
                r = R * math.exp(b + rng.gauss(0, sw) - (sb**2 + sw**2) / 2)
                rows.append((r * f, f))
            mk.append(rows)
        est = sum(a for rows in mk for a, f in rows) / sum(f for rows in mk for a, f in rows)
        bs = []
        for _ in range(boots):
            pick = [mk[rng.randrange(M)] for _ in range(M)]
            bs.append(sum(a for rows in pick for a, f in rows) / sum(f for rows in pick for a, f in rows))
        bs.sort()
        lo, hi = bs[int(0.05 * boots)], bs[int(0.95 * boots) - 1]
        lo_list.append(lo); hi_list.append(hi); hw.append((hi - lo) / 2)
    return st.median(hw), lo_list, hi_list
print("n market-days | sigma_b | sigma_w | median 90% half-width at R=1 | P(lower bound > 0.6 | R=1) | P(upper bound < 0.6 | R=0.3)")
for n in (12, 30, 60, 84):
    for sb, sw in ((0.2, 0.3), (0.3, 0.6), (0.5, 1.0)):
        h1, lo1, _ = sim(1.0, n, sb, sw)
        _, _, hi3 = sim(0.3, n, sb, sw)
        p1 = sum(l > 0.6 for l in lo1) / len(lo1)
        p3 = sum(h < 0.6 for h in hi3) / len(hi3)
        print(f"{n:>4} | {sb:.1f} | {sw:.1f} | {h1:.3f} | {p1:.2f} | {p3:.2f}")
