import json, sys
src, out = sys.argv[1], sys.argv[2]
raw = open(src).read()
try:
    o = json.loads(raw); raw = o['result'] if isinstance(o, dict) and 'result' in o else raw
except Exception: pass
s = raw.index('[{'); e = raw.rindex('}]') + 2
p = json.loads(raw[s:e])[0]['payload']
n = 0
for line in p['data'].split(';'):
    ci, m0, cnt, t = line.split(',', 3)
    assert len(t.split('|')) == 17, line
    n += int(cnt)
json.dump(p, open(out, 'w'))
print(out, 'rows', p['rows'], 'expanded', n, 'ok' if n == p['rows'] else 'MISMATCH', 'conds', len(p['conds']), 'prints', len(p['prints'] or []), 'markets', len(p['markets'] or []), 'paper last', p['paper']['last_minute'], 'config', p['config'])
