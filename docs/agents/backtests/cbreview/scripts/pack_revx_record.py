"""Packs the two saved results of sql/export_revx_paper_record.sql into ../inputs/revx_paper_record.json.gz
({"prints": {book: "ms,price,qty,s,id;…"}, "minutes": {book: "minute_index,x,fair_u;…"}}): PR5's paper engine's own record (the Revolut X UK
prints it decided on, and each minute's GBP/USD and dollar fair), 2026-09-22 .. 2026-10-15.
usage: python3 -I pack_revx_record.py PRINTS_RESULT.txt MINUTES_RESULT.txt (each the tool's saved JSON)"""
import gzip, json, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def rows(path):
    raw = json.load(open(path))["result"]
    return {r["book"]: r["lines"] for r in json.loads(re.search(r"<untrusted-data-[^>]+>\n(.*)\n</untrusted-data", raw, re.S).group(1))}


def main(prints, minutes):
    out = {"prints": rows(prints), "minutes": rows(minutes)}
    dst = os.path.join(ROOT, "inputs", "revx_paper_record.json.gz")
    with gzip.GzipFile(dst, "wb", mtime=0) as g:
        g.write(json.dumps(out, sort_keys=True, separators=(",", ":")).encode())
    print({k: {b: v.count(";") + 1 for b, v in d.items()} for k, d in out.items()}, os.path.getsize(dst))


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
