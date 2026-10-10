# LP-ALLOC: write the payload of one or more saved connector replies (the queries in ../sql/) to one JSON file, without
# the padding that made the connector save the reply to a file. Nothing in a payload is a URL or a secret.
# python3 -I scripts/grab.py data/<out>.json <saved reply> [<saved reply> ...]
import json, sys
def load(src):
    raw = open(src).read()
    outer = json.loads(raw)
    if isinstance(outer, dict) and 'result' in outer: raw = outer['result']
    s = raw.index('[{'); e = raw.rindex('}]') + 2
    return json.loads(raw[s:e])[0]['payload']
out = {}
for src in sys.argv[2:]: out.update(load(src))
out.pop('pad', None)
json.dump(out, open(sys.argv[1], 'w'), separators=(',', ':'))
print({k: (len(v) if isinstance(v, (list, str)) else v) for k, v in out.items()})
