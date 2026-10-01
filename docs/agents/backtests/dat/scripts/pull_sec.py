"""DAT study: keyless pull of one company's SEC EDGAR filings in a date range.

Fetches the submissions index (the recent file and every older file), keeps 8-K, 10-Q, 10-K and their amendments
filed in [FROM, TO], and caches each filing's primary document gzipped under ../inputs/sec/<CIK>/ (mtime 0, so a
re-pull of the same bytes is byte-identical). Writes ../inputs/sec/<CIK>/filings_<FROM>_<TO>.json: one row per
filing with its form, filing date, acceptance time (UTC), items, accession number, document name, URL and the
sha256 of the document as served. Filing text and metadata only: no price or return is read.

The User-Agent names the study and carries no e-mail address (SEC answered 200 to it on 2026-10-01); set
SEC_USER_AGENT to override it. Never put a personal address in it.

Usage (from the repository root or anywhere):
  python3 docs/agents/backtests/dat/scripts/pull_sec.py 1050446 2020-07-01 2024-12-31
  python3 docs/agents/backtests/dat/scripts/pull_sec.py 1829311 2025-01-01 2026-09-30      # BMNR, descriptive
Optional: --exhibits also caches every EX-99.x exhibit of each 8-K (press releases); --facts also caches the XBRL
company facts (companyfacts.json.gz; every year the API holds, so readers cut it by filing date).
The screen ran: pull_sec.py 1050446 2020-07-01 2024-12-31 --exhibits --facts
"""
import gzip, hashlib, json, os, re, sys, time, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
UA = os.environ.get("SEC_USER_AGENT", "daviesportfolios-dat-research/1.0 (research script; no contact)")
FORMS = {"8-K", "8-K/A", "10-Q", "10-Q/A", "10-K", "10-K/A"}


def get(url, tries=6):
    for k in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Encoding": "identity"})
            with urllib.request.urlopen(req, timeout=60) as r:
                return r.read()
        except Exception as e:                                  # noqa: BLE001 - retried, then raised
            last = e
            time.sleep(1.0 + 1.5 * k)
    raise RuntimeError(f"failed {url}: {last}")


def save_gz(path, data):
    with gzip.GzipFile(path, "wb", mtime=0) as g:
        g.write(data)


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    exhibits = "--exhibits" in sys.argv
    cik, lo, hi = int(args[0]), args[1], args[2]
    out = os.path.join(HERE, "..", "inputs", "sec", f"{cik:010d}")
    os.makedirs(out, exist_ok=True)
    sub = json.loads(get(f"https://data.sec.gov/submissions/CIK{cik:010d}.json"))
    blocks = [sub["filings"]["recent"]]
    for f in sub["filings"].get("files", []):
        blocks.append(json.loads(get("https://data.sec.gov/submissions/" + f["name"])))
        time.sleep(0.2)
    rows = {}
    for r in blocks:
        for i, form in enumerate(r["form"]):
            d = r["filingDate"][i]
            if form in FORMS and lo <= d <= hi:
                acc = r["accessionNumber"][i]
                rows[acc] = {"form": form, "filing_date": d, "acceptance_utc": r["acceptanceDateTime"][i],
                             "items": r["items"][i], "accession": acc, "document": r["primaryDocument"][i],
                             "report_date": r["reportDate"][i]}
    for acc, row in sorted(rows.items(), key=lambda kv: kv[1]["acceptance_utc"]):
        base = f"https://www.sec.gov/Archives/edgar/data/{cik}/{acc.replace('-', '')}/"
        row["url"] = base + row["document"]
        p = os.path.join(out, f"{acc}_{row['document']}.gz")
        if not os.path.exists(p):
            save_gz(p, get(row["url"]))
            time.sleep(0.15)
        row["sha256"] = hashlib.sha256(gzip.open(p).read()).hexdigest()
        if exhibits and row["form"].startswith("8-K"):
            idx = json.loads(get(base + "index.json"))
            time.sleep(0.15)
            row["exhibits"] = []
            for item in idx.get("directory", {}).get("item", []):
                name = item.get("name", "")
                if re.search(r"(ex|dex)-?99", name, re.I) and name.lower().endswith((".htm", ".html", ".txt")):
                    q = os.path.join(out, f"{acc}_{name}.gz")
                    if not os.path.exists(q):
                        save_gz(q, get(base + name))
                        time.sleep(0.15)
                    row["exhibits"].append({"name": name, "url": base + name,
                                            "sha256": hashlib.sha256(gzip.open(q).read()).hexdigest()})
    lst = sorted(rows.values(), key=lambda r: r["acceptance_utc"])
    with open(os.path.join(out, f"filings_{lo}_{hi}.json"), "w") as f:
        json.dump({"cik": cik, "from": lo, "to": hi, "user_agent": UA, "filings": lst}, f, indent=1)
    if "--facts" in sys.argv:                                   # XBRL company facts (all years; readers cut by date)
        save_gz(os.path.join(out, "companyfacts.json.gz"),
                get(f"https://data.sec.gov/api/xbrl/companyfacts/CIK{cik:010d}.json"))
    print(f"CIK {cik}: {len(lst)} filings {lo} .. {hi} cached in {out}")


if __name__ == "__main__":
    main()
