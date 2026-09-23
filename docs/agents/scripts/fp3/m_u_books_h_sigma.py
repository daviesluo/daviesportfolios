"""Descriptive (kill) measurement for idea B11: half-spread of the zero-maker coin/U books (one all-symbol
bookTicker snapshot, data/binance_bookTicker_all.json) against one minute of the coin's own USDT-book
movement (standard deviation of 1-minute log returns, 2026-07-01 -> 2026-08-31, data/bn_1m_thin; BTC from
research_fp's year file, same months). fp2's inequality: a once-a-minute quote needs h >= 2.7 sigma_1m.
Writes results/m_u_books_h_sigma.json."""
import json, os, math
S = os.environ.get("FP_ROOT", ".") + "/research_fp3"
SP = os.environ.get("FP_ROOT", ".")
bt = {x["symbol"]: x for x in json.load(open(os.path.join(S, "data", "binance_bookTicker_all.json")))["bookTicker"]}
t0, t1 = 1782864000000, 1788220800000  # 2026-07-01 .. 2026-09-01
def sigma(rows):
    r = [math.log(b[4] / a[4]) for a, b in zip(rows, rows[1:]) if b[0] - a[0] == 60000 and t0 <= b[0] < t1]
    m = sum(r) / len(r)
    return math.sqrt(sum((x - m) ** 2 for x in r) / len(r)) * 1e4, len(r)
out = {}
for base in ["BTC", "ETH", "XRP", "DOGE"]:
    fn = os.path.join(S, "data", "bn_1m_thin", f"{base}USDT.json") if base != "BTC" else f"{SP}/research_fp/data/binance_year/BTCUSDT_1m.json"
    sd, n = sigma(json.load(open(fn)))
    b = bt[base + "U"]; bid, ask = float(b["bidPrice"]), float(b["askPrice"])
    h = (ask - bid) / ((ask + bid) / 2) / 2 * 1e4
    out[base + "U"] = {"half_spread_bps": round(h, 3), "sigma_1m_bps_usdt_book": round(sd, 3), "h_over_sigma": round(h / sd, 3), "minutes": n}
json.dump(out, open(os.path.join(S, "results", "m_u_books_h_sigma.json"), "w"), indent=1)
for k, v in out.items(): print(k, v)
