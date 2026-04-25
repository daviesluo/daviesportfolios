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

// ── Tile colour — HSL-based, Trading 212 dark-mode palette ──────────────────
// Both hue families use the same lightness/saturation curve so the visual
// weight of gains and losses is symmetric. sqrt(t) keeps tiny moves visible.
function tileStyle(pct) {
  if (pct == null || Math.abs(pct) < 0.005) {
    return {
      bg: 'linear-gradient(180deg, hsl(158,12%,13%) 0%, hsl(158,12%,10%) 100%)',
      tickerClr: 'rgba(244,239,227,0.45)',
      pctClr:    'rgba(244,239,227,0.45)',
    };
  }
  const t = Math.min(1, Math.abs(pct) / 10); // saturate at 10%
  const k = Math.sqrt(t);                     // soft curve
  const sat   = Math.round(28 + k * 40);      // 28 → 68 %
  const light = Math.round(11 + k * 21);      // 11 → 32 %

  if (pct > 0) {
    const pctLight = Math.round(50 + k * 22); // pct text: 50 → 72 %
    return {
      bg:        `linear-gradient(180deg, hsl(142,${sat}%,${light + 4}%) 0%, hsl(142,${sat}%,${light - 2}%) 100%)`,
      tickerClr: 'rgba(244,239,227,0.92)',
      pctClr:    `hsl(142,75%,${pctLight}%)`,
    };
  }
  const pctLight = Math.round(55 + k * 22); // pct text: 55 → 77 %
  return {
    bg:        `linear-gradient(180deg, hsl(352,${sat}%,${light + 4}%) 0%, hsl(352,${sat}%,${light - 2}%) 100%)`,
    tickerClr: 'rgba(244,239,227,0.92)',
    pctClr:    `hsl(352,85%,${pctLight}%)`,
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

            const showTicker = tw >= 30 && th >= 22;
            const showPct    = tw >= 36 && th >= 32;

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
