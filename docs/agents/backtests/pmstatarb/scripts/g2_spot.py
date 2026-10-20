"""G2 spot: Binance 1-minute BTCUSDT and ETHUSDT, the settlement feed.

api.binance.com is the feed. One day is also read from data-api.binance.vision
and the closes compared; a difference is printed, not papered over. Keyless
GETs only. The csv lands in $PM_DATA/g2 (not committed by this script).

usage: python3 -I -u docs/agents/backtests/pmstatarb/scripts/g2_spot.py
"""
import csv
import datetime as dt
import gzip
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import net  # noqa: E402

API = "https://api.binance.com"
VISION = "https://data-api.binance.vision"
# 30 days before 2024-01-01, through the study tail. Vol needs the trail.
START = "2023-12-01T00:00:00Z"
END = "2026-10-04T00:00:00Z"
SYMBOLS = ("BTCUSDT", "ETHUSDT")
# A day both hosts should have, away from the pull's end.
OVERLAP_START = "2026-10-13T00:00:00Z"


def ms(iso):
    t = dt.datetime.fromisoformat(iso.replace("Z", "+00:00"))
    return int(t.timestamp() * 1000)


def klines(host, symbol, start_ms, end_ms):
    return net.get(host + "/api/v3/klines", {
        "symbol": symbol, "interval": "1m", "startTime": start_ms, "endTime": end_ms, "limit": 1000,
    })


def overlap(symbol):
    """Max absolute close difference on one day. Returns (n, max_abs, n_mismatch)."""
    start, end = ms(OVERLAP_START), ms(OVERLAP_START) + 86400 * 1000
    a, b = {}, {}
    for host, sink in ((API, a), (VISION, b)):
        cursor = start
        while cursor < end:
            rows = klines(host, symbol, cursor, end - 1)
            if not rows:
                break
            for row in rows:
                sink[int(row[0])] = row[4]
            nxt = int(rows[-1][0]) + 60_000
            if nxt <= cursor:
                break
            cursor = nxt
            if len(rows) < 1000:
                break
    both = set(a) & set(b)
    diffs = [abs(float(a[t]) - float(b[t])) for t in both]
    mismatch = sum(1 for x in diffs if x > 0)
    return len(both), (max(diffs) if diffs else None), mismatch


def pull(symbol, start_ms, end_ms, path, host):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    cursor = start_ms
    mode = "w"
    if os.path.exists(path) and os.path.getsize(path) > 0:
        # Resume from the last complete open-time. A torn last line is dropped.
        last = None
        with open(path, newline="") as f:
            for row in csv.reader(f):
                if row and row[0] != "open_ms" and row[0].isdigit():
                    last = int(row[0])
        if last is not None:
            cursor = last + 60_000
            mode = "a"
            print(symbol, "resume", cursor, flush=True)
    written = 0
    pages = 0
    with open(path, mode, newline="") as f:
        w = csv.writer(f, lineterminator="\n")
        if mode == "w":
            w.writerow(["open_ms", "open", "high", "low", "close"])
        while cursor < end_ms:
            try:
                rows = klines(host[0], symbol, cursor, end_ms - 1)
            except RuntimeError as e:
                if host[0] == API and "HTTP 451" in str(e):
                    print("api.binance.com HTTP 451; rest of this pull uses data-api.binance.vision", flush=True)
                    host[0] = VISION
                    rows = klines(host[0], symbol, cursor, end_ms - 1)
                else:
                    raise
            if not rows:
                break
            for row in rows:
                w.writerow([row[0], row[1], row[2], row[3], row[4]])
                written += 1
            pages += 1
            nxt = int(rows[-1][0]) + 60_000
            if nxt <= cursor:
                break
            cursor = nxt
            if pages % 20 == 0:
                print(symbol, "rows", written, "at", cursor, flush=True)
            if len(rows) < 1000:
                break
            f.flush()
    return written


def gzip_copy(path):
    gz = path + ".gz"
    with open(path, "rb") as src, gzip.open(gz, "wb", compresslevel=9) as dst:
        while True:
            buf = src.read(1 << 20)
            if not buf:
                break
            dst.write(buf)
    return gz


def main():
    scratch = os.path.join(net.DATA, "g2")
    os.makedirs(scratch, exist_ok=True)
    lines = []
    # A list so a 451 inside the pull can switch the rest onto Binance's public host.
    host = [API]
    try:
        for symbol in SYMBOLS:
            n, mx, mismatch = overlap(symbol)
            line = f"overlap {symbol} {OVERLAP_START[:10]} minutes {n} max_abs_close {mx} mismatches {mismatch}"
            print(line, flush=True)
            lines.append(line)
            if n < 1000:
                raise SystemExit(f"{symbol} overlap too short ({n})")
    except RuntimeError as e:
        if "HTTP 451" not in str(e):
            raise
        host[0] = VISION
        line = "overlap not run: api.binance.com HTTP 451 restricted location; pull uses data-api.binance.vision"
        print(line, flush=True)
        lines.append(line)
    start, end = ms(START), ms(END)
    for symbol in SYMBOLS:
        path = os.path.join(scratch, symbol + ".csv")
        n = pull(symbol, start, end, path, host)
        gz = gzip_copy(path)
        lines.append(f"{symbol} wrote {n} rows this run file {gz}")
        print(lines[-1], flush=True)
    out = os.path.join(scratch, "spot_overlap.txt")
    with open(out, "w") as f:
        f.write("\n".join(lines) + "\n")
    print("spot done", flush=True)


if __name__ == "__main__":
    main()
