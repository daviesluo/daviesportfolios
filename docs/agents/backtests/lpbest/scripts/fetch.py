# LP-BEST: download pm-rec archive objects listed in a saved connector reply of sql/archive_urls.sql into a scratch
# folder, checking each against pm_rec_archive.sha256. The signed URLs are read from the reply and never printed; the
# reply and the objects stay in the scratch folder and are never committed.
#   python3 -I docs/agents/backtests/lpbest/scripts/fetch.py <saved reply> <out dir>
import json, sys, os, hashlib, urllib.request
from concurrent.futures import ThreadPoolExecutor

raw = open(sys.argv[1]).read()
try:
    raw = json.loads(raw)['result']
except Exception:
    pass
s = raw.index('[{'); e = raw.rindex('}]') + 2
rows = json.loads(raw[s:e])[0]['payload']['rows']
out = sys.argv[2]
os.makedirs(out, exist_ok=True)

def one(r):
    name = f"{r['kind']}_{r['hour'][:13].replace(' ', 'T')}.gz"
    p = os.path.join(out, name)
    if os.path.exists(p) and hashlib.sha256(open(p, 'rb').read()).hexdigest() == r['sha256']:
        return name, 'have'
    for attempt in range(3):
        try:
            data = urllib.request.urlopen(r['url'], timeout=180).read()
            break
        except Exception as ex:  # the message can carry the URL: say only its kind
            err = type(ex).__name__
    else:
        return name, 'FAILED ' + err
    ok = hashlib.sha256(data).hexdigest() == r['sha256']
    open(p, 'wb').write(data)
    return name, ('sha ok' if ok else 'SHA MISMATCH')

with ThreadPoolExecutor(6) as ex:
    res = list(ex.map(one, rows))
bad = [r for r in res if r[1] not in ('sha ok', 'have')]
print(len(res), 'objects;', sum(1 for r in res if r[1] == 'sha ok'), 'downloaded;', sum(1 for r in res if r[1] == 'have'), 'already held;', len(bad), 'bad', bad[:5])
