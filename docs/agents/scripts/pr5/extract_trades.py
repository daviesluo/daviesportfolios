"""Raw pages -> one sorted, de-duplicated print file per symbol, with an audit of what the pages held.

A print's identity is its `id`. Duplicates are expected only at the shared boundary millisecond of two day windows
(both bounds inclusive); any other duplicate, or a duplicate id whose fields differ, is reported.
Writes data/trades/<SYM>.jsonl (one print per line: id, ts, price, qty, side, region — price/qty kept as the
venue's strings) and results/extract_<SYM>.json (the audit).
usage: extract_trades.py SYM [SYM ...]
"""
import json, os, sys, collections, datetime, glob

S = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DAY = 86400000


def main():
    os.makedirs(os.path.join(S, "data", "trades"), exist_ok=True)
    for sym in sys.argv[1:]:
        # every puller's files for this symbol (the main one, and a tagged one that fetched the recent days first)
        pfiles = sorted(glob.glob(os.path.join(S, "data", "raw", f"{sym}.pages.jsonl")) + glob.glob(os.path.join(S, "data", "raw", f"{sym}.*.pages.jsonl")))
        dfiles = sorted(glob.glob(os.path.join(S, "data", "raw", f"{sym}.days.jsonl")) + glob.glob(os.path.join(S, "data", "raw", f"{sym}.*.days.jsonl")))
        pages = [json.loads(l) for fn in pfiles for l in open(fn)]
        days = [json.loads(l) for fn in dfiles for l in open(fn)]
        ok_days = {d["start_date"] for d in days if d["ok"]}
        # a day fetched twice (two pullers, or a retry after a partial failure) repeats every print of that day
        fetched = collections.Counter(p["start_date"] for p in pages if p["page"] == 0)
        refetched_days = sorted(k for k, v in fetched.items() if v > 1)
        bad_days = sorted({d["day"] for d in days if not d["ok"]} - {d["day"] for d in days if d["ok"]})
        seen, rows = {}, []
        dup_boundary = dup_other = dup_diff = outside = dup_refetch = 0
        refetched_days_set = set(refetched_days)
        sym_mismatch = 0
        for p in pages:
            a, b = p["start_date"], p["end_date"]
            for r in p["data"]:
                ts = int(r["timestamp"])
                if not (a <= ts <= b):
                    outside += 1
                if r.get("symbol") != sym.replace("-", "/"):
                    sym_mismatch += 1
                key = r["id"]
                rec = {"id": r["id"], "ts": ts, "price": r["price"], "qty": r["quantity"], "side": r["side"], "region": r.get("region")}
                if key in seen:
                    if seen[key] != rec:
                        dup_diff += 1
                    if ts % DAY == 0:
                        dup_boundary += 1
                    elif p["start_date"] in refetched_days_set:
                        dup_refetch += 1
                    else:
                        dup_other += 1
                    continue
                seen[key] = rec
                rows.append(rec)
        rows.sort(key=lambda x: (x["ts"], x["id"]))
        with open(os.path.join(S, "data", "trades", f"{sym}.jsonl"), "w") as f:
            for r in rows:
                f.write(json.dumps(r, sort_keys=True) + "\n")
        reg = collections.Counter(r["region"] for r in rows)
        side = collections.Counter(r["side"] for r in rows)
        per_day = collections.Counter(datetime.datetime.fromtimestamp(r["ts"] / 1000, datetime.timezone.utc).strftime("%Y-%m-%d") for r in rows)
        # same-timestamp groups (one aggressive order matching several resting orders)
        same_ts = collections.Counter(r["ts"] for r in rows)
        audit = {"symbol": sym, "pages": len(pages), "raw_rows": sum(len(p["data"]) for p in pages), "unique_prints": len(rows),
                 "dup_at_day_boundary": dup_boundary, "dup_from_days_fetched_twice": dup_refetch, "days_fetched_twice": len(refetched_days), "dup_elsewhere": dup_other, "dup_with_different_fields": dup_diff,
                 "rows_outside_request_window": outside, "symbol_mismatch": sym_mismatch,
                 "days_requested_ok": len(ok_days), "days_failed": bad_days,
                 "first": datetime.datetime.fromtimestamp(rows[0]["ts"] / 1000, datetime.timezone.utc).isoformat() if rows else None,
                 "last": datetime.datetime.fromtimestamp(rows[-1]["ts"] / 1000, datetime.timezone.utc).isoformat() if rows else None,
                 "regions": dict(reg), "sides": dict(side), "days_with_prints": len(per_day),
                 "max_prints_a_day": max(per_day.values()) if per_day else 0,
                 "timestamps_shared_by_2plus_prints": sum(1 for v in same_ts.values() if v > 1),
                 "max_pages_a_day": max((d["pages"] for d in days if d["ok"]), default=0)}
        json.dump(audit, open(os.path.join(S, "results", f"extract_{sym}.json"), "w"), indent=1, sort_keys=True)
        print(json.dumps(audit, sort_keys=True))


if __name__ == "__main__":
    main()
