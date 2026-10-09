# Revolut X's public trade tape (keyless: GET /api/1.0/public/trades/all, a day's window a request, following the cursor),
# every UK print of USDC-GBP and USDT-GBP from 2026-09-23 00:00 to 2026-10-09 16:00 UTC, as PR5's engine reads it
# (`fetchPrints`, quotes.ts), written to data/tape.txt.gz (id|book|ms|price|qty|side) and compared with the prints the database
# stored (data/inputs.json.gz): the replay fills only from stored prints, so a print the tape has and the store lacks is
# one the twins never saw. A public read only; no key, nothing sent but GETs.
# SSL_CERT_FILE=<the proxy's CA bundle, when there is one> python3 -I scripts/fetch_tape.py
import json, os, urllib.request, time, gzip
here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FROM, TO, DAY = 1790121600000, 1791561600000, 86400000
rows = {}
for book in ('USDC-GBP', 'USDT-GBP'):
    a = FROM
    while a < TO:
        b = min(TO - 1, a + DAY - 1); cursor = ''
        for page in range(200):
            url = f'https://revx.revolut.com/api/1.0/public/trades/all?symbol={book}&start_date={a}&end_date={b}&limit=100' + (f'&cursor={urllib.parse.quote(cursor)}' if cursor else '')
            for attempt in range(5):
                try:
                    j = json.load(urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'scq_f3'}), timeout=30)); break
                except Exception as e:
                    time.sleep(2 + attempt * 3)
            else: raise SystemExit(f'{url}: failed')
            for r in j.get('data') or []:
                if r['region'] != 'UK': continue
                rows[r['id']] = f"{r['id']}|{book}|{r['timestamp']}|{float(r['price'])!r}|{float(r['quantity'])!r}|{'buy' if r['side'] == 'buy' else 'sell'}"
            cursor = (j.get('metadata') or {}).get('next_cursor') or ''
            time.sleep(0.15)
            if not cursor: break
        a += DAY
tape = sorted(rows.values(), key=lambda l: (l.split('|')[1], int(l.split('|')[2]), l.split('|')[0]))
with gzip.GzipFile(os.path.join(here, 'data', 'tape.txt.gz'), 'wb', mtime=0) as f: f.write(('\n'.join(tape) + '\n').encode())
stored = {l.split('|')[0]: l for l in json.load(gzip.open(os.path.join(here, 'data', 'inputs.json.gz')))['files']['prints.txt'].split('\n') if l}
START = 1790175600000  # 2026-09-23 15:00, an hour before the twins' first minute
t_in = {i: l for i, l in rows.items() if int(l.split('|')[2]) >= START}
s_in = {i: l for i, l in stored.items() if int(l.split('|')[2]) >= START}
norm = lambda l: (lambda f: (f[1], int(f[2]), round(float(f[3]), 4), round(float(f[4]), 8), f[5]))(l.split('|'))
miss = sorted(set(t_in) - set(s_in), key=lambda i: int(t_in[i].split('|')[2]))
extra = sorted(set(s_in) - set(t_in))
differ = [i for i in set(t_in) & set(s_in) if norm(t_in[i]) != norm(s_in[i])]
res = {'tape': len(t_in), 'stored': len(s_in), 'tape_not_stored': len(miss), 'stored_not_tape': len(extra), 'differ': len(differ),
       'tape_not_stored_rows': [t_in[i] for i in miss][:200], 'stored_not_tape_rows': [s_in[i] for i in extra][:50], 'differ_rows': [[t_in[i], s_in[i]] for i in differ][:50]}
json.dump(res, open(os.path.join(here, 'results', 'tape_check.json'), 'w'), indent=1)
print({k: v for k, v in res.items() if not k.endswith('_rows')})
