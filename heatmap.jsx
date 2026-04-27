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

// ── Tile colour (Trading 212-style HSL gradient) ─────────────────────────────
// Magnitude inversely scales lightness and positively scales saturation:
//   - Tiny moves → very high lightness + low saturation → washed-out pale
//     pastel ("nearly white"), low contrast against the page.
//   - Big moves → low lightness + high saturation → deep, rich dark green/red.
// "颜色更深代表变动越大" maps directly to luminance: deeper tile == bigger move.
// Text colour flips automatically — dark glyphs on the light pastel tiles,
// light glyphs on the deep tiles — so percentages stay legible at every level.
function tileStyle(pct) {
  if (pct == null || Math.abs(pct) < 0.005) {
    return {
      bg: 'linear-gradient(180deg, rgb(34,40,38) 0%, rgb(26,32,30) 100%)',
      tickerClr: 'var(--chalk-dim)',
      pctClr: 'var(--chalk-dim)',
    };
  }
  // Saturate at 6% magnitude. kL drops faster than kS so lightness pulls
  // ahead — the tile darkens before it gets too saturated, which avoids the
  // mid-range hitting a vibrant fully-saturated medium green/red that reads
  // as "刺眼" on the eye. kS uses pow(t, 0.65) and a tighter ceiling so the
  // 2-3 % band lands on a softer, less neon-y colour.
  const t = Math.min(1, Math.abs(pct) / 6);
  const kS = Math.pow(t, 0.65);
  const kL = Math.pow(t, 0.55);

  // L1 sweeps 78% (washed pastel) down to 28% (deep). S sweeps 20% to 50%
  // (was 22 → 60) so mid-range tiles aren't fully saturated and the deepest
  // colour is still clearly green/red without being neon.
  const S  = 20 + kS * 30;
  const L1 = 78 - kL * 50;            // top of gradient
  const L2 = Math.max(22, L1 - 4);    // bottom 4pp dimmer for the 3D feel
  const useDarkText = L1 > 52;

  if (pct > 0) {
    return {
      bg: `linear-gradient(180deg, hsl(142, ${S}%, ${L1}%) 0%, hsl(142, ${S}%, ${L2}%) 100%)`,
      tickerClr: useDarkText ? '#0f3a23' : '#e8f6ec',
      pctClr:    useDarkText ? '#0f5a31' : '#9be8b3',
    };
  }
  return {
    bg: `linear-gradient(180deg, hsl(354, ${S}%, ${L1}%) 0%, hsl(354, ${S}%, ${L2}%) 100%)`,
    tickerClr: useDarkText ? '#4a1620' : '#fbe6e9',
    pctClr:    useDarkText ? '#811f2c' : '#f4a8b0',
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
