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
// Magnitude scales BOTH saturation and lightness:
//   - Tiny moves → low saturation + low lightness → tile reads as a slightly
//     tinted dark gray (more washed-out / "白" leaning) so it doesn't shout.
//   - Big moves → higher saturation + higher lightness → vivid dark green/red.
// Saturation curve is sharper than lightness so the tile starts grayer and
// gets noticeably more colourful as the magnitude grows. sqrt curve keeps
// small moves still distinguishable from the neutral "no-change" tile.
function tileStyle(pct) {
  if (pct == null || Math.abs(pct) < 0.005) {
    return {
      bg: 'linear-gradient(180deg, rgb(34,40,38) 0%, rgb(26,32,30) 100%)',
      tickerClr: 'var(--chalk-dim)',
      pctClr: 'var(--chalk-dim)',
    };
  }
  // Saturate at 8% magnitude — daily moves above that are uncommon enough that
  // we don't need extra resolution beyond the deepest colour.
  const t = Math.min(1, Math.abs(pct) / 8);
  const kS = Math.sqrt(t);                // saturation curve — fast ramp
  const kL = Math.pow(t, 0.7);            // lightness curve — gentler

  if (pct > 0) {
    // Green: H≈142°. Small moves: low S, dark grey-green. Big moves: vivid.
    const S  = 14 + kS * 44;          // 14% → 58%
    const L1 = 16 + kL * 14;          // 16% → 30% (top of gradient)
    const L2 = Math.max(10, L1 - 4);  // bottom is 4pp dimmer for 3D feel
    return {
      bg: `linear-gradient(180deg, hsl(142, ${S}%, ${L1}%) 0%, hsl(142, ${S}%, ${L2}%) 100%)`,
      tickerClr: '#e8f6ec',
      pctClr: '#9be8b3',
    };
  }
  // Red: H≈354°.
  const S  = 18 + kS * 44;          // 18% → 62%
  const L1 = 18 + kL * 16;          // 18% → 34%
  const L2 = Math.max(12, L1 - 4);
  return {
    bg: `linear-gradient(180deg, hsl(354, ${S}%, ${L1}%) 0%, hsl(354, ${S}%, ${L2}%) 100%)`,
    tickerClr: '#fbe6e9',
    pctClr: '#f4a8b0',
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
