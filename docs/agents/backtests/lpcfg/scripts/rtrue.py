# LPCFG: R on a like-for-like basis for 2026-10-09 (written by the main session, committed 2026-10-10).
# python3 -I scripts/rtrue.py data/minutes_2026-10-09.json data/config_timeline.json data/readout_2026-10-09.json > results/rtrue.txt
# Every minute we actually quoted that Polymarket read both sides scoring, its recorded formula rescaled to the rate the
# CLOB listing showed at that time (pm-rec, 15-minute reads): paid / that is R. Neither 0.33 (the selection's stale rates
# in the denominator) nor 0.91 (the fixed rules' formula, which drops minutes we quoted and Polymarket still paid at a cut
# rate). `lpLiveR` (agents/pm_lp_live_view.ts) reads 10-09 at this figure, by market, from the table below.
import json, sys, bisect
mins = json.load(open(sys.argv[1])); F = {k: i for i, k in enumerate(mins['fields'])}
tl = json.load(open(sys.argv[2]))['markets']
ro = json.load(open(sys.argv[3]))
DAY = '2026-10-09'
def prog(c, hhmm):
    xs = tl[c]; i = bisect.bisect_right([x[0] for x in xs], f'{DAY}T{hhmm}') - 1
    return xs[i] if i >= 0 else None
paid = {}
rows = ro['rows'] if isinstance(ro, dict) and 'rows' in ro else ro
for r in (rows if isinstance(rows, list) else []):
    if isinstance(r, dict):
        c = str(r.get('cond', ''))[:10]; paid[c] = paid.get(c, 0) + float(r.get('actual_usd') or 0) + float(r.get('actual_sponsored_usd') or 0)
agg = {}
for r in mins['rows']:
    c = r[F['cond10']]; a = agg.setdefault(c, {'rec': 0.0, 'recsc': 0.0, 'true_sc': 0.0, 'sc': 0})
    f = float(r[F['formula_usd']] or 0); a['rec'] += f
    if r[F['bid_scoring']] is True and r[F['ask_scoring']] is True:
        a['recsc'] += f; a['sc'] += 1
        p = prog(c, r[F['minute']]); sel = float(r[F['rate']] or 0)
        true = (p[1] or 0) if p else 0
        a['true_sc'] += f * (true / sel) if sel > 0 else 0
tot = {'paid': 0, 'recsc': 0, 'true_sc': 0}
print(f"{'market':12} {'paid':>7} {'rec sc':>8} {'true sc':>8} {'R rec sc':>9} {'R true sc':>10}  scored min")
for c in sorted(agg):
    a = agg[c]; p = paid.get(c, 0)
    tot['paid'] += p; tot['recsc'] += a['recsc']; tot['true_sc'] += a['true_sc']
    rr = f"{p/a['recsc']:.3f}" if a['recsc'] > 0 else '-'; rt = f"{p/a['true_sc']:.3f}" if a['true_sc'] > 0 else '-'
    print(f"{c:12} {p:7.4f} {a['recsc']:8.3f} {a['true_sc']:8.3f} {rr:>9} {rt:>10}  {a['sc']}")
print(f"{'all':12} {tot['paid']:7.4f} {tot['recsc']:8.3f} {tot['true_sc']:8.3f} {tot['paid']/tot['recsc']:9.3f} {tot['paid']/tot['true_sc']:10.3f}")
print()
print('the like-for-like scored formula by market, to six places (LP_R_DAY_CORRECTIONS in agents/pm_lp_live_view.ts):')
for c in sorted(agg): print(f"  {c} {agg[c]['true_sc']:.6f}")
print(f"  all {tot['true_sc']:.6f}; R = {tot['paid']:.6f} / {tot['true_sc']:.6f} = {tot['paid']/tot['true_sc']:.6f}")
