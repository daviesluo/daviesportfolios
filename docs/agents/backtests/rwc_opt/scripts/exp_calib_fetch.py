# EXPENSIVE-SIDE (2026-10-09): Polymarket's own history, for how often a side priced >= 0.90 / >= 0.95 loses.
# Keyless public reads only: Gamma's closed binary markets whose scheduled end falls in each UTC day of the window, with
# $25k+ volume (a day's 2,100 highest by volume at most, Gamma's offset limit), less the classes live-prep never quotes or
# whose books are not like its markets' (5- / 15-minute crypto up-or-down, weather, sports games and props by their question's
# shape); up to PER_DAY of them a day, drawn with
# random.Random(f"20261023|{day}"); then the YES token's hourly price (CLOB prices-history, fidelity 60) over the 14 days before
# the market closed. Writes <out>/markets.jsonl and <out>/hist.jsonl (not committed; exp_calib.py reads them).
# python3 -I scripts/exp_calib_fetch.py <out dir> [first day] [last day]
import json, random, re, sys, time, urllib.request, urllib.parse, datetime as dt
from concurrent.futures import ThreadPoolExecutor
OUT = sys.argv[1]
D0 = dt.date.fromisoformat(sys.argv[2] if len(sys.argv) > 2 else '2025-10-01')
D1 = dt.date.fromisoformat(sys.argv[3] if len(sys.argv) > 3 else '2026-10-04')
PER_DAY = 20
SKIP = re.compile(r'up or down|temperature|precipitation|rain|snow|wind gust|\bvs\.? |o/u|spread[: ]|both teams|total (goals|points|kills|maps)|anytime touchdown|: (points|rebounds|assists)|win on 20\d\d-|game \d|map \d|set \d|exact score|halftime', re.I)

def get(url, tries=5):
    for k in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'dp-research'}), timeout=60) as r:
                return json.loads(r.read())
        except Exception as e:
            if k == tries - 1: raise
            time.sleep(1.5 * (k + 1))

def day_markets(d):
    out, off = [], 0
    while off <= 2000:   # Gamma refuses an offset over 2,000: a day is its 2,100 highest-volume markets at most
        q = urllib.parse.urlencode({'closed': 'true', 'end_date_min': f'{d}T00:00:00Z', 'end_date_max': f'{d + dt.timedelta(days=1)}T00:00:00Z', 'volume_num_min': 25000, 'order': 'volumeNum', 'ascending': 'false', 'limit': 100, 'offset': off})
        page = get(f'https://gamma-api.polymarket.com/markets?{q}')
        out += page
        if len(page) < 100: break
        off += 100
    keep = []
    for m in out:
        try:
            outs, px, toks = json.loads(m.get('outcomes') or '[]'), json.loads(m.get('outcomePrices') or '[]'), json.loads(m.get('clobTokenIds') or '[]')
        except Exception: continue
        if outs != ['Yes', 'No'] or len(toks) != 2 or px not in (['1', '0'], ['0', '1']): continue
        if m.get('feeType') in ('crypto_fees_v2', 'weather_fees') or (m.get('feeType') or '').startswith('sports') or m.get('gameStartTime'): continue
        if SKIP.search(m.get('question') or ''): continue
        if not m.get('closedTime'): continue
        keep.append({'cond': m.get('conditionId'), 'q': m.get('question'), 'yes': toks[0], 'yes_won': px[0] == '1', 'end': m.get('endDate'), 'closed': m.get('closedTime'),
                     'start': m.get('startDate'), 'vol': m.get('volumeNum'), 'neg_risk': m.get('negRisk'), 'fee': m.get('feeType'), 'day': str(d)})
    r = random.Random(f'20261023|{d}')
    r.shuffle(keep)
    return keep[:PER_DAY], len(out), len(keep)

def hist(m):
    close = int(dt.datetime.fromisoformat(m['closed'].replace('+00', '+00:00').replace(' ', 'T')).timestamp())
    q = urllib.parse.urlencode({'market': m['yes'], 'startTs': close - 14 * 86400, 'endTs': close, 'fidelity': 60})
    try: h = get(f'https://clob.polymarket.com/prices-history?{q}').get('history', [])
    except Exception as e: h = None
    return {'cond': m['cond'], 'close': close, 'h': [[x['t'], x['p']] for x in h] if h is not None else None}

days = [D0 + dt.timedelta(days=i) for i in range((D1 - D0).days + 1)]
with ThreadPoolExecutor(6) as ex: res = list(ex.map(day_markets, days))
mk = [m for l, _, _ in res for m in l]
print(f'days {len(days)}: listed {sum(n for _, n, _ in res)}, eligible {sum(k for _, _, k in res)}, drawn {len(mk)}', file=sys.stderr)
with open(f'{OUT}/markets.jsonl', 'w') as f:
    for m in mk: f.write(json.dumps(m) + '\n')
with ThreadPoolExecutor(8) as ex, open(f'{OUT}/hist.jsonl', 'w') as f:
    for i, h in enumerate(ex.map(hist, mk)):
        f.write(json.dumps(h) + '\n')
        if i % 500 == 0: print(f'hist {i}/{len(mk)}', file=sys.stderr)
