"""Census of Revolut X UK books (keyless, 2026-10-01): which quote currencies exist on the UK side, and which
books pair a stablecoin, a fiat or a gold token with a currency. Reads the two committed samples only."""
import json, collections
pairs = json.load(open('samples/revx_pairs_2026-10-01.json'))
tick = json.load(open('samples/revx_tickers_uk_2026-10-01.json'))['data']
uk = [t for t in tick if t.get('region') == 'UK']
print('pairs in configuration:', len(pairs), ' UK ticker rows:', len(uk), ' non-UK rows dropped:', len(tick) - len(uk))
quotes = collections.Counter(t['symbol'].split('/')[1] for t in uk)
print('UK quote currencies:', dict(quotes))
STABLE = {'USDC','USDT','DAI','PYUSD','EURC','RLUSD','USDG','FDUSD','TUSD','USDP','USDE','USDS','GUSD','EURT','EURS','USD1','FRAX','LUSD','USDD','USTC','PAXG','XAUT','GBPT','EUROC','EURQ','USDQ','AUSD','USDX'}
FIAT = {'USD','GBP','EUR','CHF','JPY','AUD','CAD'}
rows = []
for t in uk:
    b, q = t['symbol'].split('/')
    if b in STABLE or b in FIAT or q not in ('USD', 'GBP'):
        bid, ask = float(t['bid'] or 0), float(t['ask'] or 0)
        mid = (bid + ask) / 2 if bid and ask else 0
        spr = (ask - bid) / mid * 1e4 if mid else float('nan')
        rows.append((t['symbol'], bid, ask, round(spr, 2), float(t['quote_volume_24h'] or 0)))
print('\nUK books with a stablecoin/fiat/gold base, or a quote other than USD/GBP:')
for r in sorted(rows, key=lambda r: -r[4]):
    print('  %-12s bid %-12s ask %-12s spread %7s bps  24h quote vol %12.0f' % r)
# configuration pairs whose quote is not USD/GBP/EUR (any region)
oddq = sorted({p.split('/')[1] for p in pairs})
print('\nall quote currencies in configuration:', oddq)
stab_cfg = sorted(p for p in pairs if p.split('/')[0] in STABLE)
print('configuration pairs with a stable/gold base:', stab_cfg)
