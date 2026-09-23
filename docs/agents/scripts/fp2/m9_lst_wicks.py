"""M9: liquid-staking tokens on Binance (WBETH vs ETH, BNSOL vs SOL), 1-minute, 2024-10 -> 2026-09 (descriptive).
fair ratio(t) = median of close(LST)/close(base) over the previous 1,440 minutes; a 'wick' = a minute whose LST
LOW (a trade; Binance klines are trade-built) sits >= k below fair_ratio * the BASE's LOW of the same minute (LST-only).
Events merged within 60 minutes. For each event: the $ traded in the LST in that minute, and where the LST is
60 minutes later relative to fair (the rebound a resting bid at fair*(1-k) would sell into)."""
import json, statistics, collections, datetime, bisect
S=(__import__('os').environ.get('FP_ROOT', '.') + '/research_fp2')
out={}
for lst,base in (('WBETHUSDT','ETHUSDT'),('BNSOLUSDT','SOLUSDT')):
    L={r[0]:r for r in json.load(open(S+'/data/binance_lst/%s_1m.json'%lst))}
    B={r[0]:r for r in json.load(open(S+'/data/binance_lst/%s_1m.json'%base))}
    ts=sorted(t for t in L if t in B)
    win=collections.deque(); srt=[]
    ev={k:[] for k in (0.005,0.01,0.02,0.05)}
    last={k:-10**15 for k in ev}
    for i,t in enumerate(ts):
        r=L[t][4]/B[t][4]
        if len(srt)>=720:
            fair=srt[len(srt)//2]
            for k in ev:
                if L[t][3] <= fair*B[t][3]*(1-k) and t-last[k]>3600000:   # LST low under fair x BASE LOW: an LST-only wick
                    last[k]=t
                    j=bisect.bisect_left(ts,t+3600000)
                    after=(L[ts[j]][4]/(fair*B[ts[j]][4])-1)*1e4 if j<len(ts) else None
                    ev[k].append({'t':datetime.datetime.utcfromtimestamp(t/1000).isoformat(),'low_vs_fair_bps':(L[t][3]/(fair*B[t][3])-1)*1e4,
                                  'usd_in_minute':L[t][6],'close_vs_fair_60m_bps':after})
        win.append(r); bisect.insort(srt,r)
        if len(win)>1440:
            x=win.popleft(); srt.pop(bisect.bisect_left(srt,x))
    days=(ts[-1]-ts[0])/86400000
    out[lst]={'days':days,'events':{str(k):{'n':len(v),'per_year':len(v)/days*365,'usd_median':statistics.median([e['usd_in_minute'] for e in v]) if v else None,
              'rebound_60m_median_bps':statistics.median([e['close_vs_fair_60m_bps'] for e in v if e['close_vs_fair_60m_bps'] is not None]) if v else None,
              'list':v[:12]} for k,v in ev.items()}}
    print(lst,'days %.0f'%days,{k:(x['n'],round(x['per_year'],1),x['usd_median'] and round(x['usd_median']),x['rebound_60m_median_bps'] and round(x['rebound_60m_median_bps'],1)) for k,x in out[lst]['events'].items()})
    for e in out[lst]['events']['0.02']['list']: print('    2%+ wick',e['t'],round(e['low_vs_fair_bps']),'bps  $',round(e['usd_in_minute']),' 60m later',e['close_vs_fair_60m_bps'] and round(e['close_vs_fair_60m_bps']))
json.dump(out,open(S+'/results/m9_lst_wicks_baselow.json','w'),indent=1)
