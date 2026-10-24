"""A synthetic record for PR5V's and rule D's reading scripts, whose right answers are worked out by hand below (EXPECT).
Written 2026-10-24; no production row is in it. `test_reading.py` writes it in the exports' own format (the lines
`reading_pull.sql` / `reading_pull_ruled.sql` return, as `reading_grab.py` writes them, minutes and events in weekly
pages) and runs both readings on it.

The world, on the pre-registrations' real dates (start 2026-09-28 00:00, window 09-29 -> 10-26, E 10-28 00:30):

* Both books, every minute: X = 1.25, fairU = 1.0, so fair f = 0.8000 GBP = 8,000 ticks. The nine rungs then rest at
  bids 7997, 7996, 7994, 7992, 7990, 7988, 7984, 7980, 7976 and asks 8003, 8004, 8006, 8008, 8010, 8012, 8016, 8020, 8024
  (floor(f(1 - k)), ceil(f(1 + k))). From 2026-10-15 12:00 USDT-GBP's fairU is 1.0004: fair moves +0.04 %.
* Each day D from 09-28 to 10-27, at A = D 10:00 and B = D 10:05, on USDC-GBP only: a SELL of 3,000 at 0.7995 (A + 10 s)
  and a BUY of 1 at 0.7999 (A + 30 s); a BUY of 10 at 0.8002 (B + 10 s). Minute B is dark on both books (X recorded
  null). One seed print before the start (USDC-GBP, 09-27 23:59:30, a BUY of 1 at 0.8000). USDT-GBP never prints.

By hand, for arm main (and v1, and d: rule D never acts on USDC-GBP's still fair):
* At A the SELL at 7995 is strictly through the bids at 7997 and 7996 only. The minute's volume is
  3000 x 0.7995 + 1 x 0.7999 = 2,399.2999 GBP, its 10 % cap 2,399.2999 x 0.10 x 1.25 = $299.91; nearest first, each bid
  takes $100. Their exits (asks at 8,000) are placed at A + 1 and live at A + 2 (the last print, 7999 BUY, is not through
  them); at B the BUY at 8002 fills both at 0.8000. A trip at T ticks makes 100 x (8000 - T) / T dollars:
  k = 0.03 %: 100 x 3 / 7997 = $0.037514068; k = 0.05 %: 100 x 4 / 7996 = $0.050025013. Two trips a day.
* The window's 28 days: 56 trips, 28 x (0.037514068 + 0.050025013) = $2.451094.
* Stress (a print one tick further through): only the 7997 bid fills (7995 < 7996); its exit needs a print above 8001 and
  8002 is: 28 x $0.037514068 = $1.050394 > 0.
* The null: its pool on USDC-GBP is the 28 minutes A of the window (B is dark, and nothing else prints). Every twin enters
  at A's last print, the BUY at 7999, with min(100, $299.91) = $100, and exits at B at 8000: 100 x 1 / 7999 =
  $0.012501563. Every draw is 56 of them, $0.700088, so p95 = 0.7001 (study.py rounds it). 2.451094 > 0.7001: a pass.
  The study's own null_twins, with every twin cut at N1 = 2026-09-23, gives 0 on every draw (p95 0.0).
* PR5 (fixture): one trip a window day of +$0.01 (and one of +$5 on 09-28 and on 10-27, outside the window). The daily
  difference is 0.087539081 - 0.01 = +$0.077539 every day, so every resampled mean is +0.0775 and p <= 0 is 0: a pass.
* The governor: each day the bid key of USDC-GBP sends 2 exits (A + 1) and 9 placements (B + 1, after B's dark
  withdrawals): 11 a day, 20 on 09-28 (9 more at 00:00); each other key 9 a day, 18 on 09-28; USDT-GBP's keys 18 on
  10-15 too, when all nine rungs re-price on the +0.04 % move (0.04 % > 0.03 %). Arm d re-prices there only k <= 0.10 %
  (its step max(0.03 %, k/3): 0.0333 % for k = 0.10 % is under 0.04 %, 0.0417 % for k = 0.125 % is not): 13. All under 900.
* Arm top5 (k = 0.05 ... 0.15 %): only the 7996 bid fills: 28 x $0.050025013 = $1.400700; its stress fills nothing
  ($0, condition 4 false); its null 28 x 0.012501563 = 0.350044 (p95 0.35).
* Rule D: arm d equals PR5V's main in the fixture, so the deviation check passes (shares 1, daily difference 0) and
  condition 3's daily difference is 0 every day: every resampled mean is 0, p <= 0 is 1: a fail.
"""
import os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import reading_common as C  # noqa: E402

M, DAY = C.M, C.DAY
DAYS = [C.START + i * DAY for i in range(30)]                     # 09-28 .. 10-27: the days with a cycle
MOVE = C.ms("2026-10-15T12:00")                                    # USDT-GBP's fairU 1.0 -> 1.0004
FIRST_LIVE = C.ms("2026-10-10T00:00")                              # PR5's first live order (synthetic)
WEEKS = [C.ms(d) for d in ("2026-09-28T00:00", "2026-10-05T00:00", "2026-10-12T00:00", "2026-10-19T00:00", "2026-10-26T00:00")] + [C.E]
RUNGS = {"main": C.NINE, "v1": C.NINE, "d": C.NINE, "top5": C.TOP5}
A_OFF, B_OFF = 10 * 60 * M, (10 * 60 + 5) * M
MISCOUNT = ("USDC-GBP", C.ms("2026-10-03T10:00"))                  # its recorded prints_n is 3, the export holds 2
REBUILT = ("USDC-GBP", C.ms("2026-10-20T03:00"))


def rt_bid(k):
    return C.V.rt(0.8, k, "bid")


def prints():
    out = [("seed", "USDC-GBP", C.START - 30000, "0.8000", "1", "buy")]
    for d in DAYS:
        tag = C.iso(d)[:10]
        out += [(f"{tag}-a", "USDC-GBP", d + A_OFF + 10000, "0.7995", "3000", "sell"),
                (f"{tag}-b", "USDC-GBP", d + A_OFF + 30000, "0.7999", "1", "buy"),
                (f"{tag}-c", "USDC-GBP", d + B_OFF + 10000, "0.8002", "10", "buy")]
    return out


def minutes(ruled):
    n = {}
    for p in prints():
        if C.START <= p[2] < C.E:
            n[(p[1], p[2] // M * M)] = n.get((p[1], p[2] // M * M), 0) + 1
    out = []
    for b in C.BOOKS:
        for m in range(C.START, C.E, M):
            dark = (m - C.START) % DAY == B_OFF
            x = "" if dark else "1.25"
            fu = "1.0004" if (b == "USDT-GBP" and m >= MOVE) else "1.0"
            pn = n.get((b, m), 0)
            if (b, m) == MISCOUNT:
                pn = 3
            src = "rebuilt" if (b, m) == REBUILT else "minutes"
            row = [b, str(m), src, x, fu, str(pn), str(pn)]
            if ruled:
                row += [x, "yahoo", "", ""]
            out.append((m, "|".join(row)))
    return out


def trip_line(arm, d, k, pnl_shift=0.0):
    t = rt_bid(k)
    e = t * C.TICK
    tag = C.iso(d)[:10]
    pnl = 100.0 * (8000 - t) / t + pnl_shift
    return "|".join([arm, "USDC-GBP/bid", "USDC-GBP", "bid", repr(k), str(d + A_OFF), str(d + A_OFF + 10000), f"{tag}-a", repr(e),
                     repr(80.0 / e), "1.25", "0.8", "1", str(d + B_OFF), "0.8", "maker", f"{tag}-c", "2", "100", repr(pnl)])


def filled(arm):
    return [0.0003, 0.0005] if arm in ("main", "v1", "d") else [0.0005]


def trips(arms, pnl_shift=None):
    pnl_shift = pnl_shift or {}
    return [trip_line(a, d, k, pnl_shift.get(a, 0.0)) for a in arms for d in DAYS for k in filled(a)]


def events(arms):
    """Every POST and withdrawal the engine makes in this world, with each POST's running count of its key that day."""
    ev = []                                             # (minute, arm, book, side, k, kind, what, why)
    for a in arms:
        rungs = RUNGS[a]
        for b in C.BOOKS:
            for s in ("bid", "ask"):
                for k in rungs:
                    ev.append((C.START, a, b, s, k, "order", "place", ""))
            for d in DAYS:
                if b == "USDC-GBP":
                    for k in filled(a):
                        ev.append((d + A_OFF + M, a, b, "bid", k, "order", "exit", ""))
                for s in ("bid", "ask"):
                    for k in rungs:
                        if not (b == "USDC-GBP" and s == "bid" and k in filled(a)):
                            ev.append((d + B_OFF, a, b, s, k, "withdraw", "", "dark"))
                        ev.append((d + B_OFF + M, a, b, s, k, "order", "place", ""))
                if b == "USDT-GBP" and d == MOVE // DAY * DAY:
                    for s in ("bid", "ask"):
                        for k in rungs:
                            step = max(0.0003, k / 3) if a == "d" else 0.0003
                            if 1.0004 / 1.25 / 0.8 - 1 > step:
                                ev.append((MOVE, a, b, s, k, "order", "reprice", ""))
    ev.sort(key=lambda e: (e[0], e[1], C.BOOKS.index(e[2]), e[3] != "bid", e[4]))
    count = {}
    out = []
    for m, a, b, s, k, kind, what, why in ev:
        key = f"{b}/{s}"
        n = ""
        if kind == "order":
            c = (a, key, m // DAY)
            count[c] = count.get(c, 0) + 1
            n = str(count[c])
        out.append((m, "|".join([a, b, str(m), s, repr(k), kind, what, key, "", n, why])))
    return out


def pr5_trips():
    out = []
    for d in DAYS:
        pnl = 5.0 if d in (DAYS[0], DAYS[-1]) else 0.01
        out.append("|".join(["USDC-GBP", "bid", "0.001", str(d + 12 * 60 * M), str(d + 12 * 60 * M + 1000), "x", "0.7992", "100.1",
                             "1.25", "0.8", "1", str(d + 13 * 60 * M), "0.8", "maker", "y", "2", "100", repr(pnl)]))
    return out


def write_pages(data, name, rows):
    for i in range(len(WEEKS) - 1):
        lo, hi = WEEKS[i], WEEKS[i + 1]
        with open(os.path.join(data, f"{name}.{i + 1}.txt"), "w") as f:
            f.writelines(line + "\n" for m, line in rows if lo <= m < hi)


def write(data, ruled=False, drop_trips=(), pnl_shift=None, extra_events=(), meta_over=None, drop_minutes=()):
    """Write the fixture's export into `data`. The keyword arguments make the deliberately broken copies the test uses."""
    os.makedirs(data, exist_ok=True)
    with open(os.path.join(data, "prints.txt"), "w") as f:
        f.writelines("|".join(map(str, p)) + "\n" for p in prints())
    mins = [r for r in minutes(ruled) if (r[1].split("|")[0], r[0]) not in drop_minutes]
    write_pages(data, "minutes", mins)
    arms = ("d", "v1") if ruled else ("main", "top5")
    tl = trips(arms, pnl_shift)
    tl = [line for i, line in enumerate(tl) if i not in drop_trips]
    with open(os.path.join(data, "trips.txt"), "w") as f:
        f.writelines(line + "\n" for line in tl)
    ev = events(arms) + list(extra_events)
    write_pages(data, "events", ev)
    if ruled:
        with open(os.path.join(data, "pr5v_main_trips.txt"), "w") as f:
            f.writelines(line + "\n" for line in trips(("main",), pnl_shift))
    else:
        with open(os.path.join(data, "pr5_trips.txt"), "w") as f:
            f.writelines(line + "\n" for line in pr5_trips())
    last = C.E - M
    meta = ({"ruled_last_minute": last, "ruled_code_version": 4, "ruled_last_error": "", "pr5_last_minute": last, "pr5v_last_minute": last,
             "first_live_order": FIRST_LIVE, "check_max_usd": 0, "check_days": 30} if ruled else
            {"variant_last_minute": last, "variant_code_version": 3, "variant_last_error": "", "pr5_last_minute": last, "first_live_order": FIRST_LIVE})
    meta.update(minutes_n=len(mins), events_n=len(ev), trips_n=len(tl))
    if not ruled:
        meta["pr5_trips_n"] = len(pr5_trips())
    meta.update(meta_over or {})
    with open(os.path.join(data, "meta.txt"), "w") as f:
        f.write("|".join(f"{k}={v}" for k, v in meta.items()) + "\n")


# ------------------------------------------------------------------ the answers, by hand (see the docstring)
P03, P05, TWIN = 100 * 3 / 7997, 100 * 4 / 7996, 100 * 1 / 7999
EXPECT = {
    "main": {"window_trips": 56, "window_pnl": 28 * (P03 + P05), "stress_pnl": 28 * P03, "null_p95": round(56 * TWIN, 4),
             "paired_mean": round(P03 + P05 - 0.01, 4), "paired_p_le_0": 0.0, "max_posts_key_day": 20,
             "posts_window": {"USDC-GBP/bid": 11, "USDC-GBP/ask": 9, "USDT-GBP/bid": 9, "USDT-GBP/ask": 9}, "posts_1015_usdt": 18},
    "top5": {"window_trips": 28, "window_pnl": 28 * P05, "stress_pnl": 0.0, "null_p95": round(28 * TWIN, 4), "stress_pass": False},
    "d": {"window_trips": 56, "window_pnl": 28 * (P03 + P05), "paired_p_le_0": 1.0, "posts_1015_usdt": 13},
    "first_live": {"before_days": 11, "from_days": 17, "before_arm": 11 * (P03 + P05), "before_pr5": 11 * 0.01},
    "print_count_differs": [{"book": "USDC-GBP", "minute": "2026-10-03T10:00:00Z", "exported": 2, "recorded": 3}],
    "rebuilt": ["2026-10-20T03:00:00Z"],
}
