# LP-BEST, step 10: is pm-rec's print tape complete for the markets the quiet-book rule picks? Polymarket's keyless data
# API (`/trades?market=<condition>`, taker trades) read again for a sample of markets, against what pm-rec recorded for
# them, 2026-10-05 00:00 -> 10-12 22:00 UTC: the quiet rule's own picks, and as many markets drawn from the busiest
# books for comparison. Writes <work>/tapecheck.json and prints the comparison.
#   LPBEST_WORK=<scratch> python3 -I docs/agents/backtests/lpbest/scripts/tapecheck.py > results/tapecheck.txt
import os, sys, json, time, urllib.request, urllib.error, random
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lib, engine, strat, runs

T0, T1 = 1791158400, 1791842400        # 2026-10-05 00:00 -> 2026-10-12 22:00 UTC (the archive's last full hours)
UA = {'User-Agent': 'curl/8.5.0', 'Accept': 'application/json'}   # the API's edge answers 403 to Python's default agent

def api_trades(cond):
    out, off = [], 0
    while off <= 3000:
        url = f"https://data-api.polymarket.com/trades?market={cond}&limit=500&offset={off}&takerOnly=true"
        for attempt in range(3):
            try:
                rows = json.load(urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30)); break
            except Exception as ex:
                rows = None; time.sleep(1 + attempt)
        if rows is None: return None
        if not rows: break
        out.extend(rows)
        if min(int(r['timestamp']) for r in rows) < T0 or len(rows) < 500: break
        off += 500
        time.sleep(0.2)
    return [r for r in out if T0 <= int(r['timestamp']) < T1]

if __name__ == '__main__':
    ch = json.load(open(os.path.join(lib.WORK, 'choose_lo.json')))['chosen']
    sch = strat.schedule(runs.sel_gen(eq=316.0, **ch['selkw']), strat.DAYS)
    picked = sorted({mid for v in sch.values() for (mid, r, s) in v})
    df = strat.daytable()
    busy = df[(df.p_vol > 1000) & (df.N <= 20)].mid.unique().tolist()
    random.seed(20261013)
    sample = [('quiet pick', m) for m in picked] + [('busy', m) for m in random.sample(busy, min(len(busy), 25))]
    P = lib.prints_all(); md = lib.meta()
    def one(km):
        kind, mid = km
        cond = md[mid]['cond']
        tr = api_trades(cond)
        pr = P.get(mid)
        n_rec = int(((pr[:, 0] >= T0) & (pr[:, 0] < T1)).sum()) if pr is not None and len(pr) else 0
        sh_rec = float(pr[(pr[:, 0] >= T0) & (pr[:, 0] < T1), 3].sum()) if pr is not None and len(pr) else 0.0
        return dict(kind=kind, mid=int(mid), cond=cond, api=None if tr is None else len(tr), api_sh=None if tr is None else sum(float(r['size']) for r in tr),
                    rec=n_rec, rec_sh=sh_rec, q=(md[mid].get('q') or '')[:60])
    from concurrent.futures import ThreadPoolExecutor
    with ThreadPoolExecutor(6) as ex:
        res = list(ex.map(one, sample))
    json.dump(res, open(os.path.join(lib.WORK, 'tapecheck.json'), 'w'), indent=1)
    print("LP-BEST tape check: taker trades on Polymarket's data API against pm-rec's tape, 2026-10-05 00:00 -> 10-12 22:00 UTC")
    for kind in ('quiet pick', 'busy'):
        x = [r for r in res if r['kind'] == kind and r['api'] is not None]
        a = sum(r['api'] for r in x); b = sum(r['rec'] for r in x)
        a_sh = sum(r['api_sh'] for r in x); b_sh = sum(r['rec_sh'] for r in x)
        zero_rec = sum(1 for r in x if r['rec'] == 0); zero_both = sum(1 for r in x if r['rec'] == 0 and r['api'] == 0)
        print(f"  {kind:<11}: {len(x)} markets; trades API {a}, pm-rec {b} ({100 * b / max(1, a):.0f} %); shares API {a_sh:.0f}, pm-rec {b_sh:.0f} "
              f"({100 * b_sh / max(1, a_sh):.0f} %); markets pm-rec shows no print in: {zero_rec}, of them with none on the API either: {zero_both}")
    # every market apitape.py read again (the quiet rules' candidates), when it has run: pm-rec's prints against the API's
    pa = os.path.join(lib.WORK, 'prints_api.pkl')
    if os.path.exists(pa):
        import pickle
        A = pickle.load(open(pa, 'rb'))
        df = strat.daytable()
        qmids = set(df[(df.p_vol <= 0.5)].mid.astype(int))
        for label, sel in (('every candidate market', set(A)), ('candidates pm-rec showed silent on some day', set(A) & qmids)):
            a = b = a_sh = b_sh = 0.0
            for mid in sel:
                x = A[mid]; x = x[(x[:, 0] >= T0) & (x[:, 0] < T1)]
                y = P.get(mid); y = y[(y[:, 0] >= T0) & (y[:, 0] < T1)] if y is not None and len(y) else np.zeros((0, 4))
                a += len(x); b += len(y); a_sh += x[:, 3].sum(); b_sh += y[:, 3].sum()
            print(f"  apitape.py's {label}: {len(sel)} markets; prints API {a:.0f}, pm-rec {b:.0f} ({100 * b / max(1, a):.0f} %); "
                  f"shares API {a_sh:.0f}, pm-rec {b_sh:.0f} ({100 * b_sh / max(1, a_sh):.0f} %)")
        # where the missing prints are: in minutes pm-rec recorded the market's book, or while it was not recording it
        a_in = a_all = b_all = 0
        for mid in A:
            z = set(int(m) for m in np.load(os.path.join(lib.WORK, 'mk', f'{mid}.npz'))['m'])
            x = A[mid]; x = x[(x[:, 0] >= T0) & (x[:, 0] < T1)]
            mins = np.floor(x[:, 0] / 60).astype(int)
            a_all += len(x); a_in += sum(1 for m in mins if m in z or (m - 1) in z)
            y = P.get(mid); b_all += int(((y[:, 0] >= T0) & (y[:, 0] < T1)).sum()) if y is not None and len(y) else 0
        print(f"  of the API's {a_all} prints in those markets, {a_in} ({100 * a_in / max(1, a_all):.0f} %) fall in minutes pm-rec recorded the "
              f"market's book; pm-rec holds {b_all} prints for them: the tape is about complete where the book was recorded, "
              f"and missing where it was not")
    print("\n  by market (kind, cond, API trades / pm-rec prints, question):")
    for r in sorted(res, key=lambda r: (r['kind'], -(r['api'] or 0))):
        print(f"    {r['kind']:<11}{r['cond'][:10]} {str(r['api']):>5} / {r['rec']:<5} {r['q']}")
