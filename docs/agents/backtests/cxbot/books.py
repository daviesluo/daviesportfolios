"""CXBOT audit (2026-10-29), §2: keyless order-book reads of Hyperliquid and OKX perpetuals.

    python3 -I docs/agents/backtests/cxbot/books.py BTC ETH SOL XRP DOGE

Per coin: the spread (bps), the depth within 5/10/20 bps of the mid per side ($M), and the impact (bps over the mid) of a
market buy of $1k, $10k, $100k and $1M. Hyperliquid's l2Book returns 20 levels a side: at full precision they span about
2.5 bps on BTC (the research's "within 10 bps" figure summed these), so depth is read again at nSigFigs 4. OKX's books
return up to 400 levels, sizes in contracts (`ctVal` from its instruments). Public data only; nothing signed.
"""
import json, subprocess, sys, time


def get(url, body=None):
    cmd = ['curl', '-s', '-m', '20', url]
    if body is not None:
        cmd += ['-H', 'Content-Type: application/json', '-d', json.dumps(body)]
    return json.loads(subprocess.check_output(cmd))


def stats(bids, asks):
    bb, ba = bids[0][0], asks[0][0]
    mid = (bb + ba) / 2
    out = {'spread_bps': round((ba - bb) / mid * 1e4, 3)}
    for w in (5, 10, 20):
        out[f'bid{w}'] = round(sum(u for p, u in bids if p >= mid * (1 - w / 1e4)) / 1e6, 2)
        out[f'ask{w}'] = round(sum(u for p, u in asks if p <= mid * (1 + w / 1e4)) / 1e6, 2)
    for size in (1e3, 1e4, 1e5, 1e6):
        rem = size; cost = 0; qty = 0
        for p, u in asks:
            take = min(rem, u); cost += take; qty += take / p; rem -= take
            if rem <= 0:
                break
        out[f'imp{int(size)}'] = round(((cost / qty) / mid - 1) * 1e4, 2) if rem <= 0 else None
    return out


coins = sys.argv[1:] or ['BTC', 'ETH', 'SOL']
print('ts', time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()))
for c in coins:
    full = get('https://api.hyperliquid.xyz/info', {'type': 'l2Book', 'coin': c})
    agg = get('https://api.hyperliquid.xyz/info', {'type': 'l2Book', 'coin': c, 'nSigFigs': 4})
    conv = lambda lv: [(float(x['px']), float(x['px']) * float(x['sz'])) for x in lv]
    sf = stats(conv(full['levels'][0]), conv(full['levels'][1]))
    sa = stats(conv(agg['levels'][0]), conv(agg['levels'][1]))
    print('HL ', c, 'spread', sf['spread_bps'], 'impact(full)', {k: v for k, v in sf.items() if k.startswith('imp')},
          'depth$M(agg)', {k: v for k, v in sa.items() if k[:3] in ('bid', 'ask')}, 'impact(agg)', {k: v for k, v in sa.items() if k.startswith('imp')})
    inst = f'{c}-USDT-SWAP'
    meta = get(f'https://www.okx.com/api/v5/public/instruments?instType=SWAP&instId={inst}')['data'][0]
    ctv = float(meta['ctVal'])
    b = get(f'https://www.okx.com/api/v5/market/books?instId={inst}&sz=400')['data'][0]
    conv2 = lambda lv: [(float(x[0]), float(x[0]) * float(x[1]) * ctv) for x in lv]
    so = stats(conv2(b['bids']), conv2(b['asks']))
    print('OKX', c, 'ctVal', ctv, 'tick', meta['tickSz'], 'minSz', meta['minSz'], so)
