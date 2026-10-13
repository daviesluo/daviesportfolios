# Q2-AGE's manifest (2026-10-13): the sha256 of its scripts, its results and the scratch inputs they read (never
# committed). LP-BEST's own MANIFEST.json is left as it was frozen.
#   python3 -I docs/agents/backtests/lpbest/scripts/q2age_manifest.py <LP-BEST work> <10-13 work> <PMOPPS created.json>
import hashlib, json, os, sys

here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
work, w13, created = sys.argv[1], sys.argv[2], sys.argv[3]
sha = lambda p: hashlib.sha256(open(p, 'rb').read()).hexdigest()
out = {
    "study": "Q2-AGE: Q2 (live-prep's Addendum 19, quiet books) with and without a minimum market age by Gamma's createdAt, through LP-BEST's engine, TRAIN 10-05 -> 10-08, TEST 10-09 -> 10-12, and 2026-10-13 00:00 -> 12:59 UTC as a second span; 2026-10-13",
    "review": "docs/agents/reviews/2026-10-13-q2-age.md",
    "database": "flmvxigozjuizpckllvk, read-only selects: pm_rec_archive (the 10-13 objects' signed URLs, read from a saved reply, never printed or committed), pm_lp_orders (sql/live_orders.sql, to take our own orders out of the 10-13 books), pm_lp_markets (live Q2's picks at its restart)",
    "public_reads": "Gamma /markets createdAt (keyless; PMOPPS' cache plus the 663 conditions of 10-13 not in it), the data API's /trades for the 229 candidates of 10-13 (apitape.py's fetch, 2026-10-12 00:00 -> 10-13 13:00)",
    "scripts": {f"scripts/{f}": sha(os.path.join(here, 'scripts', f)) for f in ('q2age.py', 'q2age_mech.py', 'q2age_13.py', 'q2age_manifest.py')},
    "results": {f"results/{f}": sha(os.path.join(here, 'results', f)) for f in ('q2age.txt', 'q2age_mech.txt', 'q2age_13.txt')},
    "inputs_not_committed": {
        "LP-BEST work (frozen, read only)": {f: sha(os.path.join(work, f)) for f in ('daytable_api.csv.gz', 'prints_api.pkl', 'calib.json', 'validate.json', 'meta.json')},
        "PMOPPS created.json": sha(created),
        "10-13 work (extract.py over every archive hour to 10-13 12:00; its day tables; the API tape merged; createdAt extended)": {
            f: sha(os.path.join(w13, f)) for f in ('meta.json', 'prints.pkl', 'prog.pkl', 'daytable.csv.gz', 'daytable_api.csv.gz', 'prints_api.pkl', 'created.json', 'live_orders.json.gz')},
    },
    "run_order": [
        "LPBEST_WORK=<LP-BEST work> LPBEST_API_TAPE=1 Q2AGE_CREATED=<PMOPPS created.json> python3 -I docs/agents/backtests/lpbest/scripts/q2age.py > results/q2age.txt",
        "LPBEST_WORK=<LP-BEST work> LPBEST_API_TAPE=1 Q2AGE_CREATED=<PMOPPS created.json> python3 -I docs/agents/backtests/lpbest/scripts/q2age_mech.py > results/q2age_mech.txt",
        "python3 -I docs/agents/backtests/lpbest/scripts/fetch.py <saved reply: pm_rec_archive rows of 10-13 00:00 -> 12:00> <pmrec13 dir>",
        "python3 -I docs/agents/backtests/lpbest/scripts/extract.py <every books/prints/markets hour> <every universe hour> <10-13 work>",
        "python3 -I docs/agents/backtests/lpadverse/scripts/unwrap.py <saved reply of sql/live_orders.sql> <10-13 work>/live_orders.json.gz; calib.json, validate.json, rec_markets.json.gz and prints_api.pkl copied from LP-BEST's work",
        "LPBEST_WORK=<10-13 work> python3 -I docs/agents/backtests/lpbest/scripts/q2age_13.py table",
        "LPBEST_WORK=<10-13 work> python3 -I docs/agents/backtests/lpbest/scripts/q2age_13.py tape",
        "LPBEST_WORK=<10-13 work> LPBEST_API_TAPE=1 python3 -I docs/agents/backtests/lpbest/scripts/q2age_13.py table",
        "LPBEST_WORK=<10-13 work> LPBEST_API_TAPE=1 Q2AGE_CREATED=<10-13 work>/created.json python3 -I docs/agents/backtests/lpbest/scripts/q2age_13.py created",
        "LPBEST_WORK=<10-13 work> LPBEST_API_TAPE=1 Q2AGE_CREATED=<10-13 work>/created.json python3 -I docs/agents/backtests/lpbest/scripts/q2age_13.py run > results/q2age_13.txt",
    ],
}
json.dump(out, open(os.path.join(here, 'MANIFEST_q2age.json'), 'w'), indent=1)
print('MANIFEST_q2age.json written')
