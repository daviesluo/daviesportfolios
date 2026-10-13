# LP-BEST: write MANIFEST.json (inputs, run order, seeds, sha256 of every committed file).
#   python3 -I docs/agents/backtests/lpbest/scripts/manifest.py
import hashlib, json, os
HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(HERE))))
def sha(p): return hashlib.sha256(open(p, 'rb').read()).hexdigest()
files = {}
for sub in ('sql', 'scripts', 'results'):
    for f in sorted(os.listdir(os.path.join(HERE, sub))):
        if f.endswith('.pyc') or f == '__pycache__': continue
        files[f"{sub}/{f}"] = sha(os.path.join(HERE, sub, f))
code = {p: sha(os.path.join(ROOT, 'supabase/functions/agents', p)) for p in ('pm_lp.ts', 'pm_live.ts', 'pmrw.ts')}
m = {
  "study": "LP-BEST: the best Polymarket reward strategy on every record (live, paper, the pm-rec universe), one simulator calibrated and validated on live, every structural idea priced, the best candidate chosen on TRAIN and read on TEST, 2026-10-13",
  "review": "docs/agents/reviews/2026-10-13-lp-best-strategy.md",
  "code_read": dict(code, commit="f55e67a2 (origin/main at the start)"),
  "database": "flmvxigozjuizpckllvk, read-only selects, 2026-10-13 00:10-00:55 UTC",
  "public_reads": "Polymarket's keyless data API (/trades?market=<condition>, scripts/tapecheck.py) and docs.polymarket.com/market-makers/liquidity-rewards (the scoring rule, read 2026-10-13)",
  "inputs_not_committed": {
    "pm-rec archive": "every books, prints and universe object of pm_rec_archive (2026-10-04 19:00 -> 2026-10-12 23:00, 197 hours a kind) and the ten daily markets dumps; the books/prints to 21:00 are LP-ADVERSE's download, the rest fetched by scripts/fetch.py from sql/archive_urls.sql's reply (signed URLs read from the saved reply, never printed or committed); every object's sha256 matched pm_rec_archive.sha256",
    "replies": "sql/live_orders.sql -> live_orders.json.gz, sql/live_reward_days.sql -> live_rd.json, sql/rec_markets.sql -> rec_markets.json.gz (LP-ADVERSE's scripts/unwrap.py turns each saved reply into JSON), in LPBEST_WORK; LP-ADVERSE's own replies (live_fills.json, live_aux.json, lm_1009..1012.json.gz, paper.json) are read from its scratch folder (LPADV_WORK), made by docs/agents/backtests/lpadverse/sql/*.sql",
    "derived": "extract.py's mk/<id>.npz, prints.pkl, prog.pkl, meta.json; calib.json, validate.json, daytable.csv.gz, choose_lo.json and the other run outputs, all in LPBEST_WORK"
  },
  "run_order": [
    "python3 -I docs/agents/backtests/lpbest/scripts/fetch.py <saved reply of sql/archive_urls.sql> <pmrec dir | pmrec universe dir>",
    "python3 -I docs/agents/backtests/lpbest/scripts/extract.py <pmrec dir> <pmrec universe dir> <WORK> > results/extract.txt",
    "LPBEST_WORK=<WORK> LPADV_WORK=<LPADV> python3 -I docs/agents/backtests/lpbest/scripts/calib.py > results/calib.txt",
    "LPBEST_WORK=<WORK> LPADV_WORK=<LPADV> python3 -I docs/agents/backtests/lpbest/scripts/validate.py > results/validate.txt",
    "LPBEST_WORK=<WORK> python3 -I docs/agents/backtests/lpbest/scripts/daytable.py",
    "LPBEST_WORK=<WORK> python3 -I docs/agents/backtests/lpbest/scripts/analysis.py > results/universe.txt",
    "LPBEST_WORK=<WORK> python3 -I docs/agents/backtests/lpbest/scripts/search.py > results/search.txt",
    "LPBEST_WORK=<WORK> python3 -I docs/agents/backtests/lpbest/scripts/runs.py base > results/runs_base.txt",
    "LPBEST_WORK=<WORK> python3 -I docs/agents/backtests/lpbest/scripts/runs.py quiet > results/runs_quiet.txt",
    "LPBEST_WORK=<WORK> LPBEST_CHOOSE_BY=per_day python3 -I docs/agents/backtests/lpbest/scripts/choose.py > results/choose_by_mean.txt",
    "LPBEST_WORK=<WORK> python3 -I docs/agents/backtests/lpbest/scripts/choose.py > results/choose.txt",
    "LPBEST_WORK=<WORK> python3 -I docs/agents/backtests/lpbest/scripts/detail.py > results/detail.txt",
    "LPBEST_WORK=<WORK> LPADV_WORK=<LPADV> python3 -I docs/agents/backtests/lpbest/scripts/ranking.py > results/ranking.txt",
    "LPBEST_WORK=<WORK> LPADV_WORK=<LPADV> python3 -I docs/agents/backtests/lpbest/scripts/merge.py > results/merge.txt",
    "LPBEST_WORK=<WORK> python3 -I docs/agents/backtests/lpbest/scripts/proxy.py > results/proxy.txt",
    "LPBEST_WORK=<WORK> python3 -I docs/agents/backtests/lpbest/scripts/apitape.py   (prints_api.pkl: the data API's tape for every quiet-rule candidate)",
    "LPBEST_WORK=<WORK> python3 -I docs/agents/backtests/lpbest/scripts/tapecheck.py > results/tapecheck.txt",
    "then with LPBEST_API_TAPE=1 (quietness read from the data API's tape, the outputs suffixed _api): daytable.py; analysis.py > results/universe_api.txt; search.py > results/search_api.txt; LPBEST_CHOOSE_BY=per_day choose.py > results/choose_by_mean_api.txt; choose.py > results/choose_api.txt; detail.py > results/detail_api.txt; ranking.py > results/ranking_api.txt; proxy.py > results/proxy_api.txt",
    "python3 -I docs/agents/backtests/lpbest/scripts/manifest.py"
  ],
  "seeds": {"bootstrap": 20261013, "tapecheck sample": 20261013},
  "sha256": files,
}
json.dump(m, open(os.path.join(HERE, 'MANIFEST.json'), 'w'), indent=2)
print(len(files), 'files')
