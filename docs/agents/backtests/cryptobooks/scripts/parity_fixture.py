# CRYPTOBOOKS-3 (2026-10-31): the slice the paper engine's port (supabase/functions/agents/mm_core.ts) is pinned on. It takes
# the six busiest hours of XRP-GBP's fills under the frozen card (final_card.FINAL) on the 15 days, and writes everything rule.sim
# was given there and everything it did:
#   - t0 and the slice's seconds: Binance's last XRPUSDT trade of each second (binance_1s.py's .f64) and each minute's USDT/USD
#     and GBP/USD as common.Fair takes them (F = Binance x USDT/USD / GBP/USD, a minute's rates for its sixty seconds);
#   - the Revolut X prints of the slice (data/tape*_XRP-GBP), as the replay's Book filters them;
#   - for the card, and for the card with a 30 bps stop and a ten-minute cool-down (so the stop's path is pinned too): rule.sim's
#     every fill and its books at the end, run on the slice alone (WinBook, as hist_replay.py runs a window).
# Writes results/parity_XRP-GBP.json. Pure Python, no network.
#   CRYPTOBOOKS_BN=<binance_1s.py's output> python3 -I parity_fixture.py
import array, collections, json, os, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import replay  # noqa: E402
from common import ROOT, Fair, load_tape, taker_orders  # noqa: E402
from final_card import FINAL  # noqa: E402
from hist_replay import WinBook, WinFair  # noqa: E402
from rule import DEFAULT, sim  # noqa: E402
from xrp_study import CARD  # noqa: E402

TAG = "1031b"
HOURS = 6
CASES = {"card": {}, "stop30": {"stop": 30.0, "cooldown": 600}}


def main():
    fair = Fair()
    bk = replay.Book("XRP-GBP", fair, tag=TAG)
    r = sim(bk, fair, **(CARD | FINAL))
    per = collections.Counter(int(f[0]) // 3600 for f in r["fill_list"])
    # the busiest run of HOURS hours, starting on the hour
    best = max(per, key=lambda h: sum(per.get(h + i, 0) for i in range(HOURS)))
    t0 = best * 3600 - 1800  # half an hour before, so the slice's own prints warm its basis
    n = HOURS * 3600 + 1800 + 302
    i0 = t0 - fair.t0
    bn = list(fair.bn["XRP"][i0:i0 + n])
    rates = []
    for m in range(t0, t0 + n, 60):
        rates.append([fair.usdt.at(m), fair.fx.at(m)])
    F = array.array("d")
    for i, v in enumerate(bn):
        u, g = rates[i // 60]
        k = u
        k /= g
        F.append(v * k)
    assert all(abs(F[i] - fair.series("XRP-GBP")[i0 + i]) == 0 for i in range(n)), "F differs from Fair.series"
    tape = load_tape("XRP-GBP")
    tape = sorted(set(tape + load_tape("XRP-GBP", TAG)))
    tape = [x for x in tape if t0 + 60 <= x[0] // 1000 < t0 + n - 400]
    wb = WinBook("XRP-GBP", F, t0, None, tape)
    assert wb.orders == taker_orders(tape)
    out = {"book": "XRP-GBP", "t0": t0, "n": n, "bn": bn, "rates": rates, "prints": [list(x) for x in tape],
           "quote_from": t0 + 400, "to": t0 + n - 302, "cases": {}}
    for name, kw in CASES.items():
        params = DEFAULT | CARD | FINAL | kw
        rr = sim(wb, WinFair(n, t0), **params)
        out["cases"][name] = {"params": params, "fills": [[f[0], f[1], f[2], f[3], f[5]] for f in rr["fill_list"]], "end": rr["end"],
                              "total": rr["total"], "steps0": wb.steps[0][0]}
        print(name, len(rr["fill_list"]), rr["end"], rr["total"], flush=True)
    with open(os.path.join(ROOT, "results", "parity_XRP-GBP.json"), "w") as f:
        json.dump(out, f, separators=(",", ":"))


if __name__ == "__main__":
    main()
