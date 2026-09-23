"""M8: Binance's 24/7 tokenised US stocks against the stocks' own open (descriptive; IN-SAMPLE NIGHTS ONLY,
i.e. US closes before M8_BEFORE, default 2026-08-10 - later nights are held out for a pre-registered test).
For each stock and each US close (20:00 UTC in EDT; every date here is EDT) followed by an open:
  P_c   = token at 20:00 UTC on the close day (close of the 19:59 1-minute bar)
  P_pre = token at 13:29 UTC on the next session day (close of the 13:28 bar)   - known before the open
  S_c   = stock close (Yahoo 19:30-20:00 hourly bar close), S_o = stock open (Yahoo 13:30 bar open)
  S_1   = stock at 14:30 (Yahoo 13:30 bar close), P_1 = token at 14:30 (close of the 14:29 bar)
  D = P_pre/P_c - 1 (the token's overnight move), G = S_o/S_c - 1 (the open gap)
  edge = (D - G) * sign(D): what a quote that bought the token's overnight dip / sold its pop earned if the
         token met the open;   tradeable_1h = sign(-D) * (P_1/P_pre - 1): fade the overnight move at 13:29, exit 14:30
Reports per stock and pooled: corr(D,G), slope of G on D, mean edge and mean tradeable_1h for |D| >= k.
"""
import json, os, datetime, statistics, collections
S=(__import__('os').environ.get('FP_ROOT', '.') + '/research_fp2')
BEFORE=os.environ.get('M8_BEFORE','2026-08-10'); FROM=os.environ.get('M8_FROM','0000')
PAIRS=[('NVDA','NVDABUSDT'),('TSLA','TSLABUSDT'),('MSTR','MSTRBUSDT'),('QQQ','QQQBUSDT'),('SPY','SPYBUSDT'),('CRCL','CRCLBUSDT'),
       ('AAPL','AAPLBUSDT'),('GOOGL','GOOGLBUSDT'),('COIN','COINBUSDT'),('META','METABUSDT'),('AMZN','AMZNBUSDT'),('HOOD','HOODBUSDT')]
def lin(x,y):
    mx=statistics.mean(x); my=statistics.mean(y); sxx=sum((a-mx)**2 for a in x)
    return sum((a-mx)*(b-my) for a,b in zip(x,y))/sxx if sxx else float('nan')
def corr(x,y):
    mx=statistics.mean(x); my=statistics.mean(y)
    return sum((a-mx)*(b-my) for a,b in zip(x,y))/((sum((a-mx)**2 for a in x)*sum((b-my)**2 for b in y))**.5)
allrows=[]; res={}
for stk,tok in PAIRS:
    tf=S+'/data/binance_stocks_1m/%s_1m.json'%tok
    yf=S+'/data/ref/yahoo_%s_1h.json'%stk
    if not (os.path.exists(tf) and os.path.exists(yf)): continue
    T={r[0]+60000:r[4] for r in json.load(open(tf))}      # price at the END of each 1-minute bar
    Y=[r for r in json.load(open(yf)) if r[1] is not None]
    byday=collections.defaultdict(dict)
    for r in Y:
        dt=datetime.datetime.utcfromtimestamp(r[0]/1000)
        byday[dt.date()][dt.strftime('%H:%M')]=r
    days=sorted(d for d in byday if '13:30' in byday[d] and '19:30' in byday[d])
    rows=[]
    for a,b in zip(days,days[1:]):
        if not (FROM<=a.isoformat()<BEFORE): continue
        ms=lambda d,hh,mm: int(datetime.datetime(d.year,d.month,d.day,hh,mm,tzinfo=datetime.timezone.utc).timestamp()*1000)
        pc=T.get(ms(a,20,0)); pp=T.get(ms(b,13,29)); p1=T.get(ms(b,14,30))
        if not (pc and pp and p1): continue
        sc=byday[a]['19:30'][4]; so=byday[b]['13:30'][1]; s1=byday[b]['13:30'][4]
        D=(pp/pc-1)*1e4; G=(so/sc-1)*1e4
        sg=1 if D>0 else -1
        rows.append({'stock':stk,'close_day':a.isoformat(),'weekend':(b-a).days>1,'D':D,'G':G,'edge':(D-G)*sg,
                     'trade_1h':-sg*(p1/pp-1)*1e4,'basis_close':(pc/sc-1)*1e4,'basis_1h':(p1/s1-1)*1e4})
    if len(rows)<5: continue
    allrows+=rows
    D=[r['D'] for r in rows]; G=[r['G'] for r in rows]
    res[stk]={'nights':len(rows),'first':rows[0]['close_day'],'last':rows[-1]['close_day'],'corr_D_G':corr(D,G),'slope_G_on_D':lin(D,G),
              'absD_med':statistics.median(abs(x) for x in D),'absG_med':statistics.median(abs(x) for x in G),
              'basis_close_med':statistics.median(r['basis_close'] for r in rows)}
def pooled(rows,tag):
    D=[r['D'] for r in rows]; G=[r['G'] for r in rows]
    o={'nights':len(rows),'corr_D_G':corr(D,G),'slope_G_on_D':lin(D,G),'absD_med':statistics.median(abs(x) for x in D)}
    for k in (10,25,50,100):
        sel=[r for r in rows if abs(r['D'])>=k]
        if sel:
            o['k%d'%k]={'n':len(sel),'edge_mean':statistics.mean(r['edge'] for r in sel),'edge_median':statistics.median(r['edge'] for r in sel),
                        'trade_1h_mean':statistics.mean(r['trade_1h'] for r in sel),'trade_1h_median':statistics.median(r['trade_1h'] for r in sel),
                        'dips_n':sum(1 for r in sel if r['D']<0),'dips_trade_1h_mean':statistics.mean([r['trade_1h'] for r in sel if r['D']<0]) if any(r['D']<0 for r in sel) else None}
    return o
res['_pooled']=pooled(allrows,'all')
res['_pooled_weeknights']=pooled([r for r in allrows if not r['weekend']],'weeknights')
res['_pooled_weekends']=pooled([r for r in allrows if r['weekend']],'weekends') if any(r['weekend'] for r in allrows) else None
res['_window']={'from':FROM,'before':BEFORE}
json.dump({'summary':res,'rows':allrows},open(S+'/results/m8_stock_tokens_overnight%s.json'%os.environ.get('M8_TAG',''),'w'),indent=1)
for k,v in res.items():
    if k.startswith('_') and isinstance(v,dict) and 'nights' in v:
        print(k,{kk:(round(vv,2) if isinstance(vv,float) else ({a:(round(b,2) if isinstance(b,float) else b) for a,b in vv.items()} if isinstance(vv,dict) else vv)) for kk,vv in v.items()})
    elif not k.startswith('_'):
        print('  %-5s nights %3d corr %.2f slope %.2f |D| med %.0f |G| med %.0f basis_close %.1f'%(k,v['nights'],v['corr_D_G'],v['slope_G_on_D'],v['absD_med'],v['absG_med'],v['basis_close_med']))
