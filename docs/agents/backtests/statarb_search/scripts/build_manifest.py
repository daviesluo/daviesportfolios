"""Write MANIFEST.json: every file in this folder (but the manifest) with its size and sha256, and how to re-run."""
import hashlib, json, os

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
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
    "study": "STATARB: the stat-arb search of 2026-10-09 (other strategies with PR5's or RW's structure, any platform)",
    "write_up": "docs/agents/reviews/2026-10-09-stat-arb-search.md",
    "run": [
        "cd scripts; python3 -I pull_fiat_stable.py   # live pull (keyless) -> inputs/fiat_stable/",
        "cd scripts; python3 -I s1_fiat_stable_sim.py   # -> results/s1_fiat_stable.json, byte-identical on re-run",
        "cd scripts; python3 -I pull_long.py   # live pull (keyless) -> inputs/long/",
        "cd scripts; python3 -I s1b_long_sim.py   # -> results/s1b_long.json, byte-identical on re-run",
        "cd scripts; python3 -I pm_kalshi_match.py | smarkets_pm_match.py | smarkets_volumes.py | pull_kalshi_lip.py | pull_limitless.py | pull_defi_yields.py   # live snapshots, each writes a dated file",
        "cd scripts; python3 -I build_manifest.py",
    ],
    "keyless_sources": ["revx.revolut.com public trades", "api.exchange.coinbase.com candles/products/book", "bitstamp.net ohlc",
                         "data.exchange.coinjar.com trades", "query1.finance.yahoo.com 1m FX", "candledata.fxcorporate.com 1m FX",
                         "api.elections.kalshi.com markets/orderbook/incentive_programs", "gamma-api.polymarket.com", "clob.polymarket.com/book",
                         "api.smarkets.com v3", "api.limitless.exchange", "yields.llama.fi", "api.paraswap.io", "wq-api.lido.fi", "api.hyperliquid.xyz/info"],
    "files": files,
}
json.dump(man, open(os.path.join(HERE, "MANIFEST.json"), "w"), indent=1, sort_keys=True)
print(len(files), "files")
