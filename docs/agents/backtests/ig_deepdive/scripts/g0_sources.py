"""G0 of SPEC-for-verification.md: re-read every primary source the verification's numbers rest on, at source.

`--fetch` downloads each page in SOURCES (GET, no key, no cookie), keeps its text (tags, scripts and styles removed,
whitespace folded) gzip'd under inputs/sources/<source_id>.txt.gz, and records the raw page's size and sha256. Without
`--fetch` it re-reads the committed texts only. Either way it checks every fact in FACTS against its source's text (the
quoted words must be there, whitespace folded) and writes inputs/sources/source_index.csv with exactly the spec's
columns (source_id, publisher, title, url_or_document, read_date, sha256, fact_ids) and inputs/sources/facts.csv.
A fact whose words are not found is written `not found at source`, never supplied from memory.

Run from the repository root: python3 -I docs/agents/backtests/ig_deepdive/scripts/g0_sources.py [--fetch]
"""
import csv
import datetime as dt
import gzip
import hashlib
import html
import json
import os
import re
import subprocess
import sys
import tempfile
import urllib.request

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(HERE, "inputs", "sources")
UA = "Mozilla/5.0 (X11; Linux x86_64) daviesportfolios-research/1.0"

# source_id, publisher, title, url
SOURCES = [
    ("labs_faq", "IG Labs", "API FAQ", "https://labs.ig.com/faq.html"),
    ("labs_getting_started", "IG Labs", "Getting started", "https://labs.ig.com/getting-started.html"),
    ("labs_rest_guide", "IG Labs", "REST Trading API guide", "https://labs.ig.com/rest-trading-api-guide.html"),
    ("labs_rest_reference", "IG Labs", "REST Trading API reference", "https://labs.ig.com/rest-trading-api-reference.html"),
    ("labs_streaming_guide", "IG Labs", "Streaming API guide", "https://labs.ig.com/streaming-api-guide.html"),
    ("labs_ref_prices", "IG Labs", "/prices/{epic} reference", "https://labs.ig.com/reference/prices-epic.html"),
    ("labs_ref_markets", "IG Labs", "/markets reference", "https://labs.ig.com/reference/markets.html"),
    ("labs_ref_markets_epic", "IG Labs", "/markets/{epic} reference", "https://labs.ig.com/reference/markets-epic.html"),
    ("labs_ref_session", "IG Labs", "/session reference", "https://labs.ig.com/reference/session.html"),
    ("ig_uk_charges", "IG (UK)", "Charges", "https://www.ig.com/uk/charges"),
    ("ig_uk_overnight_funding", "IG (UK)", "What is overnight funding", "https://www.ig.com/uk/help-and-support/spread-betting-and-cfds-5064504a/fees-and-costs-efcb88d2/what-is-overnight-funding-how-is-it-charged-and-how-is-65e16fa6"),
    ("ig_uk_sb_forex", "IG (UK)", "Forex spread betting product details", "https://www.ig.com/uk/help-and-support/spread-betting-and-cfds-5064504a/products-markets-and-trading-hours-008e7240/forex-spread-betting-product-details-3134d533"),
    ("ig_uk_sb_indices", "IG (UK)", "Spread bet indices product details", "https://www.ig.com/uk/help-and-support/spread-betting-and-cfds-5064504a/products-markets-and-trading-hours-008e7240/spread-bet-indices-product-details-1b3f8f8c"),
    ("ig_uk_sb_options", "IG (UK)", "Options spread bet product details", "https://www.ig.com/uk/help-and-support/spread-betting-and-cfds-5064504a/products-markets-and-trading-hours-008e7240/options-spread-bet-product-details-be6b789d"),
    ("ig_uk_weekend_trading", "IG (UK)", "Weekend trading", "https://www.ig.com/uk/weekend-trading"),
    ("ig_uk_gsl_what", "IG (UK)", "What is a guaranteed stop", "https://www.ig.com/uk/help-and-support/articles/686687-what-is-a-guaranteed-stop"),
    ("ig_uk_gsl_cost", "IG (UK)", "How much does a guaranteed stop cost", "https://www.ig.com/uk/help-and-support/articles/686684-how-much-does-a-guaranteed-stop-cost"),
    ("ig_uk_negative_balance", "IG (UK)", "What happens if my account goes into negative balance", "https://ig.com/uk/help-and-support/spread-betting-and-cfds/margin/what-happens-if-my-account-goes-into-negative-balance"),
    ("ig_uk_sb_agreement", "IG Index Ltd", "Spread betting customer agreement", "https://www.ig.com/usermanagement/customeragreements?igCompany=iggb&agreementType=customer_agreement&productCode=IGFSB&locale=en_GB"),
    ("ig_uk_cfd_agreement", "IG Markets Ltd", "CFD customer agreement", "https://www.ig.com/usermanagement/customeragreements?igCompany=iggb&agreementType=customer_agreement&productCode=IGCFD&locale=en_GB"),
    ("fca_cfd_restrictions", "FCA", "Permanent restrictions on CFDs and CFD-like options for retail consumers (2019)", "https://www.fca.org.uk/news/press-releases/fca-confirms-permanent-restrictions-sale-cfds-and-cfd-options-retail-consumers"),
    ("hmrc_cg56100", "HMRC", "Capital Gains Manual CG56100: contracts for differences", "https://www.gov.uk/hmrc-internal-manuals/capital-gains-manual/cg56100"),
    ("hmrc_cg56105", "HMRC", "Capital Gains Manual CG56105: spread bets", "https://www.gov.uk/hmrc-internal-manuals/capital-gains-manual/cg56105"),
    ("hmrc_bim22020", "HMRC", "Business Income Manual BIM22020: gambling", "https://www.gov.uk/hmrc-internal-manuals/business-income-manual/bim22020"),
    ("uk_tcga1992_s51", "legislation.gov.uk", "TCGA 1992 s.51: exemptions for winnings and damages", "https://www.legislation.gov.uk/ukpga/1992/12/section/51"),
    ("ie_tca1997_s613", "Irish Statute Book", "TCA 1997 s.613: miscellaneous exemptions for certain kinds of property", "https://www.irishstatutebook.ie/eli/1997/act/39/section/613/enacted/en/html"),
]

# fact_id, source_id, claim, the words that must be in the source's text (case and whitespace folded)
FACTS = [
    ("F01", "labs_faq", "IG's REST API allows 30 non-trading requests a minute per account", "Per-account non-trading requests per minute: 30"),
    ("F02", "labs_faq", "and 60 non-trading requests a minute per app", "Per-app non-trading requests per minute: 60"),
    ("F03", "labs_faq", "Historical price data is limited to 10,000 points a week", "Historical price data points per week: 10,000"),
    ("F04", "labs_faq", "HOUR history is offered for about 360 days", "1 Hour 360"),
    ("F05", "labs_faq", "Weekend maintenance invalidates every session token", "As part of this maintenance all tokens are invalidated"),
    ("F06", "labs_faq", "Several concurrent streaming connections may get the key suspended", "Please do not create multiple concurrent connections as this may lead to your API key being suspended"),
    ("F07", "labs_ref_prices", "The price history reports the allowance left after each request", "The number of data points still available to fetch within the current allowance period"),
    ("F08", "labs_ref_prices", "The from/to parameters are written without a time zone", "Start date time (yyyy-MM-dd'T'HH:mm:ss)"),
    ("F09", "labs_ref_markets", "Up to 50 epics in one market-details request", "Max number of epics is limited to 50"),
    ("F10", "ig_uk_sb_forex", "AUD/USD spot spread bet: £0.50 minimum bet, 0.6 minimum spread, 0.82/1.03 average, 1.5 guaranteed-stop premium, 5 % retail margin", "AUD/USD 24 hours 0.0001$ £0.50 0.6 0.82 1.03 1.5 5%"),
    ("F11", "ig_uk_sb_forex", "IG's forex dealing hours: Sunday 21:00 to Friday 21:59, London time", "Normal dealing hours for all pairs are from 21.00 (London time) on Sunday until 21.59 (London time) on Friday"),
    ("F12", "ig_uk_sb_forex", "Forex DFB funding: the tom-next spread plus IG's charge of 0.0022 % a day (about 0.80 % a year)", "including IG's charge for holding positions overnight of 0.0022% per day"),
    ("F13", "ig_uk_overnight_funding", "Forex funding: the tom-next rate plus an admin fee of 1.5 % (conflicts with F12; both kept)", "we charge the tom-next rate plus an admin fee of 1.5%"),
    ("F14", "ig_uk_overnight_funding", "Index spread bet funding: 3.4 % admin fee plus or minus the benchmark, 365-day formula", "Bet size x price × (3.4% admin fee +/- relevant interest rate benchmark%) ÷ 365"),
    ("F15", "ig_uk_overnight_funding", "Index CFD funding: 3 % admin fee plus or minus the benchmark", "(3% admin fee +/- relevant interest rate benchmark%) ÷ 365"),
    ("F16", "ig_uk_overnight_funding", "Positions held through 10pm on Fridays pay three days' funding", "open positions held through 10pm (UK time) on Fridays will be adjusted for three days’ worth of funding"),
    ("F17", "ig_uk_sb_indices", "US 500 DFB: £1 minimum; 0.4 points 14:30-21:00, 0.6 21:00-14:30, 1.5 22:00-23:00; 5 % margin", "US 500 DFB £1 14.30-21.00 0.4 0.25 5% 24 hours (except 21.00-14.30) 21.00-14.30 0.6 22.00-23.00 1.5"),
    ("F18", "ig_uk_sb_indices", "Weekend Wall Street DFB: £1 minimum, Saturday 08:00 to Sunday 22:40, 20-point spread", "Weekend Wall Street DFB £1 Saturday 08.00- Sunday 22.40 20 n/a 5%"),
    ("F19", "ig_uk_sb_indices", "Weekend UK 100 DFB: £2 minimum, 8-point spread", "Weekend UK 100 DFB £2 Saturday 08.00- Sunday 22.40 8 n/a 5%"),
    ("F20", "ig_uk_sb_indices", "Weekend Germany 40 DFB: £2 minimum, 14-point spread", "Weekend Germany 40 DFB £2 Saturday 08.00- Sunday 22.40 14 n/a 5%"),
    ("F21", "ig_uk_sb_indices", "Weekend US Tech 100: £2 minimum, 16-point spread", "Weekend US Tech 100 £2 Saturday 08.00 - Sunday 22.40 16 n/a 5%"),
    ("F22", "ig_uk_sb_indices", "Weekend index quotes are IG's own view, and other clients' business may move them", "our quotations reflect our own view of the prospects for each market"),
    ("F23", "ig_uk_sb_forex", "Weekend FX: GBP/USD 6, EUR/USD 6, USD/JPY 4 points, Saturday 08:00 to Sunday 20:40", "Weekend GBP/USD Saturday 08:00 - Sunday 20:40 0.0001 £0.5 6"),
    ("F24", "ig_uk_sb_indices", "UK 100 DFB: £0.50 minimum; 1 point 08:00-16:30, 2 16:30-21:00, 4 21:00-01:00, 3 01:00-07:00", "FTSE 100 DFB £0.50 07.00-08.00 2 0.8 5% 24 hours 08.00-16.30 1 16.30-21.00 2 21.00-01.00 4 01.00-07.00 3"),
    ("F25", "ig_uk_sb_indices", "Germany 40 DFB: £0.50 minimum; 1.2 points 08:00-16:30, 2 16:30-21:00, 5 21:00-00:15, 4 00:15-07:00", "Germany 40 DFB £0.50 00.15-07.00 4 1.5 5% 24 hours 07.00-08.00 2 08.00-16.30 1.2 16.30-21.00 2 21.00-00.15 5"),
    ("F26", "ig_uk_gsl_cost", "A guaranteed stop is charged only if it is triggered", "you’ll only be charged if the stop is actually triggered"),
    ("F27", "ig_uk_negative_balance", "UK negative balance protection returns a negative balance to zero", "we are obligated to return your balance back up to zero as soon as possible"),
    ("F28", "fca_cfd_restrictions", "FCA: retail CFD leverage between 30:1 and 2:1", "Limit leverage to between 30:1 and 2:1"),
    ("F29", "fca_cfd_restrictions", "FCA: close-out at 50 % of the margin needed", "Close out a customer’s position when their funds fall to 50% of the margin needed"),
    ("F30", "fca_cfd_restrictions", "FCA: the CFD rules include financial spread bets and rolling spot forex", "References to CFDs include financial spread bets and rolling spot forex products"),
    ("F31", "hmrc_cg56105", "HMRC: no chargeable gains or allowable losses arise from spread betting", "no chargeable gains or allowable losses arise from spread betting"),
    ("F32", "hmrc_cg56100", "HMRC: retail contracts for differences are a derivative the gains manual treats", "a particular type of contract (a “retail contract for differences”)"),
    ("F33", "uk_tcga1992_s51", "TCGA 1992 s.51(1): winnings from betting are not chargeable gains", "winnings from betting, including pool betting, or lotteries or games with prizes are not chargeable gains"),
    ("F34", "hmrc_bim22020", "HMRC: spread-bet wins are taxable only when they arise from carrying on a trade", "they must arise from the carrying on of that trade"),
    ("F35", "ie_tca1997_s613", "Ireland, TCA 1997 s.613(2): winnings from betting are not chargeable gains", "Winnings from betting (including pool betting), lotteries, sweepstakes or games with prizes shall not be chargeable gains"),
    ("F36", "ig_uk_sb_forex", "IG UK's entities: CFD accounts IG Markets Ltd, spread betting IG Index Ltd, both FCA-authorised", "CFD accounts are provided by IG Markets Ltd, spread betting provided by IG Index Ltd"),
    ("F37", "ig_uk_sb_forex", "IG UK's warning on the product pages: 69 % of retail accounts lose money", "69% of retail investor accounts lose money when trading spread bets and CFDs with this provider"),
    ("F38", "ig_uk_weekend_trading", "IG UK's warning on the weekend page: 70 % (the pages differ on the day read)", "70% of retail investor accounts lose money when trading spread bets and CFDs with this provider"),
    ("F39", "ig_uk_sb_agreement", "IG Index's spread-betting agreement (July 2023): no automated software, algorithm or betting strategy other than IG's own without its prior written consent", "You will not use any automated software, algorithm or betting strategy other than those that we make available to you on our Electronic Betting Services without our prior written consent"),
    ("F40", "ig_uk_sb_agreement", "The same agreement: no strategy that takes unfair advantage of how IG constructs or conveys its prices (latency abuse named)", "take unfair advantage of the way in which we construct, provide or convey our Bid or Offer Prices"),
]


def fold(s):
    return re.sub(r"\s+", " ", s).strip().lower()


def text_of(raw):
    if raw[:5] == b"%PDF-":
        # A PDF (the customer agreements): poppler's pdftotext, the layout dropped.
        with tempfile.NamedTemporaryFile(suffix=".pdf") as fh:
            fh.write(raw)
            fh.flush()
            return subprocess.run(["pdftotext", "-enc", "UTF-8", fh.name, "-"], capture_output=True, check=True).stdout.decode("utf-8", "replace")
    s = raw.decode("utf-8", "replace")
    s = re.sub(r"(?is)<(script|style|noscript)[^>]*>.*?</\1>", " ", s)
    s = re.sub(r"(?s)<[^>]+>", " ", s)
    return re.sub(r"[ \t\r\f\v]+", " ", re.sub(r"\n\s*\n+", "\n", html.unescape(s))).strip()


def fetch(meta):
    for sid, pub, title, url in SOURCES:
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "text/html,application/xhtml+xml"})
            with urllib.request.urlopen(req, timeout=60) as r:
                raw = r.read()
            status = 200
        except Exception as e:  # noqa: BLE001
            raw, status = b"", getattr(e, "code", -1)
        rec = {"status": status, "raw_bytes": len(raw), "raw_sha256": hashlib.sha256(raw).hexdigest() if raw else "",
               "read_date": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")}
        if raw:
            with gzip.GzipFile(os.path.join(OUT, f"{sid}.txt.gz"), "wb", mtime=0) as fh:
                fh.write(text_of(raw).encode())
        meta[sid] = rec
        print(sid, status, len(raw))


def main():
    os.makedirs(OUT, exist_ok=True)
    meta_path = os.path.join(OUT, "fetch_log.json")
    meta = json.load(open(meta_path)) if os.path.exists(meta_path) else {}
    if "--fetch" in sys.argv:
        fetch(meta)
        with open(meta_path, "w") as fh:
            json.dump(meta, fh, indent=1, sort_keys=True)
            fh.write("\n")
    texts = {}
    for sid, *_ in SOURCES:
        p = os.path.join(OUT, f"{sid}.txt.gz")
        texts[sid] = fold(gzip.open(p, "rt").read()) if os.path.exists(p) else ""
    facts = []
    for fid, sid, claim, words in FACTS:
        found = bool(texts.get(sid)) and fold(words) in texts[sid]
        facts.append({"fact_id": fid, "source_id": sid, "claim": claim, "quoted_words": words,
                      "status": "found at source" if found else "not found at source"})
    with open(os.path.join(OUT, "facts.csv"), "w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=["fact_id", "source_id", "claim", "quoted_words", "status"], lineterminator="\n")
        w.writeheader()
        w.writerows(facts)
    with open(os.path.join(OUT, "source_index.csv"), "w", newline="") as fh:
        w = csv.writer(fh, lineterminator="\n")
        w.writerow(["source_id", "publisher", "title", "url_or_document", "read_date", "sha256", "fact_ids"])
        for sid, pub, title, url in SOURCES:
            m = meta.get(sid, {})
            ids = " ".join(f["fact_id"] for f in facts if f["source_id"] == sid and f["status"] == "found at source")
            w.writerow([sid, pub, title, url, m.get("read_date", "not read"), m.get("raw_sha256") or "not found at source", ids])
    for f in facts:
        print(f["fact_id"], f["status"], f["claim"])


if __name__ == "__main__":
    main()
