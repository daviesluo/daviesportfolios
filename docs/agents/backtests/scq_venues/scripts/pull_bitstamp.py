"""Bitstamp's keyless 1-minute OHLC (https://www.bitstamp.net/api/v2/ohlc/<pair>/?step=60&limit=1000&start=<s>) for its
stablecoin-against-EUR books, as CANDLE-GRADE bars: Bitstamp serves no print history (its transactions endpoint
reaches back a day), so a bar has the minute's low (stored as a sell print), high (as a buy print) and close (the last
print, aggressor unknown: the simulator then never refuses a post-only order at a price equal to the last print, a small
optimism), and its quote volume is base volume × close. Minutes with no volume are dropped. Pages' sha256 go to
RAW/bitstamp/<pair>.pages.jsonl. Bars as pull_coinbase.py's.
usage: python3 -I pull_bitstamp.py RAW_DIR PAIR [PAIR ...]
"""
import hashlib, json, os, sys, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from pull_coinbase import START, END, M, fetch  # noqa: E402


def pull(raw, pair):
    d = os.path.join(raw, "bitstamp"); os.makedirs(d, exist_ok=True)
    pgf = os.path.join(d, f"{pair}.pages.jsonl"); open(pgf, "w").close()
    bars, s = {}, START // 1000
    while s < END // 1000:
        body = fetch(f"https://www.bitstamp.net/api/v2/ohlc/{pair}/?step=60&limit=1000&start={s}")
        rows = json.loads(body)["data"]["ohlc"]
        with open(pgf, "a") as f:
            f.write(json.dumps({"start": s, "n": len(rows), "sha256": hashlib.sha256(body).hexdigest()}) + "\n")
        for r in rows:
            t = int(r["timestamp"]) * 1000
            v = float(r["volume"])
            if not (START <= t < END) or v <= 0:
                continue
            lo, hi, cl = (round(float(r[k]) * 1e8) for k in ("low", "high", "close"))
            bars[str(t // M)] = [lo, None, None, hi, t + M - 1, cl, "unknown", -1, v * cl / 1e8, 1]
        s += 1000 * 60
        time.sleep(0.6)
    json.dump({"product": pair, "start_ms": START, "end_ms": END, "candle_grade": True, "bars": bars}, open(os.path.join(d, f"{pair}.bars.json"), "w"))
    print(pair, len(bars), "minutes", flush=True)


if __name__ == "__main__":
    for p in sys.argv[2:]:
        pull(sys.argv[1], p)
