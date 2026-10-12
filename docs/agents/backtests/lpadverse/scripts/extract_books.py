# LP-ADVERSE: pull the target markets' minute books and every print out of the pm-rec archive objects (downloaded by
# fetch.py into a scratch folder; never committed), into one pickle the analysis reads.
#   python3 -I docs/agents/backtests/lpadverse/scripts/extract_books.py <pmrec dir> <targets.json> <out.pkl>
# A books line is the YES book within 10 c of each side's best (pm_book_rec.ts, PM_REC_FIELDS.books), prices in 1e-4 and
# sizes in hundredths. Kept per market: minute (epoch s), tick, bids [(px, sz)], asks [(px, sz)], size-cutoff touch ab/aa
# and the last trade price. Prints: (id, ts, taker side, outcome index, price, size) for the target markets.
import gzip, json, os, sys, pickle, glob
from multiprocessing import Pool
from datetime import datetime

src, tgt, out = sys.argv[1], sys.argv[2], sys.argv[3]
ids = {r[0] for r in json.load(open(tgt))['ids']}

def ep(iso):
    return int(datetime.fromisoformat(iso.replace('Z', '+00:00')).timestamp())

def one(path):
    books, prints = {}, []
    kind = None; minute = None
    with gzip.open(path, 'rt') as f:
        for line in f:
            if line.startswith('{'):
                h = json.loads(line); kind = h['kind']; minute = ep(h['minute']); continue
            x = json.loads(line)
            if x[0] not in ids: continue
            if kind == 'books':
                i, dt, tick, bp, bs, ap, asz, ab, aa, ltp = x
                books.setdefault(i, []).append((minute, (tick or 0) / 1e4, [(p / 1e4, s / 100) for p, s in zip(bp, bs)],
                                                [(p / 1e4, s / 100) for p, s in zip(ap, asz)],
                                                None if ab is None else ab / 1e4, None if aa is None else aa / 1e4, ltp))
            elif kind == 'prints':
                prints.append(tuple(x))
    return books, prints

files = sorted(glob.glob(os.path.join(src, 'books_*.gz')) + glob.glob(os.path.join(src, 'prints_*.gz')))
B, P = {}, []
with Pool(4) as pool:
    for b, p in pool.imap_unordered(one, files):
        for k, v in b.items(): B.setdefault(k, []).extend(v)
        P.extend(p)
for k in B: B[k].sort(key=lambda r: r[0])
P = sorted(set(P), key=lambda r: (r[1], r[0]))
pickle.dump({'books': B, 'prints': P}, open(out, 'wb'), protocol=5)
print(len(files), 'files;', len(B), 'markets with books;', sum(len(v) for v in B.values()), 'book-minutes;', len(P), 'prints')
