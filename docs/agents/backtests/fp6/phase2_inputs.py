"""fp6 phase 2, step 1 of the family's "Order of work": every input checked before anything is priced.

    python3 docs/agents/backtests/fp6/phase2_inputs.py --data <dir> --ext <dir> --ktape <dir>

* Every file `manifest.json` lists under `inputs` must be on disk in `inputs/` with the sha256 the manifest recorded
  when phase 1 pulled it (the three largest were never committed; they stay where phase 1 wrote them, or `fetch.py`
  pulls them again, and either way they must match).
* The fifteen house tapes H4 reads (`--data`, `--ext`, `--ktape`, as `trend_ls.ts` and `backtest_jev.ts
  loadMeasuredSeries` take them) must match the sha256s under `sources.tapes` (and so the ones H4's prereg prints).
* The frozen documents and decision code are hashed and must match the commit that froze them on `main`
  (`d856fd2e`): the six pre-registration files, `rules.py` and `trend_ls.ts`.

A mismatch stops everything (exit 1) and is reported. Writes `phase2_inputs.json` (sorted keys, no clock).
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import vision as V  # noqa: E402

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[3]
REVIEWS = ROOT / "docs" / "agents" / "reviews"

# The files as frozen on main by d856fd2e (sha256 of the bytes in that commit).
FROZEN = {
    "docs/agents/reviews/2026-09-26-fp6-prereg-family.md": "e972968af1a5493df59f4b98d53e93fad0f05e850fa4b6978e84b8857cf93cef",
    "docs/agents/reviews/2026-09-26-fp6-prereg-carry-quarterly.md": "387f133226df0371d0d144f27aa3d614d405f5f9f85ab6973ee37a6cd893be29",
    "docs/agents/reviews/2026-09-26-fp6-prereg-carry-xs.md": "ab61cf7bc1ab3061e33625e05c707cbf574b53cb91d4e1d6d088044e4707ee1b",
    "docs/agents/reviews/2026-09-26-fp6-prereg-trend-ls.md": "9251145e63edb3cc1026007138272ef4f61eebc5f9d1b2cdffeb30d16ddab317",
    "docs/agents/reviews/2026-09-26-fp6-prereg-delist-short.md": "dbcd8b6e967c69087bbeb3200ed9331da582afe42f92af83455bd1347fb6ddc6",
    "docs/agents/reviews/2026-09-26-fp6-prereg-listing-short.md": "70b9ff4cabdd7146b999a9e255ea1fdfa6cdee24b689a60b6a377ef323960bbe",
    "docs/agents/backtests/fp6/rules.py": "89fad439a015f5b6722861a71d925a2817cfd7110b4c1094fe0d350179ea296a",
    "docs/agents/backtests/fp6/trend_ls.ts": "37fdb9c93d07296100f872be284d9f119c6122cc8683f1f5c309e204435ea9cc",
    "docs/agents/backtests/fp6/measurements.json": "e94488462d1f3169b7006ea02c88f154ae79b38e59f3be91e231e0b59fc1ba7a",
    "docs/agents/backtests/fp6/trend_ls_counts.json": "fe966d60e4ce9f909430ffa300efa7771d849c7fc111628fa2baff7c44ed8c40",
}


def main(argv: list[str]) -> int:
    args = dict(zip(argv[::2], argv[1::2]))
    manifest = json.loads((HERE / "manifest.json").read_text())
    out: dict = {"inputs": {}, "tapes": {}, "frozen": {}, "mismatches": []}
    for name, row in sorted(manifest["inputs"].items()):
        on_disk = V.sha256_file(HERE / "inputs" / name)
        out["inputs"][name] = {"manifest": row["sha256"], "onDisk": on_disk, "match": on_disk == row["sha256"]}
        if on_disk != row["sha256"]:
            out["mismatches"].append(f"inputs/{name}")
    tapes = {k: v for k, v in manifest["sources"]["tapes"].items() if k != "note"}
    dirs = {"_1h_3y.json": args.get("--data"), "_1h_kraken.json": args.get("--ext"), "_4h_kraken.json": args.get("--ktape")}
    for name, want in sorted(tapes.items()):
        d = next(v for k, v in dirs.items() if name.endswith(k))
        if d is None:
            raise SystemExit("pass --data, --ext and --ktape")
        got = V.sha256_file(Path(d) / name)
        out["tapes"][name] = {"manifest": want, "onDisk": got, "match": got == want}
        if got != want:
            out["mismatches"].append(f"tape {name}")
    for rel, want in sorted(FROZEN.items()):
        got = V.sha256_file(ROOT / rel)
        out["frozen"][rel] = {"frozen": want, "onDisk": got, "match": got == want}
        if got != want:
            out["mismatches"].append(rel)
    out["allMatch"] = not out["mismatches"]
    (HERE / "phase2_inputs.json").write_text(json.dumps(out, indent=1, sort_keys=True) + "\n")
    print(f"inputs {sum(v['match'] for v in out['inputs'].values())}/{len(out['inputs'])}, "
          f"tapes {sum(v['match'] for v in out['tapes'].values())}/{len(out['tapes'])}, "
          f"frozen {sum(v['match'] for v in out['frozen'].values())}/{len(out['frozen'])}; mismatches {out['mismatches']}")
    return 0 if out["allMatch"] else 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
