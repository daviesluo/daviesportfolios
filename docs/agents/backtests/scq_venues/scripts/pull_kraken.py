"""Kraken's keyless public trade tape (https://api.kraken.com/0/public/Trades?pair=<P>&since=<ns>, 1,000 trades a call,
paged forward from 2024-10-01), reduced to minute bars as pull_coinbase.py's. Kraken's "b"/"s" is the taker's side.
Each page's sha256 goes to RAW/kraken/<P>.pages.jsonl. Kraken's trade id is the last field of a row (from 2024 on).
usage: python3 -I pull_kraken.py RAW_DIR PAIR [PAIR ...]
"""
import hashlib, json, os, sys, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from pull_coinbase import START, END, M, fetch  # noqa: E402


def pull(raw, pair):
    d = os.path.join(raw, "kraken"); os.makedirs(d, exist_ok=True)
    pgf = os.path.join(d, f"{pair}.pages.jsonl")
    open(pgf, "w").close()
    since = START * 10**6
    rows = {}
    while True:
        body = fetch(f"https://api.kraken.com/0/public/Trades?pair={pair}&since={since}&count=1000")
        js = json.loads(body)
        if js.get("error"):
            time.sleep(5); continue
        res = js["result"]
        last = int(res["last"])
        trades = next(v for k, v in res.items() if k != "last")
        with open(pgf, "a") as f:
            f.write(json.dumps({"since": since, "n": len(trades), "last": last, "sha256": hashlib.sha256(body).hexdigest()}) + "\n")
        for r in trades:
            t = int(float(r[2]) * 1000)
            rows[(t, int(r[6]) if len(r) > 6 else len(rows))] = (t, round(float(r[0]) * 1e8), float(r[1]), "buy" if r[3] == "b" else "sell")
        if not trades or last == since or int(float(trades[-1][2]) * 1000) >= END:
            break
        since = last
        time.sleep(1.1)
    bars = {}
    for key in sorted(rows):
        t, pe8, q, ag = rows[key]
        if not (START <= t < END):
            continue
        k = str(t // M)
        b = bars.get(k)
        if b is None:
            b = bars[k] = [None, None, None, None, -1, None, None, -1, 0.0, 0]
        j = 0 if ag == "sell" else 2
        b[j] = pe8 if b[j] is None else min(b[j], pe8)
        b[j + 1] = pe8 if b[j + 1] is None else max(b[j + 1], pe8)
        b[4], b[5], b[6], b[7] = t, pe8, ag, key[1]
        b[8] += q * pe8 / 1e8
        b[9] += 1
    json.dump({"product": pair, "start_ms": START, "end_ms": END, "trades": len(rows), "bars": bars}, open(os.path.join(d, f"{pair}.bars.json"), "w"))
    print(pair, len(rows), "trades", len(bars), "minutes", flush=True)


if __name__ == "__main__":
    for p in sys.argv[2:]:
        pull(sys.argv[1], p)
