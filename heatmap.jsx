// Heatmap view — binary-split treemap of all holdings.
// Tiles sized by USD market value; colour-coded by day % change.

// ── Treemap layout (recursive binary split) ──────────────────────────────────
function treemap(nodes, x, y, w, h) {
  if (!nodes.length) return [];
  if (nodes.length === 1) return [{ ...nodes[0], x, y, w, h }];

  const total = nodes.reduce((s, n) => s + n.value, 0);
  let acc = 0, split = 0;
  for (let i = 0; i < nodes.length - 1; i++) {
    acc += nodes[i].value;
    split = i;
    if (acc * 2 >= total) break;
  }
  const g1 = nodes.slice(0, split + 1);
  const g2 = nodes.slice(split + 1);
  const frac = g1.reduce((s, n) => s + n.value, 0) / total;

  if (w >= h) {
    const w1 = Math.max(1, Math.round(w * frac));
    return [...treemap(g1, x, y, w1, h), ...treemap(g2, x + w1, y, w - w1, h)];
  } else {
    const h1 = Math.max(1, Math.round(h * frac));
    return [...treemap(g1, x, y, w, h1), ...treemap(g2, x, y + h1, w, h - h1)];
  }
}

// ── Tile colour (Trading 212-style muted dark gradient) ──────────────────────
// Magnitude shapes lightness; sqrt curve keeps small moves visible while
// saturating gracefully on big moves. Top-bright / bottom-dim gradient gives
// the tiles a subtle 3D feel.
function tileStyle(pct) {
  if (pct == null || Math.abs(pct) < 0.005) {
    return {
      bg: 'linear-gradient(180deg, rgb(34,40,38) 0%, rgb(26,32,30) 100%)',
      tickerClr: 'var(--chalk-dim)',
      pctClr: 'var(--chalk-dim)',
    };
  }
  // t in [0,1] — saturates at ~10% magnitude
  const t = Math.min(1, Math.abs(pct) / 10);
  const k = Math.sqrt(t); // soften so tiny moves still show colour

  if (pct > 0) {
    // Forest green progression
    const r1 = Math.round(28 + k * 50);
    const g1 = Math.round(48 + k * 110);
    const b1 = Math.round(38 + k * 60);
    const r2 = Math.round(r1 * 0.82);
    const g2 = Math.round(g1 * 0.82);
    const b2 = Math.round(b1 * 0.82);
    return {
      bg: `linear-gradient(180deg, rgb(${r1},${g1},${b1}) 0%, rgb(${r2},${g2},${b2}) 100%)`,
      tickerClr: '#e3f5e8',
      pctClr: '#86efac',
    };
  }
  // Crimson progression
  const r1 = Math.round(50 + k * 130);
  const g1 = Math.round(28 + k * 38);
  const b1 = Math.round(36 + k * 50);
  const r2 = Math.round(r1 * 0.82);
  const g2 = Math.round(g1 * 0.82);
  const b2 = Math.round(b1 * 0.82);
  return {
    bg: `linear-gradient(180deg, rgb(${r1},${g1},${b1}) 0%, rgb(${r2},${g2},${b2}) 100%)`,
    tickerClr: '#fbe5e9',
    pctClr: '#fca5a5',
  };
}

// ── Component ─────────────────────────────────────────────────────────────────
function Heatmap({ metrics, extendedHours }) {
  const canvasRef = React.useRef(null);
  const [size, setSize] = React.useState({ w: 0, h: 0 });

  React.useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() =>
      setSize({ w: el.clientWidth, h: el.clientHeight })
    );
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Collect non-cash players from every position
  const items = [];
  for (const pos of Object.values(metrics.positions)) {
    for (const p of pos.players) {
      if (p.isCash || p.ticker === 'CASH') continue;
      const value = Math.max(0, p.marketValue ?? 0);
      if (value === 0) continue;
      const pct = extendedHours && p.extDayPct != null ? p.extDayPct : (p.dayPct ?? 0);
      items.push({ ticker: p.ticker, value, pct });
    }
  }
  items.sort((a, b) => b.value - a.value);

  const tiles =
    size.w > 0 && size.h > 0 && items.length > 0
      ? treemap(items, 0, 0, size.w, size.h)
      : [];

  const GAP = 3;

  return (
    <div className="pitch-wrap">
      <div className="heatmap">
        <div ref={canvasRef} className="heatmap-canvas">
          {tiles.map(tile => {
            const tw = tile.w - GAP;
            const th = tile.h - GAP;
            const { bg, tickerClr, pctClr } = tileStyle(tile.pct);
            const pctStr = (tile.pct >= 0 ? '+' : '') + tile.pct.toFixed(2) + '%';

            const showTicker = tw >= 38 && th >= 28;
            const showPct    = tw >= 48 && th >= 42;

            return (
              <div
                key={tile.ticker}
                className="hm-tile"
                style={{
                  left:       tile.x + GAP / 2,
                  top:        tile.y + GAP / 2,
                  width:      tw,
                  height:     th,
                  background: bg,
                }}
              >
                {showTicker && (
                  <span className="hm-ticker mono" style={{ color: tickerClr }}>
                    {tile.ticker}
                  </span>
                )}
                {showPct && (
                  <span className="hm-pct mono" style={{ color: pctClr }}>
                    {pctStr}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { Heatmap });
