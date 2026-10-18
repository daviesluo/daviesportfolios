# Writes MANIFEST.json: what this folder is, how to run the reading, and every file's sha256 (frozen with the
# pre-registration docs/agents/reviews/2026-10-18-revx-weekend-prereg.md).   python3 -I scripts/manifest.py
import os, json, hashlib
HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
files = []
for root, _, names in os.walk(HERE):
    for n in sorted(names):
        p = os.path.join(root, n); rel = os.path.relpath(p, HERE)
        if rel == 'MANIFEST.json' or '__pycache__' in rel: continue
        b = open(p, 'rb').read(); files.append({'path': rel, 'bytes': len(b), 'sha256': hashlib.sha256(b).hexdigest()})
files.sort(key=lambda f: f['path'])
json.dump({
 'study': '"Stablecoin quotes variant-3" (take50wk, 0130): variant-2 with PR5-W\'s weekend rule, against variant-2 by weekend; the reading\'s export and script, frozen with docs/agents/reviews/2026-10-18-revx-weekend-prereg.md.',
 'run': [
  'on or after 2026-11-25 00:30 UTC, after PR5-W\'s reading: sql/export.sql, SELECT only; statement 1 cut by ../scq_review/scripts/grab.py into data/, statements 2 and 3 saved as data/meta.json and data/closures.json',
  'npx --yes deno@1.46.3 run --allow-read --allow-write --allow-env --no-check scripts/read.ts data results/reading.json',
 ],
 'dryRun': 'scripts/read.ts --dry ../scq_review/2026-10-18/data results/dry_run.json: p50 against take50 over the weekend of 2026-10-09, only to show the script runs (both dark at weekends: every figure 0)',
 'files': files,
}, open(os.path.join(HERE, 'MANIFEST.json'), 'w'), indent=1, ensure_ascii=False)
print(len(files), 'files')
