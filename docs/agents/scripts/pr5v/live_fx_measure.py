"""Measure keyless live GBP/USD sources side by side for a few minutes (the fast-X study, 2026-09-28).

Polled at most once a second per host, as a minute-called Edge Function or a Worker could read them:
  truefx      GET https://webrates.truefx.com/rates/connect.html?f=csv          (unauthenticated snapshot, ms timestamps)
  kraken      GET https://api.kraken.com/0/public/Ticker?pair=GBPUSD            (best bid / ask)
  bitstamp    GET https://www.bitstamp.net/api/v2/ticker/gbpusd/                (best bid / ask)
  yahoo       GET https://query{1,2}.finance.yahoo.com/v8/finance/chart/GBPUSD=X?interval=1m&range=1d
              (meta.regularMarketPrice and regularMarketTime; every 3 s, alternating hosts, so each host every 6 s)
Pushed (websocket, as an always-on Worker could hold one):
  kraken_ws   wss://ws.kraken.com/v2  ticker GBP/USD, event_trigger "bbo" (every change of the best bid or ask)
  bitstamp_ws wss://ws.bitstamp.net   order_book_gbpusd (the top of the book on every change)

Nothing is signed and no key is read. Every reply is written as it came, one JSON line per observation, with the local
receive time in ms: {"src", "recv_ms", "bid", "ask", "px", "src_ms", "status"}.
usage: live_fx_measure.py OUT.jsonl SECONDS [SKIP,...]     (e.g. "yahoo" once it answers 429 to every request)
"""
import json, os, sys, threading, time, urllib.error, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
UA = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0",
      "Accept": "application/json,text/plain,*/*"}
lock = threading.Lock()
STOP = [0.0]


def now_ms():
    return int(time.time() * 1000)


def emit(f, row):
    with lock:
        f.write(json.dumps(row) + "\n")
        f.flush()


def get(url, timeout=10):
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=timeout) as r:
            return r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, b""
    except Exception as e:
        return repr(e)[:60], b""


def poller(f, name, urls, every, parse):
    i = 0
    nxt = time.time()
    while time.time() < STOP[0]:
        url = urls[i % len(urls)]
        i += 1
        t0 = now_ms()
        st, body = get(url)
        t1 = now_ms()
        row = {"src": name, "sent_ms": t0, "recv_ms": t1, "status": st}
        if st == 200:
            try:
                row.update(parse(body))
            except Exception as e:
                row["parse_error"] = repr(e)[:80]
        emit(f, row)
        nxt += every
        time.sleep(max(0.0, nxt - time.time()))


def p_truefx(b):
    for line in b.decode().strip().splitlines():
        p = line.split(",")
        if p[0] == "GBP/USD":
            bid = float(p[2] + p[3])
            ask = float(p[4] + p[5])
            return {"src_ms": int(p[1]), "bid": bid, "ask": ask}
    raise ValueError("no GBP/USD")


def p_kraken(b):
    d = json.loads(b)["result"]["ZGBPZUSD"]
    return {"bid": float(d["b"][0]), "ask": float(d["a"][0]), "px": float(d["c"][0])}


def p_bitstamp(b):
    d = json.loads(b)
    return {"bid": float(d["bid"]), "ask": float(d["ask"]), "px": float(d["last"]), "src_ms": int(d["timestamp"]) * 1000}


def p_yahoo(b):
    m = json.loads(b)["chart"]["result"][0]["meta"]
    return {"px": float(m["regularMarketPrice"]), "src_ms": int(m["regularMarketTime"]) * 1000}


def ws_loop(f, name, host, path, sub, parse):
    sys.path.insert(0, HERE)
    from wsmini import WS  # noqa: E402
    while time.time() < STOP[0]:
        try:
            w = WS(host, path)
            w.send(json.dumps(sub))
            emit(f, {"src": name, "recv_ms": now_ms(), "status": "connected"})
            while time.time() < STOP[0]:
                m = w.recv()
                t = now_ms()
                for row in parse(m):
                    row.update(src=name, recv_ms=t, status=200)
                    emit(f, row)
            w.close()
        except Exception as e:
            emit(f, {"src": name, "recv_ms": now_ms(), "status": "ws error " + repr(e)[:80]})
            time.sleep(3)


def w_kraken(m):
    d = json.loads(m)
    if d.get("channel") != "ticker":
        return []
    out = []
    for x in d.get("data") or []:
        out.append({"bid": float(x["bid"]), "ask": float(x["ask"]), "px": float(x["last"]), "src_iso": x.get("timestamp")})
    return out


def w_bitstamp(m):
    d = json.loads(m)
    x = d.get("data") or {}
    if not x.get("bids") or not x.get("asks"):
        return []
    return [{"bid": float(x["bids"][0][0]), "ask": float(x["asks"][0][0]), "src_us": int(x["microtimestamp"])}]


def main():
    out, secs = sys.argv[1], float(sys.argv[2])
    STOP[0] = time.time() + secs
    f = open(out, "a")
    ths = [
        threading.Thread(target=poller, args=(f, "truefx", ["https://webrates.truefx.com/rates/connect.html?f=csv"], 1.0, p_truefx)),
        threading.Thread(target=poller, args=(f, "kraken", ["https://api.kraken.com/0/public/Ticker?pair=GBPUSD"], 1.0, p_kraken)),
        threading.Thread(target=poller, args=(f, "bitstamp", ["https://www.bitstamp.net/api/v2/ticker/gbpusd/"], 1.0, p_bitstamp)),
        threading.Thread(target=poller, args=(f, "yahoo", ["https://query1.finance.yahoo.com/v8/finance/chart/GBPUSD=X?interval=1m&range=1d",
                                                           "https://query2.finance.yahoo.com/v8/finance/chart/GBPUSD=X?interval=1m&range=1d"], 3.0, p_yahoo)),
        threading.Thread(target=ws_loop, args=(f, "kraken_ws", "ws.kraken.com", "/v2",
                                               {"method": "subscribe", "params": {"channel": "ticker", "symbol": ["GBP/USD"], "event_trigger": "bbo"}}, w_kraken)),
        threading.Thread(target=ws_loop, args=(f, "bitstamp_ws", "ws.bitstamp.net", "/",
                                               {"event": "bts:subscribe", "data": {"channel": "order_book_gbpusd"}}, w_bitstamp)),
    ]
    skip = set(sys.argv[3].split(",")) if len(sys.argv) > 3 else set()
    ths = [t for t in ths if t._args[1] not in skip]
    for t in ths:
        t.daemon = True
        t.start()
    while time.time() < STOP[0] + 5:
        time.sleep(1)
    print("done", out)


if __name__ == "__main__":
    main()
