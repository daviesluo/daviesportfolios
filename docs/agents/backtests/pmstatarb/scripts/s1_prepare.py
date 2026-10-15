"""TOUCH-CAL universe from the complete months only. No network.

Reads the G1 scratch for 2024-01 through 2026-08. Does not read the September
partial or the October tail: those stay out of sample. Title ends on or after
2026-09-01 are left out even if a row was stored under an earlier file.

Headline sample is title_end 2025-01-01 through 2026-08-31. 2024 is written
beside it and is not part of the headline bar. Thresholds are not set here.

usage: python3 -I docs/agents/backtests/pmstatarb/scripts/s1_prepare.py
"""
import json
import os
import sys
from collections import Counter

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import g1_lib  # noqa: E402
import g1_pull  # noqa: E402
import g2_time  # noqa: E402

TOUCH = ("daily_reach", "daily_dip", "weekly_reach", "weekly_dip")
FIELDS = [
    "conditionId", "sample", "family", "asset", "type", "strike", "title_start", "title_end",
    "payout_yes", "yes_token", "no_token", "tick", "fee_rate", "fee_exponent", "fees_enabled",
    "clause_ok", "pair", "field", "end_et", "settlement_utc", "question",
]


def _months():
    """Complete windows only. 2026-09 and 2026-10-tail are after the cut."""
    return [w for w in g1_pull.WINDOWS if w[0] <= "2026-08"]


def _files(name):
    paths = []
    for suffix in (".jsonl", ".alt.jsonl", ".p60.jsonl"):
        path = os.path.join(g1_pull.SCRATCH, name + suffix)
        if os.path.exists(path):
            paths.append(path)
    return paths


def _no_token(market):
    outcomes = g1_lib.loads(market.get("outcomes"), [])
    ids = g1_lib.loads(market.get("clobTokenIds"), [])
    try:
        i = [str(o).lower() for o in outcomes].index("no")
    except ValueError:
        return ""
    if i >= len(ids):
        return ""
    return str(ids[i])


def _sample(title_end):
    if not title_end or title_end >= "2026-09-01":
        return None
    if title_end >= "2025-01-01":
        return "headline"
    if title_end >= "2024-01-01":
        return "y2024"
    return None


def _row(market, fam, parsed):
    clause = g1_lib.parse_clause(market.get("description") or "")
    end = g2_time.settlement_end_utc(clause.get("end_et"), parsed["title_end"], clause.get("clause_ok", "0"))
    tick = market.get("orderPriceMinTickSize")
    return {
        "conditionId": parsed["conditionId"],
        "sample": _sample(parsed["title_end"]),
        "family": fam,
        "asset": parsed["asset"],
        "type": parsed["type"],
        "strike": parsed["strike"],
        "title_start": parsed["title_start"],
        "title_end": parsed["title_end"],
        "payout_yes": parsed["payout_yes"],
        "yes_token": parsed["clobTokenIds_yes"],
        "no_token": _no_token(market),
        "tick": "" if tick is None else str(tick),
        "fee_rate": g1_pull.fee_rate(market),
        "fee_exponent": g1_pull.fee_exponent(market),
        "fees_enabled": "1" if market.get("feesEnabled") else "0",
        "clause_ok": clause.get("clause_ok", "0"),
        "pair": clause.get("pair", ""),
        "field": clause.get("field", ""),
        "end_et": clause.get("end_et", ""),
        "settlement_utc": "" if end is None else g2_time._iso(end),
        "question": parsed["question"],
    }


def load_parsed():
    seen = set()
    buckets = {name: [] for name in g1_lib.FAMILIES}
    unparsed = []
    reasons = Counter()
    touch = []
    for name, _, _ in _months():
        for path in _files(name):
            with open(path) as f:
                for line in f:
                    if not line.strip():
                        continue
                    market = json.loads(line)
                    cid = market.get("conditionId")
                    if not cid or cid in seen:
                        continue
                    seen.add(cid)
                    fam, parsed, reason = g1_lib.parse_market(market)
                    if fam == "unparsed":
                        parsed = dict(parsed)
                        parsed["reason"] = reason
                        unparsed.append(parsed)
                        reasons[reason] += 1
                        continue
                    buckets[fam].append(parsed)
                    if fam in TOUCH:
                        row = _row(market, fam, parsed)
                        if row["sample"]:
                            touch.append(row)
    return seen, buckets, unparsed, reasons, touch


def write_gap_mix():
    """Family mix of rows already on disk. The unretrieved tail has no rows."""
    lines = [
        "Gap diagnostic. Not part of the TOUCH-CAL sample.",
        "September partial is id order up to the quarantined cursor. Markets after that id were not retrieved.",
        "Their family mix is unknown. A match between August and the retrieved September slice does not describe the hole.",
    ]
    specs = (
        ("2026-08 complete", os.path.join(g1_pull.SCRATCH, "2026-08.p60.jsonl")),
        ("2026-09 retrieved partial", os.path.join(g1_pull.SCRATCH, "2026-09.p60.jsonl.partial")),
    )
    for label, path in specs:
        fams, months = Counter(), Counter()
        n = 0
        if os.path.exists(path):
            with open(path) as f:
                for line in f:
                    if not line.strip():
                        continue
                    market = json.loads(line)
                    n += 1
                    fam, parsed, reason = g1_lib.parse_market(market)
                    fams[fam if fam != "unparsed" else "unparsed:" + reason] += 1
                    months[(parsed.get("title_end") or "")[:7]] += 1
        lines.append(f"{label} rows {n}")
        for key, count in sorted(fams.items()):
            lines.append(f"  {key} {count}")
        lines.append("  title_end month")
        for key, count in sorted(months.items()):
            lines.append(f"  {key or '(none)'} {count}")
    stop = os.path.join(g1_pull.SCRATCH, "2026-09.gap.txt")
    lines.append("september stop")
    if os.path.exists(stop):
        lines.extend(open(stop).read().rstrip("\n").splitlines())
    else:
        lines.append("2026-09.gap.txt is not on this machine")
    text = "\n".join(lines) + "\n"
    with open(os.path.join(g1_pull.RESULTS, "g1_gap_mix.txt"), "w") as f:
        f.write(text)
    return text


def main():
    os.makedirs(g1_pull.DATA, exist_ok=True)
    os.makedirs(g1_pull.RESULTS, exist_ok=True)
    seen, buckets, unparsed, reasons, touch = load_parsed()
    for name, rows in buckets.items():
        g1_lib.write_csv(os.path.join(g1_pull.DATA, name + ".csv"), rows)
    unparsed_cols = g1_lib.COLUMNS + ["reason"]
    import csv
    with open(os.path.join(g1_pull.DATA, "unparsed.csv"), "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=unparsed_cols, lineterminator="\n", extrasaction="ignore")
        w.writeheader()
        for row in sorted(unparsed, key=lambda r: r["conditionId"]):
            w.writerow(row)
    touch.sort(key=lambda r: r["conditionId"])
    with open(os.path.join(g1_pull.DATA, "touch_s1_universe.csv"), "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=FIELDS, lineterminator="\n", extrasaction="ignore")
        w.writeheader()
        for row in touch:
            w.writerow(row)
    counts = Counter((r["sample"], r["family"], r["clause_ok"], r["fees_enabled"]) for r in touch)
    lines = [f"candidates_read {len(seen)}", f"touch_rows {len(touch)}", f"unparsed {len(unparsed)}"]
    for reason, n in reasons.most_common():
        lines.append(f"unparsed.{reason} {n}")
    for name in g1_lib.FAMILIES:
        lines.append(f"family {name} {len(buckets[name])}")
    lines.append("touch sample family clause_ok fees_enabled count")
    for key, n in sorted(counts.items()):
        lines.append(" ".join(key) + f" {n}")
    ready = sum(1 for r in touch if r["sample"] == "headline" and r["clause_ok"] == "1" and r["settlement_utc"])
    beside = sum(1 for r in touch if r["sample"] == "y2024" and r["clause_ok"] == "1" and r["settlement_utc"])
    lines.append(f"headline_with_settlement {ready}")
    lines.append(f"y2024_with_settlement {beside}")
    lines.append("held out: title_end on or after 2026-09-01, and every September/October scratch file")
    by_month = Counter((r["title_end"] or "")[:7] for r in touch if r["sample"] == "headline")
    lines.append("headline title_end month")
    for key, n in sorted(by_month.items()):
        lines.append(f"  {key or '(none)'} {n}")
    may_rows = [r for r in touch if (r["title_end"] or "").startswith("2026-05")]
    lines.append(f"title_end_2026-05 {len(may_rows)}")
    may_fam = Counter(r["family"] for r in may_rows)
    for key, n in sorted(may_fam.items()):
        lines.append(f"  2026-05 {key} {n}")
    text = "\n".join(lines) + "\n"
    with open(os.path.join(g1_pull.RESULTS, "s1_universe_counts.txt"), "w") as f:
        f.write(text)
    print(text, end="", flush=True)
    print(write_gap_mix(), end="", flush=True)


if __name__ == "__main__":
    main()
