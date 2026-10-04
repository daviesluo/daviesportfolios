import json, sys
src, out = sys.argv[1], sys.argv[2]
raw = open(src).read()
try:
    outer = json.loads(raw)
    raw = outer['result'] if isinstance(outer, dict) and 'result' in outer else raw
except Exception:
    pass
start = raw.index('[{')
end = raw.rindex('}]') + 2
rows = json.loads(raw[start:end])
json.dump(rows[0], open(out, 'w'))
print({k: (len(v) if isinstance(v, (list, str)) else v) for k, v in rows[0].items()} if isinstance(rows[0], dict) else type(rows[0]))
