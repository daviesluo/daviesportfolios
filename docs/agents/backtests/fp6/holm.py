"""fp6 phase 2, step 3: the Holm ladder, applied once, to the five p's as the scorers wrote them.

    python3 docs/agents/backtests/fp6/holm.py

The family prereg (2026-09-26-fp6-prereg-family.md): order the five p's from smallest to largest, p(1) <= … <= p(5);
the hypothesis with p(k) clears "beyond chance" when p(j) <= 0.05 / (6 - j) for every j <= k; the first p that fails
stops the ladder, and it and every larger p fail. Ties are ordered by the table's order (H2, H3, H4, H5, H6). A
hypothesis PASSES only when it clears its Holm step AND every other condition of its own bar.
Writes family.json (sorted keys, no clock).
"""

from __future__ import annotations

import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
TABLE = [
    ("H2", "carry_quarterly.json", "pBootstrap"),
    ("H3", "carry_xs.json", "pBootstrap"),
    ("H4", "trend_ls.json", "pForHolm"),
    ("H5", "delist_short.json", "pNull"),
    ("H6", "listing_short.json", "pNull"),
]


def main() -> int:
    rows = []
    for order, (h, name, key) in enumerate(TABLE):
        res = json.loads((HERE / name).read_text())
        rows.append({"hypothesis": h, "file": name, "p": res[key], "order": order,
                     "otherConditionsHold": res["passesOtherThanHolm"]})
    ladder = sorted(rows, key=lambda x: (x["p"], x["order"]))
    stopped = False
    for j, row in enumerate(ladder, start=1):
        threshold = 0.05 / (6 - j)
        row["step"] = j
        row["threshold"] = round(threshold, 6)
        row["clearsHolm"] = (not stopped) and row["p"] <= threshold
        if not row["clearsHolm"]:
            stopped = True
        row["passes"] = row["clearsHolm"] and row["otherConditionsHold"]
    out = {"ladder": ladder, "passes": [x["hypothesis"] for x in ladder if x["passes"]],
           "rule": "p(j) <= 0.05 / (6 - j) for every j <= k; ties in the table's order"}
    (HERE / "family.json").write_text(json.dumps(out, indent=1, sort_keys=True) + "\n")
    for x in ladder:
        print(f"step {x['step']}: {x['hypothesis']} p {x['p']} vs {x['threshold']} -> clears {x['clearsHolm']}; "
              f"other conditions {x['otherConditionsHold']}; PASS {x['passes']}")
    print("passes:", out["passes"] or "none")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
