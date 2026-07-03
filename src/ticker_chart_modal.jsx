// Single-ticker price-history modal. X axis = time, Y axis = price.
// Hover crosshair shows the price/time/% at the cursor's nearest data
// point with dashed lines down to both axes. Same range buttons as the
// portfolio chart (1D / 1W / 1M / 3M / YTD). Used when the user taps a
// player in non-edit mode — edit mode keeps opening the EditTickerModal.
import React from 'react';
import { Modal } from './modals.jsx';
import { usMarketHoursUtc, isWeekendDeadZone, isUsMarketHoliday } from './market_hours.js';
import { fxToUSD } from './fx.js';
import { fmtPrice as fmtPr, fmtPct as fmP, fmtMoney as fmtMo, fmtSharesFor as fmtShFor, pctColor as pcC, maskDigits } from './formatters.js';
import { RANGES, RANGE_KEYS, windowSinceLastUsClose, windowBetweenLastTwoUsCloses, filterToLast24h } from './ytd.js';
import { isCnFund as isCnFundT, isPvt as isPvtT, isDailyOnly as isDailyOnlyT, hasOvernightSession, isRegularSessionOnly, isCrypto } from './ticker_class.js';
import {
  maBarsFor, maLabelDaysFor, computeMaSeries,
  vwapSessionResetFor, vwapSessionKeyOf, computeVwap,
  extPriceIsRealAh, isPriceAxis,
} from './indicators.js';
import { pointerToDataIndex, overnightTrailingGap, parseChartDateUTC, findRegularCloseIdx, findRegularOpenIdx, findPrevSessionCloseIdx, overnightDotWithinReach } from './chart_geometry.js';
import { computeChartGeometry } from './chart_modal_geometry.js';
import { mergeOvernightSeries } from './overnight_intraday.js';
import {
  SYMBOL_BY_CUR, NIGHT_BAR_INTERVAL_MS, TICKER_DISPLAY_NAMES, INDEX_PE_ALLOWED,
  fmtTickerPrice,
} from './ticker_chart_helpers.js';
import { useTickerFundamentals } from './use_ticker_fundamentals.js';
import { useTickerChartData } from './use_ticker_chart_data.js';
import { ScreenshotActions } from './screenshot_actions.jsx';
import { COMPANY_NAMES } from './holdings_list.jsx';

// Ticker classification predicates moved to `src/ticker_class.js` so
// the modal, prefetch, header_sidebar, etc. all share one definition
// of "CN fund" / ".PVT" / "daily-only". CN funds publish one NAV per
// trading day so 1D / 1W (5 m / 30 m intraday) ranges have no
// meaningful data; .PVT placeholders aren't on Yahoo at all. Both
// restrict the modal to daily buttons.

export function TickerChartModal({ ticker, holding, marketData, extendedHours, phase, onClose, portfolioTotalValue, hideValues }) {
  const isCnFund = isCnFundT(ticker);
  const isPvt    = isPvtT(ticker);
  const dailyOnly = isDailyOnlyT(ticker);
  // 'PE' is a synthetic range button — same YTD daily prices but the
  // y-axis becomes a P/E ratio (price ÷ current TTM EPS). Two-stage
  // filter:
  //   1. Cheap pattern check rules out tickers that obviously can't
  //      have a meaningful EPS (CN funds, .PVT, futures, indices,
  //      crypto, forex). Keeps the button-render initial state stable.
  //   2. Async fundamentals fetch on modal open. ETFs / loss-makers /
  //      anything Yahoo doesn't have a positive trailingEps for set
  //      `peSupported` to false and the button stays hidden.
  // ^GSPC / ^NDX / ^RUT are supported via the Edge Function's index→ETF
  // proxy (Finnhub doesn't carry indices, but SPY/QQQ/IWM publish a
  // trailing P/E that's a reasonable stand-in for the underlying basket).
  // Other ^-prefixed tickers (VIX, SOX, TNX) and futures / forex are
  // ruled out at the pattern stage.
  const supportsPePattern = !dailyOnly
    && (!/^\^/.test(ticker) || INDEX_PE_ALLOWED.has(ticker))
    && !/=F$/.test(ticker)
    && !/=X$/.test(ticker)
    && !/[-]USD$/i.test(ticker);
  const { peSupported, psSupported, pe3yAvg, ps3yAvg, peg, sharesOut } =
    useTickerFundamentals(ticker, supportsPePattern);
  // P/E and P/S are mutually exclusive — append whichever applies.
  const valuationRange = peSupported ? ['PE'] : (psSupported ? ['PS'] : []);
  // '1Y' (trailing 12 months) sits right after YTD — a modal-only price
  // range (see RANGES in ytd.js; it's intentionally not in RANGE_KEYS).
  const visibleRangeKeys = dailyOnly
    ? ['1M', '3M', 'YTD', '1Y']
    : [...RANGE_KEYS, '1Y', ...valuationRange];
  // CN funds publish 1 NAV / day; .PVT placeholders don't trade on
  // public exchanges. Both default to 1M so the user sees something
  // immediately rather than landing on an intraday view that's empty.
  const [rangeKey, setRangeKey] = React.useState(dailyOnly ? '1M' : '1D');
  // Convenience flag for renderers that share behaviour across the
  // two ratio views (axis label, 3Y AVG reference line, header copy).
  const isRatioRange = rangeKey === 'PE' || rangeKey === 'PS';

  const useExt = !!(extendedHours && phase && phase !== 'regular');

  // Price-series data — the five fetch effects (range fetch / MA history
  // / other-range prefetch / 1D polling / overnight points) and their
  // state live in `useTickerChartData`; the modal keeps the geometry +
  // render below and consumes the results.
  const { series, loading, error, noPe, maHistory, overnightPts } = useTickerChartData({
    ticker, rangeKey, useExt, phase, dailyOnly, isRatioRange, extendedHours, visibleRangeKeys,
  });

  // US market hours in UTC for today. Dynamic so EST winter sessions
  // (close 21:00 UTC) still find their bars — hard-coding 20:00 would
  // silently miss the close marker Nov–Mar.
  const mh = usMarketHoursUtc(new Date());

  // Crypto 1D window: BTC trades 24/7, but the user wants it to read like a
  // US stock. Three cases, all sliced from the ~60 h the hook keeps for
  // crypto 1D so the toggle/phase changes the window with no refetch:
  //   - ext ON               → rolling 24 h (filterToLast24h)
  //   - ext OFF, market OPEN  → since the last 16:00-ET close to now
  //                             (windowSinceLastUsClose)
  //   - ext OFF, market CLOSED (pre / after / overnight) → the last
  //     COMPLETE close-to-close day (windowBetweenLastTwoUsCloses): from the
  //     previous US close through the most recent one, ENDING at that close
  //     — like a US stock's 1D after hours, it stops at the close and hides
  //     the current overnight move, rather than trailing to "now".
  const windowedSeries = (isCrypto(ticker) && rangeKey === '1D' && Array.isArray(series))
    ? (extendedHours
        ? filterToLast24h(series)
        : (phase === 'regular'
            ? windowSinceLastUsClose(series, mh)
            : windowBetweenLastTwoUsCloses(series, mh)))
    : series;

  // Yahoo series with the recorded overnight points spliced in (when
  // eligible — see mergeOvernightSeries). Gated on the ext toggle, not
  // the live overnight phase, so last night's curve stays drawn through
  // the next trading day. Returns the same `series` ref when there's no
  // overnight line to draw, so `hasOvernightLine` below is a cheap
  // reference check and the single-dot fallback path stays byte-identical.
  const displaySeries = React.useMemo(
    () => mergeOvernightSeries(windowedSeries, overnightPts, {
      rangeKey, extendedHours, ticker,
      // Match the recorded-point density to the chart's bar cadence
      // so 1W / 1M don't get visually swallowed by today's ~130
      // 5-min overnight pts. NIGHT_BAR_INTERVAL_MS picks 5/30/60 min
      // for 1D/1W/1M respectively; merge uses it to step-sample.
      barIntervalMs: NIGHT_BAR_INTERVAL_MS[rangeKey],
    }),
    [windowedSeries, overnightPts, rangeKey, extendedHours, ticker],
  );
  const hasOvernightLine = displaySeries !== series;

  // In ext-on AH/PM mode the chart's right-edge price needs to be the
  // current after-hours quote so the % return matches the scoreboard's
  // DAY CHANGE (which in the same mode is computed against today's
  // regular close). Outside ext-AH we use lastPrice (today's regular
  // session price during the day, or yesterday's close after hours).
  //
  // marketData only carries the MC index/futures/forex snapshots —
  // portfolio stocks come in via the `holding` prop, so we look in
  // BOTH places for extPrice / lastPrice. Without the holding
  // fallback an in-portfolio stock (e.g. GOOG) in ext mode would
  // show holding.lastPrice as the modal's "Last" while the home
  // card showed holding.extPrice; user reported this for GOOG.
  //
  // OTC ADR caveat: Yahoo populates a `postMarketPrice` for tickers
  // that don't actually trade after-hours (e.g. SFTBY = SoftBank
  // Pink Sheets, no real AH session). The reported value is often
  // a stale or computed number (today's open price for SFTBY), and
  // blindly substituting it for the chart's right edge produces a
  // fake spike + a misleading "+8 %" headline. Detect "no extended-
  // hours activity" by checking whether the fetched intraday series
  // has any bar outside the regular session window (pre-market or
  // AH bars). If not, the ticker has no real AH and we ignore
  // `extPrice`, falling back to `lastPrice` (= last real trade).
  const md = marketData?.[ticker];
  const extPriceLive  = md?.extPrice  ?? holding?.extPrice  ?? null;
  const lastPriceLive = md?.lastPrice ?? holding?.lastPrice ?? null;
  const openMinsUtc   = mh.openHh  * 60 + mh.openMm;
  const closeMinsUtc  = mh.closeHh * 60 + mh.closeMm;
  // hasExtendedBars — "is `extPrice` a real AH quote for this
  // ticker?". Prefer the verdict the home page already computed for
  // this holding (`holding.extPriceTrusted`, from its ext-hours
  // validation fetch) so the modal and the position card never
  // disagree — that's the CBRS card-vs-modal bug. Fall back to
  // validating the modal's own intraday series (extPriceIsRealAh:
  // real pre/post bars AND extPrice tracking them) for tickers with
  // no holding — MC index cards opened from Market Conditions — or
  // before the home page's verdict has landed. Drives both the
  // chart's right-edge substitution and the anchor logic, so
  // SFTBY's bogus +8 % headline disappears.
  const hasExtendedBars = (typeof holding?.extPriceTrusted === 'boolean')
    ? holding.extPriceTrusted
    : extPriceIsRealAh(series || [], extPriceLive, openMinsUtc, closeMinsUtc);
  const liveLast = (
    (useExt && hasExtendedBars && typeof extPriceLive === 'number' && extPriceLive > 0)
      ? extPriceLive
      : lastPriceLive
  ) || null;

  // Most-recent regular-close bar inside the series. Walk backwards
  // from the end and pick the first bar whose UTC time-of-day matches
  // close time:
  //   - In ext mode (market is currently closed) the most recent close
  //     bar is TODAY's close — anchor / line render as "today's session
  //     just ended, ext-hours moves are vs. that".
  //   - In regular mode (market is currently open) the most recent
  //     close bar is YESTERDAY's close (today's close hasn't happened
  //     yet) — used purely as a visual marker; the % anchor still
  //     comes from md.prevClose so it matches the scoreboard exactly.
  // Tickers with no US-style extended-hours session — foreign listings
  // (.L / .HK / euro) and OTC ADRs (SFTBY / MRAAY), per isRegularSessionOnly.
  // For these the 1D chart is a single regular session per day: the
  // US-close-time CLOSE marker never matches their bars and "today's open"
  // is just where the one session resumes after the overnight gap. So we
  // mark ONLY the previous session's close — at that market's own close
  // time, found by the date boundary — and draw no OPEN line. (Previously
  // they got no CLOSE line at all plus an OPEN line mis-placed on a
  // mid-afternoon foreign bar by the US-hours rule.)
  const regularSessionOnly = isRegularSessionOnly(ticker);

  let regularCloseIdx = -1;
  let regularOpenIdx = -1;
  // Compute the markers against `displaySeries` (the spliced series), NOT
  // the raw Yahoo `series`: the markers are rendered with xOfIdx (which is
  // index-based on the spliced `points`) and fed to computeChartGeometry
  // (whose series is displaySeries), so the indices must be into the same
  // array. When the recorded overnight points are spliced in before
  // today's bars (ext on, outside the live overnight session) they shift
  // today's open/close right; keying off `series` would draw the markers
  // on an overnight sample. The recorded points sit at UTC 00:00-08:00
  // (20:00-04:00 ET), never the RTH open/close UTC hours, so they don't
  // false-match the scans below.
  if (rangeKey === '1D' && displaySeries && displaySeries.length > 0) {
    if (regularSessionOnly) {
      regularCloseIdx = findPrevSessionCloseIdx(displaySeries);
    } else {
      // US equity with extended hours. The bar at exactly closeHh:closeMm
      // UTC (= 20:00 EDT / 21:00 EST). Strict match only (see
      // findRegularCloseIdx) — a looser hh<closeHh would match an overnight
      // / premarket bar after midnight UTC and pin the anchor to the latest
      // premarket tick instead of yesterday's 16:00 ET close, leaving the
      // modal at ~0% on any pre-open chart. -1 (no match) falls through to
      // the lastPrice anchor below.
      if (useExt || phase === 'regular') {
        regularCloseIdx = findRegularCloseIdx(displaySeries, mh);
      }
      // First-regular-open bar in the data — used to draw the OPEN dashed
      // line during the in-session view. Visual context only; the % basis
      // pivots at prevClose so it agrees with the scoreboard / heatmap. We
      // scope the search to TODAY's calendar date because the 24-h window
      // includes yesterday's afternoon bars whose UTC hours also satisfy
      // hh >= openHh — without the day filter, regularOpenIdx would land on
      // yesterday's first afternoon bar (= chart's left edge) instead of
      // today's actual open.
      if (phase === 'regular') {
        regularOpenIdx = findRegularOpenIdx(displaySeries, mh);
      }
    }
  }

  // Anchor for % calculation. 1D anchors at "the most recent 16:00 ET
  // regular close that has occurred":
  //   - regular hours → prevClose
  //   - ext-on AH/PM, ticker that actually trades in pre / AH (has
  //     bars outside the regular session window in `series`) →
  //     today's 16:00 ET bar, with lastPrice as a fallback (Yahoo
  //     pins lastPrice to the 16:00 ET print once the market
  //     closes), and prevClose as the final fallback.
  //   - ext-on AH/PM, ticker that doesn't have extended-hours bars
  //     in the fetched series (^VIX / ^TNX / OTC ADRs like SFTBY) →
  //     prevClose. Yahoo populates a bogus `postMarketPrice` for
  //     these (often today's open or stale value), so anchoring at
  //     today's close would print "0.00%" or wildly fake numbers;
  //     anchoring at yesterday's close gives the standard
  //     "since prev close" % which IS the meaningful headline.
  // marketData only carries the MC indices/futures/forex; portfolio
  // stocks are passed in via `holding`, so we look in BOTH places
  // for the ticker's price metadata.
  // The actual selection lives in `computeChartGeometry` below — it
  // needs anchor + hasData + scale derived together so the pure
  // function can be unit-pinned and PR-#157-style 8-place fixes
  // collapse to one.
  const lastPriceAny = md?.lastPrice ?? holding?.lastPrice ?? null;
  const prevCloseAny = md?.prevClose ?? holding?.prevClose ?? null;

  // Display series: substitute live price into the last point so the
  // chart tail tracks the rest of the app in real time. `isPriceAxis`
  // gates this on the y-axis units — true for the price ranges
  // (1D/1W/1M/3M/YTD), false for the ratio ranges (PE/PS). Mixing a
  // raw price into a ratio series would draw a vertical cliff
  // between the second-to-last bar and today, which the user hit on
  // NET / SATS / NVTS / SOUN before this gate was extended to PS.
  // Overnight live dot ("night market" heartbeat). During the overnight
  // session (20:00–04:00 ET) with the Extended Hours toggle on, the T212
  // price (carried on holding.extPrice → extPriceLive) is the only live
  // quote for a US equity — Yahoo has no overnight bars. We show it as a
  // single UNCONNECTED pulsing dot at its true-time position rather than
  // jamming it into the 20:00 bar: when active we (a) skip the usual
  // live-substitution so the historical bars stay real, (b) reserve an
  // x-axis gap proportional to the elapsed overnight time, and (c) draw
  // the dot at the far-right edge. Only 1D/1W/1M for US equities that
  // actually trade overnight — OTC ADRs like SFTBY (no night session)
  // are excluded via hasOvernightSession so they don't show a stale
  // close as a fake heartbeat.
  // The single heartbeat dot is the FALLBACK for when the overnight
  // recorder has 0-1 points (cron just started / a gap): show one
  // pulsing dot at the live price. Once the recorder has >= 2 points
  // for the current session, `displaySeries` already carries them as
  // a connected line (hasOvernightLine), so we suppress the dot —
  // the line's last bar, with the live substitution below, IS the
  // current overnight price.
  // ...and NOT during the weekend dead zone (Fri 20:00 → Sun 20:00 ET).
  // `usMarketPhase` still reports "overnight" then, but the 24/5 market is
  // closed, so the broker quote is a frozen Friday-close price that never
  // moves — a static dot that's just noise. Suppress it; the recorder
  // resumes at Sun 20:00 ET (the overnight reopen) and the line picks up
  // from there.
  // ...and NOT when the last real bar is more than one overnight session
  // back (overnightDotWithinReach). At the Sun-20:00-ET reopen the recorder
  // has 0-1 points, so the dot — not the line — would render, floating
  // ~48 h to the right of Friday's close as a giant blank gap. Hold off
  // until the recorder's ≥2 points draw the gap-free index-based line a few
  // minutes in (the bug the user hit at 01:00-01:05 UK).
  const lastBarMsForDot = (Array.isArray(displaySeries) && displaySeries.length > 0)
    ? parseChartDateUTC(displaySeries[displaySeries.length - 1]?.date).getTime()
    : NaN;
  const nightDotActive = useExt && phase === 'overnight' && hasOvernightSession(ticker)
    && !isWeekendDeadZone()
    && !isUsMarketHoliday()   // holiday = market closed all day; the frozen T212 close isn't a live overnight quote
    && typeof extPriceLive === 'number' && extPriceLive > 0
    && !!NIGHT_BAR_INTERVAL_MS[rangeKey]
    && !hasOvernightLine
    && Array.isArray(displaySeries) && displaySeries.length >= 2
    && overnightDotWithinReach(lastBarMsForDot, Date.now());

  // Points drive the line + geometry. Built from `displaySeries` (the
  // Yahoo bars + any spliced overnight line). The live substitution on
  // the LAST point keeps the right edge tracking the current price —
  // for the overnight line that means the most recent recorded point
  // shows the live T212 quote, satisfying "the rightmost realtime
  // point can still update anytime".
  const points = displaySeries ? displaySeries.map((p, i) => (
    isPriceAxis(rangeKey) && i === displaySeries.length - 1 && liveLast && !nightDotActive ? { ...p, close: liveLast } : p
  )) : [];

  const lastClose = points.length > 0 ? points[points.length - 1].close : null;
  // Header price/pct: the T212 now-price during the overnight-dot case
  // (so the header agrees with the position card + the dot), otherwise
  // the chart's last close (which already carries the live substitution
  // for regular / pre / after-hours).
  const headerPrice = nightDotActive ? extPriceLive : lastClose;
  // pctNow is computed AFTER computeChartGeometry runs below — anchor
  // selection moved there with the rest of the chart-axis math.

  // Trailing dot geometry: gap (in bar-interval units) from the last
  // real bar to now, so the dot floats at its true-time x-position.
  const overnightDot = nightDotActive ? (() => {
    const lastDate = points[points.length - 1].date;
    const isUtcIso = typeof lastDate === 'string' && lastDate.length === 16 && lastDate[10] === 'T';
    const lastBarMs = new Date(lastDate + (isUtcIso ? 'Z' : '')).getTime();
    const nowMs = Date.now();
    const gap = overnightTrailingGap(lastBarMs, nowMs, NIGHT_BAR_INTERVAL_MS[rangeKey]);
    // `dateStr` = "now" in the same UTC `YYYY-MM-DDTHH:MM` shape the bar
    // dates use, so the crosshair label + the rightmost x-axis tick can
    // format it through fmtDate / fmtAxisDate and update each refresh.
    const dateStr = new Date(nowMs).toISOString().slice(0, 16);
    return gap > 0 ? { price: extPriceLive, gap, dateStr } : null;
  })() : null;
  const cur = holding?.currency || 'USD';
  const sym = SYMBOL_BY_CUR[cur] || '$';

  // Chart geometry
  const W = 600, H = 280;
  // Right padding is wider in PE mode so the "3Y AVG 25.20" label
  // can sit OUTSIDE the chart's plot area (between the right edge of
  // the dashed line and the SVG's right side) instead of floating
  // inside the chart and getting crossed by the price line. Same
  // treatment for the MA overlay (1W/1M/3M/YTD) — the "MA 50" label
  // sits in the right margin at the level of the latest MA value.
  const showMa = ['1W', '1M', '3M', 'YTD', '1Y'].includes(rangeKey);
  // 1D has no MA line but may have a VWAP overlay — same right-margin
  // label treatment, so it needs the same widened padR.
  const showVwap = rangeKey === '1D';
  const padL = 56, padT = 18, padB = 38;
  const padR = isRatioRange ? 96 : (showMa || showVwap ? 56 : 16);
  const cW = W - padL - padR, cH = H - padT - padB;

  // Intraday rolling SMA — what TradingView calls "5/10/20/50-day MA"
  // on an intraday chart. Strictly causal: at every bar i in the
  // wider series, MA = avg of bars (i - N + 1) … i (trailing N
  // including the current bar; no future data; no smoothing). N is
  // the number of *bars* equivalent to the requested day count at
  // the chart's interval, so on 30m the line updates every 30 min
  // and on 60m every 60 min — no flat day-long plateaus.
  // Moving-average overlay — pure math lives in `src/indicators.js`.
  // Combined-source SMA so the line spans the full chart even when
  // maHistory's 12 h cache lags the freshly fetched display data.
  // Bars-per-day scaling on intraday ranges (5d × 13 bars/day at 30m,
  // 10d × 7 at 60m) is encapsulated in `maBarsFor`; dailyOnly tickers
  // (CN funds / .PVT) take the plain day count via the same call.
  const MA_BARS = maBarsFor(rangeKey, dailyOnly);
  const MA_DAYS = maLabelDaysFor(rangeKey);
  const maSeries = MA_BARS > 0 ? computeMaSeries(points, maHistory, MA_BARS) : null;

  // Volume-weighted average price (1D only). Per-asset reset anchor —
  //   - US equity: 09:30 ET when ext off; 04:00 ET pre-market open
  //     when ext on so the VWAP spans pre / regular / AH as one ramp.
  //   - Crypto (`-USD`): 00:00 UTC anchored-VWAP convention for 24/7
  //     markets.
  //   - Other 24h-or-non-US markets: 00:00 UTC fallback.
  // Forward-fills sparse-volume bars (BTC-USD's hourly-only volume on
  // Yahoo) so the line stays smooth instead of stair-stepping.
  // Bars before any real session volume return null — strict
  // volume-weighted only, no TWAP fudge.
  const vwapResetCfg = vwapSessionResetFor(ticker, extendedHours, mh);
  /** @param {string} d */
  const sessionKeyOf = (d) => vwapSessionKeyOf(d, vwapResetCfg);
  const vwapSeries = (rangeKey === '1D' && points.length > 0)
    ? computeVwap(points, sessionKeyOf)
    : null;

  // Geometry — anchorClose / hasData / xOfIdx / yOf / yMin / yMax /
  // ticksY / ticksX / chartXDenom. Pure function in chart_modal_geometry.js,
  // pinned by chart_modal_geometry.test.js. Replaces a ~200-line inline
  // block (anchor + hasData gate + x/y scale + range containment +
  // tick generation) that PR #157 reworked from 8 places at once —
  // having it as a pure function means future fixes land here and
  // get unit-tested instead of touching React state.
  //
  // X positioning is INDEX-based, not time-based. Treating each bar
  // as one equally-spaced step removes the ugly weekend / overnight
  // gaps a real time scale would draw, and matches every brokerage
  // chart's convention. During the overnight-dot view chartXDenom is
  // extended by `overnightDot.gap` so the bars compress left and the
  // right edge holds the trailing dot; the crosshair (pointerToDataIndex)
  // is wired against the same chartXDenom so click-to-data-index uses
  // the same scale.
  const geometry = computeChartGeometry({
    series: displaySeries,
    points,
    rangeKey,
    useExt,
    isRatioRange,
    overnightDot,
    regularCloseIdx,
    dimensions: { padL, padR, padT, padB, cW, cH },
    anchorRefs: {
      lastPriceAny,
      prevCloseAny,
      pe3yAvg,
      ps3yAvg,
      maSeries,
      vwapSeries,
    },
  });
  const { anchorClose, hasData, xOfIdx, yOf, yMin, yMax, ticksY, ticksX, chartXDenom } = geometry;
  const pctNow = (anchorClose && headerPrice) ? ((headerPrice - anchorClose) / anchorClose) * 100 : 0;

  // X for the right-margin overlay labels (VWAP / MA). Normally the far
  // right margin, but in the overnight view the line ends at the last
  // bar (left of the time gap) — anchor the label right there instead,
  // so "VWAP" / "MA 5" sit next to the line end rather than floating at
  // the far edge with a big gap in between.
  const rightLabelX = (hasData && overnightDot)
    ? xOfIdx(points.length - 1) + 4
    : W - padR + 4;

  // Crosshair hover label — keeps minute precision on 1W/1M so the user
  // can read the exact bar's timestamp. Times are 24-hour everywhere (no
  // AM/PM). parseChartDateUTC (chart_geometry) appends the missing 'Z' to
  // the "YYYY-MM-DDTHH:MM" intraday strings so a London/BST user doesn't
  // see every bar an hour early (US open 13:30 UTC was rendering as 13:30
  // instead of 14:30 BST).
  function fmtDate(dateStr) {
    const d = parseChartDateUTC(dateStr);
    if (rangeKey === '1D') {
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
    }
    if (rangeKey === '1W' || rangeKey === '1M') {
      return d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' +
             d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
    }
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  }
  // X-axis tick labels — bare date on 1W/1M (5–6 samples across the row,
  // intraday timestamps would just clutter without adding info).
  function fmtAxisDate(dateStr) {
    const d = parseChartDateUTC(dateStr);
    if (rangeKey === '1D') {
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
    }
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  }

  // Hover crosshair is updated via direct DOM-ref manipulation — NOT React
  // state. Setting state on every mousemove caused the whole SVG (including
  // the path with up to 150 points) to reconcile, which was the root of
  // the lag the user kept hitting. Here we keep the index in a ref and
  // imperatively update the crosshair group's child attributes inside a
  // requestAnimationFrame, leaving everything else in the chart untouched.
  const svgRef = React.useRef(null);
  const crossRef = React.useRef(/** @type {SVGGElement | null} */ (null));
  const cVlineRef = React.useRef(/** @type {SVGLineElement | null} */ (null));
  const cHlineRef = React.useRef(/** @type {SVGLineElement | null} */ (null));
  const cDotRef = React.useRef(/** @type {SVGCircleElement | null} */ (null));
  const cXRectRef = React.useRef(/** @type {SVGRectElement | null} */ (null));
  const cXTextRef = React.useRef(/** @type {SVGTextElement | null} */ (null));
  const cYRectRef = React.useRef(/** @type {SVGRectElement | null} */ (null));
  const cYTextRef = React.useRef(/** @type {SVGTextElement | null} */ (null));
  const cPctRectRef = React.useRef(/** @type {SVGRectElement | null} */ (null));
  const cPctTextRef = React.useRef(/** @type {SVGTextElement | null} */ (null));
  const rafRef = React.useRef(0);
  const pendingIdxRef = React.useRef(/** @type {number|null} */ (null));

  // Crosshair x-axis label box width depends on the formatted text — 1W/1M
  // emit "Mon DD HH:MM" (~12 chars at fontSize 9.5) which doesn't fit the
  // 64 px box that's enough for "HH:MM" or "Mon DD". Sized per range so
  // the box snugly fits the longest possible label without leaving big
  // gaps on shorter ones.
  const xRectWidth = (rangeKey === '1W' || rangeKey === '1M') ? 96 : 64;

  function paintCrosshair() {
    rafRef.current = 0;
    const idx = pendingIdxRef.current;
    const g = crossRef.current;
    if (!g) return;
    // idx === points.length is the live trailing dot (overnight view).
    // It isn't in `points`, so synthesize a point from overnightDot and
    // pin it to the far-right x; everything else reads from `points`.
    const isLiveDot = !!overnightDot && idx === points.length;
    const p = isLiveDot
      ? { close: overnightDot.price, date: overnightDot.dateStr }
      : (idx != null ? points[idx] : null);
    if (idx == null || !p) {
      g.style.display = 'none';
      return;
    }
    g.style.display = '';
    const x = isLiveDot ? (padL + cW) : xOfIdx(idx);
    const y = yOf(p.close);
    const pct = anchorClose ? ((p.close - anchorClose) / anchorClose) * 100 : 0;

    if (cVlineRef.current) { cVlineRef.current.setAttribute('x1', String(x)); cVlineRef.current.setAttribute('x2', String(x)); }
    if (cHlineRef.current) { cHlineRef.current.setAttribute('y1', String(y)); cHlineRef.current.setAttribute('y2', String(y)); }
    if (cDotRef.current)   { cDotRef.current.setAttribute('cx', String(x)); cDotRef.current.setAttribute('cy', String(y));
                             cDotRef.current.setAttribute('fill', pct >= 0 ? 'var(--gain)' : 'var(--loss)'); }
    if (cXRectRef.current) cXRectRef.current.setAttribute('x', String(x - xRectWidth / 2));
    if (cXTextRef.current) { cXTextRef.current.setAttribute('x', String(x)); cXTextRef.current.textContent = fmtDate(p.date); }
    if (cYRectRef.current) cYRectRef.current.setAttribute('y', String(y - 9));
    if (cYTextRef.current) {
      cYTextRef.current.setAttribute('y', String(y));
      cYTextRef.current.textContent = isRatioRange ? p.close.toFixed(2) : fmtTickerPrice(p.close, ticker, sym);
    }
    if (cPctRectRef.current) {
      cPctRectRef.current.setAttribute('x', String(x + 6));
      cPctRectRef.current.setAttribute('y', String(y - 16));
      cPctRectRef.current.setAttribute('fill', pct >= 0 ? 'rgba(70,160,90,0.85)' : 'rgba(190,60,70,0.85)');
    }
    if (cPctTextRef.current) {
      cPctTextRef.current.setAttribute('x', String(x + 34));
      cPctTextRef.current.setAttribute('y', String(y - 5));
      cPctTextRef.current.textContent = fmP(pct);
    }
  }

  function handleMove(e) {
    if (!hasData) return;
    // pointerToDataIndex (chart_geometry.js) handles the mouse-vs-touch
    // coords + SVG letterbox correction (default
    // preserveAspectRatio="xMidYMid meet") + clamp-into-padding logic
    // that was previously duplicated almost verbatim between this chart
    // and PerfChart. The SVG also has `touch-action: none` set so finger
    // drags don't fight the page scroller for ownership.
    const idx = pointerToDataIndex(
      e, svgRef.current, { W, H, padL, padR, cW, xDenom: chartXDenom, hasLiveDot: !!overnightDot }, points.length,
    );
    if (idx == null) return;
    pendingIdxRef.current = idx;
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(paintCrosshair);
  }
  function handleLeave() {
    pendingIdxRef.current = null;
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = 0; }
    if (crossRef.current) crossRef.current.style.display = 'none';
  }
  React.useEffect(() => () => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
  }, []);
  // Re-hide the crosshair whenever the data swaps (e.g. range change).
  React.useEffect(() => {
    if (crossRef.current) crossRef.current.style.display = 'none';
  }, [series]);

  // Path is built once per render of the chart (when data / geometry
  // changes). It does NOT depend on hover, so the rAF crosshair paints
  // don't trigger a path recompute.
  const path = points.length > 0
    ? 'M' + points.map((p, i) => `${xOfIdx(i).toFixed(1)},${yOf(p.close).toFixed(1)}`).join('L')
    : '';
  const lineColor = pctNow >= 0 ? 'var(--gain)' : 'var(--loss)';

  // (MA series itself is computed earlier — before the y-range
  // calculation — so MA values can participate in yMin/yMax.)
  const maPath = maSeries
    ? (() => {
        const start = maSeries.findIndex(v => v != null);
        if (start < 0) return '';
        const segs = [];
        for (let i = start; i < maSeries.length; i++) {
          const v = maSeries[i];
          if (v == null) continue;
          segs.push(`${xOfIdx(i).toFixed(1)},${yOf(v).toFixed(1)}`);
        }
        return segs.length >= 2 ? 'M' + segs.join('L') : '';
      })()
    : '';
  const maLastValue = maSeries
    ? (() => {
        for (let i = maSeries.length - 1; i >= 0; i--) {
          if (maSeries[i] != null) return maSeries[i];
        }
        return null;
      })()
    : null;

  // VWAP path + last-value label. Unlike MA, VWAP resets at every
  // session boundary inside the displayed window (9:30 ET for US
  // equities, 00:00 UTC for crypto). Emit a fresh `M` at each new
  // session so the SVG doesn't draw a misleading straight segment
  // from the prior session's final VWAP down to the new session's
  // first.
  const vwapPath = vwapSeries
    ? (() => {
        let out = '';
        let openSegment = false;
        let prevSession = '';
        for (let i = 0; i < vwapSeries.length; i++) {
          const v = vwapSeries[i];
          if (v == null) { openSegment = false; continue; }
          const sk = sessionKeyOf(points[i].date);
          const cmd = (openSegment && sk === prevSession) ? 'L' : 'M';
          out += `${cmd}${xOfIdx(i).toFixed(1)},${yOf(v).toFixed(1)}`;
          openSegment = true;
          prevSession = sk;
        }
        return out;
      })()
    : '';
  const vwapLastValue = vwapSeries
    ? (() => {
        for (let i = vwapSeries.length - 1; i >= 0; i--) {
          if (vwapSeries[i] != null) return vwapSeries[i];
        }
        return null;
      })()
    : null;

  // Live market cap for the header line — live price × shares
  // outstanding (server-derived as Yahoo marketCap ÷ price, so it's
  // ADR-safe). null for non-stocks / before fundamentals load.
  const liveMarketCap = (liveLast && liveLast > 0 && sharesOut && sharesOut > 0)
    ? liveLast * sharesOut
    : null;

  return (
    <Modal onClose={onClose} size="lg">
      <header className="modal-head modal-head-roomy">
        <div>
          <h2 className="modal-title mono">
            {TICKER_DISPLAY_NAMES[ticker]
              ? <>{TICKER_DISPLAY_NAMES[ticker]} <span className="dim" style={{ fontSize: '0.7em' }}>{ticker}</span></>
              : ticker}
          </h2>
          {/* Company full name — same static map as the holdings
              list's secondary line (COMPANY_NAMES in holdings_list),
              so the modal and the table can't drift. Own row above
              Mkt Cap; absent for tickers not in the map (MC indices /
              futures / FX already show a friendly TICKER_DISPLAY_NAMES
              title instead). */}
          {COMPANY_NAMES[ticker] && (
            <div className="modal-meta">
              <span className="mono dim">{COMPANY_NAMES[ticker]}</span>
            </div>
          )}
          {/* Live market cap (live price × shares outstanding) — sits
              on its own row ABOVE the Last-price line so the eyebrow
              reads "Mkt Cap $X.YT \n Last $price …". Stocks only:
              sharesOut is null for non-stocks / when Yahoo has no
              market cap, so the whole row disappears then. */}
          {liveMarketCap != null && (
            <div className="modal-meta">
              <span className="mono dim">Mkt Cap</span>
              <span className="mono dim">{fmtMo(liveMarketCap)}</span>
            </div>
          )}
          <div className="modal-meta">
            <span className="mono dim">{
              rangeKey === 'PE' ? 'P/E' : rangeKey === 'PS' ? 'P/S' : 'Last'
            }</span>
            <span className="mono">{
              headerPrice != null
                ? (isRatioRange ? headerPrice.toFixed(2) : fmtTickerPrice(headerPrice, ticker, sym))
                : '—'
            }</span>
            <span className="mono" style={{ color: pcC(pctNow) }}>{fmP(pctNow)}</span>
            {/* In 1D the chart's % is anchored at the previous close (the
                vertical CLOSE line) so it matches the scoreboard / heatmap's
                DAY CHANGE. Make the basis explicit whether or not extended
                hours is on — the label reads the same either way so the
                ext-OFF case (most common during the trading day) doesn't
                look like it had a different reference point. */}
            {rangeKey === '1D' && (
              <span className="mono dim" style={{ fontSize: 10 }}>(since previous close)</span>
            )}
            {rangeKey === 'PE' && (
              <span className="mono dim" style={{ fontSize: 10 }}>(price ÷ TTM EPS)</span>
            )}
            {rangeKey === 'PS' && (
              <span className="mono dim" style={{ fontSize: 10 }}>(price ÷ TTM sales per share)</span>
            )}
          </div>
          {/* PEG on its own line below the P/E row — secondary
              valuation metric, only renders when Yahoo published
              BOTH a forward P/E and a usable forward EPS-growth rate
              (the blended 2y forward growth from computeForwardGrowth
              in the fundamentals Edge Function). Hidden on the PS
              view (PEG pairs with earnings, not sales) and on the
              price ranges. */}
          {rangeKey === 'PE' && peg != null && peg > 0 && (
            <div className="modal-meta">
              <span className="mono dim">PEG</span>
              <span className="mono">{peg.toFixed(2)}</span>
              <span className="mono dim" style={{ fontSize: 10 }}>(forward P/E ÷ 2y fwd EPS growth %)</span>
            </div>
          )}
          {/* Holding-stats line — shares / AC / Cost / Value / G/L,
              same set the position-drill PlayerCard shows. AC stays in
              native currency (matches the broker print the user typed
              in); Cost / Value / G/L convert to USD via the per-holding
              fx rate. Value gets a "(X.X% of portfolio)" parenthesis
              so the user can see this position's weight in the book at
              a glance, without bouncing back to the home page. */}
          {rangeKey !== 'PE' && holding && holding.shares != null && (() => {
            const hCur = holding.currency || 'USD';
            const hSym = SYMBOL_BY_CUR[hCur] || '$';
            const fx        = fxToUSD(hCur, marketData);
            // OTC ADR guard: Yahoo's bogus postMarketPrice for tickers
            // like SFTBY shows up as today's open and makes Value /
            // G/L lie. The chart's right edge already falls back to
            // lastPrice when `hasExtendedBars` is false, but that
            // signal only works on the 1D range (it inspects the
            // intraday series). For 1W/1M/3M/YTD the series is daily
            // bars with no intraday timestamps to inspect, so applying
            // the gate there would silently fall back to lastPrice
            // for legit AH movers (NVDA up 10 % on earnings, etc.)
            // when the user is on a non-1D view. Only apply the gate
            // when we have the data to validate it.
            const trustExtPrice = rangeKey !== '1D' || hasExtendedBars;
            const livePrice = (useExt && trustExtPrice && holding.extPrice != null && holding.extPrice > 0)
                                ? holding.extPrice
                                : holding.lastPrice;
            const valueUsd  = holding.shares * livePrice * fx;
            const costUsd   = holding.shares * holding.cost * fx;
            const glUsd     = valueUsd - costUsd;
            const glPct     = costUsd > 0 ? (glUsd / costUsd) * 100 : 0;
            const portShare = portfolioTotalValue > 0 ? (valueUsd / portfolioTotalValue) * 100 : null;
            // Mask raw shares + dollar amounts under the privacy toggle —
            // matches what PlayerCard does for the same fields. Percentages
            // (G/L %, portfolio share) stay visible since they don't reveal
            // portfolio size.
            const m = (s) => hideValues ? maskDigits(s) : s;
            return (
              <div className="modal-meta">
                <span className="mono dim">{m(fmtShFor(holding.shares, ticker))} shares</span>
                <span className="mono dim">·</span>
                <span className="mono dim">AC <span className="mono">{m(`${hSym}${fmtPr(holding.cost)}`)}</span></span>
                <span className="mono dim">·</span>
                <span className="mono dim">Cost <span className="mono">{m(fmtMo(costUsd))}</span></span>
                <span className="mono dim">·</span>
                <span className="mono dim">Value <span className="mono">{m(fmtMo(valueUsd))}</span>{portShare != null && (
                  <span className="mono dim" style={{ fontSize: 10 }}> ({portShare.toFixed(2)}%)</span>
                )}</span>
                <span className="mono dim">·</span>
                <span className="mono dim">G/L <span className="mono" style={{ color: pcC(glPct) }}>{m(fmtMo(glUsd, { signed: true }))} ({fmP(glPct)})</span></span>
              </div>
            );
          })()}
        </div>
        <div className="modal-head-actions screenshot-skip">
          <ScreenshotActions filenameBase={ticker} />
          <button className="btn-ghost icon" onClick={onClose} aria-label="Close">✕</button>
        </div>
      </header>

      <div className="modal-body">
        <div className="ticker-chart-wrap">
          {loading && <div className="sparkline-empty dim mono">Loading…</div>}
          {!loading && error && <div className="sparkline-empty dim mono">Couldn't load history</div>}
          {!loading && !error && noPe && <div className="sparkline-empty dim mono">P/E not available — N/A</div>}
          {!loading && !error && !noPe && !hasData && <div className="sparkline-empty dim mono">No data for this range</div>}
          {!loading && !error && !noPe && hasData && (
            <svg
              ref={svgRef}
              viewBox={`0 0 ${W} ${H}`}
              width="100%" height={H}
              // touchAction:none lets the chart claim horizontal finger
              // drags for crosshair updates instead of the browser
              // interpreting them as page-scroll / pinch-zoom gestures.
              // Mobile users can still scroll the modal by putting their
              // finger above or below the chart.
              style={{ display: 'block', touchAction: 'none' }}
              onMouseMove={handleMove}
              onMouseLeave={handleLeave}
              onTouchStart={handleMove}
              onTouchMove={handleMove}
            >
              {/* Y-axis grid + labels */}
              {ticksY.map((v, i) => (
                <g key={`y${i}`}>
                  <line x1={padL} y1={yOf(v).toFixed(1)} x2={W - padR} y2={yOf(v).toFixed(1)}
                        stroke="var(--line-2)" strokeWidth="0.5" strokeDasharray="2,3" />
                  <text x={padL - 6} y={yOf(v).toFixed(1)} textAnchor="end" dominantBaseline="middle"
                        fontSize="9.5" fill="rgba(244,239,227,0.55)" fontFamily="var(--font-mono)">
                    {isRatioRange ? v.toFixed(2) : fmtTickerPrice(v, ticker, sym)}
                  </text>
                </g>
              ))}
              {/* X-axis labels — index-based, so weekend / non-trading
                  gaps don't open up empty stretches under the chart. */}
              {ticksX.map((tk, i) => (
                <text key={`x${i}`} x={tk.x} y={H - padB + 14}
                      textAnchor={i === 0 ? 'start' : (i === ticksX.length - 1 ? 'end' : 'middle')}
                      fontSize="9.5" fill="rgba(244,239,227,0.55)" fontFamily="var(--font-mono)">
                  {fmtAxisDate(tk.date)}
                </text>
              ))}
              {/* P/E 1Y: 3-year-average reference line. Dashed gray
                  horizontal line spanning the plot area with the
                  value labeled in the right margin (outside the
                  plot) so the price line never crosses through it.
                  Comes from Finnhub's series.annual.pe (last 3
                  entries averaged). */}
              {(() => {
                // Same dashed reference line for both ratio views —
                // pick whichever 3Y average matches the active range
                // and render in the right margin.
                const avg = rangeKey === 'PE' ? pe3yAvg : rangeKey === 'PS' ? ps3yAvg : null;
                if (typeof avg !== 'number' || avg <= 0) return null;
                const y = yOf(avg);
                return (
                  <g>
                    <line x1={padL} y1={y.toFixed(1)} x2={W - padR} y2={y.toFixed(1)}
                          stroke="rgba(244,239,227,0.55)" strokeWidth="0.8" strokeDasharray="4,3" />
                    <text x={W - padR + 4} y={y.toFixed(1)} textAnchor="start" dominantBaseline="middle"
                          fontSize="9" fill="rgba(244,239,227,0.7)" fontFamily="var(--font-mono)">
                      3Y AVG {avg.toFixed(2)}
                    </text>
                  </g>
                );
              })()}
              {/* Vertical dashed CLOSE line. In ext mode this is today's
                  close; in regular mode it's yesterday's close (= the
                  prevClose the % anchors at). */}
              {regularCloseIdx >= 0 && (() => {
                const x = xOfIdx(regularCloseIdx).toFixed(1);
                return (
                  <g>
                    <line x1={x} y1={padT} x2={x} y2={H - padB}
                          stroke="var(--chalk-dim)" strokeWidth="0.8" strokeDasharray="3,4" opacity="0.6" />
                    <text x={x} y={padT - 4} textAnchor="middle"
                          fontSize="8.5" fill="var(--chalk-dim)" fontFamily="var(--font-mono)">
                      CLOSE
                    </text>
                  </g>
                );
              })()}
              {/* Vertical dashed line at today's regular open (1D in
                  regular session). Mirror of the CLOSE marker for the
                  ext-AH case — the chart now always fetches with
                  prepost when phase==='regular', so the OPEN bar is
                  somewhere in the middle of the data, not at index 0. */}
              {regularOpenIdx >= 0 && (() => {
                const x = xOfIdx(regularOpenIdx).toFixed(1);
                return (
                  <g>
                    <line x1={x} y1={padT} x2={x} y2={H - padB}
                          stroke="var(--chalk-dim)" strokeWidth="0.8" strokeDasharray="3,4" opacity="0.6" />
                    <text x={x} y={padT - 4} textAnchor="middle"
                          fontSize="8.5" fill="var(--chalk-dim)" fontFamily="var(--font-mono)">
                      OPEN
                    </text>
                  </g>
                );
              })()}
              {/* VWAP overlay (1D only, when bar volume is available).
                  Drawn before the price path so the active price line
                  stays on top. Same gray + label-in-right-margin
                  treatment as the MA overlays on other ranges. */}
              {vwapPath && (
                <path d={vwapPath} fill="none" stroke="#6b7280" strokeWidth="1.0"
                      strokeLinejoin="round" strokeLinecap="round" opacity="0.85" />
              )}
              {vwapLastValue != null && (
                <text x={rightLabelX} y={yOf(vwapLastValue).toFixed(1)}
                      textAnchor="start" dominantBaseline="middle"
                      fontSize="9" fill="rgba(244,239,227,0.7)" fontFamily="var(--font-mono)">
                  VWAP
                </text>
              )}
              {/* Moving-average overlay (1W → 5d, 1M → 10d, 3M → 20d,
                  YTD → 50d). Drawn before the price path so the active
                  price line stays on top. Same gray as the PerfChart
                  S&P comparison line. Label sits in the right margin
                  at the y of the latest MA value, mirroring the PE
                  chart's 3Y AVG label position. */}
              {maPath && (
                <path d={maPath} fill="none" stroke="#6b7280" strokeWidth="1.0"
                      strokeLinejoin="round" strokeLinecap="round" opacity="0.85" />
              )}
              {maLastValue != null && (
                <text x={rightLabelX} y={yOf(maLastValue).toFixed(1)}
                      textAnchor="start" dominantBaseline="middle"
                      fontSize="9" fill="rgba(244,239,227,0.7)" fontFamily="var(--font-mono)">
                  MA {MA_DAYS}
                </text>
              )}
              {/* Price path */}
              <path d={path} fill="none" stroke={lineColor} strokeWidth="1.6"
                    strokeLinejoin="round" strokeLinecap="round" />
              {/* End-of-line dot. Suppressed when the overnight heartbeat
                  dot is shown — that pulsing dot is the "current" marker
                  then, and a second static dot at the line's end reads as
                  a stray point. */}
              {points.length > 0 && !overnightDot && (() => {
                const last = points[points.length - 1];
                return <circle cx={xOfIdx(points.length - 1).toFixed(1)} cy={yOf(last.close).toFixed(1)}
                               r="3" fill={lineColor} stroke="#0c1310" strokeWidth="1.5" />;
              })()}
              {/* Overnight live dot — the T212 "night market" price as a
                  pulsing heartbeat at the far-right (true-time) position,
                  UNCONNECTED to the price line. Only rendered during the
                  overnight session with ext on (overnightDot != null). */}
              {overnightDot && (() => {
                const dx = (W - padR).toFixed(1);            // = xOfIdx(chartXDenom), far right
                const dy = yOf(overnightDot.price).toFixed(1);
                return (
                  <g>
                    <circle cx={dx} cy={dy} r="3.5" fill="none" stroke={lineColor} strokeWidth="1.2" opacity="0.7">
                      <animate attributeName="r" values="3.5;9;3.5" dur="1.6s" repeatCount="indefinite" />
                      <animate attributeName="opacity" values="0.7;0;0.7" dur="1.6s" repeatCount="indefinite" />
                    </circle>
                    <circle cx={dx} cy={dy} r="3" fill={lineColor} stroke="#0c1310" strokeWidth="1.2" />
                  </g>
                );
              })()}
              {/* Hover crosshair — rendered once with refs, hidden by
                  default. handleMove updates these elements directly via
                  setAttribute inside a rAF, so the rest of the SVG (path,
                  axes) doesn't reconcile every frame. */}
              <g ref={crossRef} style={{ display: 'none' }}>
                <line ref={cVlineRef} x1={padL} y1={padT} x2={padL} y2={H - padB}
                      stroke="rgba(244,239,227,0.5)" strokeWidth="0.7" strokeDasharray="3,3" />
                <line ref={cHlineRef} x1={padL} y1={padT} x2={W - padR} y2={padT}
                      stroke="rgba(244,239,227,0.5)" strokeWidth="0.7" strokeDasharray="3,3" />
                <rect ref={cXRectRef} x={padL} y={H - padB + 1} width={xRectWidth} height={18}
                      fill="#0c1310" stroke="var(--chalk-dim)" />
                <text ref={cXTextRef} x={padL} y={H - padB + 13} textAnchor="middle"
                      fontSize="9.5" fill="var(--chalk)" fontFamily="var(--font-mono)" />
                <rect ref={cYRectRef} x={padL - 56} y={padT} width={52} height={18}
                      fill="#0c1310" stroke="var(--chalk-dim)" />
                <text ref={cYTextRef} x={padL - 6} y={padT} textAnchor="end" dominantBaseline="middle"
                      fontSize="9.5" fill="var(--chalk)" fontFamily="var(--font-mono)" />
                <circle ref={cDotRef} cx={padL} cy={padT} r="3.5"
                        fill="var(--gain)" stroke="#0c1310" strokeWidth="1.5" />
                <rect ref={cPctRectRef} x={padL} y={padT} width={56} height={16} rx={2}
                      fill="rgba(70,160,90,0.85)" />
                <text ref={cPctTextRef} x={padL} y={padT} textAnchor="middle"
                      fontSize="10" fill="#fff" fontFamily="var(--font-mono)" fontWeight="600" />
              </g>
            </svg>
          )}
        </div>

        <div className="perf-range-row">
          {visibleRangeKeys.map(k => (
            <button
              key={k}
              type="button"
              className={`perf-range-btn mono${k === rangeKey ? ' on' : ''}`}
              onClick={() => setRangeKey(k)}
            >{k === 'PE' ? 'P/E 1Y' : k === 'PS' ? 'P/S 1Y' : RANGES[k].label}</button>
          ))}
        </div>
      </div>
    </Modal>
  );
}
