# LP-ALLOC: write MANIFEST.json (every committed file's sha256, the inputs, how to run it). python3 -I scripts/manifest.py
import hashlib, json, os
files = []
for d in ['data', 'scripts', 'sql', 'results']:
    for root, _, fs in os.walk(d):
        for f in fs:
            if f.endswith('.pyc') or '__pycache__' in root: continue
            files.append(os.path.join(root, f))
files.append('.gitignore')
sha = {f: hashlib.sha256(open(f, 'rb').read()).hexdigest() for f in sorted(files) if os.path.exists(f)}
m = json.load(open('MANIFEST.json')) if os.path.exists('MANIFEST.json') else {}
m['sha256'] = sha
json.dump(m, open('MANIFEST.json', 'w'), indent=1, ensure_ascii=False)
print(len(sha), 'files')
