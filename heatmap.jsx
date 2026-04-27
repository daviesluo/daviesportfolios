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
// Hue, saturation AND lightness all shift with magnitude so the small/big
// extremes land on specific colour names:
//   Up   small → light grass green  (hsl ≈ 100°, 55%, 78%)
//   Up   big   → pine / 松绿        (hsl ≈ 150°, 60%, 26%)
//   Down small → light pink         (hsl ≈ 352°, 78%, 86%)
//   Down big   → plum red / 梅红    (hsl ≈ 346°, 58%, 36%)
// kS = sqrt(t) so small moves already start to colour up, but the deepest
// hue/lightness only fully arrives near the saturation cap (8% daily move).
// Text colour auto-flips at L>52% — dark glyphs on the pale tiles, light
// glyphs on the deep tiles.
function tileStyle(pct) {
  if (pct == null || Math.abs(pct) < 0.005) {
    return {
      bg: 'linear-gradient(180deg, rgb(34,40,38) 0%, rgb(26,32,30) 100%)',
      tickerClr: 'var(--chalk-dim)',
      pctClr: 'var(--chalk-dim)',
    };
  }
  const t = Math.min(1, Math.abs(pct) / 8);
  const kS = Math.sqrt(t);
  const kL = Math.pow(t, 0.7);

  if (pct > 0) {
    const H  = 100 + kS * 50;          // grass 100° → pine 150°
    const S  = 55 + kS * 5;            // 55% → 60%
    const L1 = 78 - kL * 52;           // 78% (light grass) → 26% (pine)
    const L2 = Math.max(20, L1 - 4);
    const useDarkText = L1 > 52;
    return {
      bg: `linear-gradient(180deg, hsl(${H}, ${S}%, ${L1}%) 0%, hsl(${H}, ${S}%, ${L2}%) 100%)`,
      tickerClr: useDarkText ? '#0f3a23' : '#eaf7ee',
      pctClr:    useDarkText ? '#0f5a31' : '#a7eabd',
    };
  }
  // Red side
  const H  = 352 - kS * 6;             // light pink 352° → plum 346°
  const S  = 78 - kS * 20;             // 78% (vivid pink) → 58% (plum)
  const L1 = 86 - kL * 50;             // 86% (light pink) → 36% (plum red)
  const L2 = Math.max(28, L1 - 4);
  const useDarkText = L1 > 52;
  return {
    bg: `linear-gradient(180deg, hsl(${H}, ${S}%, ${L1}%) 0%, hsl(${H}, ${S}%, ${L2}%) 100%)`,
    tickerClr: useDarkText ? '#4a1622' : '#fbe6e9',
    pctClr:    useDarkText ? '#871f2e' : '#f4a8b0',
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
