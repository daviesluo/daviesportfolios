# LP-ALLOC: write the record's programme timelines (`progs`, one per kept market) to their own small file, so a run
# need not parse the large record twice. python3 -I scripts/split_progs.py <pr_record.json> data/progs.json
import json, sys
o = json.load(open(sys.argv[1]))
json.dump({'conds': o['conds'], 'progs': o['progs'], 'nmax': o.get('nmax'), 'oursRemoved': o.get('oursRemoved'), 'coverage': o.get('coverage'), 'last': o['last']}, open(sys.argv[2], 'w'), separators=(',', ':'))
print(len(o['conds']), 'markets;', sum(len(p) for p in o['progs']), 'programme entries; coverage', o.get('coverage'), '; our shares taken out of the books', o.get('oursRemoved'))
