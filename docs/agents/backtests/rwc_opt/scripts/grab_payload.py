# RWC-OPT: write the payload of one or more saved connector replies (sql/pull_record.sql) to one JSON file.
# python3 -I scripts/grab_payload.py data/<run>_record.json <saved reply> [<saved reply> ...]
import json, sys
def load(src):
    raw = open(src).read()
    outer = json.loads(raw)
    if isinstance(outer, dict) and 'result' in outer: raw = outer['result']
    s = raw.index('[{'); e = raw.rindex('}]') + 2
    return json.loads(raw[s:e])[0]['payload']
out = {}
for src in sys.argv[2:]: out.update(load(src))
json.dump(out, open(sys.argv[1], 'w'))
print({k: (len(v) if isinstance(v, list) else v) for k, v in out.items()})
