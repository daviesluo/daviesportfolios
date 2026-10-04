import json, re, urllib.request, urllib.parse, time
def get(url):
    for i in range(4):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'study'}), timeout=60) as r: return json.load(r)
        except Exception as e:
            err = e; time.sleep(1 + i)
    raise err
rates, cur = {}, ''
while True:
    d = get('https://clob.polymarket.com/rewards/markets/current' + (f'?next_cursor={urllib.parse.quote(cur)}' if cur else ''))
    for r in d['data']:
        rate = r.get('total_daily_rate') or ((r.get('native_daily_rate') or 0) + (r.get('sponsored_daily_rate') or 0))
        c = r['condition_id']
        if rate > rates.get(c, (0,))[0]: rates[c] = (rate, r.get('rewards_max_spread'), r.get('rewards_min_size'))
    cur = d.get('next_cursor') or ''
    if not cur or cur == 'LTE=' or not d['data']: break
want = [c for c, v in rates.items() if v[0] >= 6]
qs = {}
for i in range(0, len(want), 50):
    b = want[i:i + 50]
    url = 'https://gamma-api.polymarket.com/markets?limit=100&' + '&'.join('condition_ids=' + c for c in b)
    for m in get(url): qs[m.get('conditionId')] = (m.get('question') or '', m.get('endDate'), m.get('closed'), m.get('acceptingOrders'))
fr = json.load(open('classes_frozen.json'))['classes']
def cls(q):
    for k in ['P', 'V', 'C']:
        if re.search(fr[k]['q'], q, re.I): return k
    return '-'
bands = {'mini $6-<10': (6, 10), 'mid $10-50': (10, 50.000001), 'over $50': (50.000001, 1e9)}
out = {'read_at': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()), 'rewarded': len(rates), 'rate>=6': len(want), 'with_question': len(qs), 'bands': {}}
for name, (lo, hi) in bands.items():
    ms = [(c, rates[c][0]) for c in want if lo <= rates[c][0] < hi and c in qs and qs[c][3] is not False and not qs[c][2]]
    cnt = {'P': [], 'V': [], 'C': []}
    for c, rt in ms:
        k = cls(qs[c][0])
        if k in cnt: cnt[k].append((c[:10], rt, qs[c][0][:80], (qs[c][1] or '')[:16]))
    out['bands'][name] = {'markets': len(ms), **{k: len(v) for k, v in cnt.items()}, 'list': {k: v for k, v in cnt.items() if k in ('P', 'V')}}
json.dump(out, open('data/live_count.json', 'w'), indent=1)
print(json.dumps({k: v for k, v in out.items() if k != 'bands'}))
for name, b in out['bands'].items():
    print(name, {k: b[k] for k in ('markets', 'P', 'V', 'C')})
    for k in ('P', 'V'):
        for x in b['list'][k][:12]: print('   ', k, x)
