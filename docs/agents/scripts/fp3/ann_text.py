"""Fetch one Binance announcement's text (public bapi) and print the sentences with given keywords.
usage: ann_text.py CODE OUTNAME kw1 kw2 ..."""
import sys, os, json, re
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import netlib
code, name = sys.argv[1], sys.argv[2]
c, d = netlib.get_json(f"https://www.binance.com/bapi/composite/v1/public/cms/article/detail/query?articleCode={code}", gap=1.0)
body = (d or {}).get('data', {}).get('body') or ''
texts = re.findall(r'"text"\s*:\s*"((?:[^"\\]|\\.)*)"', body)
full = ' '.join(texts)
full = full.encode('utf-8', 'ignore').decode('unicode_escape', 'ignore')
open(os.path.join(netlib.S, 'data', f'ann_{name}.txt'), 'w').write(full)
print(d['data']['title'])
for kw in sys.argv[3:]:
    for m in re.finditer(kw, full, re.I):
        print('--', kw, ':', re.sub(r'\s+', ' ', full[max(0, m.start()-250):m.end()+350]))
