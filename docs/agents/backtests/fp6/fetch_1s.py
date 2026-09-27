"""fp6, added after the freeze: the trades a one-second loop would have filled at, for the DESCRIPTIVE 1 s arms of
H5 (DELIST-S) and H6 (LIST-S). Keyless: data.binance.vision's USDⓈ-M daily aggTrades and 1-minute klines only.

    python3 docs/agents/backtests/fp6/fetch_1s.py plan     # the files needed and their sizes (HEAD requests only)
    python3 docs/agents/backtests/fp6/fetch_1s.py pull     # writes inputs/speed_1s.json.gz + manifest.d/speed_1s.json

Davies' standing rule (2026-09-26, .claude/CLAUDE.md): a study prices speed at one second, because pg_cron 1.6.4 runs a
job every 1–59 s. The frozen H5 and H6 enter at the next daily open; these arms ask what entering 1 s after the event
would have done, with nothing else changed. They carry no bar and decide nothing.

* H5: the instant is the announcement's CMS `releaseDate` (ms, `inputs/announcements.json.gz` catalogs); T = it + 1 s.
* H6: the instant is the perpetual's first aggTrade on its listing day; T = it + 1 s.
* The fill is the first aggTrade whose transact_time is at or after T (the next UTC day's file if that day has none).
* For the stop on the entry day, the highest trade price from T to the end of T's minute is kept from the same stream;
  the minutes after it are read from that day's 1-minute klines (their highs and opens).

Each zip is read whole and checked against the sha256 the archive publishes beside it, while it streams: the
aggTrades are decompressed only as far as the entry minute, and nothing is written to disk but the result.
"""

from __future__ import annotations

import concurrent.futures as cf
import csv
import hashlib
import io
import json
import struct
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import zlib
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import measure as M  # noqa: E402
import rules as R  # noqa: E402
import vision as V  # noqa: E402

HERE = V.HERE
IN = HERE / "inputs"
DAY, MIN = R.DAY, 60_000
VISION = V.VISION


def iso_day(t: int) -> str:
    return datetime.fromtimestamp(t / 1000, tz=timezone.utc).strftime("%Y-%m-%d")


def events(d) -> list[dict]:
    """The frozen events (H5's 67, H6's 515), each with its instant rule; T is fixed for H5 here and for H6 once the
    listing day's first trade is read."""
    perps = {p for p in d["perp"] if p.endswith("USDT")}
    pb = {p: M.bars_by_day(d["perp"][p]) for p in perps}
    rel = {}
    for rows in d["ann"]["catalogs"].values():
        for row in rows:
            rel.setdefault(row["code"], row["releaseDate"])
    out = []
    for e in R.delist_events(d["ann"]["texts"], M.WIN_FROM, M.WIN_END):
        p = R.perp_for_token(e["token"], perps)
        day = e["published"] // DAY * DAY
        entry, exit_day = R.delist_entry_exit(e)
        if p is not None and day in pb[p] and entry in pb[p]:
            out.append({"h": "h5", "perp": p, "token": e["token"], "release": rel[e["code"]],
                        "T": rel[e["code"]] + 1000, "frozenEntry": entry, "exit": exit_day})
    crypto = M.crypto_set(d)
    first = {p: int(rows[0][0]) for p, rows in d["perp"].items() if rows}
    for e in R.listing_events(first, crypto, M.WIN_FROM, M.ms(2026, 8, 25)):
        out.append({"h": "h6", "perp": e["perp"], "listed": e["listed"], "T": None, "frozenEntry": e["entry"],
                    "exit": e["entry"] + R.H6_HOLD_DAYS * DAY})
    return out


def agg_path(sym: str, day: int) -> str:
    d = iso_day(day)
    return f"data/futures/um/daily/aggTrades/{sym}/{sym}-aggTrades-{d}.zip"


def kline_path(sym: str, day: int) -> str:
    d = iso_day(day)
    return f"data/futures/um/daily/klines/{sym}/1m/{sym}-1m-{d}.zip"


def head(path: str) -> int | None:
    url = urllib.parse.quote(f"{VISION}/{path}", safe=":/?&=%_-.~")
    for k in range(6):
        try:
            req = urllib.request.Request(url, method="HEAD", headers=V.UA)
            with urllib.request.urlopen(req, timeout=60) as res:
                return int(res.headers.get("Content-Length", "0"))
        except urllib.error.HTTPError as exc:
            if exc.code == 404:
                return None
            time.sleep(1.5 * (k + 1))
        except Exception:  # noqa: BLE001
            time.sleep(1.5 * (k + 1))
    raise RuntimeError(f"HEAD failed: {path}")


def stream_agg(path: str, want) -> tuple[dict | None, str | None, int]:
    """Stream one aggTrades zip: hash every byte, decompress only while `want(row)` asks for more rows.
    Returns (what `want` kept, sha256 checked against the published CHECKSUM, size)."""
    url = urllib.parse.quote(f"{VISION}/{path}", safe=":/?&=%_-.~")
    last: Exception | None = None
    for k in range(6):
        try:
            h = hashlib.sha256()
            size = 0
            with urllib.request.urlopen(urllib.request.Request(url, headers=V.UA), timeout=300) as res:
                expected = int(res.headers.get("Content-Length", "0"))
                buf = b""
                dec = None
                pending = b""
                done = False
                state = None
                header_rows = 0
                while True:
                    chunk = res.read(1 << 20)
                    if not chunk:
                        break
                    h.update(chunk)
                    size += len(chunk)
                    if done:
                        continue
                    if dec is None:
                        buf += chunk
                        if len(buf) < 30:
                            continue
                        sig, _v, flags, method = struct.unpack("<IHHH", buf[:10])
                        if sig != 0x04034B50 or method != 8:
                            raise SystemExit(f"{path}: not a deflated zip entry")
                        nlen, xlen = struct.unpack("<HH", buf[26:30])
                        if len(buf) < 30 + nlen + xlen:
                            continue
                        dec = zlib.decompressobj(-15)
                        data = buf[30 + nlen + xlen:]
                        buf = b""
                    else:
                        data = chunk
                    text = pending + dec.decompress(data)
                    lines = text.split(b"\n")
                    pending = lines.pop()
                    for line in lines:
                        if not line or not line[:1].isdigit():
                            header_rows += 1
                            continue
                        state = want(line.decode().split(","), state)
                        if state is not None and state.get("done"):
                            done = True
                            break
                if not done and pending and pending[:1].isdigit():
                    state = want(pending.decode().split(","), state)
            if expected and size != expected:
                raise ValueError(f"{path}: read {size} of {expected} bytes")
            digest = h.hexdigest()
            chk = V.get(f"{VISION}/{path}.CHECKSUM", allow404=True)
            if chk is not None and chk.decode().split()[0].strip().lower() != digest:
                # a stream cut short or garbled in transit: read it again; only a repeated mismatch stops the pull
                raise ValueError(f"{path} does not match its published sha256")
            return state, digest, size
        except Exception as exc:  # noqa: BLE001
            last = exc
            time.sleep(2 * (k + 1))
    raise SystemExit(f"stream failed six times: {path}: {last}")


def fill_after(T: int):
    """A `want`: the first trade at or after T (however long after), then the highest price to the end of THAT
    trade's minute (the minutes after it come from the day's 1-minute klines)."""

    def want(row, state):
        t = V.ms_stamp(row[5])
        px = float(row[1])
        if state is None:
            state = {"first": None, "fill": None, "maxToMinuteEnd": None}
        if state["first"] is None:
            state["first"] = {"t": t, "price": px}
        if t < T:
            return state
        if state["fill"] is None:
            state["fill"] = {"t": t, "price": px, "aggId": int(row[0])}
            state["minuteEnd"] = (t // MIN + 1) * MIN
        if t >= state["minuteEnd"]:
            state["done"] = True
            return state
        state["maxToMinuteEnd"] = px if state["maxToMinuteEnd"] is None else max(state["maxToMinuteEnd"], px)
        return state

    return want


def first_then_fill():
    """A `want` for H6: the day's first trade fixes T = its time + 1 s; then as `fill_after(T)`."""
    inner = {"want": None}

    def want(row, state):
        if state is None:
            t0 = V.ms_stamp(row[5])
            inner["want"] = fill_after(t0 + 1000)
            state = {"first": {"t": t0, "price": float(row[1])}, "fill": None, "maxToMinuteEnd": None}
        return inner["want"](row, state)

    return want


def minute_bars(path: str) -> tuple[list[list] | None, str | None]:
    rows, digest = V.vision_zip(path, allow404=True)
    if rows is None:
        return None, None
    out = []
    for r in rows:
        if not r or not r[0].strip().isdigit():
            continue
        out.append([V.ms_stamp(r[0]), float(r[1]), float(r[2]), float(r[3]), float(r[4]), float(r[5])])
    return out, digest


def pull_one(e: dict) -> tuple[dict, dict]:
    sym = e["perp"]
    sources = {}
    fill = None
    if e["h"] == "h6":
        path = agg_path(sym, e["listed"])
        if head(path) is None:
            return e | {"fill": None, "why": "no aggTrades file on the listing day"}, sources
        st, dg, _ = stream_agg(path, first_then_fill())
        sources[path] = dg
        if st is None:
            return e | {"fill": None, "why": "no aggTrades on the listing day"}, sources
        e = e | {"firstTrade": st["first"], "T": st["first"]["t"] + 1000}
        if st.get("fill"):
            fill = st | {"day": e["listed"]}
    T = e["T"]
    day = T // DAY * DAY
    for dd in (day, day + DAY):
        if fill is not None or dd >= e["exit"]:
            break
        path = agg_path(sym, dd)
        if path in sources or head(path) is None:
            continue
        st, dg, _ = stream_agg(path, fill_after(T))
        sources[path] = dg
        if st is not None and st.get("fill"):
            fill = st | {"day": dd}
    if fill is None:
        return e | {"fill": None, "why": "no trade at or after T before the exit"}, sources
    f = fill["fill"]
    kpath = kline_path(sym, fill["day"])
    bars, kd = minute_bars(kpath)
    if kd is not None:
        sources[kpath] = kd
    minute_end = (f["t"] // MIN + 1) * MIN
    later = [b for b in (bars or []) if b[0] >= minute_end]
    return e | {"fill": {"t": f["t"], "price": f["price"], "aggId": f["aggId"]},
                "maxToMinuteEnd": fill["maxToMinuteEnd"], "minutesAfter": [b[:3] for b in later]}, sources


def main(argv: list[str]) -> int:
    stage = argv[0] if argv else ""
    d = M.load()
    ev = events(d)
    print(len([e for e in ev if e["h"] == "h5"]), "H5 events,", len([e for e in ev if e["h"] == "h6"]), "H6 events")
    if stage == "plan":
        paths = sorted({agg_path(e["perp"], e["T"] // DAY * DAY) for e in ev if e["h"] == "h5"}
                       | {agg_path(e["perp"], e["listed"]) for e in ev if e["h"] == "h6"})
        with cf.ThreadPoolExecutor(16) as ex:
            sizes = dict(zip(paths, ex.map(head, paths)))
        tot = sum(v for v in sizes.values() if v)
        miss = [p for p, v in sizes.items() if v is None]
        big = sorted(((v, p) for p, v in sizes.items() if v), reverse=True)[:10]
        print(f"{len(paths)} aggTrades zips, {tot / 1e9:.2f} GB, missing {len(miss)}")
        for v, p in big:
            print(f"  {v / 1e6:8.1f} MB {p}")
        print("missing:", miss[:20])
        return 0
    if stage != "pull":
        raise SystemExit("usage: fetch_1s.py plan|pull [--cache <jsonl outside the repo>]")
    # an optional cache of finished events, so a pull cut short resumes where it stopped
    cache_path = Path(argv[argv.index("--cache") + 1]) if "--cache" in argv else None
    done: dict[str, tuple[dict, dict]] = {}
    if cache_path is not None and cache_path.exists():
        for line in cache_path.read_text().splitlines():
            row = json.loads(line)
            done[row["key"]] = (row["result"], row["sources"])
    key = lambda e: f"{e['h']}|{e['perp']}|{e['frozenEntry']}"  # noqa: E731
    todo = [e for e in ev if key(e) not in done]
    lock = __import__("threading").Lock()

    def work(e):
        res, src = pull_one(e)
        if cache_path is not None:
            with lock, cache_path.open("a") as fh:
                fh.write(json.dumps({"key": key(e), "result": res, "sources": src}) + "\n")
        return key(e), res, src

    with cf.ThreadPoolExecutor(8) as ex:
        for k, res, src in ex.map(work, todo):
            done[k] = (res, src)
    results, sources = [], {}
    for e in ev:
        res, src = done[key(e)]
        results.append(res)
        sources.update(src)
    results.sort(key=lambda e: (e["h"], e["frozenEntry"], e["perp"]))
    sha = V.write_gz(IN / "speed_1s.json.gz", {"events": results})
    frag = {"inputs": {"speed_1s.json.gz": {"sha256": sha, "events": len(results),
                                             "columns": "minutesAfter: [open time ms, open, high]"}},
            "sources": {"speed_1s": dict(sorted(sources.items()))}}
    (HERE / "manifest.d" / "speed_1s.json").write_text(json.dumps(frag, indent=1, sort_keys=True) + "\n")
    print("wrote inputs/speed_1s.json.gz", sha, "fills", sum(1 for e in results if e.get("fill")), "of", len(results))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
