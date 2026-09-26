"""Does `region=UK` return every UK print? For sample days, fetch the day WITHOUT the region filter, keep the rows labelled
UK, and compare their ids with the filtered pull's. Counts by region too. Never reads a price.
usage: region_check.py OUT.json"""
import json, os, sys, collections
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fetch as F

DAYS = ["2025-10-15", "2025-11-26", "2025-11-27", "2025-12-16", "2025-12-17", "2026-01-15", "2026-03-15", "2026-05-15",
        "2026-07-15", "2026-09-15"]


def filtered_ids(sym, a):
    ids = set()
    for line in open(os.path.join(F.D, "raw", f"{sym}.trades.pages.jsonl")):
        p = json.loads(line)
        if p["start_date"] == a:
            ids.update(r["id"] for r in p["data"] if r.get("region") == "UK")
    return ids


def unfiltered(sym, a):
    cursor, rows, pages = "", [], 0
    while True:
        url = f"{F.BASE}/trades/all?symbol={sym}&start_date={a}&end_date={a + F.DAY - 1}&limit=100" + (f"&cursor={cursor}" if cursor else "")
        st, d, _ = F.get_json(url)
        if st != 200 or not isinstance(d, dict):
            return None, pages
        rows += d["data"]
        pages += 1
        cursor = (d.get("metadata") or {}).get("next_cursor") or ""
        if not cursor or pages > 400:
            return rows, pages


out = {}
for sym in ("USDC-USD", "USDT-USD"):
    for day in DAYS:
        a = F.ms(day)
        rows, pages = unfiltered(sym, a)
        if rows is None:
            out[f"{sym} {day}"] = {"error": "fetch failed", "pages": pages}
            continue
        reg = collections.Counter(r.get("region") for r in rows)
        uk = {r["id"] for r in rows if r.get("region") == "UK"}
        fid = filtered_ids(sym, a)
        out[f"{sym} {day}"] = {"pages": pages, "rows_by_region": dict(reg), "uk_unfiltered": len(uk), "uk_filtered": len(fid),
                               "in_unfiltered_not_filtered": len(uk - fid), "in_filtered_not_unfiltered": len(fid - uk)}
        print(sym, day, out[f"{sym} {day}"], flush=True)
json.dump(out, open(sys.argv[1], "w"), indent=1, sort_keys=True)
