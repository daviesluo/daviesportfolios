# WXSRC phase 1: the race for the report is already run, and the models are already in the price (2026-09-27)

Davies, 2026-09-27, on PMLATE's result: "can we keep researching the data source? Or weather models, e.g. Google's new
environmental/weather model — every city's data source is probably different, so it feels like there is still room."
This is phase 1 of that question: measurement, exploration and power checks. Nothing was placed, no account was
opened, no key was used, and every read was a keyless GET. Scripts, results and the pull manifest are in
`backtests/wxsrc/`; every number below comes from a file named beside it, or from a primary source cited with the date
it was read (all 2026-09-27).

Speed is priced at one second (Davies, 2026-09-26), with USLATE-FAST's conventions
(`2026-09-27-speed-prereg-uslate-fast.md`): a 1 s taker sees a source within a second of its write, sends 0.25 s later,
and is credited only with prints the data API stamps at least 3 s after that (the API stamps a print 2–3 s after the
match, `backtests/speed/results/print_time_lag.json`) — 4.25 s after the source's write in all.

**The answer, short.**

* **A. The source.** At every METAR city but São Paulo the first taker of a decided bucket's stale side acts before
  any keyless feed has the report that decided it: a median over the stations of 55 s after the observation, against
  26–854 s (station medians) for NOAA's tgftp file, the fastest keyless METAR source. In September 1–26, $49,420.53 of
  the stale side's net edge (held buckets, whole prints) was taken before a 1 s keyless taker could have claimed a
  print, and $12,128.59 after. At US stations the fastest takers act 3–10 s after the observation minute (the p10 at
  six stations), which only the ASOS one-minute value allows; elsewhere one wallet is first on 217 bucket deaths at 39
  stations, a median 67 s after the observation. Hong Kong, the largest market ($4.05 M traded in September, left out
  by PMLATE), runs the same race on another clock: 82 % of the first stale prints come before the ten-minute slot that
  holds the deciding minute has even ended, while the Observatory's own CSV shows the value a median 511 s after it.
  No keyless national feed measured is faster than the takers; Toronto's SWOB-ML is sometimes level with them (written
  50–363 s after the observation, median 82 s, against their 69 s). The sources that could be faster need a key or an
  agreement (§A3), and EUROCONTROL's is closed to anyone outside aviation.
* **B. The models.** Google's newest is **WeatherNext 3** (2026-09-03): a new forecast every hour, 2 m temperature on
  a 0.05° station-trained grid, 64 members, free on allowlist, a 2026 archive under CC BY 4.0 — and it reaches its
  users 7 h 10 min to 8 h 10 min after its initial time, so intraday it is staler than NOAA's HRRR (51–74 min). On
  September's US highs, HRRR's fresh run plus the reports so far, fitted in-sample, scores a Brier of 0.114 at 13:00
  New York time and 0.078 at 16:00, against the market's 0.089 and 0.057; the best in-sample mix gives the model 0–5 %
  weight. The intraday price already knows what a fresh public model knows. Every month with temperature markets up to
  2026-09-10 was used by fp4's WX, and September by PMLATE and this study, so a clean test of any model against the
  price records forward.
* **C. What is worth a test: nothing, with numbers, until a keyed source is measured.** The one keyless candidate
  the exploration suggested, FASTSRC (six stations where a keyless source arrives about when the first takers act),
  was drafted and withdrawn before any freeze when its power check was redone with tgftp's measured lead outside the
  US (1.4 s, not the 7.7 s measured at US stations) and the 3 s print margin: September gives −$122.63 on 43 buckets
  (z −0.91 over 56 days). What would pay is a source as fast as the takers — up to $77–104 a day at the US stations if
  a feed delivered each report 15–60 s after its observation and half of every later stale print were ours — and the
  candidates for that (the FAA's SWIM, Météo-France's 6-minute data, KMA's AMOS) need Davies to sign up, with their
  speed and their match to the report unmeasured (§C2). No pre-registration is left for a freeze.

## A. The source of the deciding observation, city by city

### A1. The markets, and what resolves them

Gamma lists 231 open daily-temperature events in 51 cities, for target dates 25–28 September (Hong Kong's 25th and
26th wait for the Daily Extract; tag 103040, read 01:42 UTC; `scripts/cities.py` → `results/cities_open.json`); 44
more questions, Jinan's for 20 May, are still open and were not parsed. 48 cities resolve on the National Weather
Service's time series page (`weather.gov/wrh/timeseries?site=<ICAO>`), Taipei and Jinan on Weather Underground's
"Daily Observations" table, Hong Kong on the Observatory's Daily Extract. Every NWS market's rules are one template:
"the highest reading under the 'Temp' column for all times on this day", whole degrees, resolved "once the first data
point for the following date has been published", revisions counted until then, Weather Underground's table as the
fallback if NOAA has nothing by 11:59 PM ET the next day. The US rules add one line: "This market will resolve off of
the Hourly Data provided using the 'Show Hourly Data' button."

**What that page is** (read 2026-09-27). The page and its script (`/source/wrh/timeseries/obs.js?v202601121730`) load
`api.synopticdata.com/v2/stations/timeseries` with a token written into the page (not used here): the resolution is
Synoptic's copy of the station's reports. Its help text: "If 'Yes' is checked, the page will only display data where
the observation time stamp has between '51' and '59' in the minutes field for NWS/FAA observation platforms (to include
any 'SPECI' observations/data …)"; in the code, hourly mode shows a row of an ASOS/AWOS or GLOBAL-METAR station when it
carries a sea-level pressure (a routine METAR) or a METAR string of the station (a SPECI, in yellow). The five-minute
rows fall out. So a US market resolves on the routine METARs and SPECIs Synoptic holds, in whole °F; a non-US market
on the day's reports, which at a METAR-only station are again METAR/SPECI, in whole °C. The ASOS User's Guide (NOAA,
DoD, FAA, Navy, March 1998, §3.1.2) says what the US number is: "Once each minute the ACU calculates the 5-minute
average ambient temperature … rounded to the nearest degree Fahrenheit, converted to the nearest 0.1 degree Celsius,
and reported once each minute" — the one-minute observation (OMO) carries the value the next METAR will print, and the
T-group's tenths give back the whole °F; a SPECI without a T-group gives whole °C only (PMLATE's New York 05-06 date).

**Hong Kong** resolves on "Absolute Daily Max (deg. C)" (or Min) in the Daily Extract, to 0.1 °C, the initial
publication being the cutoff. A whole-degree bucket k holds k.0–k.9: September 1's 28.7 won "28°C", the 2nd's 31.8
won "31°C", the lows' 26.3 and 25.7 won "26" and "25". The Extract is published the next morning: the September file's
Last-Modified was Friday 25 September 02:30:24 UTC with days to the 24th, so the 25th's and 26th's markets were still
open on the 27th.

### A2. Who takes the stale side, and when

PMLATE's exploration month, already read (September 1–26, 49 METAR stations, 2,485 market-days, $61.4 M of volume):
`scripts/station_edge.py` → `results/station_edge_2026-09.json`, `scripts/takers.py` → `results/takers_2026-09.json`.
Definitions are PMLATE's: a bucket dies at the first report whose running extreme rules it out; a stale-side print is
a taker selling its YES or buying its NO after that; net edge is the price gap less the market's fee.

| after the deciding report's observation time | stale-side net edge still to take (held buckets, whole prints, 26 days) |
|---|---:|
| 0 s | $61,596.89 |
| 15 s | $57,840.06 |
| 30 s | $51,795.74 |
| 60 s | $41,118.42 |
| 90 s | $29,149.59 |
| 120 s | $26,452.65 |
| 300 s | $14,691.71 |
| a 1 s keyless taker (tgftp's write, modelled report by report as AWC's receipt less 7.7 s in the US and 1.4 s elsewhere, + 4.25 s) | $12,128.59 left; $49,420.53 taken before it |

tgftp's lead over AWC's receipt is the speed study's live measurement (`backtests/speed/results/source_latency.json`,
`vs_awc_receipt`, "tgftp_st_file_written": a median 7.7 s on 67 US reports, 1.4 s on 48 others). AWC keeps each
report's receipt instant; tgftp keeps no history, hence the model.

* **The first taker beats every public feed.** The first stale print (≥ 1¢) comes before tgftp's write at 48 of the
  49 stations (station medians); the exception is São Paulo, whose reports reach AWC 142 s before their nominal time.
  The median over stations of the first cut is 55 s after the observation.
* **At US stations the fastest act within seconds of the minute.** The p10 of the first cut is 3–10 s at KLGA (3),
  KLAX (4), KORD (4), KSEA (6), KATL (9) and KMIA (10). Wallet `2e9080df` (30 first prints, 93 % US) acts a median 6 s
  after the observation, `338cd3e3` (18, all US) 28 s — while tgftp writes a US report a median 159 s after it. That
  is the OMO, read in real time; the NWS says no public route carries it: "Currently this is not possible, however
  there are plans to make high-frequency ASOS data available through a proxy" (weather.gov/asos/faq.html).
* **Elsewhere one wallet runs the race.** `3466b31e` is first on 217 bucket deaths at 39 stations (a quarter US), a
  median 67 s after the observation and 142 s before AWC's receipt (99.1 % before it). Station specialists are faster:
  `02ff87b1` at Helsinki 9 s, `5c177f5b` (Jeddah and five others) 10 s, `4e6a079d` (Seoul, Shenzhen, Wuhan) 18 s,
  `99fec5ce` (China) 28 s, `fa609fc4` (Munich, Milan, Toronto) 64 s.
* **Before the report the market already moves.** On the 1,150 informative bucket deaths, $90,135.95 of stale-side edge
  was taken in the hour before the deciding report's observation: the takers read the temperature, not only the report.

### A3. Every candidate source (primary sources, read 2026-09-27)

**Measured, keyless.** The speed study's 150-minute poll (2026-09-26 22:48 → 09-27 01:18 UTC,
`backtests/speed/results/source_latency.json`, on `main`) and this study's own 67-minute poll (09-27 02:00 → 03:08 UTC,
a conditional GET every 5 s, AWC every 15 s: `scripts/poll_live.py` → `scripts/live_latency.py` →
`results/live_latency.json`; the machine's clock 0.3–0.4 s off a server clock throughout):

| source | delay after the observation (median unless stated) | same sensor as the resolution? |
|---|---|---|
| NOAA tgftp station file (`metar/stations/<ICAO>.TXT`) | written: US 159 s (132–278 p10–p90), elsewhere 250 s (79–429) | yes (the METAR) |
| aviationweather.gov API | US receipt 182 s, shown ~11 s later at a 10 s poll; elsewhere 252 s | yes |
| IEM currents / AFOS MTR | 273 s / 197 s (US); MADIS 5-minute via MTR 938 s | yes |
| api.weather.gov | METAR 1,421 s; 5-minute 1,085–1,120 s | yes |
| VATSIM METAR | US 629 s | yes |
| MSC SWOB-ML, Toronto (`CYYZ-MAN`) | written 53, 96, 50, 123, 68 and 363 s after the six hourly observations 09-26 22:00 → 09-27 03:00 UTC (Last-Modified; the first four the speed study's); median 82 s. The METAR reached tgftp 437–449 s after. | yes (the manned report, in tenths; 15.5 → 16, 14.9 → 15 in the METAR) |
| FMI open WFS, Helsinki-Vantaa 1-minute | 133 s (n = 15) | unverified |
| Singapore NEA 1-minute API | 74 s (n = 29) | **no**: 9 stations, none at Changi |
| JMA AMeDAS, Haneda 10-minute | 403 s (n = 15) | unverified |
| DWD 10-minute "now", Munich airport 01262 | the file of 01:50:00 UTC held data to 01:20 (~30 min) | likely |
| DWD POI current weather, Munich | 2,338 s (n = 2) | likely |
| Hong Kong Observatory since-midnight CSV | Last-Modified a median 438 s after the slot's end (427–541 s, seven slots); first public sighting 511 s (six). A 2 s cache-busted probe saw the 10:30 slot appear between 477 and 502 s, 50–75 s after its Last-Modified (`scripts/hko_publish_probe.py`). | yes (the resolution's own value) |

**Needs a key, an account or an agreement (a step for Davies; nothing was requested):**

* **FAA SWIM Cloud Distribution Service** (US): "a publicly accessible cloud-based infrastructure dedicated to
  providing real-time SWIM data to the public via Solace Java Message Service (JMS) messaging", whose data sets
  "provide information relating to weather, flight and flow, aeronautical, and surveillance"; the FAA provides it "free
  of charge to subscribers", under the SCDS Service Access Agreement, "for non-NAS-impacting purposes", through the
  SWIFT Portal; inactive subscriptions are disabled after 60 days (SWIM SCDS General Guideline with Standards v1.1,
  2024-09-11). The FAA's WMSCR switches the METARs and the one-minute OMOs (it feeds MADIS's OMO data since 2015-10-27,
  madis.ncep.noaa.gov/madis_OMO.shtml); whether either is published on SCDS is not stated in what could be read, and
  the registry's description of WMSCR's SWIM services names PIREPs and altimeter settings. The one route that could put
  a US report or OMO in our hands near the takers' time; unverified.
* **MADIS one-minute ASOS (OMO)**: public, "No restrictions", but "the current and previous hour's data are processed
  every 5 minutes" — minutes, not seconds.
* **Synoptic HF-ASOS** ("1M" stations): one-minute ASOS data "usually arrives with between 2 and 5 minutes latency",
  "Temperatures are expressed in whole degrees celsius", "experimental" (docs.synopticdata.com). Paid tiers, a 14-day
  trial. Slower than the takers by its own documentation.
* **KMA API Hub, AMOS minute data** (Seoul, Busan): the aerodrome system itself; free registration and an `authKey`
  (apihub.kma.go.kr). Latency unmeasured.
* **KNMI Data Platform, 10-minute in-situ observations** (Amsterdam, Schiphol 06240): "available a few minutes later";
  an Open Data API key (dataplatform.knmi.nl).
* **Météo-France DPObs** (Paris-Le Bourget): 6-minute station data, a free account on portail-api.meteofrance.fr and
  an OAuth2 token or API key; latency not stated.
* **MSC Datamart AMQP** (Toronto): push notifications "as they are published", anonymous login documented
  (eccc-msc.github.io); keyless, not tried here. It would take a SWOB-ML file from a poll to a push; it cannot make
  the file earlier.
* **Met Office Weather DataHub, Land Observations** (London): hourly, 150 UK sites, free 360 calls a day; London City
  not confirmed. **AEMET OpenData** (Madrid): hourly, a key. **CWA open data** (Taipei): 10-minute, a key, not the
  airport's sensor. Hourly or not the sensor: none can be faster than the takers.
* **EUROCONTROL IWXXM METAR-SPECI service** (Europe): "only service consumers within the aviation domain can use the
  service" (eur-registry.swim.aero). Not for this account.
* **Weather Underground / The Weather Company**: API keys only for personal-station owners; commercial plans
  otherwise. The key written into WU's pages is not ours to use.

**Audio and telephone.** ASOS "computer-generated voice messages of the current OMO (or METAR / SPECI) … are sent to
pilots … through the ASOS Ground-To-Air VHF radio … They are also made available to the aviation community through
telephone number provided for dial-in" (ASOS User's Guide §5.0); "At unstaffed locations, the OMO is used; at FAA
towered locations the OMO or METAR may be used at the discretion of the air traffic controller" (§6.5), spoken at 100
words a minute, temperature in whole °C, the OMO renewed each minute. At the towered airports the markets use, the line
may carry the METAR rather than the OMO. ATIS is rewritten when a new METAR or SPECI arrives, so it can only lag the
report. LiveATC's streams are for personal, non-commercial use (its terms, as quoted in search results; the page itself
refused this machine). No FAA document found addresses automated calling of the dial-in lines. Nothing was built that
calls, listens or records.

### A4. City by city

`scripts/source_table.py` → `results/source_table.json` (every city: station, resolution, national service, the
first cut, the keyless delay, the edge taken before and left after a 1 s keyless taker, the sensor, the candidates, the
audio route). Ranked by the edge taken before a 1 s keyless taker could act — the stale liquidity × the gap between
the takers and the fastest keyless source, September 1–26. "First cut": the first stale print (≥ 1¢) after the
deciding report's observation, median over informative bucket deaths. "Keyless": tgftp's modelled write (Hong Kong:
the CSV's first public sighting; Toronto also the SWOB-ML's measured write). "1 s keyless taker": USLATE's fill model
at that instant + 4.25 s (§A6), traps included.

| # | city (station) | first cut p50 | keyless p50 | taken before the keyless source | left after | 1 s keyless taker | the faster candidate |
|---|---|---:|---:|---:|---:|---:|---|
| 1 | Hong Kong (HKO) | −495 s (slot end) | 511 s (slot end, CSV) | $6,359 | $669 | +20.67 | none found |
| 2 | London (EGLC) | 74 s | 255 s | $2,512 | $269 | +2.16 | none found |
| 3 | Denver (KBKF) | 397 s | 616 s | $2,339 | $150 | +15.08 | FAA SWIM Cloud Distribution Service |
| 4 | Munich (EDDM) | 64 s | 207 s | $2,064 | $131 | +1.39 | none found |
| 5 | Milan (LIMC) | 39 s | 326 s | $1,992 | $165 | +3.12 | none found |
| 6 | Chicago (KORD) | 57 s | 183 s | $1,921 | $301 | +22.55 | FAA SWIM Cloud Distribution Service |
| 7 | Tel Aviv (LLBG) | 59 s | 83 s | $1,801 | $189 | −92.11 | none found |
| 8 | Paris (LFPB) | 78 s | 140 s | $1,706 | $119 | +7.02 | Météo-France DPObs 6-minute station data |
| 9 | Kuala Lumpur (WMKK) | 30 s | 503 s | $1,623 | $323 | +7.50 | none found |
| 10 | Singapore (WSSS) | 51 s | 60 s | $1,598 | $131 | −97.76 | none found |
| 11 | Karachi (OPKC) | 79 s | 88 s | $1,587 | $91 | +7.47 | none found |
| 12 | Warsaw (EPWA) | 66 s | 141 s | $1,475 | $392 | +3.38 | none found |
| 13 | Mexico City (MMMX) | 37 s | 854 s | $1,454 | $42 | +3.18 | none found |
| 14 | New York City (KLGA) | 72 s | 189 s | $1,442 | $537 | +17.58 | FAA SWIM Cloud Distribution Service |
| 15 | Miami (KMIA) | 63 s | 211 s | $1,265 | $149 | +42.25 | FAA SWIM Cloud Distribution Service |
| 16 | Beijing (ZBAA) | 25 s | 325 s | $1,252 | $1,139 | −92.80 | none found |
| 17 | Tokyo (RJTT) | 106 s | 454 s | $1,213 | $223 | +17.24 | none found |
| 18 | Shenzhen (ZGSZ) | 15 s | 384 s | $1,159 | $460 | +5.84 | none found |
| 19 | Madrid (LEMD) | 192 s | 259 s | $1,153 | $247 | −151.75 | none found |
| 20 | Ankara (LTAC) | 85 s | 316 s | $1,145 | $217 | −96.64 | none found |
| 21 | Lucknow (VILK) | 39 s | 369 s | $1,118 | $249 | +10.04 | none found |
| 22 | Buenos Aires (SAEZ) | 148 s | 246 s | $1,062 | $346 | +31.42 | none found |
| 23 | Istanbul (LTFM) | 86 s | 317 s | $1,015 | $52 | +1.85 | none found |
| 24 | Moscow (UUWW) | 16 s | 368 s | $971 | $864 | +64.93 | none found |
| 25 | Toronto (CYYZ) | 69 s | 82 s (SWOB-ML); 495 s (tgftp) | $956 | $73 | +41.84 (SWOB-ML); +6.10 (tgftp) | MSC Datamart AMQP push |
| 26 | Taipei (RCSS) | 36 s | 552 s | $885 | $63 | +6.72 | none found |
| 27 | Helsinki (EFHK) | 7 s | 80 s | $862 | $37 | +1.16 | none found |
| 28 | Manila (RPLL) | 64 s | 388 s | $856 | $200 | −263.47 | none found |
| 29 | Atlanta (KATL) | 76 s | 264 s | $822 | $12 | +1.21 | FAA SWIM Cloud Distribution Service |
| 30 | Seoul (Incheon) (RKSI) | 18 s | 272 s | $814 | $77 | +12.30 | KMA API Hub AMOS minute data |
| 31 | Seattle (KSEA) | 52 s | 207 s | $808 | $187 | +0.96 | FAA SWIM Cloud Distribution Service |
| 32 | Jeddah (OEJN) | 7 s | 26 s | $744 | $33 | +2.66 | none found |
| 33 | Houston (KHOU) | 91 s | 206 s | $738 | $538 | +26.25 | FAA SWIM Cloud Distribution Service |
| 34 | Austin (KAUS) | 60 s | 206 s | $731 | $269 | +8.31 | FAA SWIM Cloud Distribution Service |
| 35 | Guangzhou (ZGGG) | 28 s | 329 s | $727 | $1,092 | −91.24 | none found |
| 36 | Chongqing (ZUCK) | 24 s | 382 s | $721 | $130 | +2.29 | none found |
| 37 | Cape Town (FACT) | 55 s | 318 s | $691 | $137 | +1.49 | none found |
| 38 | San Francisco (KSFO) | 126 s | 246 s | $635 | $126 | +5.56 | FAA SWIM Cloud Distribution Service |
| 39 | Busan (RKPK) | 54 s | 273 s | $614 | $534 | +11.03 | KMA API Hub AMOS minute data |
| 40 | Qingdao (ZSQD) | 28 s | 381 s | $544 | $78 | −96.90 | none found |
| 41 | Los Angeles (KLAX) | 51 s | 205 s | $542 | $197 | +35.99 | FAA SWIM Cloud Distribution Service |
| 42 | Panama City (MPMG) | 49 s | 364 s | $511 | $129 | +33.25 | none found |
| 43 | Dallas (KDAL) | 55 s | 206 s | $479 | $184 | +6.39 | FAA SWIM Cloud Distribution Service |
| 44 | Chengdu (ZUUU) | 22 s | 381 s | $286 | $281 | +8.39 | none found |
| 45 | Wuhan (ZHHH) | 27 s | 383 s | $207 | $220 | +6.96 | none found |
| 46 | Amsterdam (EHAM) | 38 s | 136 s | $95 | $63 | +0.10 | none found |
| 47 | Shanghai (ZSPD) | 63 s | 327 s | $92 | $167 | +39.81 | none found |
| 48 | São Paulo (SBGR) | 187 s | −143 s | $79 | $143 | +15.27 | none found |
| 49 | Wellington (NZWN) | 7 s | 266 s | $68 | $42 | +1.44 | none found |
| 50 | Zhengzhou (ZHCC) | 34 s | 383 s | $47 | $332 | +102.83 | none found |
| 51 | Jinan (ZSJN) | — | — | $0 | $0 | — (no report archive) | none found |

"None found" means no primary source names a public or registrable feed of that station's reading faster than the
METAR chain. Every station's audio route is its ATIS (and at US stations the ASOS radio and dial-in lines); the
national service and the other candidates of each city are in the JSON. Zhengzhou's +$102.83 is one date (98 %).

### A5. Hong Kong

`scripts/hko_archive.py` pulls every version DATA.GOV.HK archived of the Observatory's "maximum and minimum air
temperature from 1-minute mean temperatures since midnight" (keyless; `api.data.gov.hk/v1/historical-archive/`,
about 145 versions a day, each with its capture instant), and `scripts/hko_edge.py` → `results/hko_edge_2026-09.json`
times the Hong Kong markets against it: September 1–24 (the 25th's and 26th's were still open), 48 events, $4.05 M
traded.

* **The basis holds.** The CSV's final value of the day puts the winning bucket right on 48 of 48 events, with the
  floor semantics of A1. The slot at 00:00 carries the previous day's full maximum and minimum.
* **The takers are ahead of the Observatory's own file.** 214 held bucket deaths (35 informative), no trap. The first
  stale print comes a median 495 s *before* the end of the ten-minute slot whose value decided the bucket (p25 −584 s,
  p75 −105 s), 82 % before the slot's end and all before the archive's capture. $13,492.91 of stale-side edge on the
  informative deaths went in the hour before the slot's end. Of the $7,028.04 still there at the slot's end (all held),
  $668.59 was left once the CSV was public (a median 511 s after the slot) and a 1 s taker could act.
* **A 1 s taker at the CSV** (USLATE's fill model, the first public sighting + 4.25 s): +$20.67 on 4 buckets in 24
  days; if it could read the file the moment the Observatory wrote it (Last-Modified + 4.25 s, which the public
  endpoint did not allow): +$32.99 on 13.
* The first takers are spread (`ad4a40b7` 3, `4e6a079d` 2 — also first at Seoul, Shenzhen and Wuhan — `f537b9f8` 2,
  `be44ba81` 2). No public HKO product faster than the ten-minute CSV was found; whether the takers read one, read the
  airport's METAR (VHHH, on tgftp 105–139 s after its observation in the live poll) or anticipate the curve, the
  prints cannot say. Nothing late is left to register.

### A6. What a 1 s taker would have made at the measured delays

`scripts/candidates_explore.py` → `results/candidates_2026-09.json`. USLATE's fill model on September (already read,
so descriptive only): from the source's write + 4.25 s, half of each stale print with g ≥ 1¢, $100 a bucket, the
market's fee, held to resolution, traps included.

* **On the keyless METAR chain** at all 49 stations: −$382.20 on 262 buckets with 12 traps; the US stations +$182.13
  on 50, $7.00 a day (USLATE-FAST's own exploration puts the same bet at $7.0–12.7 a day). Seven stations make more
  than $30, on 1–25 buckets each, and the traps decide the sign.
* **Toronto on its SWOB-ML** at the median write (82 s): +$41.84 on 18 buckets over 10 dates. At each measured write:
  50 s +$131.57 (71 buckets), 53 s +$114.11 (67), 68 s +$77.72 (39), 96 s +$25.94 (11), 123 s +$16.33 (8), 363 s
  +$6.10 (2). The takers' first cut at Toronto is 69 s: the SWOB is the race they run, and on a good hour we would be
  level with them, not ahead.

## B. Weather models

### B1. Google's model: WeatherNext 3

Released 2026-09-03 ("Introducing WeatherNext 3", blog.google, the WeatherNext team; the model page dates it August
2026). From Google's developer pages (developers.google.com/weathernext: guides/models, access-forecast,
dissemination) and the terms PDF (storage.googleapis.com/weathernext-public/terms-of-use.pdf, "Last modified: 3
September 2026"):

* **What it is**: a Functional Generative Network mesh transformer, 64 ensemble members, trained on ERA5 / HRES-fc0,
  IMERG, station observations and geostationary satellite mosaics. 2 m temperature on a 0.1° grid (`temperature_2m`)
  and a 0.05° station-trained head (`station_head_temperature_2m`); no daily max/min variable.
* **Cadence**: "Every hour (24 inits per day)"; 15 days at 00/06/12/18 UTC, 48 hours for the hourly runs between.
* **Delay**: 00/06/12/18 UTC runs reach Cloud Storage 7 h 45 min after their initial time and BigQuery/Earth Engine
  8 h 10 min after; the hourly runs 7 h 10 min and 7 h 25 min; "±15 minute variance", "±60 minutes or more" at times.
* **Access**: an allowlist form ("Anyone with a Google Account … typically approved within 5–7 business days"), one
  approval for Cloud Storage (`gs://weathernext3_spatial/`, `gs://weathernext3_statistics_spatial/`), BigQuery and
  Earth Engine (`weathernext_3_0_0_0p1deg`, `weathernext_3_0_0_0p05deg`, means and percentiles). No licence fee is
  named; the costs are the cloud's: BigQuery on demand bills "the first 1 TiB of query data processed per month" free
  and $6.25 a TiB after, storage's first 10 GiB free, and a sandbox runs without a credit card
  (cloud.google.com/bigquery/pricing, read 2026-09-27). How many bytes a station-point query scans depends on the
  tables' layout, which only an allowlisted account can see.
* **Terms**: data less than an hour old or in the future fall under the "Real-Time Weather Forecasting Experimental
  Data Terms", which permit "any internal purpose" on a royalty-free licence; residents of Japan, South Korea,
  Indonesia and a few sanctioned regions are excluded; for EEA users the counterparty is Google Ireland Limited. Data
  an hour old or more are CC BY 4.0.
* **Archive**: "2026 (for backtesting and evaluation). Historical data is being backfilled for 2024, 2025."

Its predecessors: WeatherNext 2 (June 2025, 0.25°, 6-hourly), WeatherNext Gen (GenCast, December 2024), WeatherNext
Graph (GraphCast, November 2023).

### B2. The open alternatives traders already use

| model | grid, cadence | reaches users | archive keyless? |
|---|---|---|---|
| NOAA HRRR | 3 km, hourly runs, 18 h (48 h at 00/06/12/18) | on AWS 51–74 min after init (2026-09-10 12Z: f00 12:51:31, f18 13:14:21) | yes, `noaa-hrrr-bdp-pds`, from 2014-07-30 |
| NOAA NBM | 2.5 km, hourly runs, station text bulletins with max/min | 12Z bulletin posted 13:30:46 (~1.5 h) | yes, `noaa-nbm-grib2-pds`, from 2020-05-18 (text in `blend.<d>/<HH>/text/`) |
| NOAA GFS / AIGFS | 0.25°, 00/06/12/18 | AIGFS operational 2025-12-17 (NWS SCN 25-89), ~40 min a run | NOMADS; AIGFS history on AWS from 2026-05 |
| ECMWF IFS and AIFS open data | 0.25°, 00/06/12/18, to 360 h; `2t`, `mx2t3/6`, `mn2t3/6` | IFS "at the end of the real-time dissemination schedule", AIFS "immediately upon production" | portal keeps 12 runs; AWS mirror `ecmwf-forecasts` from 2023-01-18; CC-BY-4.0 |
| DWD ICON-D2 | ~2.2 km, runs every 3 h, 48 h | minutes to hours | DWD open data keeps recent runs only |
| Météo-France AROME | 0.01°, hourly files, 0–51 h | hours | packages kept 14 days |
| Open-Meteo Single Runs | re-serves the above per run | "1–3 hours" regional, "4–6 hours" global | IFS 9 km runs from 2024-03-14, all others from 2026-04-02; free non-commercial (10,000 calls a day), commercial by subscription |

The AWS archives' start dates are their first prefixes (listed keylessly 2026-09-27). Open-Meteo's archive serves
these models' runs only every three hours (the hourly HRRR runs answer "not available"), and throttled this machine to
connection timeouts after a few hundred calls; NOAA's own archive has no such limit.

### B3. Can "does the model beat the price" be tested on history?

The mechanics exist for the open models: every HRRR run since 2014, NBM run since 2020-05 and ECMWF open-data run since
2023-01 is on AWS, and the data API keeps every print; `scripts/hrrr_points.py` pulls HRRR's 2 m temperature at the
stations with one range request a field. Two limits:

* **An archive's timestamps are copy times, not release times.** HRRR's 2020-05-18 12Z file was written to the bucket
  on 2020-10-20; ECMWF's AWS objects carry the time of their copy (a 2023-01-18 00Z file 14:39 UTC, a 2026-09-10 12Z
  AIFS file 17:55 UTC). A backtest must give each run its documented delay (HRRR ~1 h, WeatherNext 3 7–8 h), not the
  archive's.
* **The months are not unseen.** fp4 counted the temperature markets from 2025-01 (NYC and London) and its WX used
  every month from 2025-01-01 to 2026-09-10 with a day-ahead forecast; PMLATE/USLATE read 2026-03 → 09 after the
  reports, and this study read September. A historical test of a new model on those months is a re-test on seen
  prices. The clean test records forward: the model's run as it was available at the decision time, and the book
  (§C3). WeatherNext 3's archive (2026, backfilling 2025) needs the allowlist and is in the same months.

### B4. The exploration: a fresh run plus the reports so far, against the price

`scripts/intraday_explore.py` → `results/intraday_explore_2026-09.json`; September's US highs (275 events at each
time), already read. At 17:00 and 20:00 UTC (13:00 and 16:00 in New York, 10:00 and 13:00 in Los Angeles), the model
is HRRR's run of two hours earlier at the station's grid point, the day's high is max(the reports so far, the run's
maximum over the rest of the local day + μ + Normal(0, σ)), and (μ, σ) — pooled, or μ per station — are fitted on the
same month, so the model is flattered. The price is the last print of each bucket in the hour before.

| decision (UTC) | model's Brier (pooled μ / μ by station) | market's Brier | best in-sample mix | where they differ by ≥ 10 points, the model right |
|---|---:|---:|---|---|
| 17:00 | 0.1235 / 0.1136 | 0.0892 | 5 % model: 0.08915 against 0.08919 | 217 of 706 (31 %) |
| 20:00 | 0.1011 / 0.0785 | 0.0570 | 5 % model: 0.05697 against 0.05703 | 173 of 444 (39 %) |

The market puts a mean 0.43 (17:00) and 0.64 (20:00) on the bucket that wins, the flattered model 0.25 and 0.55.
HRRR's point bias runs from −7.4 °F (Houston Hobby) to +6.6 °F (San Francisco) by station, and correcting it still
leaves the model far behind. The price at midday already holds the fresh run and more.

### B5. What would be different from fp4's WX

fp4 bet a 48-hour forecast against the price at noon UTC the day before and lost (−$1,589.09; the market's Brier 0.0637
against the model's 0.0746, and 0.0728 for a non-causal 24-hour forecast). Three things could have been different:
a fresher forecast, the day's own reports, a per-station correction. B4 gives the model all three, on the market's own
day, fitted in-sample, and the market still wins by a wide margin. What is left untested is a better model than the ones
the market reads. WeatherNext 3 is the candidate, but intraday it arrives 6–7 hours staler than HRRR, so its test is
day-ahead, where fp4 failed: at noon UTC the day before, its 00 UTC run (available 07:45 UTC) is the freshest forecast
anyone has. Nothing here says it would win; it needs the account first, and a forward record.

## C. What is worth a test

### C1. The one keyless candidate, and why it was withdrawn

The exploration suggested one rule: be the 1 s taker at the stations where a keyless source reaches the deciding
report about as fast as the first takers act. A timing rule, not a profit rule, picked six (the source's median write
within 30 s of the station's median first stale print): Karachi, Toronto (SWOB-ML), São Paulo, Jeddah, Singapore and
Tel Aviv. A draft pre-registration, FASTSRC, was written for a 56-day forward paper test of them, with USLATE's fill
model, and its first power check read +$357.88 on 130 buckets in September (z 2.09 over 56 days).

That check was wrong in two ways, both found before any freeze. It gave every station tgftp's US lead over AWC (7.7 s),
where the speed study measured 1.4 s elsewhere; and it credited prints stamped from 2 s after the write, where
USLATE-FAST, frozen on `main` the same day, credits only prints stamped 3 s after the reaction (here a 1 s poll and
0.25 s). Redone
(`timing_rule_set` in `results/candidates_2026-09.json`):

| | buckets filled | dates | traps | September P&L | per date (mean, sd) | z over 56 days |
|---|---:|---:|---:|---:|---|---:|
| `as_drafted`: the US lead everywhere, prints from 2 s after the write, SWOB at 72 s | 130 | 25 | 2 | +$357.88 | +$13.76, $49.25 | 2.09 |
| `corrected`: non-US lead 1.4 s, + 4.25 s, SWOB at its 82 s median | 43 | 17 | 2 | −$122.63 | −$4.72, $38.59 | −0.91 |
| `corrected_us_lead`: as corrected, with the US lead 7.7 s everywhere | 84 | 25 | 2 | +$156.45 | +$6.02, $45.51 | 0.99 |

Karachi carried 88 % of the draft's total and now makes +$7.47: its stale side goes between 60 and 90 s after the
observation (a source 60 s after it would have made +$426.22 on 75 buckets), and tgftp writes its report at 88 s.
FASTSRC is withdrawn: even at the kindest lead a pass is a coin toss, and a pass would be worth a few hundred dollars
a year. Toronto alone (§A6) is too small to be worth a test. The keyless race is lost, and nothing is registered.

### C2. What would pay, and what it needs first

A source as fast as the takers. `pooled_fixed_delay`, `fixed_delay_by_station` and `keyed_groups` in
`results/candidates_2026-09.json` score every station as if a source had delivered each report a fixed 15, 30 or 60 s
after its observation (+ 4.25 s, USLATE's fill model). These are upper bounds: the source must deliver the METAR's own
value, and half of every later stale print must be ours while takers act 3–10 s after the minute.

| direction | what it needs (a step for Davies) | stations | September at 15 / 30 / 60 s | per day at 60 s (sd) | z over 28 days at 60 s |
|---|---|---|---|---:|---:|
| 1. FAA SWIM (SCDS) | the SWIFT Portal account and the SCDS Service Access Agreement; free | the 11 US stations | +$2,701 / +$2,584 / +$2,004 | $77.09 ($45.05) | 9.1 |
| 2. Météo-France DPObs, 6-minute | a free account and token on portail-api.meteofrance.fr | Paris-Le Bourget | +$308 / +$301 / +$278 | $10.68 ($9.71) | 5.8 |
| 3. KMA API Hub, AMOS minute data | a free registration and `authKey` on apihub.kma.go.kr | Seoul, Busan | +$209 / +$133 / +$103 | $3.97 ($5.39) | 3.9 |
| 4. KNMI 10-minute | a free API key | Amsterdam | +$9 / +$9 / +$0.31 | — | — |

None of the 28-day tests fails for lack of power if the bound held; what fails first is the premise. The order to ask
the questions in, for each: (a) does the feed carry the station's reading that the report prints — SCDS's catalogue
does not say whether METAR/SPECI or the OMO are published; DPObs's 6-minute steps include :00 and :30, but whether
its reading is the METAR's is unverified; AMOS is the aerodrome's own system; (b) how many seconds after the
observation it arrives, measured for a day by a session with the key, against tgftp and the first takers; (c) only
then a pre-registration, a forward paper test in USLATE-FAST's design. The non-US bounds also carry that month's traps:
at 15 s the non-US stations make +$6,732.07 held and −$1,202.88 on traps.

**The model direction** needs the WeatherNext 3 allowlist first; its first question is descriptive (does its day-ahead
Brier beat the market's 0.064 on 2026's archive, where Open-Meteo's scored 0.075), and only a clear yes would justify a
forward pre-registration. No power check can be written before its numbers are seen.

### C3. The forward recorder (described; nothing built)

Built only on Davies' word, and one design for every direction above:

* **USLATE-FAST's recorder** (`2026-09-27-speed-prereg-uslate-fast.md`): the current hour's METAR cycle file
  (`tgftp.nws.noaa.gov/data/observations/metar/cycles/<HH>Z.TXT`) by byte range every second, the previous hour's
  every ten, each report's first sighting as `pub`. Writing every station's reports, not only the US ones, costs
  nothing more and gives every METAR city its keyless baseline.
* **One reader per keyed source**, once its key exists, beside it: a subscriber (SCDS's JMS queue, MSC's AMQP) or a
  1 s poller (DPObs, AMOS, SWOB-ML), each writing change-only rows.
* **Tables**: `wx_source_reads` (source, station, data_time, value in tenths, raw, first_seen, last_seen, reads;
  unique on source, station, data_time: a row per new reading, not per read), `wx_recorder_gaps` (source, from, to:
  every interval over 10 s without a successful read), `wx_clock` (every ten minutes: server time, offset, round
  trip), and `wx_books` (the CLOB book of each open bucket of the station at each `first_seen` that decides one, as
  the speed study proposes), prints read from the data API afterwards.
* **The job**: one Edge call a minute looping every second under the `agent_locks` lease, as the view recorder does:
  98.5 ms of CPU a call, 4.9 % of the 2 s limit, no invocations over the plan's quota; or pg_cron every second, about
  $4 a month over quota and ~4 GB a month of `cron.job_run_details` unless pruned (`backtests/speed/results/
  architectures.json`).
* **The model**, if allowlisted: once a day after 08:15 UTC, the 00 UTC WeatherNext 3 run's station-head 2 m
  temperature at each station for the next local day (means and percentiles), and the book at noon UTC, into
  `wx_model_runs` (model, init, available_at, station, valid_time, statistics).

### C4. Faster than a second

Nothing here needs it. No keyless source is within a second of the takers, and the keyed ones are unmeasured; an
always-on Cloudflare Worker (studied, never deployed) becomes a question only once a measured source beats the takers
by less than the second a 1 s loop costs.

## What Davies must do or decide

* **Nothing to freeze.** WXSRC's phase 1 leaves no pre-registration (§C1).
* **Whether to open any keyed route** — each free, each his sign-up, none started here:
  1. FAA SWIM Cloud Distribution Service: an account on the FAA's SWIFT Portal and the SCDS Service Access Agreement
     (November 2023); free; data "for non-NAS-impacting purposes" only; a subscription idle for 60 days is disabled.
     The largest bound (§C2), and the least certain: whether it publishes METAR/SPECI or the OMO is the first thing a
     session would read, with the key, before anything else.
  2. Météo-France's API portal (portail-api.meteofrance.fr): a free account, the DPObs API, a token. Paris only.
  3. KMA's API Hub (apihub.kma.go.kr): a free registration and `authKey`. Seoul and Busan.
  4. WeatherNext 3: the allowlist form with a Google account (5–7 business days), then a Google Cloud project;
     BigQuery's first 1 TiB of queries a month is free, $6.25 a TiB after; Google's terms allow "any internal
     purpose", with Google Ireland as the counterparty in the EEA.
  5. Not worth it: Synoptic (paid, "2 to 5 minutes" by its own documentation), The Weather Company (commercial, the
     same METARs), EUROCONTROL (aviation only), and anything that calls or records the ASOS phone lines or ATIS.
* **The standing limits apply to anything that passes**: Polymarket may open a position only from Ireland under his
  attestation, and no order path exists. A result says whether a rule would have been worth money, never that it can
  run.

## Files

* `backtests/wxsrc/scripts/`: `wxcommon.py` (shared: PMLATE's parser and fp4's HTTP helper, unchanged), `cities.py`
  (A1), `station_edge.py` (A2, the keyless chain's instant), `takers.py` (A2), `poll_live.py`, `live_latency.py` and
  `hko_publish_probe.py` (A3's live poll), `hko_archive.py` and `hko_edge.py` (A5), `source_table.py` (A4),
  `candidates_explore.py` (A6, C1, C2), `hrrr_points.py` and `intraday_explore.py` (B4), `build_manifest.py`.
* `backtests/wxsrc/results/`: `cities_open.json`, `station_edge_2026-09.json`, `takers_2026-09.json`,
  `live_latency.json`, `hko_edge_2026-09.json`, `source_table.json`, `candidates_2026-09.json`,
  `intraday_explore_2026-09.json`.
* `backtests/wxsrc/MANIFEST.json`: every committed file's sha256, and every raw pull kept out of git (Gamma's events,
  the HKO archive, the HRRR points, the abandoned Open-Meteo pulls, the live poll) with its URL pattern.
* The speed study's figures are read from its committed files on `main` (`backtests/speed/results/`), not copied.
