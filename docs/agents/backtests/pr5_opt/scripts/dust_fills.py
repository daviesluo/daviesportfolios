# PR5-OPT: how often LIVE's rungs were made "held" by a fill too small to matter (the £0.10 prints a bot has sent on USDT-GBP
# since 2026-10-08, about 450 a day), and what those holdings cost in rung time. From LIVE's filled orders as the 2026-10-26
# review committed them (../scq_review/2026-10-26/data/live_orders.json.gz, to 2026-10-26 00:58 UTC), and the stored prints.
# Counts and minutes only (public repository: no pounds of LIVE). Writes results/dust_fills.json.
import os, sys, json, gzip, collections, datetime
HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
iso2ms = lambda s: int(datetime.datetime.fromisoformat(s.replace('Z', '+00:00')).timestamp() * 1000)
day = lambda ms: datetime.datetime.fromtimestamp(ms / 1000, datetime.timezone.utc).strftime('%m-%d')
orders = json.loads(gzip.open(os.path.join(HERE, '..', 'scq_review', '2026-10-26', 'data', 'live_orders.json.gz')).read())
rungs = collections.defaultdict(list)
for x in orders:
    if x['leg'] in ('entry', 'exit', 'stop') and float(x['filled_base'] or 0) > 0:
        rungs[(x['book'], x['rung_side'], round(float(x['k']), 4))].append(x)
out = {'entryFills': collections.Counter(), 'entryFillsUnder1Gbp': collections.Counter(), 'tripsUnder1Gbp': collections.Counter(),
       'heldMinutesUnder1GbpTrips': collections.Counter(), 'tripsAll': collections.Counter()}
B0 = iso2ms('2026-10-08T00:00:00Z')
for key, fs in rungs.items():
    fs.sort(key=lambda x: (x['filled_at'] or x['ts'], x['id']))
    pos = 0.0; gbp = 0.0; t_open = None
    for f in fs:
        q, p = float(f['filled_base']), float(f['avg_fill_price'] or f['price'])
        ts = iso2ms(f['filled_at'] or f['ts'])
        per = 'from 10-08' if ts >= B0 else 'before 10-08'
        if f['leg'] == 'entry':
            out['entryFills'][f'{key[0]} {per}'] += 1
            if q * p < 1.0: out['entryFillsUnder1Gbp'][f'{key[0]} {per}'] += 1
            if t_open is None: t_open = ts
            gbp += q * p
        pos += (1 if f['side'] == 'buy' else -1) * q
        if abs(pos) < 0.135:
            out['tripsAll'][f'{key[0]} {per}'] += 1
            if gbp < 1.0 and t_open is not None:
                out['tripsUnder1Gbp'][f'{key[0]} {per}'] += 1
                out['heldMinutesUnder1GbpTrips'][f'{key[0]} {per}'] += round((ts - t_open) / 60000)
            t_open = None; gbp = 0.0
res = {k: dict(sorted(v.items())) for k, v in out.items()}
json.dump(res, open(os.path.join(HERE, 'results', 'dust_fills.json'), 'w'), indent=1)
print(json.dumps(res, indent=1))
