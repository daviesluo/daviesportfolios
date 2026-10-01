# DAT study: accessibility and fact sources (read 2026-10-01, 03:20-04:05 UTC)

Every fact below was read on 2026-10-01 between 03:20 and 04:05 UTC from the page named. "Indexed" means the page
title and URL were returned by a web search (the page itself answers 403 to automated fetches, so its body was not
read); that is evidence the page exists, not of what it says beyond its title.

## Regulation (FCA, HMRC)

| Fact | Source |
|---|---|
| Retail may buy crypto ETNs (cETNs) from 2025-10-08 if "listed on our Official List and admitted to trading on a UK Recognised Investment Exchange"; they are Restricted Mass Market Investments; appropriateness tests, cooling-off, Consumer Duty | FCA, "Information for firms looking to offer crypto exchange traded notes", first published 2025-10-27, updated 2026-02-06: https://www.fca.org.uk/news/statements/information-firms-offer-crypto-exchange-traded-notes |
| "The FCA's ban on retail access to cryptoasset derivatives will remain in place." No FSCS cover for cETNs | FCA press release "FCA opens retail access to crypto ETNs", 2025-08-01: https://www.fca.org.uk/news/press-releases/fca-opens-retail-access-crypto-etns |
| Retail CFDs: leverage 30:1 to 2:1 by underlying; margin close-out at 50 %; negative balance protection; permanent from 2019-08-01. Individual equities 5:1 (20 % margin) per the FCA's PS19/18 (secondary summary of the search result; the press release states the 30:1-2:1 range) | FCA press release, 2019-07-01: https://www.fca.org.uk/news/press-releases/fca-confirms-permanent-restrictions-sale-cfds-and-cfd-options-retail-consumers ; PS19/18: https://www.fca.org.uk/publication/policy/ps19-18.pdf |
| "Initially, cETNs will be automatically eligible for inclusion in stocks and shares ISAs. From 6 April 2026, they will be reclassified as qualifying investments within the Innovative Finance ISA (IFISA)." | HMRC policy paper, published 2025-10-08: https://www.gov.uk/government/publications/tax-treatment-of-cryptoasset-exchange-traded-notes/tax-treatment-of-cryptoasset-exchange-traded-notes-policy |
| "cETNs are restricted to Innovative Finance ISAs from 6 April 2026 ... No new purchases or transfers of cETNs are permitted into a stocks and shares ISA from that date"; holdings from before stay qualifying | HMRC, Tax-free savings newsletter 21, 2026-06-04: https://www.gov.uk/government/publications/tax-free-savings-newsletter-21/tax-free-savings-newsletter-21-june-2026 |

## Trading 212

| Fact | Source |
|---|---|
| Crypto ETNs can be held in the GIA (Invest) and Stocks ISA at Trading 212 UK Ltd after a Restricted Investor Declaration (no more than 10 % of net assets in high-risk investments), a knowledge and experience check and a 24-hour cooling-off period | Help centre: https://helpcentre.trading212.com/hc/en-us/articles/30591328588573-How-to-obtain-approval-to-invest-in-Crypto-ETNs |
| ISA after 2026-04-06: "You can hold or sell existing positions, but new purchases will not be allowed" (staff, 2026-02-27); "An IFISA isn't part of our current plans" (staff, 2026-02-06) | Community: https://community.trading212.com/t/offering-ifisa-from-april-2026/90306 |
| Trading 212 sold cETNs to UK retail before holding the debentures permission; the permission was granted in late January 2026 (FT report) | Crypto Economy, 2026-01-27: https://crypto-economy.com/financial-times-trading212-illegal-crypto-etns/ ; Finextra: https://www.finextra.com/newsarticle/47195/ |
| "212 Crypto" (spot crypto) is for Trading 212 Markets Ltd clients, not the UK entity (staff: no news on UK availability) | Community, 2025-10-06: https://community.trading212.com/t/introducing-212-crypto/88089 |
| Instrument pages indexed for: MSTR.US (Invest), MSTR.US (CFD), SBET.US (Invest), MST3.GB (3x long MSTR), SMST.GB (-3x short MSTR), MSTI.GB, MSTP.GB, MSTY.FR; bitcoin ETNs IB1T.GB, WXBT.GB, FBTG.GB, BTCX.GB; ether ETNs ETHX.GB, ET32.GB | Web search index of trading212.com/trading-instruments/... (page bodies 403) |
| Not found among indexed pages: BMNR, Metaplanet (3350.T / MTPLF), NAKA, ASST, XXI. A community request for BMNR said it had not met the platform's criteria (thread now 404). Unverified either way | Web search 2026-10-01; https://community.trading212.com/t/bmnr-request/86551 (404 on 2026-10-01) |
| Overnight interest on CFDs: "Short (Sell): Quantity × Price × Short overnight interest rate", charged 22:00 GMT (21:00 DST) Mon-Thu and Sunday for the weekend; a short can be charged or credited; rates change daily (the MSTR CFD's own rate is shown only in the app) | Help centre: https://helpcentre.trading212.com/hc/en-us/articles/360007113997-What-is-overnight-interest |
| FX fee 0.15 % per conversion; bank-transfer deposits free; multi-currency balances (13 currencies) | Wise guide: https://wise.com/gb/blog/trading-212-fx-fees ; Trading 212 multi-currency page (indexed): https://www.trading212.com/multi-currency |
| Withdrawals by bank transfer up to 3 business days, no withdrawal fee | Wise guide: https://wise.com/gb/blog/withdraw-trading-212-guide ; PIP Penguin: https://pippenguin.net/trading/learn-trading/how-long-to-withdraw-trading-212/ |
| Extended hours on all NYSE/Nasdaq stocks (pre-market 04:00-09:30 ET, after-hours 16:00-20:00 ET) | Help centre: https://helpcentre.trading212.com/hc/en-us/articles/9946943754013-What-are-extended-market-hours |
| 24/5: an overnight session 20:00-04:00 ET "exclusively available only to the most liquid securities"; no list; API access not stated | Help centre: https://helpcentre.trading212.com/hc/en-us/articles/13574400364445-24-5-Trading-Invest-Stocks-ISA |
| API: market orders take `extendedHours`; a community report says the limit endpoint rejected it | docs.trading212.com (indexed); community: https://community.trading212.com/t/trading-212-api-update/87988 |

## Listing currencies (Yahoo chart metadata, read 2026-10-01; meta fields only)

| Line | Currency | Exchange | First trade (Yahoo) |
|---|---|---|---|
| IB1T.L iShares Bitcoin ETP | GBP | LSE | 2025-10-20 |
| BTCW.L WisdomTree Physical Bitcoin | USD | LSE | 2024-05-28 |
| WXBT.L WisdomTree Physical Bitcoin | GBp | LSE | 2019-12-02 |
| FBTG.L Fidelity Physical Bitcoin | GBP | LSE | 2025-09-29 |
| BTCX.L Global X Bitcoin | GBP | LSE | 2025-09-29 |
| BITC.L CoinShares Bitcoin | USD | LSE | 2025-02-03 |
| ETHX.L Global X Ethereum | GBP | LSE | 2025-09-29 |
| ET32.L Bitwise Ethereum Staking | USD | LSE | 2025-04-16 |
| ETHW.L WisdomTree Physical Ethereum | USD | LSE | 2024-05-28 |
| SMST.L Leverage Shares -3x Short MSTR | GBp | LSE | 2024-10-14 |
| MST3.L Leverage Shares 3x Long MSTR | USD | LSE | 2024-10-11 |
| MSTR, SBET, BMNR, NAKA, ASST, UPXI, DFDV, SQNS, XXI, BTBT | USD | US | - |
| 3350.T Metaplanet | JPY | Tokyo | - |

IB1T: TER 0.25 % with a waiver to 0.15 % until 2026-12-31 (iShares terms, quoted by Investing.com's listing notes and
justETF: https://www.justetf.com/en/etf-profile.html?isin=XS2940466316). justETF lists the LSE line in GBP, agreeing
with Yahoo; an Investing.com note calls the product USD-denominated (its base currency).

## Revolut

| Fact | Source |
|---|---|
| Revolut-to-Revolut transfers instant and free | Revolut instant transfer page (indexed): https://www.revolut.com/en-US/money-transfer/instant-money-transfer/ |
| Standard plan FX: free on weekdays to a fair-usage limit (sources say £1,000 a month), then 0.5 % (one source says 1 %); a weekend mark-up (0.5 %-1 % by source) from Friday 17:00 to Sunday 18:00 ET. The two secondary sources disagree; Revolut's own help page answered 403 | https://pocketwise.co.uk/banking/revolut/revolut-fees-uk/ ; https://bankinggeek.com/en/revolut-fees/ |
| Revolut X: 0 % maker / 0.09 % taker; the live loop's account; never traded by hand (repository rule) | `.claude/CLAUDE.md`; `docs/agents/reference.md` §2 |

## Other CFD providers (reference for financing only)

| Fact | Source |
|---|---|
| IG share CFDs: overnight funding = notional × (3 % admin fee ± benchmark: SONIA, SOFR, ESTR) / 365; a short in a cash CFD also pays a borrow charge that "varies according to the stock ... and includes a 0.5% administration fee" | IG help: https://www.ig.com/uk/help-and-support/spread-betting-and-cfds-5064504a/fees-and-costs-efcb88d2/what-is-overnight-funding-how-is-it-charged-and-how-is-65e16fa6 |

## Company facts used beyond SEC filings

| Fact | Source |
|---|---|
| MSTR announced 29,646 BTC bought, 70,470 held, on Monday 2020-12-21 by press release (no 8-K that day) | Yahoo Finance / CoinDesk, 2020-12-21: https://finance.yahoo.com/news/microstrategy-now-holds-70-470-155027100.html |
| 2021-02-24: 19,452 BTC bought, "As of February 24, 2021 ... approximately 90,531 bitcoins" (press release; the next 8-K is 2021-03-01) | strategy.com press release (indexed): https://www.strategy.com/press/microstrategy-acquires-additional-19452-bitcoins-for-1-026-billion_02-24-2021 ; quoted in the FY2021 10-K |
| 2021-06-21: 13,005 BTC bought, 105,085 held (press release; next SEC statement the 2021-07-29 10-Q) | strategy.com press release (indexed): https://www.strategy.com/press/microstrategy-acquires-additional-bitcoins-and-now-holds-over-105000-bitcoins-in-total_06-21-2021 ; Bitcoin Magazine: https://bitcoinmagazine.com/business/microstrategy-buys-13005-bitcoin-at-489m |
| BMNR's SEC CIK is 1829311 | EDGAR exhibit URL https://www.sec.gov/Archives/edgar/data/1829311/000149315226042492/ex99-1.htm |
| BMNR moved to the NYSE on 2026-04-09 and expanded its share repurchase program to $4 billion; Series A preferred (BMNP) listed 2026-06-16 | PR Newswire: https://www.prnewswire.com/news-releases/bitmine-immersion-technologies-nyse-bmnr-announces-uplisting-to-new-york-stock-exchange-and-expansion-of-share-repurchase-program-to-4-billion-302737742.html ; https://www.prnewswire.com/news-releases/bitmine-immersion-technologies-announces-initial-dividends-and-nyse-listing-for-series-a-preferred-stock-302799416.html |
| Semler Scientific's holders approved its all-stock acquisition by Strive | Yahoo Finance: https://finance.yahoo.com/news/strive-semler-stocks-fall-shareholders-204433362.html |

## Reachability (2026-10-01)

Yahoo chart API (query1/query2) 200; Stooq timed out; SEC data.sec.gov, www.sec.gov/Archives and efts.sec.gov 200 with
a User-Agent carrying no e-mail address (www.sec.gov/cgi-bin 403); Coinbase Exchange public candles 200;
strategy.com 403; trading212.com 403; bitcointreasuries.net 200 (current figures only); iborrowdesk.com timed out.

## Literature and history (read 2026-10-01, 04:40-04:50 UTC)

| Reference | What it is used for | Source |
|---|---|---|
| Lee, Shleifer & Thaler (1991), "Investor Sentiment and the Closed-End Fund Puzzle", Journal of Finance 46(1), 75-109 | closed-end discounts move with sentiment and persist | https://onlinelibrary.wiley.com/doi/10.1111/j.1540-6261.1991.tb03746.x |
| Shleifer & Vishny (1997), "The Limits of Arbitrage", Journal of Finance 52(1), 35-55 | arbitrage needs capital and is risky; it fails when prices diverge far | https://onlinelibrary.wiley.com/doi/abs/10.1111/j.1540-6261.1997.tb03807.x |
| Pontiff (1996), "Costly Arbitrage: Evidence from Closed-End Funds", Quarterly Journal of Economics 111(4), 1135-1151 | discounts persist where arbitrage is costly to hold | Google Scholar record via search: https://scholar.google.com/citations?user=XKfAvYQAAAAJ |
| Bradley, Brav, Goldstein & Jiang (2010), "Activist Arbitrage: A Study of Open-Ending Attempts of Closed-End Funds", Journal of Financial Economics 95(1), 1-19 | open-ending attempts cut discounts to about half on average: a closing event is what closes a gap | https://papers.ssrn.com/sol3/papers.cfm?abstract_id=1947048 |
| Choueifaty, Froidure & Cabrol (2025-03-10), "Accounting for the Performance of MicroStrategy: First decomposition", SSRN 5172347 | 2021-2024: MSTR 7.5x against BTC 3.2x "despite a stable Ratio Premium"; the gain came from issuance raising bitcoin per share | https://papers.ssrn.com/sol3/papers.cfm?abstract_id=5172347 (abstract as quoted by search; the page answered 403) |
| Kerrisdale Capital, "Long BTC / Short MicroStrategy Inc (MSTR)", 2024-03-28 | the public premium trade, entered at about 2.57x (a diluted count) | https://www.kerrisdalecap.com/wp-content/uploads/2024/03/MicroStrategy-MSTR.pdf ; CoinDesk 2024-03-28: https://www.coindesk.com/markets/2024/03/28/microstrategy-trades-at-an-unjustifiable-premium-to-bitcoin-kerrisdale-capital |
| GBTC: a discount near 48-50 % in December 2022, closed to 0 when it converted to a spot ETF with creation and redemption on 2024-01-11 | a gap closes when a creation/redemption mechanism arrives | CoinDesk 2024-01-11: https://www.coindesk.com/markets/2024/01/11/grayscales-gbtc-discount-closes-to-zero-for-first-time-since-february-2021 |

## Treasury-company events, 2025-2026 (each date checked against the company's own SEC filing where one exists)

| Event | Source |
|---|---|
| BitMine $1bn buyback, 8-K accepted 2025-07-29 07:20 ET | https://www.sec.gov/Archives/edgar/data/1829311/000149315225011466/form8-k.htm ; Nasdaq PR 2025-07-29 |
| Volcon/Empery: bitcoin treasury and buyback raised to $100m, 8-K 2025-07-25 09:25 ET; $25m facility for buybacks 2025-08-18; 13.7m shares bought by 2025-11-28 (8-K 2025-12-01) | EDGAR CIK 1829794: 0001683168-25-005371, -006265, -008737 |
| Empery: activist ATG Capital, ~12 % stake hedged by shorting bitcoin ETFs, board fight (January 2026) | Empery DEFA14A and Schedule 13D/A on EDGAR (CIK 1829794), via search |
| SharpLink $1.5bn buyback, 8-K 2025-08-22 16:15 ET; first buybacks (~939k shares at $15.98), 8-K 2025-09-09 08:15 ET | EDGAR CIK 1981535: 0001641172-25-025218, 0001493152-25-012846; The Block; CoinDesk 2025-09-09 |
| FG Nexus $200m buyback initiated, 8-K 2025-10-21 08:30 ET; sold 10,922 ETH, ~3.4m shares bought at ~$3.45 against NAV ~$3.94, 8-K 2025-11-21 08:12 ET | EDGAR CIK 1591890: 0001493152-25-018733, -024549 |
| ETHZilla sold ~$40m of ETH to fund buybacks, 8-K 2025-10-27 16:00 ET; later 24,291 ETH sold to redeem notes; renamed Forum Markets (FRMM) 2026-03-02 | EDGAR CIK 1690080: 0001213900-25-102560; CoinDesk 2025-10-27; The Block |
| Metaplanet buyback of up to 150m shares (¥75bn), funded by a $500m credit facility, 2025-10-28, after mNAV fell below 1 | Blockspace; Cryptonomist 2025-10-28; Bitbo |
| Sequans sold 970 BTC to redeem half its converts (6-K 2025-11-04 06:00 ET); "no longer pursuing" the treasury by May 2026; sold its last 314 BTC 2026-09-24 | EDGAR CIK 1383395: 0001383395-25-000112; Cointelegraph 2026-09-24 |
| Upexi $50m buyback (release dated 2025-11-13; 8-K 2025-11-14) | Nasdaq PR 2025-11-13; EDGAR CIK 1775194: 0001477932-25-008305 |
| Strive acquired Semler Scientific, 21.05 ASST per SMLR, closed 2026-01-16 | Nasdaq PR 2026-01-16; Strive 10-K FY2025 |
| BitMine buyback expanded to $4bn with the NYSE uplisting, 2026-04-09 | PR Newswire 2026-04-09 |
| Satsuma Technology holders voted 90.63 % to return capital (sell ~668 BTC) and to delist, 2026-07-20 | Bitcoin Magazine; crypto.news |
| Strategy (MSTR): a $1.44bn USD reserve, 2025-12-01; its CEO said it would sell bitcoin if mNAV were below 1 and no other capital were available (listed, not measured: MSTR's held-out years stay unread) | Benzinga; TheStreet (2025-12-01/02) |
