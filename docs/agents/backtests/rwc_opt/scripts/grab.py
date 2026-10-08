# RWC-OPT: cut a day's islands payload (sql/pull_minutes.sql) out of the Supabase connector's saved reply and check it.
# python3 -I scripts/grab.py <saved reply> data/<run>_min_<day>.json
import json, sys
src, out = sys.argv[1], sys.argv[2]
raw = open(src).read()
try:
    outer = json.loads(raw)
    if isinstance(outer, dict) and 'result' in outer: raw = outer['result']
except Exception:
    pass
start = raw.index('[{'); end = raw.rindex('}]') + 2
p = json.loads(raw[start:end])[0]['payload']
json.dump(p, open(out, 'w'))
n = 0
for line in p['data'].split(';'):
    ci, m0, cnt, t = line.split(',', 3)
    assert len(t.split('|')) == 12, line
    n += int(cnt)
print(out, 'lo', p['lo'], 'rows', p['rows'], 'islands', p['islands'], 'expanded', n, 'conds', len(p['conds']), 'ok' if n == int(p['rows']) else 'MISMATCH')
