"""M10 (IN-SAMPLE ONLY, descriptive): markouts of T1's and T2's own in-sample bid fills, entries of $10 or more
(the long-tail books carry a $0.10 dust bot whose fills would dominate an unweighted count). For each primary-rule entry,
the Binance fair 5 / 30 / 60 / 240 minutes after the fill relative to the fill price (bps; + = the price rose,
good for the long). Separates 'the stop turns noise into taker exits' from 'the fills are adversely selected'."""
import json, statistics, sys, datetime
sys.argv=[sys.argv[0],'--is-only']
import importlib.util
spec=importlib.util.spec_from_file_location('t12',(__import__('os').environ.get('FP_ROOT', '.') + '/research_fp2/analysis/t12_revx_uk_quotes.py'))
t12=importlib.util.module_from_spec(spec); spec.loader.exec_module(t12)
t12.USDC=t12.load_kl(t12.R+'/data/binance_year/USDCUSDT_1m.json')
out={}
for test,books in (('T1',t12.T1_BOOKS),('T2',t12.T2_BOOKS)):
    allm={h:[] for h in (5,30,60,240)}
    for book in books:
        F=t12.fair_map(book.split('-')[0]); days=[x for x in t12.book_days(book) if x[0]<t12.CUT]
        h,nh=t12.h_book_from(days,F)
        if h is None: continue
        prm=({'d_bps':0.5*h,'w_bps':0.3*h,'tstop_min':120,'stop_bps':1.5*h,'lat_s':30,'extra_bps':0,'taker':t12.TAKER,'h_bps':h} if test=='T1' else
             {'d_bps':50.0,'w_bps':20.0,'tstop_min':60,'stop_bps':150.0,'lat_s':30,'extra_bps':0,'taker':t12.TAKER,'h_bps':h})
        tr,_,_=t12.run_book(days,F,prm)
        # one entry per position; its notional = the sum of its exit quantities x entry price
        ent={}
        for x in tr:
            key=(x['day'],x['entry_t'])
            e=ent.setdefault(key,{'entry':x['entry'],'usd':0.0,'t':x['entry_t']})
            e['usd']+=x['qty']*x['entry']
        seen=set(); mk={hh:[] for hh in allm}
        for key,e in ent.items():
            if e['usd']<10.0: continue          # real entries only: the long-tail books carry a $0.10 dust bot
            seen.add(key)
            m=e['t']//60000*60000
            for hh in allm:
                f=F.get(m+(hh-1)*60000)
                if f:
                    v=(f/e['entry']-1)*1e4
                    mk[hh].append((v,e['usd'])); allm[hh].append((v,e['usd']))
        out['%s %s'%(test,book)]={'h':round(h,1),'entries_ge_10usd':len(seen),**{'mk%d_mean'%hh:round(statistics.mean(a for a,_ in v),1) for hh,v in mk.items() if v},**{'mk%d_usd_wtd'%hh:round(sum(a*w for a,w in v)/sum(w for _,w in v),1) for hh,v in mk.items() if v},**{'mk%d_median'%hh:round(statistics.median(a for a,_ in v),1) for hh,v in mk.items() if v}}
        print(test,book,out['%s %s'%(test,book)])
    out[test+' all']={'entries_ge_10usd':len(allm[5]),**{'mk%d_mean'%hh:round(statistics.mean(a for a,_ in v),1) for hh,v in allm.items() if v},**{'mk%d_usd_wtd'%hh:round(sum(a*w for a,w in v)/sum(w for _,w in v),1) for hh,v in allm.items() if v},**{'mk%d_median'%hh:round(statistics.median(a for a,_ in v),1) for hh,v in allm.items() if v}}
    print(test,'ALL',out[test+' all'])
json.dump(out,open((__import__('os').environ.get('FP_ROOT', '.') + '/research_fp2/results/m10_t12_is_fill_markouts.json'),'w'),indent=1)
