# REVX-FAIR (2026-10-29): writes MANIFEST.json, every input's line count and the md5 the database computed over its text
# (sql/pulls.sql), and the sha256 of every committed data file, script and result.   python3 -I scripts/manifest.py
import hashlib, json, os

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB = {'prints': (16808, '58deb4b0c10966f4631cf591f8ebd043'), 'minutes': (97910, '276f4430d448083fd3861d485301e167'),
      'hours': (1744, 'fcaac3688663709ecc5447267a656228'), 'book_USDC-GBP': (37267, '1779b6956e75fd48ff8893c465b3024a'),
      'book_USDT-GBP': (36470, '7e6214c79dd56e60aec0870bf7ee4a94'), 'book_USDC-USD': (13546, 'ef7a3199f8f0aa9819ebff055c4776d6'),
      'book_USDT-USD': (16763, '7bd9115991bf7f205b1b3361791ef79e'), 'cb_USDC-GBP': (27091, '6c8cdf55e52d06fb29ac25bd5fcb2365'),
      'cb_USDT-GBP': (27091, 'bcf1f2890ce2b423cd8e49e7ae959961'),
      # the Coinbase mirror's (addendum, pulled 2026-10-29 06:20-06:26 UTC)
      'cb_print_minutes_USDC-GBP': (23816, '90b0174ed39f64d52b0cc14e7d991403'), 'fx': (36919, '9b9875aed722ff4a81c8012ddb565aa7'),
      'cb_engine_trips_USDC-GBP': (64, '9891181138c44da1ca270209eedc88e1')}
# Derived here, not pulled: Revolut X's USDC-GBP mid a minute (scripts/cb_mirror_prep.py from book_USDC-GBP and $FP_LIVE).
DERIVED = ['rx_mid_USDC-GBP']


def sha(p):
    return hashlib.sha256(open(os.path.join(HERE, p), 'rb').read()).hexdigest()


m = {'study': 'REVX-FAIR, docs/agents/reviews/2026-10-29-revx-fair-price-study.md',
     'pulled': '2026-10-29 05:40-05:50 UTC, SELECT only (sql/pulls.sql)', 'rows_end': '2026-10-29T00:00:00Z',
     'data': {f'data/{k}.txt.gz': {'lines': n, 'db_md5_of_text': md5, 'sha256': sha(f'data/{k}.txt.gz')} for k, (n, md5) in DB.items()},
     'not_committed': {'live_orders': {'lines': 9522, 'db_md5_of_text': '0cd06ea25edb2bcaa60eb2ff35d3ead5',
                                       'why': "LIVE's own orders carry the live account's sizes; the scripts read them from $FP_LIVE"}},
     'derived': {f'data/{k}.txt.gz': {'sha256': sha(f'data/{k}.txt.gz')} for k in DERIVED},
     'scripts': {f'scripts/{f}': sha(f'scripts/{f}') for f in sorted(os.listdir(os.path.join(HERE, 'scripts'))) if f.endswith(('.py', '.ts')) and f != 'manifest.py'},
     'engine': {'../pr5_opt/scripts/sim.py': sha('../pr5_opt/scripts/sim.py')},
     'results': {f'results/{f}': sha(f'results/{f}') for f in sorted(os.listdir(os.path.join(HERE, 'results')))},
     'run': ['FP_LIVE=<live_orders.txt> python3 -I scripts/measure.py', 'FP_LIVE=<live_orders.txt> python3 -I scripts/replay.py',
             'FP_LIVE=<live_orders.txt> python3 -I scripts/lead.py',
             'FP_LIVE=<live_orders.txt> python3 -I scripts/cb_mirror_prep.py (rewrites data/rx_mid_USDC-GBP.txt; gzip -n -9 it)',
             'npx --yes deno@1.46.3 run --allow-read --allow-write docs/agents/backtests/fair_price/scripts/cb_mirror.ts (from the repository root)',
             'python3 -I scripts/cb_mirror.py', 'python3 -I scripts/manifest.py']}
json.dump(m, open(os.path.join(HERE, 'MANIFEST.json'), 'w'), indent=1)
print(len(m['data']), 'data files,', len(m['scripts']), 'scripts,', len(m['results']), 'results')
