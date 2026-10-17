"""BUCKET-DIST universe from the complete months only. No network.

Reads the G1 scratch for 2024-01 through 2026-08. Does not read the September
partial or the October tail. Title ends on or after 2026-09-01 are left out
even if a row was stored under an earlier file.

A partition is one asset, one event title, one title_end. Its size is the
number of bucket rows in that partition before any clause, fee or tick drop.
Seven or more qualifies the partition. A row that then fails the clause,
the Close field, the pair, the fee schedule or the tick is kept in the file
with pull 0, and the partition still qualifies.

Only a headline row (title_end 2025-01-01 through 2026-08-31) with pull 1 is
fetched. 2024 is counted and not fetched. The bytes are written under
$PM_DATA, not into the repository.

usage: python3 -I docs/agents/backtests/pmstatarb/scripts/s2_prepare.py
       python3 -I docs/agents/backtests/pmstatarb/scripts/s2_prepare.py --self-test
"""
import csv
import json
import os
import sys
from collections import Counter

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import g1_lib  # noqa: E402
import g1_pull  # noqa: E402
import g2_time  # noqa: E402
import net  # noqa: E402

MIN_BUCKETS = 7
PAIR = {"BTC": "BTCUSDT", "ETH": "ETHUSDT"}
FIELDS = [
    "conditionId", "sample", "asset", "event_title", "question",
    "bound_lo", "bound_hi", "title_end", "payout_yes",
    "yes_token", "no_token", "tick", "fee_rate", "fee_exponent", "fees_enabled",
    "clause_ok", "pair", "field", "settlement_utc", "partition_n", "pull",
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


def _f(text):
    try:
        return float(text)
    except (TypeError, ValueError):
        return None


def _row(market, parsed):
    clause = g1_lib.parse_clause(market.get("description") or "")
    end = g2_time.settlement_end_utc(
        clause.get("end_et"), parsed["title_end"], clause.get("clause_ok", "0"))
    tick = market.get("orderPriceMinTickSize")
    return {
        "conditionId": parsed["conditionId"],
        "sample": _sample(parsed["title_end"]),
        "asset": parsed["asset"],
        "event_title": parsed["event_title"],
        "question": parsed["question"],
        "bound_lo": parsed["bound_lo"],
        "bound_hi": parsed["bound_hi"],
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
        "settlement_utc": "" if end is None else g2_time._iso(end),
        "partition_n": "",
        "pull": "0",
    }


def pull_ok(row):
    """Headline, a qualified partition, and a readable Close clause with a fee and a tick."""
    if row.get("sample") != "headline":
        return False
    try:
        n = int(row.get("partition_n") or "0")
    except ValueError:
        return False
    if n < MIN_BUCKETS:
        return False
    if row.get("clause_ok") != "1" or row.get("field") != "Close":
        return False
    if row.get("pair") != PAIR.get(row.get("asset")):
        return False
    if not row.get("settlement_utc"):
        return False
    if not row.get("bound_lo") and not row.get("bound_hi"):
        return False
    payout = _f(row.get("payout_yes"))
    if payout not in (0.0, 1.0):
        return False
    if row.get("fees_enabled") == "1" and (not row.get("fee_rate") or not row.get("fee_exponent")):
        return False
    tick = _f(row.get("tick"))
    if tick is None or tick <= 0:
        return False
    return True


def annotate(rows):
    """Count each partition before the clause drop, then mark pull."""
    counts = Counter((r["asset"], r["title_end"], r["event_title"]) for r in rows)
    for row in rows:
        n = counts[(row["asset"], row["title_end"], row["event_title"])]
        row["partition_n"] = str(n)
        row["pull"] = "1" if pull_ok(row) else "0"
    return rows


def load_rows():
    seen = set()
    rows = []
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
                    fam, parsed, _reason = g1_lib.parse_market(market)
                    if fam != "buckets":
                        continue
                    row = _row(market, parsed)
                    if not row["sample"]:
                        continue
                    rows.append(row)
    return seen, annotate(rows)


def universe_path():
    return os.path.join(net.DATA, "data", "bucket_s2_universe.csv")


def write_gap_mix():
    """Family mix of rows already on disk. The unretrieved tail has no rows."""
    lines = [
        "Gap diagnostic for BUCKET-DIST. Not a trade result and not a tuning input.",
        "September partial is id order up to the quarantined cursor. Markets after that id were not retrieved.",
        "Their family mix is unknown. A match between August and the retrieved September slice does not describe the hole.",
        "The September cursor is not sent again.",
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
    os.makedirs(g1_pull.RESULTS, exist_ok=True)
    with open(os.path.join(g1_pull.RESULTS, "s2_gap_mix.txt"), "w") as f:
        f.write(text)
    return text


def _blank():
    return {
        "conditionId": "x", "sample": "headline", "asset": "BTC", "event_title": "Bitcoin price on July 3?",
        "question": "between", "bound_lo": "52000", "bound_hi": "54000", "title_end": "2026-07-03",
        "payout_yes": "1", "yes_token": "", "no_token": "", "tick": "0.001",
        "fee_rate": "0.07", "fee_exponent": "1", "fees_enabled": "1",
        "clause_ok": "1", "pair": "BTCUSDT", "field": "Close",
        "settlement_utc": "2026-07-03T16:00:00Z", "partition_n": "", "pull": "0",
    }


def self_test():
    assert MIN_BUCKETS == 7
    assert _sample("2026-08-31") == "headline"
    assert _sample("2026-09-01") is None
    assert _sample("2024-06-01") == "y2024"
    assert _sample("") is None
    good = [_blank() for _ in range(7)]
    for i, row in enumerate(good):
        row["conditionId"] = str(i)
    good[0]["clause_ok"] = "0"
    good[0]["field"] = ""
    good[0]["settlement_utc"] = ""
    annotate(good)
    assert all(r["partition_n"] == "7" for r in good)
    assert good[0]["pull"] == "0"
    assert all(r["pull"] == "1" for r in good[1:])
    small = [_blank() for _ in range(6)]
    for i, row in enumerate(small):
        row["conditionId"] = "s" + str(i)
        row["title_end"] = "2026-07-04"
    annotate(small)
    assert all(r["pull"] == "0" and r["partition_n"] == "6" for r in small)
    wing = _blank()
    wing["sample"] = "y2024"
    wing["title_end"] = "2024-07-03"
    wing["partition_n"] = "11"
    assert not pull_ok(wing)
    missing_fee = _blank()
    missing_fee["partition_n"] = "7"
    missing_fee["fee_rate"] = ""
    assert not pull_ok(missing_fee)
    disabled = _blank()
    disabled["partition_n"] = "7"
    disabled["fees_enabled"] = "0"
    disabled["fee_rate"] = ""
    disabled["fee_exponent"] = ""
    assert pull_ok(disabled)
    bad_field = _blank()
    bad_field["partition_n"] = "7"
    bad_field["field"] = "High"
    assert not pull_ok(bad_field)
    bad_pair = _blank()
    bad_pair["partition_n"] = "7"
    bad_pair["pair"] = "ETHUSDT"
    assert not pull_ok(bad_pair)
    print("s2_prepare self-test ok")


def main():
    seen, rows = load_rows()
    path = universe_path()
    os.makedirs(os.path.dirname(path), exist_ok=True)
    rows.sort(key=lambda r: r["conditionId"])
    with open(path, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=FIELDS, lineterminator="\n")
        w.writeheader()
        for row in rows:
            w.writerow(row)
    parts = Counter((r["asset"], r["title_end"], r["event_title"]) for r in rows)
    qualified = sum(1 for n in parts.values() if n >= MIN_BUCKETS)
    lines = [
        f"candidates_read {len(seen)}",
        f"bucket_rows {len(rows)}",
        f"partitions {len(parts)}",
        f"partitions_at_least_{MIN_BUCKETS} {qualified}",
        f"pull {sum(1 for r in rows if r['pull'] == '1')}",
        "held out: title_end on or after 2026-09-01, and every September/October scratch file",
        "2024 is counted and not pulled",
        "partition size is the row count before the clause, fee and tick drop",
    ]
    by_sample = Counter(r["sample"] for r in rows)
    for key, n in sorted(by_sample.items()):
        lines.append(f"sample {key} {n}")
    reasons = Counter()
    for row in rows:
        if row["pull"] == "1":
            continue
        if row["sample"] != "headline":
            reasons["not_headline"] += 1
        elif int(row["partition_n"]) < MIN_BUCKETS:
            reasons["partition"] += 1
        elif row["clause_ok"] != "1" or row["field"] != "Close":
            reasons["clause"] += 1
        elif row["pair"] != PAIR.get(row["asset"]):
            reasons["pair"] += 1
        elif row["fees_enabled"] == "1" and (not row["fee_rate"] or not row["fee_exponent"]):
            reasons["fee"] += 1
        else:
            reasons["other"] += 1
    lines.append("not pulled")
    for key, n in sorted(reasons.items()):
        lines.append(f"  {key} {n}")
    text = "\n".join(lines) + "\n"
    os.makedirs(g1_pull.RESULTS, exist_ok=True)
    with open(os.path.join(g1_pull.RESULTS, "s2_universe_counts.txt"), "w") as f:
        f.write(text)
    print(text, end="", flush=True)
    print(f"universe {path}", flush=True)
    print(write_gap_mix(), end="", flush=True)


if __name__ == "__main__":
    if "--self-test" in sys.argv:
        self_test()
    else:
        main()
