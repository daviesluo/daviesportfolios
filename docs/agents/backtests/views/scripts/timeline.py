"""VIEWS exploration: one event's prints around its deadline, second by second (printed; nothing written).

Each print as the YES token's taker side and price, for every market, from T − before to T + after, marked stale (the
side the outcome makes wrong) or not. Refuses a held-out event.

usage: timeline.py <universe json> <split json> <posting json> <event id or slug> [before_s after_s]
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import vcommon as V  # noqa: E402
from near_t import yes_view  # noqa: E402


def main():
    if "--out" in sys.argv:  # write what would be printed to a file (run_all.py keeps one close call's timeline)
        i = sys.argv.index("--out")
        sys.stdout = open(sys.argv[i + 1], "w")
        del sys.argv[i:i + 2]
    uni = {e["event"]: e for e in V.jfile(sys.argv[1])["events"]}
    split = V.jfile(sys.argv[2])
    post = {r["event"]: r for r in V.jfile(sys.argv[3])["events"]}
    key = sys.argv[4]
    eid = key if key in uni else next(k for k, e in uni.items() if e["slug"] == key)
    if eid in split["held_out_events"] or eid not in split["exploration_events"]:
        raise SystemExit("not an exploration event")
    before, after = (int(sys.argv[5]), int(sys.argv[6])) if len(sys.argv) > 6 else (900, 900)
    e, T = uni[eid], post[eid]["T"]
    lab = {m["cond"]: (m["title"] or m["q"][:20], m["payout_yes"]) for m in e["markets"]}
    rows = V.prints(eid)
    print(e["slug"], "T", V.iso(T), post[eid]["p_source"], "winner", e["winner"])
    if "--bins" in sys.argv:
        # per 30 s and market: prints, the YES-equivalent price range, shares, and the stale side's shares
        from collections import defaultdict
        b = defaultdict(lambda: [0, 9.0, -1.0, 0.0, 0.0])
        for r in rows:
            if not (T - before <= r[0] <= T + after):
                continue
            side, y = yes_view(r[2], r[3], r[4])
            title, pay = lab.get(r[1], ("?", None))
            st = (pay == 1.0 and side == "BUY" and y <= 0.99) or (pay == 0.0 and side == "SELL" and y >= 0.01)
            k = (int((r[0] - T) // 30) * 30, title + ("*" if pay == 1.0 else ""))
            a = b[k]
            a[0] += 1; a[1] = min(a[1], y); a[2] = max(a[2], y); a[3] += r[5]; a[4] += r[5] if st else 0.0
        last = None
        for (t, title), a in sorted(b.items()):
            if t != last:
                print(f"\n{t:+6d}s", end="")
                last = t
            print(f" | {title} n{a[0]} {a[1]:.3f}-{a[2]:.3f} sh{a[3]:.0f} stale{a[4]:.0f}", end="")
        print()
        return
    for r in rows:
        if not (T - before <= r[0] <= T + after):
            continue
        side, y = yes_view(r[2], r[3], r[4])
        title, pay = lab.get(r[1], ("?", None))
        st = (pay == 1.0 and side == "BUY" and y <= 0.99) or (pay == 0.0 and side == "SELL" and y >= 0.01)
        print(f"{int(r[0] - T):+6d}s {title:>12} {'WIN' if pay == 1.0 else '   '} taker {side:4} YES@{y:.3f} x{r[5]:10.2f} "
              f"{'STALE' if st else ''}")


if __name__ == "__main__":
    main()
