"""Confirm the 2023 basket files this screen reads. No download.

    python3 docs/agents/scripts/fp14/fetch.py
"""

from __future__ import annotations

import importlib.util
import os
import sys
from pathlib import Path

_SPEC = importlib.util.spec_from_file_location(
    "fp5_common",
    Path(__file__).resolve().parents[1] / "fp5" / "common.py",
)
fp5 = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(fp5)


def main() -> None:
    if os.environ.get("FP14_OOS"):
        raise SystemExit("this fetcher is the 2023 screen")
    root = Path(os.environ.get("FP5_DATA", "/tmp/fp5/data")) / "spot8h"
    missing = [coin for coin in fp5.BASKET if not (root / f"{coin}.json").is_file()]
    if missing:
        raise SystemExit(f"missing screen files: {missing}")
    print(f"fp14 screen files present: {len(fp5.BASKET)}")


if __name__ == "__main__":
    main()
