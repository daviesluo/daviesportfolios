"""Write MANIFEST.json: every file in this folder (but the manifest) with its size and sha256, what it imports read-only,
the keyless sources and how to re-run."""
import hashlib, json, os

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SIM = os.path.normpath(os.path.join(HERE, "..", "..", "scripts", "pr5", "pr5_sim.py"))
VB = os.path.normpath(os.path.join(HERE, "..", "cj5", "scripts", "vbook.py"))
files = {}
for root, _, names in os.walk(HERE):
    for n in sorted(names):
        p = os.path.join(root, n)
        rel = os.path.relpath(p, HERE)
        if rel == "MANIFEST.json" or "__pycache__" in rel:
            continue
        b = open(p, "rb").read()
        files[rel] = {"bytes": len(b), "sha256": hashlib.sha256(b).hexdigest()}
man = {
    "study": "SCQ-VENUES: which venue besides Revolut X UK and CoinJar can run PR5's frozen rule (0 % maker quotes 0.1/0.2/0.3 % around interbank fair on stablecoin-vs-fiat books); fee screen of every UK/Irish-reachable venue, then PR5's simulator on the keyless print history (2024-10-01 -> 2026-10-09) of those at maker <= 0.02 %",
    "write_up": "docs/agents/reviews/2026-10-09-stablecoin-venues.md",
    "imports_read_only": {"docs/agents/scripts/pr5/pr5_sim.py": hashlib.sha256(open(SIM, "rb").read()).hexdigest(),
                          "docs/agents/backtests/cj5/scripts/vbook.py": hashlib.sha256(open(VB, "rb").read()).hexdigest(),
                          "docs/agents/backtests/cj5/inputs/": "GBP/USD (EXN + Yahoo), USDC/USDT hourly dollar values, CoinJar prints (calibrate_bars.py), CJ5's trips (pairing.py)",
                          "docs/agents/backtests/cj5/scripts/paired.py": "PR5 on Revolut X's UK books, the same days (pairing.py)"},
    "run": [
        "cd scripts; python3 -I pull_coinbase.py RAW USDC-GBP::5500000 USDC-GBP:5500001:3757536 ...   # keyless, resumable; segments side by side (see the log's segment names)",
        "cd scripts; python3 -I pull_okx.py RAW USDG-EUR USDC-EUR USDT-EUR; python3 -I pull_kraken.py RAW USDEEUR USDEUSD USDGUSD",
        "cd scripts; python3 -I pull_bitstamp.py RAW usdceur usdteur rlusdeur; python3 -I pull_fx_eur.py RAW; python3 -I pull_usd_extra.py RAW",
        "cd scripts; python3 -I read_touch.py   # -> inputs/touch.json (live; read 2026-10-09 ~22:25 UTC)",
        "cd scripts; python3 -I sv_inputs.py build RAW   # -> inputs/ (raw page / file sha256 in inputs/raw_pages/ and inputs/raw_manifest.json)",
        "cd scripts; python3 -I calibrate_bars.py   # -> results/calibrate_bars.json: bars == prints for PR5's simulator on CJ5's CoinJar record",
        "cd scripts; python3 -I sv_sim.py   # -> results/sv.json, daily_100.json, trips_100.json.gz",
        "cd scripts; python3 -I pairing.py   # -> results/pairing.json, pr5_revx_daily_100.json",
        "cd scripts; python3 -I spot_check.py   # live re-read of sampled raw pages -> results/spot_check.json",
        "cd scripts; python3 -I build_manifest.py",
    ],
    "keyless_sources": ["api.exchange.coinbase.com /products/{USDC-GBP,USDT-GBP,USDC-EUR,USDT-EUR}/trades and /book",
                        "static.okx.com /cdn/okex/traderecords/trades/daily (USDC-EUR, USDT-EUR, USDG-EUR); www.okx.com /api/v5/market/books",
                        "api.kraken.com /0/public/Trades (USDEEUR, USDEUSD, USDGUSD), AssetPairs, Ticker, Depth",
                        "www.bitstamp.net /api/v2/ohlc (usdceur, usdteur, rlusdeur 1m; rlusdusd 1h), order_book, trading-pairs-info",
                        "ticks.ex2archive.com EURUSD monthly ticks (EXN)", "query1.finance.yahoo.com EURUSD=X 1m",
                        "api.gemini.com, api.crypto.com/exchange/v1, api.luno.com (listings only)"],
    "files": files,
}
json.dump(man, open(os.path.join(HERE, "MANIFEST.json"), "w"), indent=1, sort_keys=True)
print(len(files), "files")
