"""Packs the two saved results of sql/export_lit_lines_1012_1014.sql into ../inputs/lit_lines_1012_1014.json.gz ({book: lines}, the
two chunks joined with ';'). usage: python3 -I pack_lines_1014.py RESULT_A.txt RESULT_B.txt (each the tool's saved JSON)."""
import gzip, json, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def rows(path):
    raw = json.load(open(path))["result"]
    return {r["book"]: r["lines"] for r in json.loads(re.search(r"<untrusted-data-[^>]+>\n(.*)\n</untrusted-data", raw, re.S).group(1))}


def main(a, b):
    ra, rb = rows(a), rows(b)
    out = {k: ra[k] + ";" + rb[k] for k in sorted(ra)}
    dst = os.path.join(ROOT, "inputs", "lit_lines_1012_1014.json.gz")
    with gzip.GzipFile(dst, "wb", mtime=0) as g:
        g.write(json.dumps(out, sort_keys=True, separators=(",", ":")).encode())
    print({k: v.count(";") + 1 for k, v in out.items()}, os.path.getsize(dst))


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
