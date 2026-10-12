# LP-ADVERSE: every live fill with its markouts and features, and live-prep's P&L rebuilt from them.
#   LPADV_WORK=<scratch> python3 -I docs/agents/backtests/lpadverse/scripts/build.py
# Reads (in WORK): live_fills.json (sql/live_fills.sql), live_aux.json (sql/live_aux.sql), lm_10{09..12}.json.gz
# (sql/live_minutes.sql), targets.json (sql/targets.sql), books.pkl (extract_books.py). Writes WORK/fills.pkl (the table
# every other script reads) and, committed: data/fills.csv and results/reproduce.txt.
import sys, os, json, pickle, math, csv
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lib import *

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
fills = jload('live_fills.json')['rows']
aux = jload('live_aux.json')
lm = []
for d in ('1009', '1010', '1011', '1012'): lm.extend(jload(f'lm_{d}.json.gz')['rows'])
tg = jload('targets.json')['ids']
cond_of_id = {r[0]: r[1] for r in tg}
meta = {r[1]: {'id': r[0], 'yes': r[2], 'question': r[3], 'end': r[4], 'event': r[5], 'neg_risk': r[6], 'fee_type': r[7]} for r in tg}
rb = pickle.load(open(os.path.join(WORK, 'books.pkl'), 'rb'))
mids = Mids(lm, rb['books'], cond_of_id)
prints = rb['prints']  # (id, ts, side, oi, price, size)
pr_by = {}
for p in prints:
    c = cond_of_id.get(p[0])
    if c: pr_by.setdefault(c, []).append(p)
for c in pr_by: pr_by[c].sort(key=lambda p: p[1])

mk = {}
for m in aux['markets']:
    mk.setdefault(m['cond'], []).append(m)
yes_tok, no_tok = {}, {}
for m in aux['markets']:
    yes_tok[m['cond']] = m['yes_token']; no_tok[m['cond']] = m['no_token']
for m in aux['recmeta']:
    yes_tok.setdefault(m['cond'], m['yes']); no_tok.setdefault(m['cond'], m['no'])
    meta.setdefault(m['cond'], {'question': m['question'], 'end': m['end_date']})
settle = {s['cond']: (float(s['payout']), ep(s['settled_at'])) for s in aux['settlements']}
rdays = {(r['day'], r['cond']): r for r in aux['reward_days']}

# live minutes by (cond, minute): programme, quotes, scoring, held, state
lmi = {}
for r in lm:
    lmi[(r[1], int(r[0]))] = r

def question(c):
    return (meta.get(c) or {}).get('question') or next((m['question'] for m in mk.get(c, [])), '?')

def end_of(c):
    e = (meta.get(c) or {}).get('end') or next((m['end_date'] for m in mk.get(c, []) if m['end_date']), None)
    return ep(e) if e else None

def prog(c, t):
    """The programme (rate, v, min size, tick) the live minutes read nearest before t, else the selection's."""
    for dt in range(0, 3 * 3600, 60):
        r = lmi.get((c, int(t // 60 * 60) - dt))
        if r: return float(r[13] or 0), float(r[14] or 0), float(r[15] or 0), float(r[16] or 0.01)
    ms = mk.get(c) or []
    if ms: m = ms[-1]; return float(m['rate'] or 0), float(m['max_spread'] or 0), float(m['min_size'] or 0), float(m['tick'] or 0.01)
    return None, None, None, None

def vol_and_prints(c, t, win=3600):
    """The minute-to-minute moves of the mid over the hour before t (std, cents; and the hour's absolute range), and the
    taker prints in that hour (count, shares)."""
    ks = mids.keys.get(c) or []
    i = bisect.bisect_right(ks, int(t)) - 1
    xs = []
    while i >= 0 and ks[i] >= t - win:
        m = Mids.midof(mids.s[c][ks[i]])
        if m is not None: xs.append(m)
        i -= 1
    xs.reverse()
    d = [100 * (b - a) for a, b in zip(xs, xs[1:])]
    sd = (sum(x * x for x in d) / len(d)) ** 0.5 if len(d) >= 5 else None
    rng = 100 * (max(xs) - min(xs)) if len(xs) >= 5 else None
    ps = pr_by.get(c) or []
    j0 = bisect.bisect_left([p[1] for p in ps], t - win) if ps else 0
    n = sh = 0
    for p in ps[j0:]:
        if p[1] >= t: break
        n += 1; sh += float(p[5])
    return sd, rng, n, sh

HZ = [('fill', 0), ('1m', 60), ('5m', 300), ('15m', 900), ('60m', 3600), ('6h', 21600)]
rows = []
for f in fills:
    c = f['cond']; t = ep(f['match_time']); side = f['side']; px = float(f['price']); sz = float(f['size'])
    out = 'yes' if f['token'] == yes_tok.get(c) else 'no' if f['token'] == no_tok.get(c) else None
    if out is None: out = f.get('o_outcome')
    # YES-equivalent: a BUY YES or a SELL NO adds YES exposure (d = +1) at y; a BUY NO or a SELL YES removes it (d = -1).
    d = (1 if side == 'BUY' else -1) * (1 if out == 'yes' else -1)
    y = px if out == 'yes' else 1 - px
    r = {'trade_id': f['trade_id'], 'cond': c, 'q': question(c), 'type': mtype(question(c)), 'lp_type': lp_type(question(c)),
         'side': side, 'outcome': out, 'd': d, 'price': px, 'y': y, 'size': sz, 't': t, 'day': day_of(t), 'hour': int((t % 86400) // 3600),
         'o_ts': ep(f['o_ts']) if f['o_ts'] else None, 'gate': f['o_gate'], 'reason': f['o_reason'],
         'taker_size': float(f['taker_size'] or 0), 'n_makers': f['n_makers'], 'n_levels': len(f['maker_prices'] or []),
         'fee_bps': f['fee_bps'], 'trader_side': f['trader_side']}
    r['rest_s'] = t - r['o_ts'] if r['o_ts'] else None
    # How far past our price the taker's own trade went, in YES-equivalent cents on our side (0: it took only our level):
    # each maker order it took, at its YES-equivalent price (a NO order at p is a YES order at 1 - p).
    ys = [float(m[2]) if str(m[0]).lower() == 'yes' else 1 - float(m[2]) for m in (f.get('makers') or [])]
    if ys:
        deep = min(ys) if d == 1 else max(ys)
        r['sweep_c'] = round(100 * d * (y - deep), 4)
        # shares the taker took at prices strictly past ours (what a deeper quote could have had)
        r['past_sh'] = sum(float(m[3]) for m, yy in zip(f['makers'], ys) if d * (y - yy) > 1e-9)
    else:
        r['sweep_c'] = None; r['past_sh'] = None
    # Mid just before the fill: the last book recorded at or before (fill - 5 s), and its touch.
    k, v = mids.at(c, t - 5, tol=600, after=False)
    r['src_pre'] = v[4] if v else None
    for name, h in HZ:
        if h == 0:
            r['m_fill'] = Mids.midof(v); r['ma_fill'] = Mids.midof(v, True)
        else:
            r['m_' + name] = mids.mid(c, t + h, tol=max(600, h // 4)); r['ma_' + name] = mids.mid(c, t + h, tol=max(600, h // 4), adjusted=True)
    if v:
        bb, ba = v[0], v[1]
        r['bb'], r['ba'] = bb, ba
        r['width_c'] = None if bb is None or ba is None else round(100 * (ba - bb), 4)
        r['tick'] = v[5]
    else:
        r['bb'] = r['ba'] = r['width_c'] = r['tick'] = None
    rate, vv, ms_, tick = prog(c, t)
    r['rate'], r['v'], r['min_size'] = rate, vv, ms_
    if not r['tick']: r['tick'] = tick
    r['dist_c'] = None if r['m_fill'] is None else round(100 * d * (r['m_fill'] - y), 4)  # >0: we bought under / sold over the mid
    # Depth at the touch of the book before the fill (pm-rec ladder when recorded): shares at the best bid / ask and within 3 c.
    kk, vr = None, None
    ks = mids.keys.get(c) or []
    i = bisect.bisect_right(ks, int(t - 5)) - 1
    while i >= 0 and ks[i] >= t - 600:
        if mids.s[c][ks[i]][6] is not None: vr = mids.s[c][ks[i]]; break
        i -= 1
    if vr and vr[6] and vr[7]:
        bids, asks = vr[6], vr[7]
        r['depth3_bid'] = sum(s for p, s in bids if p >= bids[0][0] - 0.03 + 1e-9)
        r['depth3_ask'] = sum(s for p, s in asks if p <= asks[0][0] + 0.03 - 1e-9)
        # our side's depth: the side the taker hit (our bid if d = +1 in the YES book, our ask if d = -1)
        r['depth3_our'] = r['depth3_bid'] if d == 1 else r['depth3_ask']
        r['depth3_opp'] = r['depth3_ask'] if d == 1 else r['depth3_bid']
    else:
        r['depth3_bid'] = r['depth3_ask'] = r['depth3_our'] = r['depth3_opp'] = None
    sd, rng, npr, shp = vol_and_prints(c, t)
    r['vol_sd_c'], r['vol_rng_c'], r['prints_1h'], r['print_sh_1h'] = sd, rng, npr, shp
    sd24, rng24, npr24, shp24 = vol_and_prints(c, t, 86400)
    r['vol_rng24_c'], r['prints_24h'] = rng24, npr24
    e = end_of(c); r['end'] = e; r['days_to_end'] = None if e is None else (e - t) / 86400
    s = settle.get(c)
    r['payout'] = s[0] if s else None; r['settled_at'] = s[1] if s else None
    # Day rank and refill flag of the market's selection that day (None: carried, not selected)
    sel = [m for m in mk.get(c, []) if m['day'] == r['day']]
    r['rank'] = sel[0]['rank'] if sel else None; r['refill'] = bool(sel[0]['refill']) if sel else None
    lmr = lmi.get((c, int(t // 60 * 60)))
    r['state'] = lmr[23] if lmr else None
    rows.append(r)

for r in rows:
    for name, h in HZ:
        m = r['m_' + name]
        r['mo_' + name] = None if m is None else r['d'] * (m - r['y']) * r['size']
    # value at resolution (payout) where resolved, else None
    r['mo_res'] = None if r['payout'] is None else r['d'] * (r['payout'] - r['y']) * r['size']

pickle.dump({'rows': rows, 'settle': settle, 'yes_tok': yes_tok, 'no_tok': no_tok, 'mk': mk, 'rdays': rdays}, open(os.path.join(WORK, 'fills.pkl'), 'wb'))
cols = ['trade_id', 'cond', 'type', 'lp_type', 'side', 'outcome', 'd', 'price', 'y', 'size', 't', 'day', 'hour', 'rest_s', 'gate', 'reason', 'state',
        'rank', 'refill', 'taker_size', 'n_makers', 'n_levels', 'sweep_c', 'past_sh', 'src_pre', 'bb', 'ba', 'width_c', 'tick', 'dist_c', 'depth3_our', 'depth3_opp',
        'rate', 'v', 'min_size', 'vol_sd_c', 'vol_rng_c', 'prints_1h', 'print_sh_1h', 'vol_rng24_c', 'prints_24h', 'days_to_end', 'payout',
        'm_fill', 'm_1m', 'm_5m', 'm_15m', 'm_60m', 'm_6h', 'mo_fill', 'mo_1m', 'mo_5m', 'mo_15m', 'mo_60m', 'mo_6h', 'mo_res']
def fmt(x):
    if isinstance(x, float): return f'{x:.6g}'
    return '' if x is None else x
with open(os.path.join(HERE, 'data', 'fills.csv'), 'w', newline='') as fh:
    w = csv.writer(fh, lineterminator='\n'); w.writerow(cols)
    for r in rows: w.writerow([fmt(r[c][:10] if c == 'cond' else r[c]) if c != 'trade_id' else r[c][:8] for c in cols])
cov = {name: sum(1 for r in rows if r['m_' + name] is not None) for name, _ in HZ}
print(len(rows), 'fills; mid coverage', cov)
