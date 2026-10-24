"""QUEUE "Data" item 1, decoding: read each saved page reply (`sql/book_pages.sql`, statement A) in <data>/pages/, drop the
line breaks Postgres puts into base64, decode the page, check its sha256 and byte length against the ones returned beside
it and its line count against n, and join the pages in (book, ts) order, one row a line, into
<data>/book_levels.jsonl.gz (gzip -n), whose sha256 is printed with the counts. "Complete": the pages' n of each book must
add up to the count statement B saved as <data>/pages/count.json. No decoded row is ever shown. Written 2026-10-24.

    python3 -I docs/agents/backtests/queue/scripts/decode_pages.py <data>
"""
import base64, glob, gzip, hashlib, json, os, re, sys


def rows_of(path):
    raw = open(path).read()
    try:
        outer = json.loads(raw)
        if isinstance(outer, dict) and "result" in outer:
            raw = outer["result"]
        elif isinstance(outer, list) and outer and isinstance(outer[0], dict) and "text" in outer[0]:
            raw = outer[0]["text"]
    except Exception:  # noqa: BLE001
        pass
    s, e = raw.index("[{"), raw.rindex("}]") + 2
    return json.loads(raw[s:e])


def decode(data):
    pages = {}
    for path in sorted(glob.glob(os.path.join(data, "pages", "*.json"))):
        name = os.path.basename(path)[:-5]
        if name == "count":
            continue
        m = re.match(r"^(USD[CT]-(?:USD|GBP))_(\d{4}-\d{2}-\d{2}(?:T\d{2})?)$", name)
        if not m:
            raise SystemExit(f"{name}: not <BOOK>_<DAY>[T<HH>]")
        r = rows_of(path)[0]
        body = base64.b64decode("".join(str(r["page"] or "").split()))
        if hashlib.sha256(body).hexdigest() != r["sha256"] or len(body) != int(r["bytes"]):
            raise SystemExit(f"{name}: the decoded page is not the one the database hashed")
        lines = body.decode("utf-8").split("\n") if body else []
        if len(lines) != int(r["n"]):
            raise SystemExit(f"{name}: {len(lines)} lines, n = {r['n']}")
        pages[(m.group(1), m.group(2))] = lines
    count = {x["book"]: int(x["n"]) for x in rows_of(os.path.join(data, "pages", "count.json"))}
    have = {}
    for (b, _), ls in pages.items():
        have[b] = have.get(b, 0) + len(ls)
    if have != count:
        raise SystemExit(f"not complete: pages {have}, count {count}: take the export again")
    allrows = []
    for (b, _), ls in sorted(pages.items()):
        for line in ls:
            allrows.append((b, json.loads(line)["ts"], line))
    allrows.sort(key=lambda z: (z[0], z[1]))
    out = os.path.join(data, "book_levels.jsonl.gz")
    with open(out, "wb") as f:
        with gzip.GzipFile(fileobj=f, mode="wb", mtime=0, filename="") as g:
            g.write(("\n".join(z[2] for z in allrows) + "\n").encode("utf-8"))
    return {"pages": len(pages), "rows": count, "sha256": hashlib.sha256(open(out, "rb").read()).hexdigest()}


if __name__ == "__main__":
    print(json.dumps(decode(sys.argv[1]), sort_keys=True))
