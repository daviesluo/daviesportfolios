"""PMPOST: each live phase's net a quoting day and per filled share, with a market bootstrap, from data/markets.csv
(sql/market_rows.sql's output: each market's fills marked now or at the payout, its rewards and rebates).

Quoting days: S2 2026-10-09 01:32:21 -> 10-12 07:30 (the stop), 3.249 days; Q2 10-13 13:25:32 -> 10-15 00:08, 1.446 days.
Fills made in the close-only spells after each count with their market's phase. Bootstrap: markets resampled with
replacement within a phase, 10,000 draws, seed 20261015, 5th-95th percentiles.
Run: python3 -I scripts/phase_boot.py
"""
import csv, os, random
here = os.path.dirname(os.path.abspath(__file__))
rows = list(csv.DictReader(open(os.path.join(here, '..', 'data', 'markets.csv'))))
for r in rows:
    for k in ('fills', 'shares', 'spread', 'first_min', 'fills_pnl', 'rewards', 'rebates'): r[k] = float(r[k])
DAYS = {'S2': 3.249, 'Q2': 1.446}
rnd = random.Random(20261015)
def summ(x):
    sh = sum(r['shares'] for r in x); fp = sum(r['fills_pnl'] for r in x); rw = sum(r['rewards'] for r in x); rb = sum(r['rebates'] for r in x)
    return sh, fp, rw, rb, fp + rw + rb
for ph in ('S2', 'Q2', 'both'):
    x = [r for r in rows if ph == 'both' or r['phase'] == ph]
    days = DAYS.get(ph, DAYS['S2'] + DAYS['Q2'])
    sh, fp, rw, rb, net = summ(x)
    need = -(fp + rb)  # rewards needed to break even
    print(f"{ph}: markets {len(x)} (filled {sum(1 for r in x if r['shares'] > 0)}), filled shares {sh:.0f}, quoting days {days}")
    print(f"  fills {fp:+.2f}  rewards {rw:+.2f}  rebates {rb:+.2f}  net {net:+.2f}  = {net / days:+.2f} a quoting day")
    print(f"  per filled share (c): fills {100 * fp / sh:+.2f}  rewards {100 * rw / sh:.2f}  rebates {100 * rb / sh:.2f}  net {100 * net / sh:+.2f}")
    print(f"  rewards needed to break even {need:.2f} = {need / rw:.2f}x what was paid; {100 * need / sh:.2f} c a filled share")
    draws = []
    for _ in range(10000):
        s = [x[rnd.randrange(len(x))] for _ in x]
        draws.append(summ(s)[4] / days)
    draws.sort(); q = lambda p: draws[int(p * (len(draws) - 1))]
    print(f"  net a quoting day, market bootstrap 5/50/95 %: {q(0.05):+.2f} / {q(0.5):+.2f} / {q(0.95):+.2f};  P(net > 0) {sum(d > 0 for d in draws) / len(draws):.3f}")
    big = min(x, key=lambda r: r['fills_pnl'] + r['rewards'] + r['rebates'])
    rest = [r for r in x if r is not big]
    print(f"  without its worst market ({big['cond']}, net {big['fills_pnl'] + big['rewards'] + big['rebates']:+.2f}): net {summ(rest)[4]:+.2f} = {summ(rest)[4] / days:+.2f} a day")
