"""Pull Binance announcement titles + release times (public bapi, no key).
usage: pull_announcements.py CATALOG_ID OUTNAME
Writes data/announcements_<OUTNAME>.json : [{id, code, title, releaseDate}]"""
import sys, json, os, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import netlib
cat = int(sys.argv[1]); name = sys.argv[2]
out = []; seen = set(); page = 1
while True:
    url = f"https://www.binance.com/bapi/composite/v1/public/cms/article/list/query?type=1&catalogId={cat}&pageNo={page}&pageSize=50"
    code, d = netlib.get_json(url, gap=1.0)
    if code != 200 or not d or not d.get('data'):
        print('stop', code, page); break
    arts = []
    for c in d['data']['catalogs']:
        if c.get('catalogId') == cat:
            arts = c.get('articles', []); total = c.get('total')
    if not arts:
        break
    for a in arts:
        k = a.get('code') or a.get('id')
        if k in seen: continue
        seen.add(k)
        out.append({'id': a.get('id'), 'code': a.get('code'), 'title': a.get('title'), 'releaseDate': a.get('releaseDate')})
    print(page, len(out), total, flush=True)
    if len(out) >= total: break
    page += 1
json.dump(out, open(os.path.join(netlib.S, 'data', f'announcements_{name}.json'), 'w'), indent=0)
print('done', len(out))
