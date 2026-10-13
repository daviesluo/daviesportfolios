# LP-BEST, step 11: the print tape again, from Polymarket's keyless data API, for every market the quiet-book rules can
# pick (every eligible market-day with a touch of at least 3 c at 00:00), 2026-10-04 19:00 -> 10-12 23:59 UTC. pm-rec's
# tape missed prints in markets the rule calls quiet (tapecheck.py); with LPBEST_API_TAPE=1 lib.py reads these markets'
# prints from here instead (<work>/prints_api.pkl), and the quiet rule is priced again on them.
#   LPBEST_WORK=<scratch> python3 -I docs/agents/backtests/lpbest/scripts/apitape.py
import os, sys, json, time, pickle, urllib.request
import numpy as np
from concurrent.futures import ThreadPoolExecutor
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lib, strat

T0, T1 = 1791140400, 1791849600     # 2026-10-04 19:00 -> 2026-10-13 00:00 UTC
UA = {'User-Agent': 'curl/8.5.0', 'Accept': 'application/json'}   # the API's edge answers 403 to Python's default agent

def fetch(cond):
    out, off = [], 0
    while off <= 9500:
        url = f"https://data-api.polymarket.com/trades?market={cond}&limit=500&offset={off}&takerOnly=true"
        rows = None
        for attempt in range(4):
            try:
                rows = json.load(urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30)); break
            except Exception:
                time.sleep(1 + 2 * attempt)
        if rows is None: return None
        if not rows: break
        out.extend(rows)
        if min(int(r['timestamp']) for r in rows) < T0 or len(rows) < 500: break
        off += 500
    return out

if __name__ == '__main__':
    df = strat.daytable()
    e = strat.eligible(df, min_width_c=3)
    mids = sorted(set(int(m) for m in e.mid))
    md = lib.meta()
    def one(mid):
        rows = fetch(md[mid]['cond'])
        if rows is None: return mid, None, 0
        pr = set()
        for r in rows:
            ts = int(r['timestamp'])
            if not (T0 <= ts < T1): continue
            oi = int(r.get('outcomeIndex', 0)); p = float(r['price']); s = float(r['size'])
            buy = r['side'] == 'BUY'
            if oi == 1: buy = not buy; p = 1 - p
            pr.add((ts, 1 if buy else -1, p, s, r.get('transactionHash', '')))
        arr = np.array(sorted((a, b, c, d) for (a, b, c, d, h) in pr), np.float64).reshape(-1, 4)
        return mid, arr, len(rows)
    with ThreadPoolExecutor(6) as ex:
        res = list(ex.map(one, mids))
    out = {mid: arr for mid, arr, n in res if arr is not None}
    failed = [mid for mid, arr, n in res if arr is None]
    capped = [mid for mid, arr, n in res if n >= 10000]
    pickle.dump(out, open(os.path.join(lib.WORK, 'prints_api.pkl'), 'wb'), protocol=5)
    print(f"{len(mids)} markets asked; {len(out)} read; {len(failed)} failed; {len(capped)} at the 10,000-row page cap; "
          f"{sum(len(v) for v in out.values())} prints kept")
