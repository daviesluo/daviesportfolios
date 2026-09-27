"""SPEED: copy PMLATE's post-count exploration inputs into this study's data folder (read-only on PMLATE's).

The post-count family was measured whole in PMLATE's phase 1 (`results/phase1_counts.json`: every event of seven
smaller series and a sample of Elon's) and registers nothing, so none of it is a held-out period. This copies the
universe file, each walked event's prints, its rules text and the tracker's post lists the measurement read.

usage: copy_counts.py <PMLATE data folder> <SPEED data folder>
"""
import os
import shutil
import sys


def main():
    src, dst = os.path.join(sys.argv[1], "count"), os.path.join(sys.argv[2], "count")
    n = {}
    for sub in ("prints", "desc", "xt"):
        os.makedirs(os.path.join(dst, sub), exist_ok=True)
        k = 0
        for name in sorted(os.listdir(os.path.join(src, sub))):
            if name.endswith(".gz"):
                shutil.copyfile(os.path.join(src, sub, name), os.path.join(dst, sub, name))
                k += 1
        n[sub] = k
    uni = "universe_2025-09-26_2026-09-27.json.gz"
    shutil.copyfile(os.path.join(src, uni), os.path.join(dst, uni))
    print(n)


if __name__ == "__main__":
    main()
