"""M3 (IN-SAMPLE DAYS ONLY, day < 2026-05-01): descriptive facts about Revolut X UK prints on the pulled books.
Fair F(m) for a print in minute m = Binance close of minute m-1 (coin/USDT) / Binance USDCUSDT close of m-1
(USD per coin, taking USDC = $1). For each print: dev = p/F - 1 (bps), the taker side, and the resident maker's
markout at +1/+5/+15/+60 minutes against F at that time (positive = the maker earned).
Reports per book: prints/day, $/day, print-size quantiles, effective half-spread (median buy dev, median -sell dev),
maker markouts (mean, $-weighted mean), and the share of $ volume printed at |dev| >= k bps.
It never opens an out-of-sample day.
"""
import json, os, glob, statistics, bisect, collections
S=(__import__('os').environ.get('FP_ROOT', '.') + '/research_fp2')
R=(__import__('os').environ.get('FP_ROOT', '.') + '/research_fp')
CUT='2026-05-01'
EXCL={'2025-10-10'}   # the liquidation crash: its markouts are thousands of bps and swamp the means (see m7)
def load_kl(fn):
    return {r[0]:r[4] for r in json.load(open(fn))}
usdc=load_kl(R+'/data/binance_year/USDCUSDT_1m.json')
out={}
for bookdir in [S+'/data/revx_prints/'+b for b in ('C98-USD','W-USD','CELO-USD','AUCTION-USD','KAVA-USD','ANKR-USD')]:
    book=os.path.basename(bookdir); base=book.split('-')[0]
    kfn=S+'/data/binance/%sUSDT_1m.json'%base
    if not os.path.exists(kfn): continue
    kl=load_kl(kfn)
    days=[f for f in sorted(glob.glob(bookdir+'/*.json')) if os.path.basename(f)[:10]<CUT and os.path.basename(f)[:10] not in EXCL]
    if not days: continue
    P=[]; nd=0
    for f in days:
        d=json.load(open(f)); nd+=1
        for r in d['rows']:
            t=r['timestamp']; m=t//60000*60000; pm=m-60000
            if pm not in kl or pm not in usdc: continue
            F=kl[pm]/usdc[pm]
            p=float(r['price']); q=float(r['quantity'])
            dev=(p/F-1)*1e4
            mk={}
            for h in (1,5,15,60):
                fm=m+h*60000-60000   # close of minute m+h-1 = price at start of minute m+h
                if fm in kl and fm in usdc:
                    Fh=kl[fm]/usdc[fm]
                    mk[h]=((Fh/p-1) if r['side']=='sell' else (1-Fh/p))*1e4
            P.append((dev,r['side'],p*q,mk))
    if not P: continue
    buys=[x[0] for x in P if x[1]=='buy']; sells=[-x[0] for x in P if x[1]=='sell']
    usd=[x[2] for x in P]
    qs=lambda v,p: sorted(v)[int(p*(len(v)-1))]
    mko={}
    for h in (1,5,15,60):
        v=[(x[3][h],x[2]) for x in P if h in x[3]]
        if v: mko[h]={'mean':statistics.mean(a for a,_ in v),'usd_weighted':sum(a*w for a,w in v)/sum(w for _,w in v),'median':statistics.median(a for a,_ in v),'n':len(v)}
    tot=sum(usd)
    share={k:sum(x[2] for x in P if abs(x[0])>=k)/tot for k in (5,10,15,20,30,50,100)}
    out[book]={'is_days':nd,'prints':len(P),'prints_per_day':len(P)/nd,'usd_per_day':tot/nd,
               'size_usd_q':{p:qs(usd,p) for p in (0.1,0.5,0.9,0.99)},
               'eff_half_spread_buy_med':statistics.median(buys) if buys else None,'eff_half_spread_sell_med':statistics.median(sells) if sells else None,
               'maker_markout_bps':mko,'usd_share_at_absdev_ge':share,'n_buy':len(buys),'n_sell':len(sells)}
json.dump(out,open(S+'/results/m3_is_descriptives_longtail_excl_2025-10-10.json','w'),indent=1,sort_keys=True)
for b,o in out.items():
    print('%-10s days %2d prints/d %5.0f $/d %8.0f  size med $%5.0f p90 $%6.0f | eff half-spr buy %5.1f sell %5.1f | maker mk mean 1/5/15/60: %s | $-wtd 5m %.1f | $ share |dev|>=10/20/50: %.2f %.2f %.2f'%(
        b,o['is_days'],o['prints_per_day'],o['usd_per_day'],o['size_usd_q'][0.5],o['size_usd_q'][0.9],o['eff_half_spread_buy_med'] or 0,o['eff_half_spread_sell_med'] or 0,
        '/'.join('%.1f'%o['maker_markout_bps'][h]['mean'] for h in (1,5,15,60) if h in o['maker_markout_bps']),o['maker_markout_bps'][5]['usd_weighted'],
        o['usd_share_at_absdev_ge'][10],o['usd_share_at_absdev_ge'][20],o['usd_share_at_absdev_ge'][50]))
