"""Write ../MANIFEST.json: every committed file's sha256 and size, the run order, and the raw pulls kept out of the repo.
usage: python3 -I manifest.py
"""
import hashlib, json, os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
files = {}
for d in ("inputs", "results", "scripts", "sql"):
    for fn in sorted(os.listdir(os.path.join(ROOT, d))):
        p = os.path.join(ROOT, d, fn)
        if os.path.isfile(p) and not fn.endswith(".pyc"):
            b = open(p, "rb").read()
            files[f"{d}/{fn}"] = {"bytes": len(b), "sha256": hashlib.sha256(b).hexdigest()}
man = {
    "study": "OTHERVENUES, 2026-10-27 (docs/agents/reviews/2026-10-27-other-coins-venues.md): which other coins and venues can run "
             "PR5's rule (0 % maker quotes 0.1 / 0.2 / 0.3 % around an FX fair on a pegged coin, exit at fair, 24-hour stop). Not blind; "
             "nothing placed, signed or opened; no key read.",
    "reads": "keyless public GETs (Coinbase Exchange, Kraken, Bitstamp, OKX incl. its daily trade archive, Gemini, Crypto.com, Bitfinex, "
             "Bitvavo, KuCoin, One Trading, Luno, Bitpanda; Revolut X's pair list through the read-only connector), 2026-10-27 05:04-06:00 UTC; "
             "two SELECTs of stored FX minutes through the Supabase connector (sql/fx.sql); Revolut X's prints and PR5's minutes from "
             "../pr5_opt/data (committed); GBP/USD and EUR/USD before 2026-10-09 from ../cj5/inputs and ../scq_venues/inputs (committed).",
    "run_order": [
        "python3 -I scripts/screen.py <raw>                      # results/listings.json (live listings)",
        "python3 -I scripts/snapshot.py results/snapshot_2026-10-27.json 1.33372 1.11719 3   # live books (differs on every run)",
        "python3 -I scripts/cb_bisect.py <PRODUCT> <ISO instant> # the trade-id bounds used below",
        "python3 -I scripts/pull_coinbase.py <raw> EURC-USDC:<after>:<stop> x16  (ids 8651691..19293153); OV_START=2026-04-22T00:00:00+00:00 TGBP-USDC:42713:0; "
        "OV_START=2026-09-29T00:00:00+00:00 USDC-GBP:7392661:7325370 USDC-GBP:7325371:7258080 USDT-GBP:6817700:6758140 USDT-GBP:6758141:6698578",
        "python3 -I scripts/pull_okx.py <raw> EURC-USDC USDG-EUR",
        "python3 -I scripts/pull_bitstamp.py <raw> eurcvusdc",
        "python3 -I scripts/pull_usd.py <raw>",
        "python3 -I scripts/grab_text.py <saved connector reply> <raw>/db   # each statement of sql/fx.sql",
        "python3 -I scripts/ov_inputs.py build <raw>             # inputs/",
        "python3 -I scripts/ov_sim.py                            # results/ov.json, results/daily_50.json (about 20 s)",
        "python3 -I scripts/table.py                             # results/table.md",
        "python3 -I scripts/pairing.py                           # results/pairing.json",
        "python3 -I scripts/fx_risk.py                           # results/fx_risk.json",
        "python3 -I scripts/manifest.py",
    ],
    "raw_not_committed": "the pulls' raw bodies (about 140 MB) were deleted after the build; every page's sha256 is in inputs/raw_pages.json.gz",
    "files": files,
}
json.dump(man, open(os.path.join(ROOT, "MANIFEST.json"), "w"), indent=1, sort_keys=True)
print(len(files), "files")
