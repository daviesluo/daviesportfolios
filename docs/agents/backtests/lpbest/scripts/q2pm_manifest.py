# Q2-PM's manifest (2026-10-14): the sha256 of its scripts, its results and the scratch inputs they read (never
# committed). LP-BEST's MANIFEST.json and Q2-AGE's MANIFEST_q2age.json are left as they were.
#   python3 -I docs/agents/backtests/lpbest/scripts/q2pm_manifest.py <Q2PM work> <live dir>
import hashlib, json, os, sys

here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
work, live = sys.argv[1], sys.argv[2]
sha = lambda p: hashlib.sha256(open(p, 'rb').read()).hexdigest()
out = {
    "study": "Q2-PM: Q2's first live day (live-prep's Addendum 19, 2026-10-13 13:26 -> 10-14 01:59 UTC) against LP-BEST's engine line by line, the programmes' instability, and the candidates priced on the record (10-05 -> 10-12) and on live day 1; 2026-10-14",
    "review": "docs/agents/reviews/2026-10-14-q2-day1-postmortem.md",
    "database": "flmvxigozjuizpckllvk, read-only selects (sql/q2pm_live.sql): pm_lp_fills, pm_lp_markets, pm_lp_events, pm_lp_reward_days, pm_lp_settlements, pm_lp_minutes, pm_lp_orders, pm_rec_archive (signed URLs read from a saved reply, never printed or committed), pm_rec_markets, pm_prog_reads (its span only)",
    "public_reads": "the data API's /trades for 488 markets (2026-10-12 00:00 -> 10-14 02:00, apitape.py's fetch); the CLOB's /rewards/markets/{condition_id} for 96 markets (10-14 ~03:13 UTC)",
    "scripts": {f"scripts/{f}": sha(os.path.join(here, 'scripts', f)) for f in ('q2pm_data.py', 'q2pm.py', 'q2pm_manifest.py')},
    "sql": {"sql/q2pm_live.sql": sha(os.path.join(here, 'sql', 'q2pm_live.sql'))},
    "results": {f"results/{f}": sha(os.path.join(here, 'results', f)) for f in ('q2pm_check.txt', 'q2pm_live.txt', 'q2pm_run.txt', 'q2pm_prog.txt', 'q2pm_opt.txt')},
    "inputs_not_committed": {
        "Q2PM work (extract.py over every archive hour 10-04 19:00 -> 10-14 01:00; the day tables; the API tape merged)": {
            f: sha(os.path.join(work, f)) for f in ('meta.json', 'prints.pkl', 'prog.pkl', 'daytable_api.csv.gz', 'daytable14.csv.gz', 'daytable14_api.csv.gz',
                                                    'prints_api.pkl', 'live_orders.json.gz', 'calib.json', 'validate.json', 'rec_markets.json.gz')},
        "live record (sql/q2pm_live.sql's replies, unwrapped)": {f: sha(os.path.join(live, f)) for f in ('live_aux.json', 'live_minutes.json.gz', 'live_orders.json.gz')},
    },
    "run_order": [
        "python3 -I docs/agents/backtests/lpbest/scripts/fetch.py <saved reply of sql/q2pm_live.sql #4> <pmrec14 dir>",
        "python3 -I docs/agents/backtests/lpbest/scripts/extract.py <every books/prints/markets hour since 10-04> <every universe hour> <Q2PM work>",
        "python3 -I docs/agents/backtests/lpadverse/scripts/unwrap.py <each saved reply of sql/q2pm_live.sql #1-#3> <live dir>/...; the live orders' first 14 columns to <Q2PM work>/live_orders.json.gz; calib.json, validate.json, prints_api.pkl copied from Q2-AGE's 10-13 work; rec_markets.json.gz from sql/rec_markets.sql",
        "LPBEST_WORK=<Q2PM work> python3 -I docs/agents/backtests/lpbest/scripts/q2pm_data.py table",
        "LPBEST_WORK=<Q2PM work> Q2PM_AGE13=<Q2-AGE 10-13 work> Q2PM_LIVE=<live dir>/live_aux.json python3 -I docs/agents/backtests/lpbest/scripts/q2pm_data.py tape",
        "LPBEST_WORK=<Q2PM work> LPBEST_API_TAPE=1 python3 -I docs/agents/backtests/lpbest/scripts/q2pm_data.py table",
        "LPBEST_WORK=<Q2PM work> LPBEST_API_TAPE=1 Q2PM_LPBEST=<LP-BEST work> Q2PM_AGE13=<Q2-AGE 10-13 work> python3 -I docs/agents/backtests/lpbest/scripts/q2pm_data.py merge",
        "LPBEST_WORK=<Q2PM work> LPBEST_API_TAPE=1 Q2PM_LIVE=<live dir> python3 -I -W ignore docs/agents/backtests/lpbest/scripts/q2pm.py check|live|run|prog|opt > results/q2pm_<step>.txt (in that order: run reads live's json, opt reads run's)",
    ],
}
json.dump(out, open(os.path.join(here, 'MANIFEST_q2pm.json'), 'w'), indent=1)
print('MANIFEST_q2pm.json written')
