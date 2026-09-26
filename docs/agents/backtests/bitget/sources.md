# Sources (all read 2026-09-26 UTC, from this container, keyless)

## Bitget's own pages ("Bitget says")
- B1 Terms of Use, "Last updated: September 15, 2026" — https://www.bitget.com/support/articles/360014944032-terms-of-use
  Prohibited Countries: Austria, Canada, Crimea, Cuba, Donetsk, France, Germany, Hong Kong, Iran, Japan, Kazakhstan,
  Luhansk, Malaysia, North Korea, Singapore, Sudan, the United States (and territories), Iraq, Libya, Yemen, Afghanistan,
  CAR, DRC, Guinea-Bissau, Haiti, Lebanon, Somalia, South Sudan, Thailand. The UK appears only as a sanctions-list issuer;
  Ireland is not mentioned. Operator: "BTG Technology Holdings Limited".
- B2 Licences page — https://www.bitget.com/promotion/regulatory-license — UK: "FCA-approved platform partnering with an
  Authorized Person for the purposes of Section 21 of the Financial Services and Markets Act 2000". No EU licence listed.
- B3 Notice to UK users, 2024-05-03 — https://www.bitget.com/support/articles/12560603809106 (onboarding paused)
- B4 UK relaunch, 2024-11-12 — https://www.bitget.com/news/detail/12560604344549 ; https://www.bitget.com/blog/articles/bitget-enters-uk
  ("more than 150 tokens"; Archax approval). www.bitget.com/en-GB footer: "Approved by Archax LTD on 15/10/2024" (raw/bitget_enGB_page.html).
- B5 "Update on MiCAR authorisation process", 2026-07-02 — https://www.bitget.com/support/articles/12560603885949
  (Bitget EU has applied to Austria's FMA; outcome "subject to the FMA's assessment").
- B6 Trading Fees FAQ, 2026-08-20 — https://www.bitget.com/support/articles/12560603892734 (0.1 % maker and taker)
- B7 Spot Trading Fees, Limits, and Rules, 2024-12-30 — https://www.bitget.com/support/articles/12560603820584 (BGB: 20 % off)
- B8 VIP ladder — GET https://api.bitget.com/api/v2/spot/market/vip-fee-rate (raw/vip_fee_rate_2026-09-26.json)
- B9 Zero-fee books: USDC/USDT, 2024-07-30 — https://www.bitget.com/support/articles/12560603813487 ;
  USDT/USD and USDC/USD, 2025-12-09 (excluded list names Cyprus, not the UK or Ireland) — https://www.bitget.com/support/articles/12560603845278 ;
  USDGO/USDT and USDGO/USDC, 2026-03-05 — https://www.bitget.com/blog/articles/bitget-usdgo-stablecoin-listing ;
  expired: USDE pairs 2024-11-21 → 12-21, API users excluded — https://www.bitget.com/en-CA/news/detail/12560604363016 ;
  EUR fiat pairs USDC/EUR, BTC/EUR, ETH/EUR, SOL/EUR, 2024-08-02 → 10-02, API users excluded (announced 2024-07-31) —
  https://www.bitget.com/news/detail/12560604128327 .
- B10 Security incident: 2026-09-24 https://www.bitget.com/en/support/articles/12560603896024 ;
  2026-09-25 https://www.bitget.com/en/support/articles/12560603896108 ($387.5 M, revised from $351.6 M) ;
  2026-09-26 https://www.bitget.com/en/support/articles/12560603896110 (withdrawals resume 09-28 → 10-02).
- B11 RPI orders, 2026-03-13 — https://www.bitget.com/support/articles/12560603867770 ("Only designated market maker partners").
- B12 EUR SEPA deposits, 2024-05-03 — https://www.bitget.com/support/articles/12560603809099 ("only to users who have completed
  identity verification in the EEA, the United Kingdom, or Switzerland"); bank-deposit countries, 2025-02-20 —
  https://www.bitget.com/support/articles/12560603823032 (EUR list includes Ireland; UK and GBP not listed).
- B13 API docs — https://www.bitget.com/docs/catalog/classic-spot-market/classic-spot-market (fills-history: 90 days, 7-day
  windows; candle reach) ; https://www.bitget.com/docs/catalog/market/market-data (v3, RPI order book) — saved in docs/.
- B14 History data download — https://www.bitget.com/data-download ; the page calls
  POST https://www.bitget.com/v1/statistics/public/download/getPublicDataV2 (files on img.bitgetimg.com).

## Regulators' registers ("register shows")
- R1 ESMA interim MiCA register — https://www.esma.europa.eu/sites/default/files/2024-12/CASPS.csv and NCASP.csv
  (HTTP Last-Modified 2026-09-24 06:44 / 06:45 GMT; raw/esma_*.csv): 362 CASP records, none for Bitget/BTG; none in the
  non-compliant list either. Austrian entries include Bybit EU GmbH, KuCoin EU Exchange GmbH, OSL EU GmbH — no Bitget.
- R2 FCA — https://www.fca.org.uk/search-results?search_term=bitget (and &np_category=warnings): "No search results for
  bitget". The Financial Services Register itself was not queried (JavaScript app; its API needs a key).
- R3 Central Bank of Ireland — https://www.centralbank.ie/regulation/how-we-regulate/authorisation/unauthorised-firms/search-unauthorised-firms
  (the page embeds the list): no "Bitget"; it does name e.g. Bitlet, Bitewallet, A1Bitminers.

## Secondary, flagged as such
- Cryptonomist, 2026-07-02 — https://en.cryptonomist.ch/2026/07/02/bitget-micar-authorization-eu/ — quotes Bitget's CEO:
  Bitget "would not provide services in the EEA without authorization". Her X post itself returned HTTP 402 here.

## Market data (keyless)
- Bitget: api.bitget.com v2/v3 public endpoints; img.bitgetimg.com history files. Nothing was refused by the proxy.
- Reference rates: Kraken public Ticker; Binance data-api.binance.vision bookTicker and data.binance.vision 1-minute klines.
