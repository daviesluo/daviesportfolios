"""FX-SPEED part 4: the OKX rows' inputs with a faster EUR/USD, for the OKX twins' own engine (`stepOkxMinute`, called unchanged
by `fair_price_cb_okx/scripts/okx_replay.ts`).

Takes the Coinbase/OKX study's prepared tape (`okx_replay_prep.py`'s output, made from its committed pulls: EURC-USDC from
2026-10-20, USDG-EUR from 10-27), cuts it at 2026-10-29 00:00 (where Exness's file ends), keeps its `par` (Yahoo's EUR/USD,
the rows' rule) and adds the `fast.py` candidates as the EUR/USD the engine reads (orders priced at minute t live from t + 60 s,
`live: t + M` in okx_quotes.ts). Outside a closure only; in a closure, and wherever Yahoo is dark, the candidate is Yahoo's
value, so the engine holds and goes dark exactly as it does today.
usage: python3 -I okx_prep.py STUDY_PREP.json OUT.json
"""
import json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, "..", "..", "fair_price_cb_okx", "scripts"))
import fpc as C  # noqa: E402
import fast as F  # noqa: E402

GOLIVE_S = 60
T1 = C.iso_ms("2026-10-29T00:00:00Z")


def main(prep_path, out_path):
    prep = json.load(open(prep_path))
    fx = C.load_fx()
    fast = F.Fast({k: dict(zip(*v)) for k, v in fx.items()})
    ins = F.instants(GOLIVE_S)
    out = {}
    for b, d in prep.items():
        keep = [i for i, t in enumerate(d["minutes"]) if t < T1]
        n = len(keep)
        ms = [d["minutes"][i] for i in keep]
        eur = [d["cands"]["par"][i] for i in keep]
        cands = {"par": eur}
        for name, rel in ins.items():
            for mode in ("aligned", "raw") if name in ("ex_ytime", "L2") else ("aligned",):
                col = []
                for i, t in enumerate(ms):
                    if not eur[i] or C.is_closure(t):
                        col.append(eur[i]); continue
                    xc = fast.x("EURUSD", t, rel, mode == "aligned")
                    col.append(xc if xc else eur[i])
                cands[f"{name}:{mode}"] = col
        out[b] = {"t0": d["t0"], "minutes": ms, "gbpusd": [d["gbpusd"][i] for i in keep], "cands": cands, "tick": d["tick"],
                  "prints": [p for p in d["prints"] if p[0] < T1], "touches": [x for x in d["touches"] if x["at"] < T1]}
        print(b, n, "minutes", len(out[b]["prints"]), "prints")
    json.dump(out, open(out_path, "w"))


if __name__ == "__main__":
    main(*sys.argv[1:3])
