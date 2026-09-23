"""M11: 2025-10-10, how long the UK bids lagged above Binance (descriptive, in-sample day).
Per book: minutes in which some UK SELL print (a taker hitting the UK bid) was >= 1 % / 5 % above Binance's
same-minute HIGH (USD via USDCUSDT), the longest run of consecutive such minutes, and the $ sold in them."""
import json, datetime
S=(__import__('os').environ.get('FP_ROOT', '.') + '/research_fp2')
R=(__import__('os').environ.get('FP_ROOT', '.') + '/research_fp')
usdc={r[0]:r[4] for r in json.load(open(R+'/data/binance_year/USDCUSDT_1m.json'))}
out={}
for book in ['SUI-USD','NEAR-USD','FET-USD','ICP-USD','BCH-USD','AVAX-USD']:
    K={r[0]:r for r in json.load(open(S+'/data/binance/%sUSDT_1m.json'%book.split('-')[0]))}
    rows=json.load(open(S+'/data/revx_prints/%s/2025-10-10.json'%book))['rows']
    o={}
    for th in (0.01,0.05):
        mins={}
        for r in rows:
            if r['side']!='sell': continue
            m=r['timestamp']//60000*60000
            if m in K and m in usdc and float(r['price'])>=K[m][2]/usdc[m]*(1+th):
                mins[m]=mins.get(m,0)+float(r['price'])*float(r['quantity'])
        ms=sorted(mins); best=cur=0; prev=None
        for m in ms:
            cur=cur+1 if prev is not None and m-prev==60000 else 1; best=max(best,cur); prev=m
        o['ge_%d%%'%int(th*100)]={'minutes':len(ms),'longest_run_min':best,'usd_sold':round(sum(mins.values())),
             'first':ms and datetime.datetime.utcfromtimestamp(ms[0]/1000).strftime('%H:%M'),'last':ms and datetime.datetime.utcfromtimestamp(ms[-1]/1000).strftime('%H:%M')}
    out[book]=o; print(book,o)
json.dump(out,open(S+'/results/m11_crash_lag_duration.json','w'),indent=1)
