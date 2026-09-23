"""M1: from the first program's live session (122 one-minute snapshots, 2026-09-23 10:41-12:42 UTC):
per Revolut X UK USD book with a Binance USDT counterpart, the UK half-spread (median, p10, p90),
the local basis (UK mid vs Binance mid converted to USD by BTC's UK/Binance ratio that minute),
and the share of snapshots where the UK touch is crossed through Binance's touch by >= 10/20/30/50 bps
(UK ask below Binance bid, or UK bid above Binance ask) - the stale-quote-taking opportunity.
Input: research_fp/data/live/{revx,binance}_tickers.jsonl. Output: results/m1_live_spreads_crosses.json
"""
import json, statistics, os
R=(__import__('os').environ.get('FP_ROOT', '.') + '/research_fp')
S=(__import__('os').environ.get('FP_ROOT', '.') + '/research_fp2')
rv=[json.loads(l) for l in open(R+'/data/live/revx_tickers.jsonl')]
bn=[json.loads(l) for l in open(R+'/data/live/binance_tickers.jsonl')]
bnm={s['minute']:s for s in bn}
per={}
for s in rv:
    b=bnm.get(s['minute'])
    if not b or s['status']!=200 or b['status']!=200: continue
    def fl(x):
        try: return float(x)
        except (TypeError, ValueError): return 0.0
    B={r[0]:(fl(r[1]),fl(r[3])) for r in b['rows']}
    U={r[0]:(fl(r[1]),fl(r[2])) for r in s['rows']}
    if 'BTC/USD' not in U or 'BTCUSDT' not in B: continue
    fx=((U['BTC/USD'][0]+U['BTC/USD'][1])/2)/((B['BTCUSDT'][0]+B['BTCUSDT'][1])/2)  # USD per USDT as RevX prices it
    for sym,(ub,ua) in U.items():
        base,q=sym.split('/')
        if q!='USD' or base+'USDT' not in B: continue
        bb,ba=B[base+'USDT']
        if ub<=0 or ua<=0 or bb<=0 or ba<=0: continue
        bb*=fx; ba*=fx
        bm=(bb+ba)/2; um=(ub+ua)/2
        d=per.setdefault(sym,{'h':[],'basis':[],'x':[],'bnh':[]})
        d['h'].append((ua-ub)/2/um*1e4)
        d['bnh'].append((ba-bb)/2/bm*1e4)
        d['basis'].append((um/bm-1)*1e4)
        d['x'].append(max((bb-ua)/bm*1e4,(ub-ba)/bm*1e4))   # >0 means crossed by that many bps
out={}
for sym,d in per.items():
    n=len(d['h'])
    if n<60: continue
    q=lambda v,p: sorted(v)[int(p*(len(v)-1))]
    out[sym]={'n':n,'h_med':statistics.median(d['h']),'h_p10':q(d['h'],.1),'h_p90':q(d['h'],.9),'bn_h_med':statistics.median(d['bnh']),
              'basis_med':statistics.median(d['basis']),'basis_p10':q(d['basis'],.1),'basis_p90':q(d['basis'],.9),
              'cross_ge':{k:sum(x>=k for x in d['x'])/n for k in (0,10,20,30,50)},'cross_max':max(d['x'])}
json.dump(out,open(S+'/results/m1_live_spreads_crosses.json','w'),indent=1,sort_keys=True)
rows=sorted(out.items(),key=lambda kv:-kv[1]['h_med'])
print('books',len(out))
print('%-11s %4s %6s %6s %6s %6s %7s %7s %6s %6s %6s %6s'%('book','n','h_med','h_p10','h_p90','bn_h','basis','b_p10','x>=10','x>=20','x>=30','xmax'))
for sym,o in rows:
    if o['h_med']<3: continue
    print('%-11s %4d %6.1f %6.1f %6.1f %6.2f %7.1f %7.1f %6.3f %6.3f %6.3f %6.1f'%(sym,o['n'],o['h_med'],o['h_p10'],o['h_p90'],o['bn_h_med'],o['basis_med'],o['basis_p10'],o['cross_ge'][10],o['cross_ge'][20],o['cross_ge'][30],o['cross_max']))
import collections
tot=collections.Counter()
for sym,o in out.items():
    for k,v in o['cross_ge'].items(): tot[k]+=v*o['n']
print('all books: snapshots', sum(o['n'] for o in out.values()), 'crossed>=k:', dict(tot))
