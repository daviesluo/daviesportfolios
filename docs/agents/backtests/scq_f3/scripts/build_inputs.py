# F3's replay inputs: the twins' committed inputs to 2026-10-02 21:08 UTC (../twins/inputs/twins_inputs.json.gz, the bytes
# every twin's backfill was built from) joined to the rows production stored after them, read 2026-10-09 (data/raw/,
# sql/pull.sql), into one bundle of the same shape (data/inputs.json.gz) that scripts/replay.ts loads as backfill.ts loads
# its own. Where the two overlap a row must be equal or the build stops.
#
# The minutes PR5's call ran (`edge_call_beats`, which the catch-up turns on): the committed beats to 2026-10-02 21:08;
# production keeps beats two days only, so from there to its first kept beat (2026-10-07 10:36) a minute ran when PR5's
# engine recorded a minute in it (`agent_quote_minutes.recorded_at`; on the two days both exist this matches 3,041 of
# 3,059 beats, the rest a late call recorded in the next minute); from 10-07 10:36 the beats themselves.
# Each twin's own missed turns: production's dead-man cancels (`<twin>_sim.state.venue.deadmen`, at its last turn + 3
# minutes) and its next turn (its first order after the cancel) bound a gap in which the twin did not turn.
#
# python3 -I scripts/build_inputs.py   (from docs/agents/backtests/scq_f3)
import gzip, json, os, sys
here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
P = lambda *a: os.path.join(here, *a)
bundle = json.load(gzip.open(P('..', 'twins', 'inputs', 'twins_inputs.json.gz')))
B = bundle['files']
raw = lambda f: [l for l in gzip.open(P('data', 'raw', f + '.gz'), 'rt').read().split('\n') if l]
M = 60000
CUT = 1790975280000                     # 2026-10-02T21:08:00Z, the committed inputs' cut
UNTIL = 1791561600000                   # 2026-10-09T16:00:00Z, the replay's end (the delta was read to it)

def merge(name, old, new, key, norm=lambda f: f):
    rows, clash = {}, 0
    for l in old: rows[key(l)] = l
    for l in new:
        k = key(l)
        if k in rows and norm(rows[k]) != norm(l): clash += 1; print(f'{name}: {k} differs: {rows[k][:160]!r} vs {l[:160]!r}', file=sys.stderr)
        rows.setdefault(k, l)
    if clash: raise SystemExit(f'{name}: {clash} overlapping rows differ')
    return rows

lines = lambda f: [l for l in B[f].split('\n') if l]
num = lambda s: '' if s == '' else repr(float(s))
# prints: id|book|ms|price|qty|side
pr = merge('prints', lines('prints.txt'), raw('prints.txt'), lambda l: l.split('|')[0], lambda l: [num(x) if i in (3, 4) else x for i, x in enumerate(l.split('|'))])
prints = sorted(pr.values(), key=lambda l: (l.split('|')[1], int(l.split('|')[2]), l.split('|')[0]))
# inputs: kind|ms|value
inp = merge('inputs', lines('inputs.txt'), raw('inputs.txt'), lambda l: tuple(l.split('|')[:2]), lambda l: [l.split('|')[0], l.split('|')[1], num(l.split('|')[2])])
inputs = sorted(inp.values(), key=lambda l: (l.split('|')[0], int(l.split('|')[1])))
# minutes: book|ms|x|x_t|fair_u|hours_n|prints_n, and book|ms|recorded_at
rec_old = {tuple(l.split('|')[:2]): l.split('|')[2] for l in lines('minutes_rec.txt')}
mn_new, rec_new = [], {}
for l in raw('minutes.txt'):
    f = l.split('|'); mn_new.append('|'.join(f[:7])); rec_new[(f[0], f[1])] = f[7]
mn = merge('minutes', lines('minutes.txt'), mn_new, lambda l: tuple(l.split('|')[:2]), lambda l: [num(x) if i in (2, 4) else x for i, x in enumerate(l.split('|'))])
for k, v in rec_new.items():
    if k in rec_old and rec_old[k] != v: raise SystemExit(f'minutes_rec {k}: {rec_old[k]} vs {v}')
rec = {**rec_new, **rec_old}
minutes = sorted(mn.values(), key=lambda l: (l.split('|')[0], int(l.split('|')[1])))
minutes_rec = [f'{b}|{ms}|{rec[(b, ms)]}' for b, ms in sorted(rec, key=lambda k: (k[0], int(k[1]))) if rec[(b, ms)]]
# PR5's events: book\tms\tside\tk\tkind\tticks\tdetail
ek = lambda l: (lambda f: (f[0], f[1], f[2], repr(float(f[3])), f[4]))(l.split('\t'))
en = lambda l: (lambda f: [f[0], f[1], f[2], repr(float(f[3])), f[4], f[5], json.loads(f[6])])(l.split('\t'))
ev = merge('events', lines('pr5_events.tsv'), raw('events.txt'), ek, en)
events = sorted(ev.values(), key=lambda l: (l.split('\t')[0], int(l.split('\t')[1]), l.split('\t')[2], float(l.split('\t')[3]), l.split('\t')[4]))
# PR5's call minutes
beats_old = json.loads(B['quotes_beats.json'])
kept = sorted(int(l.split('|')[1]) for l in raw('beats.txt') if l.startswith('agents?action=quotes|'))
first_kept = kept[0]
derived = sorted({int(v) // M * M for v in rec.values() if v and CUT <= int(v) // M * M < first_kept})
beats = sorted(set(m for m in beats_old if m < CUT) | set(derived) | set(m for m in kept if m < UNTIL))
# each twin's gaps from production's dead-man cancels
sims = {json.loads(l)[0]: json.loads(l)[1] for l in raw('twin_sims.txt')}
gaps = {}
for t in ('pr5', 'p50'):
    ts = sorted(json.loads(l)[1] for l in raw(f'orders_{t}.txt'))
    g = []
    for dm in sims[t]['deadmen']:
        a = dm['at']
        if a < CUT: continue                       # inside the committed backfill: its record is the code's own
        nxt = next((x for x in ts if x > a), None)
        g.append([a - 180000, nxt])
    gaps[t] = g
out = {'v': 1, 'built': 'scripts/build_inputs.py', 'cut': '2026-10-09T16:00:00Z', 'files': {
    'prints.txt': '\n'.join(prints) + '\n', 'inputs.txt': '\n'.join(inputs) + '\n', 'minutes.txt': '\n'.join(minutes) + '\n',
    'minutes_rec.txt': '\n'.join(minutes_rec) + '\n', 'pr5_events.tsv': '\n'.join(events) + '\n', 'quotes_beats.json': json.dumps(beats)}, 'gaps': gaps}
with gzip.GzipFile(P('data', 'inputs.json.gz'), 'wb', mtime=0) as f: f.write(json.dumps(out, sort_keys=True).encode())
print({'prints': len(prints), 'inputs': len(inputs), 'minutes': len(minutes), 'minutes_rec': len(minutes_rec), 'events': len(events), 'beats': len(beats),
       'derived_beats': len(derived), 'kept_beats': len([m for m in kept if m < UNTIL]), 'gaps': {t: len(g) for t, g in gaps.items()}})
