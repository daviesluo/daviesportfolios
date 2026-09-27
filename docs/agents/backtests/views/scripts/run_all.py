"""VIEWS phase 1: every analysis, from the committed inputs, twice, with the sha256 of each result.

Run from the repository root. Each step writes its result under `results/`; the second run writes to a scratch copy
and must be byte-identical. `resolution.py` also reads the public comments pulled into $VIEWS_DATA/comments (not
committed; hashed in MANIFEST.json); every other step reads only committed files.

The pull steps (`universe_pull.py`, `prints_pull.py`, `history_pull.py`, `comments_pull.py`) and `inputs_build.py` are
not re-run here: they read the network or the raw pulls.

usage: python3 docs/agents/backtests/views/scripts/run_all.py [--once]
"""
import hashlib
import os
import subprocess
import sys
import tempfile

ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
S = os.path.join(ROOT, "scripts")
I = os.path.join(ROOT, "inputs")
R = os.path.join(ROOT, "results")
UNI, SPLIT = os.path.join(I, "universe.json.gz"), os.path.join(I, "split.json")


def steps(out):
    post = os.path.join(out, "posting.json")
    nt = os.path.join(out, "near_t.json")
    return [
        ("posting.json", ["posting.py", UNI, SPLIT, post]),
        ("noon_check.json", ["noon_check.py", UNI, post, os.path.join(out, "noon_check.json")]),
        ("near_t.json", ["near_t.py", UNI, SPLIT, post, nt]),
        ("stale_late.json", ["stale_late.py", UNI, SPLIT, post, os.path.join(out, "stale_late.json")]),
        ("calibration.json", ["calibration.py", UNI, SPLIT, post, os.path.join(out, "calibration.json")]),
        ("resolution.json", ["resolution.py", UNI, SPLIT, post, nt, os.path.join(out, "resolution.json")]),
        ("flips.json", ["flips.py", UNI, SPLIT, post, nt, os.path.join(out, "flips.json")]),
        ("timeline_2026-04-09_day5.txt", ["timeline.py", UNI, SPLIT, post, "of-views-of-mrbeast-video-day-5-125", "900", "600",
                                          "--bins", "--out", os.path.join(out, "timeline_2026-04-09_day5.txt")]),
        ("comments_evidence.json", ["comments_evidence.py", os.path.join(out, "comments_evidence.json")]),
        ("universe_table.json", ["universe_table.py", UNI, SPLIT, post, os.path.join(out, "universe_table.json")]),
        ("power.json", ["power.py", os.path.join(out, "universe_table.json"), nt, os.path.join(out, "stale_late.json"),
                        os.path.join(out, "power.json")]),
        ("publish_times_needed.json", ["publish_needed.py", os.path.join(out, "universe_table.json"),
                                       os.path.join(out, "publish_times_needed.json")]),
    ]


def sha(p):
    return hashlib.sha256(open(p, "rb").read()).hexdigest()


def run(out):
    env = dict(os.environ, PYTHONDONTWRITEBYTECODE="1")
    for name, (script, *args) in steps(out):
        subprocess.run([sys.executable, os.path.join(S, script), *args], check=True, env=env, stdout=subprocess.DEVNULL)
    return {name: sha(os.path.join(out, name)) for name, _ in steps(out)}


def main():
    first = run(R)
    for k, v in first.items():
        print(k, v)
    if "--once" in sys.argv:
        return
    with tempfile.TemporaryDirectory() as tmp:
        second = run(tmp)
    same = all(first[k] == second[k] for k in first)
    print("second run byte-identical:", same)
    if not same:
        raise SystemExit([k for k in first if first[k] != second[k]])


if __name__ == "__main__":
    main()
