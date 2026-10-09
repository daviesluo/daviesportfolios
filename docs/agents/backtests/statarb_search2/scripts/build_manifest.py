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
    "study": "STATARB-2: the second stat-arb search of 2026-10-09 (any statistical edge, any platform, not shaped like PR5 or RW)",
    "write_up": "docs/agents/reviews/2026-10-09-stat-arb-search-2.md",
    "run": [
        "cd scripts; python3 -I pull_football.py      # keyless -> inputs/football/ (2026-27 grows on a re-run)",
        "cd scripts; python3 -I vb_football.py        # VB -> results/vb_football.json, byte-identical on re-run",
        "cd scripts; python3 -I pull_yahoo.py         # keyless -> inputs/yahoo/{dual_d,adr_5m,pairs_d,fx_1h}/",
        "cd scripts; python3 -I eq_dual_adr.py        # DCS + ADRX -> results/eq_dual_adr.json, byte-identical",
        "cd scripts; python3 -I eq_pairs.py           # PAIRS -> results/eq_pairs.json, byte-identical",
        "cd scripts; python3 -I pull_fxcm.py          # keyless, ~2,300 weekly files, ~10 min -> inputs/fx/ (derived tables + log)",
        "cd scripts; python3 -I fx_weekend_fix.py     # FXW + FIX -> results/fx_weekend_fix.json, byte-identical",
        "cd scripts; python3 -I fx_yahoo_check.py     # FXW on a second feed -> results/fx_yahoo_check.json, byte-identical",
        "cd scripts; python3 -I deribit_parity_vrp.py # PARITY (live snapshot) + VRP -> results/, inputs/deribit/",
        "cd scripts; python3 -I funding_xvenue.py     # FUNDX (OKX pages back ~3 months) -> results/, inputs/funding/",
        "cd scripts; python3 -I defi_lending.py       # LEND snapshot -> results/, inputs/defi/",
        "cd scripts; python3 -I lrt_discount.py       # LRT snapshot -> results/",
        "cd scripts; python3 -I build_manifest.py",
    ],
    "keyless_sources": ["football-data.co.uk season CSVs", "query1.finance.yahoo.com v8 chart", "candledata.fxcorporate.com m1",
                         "www.deribit.com/api/v2/public", "data-api.binance.vision klines", "api.hyperliquid.xyz/info",
                         "www.okx.com/api/v5/public", "yields.llama.fi", "fred.stlouisfed.org DTB3",
                         "ethereum-rpc.publicnode.com eth_call", "api.paraswap.io prices"],
    "files": files,
}
json.dump(man, open(os.path.join(HERE, "MANIFEST.json"), "w"), indent=1, sort_keys=True)
print(len(files), "files")
