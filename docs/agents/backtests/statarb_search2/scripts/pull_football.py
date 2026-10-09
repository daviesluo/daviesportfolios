"""Pull football-data.co.uk's season files (keyless CSV): results with Pinnacle, Betfair Exchange and UK bookmakers' odds.

22 divisions x seasons 2021-22 .. 2026-27 (the last in progress). Each file is kept gzipped, as served, under
inputs/football/<season>_<div>.csv.gz, and its sha256 goes into the manifest. A re-run of 2026-27 reads a longer file.
"""
import gzip, os, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from netget import get

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(HERE, "inputs", "football")
os.makedirs(OUT, exist_ok=True)
DIVS = ["E0", "E1", "E2", "E3", "EC", "SC0", "SC1", "SC2", "SC3", "D1", "D2", "I1", "I2", "SP1", "SP2", "F1", "F2",
        "N1", "B1", "P1", "T1", "G1"]
SEASONS = ["2122", "2223", "2324", "2425", "2526", "2627"]

for s in SEASONS:
    for d in DIVS:
        st, body = get(f"https://football-data.co.uk/mmz4281/{s}/{d}.csv")
        if st != 200 or not body:
            print(s, d, st, file=sys.stderr)
            continue
        open(os.path.join(OUT, f"{s}_{d}.csv.gz"), "wb").write(gzip.compress(body, mtime=0))
        print(s, d, body.count(b"\n"), "lines", file=sys.stderr)
