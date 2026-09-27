"""WXSRC A5: the per-city source table — for every open temperature city, what resolves it, who acts first and when,
the fastest source a keyless reader has, the candidates that need a key or an agreement, and what a faster source could
plausibly leave.

Inputs (all committed): `results/cities_open.json` (Gamma, the open markets), `results/station_edge_2026-09.json`,
`results/hko_edge_2026-09.json` and `results/candidates_2026-09.json` (the exploration month, per station); the delays
they use come from this study's live poll (`results/live_latency.json`) and the speed study's
(`../speed/results/source_latency.json`). The candidate list per national service is written below from primary
sources (the study names each with its URL; all read 2026-09-27); nothing in it is measured unless it says "measured".

usage: source_table.py   (writes results/source_table.json and prints the markdown table)
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import wxcommon as X  # noqa: E402

R = X.RESULTS
READ = "2026-09-27"

# national service and candidates per station (primary sources, read 2026-09-27). "faster" names the one candidate
# that could deliver the deciding value sooner than the first takers act (its delay is unmeasured: it needs a key, an
# account or an agreement Davies has not asked for, or was not tried); "other" lists what is too slow or not the sensor.
SVC = {
    "US": {"service": "NOAA/NWS + FAA (ASOS)",
           "keyless": ["tgftp station file (measured: US file written p50 159 s after the observation)",
                       "aviationweather.gov API (measured: receipt p50 182 s; the API shows it 11 s later)",
                       "IEM currents (measured p50 273 s)", "api.weather.gov (measured: METAR p50 1,421 s)",
                       "MADIS one-minute ASOS (OMO), public: 'the current and previous hour's data are processed every "
                       "5 minutes' (madis.ncep.noaa.gov/madis_OMO.shtml)"],
           "faster": "FAA SWIM Cloud Distribution Service (free, a Service Access Agreement; whether it publishes METAR/SPECI "
                     "or the one-minute OMO is unverified)",
           "other": ["Synoptic HF-ASOS: 'usually arrives with between 2 and 5 minutes latency', whole °C, paid",
                     "Weather Underground / The Weather Company API: personal-station owners or commercial"],
           "audio": "ASOS radio and FAA dial-in lines speak the current OMO (computed each minute) or, at towered airports "
                    "by the controller's choice, the METAR, in whole °C; ATIS changes with each METAR/SPECI; LiveATC is "
                    "personal, non-commercial use only",
           "same_sensor": "yes (the ASOS)", "match": "the OMO carries the 5-minute average the METAR prints; °F from the "
                                                    "T-group, a SPECI without one reads whole °C"},
    "CA": {"service": "ECCC / NAV CANADA",
           "keyless": ["MSC Datamart SWOB-ML CYYZ-MAN (measured live: written 50-363 s after the observation, "
                       "median 82 s over six reports)", "tgftp/AWC (tgftp written ~440 s after it)"],
           "faster": "MSC Datamart AMQP push (anonymous access documented; not tried)", "other": [],
           "audio": "ATIS", "same_sensor": "yes (the manned report, in tenths)", "match": "whole °C, half up (one report)"},
    "HK": {"service": "Hong Kong Observatory (the resolution source itself)",
           "keyless": ["since-midnight max/min CSV, every 10 minutes (measured: Last-Modified a median 438 s and first "
                       "public sighting 511 s after the slot's end, six slots)"],
           "faster": "none found (the first takers act before the slot's end)", "other": [],
           "audio": "none", "same_sensor": "yes (HK Observatory headquarters)",
           "match": "0.1 °C; the CSV's final value decides the winning bucket on 48 of 48 September events"},
    "GB": {"service": "Met Office", "keyless": ["tgftp/AWC"], "faster": "none found",
           "other": ["Met Office Weather DataHub Land Observations: hourly, 150 UK sites, free 360 calls a day"],
           "audio": "ATIS", "same_sensor": "—", "match": "whole °C"},
    "NL": {"service": "KNMI", "keyless": ["tgftp/AWC"], "faster": "none found",
           "other": ["KNMI 10-minute in-situ observations (Schiphol 06240), 'available a few minutes later', an API key"],
           "audio": "ATIS", "same_sensor": "likely", "match": "10-minute means"},
    "FR": {"service": "Météo-France", "keyless": ["tgftp/AWC"],
           "faster": "Météo-France DPObs 6-minute station data (free account and token; latency not stated)", "other": [],
           "audio": "ATIS", "same_sensor": "likely", "match": "6-minute data"},
    "DE": {"service": "DWD", "keyless": ["10-minute 'now' file, Munich airport 01262 (measured: ~30 min behind)",
                                          "POI current weather (speed study: 2,338 s)", "tgftp/AWC"],
           "faster": "none found", "other": [], "audio": "ATIS", "same_sensor": "likely", "match": "10-minute data"},
    "ES": {"service": "AEMET", "keyless": ["tgftp/AWC"], "faster": "none found",
           "other": ["AEMET OpenData: hourly conventional observations, an API key"],
           "audio": "ATIS", "same_sensor": "likely", "match": "hourly"},
    "IT": {"service": "Aeronautica Militare / ENAV", "keyless": ["tgftp/AWC"], "faster": "none found", "other": [],
           "audio": "ATIS", "same_sensor": "—", "match": "—"},
    "PL": {"service": "IMGW-PIB", "keyless": ["IMGW public synop API (hourly)", "tgftp/AWC"], "faster": "none found",
           "other": [], "audio": "ATIS", "same_sensor": "likely", "match": "hourly"},
    "FI": {"service": "FMI", "keyless": ["FMI open WFS, 1-minute t2m, Helsinki-Vantaa (speed study: 133 s)", "tgftp/AWC"],
           "faster": "none found", "other": [], "audio": "ATIS", "same_sensor": "unverified", "match": "tenths"},
    "SG": {"service": "Meteorological Service Singapore (NEA)",
           "keyless": ["NEA 1-minute air temperature (speed study: 74 s) — no station at Changi", "tgftp/AWC"],
           "faster": "none found", "other": [], "audio": "ATIS", "same_sensor": "no", "match": "—"},
    "JP": {"service": "JMA", "keyless": ["AMeDAS 10-minute, Haneda 44166 (speed study: 403 s)", "tgftp/AWC"],
           "faster": "none found", "other": [], "audio": "ATIS", "same_sensor": "unverified", "match": "10-minute"},
    "KR": {"service": "KMA", "keyless": ["tgftp/AWC"],
           "faster": "KMA API Hub AMOS minute data (the aerodrome system; free registration and authKey)", "other": [],
           "audio": "ATIS", "same_sensor": "yes (AMOS)", "match": "1-minute"},
    "TW": {"service": "CWA / CAA", "keyless": ["tgftp/AWC"], "faster": "none found",
           "other": ["CWA open data O-A0003-001, 10-minute, a key; CWA's stations, not the airport's"],
           "audio": "ATIS", "same_sensor": "no", "match": "—"},
    "CN": {"service": "CMA / CAAC", "keyless": ["tgftp/AWC"], "faster": "none found", "other": [],
           "audio": "ATIS", "same_sensor": "—", "match": "—"},
    "OTHER": {"service": "national", "keyless": ["tgftp/AWC"], "faster": "none found", "other": [],
              "audio": "ATIS", "same_sensor": "—", "match": "—"},
}
COUNTRY = {"CYYZ": "CA", "HKO": "HK", "EGLC": "GB", "EHAM": "NL", "LFPB": "FR", "EDDM": "DE", "LEMD": "ES", "LIMC": "IT",
           "EPWA": "PL", "EFHK": "FI", "WSSS": "SG", "RJTT": "JP", "RKSI": "KR", "RKPK": "KR", "RCSS": "TW"}


def country(st):
    if st.startswith("K"):
        return "US"
    if st.startswith("Z"):
        return "CN"
    return COUNTRY.get(st, "OTHER")


def main():
    cities = json.load(open(os.path.join(R, "cities_open.json")))["cities"]
    se = json.load(open(os.path.join(R, "station_edge_2026-09.json")))["stations"]
    hk = json.load(open(os.path.join(R, "hko_edge_2026-09.json")))
    ca = json.load(open(os.path.join(R, "candidates_2026-09.json")))["stations"]
    rows = []
    for city, c in cities.items():
        st = c["stations"][0] if c["stations"] else None
        if not st or c["dates"][-1] < "2026-09-01":
            continue
        cc = country(st)
        svc = SVC[cc]
        row = {"city": city, "station": st, "resolution": c["sources"][0], "units": c["units"][0], "country": cc,
               "service": svc["service"], "keyless_candidates": svc["keyless"], "faster_candidate": svc["faster"],
               "other_candidates": svc["other"],
               "audio": svc["audio"], "same_sensor": svc["same_sensor"], "match": svc["match"],
               "open_volume_usd": c["open_volume_usd"]}
        if st == "HKO":
            # "keyless" for Hong Kong is the Observatory's own since-midnight CSV, at the live poll's first sighting
            # of a new version (+ a 1 s taker's 4.25 s); the edge taken before is everything on the stale side after
            # the slot's end and before that instant (the value was reached inside the slot's ten minutes)
            e = hk["net_edge_left_after_slot_usd"]["all_held"]
            after = hk["net_edge_left_after_live_public_usd"]["all_held"]
            arm = hk["uslate_fill_model"]["arms"]["live_first_seen"]
            row.update({"sept_volume_usd": hk["volume_usd"],
                        "informative_deaths": hk["bucket_deaths"]["informative_held"],
                        "first_cut_p50_s": hk["first_stale_print_vs_slot_s_informative"].get("p50"),
                        "first_cut_basis": "seconds after the ten-minute slot's end (the value was reached inside it)",
                        "keyless_p50_s": hk["live_public_after_slot_s"]["first_seen_p50"],
                        "keyless_basis": "the since-midnight CSV's first public sighting after the slot (live poll)",
                        "edge_before_keyless_usd": round(e["0"] - after, 2), "edge_after_keyless_usd": after,
                        "keyless_1s_uslate_pnl_usd": arm["pnl_usd"], "keyless_1s_buckets": arm["buckets_filled"]})
        elif st in se:
            v = se[st]
            row.update({"sept_volume_usd": v["volume_usd"], "informative_deaths": v["bucket_deaths"]["informative_held"],
                        "traps": v["bucket_deaths"]["trap"],
                        "first_cut_p50_s": v["first_stale_print_after_obs_s_informative"].get("p50"),
                        "first_cut_basis": "seconds after the deciding report's observation time",
                        "keyless_p50_s": v["keyless_written_after_obs_s"].get("p50"),
                        "keyless_basis": "tgftp's file written: AWC's receipt less 7.7 s (US) or 1.4 s (elsewhere)",
                        "awc_receipt_p50_s": v["awc_receipt_after_obs_s"].get("p50"),
                        "edge_before_keyless_usd": v["net_edge_before_keyless_usd_held"],
                        "edge_after_keyless_usd": v["net_edge_after_keyless_usd_held"],
                        "top_first_taker": (v["first_stale_print_wallets_top"] or [[None, 0]])[0],
                        "keyless_1s_uslate_pnl_usd": ca[st]["pnl_usd"], "keyless_1s_buckets": ca[st]["buckets_filled"],
                        "keyless_1s_traps": ca[st]["traps_filled"]})
            if st == "CYYZ":
                row["swob_written_p50_s"] = ca["CYYZ@swob"]["source_delay"][1]
                row["swob_1s_uslate_pnl_usd"] = ca["CYYZ@swob"]["pnl_usd"]
                row["swob_1s_buckets"] = ca["CYYZ@swob"]["buckets_filled"]
        rows.append(row)
    rows.sort(key=lambda r: -(r.get("edge_before_keyless_usd") or 0))
    for i, r in enumerate(rows, 1):
        r["rank"] = i
    out = {"read": READ, "note": "edge figures: September 1-26 (26 days), held buckets, whole prints, net of the fee",
           "rows": rows}
    X.write_result("source_table.json", out)
    print("| # | city (station) | first cut p50 | keyless p50 | taken before the keyless source | left after | 1 s keyless taker | the faster candidate |")
    print("|---|---|---:|---:|---:|---:|---:|---|")
    for r in rows:
        fast = r["faster_candidate"].split(" (")[0]
        pnl = r.get("keyless_1s_uslate_pnl_usd")
        taker = ("%+.2f" % pnl) if pnl is not None else "— (no report archive)"
        if r.get("swob_1s_uslate_pnl_usd") is not None:
            taker = "%+.2f (SWOB-ML); %s (tgftp)" % (r["swob_1s_uslate_pnl_usd"], taker)
        fc = r.get("first_cut_p50_s")
        kp = r.get("keyless_p50_s")
        if r["station"] == "HKO":
            fc_s, kp_s = "%.0f s (slot end)" % fc, "%.0f s (slot end, CSV)" % kp
        elif r.get("swob_written_p50_s") is not None:
            fc_s = "%.0f s" % fc
            kp_s = "%.0f s (SWOB-ML); %.0f s (tgftp)" % (r["swob_written_p50_s"], kp)
        else:
            fc_s = "%.0f s" % fc if fc is not None else "—"
            kp_s = "%.0f s" % kp if kp is not None else "—"
        print("| %d | %s (%s) | %s | %s | $%s | $%s | %s | %s |" % (
            r["rank"], r["city"], r["station"], fc_s, kp_s,
            format(r.get("edge_before_keyless_usd") or 0, ",.0f"), format(r.get("edge_after_keyless_usd") or 0, ",.0f"),
            taker, fast))


if __name__ == "__main__":
    main()
