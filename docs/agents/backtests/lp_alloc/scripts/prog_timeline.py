# LP-ALLOC: the reward programme of given markets through a window, as pm-rec's universe frames read the CLOB's listing
# (each market once every 15 minutes, in the frame whose phase is its pm-rec id modulo 15; absent there = the listing no
# longer shows it, its programme ended). The same reading as scripts/build.ts's `progs`, for markets the record did not keep.
# python3 -I scripts/prog_timeline.py <pmrec dir> <from YYYY-MM-DDTHH> <to YYYY-MM-DDTHH> <cond prefix>... > data/<out>.json
import gzip, json, glob, sys, os
d, t0, t1, prefixes = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4:]
ids = {}
for f in sorted(glob.glob(os.path.join(d, 'markets_*.gz'))):
    for line in gzip.open(f, 'rt'):
        x = json.loads(line)
        if 'cond' in x and any(x['cond'].startswith(p) for p in prefixes): ids[x['id']] = x['cond']
out = {c: [] for c in ids.values()}
for f in sorted(glob.glob(os.path.join(d, 'universe_*.gz'))):
    h = os.path.basename(f)[9:22]
    if not (t0 <= h < t1): continue
    hdr, got = None, {}
    def flush():
        if hdr is None: return
        for i, c in ids.items():
            if i % hdr['phases'] == hdr['phase']:
                r = got.get(i)
                out[c].append([hdr['minute'][:16], r[2], r[3], r[4]] if r else [hdr['minute'][:16], None, None, None])
    for line in gzip.open(f, 'rt'):
        x = json.loads(line)
        if isinstance(x, dict): flush(); hdr, got = x, {}
        elif x[0] in ids: got[x[0]] = x
    flush()
for c in out: out[c].sort()
json.dump({'fields': ['minute', 'rate', 'max_spread', 'min_size'], 'markets': out}, sys.stdout, separators=(',', ':'))
