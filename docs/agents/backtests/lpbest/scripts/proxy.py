# LP-BEST, step 9: the chosen rule as the live path could run it. The path may not read pm-rec (nothing of a trading path
# does), so "no print in the prior 24 hours" must come from what its selection already reads: Gamma's `volume24hr`, read
# for every candidate. Here the same rule with Gamma's 24-hour volume (the 00:05 dump's read) in place of pm-rec's tape,
# at a few thresholds, on TRAIN, TEST and the whole span; how far the two agree; and the rule at 2N.
#   LPBEST_WORK=<scratch> python3 -I docs/agents/backtests/lpbest/scripts/proxy.py > results/proxy.txt
import os, sys, json
import numpy as np
from multiprocessing import Pool
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lib, engine, strat, runs
from engine import P

ch = json.load(open(os.path.join(lib.WORK, f'choose_lo{lib.TAG}.json')))['chosen']
QP, QS = ch['polkw'], ch['selkw']

def run_one(args):
    label, selkw, polkw, days = args
    cap = runs.cap_of(316.0)
    pol = P(name=label, cap_total=cap, cap_market=min(100.0, cap), **polkw)
    o, _ = strat.price(pol, strat.schedule(runs.sel_gen(eq=316.0, **selkw), days), days, label=label)
    return o

if __name__ == '__main__':
    df = strat.daytable()
    e = strat.eligible(df, min_width_c=4)
    q_tape = (e.p_vol_api <= QS['max_api_vol']) if lib.TAG else (e.p_vol <= QS['max_p_vol'])
    print("LP-BEST: the quiet-book rule with Gamma's 24-hour volume in place of pm-rec's tape")
    print(f"eligible market-days with a touch >= 4 c at 00:00: {len(e)}; quiet by the tape (the chosen threshold, {'the data API' if lib.TAG else 'pm-rec'}, 24 h): {int(q_tape.sum())}")
    for thr in (0, 1, 10, 50):
        q_g = e.g_vol.notna() & (e.g_vol <= thr)
        both = int((q_tape & q_g).sum())
        print(f"  Gamma volume24hr <= ${thr:<3}: {int(q_g.sum()):>5} market-days; both {both}; tape-quiet that Gamma calls quiet "
              f"{100 * both / max(1, q_tape.sum()):.0f} %; Gamma-quiet that the tape calls quiet {100 * both / max(1, q_g.sum()):.0f} %")
    jobs = []
    for thr in (0, 1, 10, 50):
        sk = dict(QS); sk.pop('max_p_vol', None); sk.pop('max_api_vol', None); sk['max_g_vol'] = thr
        for span, days in (('TRAIN', strat.TRAIN), ('TEST', strat.TEST), ('ALL', strat.DAYS)):
            jobs.append((f'Q by Gamma volume24hr <= ${thr} [{span}]', sk, QP, days))
    for span, days in (('TRAIN', strat.TRAIN), ('TEST', strat.TEST), ('ALL', strat.DAYS)):
        jobs.append((f'Q as chosen, quiet by the tape [{span}]', QS, QP, days))
        jobs.append((f'Q at 2N (inventory cap 2 x 2N) [{span}]', dict(QS, size_mult=2), dict(QP, size_mult=2, inv_cap=2), days))
        jobs.append((f"Q with the path's $2.50 formula floor at 00:00 [{span}]", dict(QS, min_est=2.5), QP, days))
    with Pool(4) as pool: outs = pool.map(run_one, jobs, chunksize=1)
    print()
    for o in outs: print(strat.fmt(o))
    json.dump(outs, open(os.path.join(lib.WORK, f'proxy{lib.TAG}.json'), 'w'), default=float, indent=1)
