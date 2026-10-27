# Cut {table, n, md5, text} payloads out of a saved Supabase-connector reply into <out dir>/<table>.txt, refusing any
# whose md5 (computed by the database over the same text) or line count does not match.
# python3 -I scripts/grab_text.py <saved reply> <out dir>
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
    text = p['text'] or ''
    md5 = hashlib.md5(text.encode()).hexdigest()
    n = len(text.split('\n')) if text else 0
    if md5 != p['md5'] or n != p['n']:
        raise SystemExit(f"{p['table']}: md5 {md5} vs {p['md5']}, lines {n} vs {p['n']}")
    open(os.path.join(out, f"{p['table']}.txt"), 'w').write(text + '\n')
    print(p['table'], p['n'], p['md5'])
