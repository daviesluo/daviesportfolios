# RWC-OPT's search report (disclosed by its pre-registration): every arm of scripts/grid.ts against its family's base.
# python3 -I scripts/analyse.py results/rw_grid.json <R> <first test day index>: totals, paired day bootstrap (seed
# 20261009), a walk-forward that picks each test day's arm by its figure on the days before, and a centred bootstrap
# reality check of the best arm's difference over all arms of the family.
import json, random, sys
g = json.load(open(sys.argv[1]))
R = float(sys.argv[2]) if len(sys.argv) > 2 else 0.4
MINTRAIN = int(sys.argv[3]) if len(sys.argv) > 3 else 5
def series(a): return [d['tot'] - (1 - R) * d['rew'] for d in g[a]['daily']]
days = [d['day'] for d in g['A:x1']['daily']]
def boot_pos(x, seed=20261009, B=2000):
    r = random.Random(seed); n = len(x); s = []
    for _ in range(B): s.append(sum(r.choice(x) for _ in range(n)))
    s.sort(); return s[int(0.05 * B)], sum(1 for v in s if v > 0) / B
for fam, base in (('A', 'A:x1'), ('B', 'B:S2')):
    arms = [a for a in g if a.startswith(fam + ':')]
    b = series(base)
    print(f"\n=== family {fam}, base {base}, R={R}, {len(days)} days {days[0]}..{days[-1]} ===")
    print(f"{'arm':26} {'tot@R':>8} {'/day':>7} {'worst':>7} {'R=1':>8} {'stress':>8} {'fills':>6} {'cap':>7} {'d vs base':>9} {'p5':>7} {'P>0':>5} {'h1':>7} {'h2':>7}")
    rows = []
    for a in arms:
        s = series(a); d = [x - y for x, y in zip(s, b)]
        p5, pos = boot_pos(d) if a != base else (0, 0)
        cap = max(x['capRW'] for x in g[a]['daily']) if fam == 'A' else max(x['comMax'] for x in g[a]['daily'])
        st = sum(x['str'] - (0.5 - 0.5 * R) * x['rew'] for x in g[a]['daily'])
        h = len(days) // 2
        rows.append((sum(s), a))
        print(f"{a:26} {sum(s):8.2f} {sum(s)/len(s):7.2f} {min(s):7.2f} {g[a]['end']['total']:8.2f} {st:8.2f} {g[a]['fills']:6d} {cap:7.0f} {sum(d):9.2f} {p5:7.2f} {pos:5.2f} {sum(d[:h]):7.2f} {sum(d[h:]):7.2f}")
    # walk-forward: pick the arm with the best cumulative figure on days before each test day
    wf, wb, picks = [], [], []
    for i in range(MINTRAIN, len(days)):
        best = max(arms, key=lambda a: sum(series(a)[:i]))
        picks.append((days[i], best)); wf.append(series(best)[i]); wb.append(b[i])
    ins_best = max(arms, key=lambda a: sum(series(a)))
    print(f"walk-forward (train >= {MINTRAIN} days, test {len(wf)} days): picked-arm {sum(wf):.2f} vs base {sum(wb):.2f} on the same days; diff {sum(wf)-sum(wb):.2f}")
    print("  picks:", ", ".join(f"{d[5:]}:{a.split(':')[1]}" for d, a in picks))
    ib = series(ins_best)
    print(f"in-sample best arm {ins_best}: on the test days {sum(ib[MINTRAIN:]):.2f} (vs base {sum(wb):.2f}); in-sample/held-out gap per test day {(sum(ib[MINTRAIN:])-sum(wf))/len(wf):.2f}")
    # reality check: centred bootstrap of the best mean difference against base across all arms
    D = {a: [x - y for x, y in zip(series(a), b)] for a in arms if a != base}
    obs = max(sum(v) for v in D.values())
    r = random.Random(7); n = len(days); cnt = 0; B = 2000
    for _ in range(B):
        idx = [r.randrange(n) for _ in range(n)]
        m = max(sum(v[j] for j in idx) - sum(v) for v in D.values())
        if m >= obs: cnt += 1
    print(f"reality check over {len(D)} arms: best total diff {obs:.2f}, p = {cnt/B:.3f}")
