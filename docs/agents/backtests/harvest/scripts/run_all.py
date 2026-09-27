"""HARVEST phase 1: every analysis from the committed inputs, twice, with the sha256 of each result; and a check that
the five unit steps, re-run offline from the committed source pulls, give the units the committed inputs hold.

Run from the repository root. The pull steps (`universe_pull.py`, `prints_pull.py`, `maker_pull.py`) and
`inputs_build.py` read the network or the raw pulls and are not re-run here. The unit steps (`econ_units.py`,
`counts_units.py`, `mentions_units.py`, `quakes_units.py`, `temperature_units.py`) read only committed files when
HARVEST_DATA points at `inputs/sources` (the publishers' values, the tracker's posts, USGS's product histories, the
data API's resolution records, all as pulled on 2026-09-27); their units are compared with the committed inputs'.

usage: python3 docs/agents/backtests/harvest/scripts/run_all.py [--once]
"""
import hashlib
import os
import subprocess
import sys
import tempfile

sys.dont_write_bytecode = True

ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
S = os.path.join(ROOT, "scripts")
I = os.path.join(ROOT, "inputs")
R = os.path.join(ROOT, "results")
CATS = ["econ", "counts", "mentions", "quakes", "temperature"]


def steps(out):
    st = [(c + ".json", ["harvest.py", os.path.join(I, c + ".json.gz"), os.path.join(out, c + ".json")]) for c in CATS]
    st += [("econ_excl_dissent.json", ["harvest.py", os.path.join(I, "econ.json.gz"),
                                       os.path.join(out, "econ_excl_dissent.json"), "--exclude-events", "287482"]),
           ("temperature_excl_top.json", ["harvest.py", os.path.join(I, "temperature.json.gz"),
                                          os.path.join(out, "temperature_excl_top.json"), "--exclude-events", "247562"]),
           ("power.json", ["power.py", os.path.join(I, "split.json"), os.path.join(out, "power.json")] +
            [os.path.join(I, c + ".json.gz") for c in CATS]),
           ("makers.json", ["makers.py", os.path.join(I, "maker_sample.json.gz"), os.path.join(out, "makers.json")]),
           ("summary.json", ["summary.py", out, I, os.path.join(out, "summary.json")])]
    return st


def sha(p):
    return hashlib.sha256(open(p, "rb").read()).hexdigest()


def run(out):
    env = dict(os.environ, PYTHONDONTWRITEBYTECODE="1")
    for name, (script, *args) in steps(out):
        subprocess.run([sys.executable, os.path.join(S, script), *args], check=True, env=env, stdout=subprocess.DEVNULL)
    return {name: sha(os.path.join(out, name)) for name, _ in steps(out)}


def units_check():
    """Re-run the unit steps offline and compare (cond, C, w, r, kind, record_ok) with the committed inputs."""
    sys.path.insert(0, S)
    import hcommon as H
    env = dict(os.environ, PYTHONDONTWRITEBYTECODE="1", HARVEST_DATA=os.path.join(I, "sources"))
    ok = True
    with tempfile.TemporaryDirectory() as tmp:
        jobs = {
            "econ": ["econ_units.py", os.path.join(I, "universe_econ.json.gz"), os.path.join(I, "universe_other.json.gz"),
                     os.path.join(I, "split.json")],
            "counts": ["counts_units.py", os.path.join(I, "universe_other.json.gz"), os.path.join(I, "split.json")],
            "mentions": ["mentions_units.py", os.path.join(I, "universe_other.json.gz"), os.path.join(I, "split.json")],
            "quakes": ["quakes_units.py", os.path.join(I, "universe_other.json.gz"), os.path.join(I, "split.json")],
            "temperature": ["temperature_units.py", os.path.join(I, "universe_temperature.json.gz"),
                            os.path.join(ROOT, "..", "pmlate", "inputs", "uslate_2026-03_2026-08.json.gz"),
                            os.path.join(tmp, "split_temperature.json")],
        }
        for cat, (script, *args) in jobs.items():
            u_out, f_out = os.path.join(tmp, cat + "_units.json"), os.path.join(tmp, cat + "_floors.json")
            subprocess.run([sys.executable, os.path.join(S, script), *args, u_out, f_out], check=True, env=env,
                           stdout=subprocess.DEVNULL)
            key = lambda x: (x["cond"], round(x["C"], 3), x["w"], x["r"], x.get("kind"), x.get("record_ok"))  # noqa
            fresh = {x["cond"]: key(x) for x in H.jfile(u_out)["units"]}
            committed = [key(x) for x in H.jfile(os.path.join(I, cat + ".json.gz"))["units"]]
            diff = [k for k in committed if fresh.get(k[0]) != k]
            print("units", cat, "committed", len(committed), "re-run", len(fresh), "differ", len(diff))
            ok &= not diff
        if not ok:
            raise SystemExit("unit steps differ from the committed inputs")


def main():
    first = run(R)
    for k, v in first.items():
        print(k, v)
    if "--once" in sys.argv:
        return
    with tempfile.TemporaryDirectory() as tmp:
        second = run(tmp)
    same = all(first[k] == second[k] for k in first)
    print("second run byte-identical:", same)
    if not same:
        raise SystemExit([k for k in first if first[k] != second[k]])
    units_check()


if __name__ == "__main__":
    main()
