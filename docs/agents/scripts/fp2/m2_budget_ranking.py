"""M2: which Revolut X UK USD books could a slow, budget-limited quoter sit inside?
For each UK USD book with a Binance USDT twin: UK half-spread h (median of the first program's 122 live
snapshots), Binance 1-minute sigma (std of 1m log returns over the last 1,000 minutes, public klines),
the placements a day needed to keep ONE quote inside a band of half-width w = h/3 around a moving fair
(first passage ~ w^2/sigma^2 minutes -> 1440*sigma^2/w^2 per side, capped at 1440), and the UK book's
mean daily USD volume over the last 90 days (UK daily candles pulled by the first program).
Output: results/m2_budget_ranking.json
"""
import json, math, os, statistics, sys, time
sys.path.insert(0, (__import__('os').environ.get('FP_ROOT', '.') + '/research_fp2/scripts'))
import netlib
R=(__import__('os').environ.get('FP_ROOT', '.') + '/research_fp')
S=(__import__('os').environ.get('FP_ROOT', '.') + '/research_fp2')
live=json.load(open(S+'/results/m1_live_spreads_crosses.json'))
cache=os.path.join(S,'data','binance_1m_last1000'); os.makedirs(cache,exist_ok=True)
out={}
for book,x in sorted(live.items()):
    base=book.split('/')[0]
    if abs(x['basis_med'])>50: continue   # a different token under the same ticker (AI, IOTX, EGLD)
    fn=os.path.join(cache,base+'USDT.json')
    if not os.path.exists(fn):
        st,d,t0,t1=netlib.get_json('https://data-api.binance.vision/api/v3/klines?symbol=%sUSDT&interval=1m&limit=1000'%base)
        if st!=200 or not d: continue
        json.dump({'fetched_at':t0,'rows':d},open(fn,'w'))
    rows=json.load(open(fn))['rows']
    c=[float(r[4]) for r in rows]
    rets=[math.log(c[i]/c[i-1])*1e4 for i in range(1,len(c)) if c[i-1]>0 and c[i]>0]
    if len(rets)<500: continue
    sig=statistics.pstdev(rets)
    h=x['h_med']; w=h/3
    per_side=min(1440, 1440*sig*sig/(w*w)) if w>0 else 1440
    vfn=R+'/data/revx_hist/%s-USD_1440m.json'%base
    vol=None
    if os.path.exists(vfn):
        dd=json.load(open(vfn))[-90:]
        vol=sum(r[5]*r[4] for r in dd)/max(1,len(dd))
    out[book]={'h':h,'sigma_1m':sig,'h_over_sigma':h/sig if sig>0 else None,'placements_per_side_day':per_side,'uk_usd_per_day_90d':vol,'bn_h':x['bn_h_med']}
json.dump(out,open(S+'/results/m2_budget_ranking.json','w'),indent=1,sort_keys=True)
rows=sorted(out.items(),key=lambda kv:-(kv[1]['uk_usd_per_day_90d'] or 0))
print('%-12s %6s %6s %6s %8s %10s'%('book','h','sig1m','h/sig','plc/side','UK$/day90'))
for b,o in rows[:60]:
    print('%-12s %6.1f %6.1f %6.2f %8.0f %10.0f'%(b,o['h'],o['sigma_1m'],o['h_over_sigma'],o['placements_per_side_day'],o['uk_usd_per_day_90d'] or 0))
