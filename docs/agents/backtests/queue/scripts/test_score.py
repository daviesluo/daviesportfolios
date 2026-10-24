"""QUEUE's scorer end to end on a synthetic record whose answers are worked out by hand (no production row, no real
print): the export, the tape, Kraken's replies and PR5's records written in the layout the reading session leaves, on the
pre-registration's own dates, then `score.py` (checks 1-3 first, as at the reading), and check 5 (two runs, byte for
byte). Written 2026-10-24, before the export.

The world. Every book has one recorder row a day, read at 00:00:40 and seen until the next 00:00:00 (no void minute): the
USD books' bid 0.9999 x 100 and ask 1.0001 x 100, the GBP books' 0.7990 x 100 and 0.8010 x 100. Kraken's hours all
have a VWAP of "1.0000" (one trade or more), so Q2's fair is 10,000, as Q1's par. On USDC-USD, each day from 10-04 to
10-31: a SELL of 150 at 0.9999 at 10:00:00.5 and a BUY of 50 at 1.0000 at 12:00:00.5; a BUY of 1 at 1.0000 on 10-03
gives the first minutes their last print. USDT-USD has only that seed; the GBP books print nothing. PR5's record: X 1.25
and fairU 1.0 every minute but 10-04 00:00 -> 00:59 (dark, so Q3 starts at 10-04 00:00), no trip, no live order.

By hand (Q1 and Q2 alike):
* The bid at 9999 joins behind 100 (its row covers its go-live), so each day's SELL of 150 fills 150 - 100 = 50 coins at
  0.9999 ($49.995), and its exit (ask at 1.0000, no level there: behind 0) takes the BUY of 50 whole. 28 round trips of
  50 x 0.0001 = $0.005: $0.14. The bids at 9998 and 9997 and the asks never fill.
* Orders: 12 placements at 10-04 00:00, and each day an exit (10:01) and a re-placement (12:01): 14 on 10-04, 2 after.
* Stress: behind 1.5 x 100 = 150, 10-04's SELL of 150 fills nothing but brings the bid to the front (the next rows cap
  0 at min(0, 150)); 10-05's fills the whole order, 100 / 0.9999 = 100.010001 coins. Its exit takes 50 at 12:00, and no
  print goes through 1.0000 by a tick more, so the 24-hour stop at 10-06 10:00 sells the other 50.010001 at that minute's
  last print, 0.9999 x (1 - 2 x 0.0009 - 2 x 0.00005): 50 x 0.0001 + 50.010001 x 0.9999 x (-0.0019) = -$0.090010. The bid,
  re-placed at 10:01 behind 150 again, waits out 10-06's SELL; so a trip every third day, 10-05 to 10-29: 9 trips,
  -$0.810086. Arm 3a (through only): no print is through a quote: no trip. Arms 3b, 3c, 3d, 3h: the same 28 trips.
* The bar: every day +$0.005, so the day bootstrap's p is 0 for both and Holm holds both (condition 2). Condition 1 holds,
  3 fails (-$0.81), 4 fails (28 < 60), 5 holds (each day 1/28), 6 fails ($0.14 < $7.3644): FAIL, judged (no void minute).
* The hourly shift: a twin starting at 10:00 (delta a multiple of 24) or from 13:00 to 09:00 enters at a 10:00 print and
  makes $0.005; one starting at 11:00 or 12:00 (delta = 1 or 2 mod 24: 56 of the 671) enters at 12:00 at 1.0000 and exits
  the next day at 1.0000 for $0, except the one that lands on 10-31 12:00, which no later print exits: its 24-hour stop on
  11-01 12:00 at 1.0000 x (1 - 0.0009 - 0.00005) loses 49.995 x 0.00095 = $0.04749525. So 615 values of $0.14 and 56 of
  -$0.04749525; the p95 (index 636) is $0.14.
* Q3: on 10-10, a SELL at 0.7990 goes through the 0.1 % bid (0.7992) alone and a BUY at 0.8001 through its exit: one trip
  of 79.9 / 0.7992 coins making 79.9 / 0.7992 x 0.0008 x 1.25 = $0.099975, which the engine's record (PR5's trip) holds;
  check 4 matches it field for field. With the engine's P&L $0.001 off, check 4 fails; with that and the fill minute's
  recorded prints_n 2 against the tape's 1, the difference follows from an input-differing minute and is allowed.

    python3 -I docs/agents/backtests/queue/scripts/test_score.py
"""
import gzip, json, os, shutil, subprocess, sys, tempfile

sys.dont_write_bytecode = True
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import inputs as I  # noqa: E402
import score as SC  # noqa: E402

M, H, DAY = I.M, I.H, I.DAY
n_checks = 0


def ok(cond, what):
    global n_checks
    assert cond, what
    n_checks += 1
    print("ok ", what)


def gz(path, lines):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as f:
        with gzip.GzipFile(fileobj=f, mode="wb", mtime=0, filename="") as g:
            g.write(("".join(line + "\n" for line in lines)).encode())


FILL, EXIT = I.ms("2026-10-10T10:00"), I.ms("2026-10-10T12:00")
# Q3's one trip by hand: fair 1.0 / 1.25 = 0.8, the 0.1 % bid at floor(7992.0) = 0.7992; the SELL at 0.7990 is through it
# alone; the minute printed 1,000 x 0.7990 = 799 GBP, so it takes min($100, 0.1 x 799 x 1.25) = $99.875 = 79.9 GBP =
# 79.9 / 0.7992 coins; its exit (ask at 0.8000) takes the BUY through it at 0.8001: P&L 79.9 / 0.7992 x 0.0008 x 1.25.
Q3_QTY = 79.9 / 0.7992
Q3_PNL = Q3_QTY * (0.8 - 0.7992) * 1.25


def ENGINE_TRIP(pnl_shift=0.0):
    return "|".join(["USDC-GBP", "bid", "0.001", str(FILL), str(FILL + 500), "g1", "0.7992", repr(Q3_QTY), "1.25", "0.8", "1",
                     str(EXIT), "0.8", "maker", "g2", "2", repr(79.9 * 1.25), repr(Q3_PNL + pnl_shift)])


def write_world(data, pnl_shift=0.0, miscount=False):
    days = [I.ms("2026-10-03T00:00") + k * DAY for k in range(30)]          # 10-03 .. 11-01
    rows = []
    for b in I.USD_BOOKS + I.GBP_BOOKS:
        bid, ask = (0.9999, 1.0001) if b in I.USD_BOOKS else (0.7990, 0.8010)
        for d in days:
            rows.append(json.dumps({"book": b, "ts": I.iso(d + 40000), "seen_until": I.iso(d + DAY), "reads": 1440,
                                    "bids": [[bid, 100, 1]], "asks": [[ask, 100, 1]]}))
    gz(os.path.join(data, "book_levels.jsonl.gz"), rows)
    seed = I.ms("2026-10-03T12:00")
    usdc = [{"id": "seed", "price": "1.0000", "qty": "1", "region": "UK", "side": "buy", "ts": seed}]
    for d in days[1:29]:                                                     # 10-04 .. 10-31
        usdc.append({"id": f"{d}-a", "price": "0.9999", "qty": "150", "region": "UK", "side": "sell", "ts": d + 10 * H + 500})
        usdc.append({"id": f"{d}-b", "price": "1.0000", "qty": "50", "region": "UK", "side": "buy", "ts": d + 12 * H + 500})
    gz(os.path.join(data, "tape", "USDC-USD.jsonl.gz"), [json.dumps(r, sort_keys=True) for r in usdc])
    gz(os.path.join(data, "tape", "USDT-USD.jsonl.gz"), [json.dumps({"id": "seed", "price": "1.0000", "qty": "1", "region": "UK", "side": "buy", "ts": seed}, sort_keys=True)])
    g = [{"id": "g1", "price": "0.7990", "qty": "1000", "region": "UK", "side": "sell", "ts": FILL + 500},
         {"id": "g2", "price": "0.8001", "qty": "10", "region": "UK", "side": "buy", "ts": EXIT + 500}]
    gz(os.path.join(data, "tape", "USDC-GBP.jsonl.gz"), [json.dumps(r, sort_keys=True) for r in g])
    gz(os.path.join(data, "tape", "USDT-GBP.jsonl.gz"), [])
    os.makedirs(os.path.join(data, "kraken"), exist_ok=True)
    hrs = range(I.ms("2026-10-02T00:00") // 1000, I.ms("2026-11-02T02:00") // 1000, 3600)
    for pair, key in (("USDTUSD", "USDTZUSD"), ("USDCUSD", "USDCUSD")):
        rep = {"error": [], "result": {key: [[h, "1.0000", "1.0000", "1.0000", "1.0000", "1.0000", "100.0", 5] for h in hrs], "last": hrs[-1]}}
        json.dump(rep, open(os.path.join(data, "kraken", f"2026-11-02-{pair}.json"), "w"))
    mins = []
    for b in I.GBP_BOOKS:
        for t in range(I.ms("2026-10-03T00:00"), I.DATA_END, M):
            dark = I.W0 <= t < I.W0 + H
            pn = 1 if b == "USDC-GBP" and t in (FILL, EXIT) else 0
            if b == "USDC-GBP" and t == FILL and miscount:
                pn = 2
            mins.append(f"{b}|{t}|{'' if dark else '1.25'}|1.0|{pn}")
    gz(os.path.join(data, "pr5", "minutes.txt.gz"), mins)
    gz(os.path.join(data, "pr5", "trips.txt.gz"), [ENGINE_TRIP(pnl_shift)])
    gz(os.path.join(data, "pr5", "prints.txt.gz"), [f"g1|USDC-GBP|{FILL + 500}|0.7990|1000|sell", f"g2|USDC-GBP|{EXIT + 500}|0.8001|10|buy"])
    for name in ("inputs", "live_orders"):
        gz(os.path.join(data, "pr5", f"{name}.txt.gz"), [])


def main():
    tmp = tempfile.mkdtemp(prefix="queue_score_test_")
    data, spare = os.path.join(tmp, "data"), os.path.join(tmp, "no_spare_pull")
    os.makedirs(spare)
    write_world(data)
    out = os.path.join(tmp, "score.json")
    R = SC.score(data, out, spare)
    ok(R["scored"] and all(R["checks_1_2_3"].values()), "checks 1, 2 and 3 pass, then the synthetic record is scored")
    c2 = R["check2_reproduces"]
    ok(all(c2[k][x]["every_field_equal"] for k in ("skipping_quiet_minutes", "every_minute") for x in ("pr6", "pr5")),
       "check 2: PR6's 8,341 and PR5's 8,192 committed round trips, every stored field, with and without skipping quiet minutes")
    ok(all(v["void_minutes"] == 0 for v in R["coverage"].values()), "coverage: no void minute on any book")
    for q in ("Q1", "Q2"):
        p = R[q]["primary"]["summary"]
        ok(p["trips"] == 28 and abs(p["pnl_usd"] - 0.14) < 1e-6 and p["fills_by_kind"] == {"queue": 28} and p["stopped"] == 0,
           f"{q}: 28 queue fills of 50 coins, $0.005 each, $0.14")
        ok(R[q]["primary"]["orders_max_day"] == 14 and R[q]["primary"]["orders_per_day"][str(I.W0 // DAY)] == 14
           and R[q]["primary"]["orders_per_day"][str(I.W0 // DAY + 1)] == 2, f"{q}: 14 orders on 10-04, 2 a day after")
        one = 50 * (1.0 - 0.9999) + (100 / 0.9999 - 50) * (0.9999 * (1 - 2 * 0.0009 - 2 * 0.00005) - 0.9999)
        st = R[q]["stress"]["summary"]
        ok(st["trips"] == 9 and st["stopped"] == 9 and abs(st["pnl_usd"] - 9 * one) < 1e-6 and R[q]["3a_through_only"]["summary"]["trips"] == 0,
           f"{q}: stress makes 9 trips, each stopped, {9 * one:.6f} by hand; through-only fills nothing")
        ok(all(R[q][a]["summary"]["trips"] == 28 for a in ("3b_optimistic", "3c_last_print_alone", "3d_live_lag", "3h_middle")),
           f"{q}: arms 3b, 3c, 3d and 3h make the same 28 trips")
        b = R["bar"][q]
        c = b["conditions"]
        ok(b["judged"] and c["1_pnl_gt_0_and_each_half"] and c["2_day_bootstrap_holm"] and not c["3_stress_gt_0"]
           and not c["4_at_least_60_trips_from_1usd_and_no_day_over_1000_orders"] and c["5_no_day_over_40pct"]
           and not c["6_at_least_8pct_a_year_on_1200"] and not c["PASS"] and b["reading"] == "FAIL" and b["detail"]["bootstrap_p"] == 0.0,
           f"{q}: conditions 1, 2, 5 hold, 3, 4, 6 fail: FAIL, judged, p = 0")
        s = b["detail"]["3i_hourly_shift"]
        ok(s["values"] == 671 and abs(s["p95_index_636"] - 0.14) < 1e-9 and abs(s["min"] + 0.04749525) < 1e-9,
           f"{q}: the hourly shift's p95 is $0.14 and its lowest -$0.04749525 (one twin's stop)")
    c4 = R["check4_q3_reproduces_pr5_engine"]
    q3 = R["Q3"]["primary"]["summary"]
    ok(R["Q3_start"] == "2026-10-04T00:00:00.000Z" and q3["trips"] == 1 and abs(q3["pnl_usd"] - Q3_PNL) < 1e-6
       and c4["pass"] and c4["matched_exactly"] == 1 and c4["engine_trips"] == 1, "Q3: one trip, $0.099975; check 4 matches PR5's trip field for field")
    for name, kw, want in (("pnl_off", {"pnl_shift": 0.001}, False), ("pnl_off_miscounted", {"pnl_shift": 0.001, "miscount": True}, True)):
        d2 = os.path.join(tmp, name)
        write_world(d2, **kw)
        R2 = SC.score(d2, os.path.join(tmp, name + ".json"), spare, run_checks=False)
        c = R2["check4_q3_reproduces_pr5_engine"]
        ok(c["pass"] == want and (len(c["differences_allowed"]) == 1) == want and (len(c["differences_not_allowed"]) == 1) != want,
           f"check 4, engine P&L $0.001 off{' and its fill minute miscounted' if want else ''}: {'allowed' if want else 'fails'}")
    ok(R["kraken"]["USDC-USD"]["missing_hours"] == [] and R["kraken"]["USDC-USD"]["disagreements"] == [], "Kraken: every hour needed, no disagreement")
    # An hour rebuilt from trades: 2 at 1.001 and 1 at 1.003 make (2.002 + 1.003) / 3 = 1.0016666..., 10,017 ticks, from 2 trades.
    hb = I.hours_from_trades([("1.001", "2", 7200.5), ("1.003", "1", 10799.9)])
    ok(list(hb) == [7200] and I.vwap_ticks(hb[7200][0]) == 10017 and hb[7200][1] == 2, "Kraken: an hour rebuilt from its trades, in exact decimal")
    p = subprocess.run([sys.executable, "-I", os.path.join(HERE, "score.py"), "--twice", "--spare-kraken", spare, data, out], capture_output=True, text=True)
    c5 = json.load(open(out + ".check5.json"))
    ok(p.returncode == 0 and c5["check5_two_runs_byte_identical"], "check 5: two runs of the scorer write byte-identical JSON")
    shutil.rmtree(tmp)
    print(f"all {n_checks} scorer checks pass")


if __name__ == "__main__":
    main()
