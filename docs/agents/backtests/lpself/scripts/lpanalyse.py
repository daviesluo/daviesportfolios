# Live-prep against itself: every change to L1 on both records, both fill models, R 0.2 / 0.4 / 1, with the adoption
# rule: ahead of L1 at R = 0.4 with at-price fills on RW's first seven days (where it would be chosen) AND on RW's last
# seven (out of sample) AND on the full-universe days (out of sample), with its worst at-price day at R = 0.4 no worse
# than L1's on either record. Then a walk-forward over every arm and a centred-bootstrap reality check.
import json, random, sys
D = {k: json.load(open(f'results/lp_{k}.json')) for k in ('rw', 'rw_atprice', 'pr', 'pr_atprice')}
def ser(rec, arm, R): return [d['tot'] - (1 - R) * d['rew'] for d in D[rec][arm]['daily']]
arms = [a for a in D['rw'] if a != 'L1']
pr_arms = [a for a in D['pr'] if a != 'L1']
def delta(rec, arm, R, lo=0, hi=None):
    a, b = ser(rec, arm, R), ser(rec, 'L1', R)
    return sum(a[lo:hi]) - sum(b[lo:hi])
print(f"{'change to L1':22} | {'RW R.4 str':>10} {'RW R.4 at$':>10} {'h1 at$':>8} {'h2 at$':>8} {'RW R1':>8} {'RW R.2':>8} {'worst at$':>9} | {'PR R.4 str':>10} {'PR R.4 at$':>10} {'PR R1':>8} {'worst at$':>9} | adopt")
rw_w0, pr_w0 = min(ser('rw_atprice', 'L1', 0.4)), min(ser('pr_atprice', 'L1', 0.4))
print(f"{'L1 (totals)':22} | {sum(ser('rw','L1',.4)):10.2f} {sum(ser('rw_atprice','L1',.4)):10.2f} {sum(ser('rw_atprice','L1',.4)[:7]):8.2f} {sum(ser('rw_atprice','L1',.4)[7:]):8.2f} {sum(ser('rw','L1',1)):8.2f} {sum(ser('rw','L1',.2)):8.2f} {rw_w0:9.2f} | {sum(ser('pr','L1',.4)):10.2f} {sum(ser('pr_atprice','L1',.4)):10.2f} {sum(ser('pr','L1',1)):8.2f} {pr_w0:9.2f} |")
adopted = []
for a in sorted(set(arms) | set(pr_arms), key=lambda x: (x not in arms, x)):
    inrw, inpr = a in arms, a in pr_arms
    r = [delta('rw', a, .4), delta('rw_atprice', a, .4), delta('rw_atprice', a, .4, 0, 7), delta('rw_atprice', a, .4, 7), delta('rw', a, 1), delta('rw', a, .2), min(ser('rw_atprice', a, .4))] if inrw else [float('nan')] * 7
    p = [delta('pr', a, .4), delta('pr_atprice', a, .4), delta('pr', a, 1), min(ser('pr_atprice', a, .4))] if inpr else [float('nan')] * 4
    ok = inrw and inpr and r[2] > 0 and r[3] > 0 and p[1] > 0 and r[6] >= rw_w0 - 0.01 and p[3] >= pr_w0 - 0.01
    if ok: adopted.append(a)
    print(f"{a:22} | {r[0]:10.2f} {r[1]:10.2f} {r[2]:8.2f} {r[3]:8.2f} {r[4]:8.2f} {r[5]:8.2f} {r[6]:9.2f} | {p[0]:10.2f} {p[1]:10.2f} {p[2]:8.2f} {p[3]:9.2f} | {'ADOPT' if ok else ''}")
print('adopted:', adopted or 'none')
# walk-forward on RW's record, at-price R = 0.4: each test day's arm is the best on the days before
for rec in ('rw_atprice', 'rw'):
    names = ['L1'] + arms
    n = len(D[rec]['L1']['daily'])
    wf, base, picks = 0.0, 0.0, []
    for i in range(6, n):
        best = max(names, key=lambda a: sum(ser(rec, a, .4)[:i]))
        picks.append(best); wf += ser(rec, best, .4)[i]; base += ser(rec, 'L1', .4)[i]
    print(f"walk-forward {rec} R=0.4, test days 7-{n}: picked {wf:.2f} vs L1 {base:.2f} ({wf - base:+.2f}); picks: {', '.join(picks)}")
    Dd = {a: [x - y for x, y in zip(ser(rec, a, .4), ser(rec, 'L1', .4))] for a in arms}
    obs = max(sum(v) for v in Dd.values()); best = max(Dd, key=lambda a: sum(Dd[a]))
    rr = random.Random(7); cnt = 0
    for _ in range(2000):
        idx = [rr.randrange(n) for _ in range(n)]
        if max(sum(v[j] for j in idx) - sum(v) for v in Dd.values()) >= obs: cnt += 1
    print(f"reality check {rec} over {len(Dd)} changes: best {best} {obs:+.2f}, p = {cnt / 2000:.3f}")
