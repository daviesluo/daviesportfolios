"""M4 (IN-SAMPLE DAYS ONLY): for UK prints far from Binance fair, does price come back?
For each print: dev = p/F - 1 in the taker's direction (buy: p above F is positive; sell: p below F is positive),
i.e. how far past fair the taker paid. Buckets of that 'depth'. For each bucket: count, $ volume per day,
and the resting side's markout at +1/+5/+15/+60 min (bps; positive = a quote resting at that print's price earned),
plus how much of the depth is still there after 5 and 60 minutes (the reversion share).
Also the stale-cross check on prints: a BUY print below Binance's same-minute LOW (the taker lifted an ask under
every Binance price that minute) or a SELL print above the same-minute HIGH, by >= 10/20/50 bps, per day.
"""
import json, os, glob, statistics, collections
S=(__import__('os').environ.get('FP_ROOT', '.') + '/research_fp2')
R=(__import__('os').environ.get('FP_ROOT', '.') + '/research_fp')
CUT='2026-05-01'
import sys
EXCL=set(sys.argv[1].split(',')) if len(sys.argv)>1 and sys.argv[1] else set()   # days to leave out (e.g. 2025-10-10)
OUTSUF=('_excl_'+'_'.join(sorted(EXCL))) if EXCL else ''
usdc={r[0]:r[4] for r in json.load(open(R+'/data/binance_year/USDCUSDT_1m.json'))}
BK=[(0,10),(10,20),(20,30),(30,50),(50,100),(100,10**9)]
out={}
for bookdir in sorted(glob.glob(S+'/data/revx_prints/*-USD')):
    book=os.path.basename(bookdir); base=book.split('-')[0]
    kfn=S+'/data/binance/%sUSDT_1m.json'%base
    if not os.path.exists(kfn): continue
    K={r[0]:r for r in json.load(open(kfn))}
    days=[f for f in sorted(glob.glob(bookdir+'/*.json')) if os.path.basename(f)[:10]<CUT and os.path.basename(f)[:10] not in EXCL]
    if not days: continue
    B={b:{'n':0,'usd':0.0,'mk':collections.defaultdict(list),'mkw':collections.defaultdict(float)} for b in BK}
    cross=collections.Counter()
    for f in days:
        for r in json.load(open(f))['rows']:
            t=r['timestamp']; m=t//60000*60000; pm=m-60000
            if pm not in K or pm not in usdc: continue
            F=K[pm][4]/usdc[pm]; p=float(r['price']); usd=p*float(r['quantity'])
            sg=1 if r['side']=='buy' else -1
            depth=sg*(p/F-1)*1e4
            if m in K and m in usdc:
                lo=K[m][3]/usdc[m]; hi=K[m][2]/usdc[m]
                if sg==1 and p<lo:
                    x=(lo/p-1)*1e4
                    for th in (10,20,50):
                        if x>=th: cross[('buy_below_low',th)]+=1
                if sg==-1 and p>hi:
                    x=(p/hi-1)*1e4
                    for th in (10,20,50):
                        if x>=th: cross[('sell_above_high',th)]+=1
            if m in K and m in usdc:
                lo2=K[m][3]/usdc[m]; hi2=K[m][2]/usdc[m]
                beyond=((p/hi2-1)*1e4 if sg==1 else (lo2/p-1)*1e4)   # >0: the taker paid beyond every Binance price that minute
                for th in (10,20,30,50,100):
                    if beyond>=th:
                        cross[('beyond_range_taker',th)]+=1; cross[('beyond_range_taker_usd',th)]+=usd
            for b in BK:
                if b[0]<=depth<b[1]:
                    d=B[b]; d['n']+=1; d['usd']+=usd
                    for h in (1,5,15,60):
                        fm=m+h*60000-60000
                        if fm in K and fm in usdc:
                            Fh=K[fm][4]/usdc[fm]
                            mk=sg*(p/Fh-1)*1e4   # resting side earned: sold above / bought below later fair
                            d['mk'][h].append(mk); d['mkw'][h]+=mk*usd
                    break
    nd=len(days)
    out[book]={'is_days':nd,'buckets':{'%d-%s'%(b[0],b[1] if b[1]<10**9 else 'inf'):{'n':B[b]['n'],'per_day':B[b]['n']/nd,'usd_per_day':B[b]['usd']/nd,
               'markout_mean':{h:statistics.mean(v) for h,v in B[b]['mk'].items() if v},
               'markout_usd_wtd':{h:B[b]['mkw'][h]/B[b]['usd'] for h in B[b]['mk'] if B[b]['usd']>0}} for b in BK},
               'stale_cross_per_day':{'%s_%d'%k:v/nd for k,v in cross.items()}}
json.dump(out,open(S+'/results/m4_is_markout_by_depth%s.json'%OUTSUF,'w'),indent=1,sort_keys=True)
for book,o in out.items():
    print(book,'IS days',o['is_days'],' stale crosses/day:',{k:round(v,2) for k,v in sorted(o['stale_cross_per_day'].items())})
    for b,x in o['buckets'].items():
        if x['n']==0: continue
        mk=x['markout_mean']; mw=x['markout_usd_wtd']
        print('   depth %-8s n %4d (%5.1f/d, $%7.0f/d)  markout mean 1/5/15/60: %s   $-wtd 5/60: %s'%(b,x['n'],x['per_day'],x['usd_per_day'],'/'.join('%.0f'%mk[h] for h in (1,5,15,60) if h in mk),'/'.join('%.0f'%mw[h] for h in (5,60) if h in mw)))
