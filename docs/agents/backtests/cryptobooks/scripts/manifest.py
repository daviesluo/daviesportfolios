# CRYPTOBOOKS: write MANIFEST.json, every committed file of the folder with its sha256, and the inputs it reads elsewhere.
# python3 -I docs/agents/backtests/cryptobooks/scripts/manifest.py
import hashlib, json, os

HERE = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
out = {
    "study": "CRYPTOBOOKS, docs/agents/reviews/2026-10-31-crypto-books-deep.md; CRYPTOBOOKS-2, docs/agents/reviews/2026-10-31-xrp-gbp-strategy.md",
    "written": "2026-10-31 UTC",
    "inputs_from_other_studies": [
        "docs/agents/backtests/fair_price/data/fx.txt.gz (Yahoo GBP/USD minutes to 2026-10-28 23:57)",
        "docs/agents/backtests/mmcomp/data/other_cb_usdt_usd.txt.gz (Coinbase USDT-USD minute closes)",
    ],
    "not_committed": "Binance's one-second closes, rebuilt by scripts/binance_1s.py from data.binance.vision (public) into the "
                     "directory CRYPTOBOOKS_BN names; the year's windows of Binance seconds and Coinbase GBP/USD, rebuilt by "
                     "scripts/hist_fair.py into CRYPTOBOOKS_HF",
    "database": "SELECT only through the Supabase connector, 2026-10-31: fx_ticks (data/fx_truefx_gbpusd.txt.gz), "
                "agent_maker_minutes (data/maker_hourly_usdtgbp.txt.gz), agent_maker_events (data/maker_events.json), "
                "agent_basis (data/agent_basis_spreads.json), agent_maker_events again at 09:21 UTC (data/maker_events_1031.json); each file names its statement",
    "network": "scripts/poll.py, record.py, trades.py, hist_pull.py, binance_1s.py and hist_fair.py read public venue endpoints (GET only, no key)",
    "files": {},
}
for root, _, files in os.walk(HERE):
    for f in sorted(files):
        p = os.path.join(root, f)
        rel = os.path.relpath(p, HERE)
        if rel == "MANIFEST.json" or "__pycache__" in rel:
            continue
        out["files"][rel] = hashlib.sha256(open(p, "rb").read()).hexdigest()
out["files"] = dict(sorted(out["files"].items()))
json.dump(out, open(os.path.join(HERE, "MANIFEST.json"), "w"), indent=1)
print(len(out["files"]), "files")
