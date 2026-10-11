"""LP-RULES: live R (paid / formula) and its uncertainty, from data/reward_days.csv (sql/reward_days.sql's rows).

The formula of 10-09 is Addendum 10's like-for-like figure (LP_R_DAY_CORRECTIONS, its `formula_like_for_like` column);
10-10's is the readout's whole formula, as the brief's 0.737 = 28.4174 / 38.5753 takes it. Uncertainty: a bootstrap of
market-days (the only resampling unit with more than two members), 4,000 draws, seed 20261011, and the 5th-95th
percentiles of the pooled ratio; also the pooled ratio without the largest market-day, and the two days apart.
Run: python3 -I scripts/r_bootstrap.py
"""
import csv, random, os
here = os.path.dirname(os.path.abspath(__file__))
rows = list(csv.DictReader(open(os.path.join(here, "..", "data", "reward_days.csv"))))
for r in rows:
    r["f"] = float(r["formula_like_for_like"]) if r["formula_like_for_like"] else float(r["formula"])
    r["p"] = float(r["paid"]); r["rb"] = float(r["rebate"])
def ratio(rs): 
    f = sum(r["f"] for r in rs); return sum(r["p"] for r in rs) / f if f else float("nan")
print("pooled R (paid / formula):", round(ratio(rows), 4), " paid", round(sum(r["p"] for r in rows), 4), " formula", round(sum(r["f"] for r in rows), 4))
for d in ("2026-10-09", "2026-10-10"):
    rs = [r for r in rows if r["day"] == d]; print(" ", d, round(ratio(rs), 4), "over", len(rs), "market-days")
big = max(rows, key=lambda r: r["f"]); rest = [r for r in rows if r is not big]
print("without the largest market-day (", big["day"], big["cond"], "formula", big["f"], "R", round(big["p"] / big["f"], 3), "):", round(ratio(rest), 4))
scored = [r for r in rows if r["f"] > 0.05]
print("market-days with formula > $0.05:", len(scored), " median R", sorted(r["p"] / r["f"] for r in scored)[len(scored) // 2])
rnd = random.Random(20261011); draws = []
for _ in range(4000):
    s = [rows[rnd.randrange(len(rows))] for _ in rows]; v = ratio(s)
    if v == v: draws.append(v)
draws.sort(); q = lambda x: draws[int(x * (len(draws) - 1))]
print("market-day bootstrap 5% / 50% / 95%:", round(q(0.05), 3), round(q(0.5), 3), round(q(0.95), 3))
reb = sum(r["rb"] for r in rows); print("maker rebates", round(reb, 4), "=", round(reb / sum(r["f"] for r in rows), 3), "of the formula")
# paid outside the formula: carried markets' one-sided sells (formula 0, paid > 0)
z = [r for r in rows if r["f"] == 0 and r["p"] > 0]; print("paid where the formula was 0 (one-sided):", round(sum(r["p"] for r in z), 4), "on", len(z), "market-days")
