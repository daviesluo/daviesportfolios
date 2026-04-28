// Single-ticker price-history modal. Same range buttons as the portfolio
// chart (1D / 1W / 1M / 3M / YTD); plots one line of the ticker's close
// price normalised to its anchor (= prevClose for 1D, last close before
// the window for daily ranges). Used when the user taps a player in
// non-edit mode — edit mode keeps opening the EditTickerModal instead.
import React from 'react';
import { Modal } from './modals.jsx';
import { fetchHistorical, fetchHistoricalBatch, fxToUSD } from './utils.js';
import { RANGES, RANGE_KEYS, anchorDateFor } from './ytd.js';
import { fmtMoney as fmM, fmtPct as fmP, fmtPrice as fmtPr, pctColor as pcC } from './utils.js';

export function TickerChartModal({ ticker, holding, marketData, onClose }) {
  const [rangeKey, setRangeKey] = React.useState('YTD');
  const [series, setSeries]     = React.useState(/** @type {Array<{date:string,close:number}>|null} */ (null));
  const [loading, setLoading]   = React.useState(true);
  const [error, setError]       = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(false);
    const r = RANGES[rangeKey] || RANGES.YTD;
    (async () => {
      const out = await fetchHistorical(ticker, r.yahooRange, r.interval).catch(() => null);
      if (cancelled) return;
      if (!out || out.length < 2) { setError(true); setLoading(false); return; }
      setSeries(out);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [ticker, rangeKey]);

  // Resolve anchor price for the chart — same convention as PerfChart.
  const anchorDate = anchorDateFor(rangeKey);
  const md = marketData?.[ticker];
  const livePrice = md?.lastPrice ?? holding?.lastPrice ?? null;

  let inWindow = (series || []).filter(p => p.date >= anchorDate);
  if (inWindow.length < 2 && series && series.length >= 2) inWindow = series.slice(-2);
  let anchorPrice = null;
  if (rangeKey === '1D') {
    anchorPrice = (md && md.prevClose && md.prevClose > 0) ? md.prevClose
                : (inWindow[0]?.close ?? null);
  } else {
    const prior = (series || []).filter(p => p.date < anchorDate);
    anchorPrice = prior.length > 0 ? prior[prior.length - 1].close
                : (inWindow[0]?.close ?? null);
  }

  // Normalise to % return from anchorPrice. Last point uses live price if
  // we have one, so the modal's tail tracks the rest of the app.
  const last = inWindow[inWindow.length - 1];
  const liveClose = (livePrice && livePrice > 0) ? livePrice : last?.close ?? null;
  const points = inWindow.map((p, i) => ({
    date: p.date,
    close: i === inWindow.length - 1 && liveClose ? liveClose : p.close,
  }));

  const pctNow = (anchorPrice && liveClose) ? ((liveClose - anchorPrice) / anchorPrice) * 100 : 0;
  const cur = holding?.currency || 'USD';
  const sym = cur === 'USD' ? '$' : cur === 'GBP' ? '£' : cur === 'CNY' ? '¥' : cur === 'HKD' ? 'HK$' : '$';

  // Chart geometry
  const W = 540, H = 220;
  const padL = 36, padR = 12, padT = 14, padB = 32;
  const cW = W - padL - padR, cH = H - padT - padB;

  const hasData = points.length >= 2 && anchorPrice && anchorPrice > 0;
  const norm = hasData
    ? points.map(p => ({ date: p.date, pct: ((p.close - anchorPrice) / anchorPrice) * 100 }))
    : [];

  let xOf = (_d) => padL, yOf = (_p) => padT + cH / 2;
  let yMin = 0, yMax = 0, ticks = [];
  if (norm.length >= 2) {
    const t0 = new Date(norm[0].date).getTime();
    const t1 = new Date(norm[norm.length - 1].date).getTime();
    const tSpan = Math.max(t1 - t0, 1);
    xOf = (d) => padL + ((new Date(d).getTime() - t0) / tSpan) * cW;
    const allP = [...norm.map(p => p.pct), 0];
    const rawMin = Math.min(...allP), rawMax = Math.max(...allP);
    const yPad = Math.max(0.5, (rawMax - rawMin) * 0.12);
    yMin = rawMin - yPad; yMax = rawMax + yPad;
    const yRange = yMax - yMin || 1;
    yOf = (p) => padT + ((yMax - p) / yRange) * cH;
    const r = yMax - yMin;
    const tickStep = r <= 4 ? 1 : r <= 10 ? 2 : r <= 30 ? 5 : 10;
    for (let t = Math.ceil(yMin / tickStep) * tickStep; t <= yMax; t += tickStep) ticks.push(t);
  }

  const path = norm.length > 0
    ? 'M' + norm.map(p => `${xOf(p.date).toFixed(1)},${yOf(p.pct).toFixed(1)}`).join('L')
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
            <span className="mono">{liveClose != null ? `${sym}${fmtPr(liveClose)}` : '—'}</span>
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
            <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} style={{ display: 'block' }}>
              {ticks.map(t => (
                <g key={t}>
                  <line x1={padL} y1={yOf(t).toFixed(1)} x2={W - padR} y2={yOf(t).toFixed(1)}
                        stroke="var(--line-2)" strokeWidth="0.5"
                        strokeDasharray={t === 0 ? undefined : "2,3"} />
                  <text x={padL - 4} y={yOf(t).toFixed(1)} textAnchor="end" dominantBaseline="middle"
                        fontSize="9" fill="rgba(244,239,227,0.45)" fontFamily="var(--font-mono)">
                    {t >= 0 ? '+' : ''}{t}%
                  </text>
                </g>
              ))}
              <path d={path} fill="none" stroke={lineColor} strokeWidth="1.6"
                    strokeLinejoin="round" strokeLinecap="round" />
              {norm.length > 0 && (() => {
                const last = norm[norm.length - 1];
                return <circle cx={xOf(last.date).toFixed(1)} cy={yOf(last.pct).toFixed(1)}
                               r="3" fill={lineColor} stroke="#0c1310" strokeWidth="1.5" />;
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
