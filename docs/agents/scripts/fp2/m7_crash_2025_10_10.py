"""M7: the 2025-10-10 liquidation crash on Revolut X UK books vs Binance (in-sample day; descriptive).
For each T2 book: the lowest UK print of the day vs Binance's lowest 1-minute low (USD via USDCUSDT), the
UK prints below Binance's same-minute low (a UK-only wick a standing bid could catch) and above its high,
and the $ traded in them. Output results/m7_crash_2025_10_10.json"""
import json, os, datetime
S=(__import__('os').environ.get('FP_ROOT', '.') + '/research_fp2')
R=(__import__('os').environ.get('FP_ROOT', '.') + '/research_fp')
usdc={r[0]:r[4] for r in json.load(open(R+'/data/binance_year/USDCUSDT_1m.json'))}
out={}
for book in ['SUI-USD','NEAR-USD','FET-USD','ICP-USD','BCH-USD','AVAX-USD']:
    fn=S+'/data/revx_prints/%s/2025-10-10.json'%book
    if not os.path.exists(fn): continue
    K={r[0]:r for r in json.load(open(S+'/data/binance/%sUSDT_1m.json'%book.split('-')[0]))}
    rows=json.load(open(fn))['rows']
    lo_uk=min(float(r['price']) for r in rows); t_lo=[r['timestamp'] for r in rows if float(r['price'])==lo_uk][0]
    d0=int(datetime.datetime(2025,10,10,tzinfo=datetime.timezone.utc).timestamp()*1000)
    bl=min((K[t][3]/usdc[t],t) for t in range(d0,d0+86400000,60000) if t in K and t in usdc)
    below=[];above=[]
    for r in rows:
        m=r['timestamp']//60000*60000
        if m not in K or m not in usdc: continue
        lo=K[m][3]/usdc[m]; hi=K[m][2]/usdc[m]; p=float(r['price']); usd=p*float(r['quantity'])
        if p<lo: below.append(((lo/p-1)*1e4,usd,r['side']))
        if p>hi: above.append(((p/hi-1)*1e4,usd,r['side']))
    o={'prints':len(rows),'uk_low':lo_uk,'uk_low_time':datetime.datetime.utcfromtimestamp(t_lo/1000).isoformat(),
       'binance_low_usd':bl[0],'binance_low_time':datetime.datetime.utcfromtimestamp(bl[1]/1000).isoformat(),
       'uk_low_vs_binance_low_pct':(lo_uk/bl[0]-1)*100,
       'prints_below_binance_minute_low':len(below),'usd_below':sum(u for _,u,_ in below),'max_bps_below':max([b for b,_,_ in below],default=0),
       'prints_below_ge_100bps':sum(1 for b,_,_ in below if b>=100),'usd_below_ge_100bps':sum(u for b,u,_ in below if b>=100),
       'prints_above_binance_minute_high':len(above),'usd_above':sum(u for _,u,_ in above),'max_bps_above':max([b for b,_,_ in above],default=0)}
    out[book]=o
    print(book,{k:(round(v,2) if isinstance(v,float) else v) for k,v in o.items()})
json.dump(out,open(S+'/results/m7_crash_2025_10_10.json','w'),indent=1)
