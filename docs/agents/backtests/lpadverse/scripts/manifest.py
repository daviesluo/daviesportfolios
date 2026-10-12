# LP-ADVERSE: write MANIFEST.json (inputs, how each output is made, sha256 of every committed file).
#   python3 -I docs/agents/backtests/lpadverse/scripts/manifest.py
import hashlib, json, os
HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
def sha(p): return hashlib.sha256(open(p, 'rb').read()).hexdigest()
files = {}
for sub in ('sql', 'scripts', 'data', 'results'):
    for f in sorted(os.listdir(os.path.join(HERE, sub))):
        if f.endswith('.pyc') or f == '__pycache__': continue
        files[f"{sub}/{f}"] = sha(os.path.join(HERE, sub, f))
m = {
  "study": "LP-ADVERSE: adverse selection on live-prep's live fills, live against paper, and rule changes priced on the live and paper records, 2026-10-12",
  "review": "docs/agents/reviews/2026-10-12-lp-adverse-selection.md",
  "code_read": {"commit": "787d878a", "pm_lp.ts": "53f7f788a47e93f52770f96410db9faf8f34cdd7dc2cf4ddbd877c9038d07278 (Addendum 18)",
                "pm_live.ts": "ee96ba0e40e38ac9999f78028470cc8713584cf05c45539f265eca76c2d3667d (Addendum 18)", "pmrw.ts": "f2bb5943dacb094d2c90cea91893cc5ec7e301874ebe6f420c9a7fb8278dd7f2"},
  "database": "flmvxigozjuizpckllvk, read-only selects, 2026-10-12 23:03-23:15 UTC",
  "inputs_not_committed": {
    "pm-rec archive": "every books and prints object of pm_rec_archive (2026-10-04 19:00 -> 2026-10-12 21:00 hours, 195 each) and the markets dumps, downloaded by their signed URLs (read with SQL, never printed or committed) into a scratch folder; every object's sha256 matched pm_rec_archive.sha256",
    "replies": "each sql/*.sql reply saved by the connector and turned into JSON by scripts/unwrap.py in the scratch folder (LPADV_WORK): live_fills.json, live_aux.json, lm_1009..1012.json.gz (live_minutes.sql per day), targets.json, paper.json, rwc_1008..1012.json.gz and lpp_a/b/c.json.gz (paper_minutes.sql per day; lpp_a = 10-04..10-06, lpp_b = 10-07, lpp_c = 10-08..10-09)"
  },
  "run_order": [
    "python3 -I docs/agents/backtests/lpadverse/scripts/extract_books.py <pmrec dir> <WORK>/targets.json <WORK>/books.pkl",
    "LPADV_WORK=<WORK> python3 -I docs/agents/backtests/lpadverse/scripts/build.py   (data/fills.csv)",
    "LPADV_WORK=<WORK> python3 -I docs/agents/backtests/lpadverse/scripts/pnl.py > results/pnl.txt",
    "LPADV_WORK=<WORK> python3 -I docs/agents/backtests/lpadverse/scripts/markouts.py > results/markouts.txt",
    "LPADV_WORK=<WORK> python3 -I docs/agents/backtests/lpadverse/scripts/decompose.py > results/decompose.txt",
    "LPADV_WORK=<WORK> python3 -I docs/agents/backtests/lpadverse/scripts/paper_vs_live.py > results/paper_vs_live.txt",
    "LPADV_WORK=<WORK> python3 -I docs/agents/backtests/lpadverse/scripts/rewards.py > results/rewards.txt",
    "LPADV_WORK=<WORK> python3 -I -u docs/agents/backtests/lpadverse/scripts/rules.py > results/rules.txt",
    "LPADV_WORK=<WORK> python3 -I -u docs/agents/backtests/lpadverse/scripts/rules_paper.py > results/rules_paper.txt",
    "python3 -I docs/agents/backtests/lpadverse/scripts/manifest.py"
  ],
  "seeds": {"bootstrap": 20261012},
  "sha256": files,
}
json.dump(m, open(os.path.join(HERE, 'MANIFEST.json'), 'w'), indent=2)
print(len(files), 'files')
