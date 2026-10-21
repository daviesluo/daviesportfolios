# The replay's inputs (data/inputs.json.gz), in the bundle shape the twins' backfill and ../scq_f3/scripts/replay.ts load:
# PR5's stored prints, inputs, events and go-live books from ../pr5_review/data (pulled 2026-10-21 19:05 UTC), its minute
# records with every column from data/minutes_full.txt (sql/pull.sql), and the minutes PR5's call ran. Production keeps
# `edge_call_beats` two or three days only, so a minute ran when PR5's engine recorded a minute in it
# (`agent_quote_minutes.recorded_at`, as ../scq_f3/scripts/build_inputs.py derived the beats it lacked; on the days both
# exist that matched 3,041 of 3,059 beats).
# python3 -I scripts/build_inputs.py   (from docs/agents/backtests/livesim)
import gzip, json, os
here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
P = lambda *a: os.path.join(here, *a)
M = 60000


def lines(path):
    f = gzip.open(path + '.gz', 'rt') if not os.path.exists(path) else open(path)
    return [l.rstrip('\n') for l in f if l.strip()]


pr5 = lambda f: lines(P('..', 'pr5_review', 'data', f))
prints = sorted(pr5('prints.txt'), key=lambda l: (l.split('|')[1], int(l.split('|')[2]), l.split('|')[0]))
inputs = sorted(pr5('inputs.txt'), key=lambda l: (l.split('|')[0], int(l.split('|')[1])))
minutes, rec = [], []
for l in lines(P('data', 'minutes_full.txt')):   # data/minutes_full.txt.gz
    f = l.split('|')
    minutes.append('|'.join(f[:7]))
    if f[7]: rec.append(f'{f[0]}|{f[1]}|{f[7]}')
events = []
for l in pr5('events.txt'):
    b, t, sd, k, kind, tk, d = l.split('|', 6)
    events.append('\t'.join([b, t, sd, repr(float(k)), kind, tk, d]))
for l in pr5('books.txt'):
    b, t, d = l.split('|', 2)
    events.append('\t'.join([b, t, '-', repr(0.0), 'book', '', d]))
events.sort(key=lambda l: (l.split('\t')[0], int(l.split('\t')[1]), l.split('\t')[2], float(l.split('\t')[3]), l.split('\t')[4]))
beats = sorted({int(l.split('|')[2]) // M * M for l in rec})
out = {'v': 1, 'built': 'scripts/build_inputs.py', 'cut': '2026-10-21T15:09:00Z', 'files': {
    'prints.txt': '\n'.join(prints) + '\n', 'inputs.txt': '\n'.join(inputs) + '\n', 'minutes.txt': '\n'.join(minutes) + '\n',
    'minutes_rec.txt': '\n'.join(rec) + '\n', 'pr5_events.tsv': '\n'.join(events) + '\n', 'quotes_beats.json': json.dumps(beats)}, 'gaps': {}}
with gzip.GzipFile(P('data', 'inputs.json.gz'), 'wb', mtime=0) as f: f.write(json.dumps(out, sort_keys=True).encode())
print({'prints': len(prints), 'inputs': len(inputs), 'minutes': len(minutes), 'minutes_rec': len(rec), 'events': len(events), 'beats': len(beats)})
