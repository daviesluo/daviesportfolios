# Cut the payloads out of a saved Supabase-connector reply: each row `{table, n, md5, text}` becomes data/raw/<table>.txt (gzip -n -9 after),
# checked against the md5 and row count the database computed over the same text.
# python3 -I scripts/grab.py <saved reply> <out dir>
import json, sys, os, hashlib
src, out = sys.argv[1], sys.argv[2]
raw = open(src).read()
try:
    outer = json.loads(raw)
    if isinstance(outer, dict) and 'result' in outer: raw = outer['result']
    elif isinstance(outer, list) and outer and isinstance(outer[0], dict) and 'text' in outer[0]: raw = outer[0]['text']
except Exception:
    pass
s = raw.index('[{'); e = raw.rindex('}]') + 2
rows = json.loads(raw[s:e])
os.makedirs(out, exist_ok=True)
for r in rows:
    p = r['payload']
    if isinstance(p, str): p = json.loads(p)
    text = p['text'] or ''
    md5 = hashlib.md5(text.encode()).hexdigest()
    n = len(text.split('\n')) if text else 0
    ok = md5 == p['md5'] and n == p['n']
    if not ok: raise SystemExit(f"{p['table']}: md5 {md5} vs {p['md5']}, rows {n} vs {p['n']}")
    path = os.path.join(out, f"{p['table']}.txt")
    open(path, 'w').write(text + '\n')
    print(path, n, md5)
