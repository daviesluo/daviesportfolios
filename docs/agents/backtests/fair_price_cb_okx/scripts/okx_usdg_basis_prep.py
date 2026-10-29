"""Inputs of the OKX-engine re-test of the USDG/EUR basis fair (okx_usdg_basis_replay.ts): every USDG-EUR print from OKX's daily
archive (../inputs/okx_usdgeur_archive.json.gz, fetch_okx_archive.py) and from the recorder's own tape (inputs/prod/
okx_trades.txt.gz, 10-26 → 10-29), de-duplicated by trade id; EUR/USD minutes (SCQ-VENUES' committed series to 2026-10-08,
Exness to 09-30 then Yahoo, then the stored Yahoo minutes the OKX twins read); the recorded touch (10-28 19:53 on).
usage: python3 -I okx_usdg_basis_prep.py OUT.json
"""
import gzip, json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
BT = os.path.normpath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(BT, "scq_venues", "scripts"))
import fpc as C  # noqa: E402
import sv_inputs as SI  # noqa: E402

M = C.M
T0, T1 = C.iso_ms("2026-02-23T00:00:00Z"), C.iso_ms("2026-10-29T05:30:00Z")


def main(out_path):
    arc = json.load(gzip.open(os.path.join(C.ROOT, "inputs", "okx_usdgeur_archive.json.gz"), "rt"))
    pr = {int(p[0]): [int(p[1]), round(float(p[2]) / 1e-4), float(p[3]), "buy" if p[4] == "b" else "sell", int(p[0])] for p in arc["prints"]}
    n_arc = len(pr)
    for l in C.lines("okx_trades"):
        book, tid, ts, px, sz, side = l.split("\t")
        if book == "USDG-EUR":
            pr[int(tid)] = [int(ts), round(float(px) / 1e-4), float(sz), side, int(tid)]
    prints = sorted((p for p in pr.values() if T0 - C.DAY <= p[0] < T1), key=lambda p: (p[0], p[4]))
    et, ev = SI.load_eurusd()
    cut = C.iso_ms("2026-10-08T00:00:00Z")
    bars = {t: v for t, v in zip(et, ev) if T0 - 4 * C.DAY <= t < cut}
    fx = C.load_fx()["EURUSD"]
    for t, v in zip(*fx):
        if t >= cut:
            bars[t] = v
    for l in C.lines("fx_1029"):
        k, m, v = l.split("\t")
        if k == "EURUSD":
            bars[int(m) * M] = float(v)
    touches = []
    for l in C.lines("okx_books"):
        book, ts, bid, ask, bs, az = l.split("\t")
        if book == "USDG-EUR":
            touches.append({"at": int(ts), "bid": float(bid), "ask": float(ask)})
    out = {"t0": T0, "t1": T1, "prints": prints, "eur": sorted(bars.items()), "touches": sorted(touches, key=lambda x: x["at"])}
    json.dump(out, open(out_path, "w"))
    print({"prints": len(prints), "archive": n_arc, "with_recorder": len(pr), "eur_bars": len(bars), "touches": len(touches)})


if __name__ == "__main__":
    main(sys.argv[1])
