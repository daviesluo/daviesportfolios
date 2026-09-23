"""M12: minimum-size 'dust' prints ($ notional < $1) on the pulled UK books: share of prints and of $ volume,
and the days on which dust is more than half the prints (a bot pinging the touch). Descriptive, all days
(counts only - no price or return is read)."""
import json, glob, os, collections
S=(__import__('os').environ.get('FP_ROOT', '.') + '/research_fp2')
out={}
for bd in sorted(glob.glob(S+'/data/revx_prints/*-USD')):
    b=os.path.basename(bd); n=nd=0; usd=usdd=0.0; dusty=[]
    for f in sorted(glob.glob(bd+'/*.json')):
        rows=json.load(open(f))['rows']; k=0
        for r in rows:
            u=float(r['price'])*float(r['quantity']); n+=1; usd+=u
            if u<1: nd+=1; usdd+=u; k+=1
        if rows and k/len(rows)>0.5: dusty.append(os.path.basename(f)[:10])
    out[b]={'prints':n,'dust_share_prints':round(nd/n,3) if n else None,'dust_share_usd':round(usdd/usd,6) if usd else None,'days_dust_majority':dusty}
    print('%-11s prints %6d  dust %.1f%% of prints, %.4f%% of $; days where dust > half: %s'%(b,n,100*nd/n,100*usdd/usd,dusty))
json.dump(out,open(S+'/results/m12_dust_prints.json','w'),indent=1)
