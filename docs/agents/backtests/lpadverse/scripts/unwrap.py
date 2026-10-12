# LP-ADVERSE: turn a saved connector reply of one of sql/*.sql (a padded jsonb `payload`) into the payload's JSON, pad dropped.
#   python3 -I docs/agents/backtests/lpadverse/scripts/unwrap.py <saved reply> <out.json[.gz]>
import json, sys, gzip
raw = open(sys.argv[1]).read()
try:
    raw = json.loads(raw)['result']
except Exception:
    pass
s = raw.index('[{'); e = raw.rindex('}]') + 2
p = json.loads(raw[s:e])[0]['payload']
p.pop('pad', None)
out = sys.argv[2]
op = gzip.open if out.endswith('.gz') else open
with op(out, 'wt') as f:
    json.dump(p, f, separators=(',', ':'))
print(out, {k: (len(v) if isinstance(v, list) else type(v).__name__) for k, v in p.items()})
