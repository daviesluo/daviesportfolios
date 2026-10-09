# Cut the payload rows out of a saved Supabase-connector reply and write one JSON file per payload.
# python3 -I scripts/grab.py <saved reply> <out dir> [key]   (key: the payload field naming the file, default 'table')
import json, sys, os
src, out = sys.argv[1], sys.argv[2]
key = sys.argv[3] if len(sys.argv) > 3 else 'table'
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
    path = os.path.join(out, f"{p[key]}.json")
    json.dump(p, open(path, 'w'))
    print(path, {k: (len(v) if isinstance(v, list) else v) for k, v in p.items()})
