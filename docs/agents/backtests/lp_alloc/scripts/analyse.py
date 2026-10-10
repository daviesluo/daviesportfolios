# LP-ALLOC's tables from scripts/alloc_run.ts's raw results. Run from this folder:
#   python3 -I scripts/analyse.py <lookback: 0 | 120> > results/analysis_lb<lookback>.txt
# A day's net at R is its fills' P&L plus R x its formula reward (the simulator's total is at R = 1: tot - (1 - R) x rew).
# The primary reading is AT-PRICE fills (a print at our price fills us too): on 10-09 it reproduced live-prep's live fills
# (69 fills / 1,216 shares against 70 / 1,219, results/calib.txt) where strict fills gave half. R is in units of THIS
# simulator's formula. On 10-09 Polymarket paid 0.807 of the live path's own formula read like for like (the coordinator's
# lpcfg/results/rtrue.txt; 0.825 on the nine markets the record holds), and 0.481 of THIS simulator's formula on the same
# markets and minutes at at-price fills (results/calib_sim.txt): the simulator's formula is 1.72 times the path's. So the
# coordinator's band [0.65, 1.00] around 0.81 on the path's formula is [0.38, 0.58] around 0.47 here, and the 0.40 stress is
# 0.23. Columns: R = 0.23 (stress), 0.38, 0.47 (point), 0.58.
# In sample: 10-05 -> 10-07 (choices are made there); out of sample: 10-08 -> 10-09.
# POSTs are the counter's x 1.8 (LPCAP's live scaling).
import json, glob, gzip, os, re, sys, random
LB = sys.argv[1] if len(sys.argv) > 1 else '0'
RS = [0.23, 0.38, 0.47, 0.58]
RP = 0.47   # the primary reading
IS = ['2026-10-05', '2026-10-06', '2026-10-07']; OOS = ['2026-10-08', '2026-10-09']
def load(model):
    out = {}
    for f in sorted(glob.glob(f"results/raw/lb{LB}/*.json.gz")):
        if ('_atprice' in os.path.basename(f)) != (model == 'atprice'): continue
        for k, v in json.load(gzip.open(f, 'rt')).items():
            if k != 'L1 check': out[k] = v
    return out
S, A = load('strict'), load('atprice')
def net(d, R): return d['tot'] - (1 - R) * d['rew']
def mean(xs): return sum(xs) / len(xs) if xs else float('nan')
def ser(a, R, which=None): return [net(d, R) for d in a['daily'] if which is None or d['day'] in which]
def dd(xs):
    cum = peak = low = 0
    for x in xs: cum += x; peak = max(peak, cum); low = min(low, cum - peak)
    return low
def capOf(k):
    m = re.match(r'C(\d+) ', k); return int(m.group(1)) if m else None
def score(k, which=None, R=RP): return mean(ser(A[k], R, which))
def row(k):
    a, s = A[k], S[k]; ds = a['daily']
    cells = ' '.join(f"{mean(ser(a, R)):>6.2f}" for R in RS)
    return (f"{k:<34}{mean([d['chosen'] for d in ds]):>5.1f} {cells} {mean(ser(s, RP)):>7.2f} {score(k, IS):>7.2f} {score(k, OOS):>7.2f} {min(ser(a, 0.23)):>7.2f} {dd(ser(a, 0.23)):>7.2f}"
            f" {max(d['comMax'] for d in ds):>6.0f} {mean([d['comMean'] for d in ds]):>6.0f} {mean([d['heldClose'] for d in ds]):>6.0f} {max(d['heldClose'] for d in ds):>6.0f} {1.8*mean([d['posts'] for d in ds]):>6.0f}"
            f" {mean([d['rew'] for d in ds]):>6.1f} {mean([d['tot']-d['rew'] for d in ds]):>7.2f} {mean([d['progChanged'] for d in ds]):>5.1f} {sum(1 for d in ds if d['stop']):>3}")
HDR = (f"{'arm':<34}{'mk/d':>5} {'R.23':>6} {'R.38':>6} {'R.47':>6} {'R.58':>6} {'str.47':>7} {'IS.47':>7} {'OOS.47':>7} {'worst':>7} {'maxDD':>7}"
       f" {'peak$':>6} {'mean$':>6} {'held$':>6} {'hMax$':>6} {'POST/d':>6} {'form$':>6} {'fills$':>7} {'chg':>5} {'stp':>3}")
LEG = """columns: mk/d markets chosen a day; R.xx net $ a day over the five days, at-price fills; str.47 the same with strict fills at R = 0.47;
IS.47 / OOS.47 at-price at R = 0.47 on 10-05..10-07 / 10-08..10-09; worst the worst day and maxDD the deepest fall of the running sum, at-price at R = 0.23;
peak$ / mean$ holdings at cost + resting buys (the cap's count); held$ / hMax$ holdings at cost at the day's close, mean / most; POST/d the counter x 1.8;
form$ the formula reward a day (at-price); fills$ the fills' P&L a day (at-price); chg chosen markets a day whose programme changed or ended inside the day; stp days the -$75 stop held."""
def boot(k, base, R=RP, n=2000, seed=20261010):
    a, b = ser(A[k], R), ser(A[base], R); d = [x - y for x, y in zip(a, b)]
    rng = random.Random(seed); ms = sorted(mean([rng.choice(d) for _ in d]) for _ in range(n))
    return mean(d), ms[int(0.05 * n)], ms[int(0.95 * n)], sum(1 for x in d if x > 0)
if __name__ == '__main__':
    print(f"LP-ALLOC, programme reading lookback {LB} min. " + LEG)
    print()
    print(HDR)
    for name in ['L1', 'L1-now C330', 'L1-now C330 formula at 00:00 programme', 'L1-now C330 no near-certain']:
        if name in A and name in S: print(row(name))
    keys = [k for k in A if k in S and capOf(k)]
    CAPS = sorted({capOf(k) for k in keys})
    best = {}
    for C in CAPS:
        ks = [k for k in keys if capOf(k) == C]
        base = f"C{C} M10 k1 n20 cm100"
        print(f"\n== total cap ${C}: {len(ks)} arms; the 15 best by IS.47 (at-price, R = 0.47, 10-05..10-07), then today's knobs at this cap")
        print(HDR)
        ranked = sorted(ks, key=lambda k: -score(k, IS))
        for k in ranked[:15]: print(row(k))
        if base in A: print(row(base) + "   <- today's knobs")
        best[C] = ranked[0]
    print("\n== knobs against their own base (same cap, markets, size, market cap), at-price, R = 0.47: mean a day, its change, the paired day bootstrap of the change (5th-95th), days ahead, the worst day and the deepest fall at R = 0.23, mean holdings at close, the worst market's fills, refills a day")
    tags = [' stable', ' resel2', ' resel6', ' stable resel2', ' stable resel6', ' inv3N', ' inv2N', ' drift5', ' drift10', ' drift20', ' noAI', ' noAI-counts', ' refill15', ' refill60', ' inv3N drift10', ' inv3N drift10 refill15', ' inv3N drift10 refill15 noAI', ' refill15 noAI',
            ' zero-side', ' zero-side refill15', ' zero-side inv3N drift10 refill15', ' zero-market', ' zero-market refill15', ' zero-market inv3N drift10 refill15']
    for C in CAPS:
        for basek in [f"C{C} M10 k1 n20 cm100", f"C{C} M15 k1 n20 cm100", f"C{C} M10 k1.5 n20 cm150"]:
            if basek not in A: continue
            print(f"  -- {basek}: {score(basek):>6.2f} a day (worst {min(ser(A[basek], 0.23)):.2f}, maxDD {dd(ser(A[basek], 0.23)):.2f}, held {mean([d['heldClose'] for d in A[basek]['daily']]):.0f})")
            for t in tags:
                k = basek + t
                if k not in A or k not in S: continue
                m, lo, hi, up = boot(k, basek)
                wm = min((x['fills'] for x in A[k].get('worstMarkets', [])), default=float('nan'))
                print(f"     {t.strip():<32}{score(k):>7.2f} {m:>+7.2f} [{lo:+6.2f},{hi:+6.2f}] {up}/5  worst {min(ser(A[k], 0.23)):>7.2f} maxDD {dd(ser(A[k], 0.23)):>7.2f} held {mean([d['heldClose'] for d in A[k]['daily']]):>4.0f} worstMkt {wm:>7.2f} refills {mean([d.get('refills', 0) for d in A[k]['daily']]):>4.1f}")
    print("\n== at each cap: the arm chosen in sample, read out of sample and on all five days, against today's knobs at $330 (paired day bootstrap of the five days, seed 20261010, 2,000 draws, 5th-95th)")
    for C in CAPS:
        k = best[C]
        m, lo, hi, up = boot(k, "C330 M10 k1 n20 cm100")
        print(f"  ${C:<5} {k:<32} all {score(k):>6.2f}  IS {score(k, IS):>6.2f}  OOS {score(k, OOS):>6.2f}   vs today's: {m:+6.2f} [{lo:+.2f}, {hi:+.2f}], {up}/5 days ahead")

def headline():
    """The review's tables: each cap's today's knobs, the recommended setting (today's knobs without AI markets) and the
    arm the in-sample score picks, then the risk knobs at today's cap, each against its base."""
    print("\n== HEADLINE: at each total cap, at-price fills; net $ a day at R = 0.23 / 0.47 / 0.58 (simulator units), strict at 0.47, in / out of sample at 0.47,")
    print("   the change against today's rule at $330 (paired day bootstrap, 5th-95th, days ahead), worst day and deepest fall at R = 0.23, capital used (peak / mean), held at close, POSTs a day, stop tripped")
    base0 = "C330 M10 k1 n20 cm100"
    def line(lbl, k, C):
        a = A[k]; ds = a['daily']
        m, lo, hi, up = boot(k, base0) if k != base0 else (0, 0, 0, 0)
        stop = any(d['stop'] for d in ds)
        print(f"  ${C:<5}{lbl:<12}{k:<44}{mean(ser(a,0.23)):>6.2f} {mean(ser(a,0.47)):>6.2f} {mean(ser(a,0.58)):>6.2f} {mean(ser(S[k],0.47)):>6.2f} {score(k, IS):>6.2f} {score(k, OOS):>6.2f}"
              f"  {m:>+6.2f} [{lo:+6.2f},{hi:+6.2f}] {up}/5 {min(ser(a,0.23)):>7.2f} {dd(ser(a,0.23)):>7.2f} {max(d['comMax'] for d in ds):>5.0f}/{mean([d['comMean'] for d in ds]):>4.0f} {mean([d['heldClose'] for d in ds]):>4.0f} {1.8*mean([d['posts'] for d in ds]):>6.0f} {'yes' if stop else 'no'}")
    for C in [330, 430, 580, 830, 1330]:
        keys = [k for k in A if k in S and k.startswith(f"C{C} ")]
        best = max(keys, key=lambda k: score(k, IS))
        line("today", f"C{C} M10 k1 n20 cm100", C)
        if f"C{C} M10 k1 n20 cm100 noAI" in A: line("recommended", f"C{C} M10 k1 n20 cm100 noAI", C)
        line("best IS", best, C)
headline()
