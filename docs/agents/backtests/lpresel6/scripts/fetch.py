# LPSELF: python3 -I scripts/fetch.py <saved reply of sql/archive_urls.sql> data/pmrec  (verifies each object by its sha256)
# Download every pm-rec archive object named in the saved query reply; the signed URLs are never printed.
import json, sys, os, hashlib, subprocess, concurrent.futures as cf
src, out = sys.argv[1], sys.argv[2]
raw = json.loads(open(src).read())['result']
s = raw.index('[{'); e = raw.rindex('}]') + 2
objs = json.loads(raw[s:e])[0]['payload']['objects']
json.dump([{k: v for k, v in o.items() if k != 'url'} for o in objs], open(os.path.join(out, 'index.json'), 'w'))
def get(o):
    name = f"{o['kind']}_{o['hour'][:13].replace(':','').replace(' ','T')}.gz"
    path = os.path.join(out, name)
    if os.path.exists(path) and os.path.getsize(path) == o['bytes']: return name, 'cached'
    r = subprocess.run(['curl', '-sS', '--fail', '-o', path, o['url']], capture_output=True)
    if r.returncode: return name, 'FAIL ' + r.stderr.decode()[:80].replace(o['url'], '<url>')
    h = hashlib.sha256(open(path, 'rb').read()).hexdigest()
    return name, ('ok' if os.path.getsize(path) == o['bytes'] else f"size {os.path.getsize(path)} != {o['bytes']}") + (' sha-ok' if h == o.get('sha256') else ' sha-differs')
with cf.ThreadPoolExecutor(6) as ex:
    res = list(ex.map(get, objs))
bad = [r for r in res if not r[1].startswith(('ok', 'cached'))]
print(len(res), 'objects;', sum(1 for r in res if 'sha-ok' in r[1]), 'sha ok;', len(bad), 'bad', bad[:5])
