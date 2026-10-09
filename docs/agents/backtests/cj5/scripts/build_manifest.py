"""Write MANIFEST.json: every file in this folder (but the manifest) with its size and sha256, the frozen simulator it
imports, and how to re-run."""
import hashlib, json, os

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SIM = os.path.normpath(os.path.join(HERE, "..", "..", "scripts", "pr5", "pr5_sim.py"))
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
    "study": "CJ5: PR5's frozen rule on CoinJar UK's USDC/GBP and USDT/GBP books over their whole public print history (2020-04-02 / 2021-08-27 -> 2026-10-09), paper, keyless",
    "write_up": "docs/agents/reviews/2026-10-09-cj5-paper-test.md",
    "imports_read_only": {"docs/agents/scripts/pr5/pr5_sim.py": hashlib.sha256(open(SIM, "rb").read()).hexdigest(),
                          "docs/agents/backtests/inputs/pr5_2026-09-23/": "PR5's committed Revolut X inputs (calibrate.py, paired.py)",
                          "docs/agents/backtests/statarb_search/inputs/{long,fiat_stable}/revx_USD?-GBP.json.gz": "Revolut X UK prints 09-23 -> 10-09 (paired.py)",
                          "docs/agents/backtests/cjrec/fixture_2026-10-09.json": "CoinJar's touch, the stop's half-spread (inputs.py)"},
    "run": [
        "cd scripts; python3 -I pull_cj_trades.py RAW [ID FROM TO]   # keyless, resumable; segments were pulled side by side, joined by tid",
        "cd scripts; python3 -I pull_fx.py RAW exness; python3 -I pull_fx.py RAW yahoo; python3 -I pull_fx.py RAW fxcm",
        "cd scripts; python3 -I pull_usd.py RAW; python3 -I pull_kraken_usdc.py RAW; python3 -I pull_revx.py",
        "cd scripts; python3 -I inputs.py build RAW   # -> inputs/ (the raw files' sha256 in inputs/raw_manifest.json)",
        "cd scripts; python3 -I fx_check.py RAW   # -> results/fx_check.json (reads the raw FXCM / Yahoo files)",
        "cd scripts; python3 -I calibrate.py   # -> results/calibration.json: reproduces pr5_run1.json's PRIMARY, stress and by-book figure for figure",
        "cd scripts; python3 -I cj5_sim.py   # -> results/cj5.json, results/cj5_trips_100.json.gz (about 10 minutes)",
        "cd scripts; python3 -I paired.py; python3 -I regime.py; python3 -I spot_check.py (live re-read)",
        "cd scripts; python3 -I build_manifest.py",
        "calibrate, cj5_sim, paired and regime were run twice from the committed inputs to the same bytes",
    ],
    "keyless_sources": ["data.exchange.coinjar.com /products/{USDCGBP,USDTGBP}/trades", "ticks.ex2archive.com GBPUSD monthly ticks (EXN)",
                         "query1.finance.yahoo.com GBPUSD=X 1m and 1h", "candledata.fxcorporate.com m1 GBPUSD (check)",
                         "api.exchange.coinbase.com USDT-USD 1h candles", "bitstamp.net ohlc usdcusd / usdtusd 1h", "api.kraken.com Trades USDCUSD (2020)",
                         "revx.revolut.com public candles USDC-USD / USDT-USD"],
    "files": files,
}
json.dump(man, open(os.path.join(HERE, "MANIFEST.json"), "w"), indent=1, sort_keys=True)
print(len(files), "files")
