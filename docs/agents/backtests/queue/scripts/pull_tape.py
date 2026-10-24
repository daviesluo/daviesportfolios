"""QUEUE "Data" item 2: the keyless UK tape of USDC-USD, USDT-USD, USDC-GBP and USDT-GBP for the UTC days 2026-10-03 ->
2026-11-01, pulled after 2026-11-02 00:10 UTC with PR6's own fetcher (`docs/agents/backtests/pr6/fetch.py`, unchanged:
one UTC day a window [D 00:00:00.000, D 23:59:59.999], every page followed to its end, one request every 1.1 s, rows not
labelled UK dropped, de-duplicated by id, sorted by ts then id), its raw pages kept under <data>/tape_raw, and each book's
extracted file written gzipped to <data>/tape/<BOOK>.jsonl.gz. Prints only counts and hashes. Written 2026-10-24.

    python3 -I docs/agents/backtests/queue/scripts/pull_tape.py <data>
"""
import gzip, hashlib, os, shutil, sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", "..", "..", "..", ".."))
BOOKS = ["USDC-USD", "USDT-USD", "USDC-GBP", "USDT-GBP"]
FIRST, END = "2026-10-03", "2026-11-02"          # END exclusive: the last day pulled is 2026-11-01


def main(data):
    os.environ["PR6_DATA"] = os.path.join(os.path.abspath(data), "tape_raw")
    sys.path.insert(0, os.path.join(REPO, "docs/agents/backtests/pr6"))
    sys.dont_write_bytecode = True
    import fetch  # noqa: E402  (PR6's fetcher, read with PR6_DATA set)
    os.makedirs(os.path.join(data, "tape"), exist_ok=True)
    for b in BOOKS:
        fetch.pull_trades(b, FIRST, END)
        fetch.extract(b)
        src = os.path.join(os.environ["PR6_DATA"], "trades", f"{b}.jsonl")
        dst = os.path.join(data, "tape", f"{b}.jsonl.gz")
        with open(src, "rb") as f, open(dst, "wb") as g:
            with gzip.GzipFile(fileobj=g, mode="wb", mtime=0, filename="") as z:
                shutil.copyfileobj(f, z)
        n = sum(1 for _ in open(src))
        print(b, n, "prints", hashlib.sha256(open(dst, "rb").read()).hexdigest())


if __name__ == "__main__":
    main(sys.argv[1])
