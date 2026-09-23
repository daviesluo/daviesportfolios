"""Write MANIFEST.json: sha256, size and mtime of every file under data/, results/, analysis/, scripts/ and the
pre-registrations, relative to this study folder. Skips the bulk-archive zip caches (their parsed JSON is listed)."""
import hashlib, json, os, datetime
S = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
out = {'generated_at': datetime.datetime.utcnow().isoformat() + 'Z', 'files': {}}
for root in ('data', 'results', 'analysis', 'scripts', 'logs'):
    for dp, dn, fn in os.walk(os.path.join(S, root)):
        dn[:] = [d for d in dn if d not in ('zips', '__pycache__')]
        for f in sorted(fn):
            if f.endswith('.lock'):
                continue
            p = os.path.join(dp, f)
            h = hashlib.sha256()
            with open(p, 'rb') as fh:
                for b in iter(lambda: fh.read(1 << 20), b''):
                    h.update(b)
            out['files'][os.path.relpath(p, S)] = {'sha256': h.hexdigest(), 'bytes': os.path.getsize(p)}
for f in sorted(os.listdir(S)):
    if f.startswith('prereg_') or f.endswith('.md'):
        p = os.path.join(S, f)
        out['files'][f] = {'sha256': hashlib.sha256(open(p, 'rb').read()).hexdigest(), 'bytes': os.path.getsize(p)}
json.dump(out, open(os.path.join(S, 'MANIFEST.json'), 'w'), indent=1, sort_keys=True)
print(len(out['files']), 'files')
