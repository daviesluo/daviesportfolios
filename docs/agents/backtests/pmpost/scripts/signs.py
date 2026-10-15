"""PMPOST: how consistent the loss is across markets (data/markets.csv), with an exact binomial tail for the sign:
for each phase, markets with fills whose (a) first minute, (b) spread + first minute, (c) net (fills to now + rewards +
rebates) is negative. Under a coin's null of no edge either way, P(at least k of n negative) is printed.
Run: python3 -I scripts/signs.py
"""
import csv, os
from math import comb
here = os.path.dirname(os.path.abspath(__file__))
rows = [r for r in csv.DictReader(open(os.path.join(here, '..', 'data', 'markets.csv'))) if float(r['shares']) > 0]
tail = lambda k, n: sum(comb(n, i) for i in range(k, n + 1)) / 2 ** n
for ph in ('S2', 'Q2', 'all'):
    x = [r for r in rows if ph == 'all' or r['phase'] == ph]
    for name, f in (('first minute', lambda r: float(r['first_min'])),
                    ('spread + first minute', lambda r: float(r['spread']) + float(r['first_min'])),
                    ('net (fills now + rewards + rebates)', lambda r: float(r['fills_pnl']) + float(r['rewards']) + float(r['rebates']))):
        v = [f(r) for r in x if abs(f(r)) > 1e-9]
        k = sum(1 for a in v if a < 0)
        print(f"{ph:3s} {name:38s} negative in {k} of {len(v)} markets, P(>= that many | coin) = {tail(k, len(v)):.2g}")
print("Q2's 16 lots (Q2-TRIPS' trips table, its erratum): 15 lost; P(>= 15 of 16 | coin) =", f"{tail(15, 16):.2g}")
