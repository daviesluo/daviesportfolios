// Single-ticker price-history modal. X axis = time, Y axis = price.
// Hover crosshair shows the price/time/% at the cursor's nearest data
// point with dashed lines down to both axes. Same range buttons as the
// portfolio chart (1D / 1W / 1M / 3M / YTD). Used when the user taps a
// player in non-edit mode — edit mode keeps opening the EditTickerModal.
import React from 'react';
import { Modal } from './modals.jsx';
import { fetchHistoricalBatch, Storage } from './utils.js';
import { RANGES, RANGE_KEYS, fetchParamsFor, filterToLatestDay } from './ytd.js';
import { fmtPrice as fmtPr, fmtPct as fmP, pctColor as pcC } from './utils.js';
import { reportError } from './ops_error.js';

const SYMBOL_BY_CUR = { USD: '$', GBP: '£', CNY: '¥', HKD: 'HK$' };

// Persistent fetch cache so re-opening the modal — even after a page
// reload — is instant. The previous in-memory Map reset on every load,
// so cold starts always paid the full Edge Function + proxy round-trip
// even when the user had viewed the same ticker minutes earlier.
// TTL is matched to each range's bar interval so we don't refetch faster
// than the source can publish a new bar:
//   1D   → 5  m bars  →  5 m TTL
//   1W   → 30 m bars  → 30 m TTL
//   1M   → 60 m bars  →  1 h TTL
//   3M   →  1 d bars  → 12 h TTL
//   YTD  →  1 d bars  → 12 h TTL
function modalTtl(rangeKey) {
  if (rangeKey === '1D') return  5 * 60 * 1000;
  if (rangeKey === '1W') return 30 * 60 * 1000;
  if (rangeKey === '1M') return 60 * 60 * 1000;
  return                       12 * 60 * 60 * 1000;
}
function modalCacheGet(key) {
  const all = Storage.loadTickerChart();
  return all?.entries?.[key] ?? null; // { ts, data } | null
}
function modalCacheSet(key, data) {
  const all = Storage.loadTickerChart() || { entries: {} };
  all.entries = { ...(all.entries || {}), [key]: { ts: Date.now(), data } };
  // Soft-cap at ~200 keys so the localStorage entry can't bloat unboundedly.
  const keys = Object.keys(all.entries);
  if (keys.length > 200) {
    const sorted = keys
      .map(k => ({ k, ts: all.entries[k]?.ts || 0 }))
      .sort((a, b) => b.ts - a.ts);
    /** @type {Record<string, {ts:number, data:any}>} */
    const trimmed = {};
    for (let i = 0; i < 200; i++) trimmed[sorted[i].k] = all.entries[sorted[i].k];
    all.entries = trimmed;
  }
  Storage.saveTickerChart(all);
}

// 6-digit numeric codes are CN mutual funds (天天基金). They only publish
// one NAV per trading day, so 1D / 1W (5 m / 30 m intraday) ranges have
// no meaningful data — restrict the visible range buttons to the daily
// ones for these tickers.
const CN_FUND_RE = /^\d{6}$/;

export function TickerChartModal({ ticker, holding, marketData, extendedHours, phase, onClose }) {
  const isCnFund = CN_FUND_RE.test(ticker);
  const visibleRangeKeys = isCnFund ? ['1M', '3M', 'YTD'] : RANGE_KEYS;
  const [rangeKey, setRangeKey] = React.useState('YTD');
  const [series, setSeries]     = React.useState(/** @type {Array<{date:string,close:number}>|null} */ (null));
  const [loading, setLoading]   = React.useState(true);
  const [error, setError]       = React.useState(false);

  const useExt = !!(extendedHours && phase && phase !== 'regular');

  // Pick (yahooRange, interval, includePrePost) based on the user's choice.
  // Single-ticker fetch params are now shared with the portfolio chart
  // via fetchParamsFor() in ytd.js — both charts now use intraday
  // intervals on 1W (30 m) and 1M (60 m) so the line has enough bars
  // to read at a glance, and 1D's three sub-modes (ext OFF + open,
  // ext OFF + closed, ext ON) live in one place rather than duplicated
  // here.
  const fetchParams = (rk) => fetchParamsFor(rk, extendedHours, phase);

  React.useEffect(() => {
    let cancelled = false;
    const { yahooRange, interval, includePrePost } = fetchParams(rangeKey);
    const cacheKey = `${ticker}|${rangeKey}|${useExt ? 'ext' : 'reg'}|${phase || ''}`;
    const ttl = modalTtl(rangeKey);
    const cached = modalCacheGet(cacheKey);

    // Stale-while-revalidate: if there's any cached data, paint it
    // immediately. Within TTL we trust it and stop. Stale entries get
    // shown but a background refetch updates them in place — no spinner.
    let needsFresh = !cached;
    if (cached && Array.isArray(cached.data) && cached.data.length >= 2) {
      setSeries(cached.data);
      setLoading(false);
      setError(false);
      const ageMs = Date.now() - (cached.ts || 0);
      if (ageMs >= ttl) needsFresh = true;
    } else {
      setLoading(true);
      setError(false);
    }
    if (!needsFresh) return;

    (async () => {
      // Yahoo's CORS-proxy chain plus the Edge Function path together
      // are flaky enough that one fetch can drop where a quick retry
      // succeeds. 3 attempts with short backoff catches the recoverable
      // cases without making the spinner feel endless when the symbol
      // really is unfetchable.
      let data = null;
      for (let attempt = 0; attempt < 3 && !data; attempt++) {
        if (attempt > 0) await new Promise(r => setTimeout(r, 250 * attempt));
        if (cancelled) return;
        const out = await fetchHistoricalBatch([ticker], yahooRange, interval, includePrePost);
        if (cancelled) return;
        if (out[ticker] && out[ticker].length >= 2) data = out[ticker];
      }
      if (!data) {
        reportError('fetch.histsingle', {
          symbol: ticker,
          message: 'all attempts returned no data',
          context: { range: yahooRange, interval, includePrePost, attempts: 3 },
        });
        // Only surface the error if we have nothing to show. If we're
        // revalidating a stale cache hit, keep the chart on screen.
        if (!cached) {
          setError(true);
          setLoading(false);
        }
        return;
      }
      const params = fetchParamsFor(rangeKey, extendedHours, phase);
      if (params.variant === 'closed') data = filterToLatestDay(data);
      modalCacheSet(cacheKey, data);
      setSeries(data);
      setLoading(false);
      setError(false);
    })();
    return () => { cancelled = true; };
  }, [ticker, rangeKey, useExt, phase]);

  // Background prefetch the other ranges once the user's chosen range has
  // landed. Range-button clicks then hit the in-memory cache for an
  // instant swap. Sequential, fire-and-forget — failures just leave the
  // cache untouched and the next click pays the normal fetch cost.
  React.useEffect(() => {
    if (loading || error || !series) return;
    const others = visibleRangeKeys.filter(k => k !== rangeKey);
    let cancelled = false;
    (async () => {
      for (const rk of others) {
        if (cancelled) return;
        const { yahooRange, interval, includePrePost, variant } = fetchParamsFor(rk, extendedHours, phase);
        const cacheKey = `${ticker}|${rk}|${useExt ? 'ext' : 'reg'}|${phase || ''}`;
        const ttl = modalTtl(rk);
        const c = modalCacheGet(cacheKey);
        if (c && Array.isArray(c.data) && (Date.now() - (c.ts || 0)) < ttl) continue;
        const out = await fetchHistoricalBatch([ticker], yahooRange, interval, includePrePost);
        if (cancelled) return;
        let data = out[ticker];
        if (data && data.length >= 2) {
          if (variant === 'closed') data = filterToLatestDay(data);
          modalCacheSet(cacheKey, data);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [ticker, rangeKey, useExt, phase, loading, error]);

  // In ext-on AH/PM mode the chart's right-edge price needs to be the
  // current after-hours quote so the % return matches the scoreboard's
  // DAY CHANGE (which in the same mode is computed against today's
  // regular close). Outside ext-AH we use lastPrice (today's regular
  // session price during the day, or yesterday's close after hours).
  const md = marketData?.[ticker];
  const liveLast = (
    (useExt && md?.extPrice != null && md.extPrice > 0) ? md.extPrice
    : (md?.lastPrice ?? holding?.lastPrice)
  ) || null;

  // Last-regular-close timestamp inside the series — used to draw the
  // vertical dashed line in 1D ext mode and to anchor % return when the
  // chart includes pre/post hours.
  let regularCloseIdx = -1;
  if (rangeKey === '1D' && useExt && series && series.length > 0) {
    // The last point whose UTC time-of-day matches 20:00 (16:00 ET) is the
    // most recent regular session close. Walk backwards from the end.
    // Series points are "YYYY-MM-DDTHH:MM" (UTC ISO).
    for (let i = series.length - 1; i >= 0; i--) {
      const hh = parseInt(series[i].date.slice(11, 13), 10);
      const mm = parseInt(series[i].date.slice(14, 16), 10);
      // 20:00 UTC = 16:00 EDT; allow a bit of slack for non-quarter-hour bars.
      if (hh === 20 && mm <= 5) { regularCloseIdx = i; break; }
    }
  }

  // Anchor for % calculation:
  //   1D regular  → marketData.prevClose
  //   1D ext on   → close at the regular-close idx if found, else
  //                 marketData.lastPrice (today's regular close), else first pt
  //   1D ext off + closed → first point of the last day (already filtered)
  //   others      → last close strictly before the first window point
  let anchorClose = null;
  if (series && series.length > 0) {
    if (rangeKey === '1D') {
      if (useExt && regularCloseIdx >= 0) {
        anchorClose = series[regularCloseIdx].close;
      } else if (useExt && md?.lastPrice && md.lastPrice > 0) {
        // No 20:00 UTC bar in the fetched window (e.g. weekend session
        // for futures) — fall back to today's regular close from the
        // live snapshot so the basis still matches scoreboard semantics.
        anchorClose = md.lastPrice;
      } else if (!extendedHours && phase === 'regular') {
        anchorClose = (md && md.prevClose && md.prevClose > 0) ? md.prevClose : series[0].close;
      } else {
        anchorClose = series[0].close;
      }
    } else {
      anchorClose = series[0].close;
    }
  }

  // Display series: substitute live price into the last point so the chart
  // tail tracks the rest of the app in real time.
  const points = series ? series.map((p, i) => (
    i === series.length - 1 && liveLast ? { date: p.date, close: liveLast } : p
  )) : [];

  const lastClose = points.length > 0 ? points[points.length - 1].close : null;
  const pctNow = (anchorClose && lastClose) ? ((lastClose - anchorClose) / anchorClose) * 100 : 0;
  const cur = holding?.currency || 'USD';
  const sym = SYMBOL_BY_CUR[cur] || '$';

  // Chart geometry
  const W = 600, H = 280;
  const padL = 56, padR = 16, padT = 18, padB = 38;
  const cW = W - padL - padR, cH = H - padT - padB;

  const hasData = points.length >= 2 && anchorClose;
  // X positioning is INDEX-based, not time-based. Treating each bar as one
  // equally-spaced step removes the ugly weekend / overnight gaps a real
  // time scale would draw, and matches the convention every brokerage
  // chart uses (Yahoo, Robinhood, T212 etc.) — they all collapse non-
  // trading time into a single step. xOfIdx(i) takes the data-array index.
  let xOfIdx = (_i) => padL, yOf = (_p) => padT + cH / 2;
  let yMin = 0, yMax = 0, ticksY = [], ticksX = [];
  if (hasData) {
    const denom = Math.max(1, points.length - 1);
    xOfIdx = (i) => padL + (i / denom) * cW;
    const allP = points.map(p => p.close);
    const rawMin = Math.min(...allP), rawMax = Math.max(...allP);
    const yPad = Math.max(0.001, (rawMax - rawMin) * 0.08);
    yMin = rawMin - yPad; yMax = rawMax + yPad;
    const yRange = yMax - yMin || 1;
    yOf = (p) => padT + ((yMax - p) / yRange) * cH;
    // Y ticks — pick a step that gives ~5 ticks
    const r = yMax - yMin;
    const niceStep = (r) => {
      const exp = Math.pow(10, Math.floor(Math.log10(r)));
      const norm = r / exp;
      if (norm < 1.5) return 0.2 * exp;
      if (norm < 3) return 0.5 * exp;
      if (norm < 7) return 1 * exp;
      return 2 * exp;
    };
    const step = niceStep(r);
    for (let v = Math.ceil(yMin / step) * step; v <= yMax; v += step) ticksY.push(v);
    // X ticks — pick equally-spaced INDICES (not times) so labels track
    // actual data points rather than calendar gaps. Each tick records
    // both the chart-x coord and the date string at that index.
    const ticksToShow = rangeKey === '1D' ? 5 : 4;
    for (let i = 0; i <= ticksToShow; i++) {
      const idx = Math.round((points.length - 1) * (i / ticksToShow));
      const safeIdx = Math.max(0, Math.min(points.length - 1, idx));
      ticksX.push({ x: xOfIdx(safeIdx), date: points[safeIdx].date });
    }
  }

  // Crosshair hover label — keeps minute precision on 1W/1M so the user
  // can read the exact bar's timestamp.
  function fmtDate(dateStr) {
    const d = new Date(dateStr);
    if (rangeKey === '1D') {
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    if (rangeKey === '1W' || rangeKey === '1M') {
      return d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' +
             d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  }
  // X-axis tick labels — bare date on 1W/1M (5–6 samples across the row,
  // intraday timestamps would just clutter without adding info).
  function fmtAxisDate(dateStr) {
    const d = new Date(dateStr);
    if (rangeKey === '1D') {
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
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
    if (idx == null || !points[idx]) {
      g.style.display = 'none';
      return;
    }
    g.style.display = '';
    const p = points[idx];
    const x = xOfIdx(idx);
    const y = yOf(p.close);
    const pct = anchorClose ? ((p.close - anchorClose) / anchorClose) * 100 : 0;

    if (cVlineRef.current) { cVlineRef.current.setAttribute('x1', String(x)); cVlineRef.current.setAttribute('x2', String(x)); }
    if (cHlineRef.current) { cHlineRef.current.setAttribute('y1', String(y)); cHlineRef.current.setAttribute('y2', String(y)); }
    if (cDotRef.current)   { cDotRef.current.setAttribute('cx', String(x)); cDotRef.current.setAttribute('cy', String(y));
                             cDotRef.current.setAttribute('fill', pct >= 0 ? 'var(--gain)' : 'var(--loss)'); }
    if (cXRectRef.current) cXRectRef.current.setAttribute('x', String(x - xRectWidth / 2));
    if (cXTextRef.current) { cXTextRef.current.setAttribute('x', String(x)); cXTextRef.current.textContent = fmtDate(p.date); }
    if (cYRectRef.current) cYRectRef.current.setAttribute('y', String(y - 9));
    if (cYTextRef.current) { cYTextRef.current.setAttribute('y', String(y)); cYTextRef.current.textContent = `${sym}${fmtPr(p.close)}`; }
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
    if (!hasData || !svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    // The SVG uses the default preserveAspectRatio="xMidYMid meet", which
    // letterboxes the viewBox content when the rendered element's aspect
    // ratio differs from W/H (e.g. wide desktop view). Compute the actual
    // content-area offset+size so the cursor → chart-x mapping is exact
    // right up to the edge of the visible chart, not the SVG element.
    const vbRatio = W / H;
    const elRatio = rect.width / rect.height;
    let contentW, contentH, offX, offY;
    if (elRatio > vbRatio) {
      contentH = rect.height; contentW = contentH * vbRatio;
      offX = (rect.width - contentW) / 2; offY = 0;
    } else {
      contentW = rect.width;  contentH = contentW / vbRatio;
      offX = 0; offY = (rect.height - contentH) / 2;
    }
    const sx = ((e.clientX - rect.left - offX) / contentW) * W;
    // Clamp the cursor's chart-space x to [padL, W-padR] so the crosshair
    // pins to the first / last data point when the mouse drifts into the
    // axis padding instead of "snapping off".
    const clampedSx = Math.max(padL, Math.min(W - padR, sx));
    const denom = Math.max(1, points.length - 1);
    const frac = (clampedSx - padL) / cW;
    const i = Math.round(frac * denom);
    pendingIdxRef.current = Math.max(0, Math.min(points.length - 1, i));
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

  return (
    <Modal onClose={onClose} size="lg">
      <header className="modal-head">
        <div>
          <div className="modal-eyebrow mono">PRICE</div>
          <h2 className="modal-title mono">{ticker}</h2>
          <div className="modal-meta">
            <span className="mono dim">Last</span>
            <span className="mono">{lastClose != null ? `${sym}${fmtPr(lastClose)}` : '—'}</span>
            <span className="mono" style={{ color: pcC(pctNow) }}>{fmP(pctNow)}</span>
            {/* In 1D ext-hours mode the chart's anchor is the LAST regular
                close (vertical dashed line), not yesterday's open or the
                first bar. Make the basis explicit so the user knows what
                the % is relative to. */}
            {rangeKey === '1D' && useExt && (
              <span className="mono dim" style={{ fontSize: 10 }}>(since previous close)</span>
            )}
            {holding?.shares != null && (
              <>
                <span className="mono dim">·</span>
                <span className="mono dim">{holding.shares} shares</span>
              </>
            )}
          </div>
        </div>
        <button className="btn-ghost icon" onClick={onClose} aria-label="Close">✕</button>
      </header>

      <div className="modal-body">
        <div className="ticker-chart-wrap">
          {loading && <div className="sparkline-empty dim mono">Loading…</div>}
          {!loading && error && <div className="sparkline-empty dim mono">Couldn't load history</div>}
          {!loading && !error && !hasData && <div className="sparkline-empty dim mono">No data for this range</div>}
          {!loading && !error && hasData && (
            <svg
              ref={svgRef}
              viewBox={`0 0 ${W} ${H}`}
              width="100%" height={H}
              style={{ display: 'block' }}
              onMouseMove={handleMove}
              onMouseLeave={handleLeave}
            >
              {/* Y-axis grid + labels */}
              {ticksY.map((v, i) => (
                <g key={`y${i}`}>
                  <line x1={padL} y1={yOf(v).toFixed(1)} x2={W - padR} y2={yOf(v).toFixed(1)}
                        stroke="var(--line-2)" strokeWidth="0.5" strokeDasharray="2,3" />
                  <text x={padL - 6} y={yOf(v).toFixed(1)} textAnchor="end" dominantBaseline="middle"
                        fontSize="9.5" fill="rgba(244,239,227,0.55)" fontFamily="var(--font-mono)">
                    {sym}{fmtPr(v)}
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
              {/* Vertical dashed line at last regular close (1D ext mode) */}
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
              {/* Price path */}
              <path d={path} fill="none" stroke={lineColor} strokeWidth="1.6"
                    strokeLinejoin="round" strokeLinecap="round" />
              {/* End-of-line dot */}
              {points.length > 0 && (() => {
                const last = points[points.length - 1];
                return <circle cx={xOfIdx(points.length - 1).toFixed(1)} cy={yOf(last.close).toFixed(1)}
                               r="3" fill={lineColor} stroke="#0c1310" strokeWidth="1.5" />;
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
            >{RANGES[k].label}</button>
          ))}
        </div>
      </div>
    </Modal>
  );
}
