// The "Target price" page's Key risks column: a few words per holding, kept by hand in this file (Davies, 2026-10-21,
// who gave the first five as the style, then asked for every holding). Keyed by the ticker the page shows (`displayTicker`: SIVE, not 2DG.SG).
//
// Each note is a string, or a function of the row for a figure that must stay true as the price moves (RKLB's lowest
// target against its price is computed, never written down). A note tied to a date carries `until` (a New York date,
// YYYY-MM-DD): it is shown through that day and drops out after it, so an investor day or an earnings date never
// lingers once it has passed. To change a note, edit this file; the page has no editor.

/**
 * @typedef {{ low: number | null, price: number | null, lowVsPrice: number | null }} RiskRow
 * @typedef {{ text: string | ((row: RiskRow) => string | null), until?: string }} RiskNote
 */

/** @param {number} n */
const usd = (n) => `$${n >= 100 ? Math.round(n).toLocaleString('en-US') : Number(n.toFixed(2)).toString()}`;

/**
 * Every holding on the board on 2026-10-21 (30), researched that day: 1–3 items each, terse, factual and dated, in the
 * style of Davies's first five (which are kept, brought up to date). The source of each figure is in the comment above
 * it. An "est." date is a calendar's estimate, not the company's; it drops out after the latest estimate.
 * @type {Record<string, RiskNote[]>}
 */
export const TARGET_RISKS = {
  // https://macrumors.com/2026/10/06/apple-q4-2026-earnings-nov-2 (Apple IR: FQ4 results 11/2)
  // https://news.bloomberglaw.com/litigation/apple-in-early-settlement-talks-with-doj-over-antitrust-case (7/17: talks, no trial date)
  AAPL: [{ text: 'earnings 11/2', until: '2026-11-02' }, { text: 'DOJ antitrust suit: settlement talks (7/2026), no trial date' }],
  // https://www.aboutamazon.com/md/news/company-news/amazon-earnings-q3-2026-report (Q3 call 10/29)
  // https://www.mlex.com/mlex/articles/2536525/amazon-s-bid-to-delay-us-ftc-monopolization-trial-rejected-by-judge (10/9)
  AMZN: [{ text: 'earnings 10/29', until: '2026-10-29' }, { text: 'FTC monopoly trial 3/29/27; delay refused 10/9' }],
  // https://www.sec.gov/Archives/edgar/data/0001144879/000114487926000057/apldq127earningsrelease.htm (FQ1: net loss $184.1M, 10/7)
  // https://nasdaq.com/articles/applied-digital-just-borrowed-another-2-billion-its-biggest-customer-21-billion-debt ($2.15B 6.75% notes due 2031)
  // https://finance.yahoo.com/markets/stocks/articles/applied-digital-under-debt-overhang-141012229.html (~70% of pipeline CoreWeave)
  APLD: [{ text: 'CoreWeave ~70% of contracted pipeline' }, { text: '$2.15B 6.75% secured notes due 2031' }, { text: 'FQ1 net loss $184.1M (10/7)' }],
  // https://www.sec.gov/Archives/edgar/data/1730168/000173016825000121/avgo-20251102.htm (FY2025 10-K: top five end customers ~40%)
  // https://days.to/when-is/broadcom-earnings (FQ4 ~12/10, unconfirmed)
  AVGO: [{ text: 'Top 5 customers ~40% of revenue (FY25 10-K)' }, { text: 'earnings ~12/10 (est.)', until: '2026-12-10' }],
  // https://www.bloomenergy.com/news/bloom-energy-to-announce-third-quarter-2026-financial-results-on-october-22-2026/
  // https://www.businesswire.com/news/home/20251030033915/en/Bloom-Energy-Corporation-Announces-Proposed-Convertible-Senior-Notes-Offering (0% due 2030)
  BE: [{ text: 'earnings 10/22', until: '2026-10-22' }, { text: 'Converts due 2029 and 2030 (the 2030s 0%, 11/2025)' }],
  // https://www.prnewswire.com/es/comunicados-de-prensa/bitmine-immersion-technologies-bmnr-anuncia-que-sus-tenencias-de-eth-alcanzan-los-6-04-millones-de-tokens-302912524.html (6.04M ETH, 10/18)
  // https://www.stocktitan.net/sec-filings/BMNR/424b5-bit-mine-immersion-technologies-inc-prospectus-supplement-debt--3f3e53883683.html (ATM up to $24.5B)
  // https://www.vtmarkets.com/tr-mena/discover/bmnr-stock-what-is-bitmine-immersion-technologies-is-it-worth-watching/ (9.50% perpetual preferred, 6/2026)
  BMNR: [{ text: 'A leveraged ETH proxy: 6.04M ETH (10/18), ~4.9% of supply' }, { text: 'funded by ATM share sales and a 9.50% perpetual preferred (6/2026)' }],
  // https://www.crowdfundinsider.com/2026/09/310572-spot-bitcoin-etfs-see-450m-outflows-after-senate-stalls-clarity-act/
  'BTC-USD': [{ text: 'CLARITY Act failed cloture 49–50 (9/2026): no US market-structure law this year' }, { text: 'spot ETF outflows $450M that day' }, { text: 'trades with rates and risk appetite' }],
  // https://www.tikr.com/blog/coreweaves-640m-interest-bill-is-growing-faster-than-its-128m-profit-but-management-says-the-burn-is-by-design-heres-what-investors-need-to-know (Q2: debt $35.1B, net interest $640M)
  // https://beta.earningswhispers.com/go/x/CRWV (Q3 ~11/10, unconfirmed)
  CRWV: [{ text: 'Debt $35.1B vs PP&E $46.7B (6/30)' }, { text: 'net interest $640M in Q2' }, { text: 'earnings ~11/10–11/16 (est.)', until: '2026-11-16' }],
  // https://www.sec.gov/Archives/edgar/data/0001652044/000165204426000071/goog-20260630.htm (search remedies under appeal)
  // https://www.relevantaudience.com/google-ads-en/brinkema-rejects-adx-divestiture-behavioural-remedies/ (9/2: no AdX sale, conduct remedies)
  // https://www.wallstreethorizon.com/alphabet-earnings-calendar (10/28 inferred)
  GOOG: [{ text: 'Ad-tech remedies ordered 9/2 (no AdX sale)' }, { text: 'search judgment under appeal' }, { text: 'earnings ~10/28 (est.)', until: '2026-10-28' }],
  // https://www.globenewswire.com/news-release/2026/10/01/3373375/0/en/index.html (Q3 results 10/27)
  // https://www.webull.com/news/14052150590866432 (CFTC comment request on event contracts)
  HOOD: [{ text: 'earnings 10/27', until: '2026-10-27' }, { text: 'Prediction markets: CFTC weighing event-contract rules' }],
  // https://investor.atmeta.com/investor-news/press-release-details/2026/Meta-to-Announce-Third-Quarter-2026-Results/default.aspx (10/21 after close)
  // https://www.tikr.com/blog/meta-now-owes-22-billion-more-than-it-holds-heres-why-that-matters (2026 capex guide up to $145B)
  // https://www.ifre.com/bonds/2334314/meta-hits-market-with-six-part-jumbo-amid-ai-push (Hyperion: $27B JV with Blue Owl, residual value guarantee)
  META: [{ text: 'earnings 10/21', until: '2026-10-21' }, { text: '2026 capex guide up to $145B' }, { text: 'Hyperion $27B off-balance-sheet JV, Meta guarantees residual value' }],
  // https://finviz.com/news/400058/microsoft-announces-quarterly-earnings-release-date (FQ1 results 10/28)
  // https://www.nasdaq.com/articles/microsofts-biggest-ai-customer-also-its-biggest-risk (OpenAI ~45% of RPO)
  MSFT: [{ text: 'earnings 10/28', until: '2026-10-28' }, { text: 'OpenAI ~45% of commercial backlog (analyst est.)' }, { text: 'capacity-constrained' }],
  // https://www.strategy.com/press/strategy-announces-earnings-release-date-and-live-video-webinar-for-third-quarter-2026-financial-results_10-08-2026 (10/29)
  // https://www.sec.gov/Archives/edgar/data/0001050446/000119312526363557/d431748dfwp.htm (mNAV 1.01x on 8/21; common below all debt and preferred)
  MSTR: [{ text: 'earnings 10/29', until: '2026-10-29' }, { text: 'mNAV ~1.0x (8/21)' }, { text: 'common ranks below converts and four preferred series' }],
  // https://www.sec.gov/Archives/edgar/data/0000723125/000072312526000018/a2026q4ex991-pressrelease.htm (FQ4 revenue $54.23B vs $11.32B a year earlier)
  // https://www.wallstreethorizon.com/micron-earnings-calendar (12/16 inferred)
  MU: [{ text: 'Memory peak-cycle risk: FQ4 revenue $54.2B vs $11.3B a year earlier' }, { text: 'earnings ~12/16 (est.)', until: '2026-12-16' }],
  // https://nebius.com/newsroom/nebius-group-announces-closing-of-private-offering-of-convertible-senior-notes-with-aggregate-gross-proceeds-of-approximately-5-75-billion (8/24)
  // https://nebius.com/newsroom/nebius-group-announces-closing-of-private-offering-of-convertible-senior-notes-with-aggregate-gross-proceeds-of-approximately-4-3-billion (3/20)
  // https://beta.earningswhispers.com/go/x/NBIS (Q3 ~11/11, unconfirmed)
  NBIS: [{ text: 'Average target inflated by stale targets' }, { text: 'converts ~$4.3B (3/2026) + ~$5.75B (8/2026)' }, { text: 'earnings ~11/11 (est.)', until: '2026-11-11' }],
  // https://www.sec.gov/Archives/edgar/data/0001477333/000095010326012340/dp251721_ex9902.htm (0% converts due 2031, $2.5B, conversion ~$496.94)
  // https://www.marketscreener.com/quote/stock/CLOUDFLARE-INC-65956823/calendar/ (Q3 11/4 or 11/11; RTTNews 10/23: unconfirmed)
  NET: [{ text: '$2.5B 0% converts due 2031 (8/2026), conversion ~$497' }, { text: 'earnings date unconfirmed (10/23–11/11)', until: '2026-11-11' }],
  // https://www.sec.gov/Archives/edgar/data/1045810/000104581026000021/nvda-20260125.htm (H200 China licence; 25% to the US government; guidance assumes no China DC revenue)
  // https://www.wallstreethorizon.com/nvidia-earnings-calendar (11/18 inferred)
  NVDA: [{ text: 'China: H200 sales only under licence, 25% to the US government' }, { text: 'earnings ~11/18 (est.)', until: '2026-11-18' }],
  // https://www.itiger.com/hans/news/2675626273 (Q3 results 11/3, announced 10/13; Q3 revenue guide $13–14M)
  NVTS: [{ text: 'earnings 11/3', until: '2026-11-03' }, { text: 'Q3 revenue guide $13–14M' }, { text: 'restructuring, history of capital raises' }],
  // https://www.computing.co.uk/news/2026/ai/oracle-under-pressure-after-ratings-downgrade-over-ai-expansion (S&P BBB−, 7/9/2026)
  // https://startupmap.iamsterdam.com/news/note/oracle-taps-25b-bond-as-debt-hits-130b-and-rating-slips-to-junk-s-edge (debt ~$130B, end of May)
  // https://s23.q4cdn.com/440135859/files/doc_financials/2026/q4/Q4-FY26-Oracle-Earnings-Slides.pdf (Investor Day 10/28, Las Vegas)
  ORCL: [{ text: 'S&P BBB− since 7/9 (one notch above junk)' }, { text: 'total debt ~$130B (5/2026)' }, { text: 'investor day 10/28', until: '2026-10-28' }],
  // https://www.sec.gov/Archives/edgar/data/0001321655/000132165526000039/a2026q2ex991pressrelease.htm (Q2: US government $809M of $1,935M = 42%)
  // https://www.benzinga.com/quote/PLTR/earnings (Q3 ~11/2, unconfirmed)
  PLTR: [{ text: 'US government 42% of Q2 revenue' }, { text: 'earnings ~11/2 (est.)', until: '2026-11-02' }],
  // https://www.sec.gov/Archives/edgar/data/0001819994/000181999426000061/rklb-08102026ex991.htm (cash $2.13B, 6/30)
  // https://pro.thestreet.com/trade-ideas/after-rocket-lab-fires-off-solid-earnings-im-pulling-the-trigger (long-term debt ~$14.8M)
  // https://beta.earningswhispers.com/go/x/RKLB (11/9) and https://www.earningswhispers.com/stocks/RKLB (11/12): unconfirmed
  RKLB: [
    { text: 'Net cash' },
    // Davies's words: "lowest target $67 still 21% above price", worked out from the row instead of written down.
    {
      text: (r) => {
        if (r.low == null || r.lowVsPrice == null) return null;
        const pct = Math.round(Math.abs(r.lowVsPrice));
        return r.lowVsPrice >= 0 ? `lowest target ${usd(r.low)} still ${pct}% above price` : `lowest target ${usd(r.low)} ${pct}% below price`;
      },
    },
    { text: 'earnings ~11/9–11/12 (est.)', until: '2026-11-12' },
  ],
  // Yahoo topHoldings for SAEM.L read 2026-10-21: TSMC 14.26 %, ten largest 35.6 %; Samsung and SK hynix 12.3 % together.
  SAEM: [{ text: 'MSCI EM IMI ESG Screened; TSMC 14.3%, top ten 35.6%' }, { text: 'Taiwan, Korea and China risk; EM currencies against the dollar' }],
  // https://www.thenextweb.com/news/softbank-openai-margin-loan-cut-to-6bn and https://letsdatascience.com/news/softbank-secures-40-billion-bridge-loan-for-openai-investmen-9cf0c58f
  // (S&P outlook negative 3/2026 on OpenAI concentration; $40B unsecured bridge due ~3/2027)
  SFTBY: [{ text: 'S&P outlook negative (3/2026) on OpenAI concentration' }, { text: '$40B bridge loan due ~3/2027' }, { text: 'OpenAI-backed margin loan' }],
  // https://fool.com/investing/2026/09/15/spacexs-next-share-unlock-is-coming-history-says-t (328.4M on 10/24; ~1.3B after the Q3 report; ~800M on 12/8)
  // https://teslanorth.com/2026/10/16/spacex-q3-2026-results-webcast/ (Q3 results 10/20)
  // The ~1.3B note runs to 2026-11-22 for now: Davies is asked for its end (coordinator, 2026-10-21).
  SPCX: [
    { text: 'Lock-up: up to 328.4M shares 10/24', until: '2026-10-24' },
    { text: '~1.3B more unlock after the Q3 report (10/20)', until: '2026-11-22' },
    { text: '~800M more 12/8', until: '2026-12-08' },
  ],
  // https://www.sec.gov/Archives/edgar/data/0001318605/000162828026064366/exhibit991111111.htm (Q3 results 10/21)
  // https://www.hl.co.uk/shares/share-research/tesla-announcement-musks-pay-package-approved (pay tied to robotaxi and Optimus milestones)
  TSLA: [{ text: 'earnings 10/21', until: '2026-10-21' }, { text: 'Valuation rests on robotaxi and Optimus; Musk pay tied to their milestones' }],
  // https://www.sec.gov/Archives/edgar/data/0001046179/000104617926000726/a3q26e_withguidancexfinal.htm (Q3 reported 10/15; Q4 guide $52.3–54.3B)
  TSM: [{ text: 'Taiwan concentration and cross-strait risk' }, { text: 'US chip tariffs unsettled' }, { text: 'Q4 guide $52.3–54.3B (10/15)' }],
  // https://www.gurufocus.com/stock/VST/summary (Q3 call 11/6, unconfirmed)
  // https://www.sec.gov/Archives/edgar/data/0001692819/000169281926000017/vistra-20260630xearningsre.htm (Lotus plants in Q2)
  VST: [{ text: 'Power-price and PJM capacity-market exposure' }, { text: '2.6 GW Lotus gas plants added (2026)' }, { text: 'earnings ~11/6 (est.)', until: '2026-11-06' }],
  // Yahoo topHoldings for VUAA.L read 2026-10-21: NVDA 8.39 %, ten largest 39.1 %.
  VUAA: [{ text: 'S&P 500 in USD; ten largest 39.1% (NVDA 8.4%)' }, { text: 'AI-capex concentration in the top names' }],
  // https://www.lixinger.com/equity/fund/detail/jj/017731/17731/strategy-and-operation and the 2024 suspension notice
  // https://notice.10jqka.com.cn/api/pdf/d6ca2e689939a9c.pdf (dealing paused on US market holidays)
  '017731': [{ text: 'QDII fund: priced in CNY a day late; dealing paused on US holidays' }, { text: 'no analyst coverage' }],
  // https://www.boerse-express.com/news/articles/sivers-semiconductors-aktie-ningi-bericht-erschuettert-vertrauen-919221 (Ningi Research, 6/1/2026)
  // https://www.boerse-express.com/news/articles/sivers-semiconductors-aktie-going-concern-warnung-und-17-short-quote-922870 (going-concern doubt)
  // https://borsvarlden.com/artiklar/sivers-semiconductors-q2-review-a-deliberate-trade-off-ahead-of-the-2027-ramp-redeye (Redeye, commissioned)
  SIVE: [{ text: 'Only Redeye (paid) covers it' }, { text: 'Ningi Research short report (6/1)' }, { text: 'auditor going-concern doubt; SEK 825M raise (8/27)' }],
};

/**
 * Today's date in New York, YYYY-MM-DD.
 * @param {number} nowMs
 */
export function nyDate(nowMs) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(nowMs);
}

/**
 * The notes for one holding as shown on `nowMs`, joined with "; ", or "" when it has none.
 * @param {string} display @param {RiskRow} row @param {number} nowMs @param {Record<string, RiskNote[]>} [map]
 */
export function risksFor(display, row, nowMs, map = TARGET_RISKS) {
  const today = nyDate(nowMs);
  const parts = [];
  for (const n of map[display] || []) {
    if (n.until && today > n.until) continue;
    const t = typeof n.text === 'function' ? n.text(row) : n.text;
    if (t) parts.push(t);
  }
  return parts.join('; ');
}
