"""Fetch Ken French data-library files (keyless) into ../inputs/ as .csv.gz.

Only the raw files are stored. NOTHING is parsed or printed here except each
file's size and sha256: the screen scripts cut every series at 2015-12-31 the
moment they parse it (held-out 2016-01 -> 2026-08 stays unseen).
"""
import gzip, hashlib, io, json, os, sys, time, urllib.request, zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "inputs")
BASE = "https://mba.tuck.dartmouth.edu/pages/faculty/ken.french/ftp/"
FILES = [
    "49_Industry_Portfolios_daily",
    "49_Industry_Portfolios",
    "12_Industry_Portfolios_daily",
    "Portfolios_Formed_on_ME_daily",
    "6_Portfolios_ME_Prior_1_0_daily",
    "Portfolios_Formed_on_VAR",
    "Developed_3_Factors_Daily",
    "Developed_ex_US_3_Factors_Daily",
    "Europe_3_Factors_Daily",
    "Japan_3_Factors_Daily",
    "Asia_Pacific_ex_Japan_3_Factors_Daily",
    "North_America_3_Factors_Daily",
]
log = {}
for name in FILES:
    dst = os.path.join(OUT, name + ".csv.gz")
    if not os.path.exists(dst):
        url = BASE + name + "_CSV.zip"
        req = urllib.request.Request(url, headers={"User-Agent": "research-script/1.0"})
        raw = urllib.request.urlopen(req, timeout=60).read()
        z = zipfile.ZipFile(io.BytesIO(raw))
        inner = [n for n in z.namelist() if n.lower().endswith(".csv")]
        assert len(inner) == 1, (name, z.namelist())
        data = z.read(inner[0])
        with gzip.GzipFile(dst, "wb", mtime=0) as g:
            g.write(data)
        time.sleep(1.0)
    b = open(dst, "rb").read()
    log[name] = {"bytes": len(b), "sha256": hashlib.sha256(b).hexdigest(), "url": BASE + name + "_CSV.zip"}
    print(name, log[name]["bytes"], log[name]["sha256"][:16])
json.dump(log, open(os.path.join(OUT, "french_fetch_log.json"), "w"), indent=1, sort_keys=True)
