# PROGF: every TESTING Reward quotes row's rewards before and after the programme factor, as the page shows them at the
# live R (0.807 point, 0.65 the band's low the stress takes): before = formula x R (Addendum 10's pricing); after =
# formula x factor x R. RW-C's day factors (results/factor.txt, from scripts/factor.py) serve variant-1 and the RW-X arms,
# which replay RW-C's minutes. python3 -I scripts/before_after.py > results/before_after.txt
import json
from collections import defaultdict
R, LOW = 0.807, 0.65
f = json.load(open('results/factor_by_market_day.json'))
day = defaultdict(lambda: [0.0, 0.0])
for src, rows in f.items():
    for k, (fo, tr, n, unc) in rows.items():
        d = k.split('|')[0]; day[(src, d)][0] += fo; day[(src, d)][1] += tr
NAMES = [('rwc', '"Reward quotes" (RW-C)'), ('midprep', 'Reward quotes mid-pool (paper)'), ('lpprep', 'Reward quotes live-prep (paper)'), ('prep', 'Reward quotes mini-pool (paper; off the page)')]
print(f"Rewards before and after the programme factor, at the live R {R} (stress at {LOW}). Days with no reading of the listing keep factor 1.")
print(f"{'row':<46}{'day':<12}{'formula':>9}{'factor':>8}{'before':>9}{'after':>9}{'stress before':>15}{'after':>8}")
for src, name in NAMES:
    T = [0.0, 0.0]
    for (s, d), (fo, tr) in sorted(day.items()):
        if s != src: continue
        T[0] += fo; T[1] += tr
        print(f"{name:<46}{d:<12}{fo:>9.2f}{(tr / fo if fo else 1):>8.3f}{R * fo:>9.2f}{R * tr:>9.2f}{LOW * fo:>15.2f}{LOW * tr:>8.2f}")
    print(f"{name:<46}{'all':<12}{T[0]:>9.2f}{(T[1] / T[0] if T[0] else 1):>8.3f}{R * T[0]:>9.2f}{R * T[1]:>9.2f}{LOW * T[0]:>15.2f}{LOW * T[1]:>8.2f}")
arms = json.load(open('data/arm_days.json'))['rows']
for arm, d, rew in arms:
    fo, tr = day[('rwc', d)]; k = tr / fo if fo else 1
    nm = 'Reward quotes variant-1 (RW-E)' if arm == 'e' else f'RW-X arm {arm}'
    print(f"{nm:<46}{d:<12}{rew:>9.2f}{k:>8.3f}{R * rew:>9.2f}{R * rew * k:>9.2f}{LOW * rew:>15.2f}{LOW * rew * k:>8.2f}")
print("\n2026-10-10 is a partial day: its minutes after the last archived hour read (2026-10-09 23:59 in this run) use that reading.")
