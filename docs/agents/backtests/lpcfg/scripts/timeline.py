# LPCFG: each 10-09 live-prep market's reward programme through the day, as pm-rec's universe frames read the CLOB's
# reward listing (every market once every 15 minutes: the frame whose phase is its pm-rec id modulo 15).
# python3 -I scripts/timeline.py <dir of universe_*.gz from the pm-rec archive> > data/config_timeline.json
# A market absent from a frame of its phase is one the listing no longer showed (pm-rec delists it): its programme ended.
import gzip, json, glob, sys
IDS = {7110: '0x5fec6675', 17490: '0xeee73848', 22144: '0xfbd3437c', 151227: '0x5b3350e2', 234623: '0xf0503539',
       256189: '0xf6f3f159', 295451: '0x9235351e', 296963: '0xa326c49f', 296969: '0x045fdf4b', 322878: '0xecc209a6'}
out = {c: [] for c in IDS.values()}
for f in sorted(glob.glob(sys.argv[1] + '/universe_*.gz')):
    hdr, got = None, {}
    def flush():
        if hdr is None: return
        for i, c in IDS.items():
            if i % hdr['phases'] == hdr['phase']:
                r = got.get(i)
                out[c].append([hdr['minute'][:16], r[2], r[3], r[4]] if r else [hdr['minute'][:16], None, None, None])
    for line in gzip.open(f, 'rt'):
        x = json.loads(line)
        if isinstance(x, dict):
            flush(); hdr, got = x, {}
        elif x[0] in IDS: got[x[0]] = x
    flush()
for c in out: out[c].sort()
json.dump({"source": "pm-rec universe frames (pm_rec_archive kind 'universe', 2026-10-08 23:00 to 2026-10-10 00:59 UTC), sha256-checked at download",
           "fields": ["minute", "rate", "max_spread", "min_size"], "markets": out}, sys.stdout, separators=(',', ':'))
