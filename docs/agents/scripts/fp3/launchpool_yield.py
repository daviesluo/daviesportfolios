"""Size Launchpool yields from public data: for each completed project in the public list
(bapi launchpool/project/listV3), each pool's reward value at the token's first traded
hour on Binance spot (close of the first 1h kline of <COIN>USDT, data-api mirror) divided
by the pool's locked value (stablecoins at 1.0; BNB at BNBUSDT's close at the pool's start).
Per-project return on locked capital, and what it sums to over a year."""
import json, os, sys, datetime
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import netlib
S = netlib.S
d = json.load(open(os.path.join(S, 'data', 'launchpool_listV3.json')))['data']['completed']['list']
out = []
for p in d:
    coin = p['rebateCoin']; t0 = int(p['investStartTime']); dur = float(p['duration'])
    ctt = p.get('coinTradeTime')
    ct = int(float(ctt) * 1000) if ctt else None
    code, k = netlib.get_json(f"https://data-api.binance.vision/api/v3/klines?symbol={coin}USDT&interval=1h&limit=3" + (f"&startTime={ct}" if ct else "&startTime=0"))
    price = float(k[0][4]) if code == 200 and k else None
    code2, kb = netlib.get_json(f"https://data-api.binance.vision/api/v3/klines?symbol=BNBUSDT&interval=1h&limit=1&startTime={t0}")
    bnb = float(kb[0][4]) if code2 == 200 and kb else None
    for pool in p['projects']:
        asset = pool['asset']; locked = float(pool['totalInvestAmount']); rew = float(pool['rebateTotalAmount'])
        px_asset = bnb if asset == 'BNB' else (1.0 if asset in ('USDC','USDT','FDUSD','U','USD1','TUSD') else None)
        ret = (rew * price) / (locked * px_asset) if (price and px_asset and locked > 0) else None
        out.append({'coin': coin, 'start': datetime.datetime.utcfromtimestamp(t0/1000).date().isoformat(), 'days': dur, 'asset': asset,
                    'locked_usd': locked * px_asset if px_asset else None, 'reward_tokens': rew, 'first_hour_close': price,
                    'return_on_locked': ret, 'annualised': (ret * 365 / dur) if ret is not None else None})
json.dump(out, open(os.path.join(S, 'results', 'launchpool_yield.json'), 'w'), indent=1)
for r in out:
    print(r['start'], r['coin'], r['asset'], r['days'], f"{r['locked_usd']/1e6 if r['locked_usd'] else 0:.0f}M", f"px {r['first_hour_close']}", f"ret {100*r['return_on_locked']:.3f}%" if r['return_on_locked'] is not None else '', f"ann {100*r['annualised']:.1f}%" if r['annualised'] is not None else '')
