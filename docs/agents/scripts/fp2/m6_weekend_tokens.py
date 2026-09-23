"""M6: do 24/7 tokens of 5-day assets (PAXG, XAUT vs gold futures; Binance EURUSDT vs EUR/USD) drift on the
weekend by noise that the reopen corrects? For each weekend with both series:
  t_c = end of the underlying's last Friday hourly bar (its close), t_o = start of its first bar after that (the reopen).
  D  = token(t_o) / token(t_c) - 1          (the token's weekend move, known before the reopen)
  G  = underlying open(t_o) / close(t_c) - 1 (the reopen gap)
  A_h = token(t_o + h) / token(t_o) - [underlying(t_o + h) / open(t_o)]  (token catch-up after the reopen, h = 1, 4 h)
Token price at time t = close of the token's hourly bar that ends at t.
Reports corr(D, G), the slope of G on D, the share of D the reopen reverses (slope of A_4 on D - G), and
the average of -D over weekends with |D| >= k (what a weekend liquidity provider could hope to harvest before costs).
Inputs: data/binance_1h/{PAXGUSDT,XAUTUSDT,EURUSDT}_1h.json, data/ref/yahoo_{GC_F,EURUSD_X}_1h.json.
"""
import json, datetime, statistics, bisect, os
S=(__import__('os').environ.get('FP_ROOT', '.') + '/research_fp2')
def lin(xs,ys):
    mx=statistics.mean(xs); my=statistics.mean(ys)
    sxx=sum((x-mx)**2 for x in xs); sxy=sum((x-mx)*(y-my) for x,y in zip(xs,ys))
    return sxy/sxx if sxx else float('nan')
def corr(xs,ys):
    mx=statistics.mean(xs); my=statistics.mean(ys)
    sx=sum((x-mx)**2 for x in xs)**.5; sy=sum((y-my)**2 for y in ys)**.5
    return sum((x-mx)*(y-my) for x,y in zip(xs,ys))/(sx*sy)
res={}
for tok,und in [('PAXGUSDT','GC_F'),('XAUTUSDT','GC_F'),('EURUSDT','EURUSD_X')]:
    tf=S+'/data/binance_1h/%s_1h.json'%tok
    if not os.path.exists(tf): continue
    T={r[0]+3600000:r[4] for r in json.load(open(tf))}   # price at the END of each token bar
    U=[r for r in json.load(open(S+'/data/ref/yahoo_%s_1h.json'%und)) if r[1] is not None]
    ut=[r[0] for r in U]
    rows=[]
    for i in range(1,len(U)):
        gap=(U[i][0]-U[i-1][0])/3.6e6
        if gap<36: continue                     # the weekend break (>= 36 h between bar starts)
        tc=U[i-1][0]+3600000; to=U[i][0]
        if tc not in T or to not in T: continue
        D=T[to]/T[tc]-1; G=U[i][1]/U[i-1][4]-1
        A={}
        for h in (1,4):
            j=bisect.bisect_left(ut,to+h*3600000)
            if j<len(U) and U[j][0]==to+h*3600000 and (to+h*3600000) in T:
                A[h]=(T[to+h*3600000]/T[to]-1)-(U[j][1]/U[i][1]-1)
        def ratio_med(a,b):
            v=[]
            for k in range(bisect.bisect_left(ut,a),bisect.bisect_left(ut,b)):
                t_end=U[k][0]+3600000
                if t_end in T and U[k][4]: v.append(T[t_end]/U[k][4])
            return statistics.median(v) if len(v)>=5 else None
        rb=ratio_med(tc-24*3600000,tc); ra=ratio_med(to+4*3600000,to+28*3600000)
        roll=None if (rb is None or ra is None) else abs(ra/rb-1)*1e4
        rows.append({'roll_shift_bps':roll,'reopen':datetime.datetime.utcfromtimestamp(to/1000).isoformat(),'D_bps':D*1e4,'G_bps':G*1e4,'A1_bps':A.get(1,0)*1e4 if 1 in A else None,'A4_bps':A.get(4,0)*1e4 if 4 in A else None})
    CUT=os.environ.get('M6_BEFORE')            # optional: only weekends before this ISO date
    FROM=os.environ.get('M6_FROM')
    if CUT: rows=[r for r in rows if r['reopen']<CUT]
    if FROM: rows=[r for r in rows if r['reopen']>=FROM]
    nroll=sum(1 for r in rows if r['roll_shift_bps'] is None or r['roll_shift_bps']>25)
    rows=[r for r in rows if r['roll_shift_bps'] is not None and r['roll_shift_bps']<=25]   # drop roll weekends
    if len(rows)<10: continue
    D=[r['D_bps'] for r in rows]; G=[r['G_bps'] for r in rows]
    r4=[r for r in rows if r['A4_bps'] is not None]
    o={'weekends':len(rows),'dropped_roll_or_unmeasured':nroll,'first':rows[0]['reopen'],'last':rows[-1]['reopen'],
       'D_abs_median':statistics.median(abs(x) for x in D),'G_abs_median':statistics.median(abs(x) for x in G),
       'D_minus_G_abs_median':statistics.median(abs(a-b) for a,b in zip(D,G)),
       'corr_D_G':corr(D,G),'slope_G_on_D':lin(D,G),
       'slope_A4_on_DminusG':lin([r['D_bps']-r['G_bps'] for r in r4],[r['A4_bps'] for r in r4]) if len(r4)>5 else None,
       'mean_A4_bps':statistics.mean(r['A4_bps'] for r in r4) if r4 else None}
    for k in (10,20,30,50):
        sel=[r for r in rows if abs(r['D_bps']-0)>=k]
        # a weekend liquidity provider buys a dip / sells a pop at t_o and is made whole by the reopen:
        # its gross edge per weekend = (D - G) * sign(D)  (the part of the weekend move the gap did not justify; dip: G - D)
        o['k%d'%k]={'n':len(sel),'mean_edge_bps':statistics.mean((r['D_bps']-r['G_bps'])*(1 if r['D_bps']>0 else -1) for r in sel) if sel else None,
                    'median_edge_bps':statistics.median((r['D_bps']-r['G_bps'])*(1 if r['D_bps']>0 else -1) for r in sel) if sel else None,
                    'n_dips':sum(1 for r in sel if r['D_bps']<0),
                    'mean_edge_dips_only_bps':statistics.mean((r['G_bps']-r['D_bps']) for r in sel if r['D_bps']<0) if any(r['D_bps']<0 for r in sel) else None}
    o['rows']=rows
    res[tok]=o
    print(tok,'vs',und,{k:(round(v,2) if isinstance(v,float) else v) for k,v in o.items() if k!='rows'})
json.dump(res,open(S+'/results/m6_weekend_tokens%s.json'%os.environ.get('M6_TAG',''),'w'),indent=1)
