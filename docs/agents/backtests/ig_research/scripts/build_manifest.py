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
    "study": "IG: what IG's API, products and costs allow a UK retail spread-bettor, and which IG-tradable edges survive "
             "IG's spreads and funding (2026-10-09)",
    "write_up": "docs/agents/reviews/2026-10-09-ig-opportunities.md",
    "run": [
        "cd scripts; python3 -I pull_public.py        # keyless -> inputs/{yahoo_d,yahoo_1h,cboe,fred}/, fomc_dates.json "
        "(a re-run reads later data; stages: yahoo cboe vx fred fomc)",
        "cd scripts; python3 -I idx_calendar.py       # IDX -> results/idx_calendar.json, byte-identical on re-run",
        "cd scripts; python3 -I es_sunday.py          # ESG -> results/es_sunday.json, byte-identical",
        "cd scripts; python3 -I vrp.py                # VAR, BENCH, STRAD, VXS -> results/vrp.json, byte-identical",
        "cd scripts; python3 -I fxw_ig.py             # FXW-IG (reads ../statarb_search2/inputs/fx/) -> results/fxw_ig.json",
        "cd scripts; python3 -I summary.py            # the ranked table -> results/summary.json",
        "cd scripts; python3 -I build_manifest.py",
    ],
    "inputs_ig_pages": "inputs/ig_pages/: text of each IG, HMRC, legislation.gov.uk and FCA page quoted, as served "
                       "2026-10-09, with the raw page's sha256 in index.json (nothing behind a login; no key)",
    "keyless_sources": ["query1.finance.yahoo.com v8 chart", "cdn-api.cboe.com daily index histories",
                        "cdn.cboe.com VX futures settlements", "fred.stlouisfed.org fredgraph.csv",
                        "www.federalreserve.gov FOMC calendars", "labs.ig.com", "www.ig.com/uk help centre",
                        "www.gov.uk HMRC manuals", "www.legislation.gov.uk", "www.fca.org.uk"],
    "files": files,
}
json.dump(man, open(os.path.join(HERE, "MANIFEST.json"), "w"), indent=1, sort_keys=True)
print(len(files), "files")
