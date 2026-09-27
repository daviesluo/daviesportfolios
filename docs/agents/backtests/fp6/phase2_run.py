"""fp6 phase 2, the whole order of work in one command: check the inputs, run every scorer twice, apply Holm.

    python3 docs/agents/backtests/fp6/phase2_run.py --data <dir> --ext <dir> --ktape <dir>

1. phase2_inputs.py: every input against manifest.json, the fifteen tapes, the frozen files (a mismatch stops).
2. Each scorer runs twice; the sha256 of its output after each run must be the same (else stop).
   (Each scorer itself recomputes its phase-1 counts first and stops on a difference.)
3. holm.py, twice, the same way.
Writes phase2_runs.json (sorted keys, no clock) with every output's sha256.
"""

from __future__ import annotations

import hashlib
import json
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[3]
REL = "docs/agents/backtests/fp6"


def sha(p: Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()


def run(cmd: list[str]) -> None:
    res = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True)
    sys.stdout.write(res.stdout[-2000:])
    if res.returncode != 0:
        sys.stderr.write(res.stderr[-4000:])
        raise SystemExit(f"{' '.join(cmd[:4])} … failed: stop")


def main(argv: list[str]) -> int:
    args = dict(zip(argv[::2], argv[1::2]))
    tapes = ["--data", args["--data"], "--ext", args["--ext"], "--ktape", args["--ktape"]]
    run(["python3", f"{REL}/phase2_inputs.py", *tapes])
    jobs = [
        ("H2", ["python3", f"{REL}/score_carry.py", "h2"], "carry_quarterly.json"),
        ("H3", ["python3", f"{REL}/score_carry.py", "h3"], "carry_xs.json"),
        ("H4", ["npx", "--yes", "deno@1.46.3", "run", "--allow-read", "--allow-write", f"{REL}/score_trend_ls.ts", *tapes],
         "trend_ls.json"),
        ("H5", ["python3", f"{REL}/score_events.py", "h5"], "delist_short.json"),
        ("H6", ["python3", f"{REL}/score_events.py", "h6"], "listing_short.json"),
        ("Holm", ["python3", f"{REL}/holm.py"], "family.json"),
    ]
    out = {"inputs": {"file": "phase2_inputs.json", "sha256": sha(HERE / "phase2_inputs.json")}}
    for name, cmd, target in jobs:
        hashes = []
        for _ in range(2):
            run(cmd)
            hashes.append(sha(HERE / target))
        if hashes[0] != hashes[1]:
            raise SystemExit(f"{name}: two runs differ ({hashes}): stop")
        out[name] = {"file": target, "sha256": hashes[0], "runs": 2, "byteIdentical": True}
    (HERE / "phase2_runs.json").write_text(json.dumps(out, indent=1, sort_keys=True) + "\n")
    print(json.dumps(out, indent=1, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
