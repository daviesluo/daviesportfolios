# PR5-OPT: the review's candidate table from results/experiments.json, as Markdown (results/table.md).
#   python3 -I scripts/table.py
import os, json
HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
R = json.load(open(os.path.join(HERE, 'results', 'experiments.json')))['by']
f = lambda x: f'{x:+.2f}'
rows = ['| candidate | verdict | FWD at: bps/day | vs LIVE rules (90 %), P≤0 | halves | FWD at50 / through | HIST at / through | LONG | trips (won) | stops | worst day, MTM max DD (bps) |',
        '|---|---|---|---|---|---|---|---|---|---|---|']
b = R['base']['fwd_at']
rows.append(f"| **LIVE's rules at £600 (base)** | — | {b['bpsDay']:.2f} | — | — | {R['base']['fwd_at50']['bpsDay']:.2f} / {R['base']['fwd_through']['bpsDay']:.2f} | "
            f"{R['base']['hist_at']['bpsDay']:.2f} / {R['base']['hist_through']['bpsDay']:.2f} | {R['base']['long_at']['bpsDay']:.2f} | {b['trips']} ({100 * b['won']:.0f} %) | {b['stops']} | "
            f"{b['worstDayBps']:.2f}, {b['mtmMaxDrawdownBps']:.2f} |")
for name, r in R.items():
    if name == 'base': continue
    a = r['fwd_at']; v = a['vsBase']
    rows.append(f"| {name} | {r['verdict']} | {a['bpsDay']:.2f} | {f(v['mean'])} ({f(v['p05'])} to {f(v['p95'])}), {v['shareAtOrBelow0']:.3f} | "
                f"{f(a['vsBaseHalves'][0])} / {f(a['vsBaseHalves'][1])} | {f(r['fwd_at50']['vsBase']['mean'])} / {f(r['fwd_through']['vsBase']['mean'])} | "
                f"{f(r['hist_at']['vsBase']['mean'])} / {f(r['hist_through']['vsBase']['mean'])} | {f(r['long_at']['vsBase']['mean'])} | {a['trips']} ({100 * a['won']:.0f} %) | {a['stops']} | "
                f"{a['worstDayBps']:.2f}, {a['mtmMaxDrawdownBps']:.2f} |")
open(os.path.join(HERE, 'results', 'table.md'), 'w').write('\n'.join(rows) + '\n')
print('\n'.join(rows))
