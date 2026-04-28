// Single-ticker price-history modal. X axis = time, Y axis = price.
// Hover crosshair shows the price/time/% at the cursor's nearest data
// point with dashed lines down to both axes. Same range buttons as the
// portfolio chart (1D / 1W / 1M / 3M / YTD). Used when the user taps a
// player in non-edit mode — edit mode keeps opening the EditTickerModal.
import React from 'react';
import { Modal } from './modals.jsx';
import { fetchHistoricalBatch } from './utils.js';
import { RANGES, RANGE_KEYS } from './ytd.js';
import { fmtPrice as fmtPr, fmtPct as fmP, pctColor as pcC } from './utils.js';

const SYMBOL_BY_CUR = { USD: '$', GBP: '£', CNY: '¥', HKD: 'HK$' };

// Memoized fetch cache so re-opening the modal for the same (ticker,range,
// extended-hours) is instant. 5-min TTL for intraday data, 1 h for daily.
const _modalCache = new Map(); // key → { ts, data }
function modalCacheGet(key, ttlMs) {
  const e = _modalCache.get(key);
  if (e && Date.now() - e.ts < ttlMs) return e.data;
  return null;
}
function modalCacheSet(key, data) { _modalCache.set(key, { ts: Date.now(), data }); }

export function TickerChartModal({ ticker, holding, marketData, extendedHours, phase, onClose }) {
  const [rangeKey, setRangeKey] = React.useState('YTD');
  const [series, setSeries]     = React.useState(/** @type {Array<{date:string,close:number}>|null} */ (null));
  const [loading, setLoading]   = React.useState(true);
  const [error, setError]       = React.useState(false);
  const [hoverIdx, setHoverIdx] = React.useState(/** @type {number|null} */ (null));

  const useExt = !!(extendedHours && phase && phase !== 'regular');

  // Pick (yahooRange, interval, includePrePost) based on the user's choice.
  // 1D has three sub-modes per the spec:
  //   ext OFF + market open  → today's regular hours intraday
  //   ext OFF + market close → previous regular trading day's intraday
  //   ext ON                  → past 24 h with pre/post-market included
  function fetchParams(rk) {
    const r = RANGES[rk] || RANGES.YTD;
    if (rk !== '1D') return { yahooRange: r.yahooRange, interval: r.interval, includePrePost: false };
    if (extendedHours) return { yahooRange: '1d', interval: '5m', includePrePost: true };
    if (phase === 'regular') return { yahooRange: '1d', interval: '5m', includePrePost: false };
    // Market closed and ext OFF → fetch a 5-day window so we have at least
    // one complete prior session, then keep just the most recent date below.
    return { yahooRange: '5d', interval: '5m', includePrePost: false };
  }

  React.useEffect(() => {
    let cancelled = false;
    const { yahooRange, interval, includePrePost } = fetchParams(rangeKey);
    const cacheKey = `${ticker}|${rangeKey}|${useExt ? 'ext' : 'reg'}|${phase || ''}`;
    const ttl = rangeKey === '1D' ? 5 * 60 * 1000 : 60 * 60 * 1000;
    const cached = modalCacheGet(cacheKey, ttl);
    if (cached) {
      setSeries(cached);
      setLoading(false);
      setError(false);
      return;
    }
    setLoading(true);
    setError(false);
    (async () => {
      const out = await fetchHistoricalBatch([ticker], yahooRange, interval, includePrePost);
      if (cancelled) return;
      let data = out[ticker];
      if (!data || data.length < 2) { setError(true); setLoading(false); return; }
      // ext OFF + market closed: keep just the most recent calendar day's
      // data. Series points are "YYYY-MM-DDTHH:MM" in this mode so we group
      // by the date prefix, take the latest, and slice.
      if (rangeKey === '1D' && !extendedHours && phase !== 'regular') {
        const lastDate = data[data.length - 1].date.slice(0, 10);
        data = data.filter(p => p.date.startsWith(lastDate));
      }
      modalCacheSet(cacheKey, data);
      setSeries(data);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [ticker, rangeKey, useExt, phase]);

  const liveLast = (marketData?.[ticker]?.lastPrice ?? holding?.lastPrice) || null;

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
  //   1D ext on   → close at the regular-close idx if found, else first pt
  //   1D ext off + closed → first point of the last day (already filtered)
  //   others      → last close strictly before the first window point
  let anchorClose = null;
  if (series && series.length > 0) {
    if (rangeKey === '1D') {
      const md = marketData?.[ticker];
      if (useExt && regularCloseIdx >= 0) {
        anchorClose = series[regularCloseIdx].close;
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
  let xOf = (_d) => padL, yOf = (_p) => padT + cH / 2;
  let yMin = 0, yMax = 0, ticksY = [], ticksX = [];
  if (hasData) {
    const t0 = new Date(points[0].date).getTime();
    const t1 = new Date(points[points.length - 1].date).getTime();
    const tSpan = Math.max(t1 - t0, 1);
    xOf = (d) => padL + ((new Date(d).getTime() - t0) / tSpan) * cW;
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
    // X ticks — pick a few representative timestamps
    const ticksToShow = rangeKey === '1D' ? 5 : 4;
    for (let i = 0; i <= ticksToShow; i++) {
      const t = t0 + (tSpan * i) / ticksToShow;
      ticksX.push(t);
    }
  }

  function fmtX(ts) {
    const d = new Date(ts);
    if (rangeKey === '1D') {
      // HH:MM, browser locale
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    // Mon DD
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  }

  // Mouse handler: find nearest point by X distance, set hoverIdx
  const svgRef = React.useRef(null);
  function handleMove(e) {
    if (!hasData || !svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const sx = ((e.clientX - rect.left) / rect.width) * W;
    if (sx < padL || sx > W - padR) { setHoverIdx(null); return; }
    let bestI = 0, bestD = Infinity;
    for (let i = 0; i < points.length; i++) {
      const x = xOf(points[i].date);
      const d = Math.abs(x - sx);
      if (d < bestD) { bestD = d; bestI = i; }
    }
    setHoverIdx(bestI);
  }
  function handleLeave() { setHoverIdx(null); }

  const path = points.length > 0
    ? 'M' + points.map(p => `${xOf(p.date).toFixed(1)},${yOf(p.close).toFixed(1)}`).join('L')
    : '';
  const lineColor = pctNow >= 0 ? 'var(--gain)' : 'var(--loss)';

  // Hover-derived display values (or fall back to "now")
  const displayIdx = hoverIdx != null ? hoverIdx : (points.length - 1);
  const displayPt  = hasData ? points[displayIdx] : null;
  const displayPct = (displayPt && anchorClose)
    ? ((displayPt.close - anchorClose) / anchorClose) * 100
    : 0;

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
              {/* X-axis labels */}
              {ticksX.map((ts, i) => (
                <text key={`x${i}`} x={padL + (cW * i) / (ticksX.length - 1)} y={H - padB + 14}
                      textAnchor={i === 0 ? 'start' : (i === ticksX.length - 1 ? 'end' : 'middle')}
                      fontSize="9.5" fill="rgba(244,239,227,0.55)" fontFamily="var(--font-mono)">
                  {fmtX(ts)}
                </text>
              ))}
              {/* Vertical dashed line at last regular close (1D ext mode) */}
              {regularCloseIdx >= 0 && (() => {
                const x = xOf(points[regularCloseIdx].date).toFixed(1);
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
                return <circle cx={xOf(last.date).toFixed(1)} cy={yOf(last.close).toFixed(1)}
                               r="3" fill={lineColor} stroke="#0c1310" strokeWidth="1.5" />;
              })()}
              {/* Hover crosshair */}
              {hoverIdx != null && displayPt && (() => {
                const hx = xOf(displayPt.date);
                const hy = yOf(displayPt.close);
                const dotColor = displayPct >= 0 ? 'var(--gain)' : 'var(--loss)';
                return (
                  <g>
                    {/* Vertical dashed line down to X axis */}
                    <line x1={hx.toFixed(1)} y1={padT} x2={hx.toFixed(1)} y2={H - padB}
                          stroke="rgba(244,239,227,0.5)" strokeWidth="0.7" strokeDasharray="3,3" />
                    {/* Horizontal dashed line out to Y axis */}
                    <line x1={padL} y1={hy.toFixed(1)} x2={W - padR} y2={hy.toFixed(1)}
                          stroke="rgba(244,239,227,0.5)" strokeWidth="0.7" strokeDasharray="3,3" />
                    {/* X-axis time label */}
                    <rect x={hx - 32} y={H - padB + 1} width={64} height={18} fill="#0c1310" stroke="var(--chalk-dim)" />
                    <text x={hx.toFixed(1)} y={H - padB + 13} textAnchor="middle"
                          fontSize="9.5" fill="var(--chalk)" fontFamily="var(--font-mono)">
                      {fmtX(new Date(displayPt.date).getTime())}
                    </text>
                    {/* Y-axis price label */}
                    <rect x={padL - 56} y={hy - 9} width={52} height={18} fill="#0c1310" stroke="var(--chalk-dim)" />
                    <text x={padL - 6} y={hy.toFixed(1)} textAnchor="end" dominantBaseline="middle"
                          fontSize="9.5" fill="var(--chalk)" fontFamily="var(--font-mono)">
                      {sym}{fmtPr(displayPt.close)}
                    </text>
                    {/* Dot at the hovered point */}
                    <circle cx={hx.toFixed(1)} cy={hy.toFixed(1)} r="3.5"
                            fill={dotColor} stroke="#0c1310" strokeWidth="1.5" />
                    {/* % label slightly above-right of the dot */}
                    <rect x={hx + 6} y={hy - 16} width={56} height={16} rx={2}
                          fill={displayPct >= 0 ? 'rgba(70,160,90,0.85)' : 'rgba(190,60,70,0.85)'} />
                    <text x={hx + 34} y={hy - 5} textAnchor="middle"
                          fontSize="10" fill="#fff" fontFamily="var(--font-mono)" fontWeight="600">
                      {fmP(displayPct)}
                    </text>
                  </g>
                );
              })()}
            </svg>
          )}
        </div>

        <div className="perf-range-row">
          {RANGE_KEYS.map(k => (
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
