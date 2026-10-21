// Bitcoin's analyst targets, kept by hand: no API serves bank or research-house targets for a crypto asset (Yahoo's
// quoteSummary answers "No fundamentals data found" for BTC-USD; checked 2026-10-21). Each row is one firm's latest
// published target that a session read in its source, with the day it was published, its horizon and the source.
// Nothing here is from memory: every figure was read on its page on 2026-10-21.
//
// AS OF 2026-10-21. A session refreshes this table (a new target replaces its firm's row; a firm whose newest target is
// over a year old leaves): the page shows the rows' dates, and its fresh window counts only the last 30 days.
//
// Left out on purpose: JPMorgan (its widely quoted figures are a long-run gold-parity value, not a dated target), and
// Fidelity and Fundstrat (ranges, not one target).

export const STRATEGIST_AS_OF = "2026-10-21";

export const STRATEGIST_TARGETS: Record<string, Array<{ firm: string; target: number; date: string; horizon: string; url: string }>> = {
  "BTC-USD": [
    // "end year forecasts of $100,000", "a further downgrade from $150,000" (The Block, 2026-02-12).
    { firm: "Standard Chartered", target: 100_000, date: "2026-02-12", horizon: "end-2026", url: "https://www.theblock.co/post/389609/standard-chartered-bitcoin-50000-ether-1400-rebound" },
    // "sees bitcoin at $82,000 a year out", "down from $112,000" (Bitcoin Magazine, 2026-07-01).
    { firm: "Citi", target: 82_000, date: "2026-07-01", horizon: "12 months", url: "https://bitcoinmagazine.com/news/citi-slashes-bitcoin-target-to-82000" },
    // "a new all-time high of $150,000 by mid-2027" in its base case (The Block, 2026-08-26).
    { firm: "Bernstein", target: 150_000, date: "2026-08-26", horizon: "mid-2027", url: "https://theblock.co/news/markets/2026-08-26-bernstein-sees-bitcoin-reaching-150000-by-mid-2027-amid-debasement-trade-but-cuts-strategy-target-to-350-412778" },
  ],
};

/**
 * A fund priced from its index's published strategist targets (Davies, 2026-10-21: "Can't VUAA just use the
 * ready-made S&P 500 targets? There should be plenty."). No API we hold serves them: Yahoo's quoteSummary has no
 * targets for `^GSPC` ("No fundamentals data found", read 2026-10-21), Finnhub's price-target endpoint is for stocks and
 * premium, Alpha Vantage has none. So, like bitcoin's, a dated, sourced table kept by hand: each firm's latest year-end
 * 2026 S&P 500 target that a session read in its source. The job puts them on VUAA's price by VUAA over the index level
 * (`index.scale`) and keeps the holdings-weighted target beside them as the bottom-up cross-check.
 *
 * AS OF 2026-10-21. Firms whose own change dates no source in hand gave are dated by Reuters' factbox of 2026-08-11
 * ("Major brokerages' forecasts for S&P 500 index in 2026"), which listed them at those levels on that day. Left out:
 * UBS Global Wealth Management (UBS Global Research is in), Wells Fargo Investment Institute (a range, and Wells Fargo
 * is in), and every 12-month or mid-2027 figure (Morgan Stanley's 8,300, BofA's 7,800, Yardeni's 8,400): one horizon,
 * end-2026, for all. VUAA accumulates its dividends and the index targets are price levels, so the fund's own return
 * to those targets is higher by its yield (about 1 % a year).
 */
const REUTERS_FACTBOX_2026_08_11 = "https://www.galvnews.com/news_reuters/business/factbox-major-brokerages-forecasts-for-s-p-500-index-in-2026/article_7275084d-b0f7-55d9-b162-d22b116e17fd.html";
export const INDEX_TARGETS: Record<string, { index: string; name: string; asOf: string; rows: Array<{ firm: string; target: number; date: string; horizon: string; url: string }> }> = {
  "VUAA.L": {
    index: "^GSPC", name: "S&P 500", asOf: "2026-10-21",
    rows: [
      // "raised its 2026 year-end S&P 500 target to 8,000 from 7,600" (Reuters via Yahoo, note of 2026-05-26).
      { firm: "Goldman Sachs", target: 8_000, date: "2026-05-26", horizon: "end-2026", url: "https://finance.yahoo.com/markets/stocks/articles/goldman-sachs-lifts-p-500-033812652.html" },
      // "raises its S&P 500 year-end target to 8,000 (prev. 7,800) and its 2027 mid-year target to 8,300" (2026-05-13).
      { firm: "Morgan Stanley", target: 8_000, date: "2026-05-13", horizon: "end-2026", url: "https://www.newsquawk.com/headlines/morgan-stanley-raises-its-sp-500-year-end-target-to-8000-prev-7800-and-its-2027-mid-year-target-to-8300" },
      // "JP Morgan raises S&P 500 year-end target to 8,000" (2026-08-10).
      { firm: "J.P. Morgan", target: 8_000, date: "2026-08-10", horizon: "end-2026", url: "https://www.nst.com.my/amp/business/corporate/2026/08/1508037/jp-morgan-raises-sp-500-year-end-target-8000" },
      // "lifts S&P 500 year-end target to 8,100" from 7,700 (Reuters, 2026-06-08; Citi's note of 06-05).
      { firm: "Citigroup", target: 8_100, date: "2026-06-08", horizon: "end-2026", url: "https://www.kitco.com/news/off-the-wire/2026-06-08/citigroup-lifts-sp-500-year-end-target-8100-earnings-strength-ai" },
      // Year-end 2026 target 7,400, up from 7,100 (2026-09-14); its 12-month 7,800 is left out.
      { firm: "BofA Global Research", target: 7_400, date: "2026-09-14", horizon: "end-2026", url: "https://stocktwits.com/news-articles/markets/equity/stock-market-is-overdue-for-over-10-correction-says-bofa-ahead-of-fomc-meeting/cZtl6wBRBRm" },
      // "raised its year-end target for the S&P 500 to 8,100 from 7,650" (Reuters, 2026-09-08).
      { firm: "HSBC", target: 8_100, date: "2026-09-08", horizon: "end-2026", url: "https://www.kitco.com/news/off-the-wire/2026-09-08/hsbc-lifts-sp-500s-year-end-target-8100-earnings-strength" },
      // "raised its year-end target … to 7,950 from 7,800" (2026-09-09).
      { firm: "Barclays", target: 7_950, date: "2026-09-09", horizon: "end-2026", url: "https://www.bnnbloomberg.ca/markets/s-p-500/2026/09/09/barclays-lifts-sp-500-indexs-year-end-target-to-7950-on-strong-earnings/" },
      // Cut to 7,900 from 8,400 on 2026-09-15 (money.it, 2026-09-21; Advisor Perspectives, 2026-09-16); 8,400 became mid-2027.
      { firm: "Yardeni Research", target: 7_900, date: "2026-09-15", horizon: "end-2026", url: "https://www.money.it/wall-street-si-mette-sulla-difensiva-ed-yardeni-taglia-il-target-dell-sp-500-a-7900-punti" },
      // Listed at these levels in Reuters' factbox of 2026-08-11.
      { firm: "Deutsche Bank", target: 8_000, date: "2026-08-11", horizon: "end-2026", url: REUTERS_FACTBOX_2026_08_11 },
      { firm: "Wells Fargo", target: 7_950, date: "2026-08-11", horizon: "end-2026", url: REUTERS_FACTBOX_2026_08_11 },
      { firm: "UBS Global Research", target: 7_500, date: "2026-08-11", horizon: "end-2026", url: REUTERS_FACTBOX_2026_08_11 },
      { firm: "Evercore ISI", target: 7_750, date: "2026-08-11", horizon: "end-2026", url: REUTERS_FACTBOX_2026_08_11 },
      { firm: "Oppenheimer Asset Management", target: 8_100, date: "2026-08-11", horizon: "end-2026", url: REUTERS_FACTBOX_2026_08_11 },
      { firm: "RBC Capital Markets", target: 7_900, date: "2026-08-11", horizon: "end-2026", url: REUTERS_FACTBOX_2026_08_11 },
      { firm: "Societe Generale", target: 8_000, date: "2026-08-11", horizon: "end-2026", url: REUTERS_FACTBOX_2026_08_11 },
      { firm: "Jefferies", target: 7_500, date: "2026-08-11", horizon: "end-2026", url: REUTERS_FACTBOX_2026_08_11 },
      { firm: "BNP Paribas", target: 7_500, date: "2026-08-11", horizon: "end-2026", url: REUTERS_FACTBOX_2026_08_11 },
      { firm: "Canaccord Genuity", target: 7_500, date: "2026-08-11", horizon: "end-2026", url: REUTERS_FACTBOX_2026_08_11 },
      { firm: "Seaport Research Partners", target: 7_800, date: "2026-08-11", horizon: "end-2026", url: REUTERS_FACTBOX_2026_08_11 },
    ],
  },
};
