# Q2-TRIPS' manifest (2026-10-14): the sha256 of its script, its results and the scratch inputs they read (never
# committed). The earlier manifests are left as they were.
#   python3 -I docs/agents/backtests/lpbest/scripts/q2trips_manifest.py <work> <live dir>
import hashlib, json, os, sys

here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
work, live = sys.argv[1], sys.argv[2]
sha = lambda p: hashlib.sha256(open(p, 'rb').read()).hexdigest()
out = {
    "study": "Q2-TRIPS: every Q2 lot since its restart (2026-10-13 13:26 -> 10-14 15:59 UTC) and its P&L split, the engine calibrated to live over that window, and entry/exit rules (a)-(g) priced on 10-05 -> 10-12 and on the live window; 2026-10-14",
    "review": "docs/agents/reviews/2026-10-14-q2-trips.md",
    "database": "flmvxigozjuizpckllvk, read-only selects (sql/q2trips_live.sql, sql/q2pm_live.sql #1-#3): pm_lp_fills, pm_lp_markets, pm_lp_events, pm_lp_reward_days, pm_lp_settlements, pm_lp_minutes, pm_lp_orders, pm_lp_state, pm_lp_config, pm_rec_archive (signed URLs read from a saved reply, never printed or committed)",
    "public_reads": "the data API's /trades for 488 markets (2026-10-12 00:00 -> 10-14 16:00, apitape.py's fetch)",
    "scripts": {f"scripts/{f}": sha(os.path.join(here, 'scripts', f)) for f in ('q2trips.py', 'q2trips_manifest.py', 'q2pm.py', 'engine.py')},
    "sql": {f"sql/{f}": sha(os.path.join(here, 'sql', f)) for f in ('q2trips_live.sql', 'q2pm_live.sql')},
    "results": {f"results/{f}": sha(os.path.join(here, 'results', f)) for f in ('q2trips_tape.txt', 'q2trips_trips.txt', 'q2trips_calib.txt', 'q2trips_opt.txt')},
    "inputs_not_committed": {
        "work (extract.py over every archive hour 10-04 19:00 -> 10-14 15:00; Q2-PM's day tables 10-05 -> 10-14; the API tape merged)": {
            f: sha(os.path.join(work, f)) for f in ('meta.json', 'prints.pkl', 'prog.pkl', 'daytable_api.csv.gz', 'prints_api.pkl', 'live_orders.json.gz',
                                                    'calib.json', 'validate.json', 'rec_markets.json.gz')},
        "live record (the replies, unwrapped)": {f: sha(os.path.join(live, f)) for f in ('live_aux.json', 'live_minutes.json.gz', 'live_orders.json.gz')},
    },
    "run_order": [
        "python3 -I docs/agents/backtests/lpbest/scripts/fetch.py <saved reply of sql/q2trips_live.sql #4> <pmrec15 dir>",
        "python3 -I docs/agents/backtests/lpbest/scripts/extract.py <every books/prints/markets hour since 10-04> <every universe hour> <work>",
        "python3 -I docs/agents/backtests/lpadverse/scripts/unwrap.py <each saved reply #1-#3> <live dir>/...; the live orders' first 14 columns to <work>/live_orders.json.gz; calib.json, validate.json, created.json, prints_api.pkl, daytable_api.csv.gz, rec_markets.json.gz copied from Q2-PM's work",
        "LPBEST_WORK=<work> Q2PM_LIVE=<live dir> python3 -I -W ignore docs/agents/backtests/lpbest/scripts/q2trips.py tape > results/q2trips_tape.txt",
        "LPBEST_WORK=<work> LPBEST_API_TAPE=1 Q2PM_LIVE=<live dir> python3 -I -W ignore docs/agents/backtests/lpbest/scripts/q2trips.py trips|calib|opt > results/q2trips_<step>.txt (in that order: opt reads calib's json)",
    ],
}
json.dump(out, open(os.path.join(here, 'MANIFEST_q2trips.json'), 'w'), indent=1)
print('MANIFEST_q2trips.json written')
