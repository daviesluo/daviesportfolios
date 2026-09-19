// Heatmap view — binary-split treemap of all holdings.
// Tiles sized by USD market value; colour-coded by day % change.
import React from 'react';
import { displayTicker, pctIsFlat } from './formatters.js';

// Re-exported so heatmap.test.js's existing import keeps working; the
// helper itself now lives in formatters.js because the tactics board
// and Top Movers label their tickers the same way.
export { displayTicker };

/**
 * How to draw a ticker inside a tile: the font size that lets it sit on
 * ONE line, and where it may break if it still cannot.
 *
 * The old sizing read `min(tw, th) / 3`, which ignores how many
 * characters the label has. A four-character ticker on a narrow tile
 * (SAEM, VUAA) therefore kept its 11px, overflowed the line, and — with
 * `word-break: break-all` — wrapped wherever it ran out of room, which
 * is 3 + 1: a lone "M" on its own line with the % squeezed underneath.
 *
 * Width is the binding constraint and it depends on the label:
 *   - JetBrains Mono advances 0.6em per glyph,
 *   - `.hm-ticker` adds 0.04em of tracking and 2px of padding per side.
 * Height has to hold the ticker line AND the % line beneath it (a 3px
 * flex gap, ticker line-height 1.05), or the % clips at the tile edge.
 *
 * `mid` is the ONE place the string may break — the caller emits a
 * `<wbr>` there and the stylesheet forbids breaking anywhere else, so a
 * label that genuinely cannot fit splits balanced (SA/EM), never
 * orphaning a single character.
 *
 * @param {string} label  already through `displayTicker`
 * @param {number} tw     tile width in px
 * @param {number} th     tile height in px
 * @returns {{ label: string, fontSize: number, mid: number }}
 */
export function fitTicker(label, tw, th) {
  const text = typeof label === 'string' ? label : '';
  const len = Math.max(1, text.length);
  const avail = Math.max(0, tw - 4);
  const byWidth = Math.floor(avail / (len * 0.64));
  const byHeight = Math.floor(((th - 3) * 0.55) / 1.05);
  const fontSize = Math.max(7, Math.min(11, byWidth, byHeight));
  return { label: text, fontSize, mid: Math.ceil(len / 2) };
}

// ── Treemap layout (bands across the free space) ─────────────────────────────
// A tile's AREA is the contract: always proportional to market value. Nothing
// below bends that. What is free is the ARRANGEMENT, and it has now been wrong
// in two different directions.
//
// It began as a recursive binary split that cut wherever the running total
// first passed half. For a run of near-equal holdings that point is the exact
// middle every time, the halving repeated, and the top of the board came out
// as a grid of near-identical rectangles — on a 338 × 612 canvas the eight
// largest all landed within 15 % of 110 × 170 px, three to a row.
//
// Moving the cut point off the middle broke the repetition and replaced it
// with a mess: a split that lands at 0.38 here and 0.62 there leaves seams
// that stop halfway and restart 70 px lower, and a board of near-miss edges
// reads as chaos rather than variety. The ask was never "different", it was
// varied AND orderly — which is a statement about the SEAMS, not the tiles.
//
// So the layout is bands. Each pass lays one band across the full width (or
// full height) of whatever space is left, which makes every seam run edge to
// edge inside its own region; the leftover is a rectangle again and the next
// band fills it the same way. Variety comes from the band, not from ragged
// cuts: how many holdings it carries, and therefore how thick it is and how
// wide its tiles are, changes band to band. Two, then three, then a column of
// three down the side. Same discipline in every region, different shape in
// each.
const MIN_TILE_W = 27, MIN_TILE_H = 25;

// No tile may be worse than 3:1. The binary split reached 3.2:1 on this book
// and 4.39:1 across the seven test books; bands measure 2.1:1 and 2.5:1,
// because choosing how many holdings share a band is a much more direct grip
// on tile shape than choosing where to halve a list.
const MAX_ASPECT = 3;

// The shape each band is ASKED for, as tile-width over band-thickness: 0.62 is
// a band of tall tiles, 1.75 a band of wide ones. Walking this range is what
// keeps the counts moving — a band asked to be wide takes two holdings, one
// asked to be tall takes four — and the golden-ratio step never repeats or
// clusters, so consecutive bands never come out the same shape twice. It is a
// sequence, not a random number: the same book always draws the same map.
const SHAPE_LO = 0.62, SHAPE_HI = 1.75, PHI = 0.6180339887498949;
const bandShape = (step) =>
  SHAPE_LO * Math.pow(SHAPE_HI / SHAPE_LO, ((step + 1) * PHI) % 1);

// At most five to a band. Past that the tiles are thin slices of one stripe,
// which is the other way to make a board look mechanical.
const MAX_BAND = 5;

// Where the bands stop and the nesting split takes over. A band can only ever
// span the full width, so the last 1 % of a book becomes a row of slivers no
// label fits in — measured, four tiles under 13 px wide. The nesting split is
// free to divide in both directions, so it can give the same holdings a
// squarish corner, and that corner is the part of the old board that always
// looked right anyway.
//
// Two conditions, because they catch different tails. A rect whose short side
// has run below `NEST_BELOW` has no room for another band. Six or fewer
// holdings left has nothing to vary — a band would have to swallow most of
// them — and a five-holding book like the browser sweep's fixture is that
// case from the start. Measured across the eight books at eight canvas sizes,
// adding the count condition takes the worst aspect ratio anywhere from
// 10.4:1 to 5.4:1 and the tiles too small to label from 26 to 17.
const NEST_BELOW = 90, NEST_COUNT = 6;

// The original recursive binary split, now only ever handed the tail.
function nest(nodes, x, y, w, h) {
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
    return [...nest(g1, x, y, w1, h), ...nest(g2, x + w1, y, w - w1, h)];
  }
  const h1 = Math.max(1, Math.round(h * frac));
  return [...nest(g1, x, y, w, h1), ...nest(g2, x, y + h1, w, h - h1)];
}

/**
 * How many of the remaining holdings this band should carry.
 *
 * Every count is costed: the band's thickness is its share of the value, so
 * taking more holdings makes a thicker band of narrower tiles. Counts that
 * would put a tile under the label size or past `MAX_ASPECT` are not offered
 * — unless nothing is left to choose from, in which case the squarest count
 * wins, because a band still has to be laid.
 */
function bandSize(rest, remaining, span, perp, across, step) {
  const want = bandShape(step);
  let best = 0, bestScore = Infinity, safest = 1, safestWorst = Infinity;

  for (let k = 1; k <= Math.min(MAX_BAND, rest.length); k++) {
    let sum = 0;
    for (let i = 0; i < k; i++) sum += rest[i].value;
    const thick = (sum / remaining) * perp;
    let worst = 1, meanLog = 0, fits = thick >= (across ? MIN_TILE_H : MIN_TILE_W);
    for (let i = 0; i < k; i++) {
      const side = (rest[i].value / sum) * span;
      if (side < (across ? MIN_TILE_W : MIN_TILE_H)) fits = false;
      const ratio = across ? side / thick : thick / side;
      worst = Math.max(worst, ratio, 1 / ratio);
      meanLog += Math.log(ratio);
    }
    // A band must also leave a usable strip behind it. Without this the
    // fixture's CN fund — 1.1 % of its book — lost its label to a 13 × 246
    // splinter: the band before it was perfectly well shaped and simply took
    // all the room. Judging a cut by its own two halves and not by what it
    // leaves is the same mistake the shape veto made, one level up.
    const leaves = k < rest.length
      ? perp - thick >= (across ? MIN_TILE_H : MIN_TILE_W)
      : true;
    if (worst < safestWorst) { safestWorst = worst; safest = k; }
    // Taking everything that is left is a legitimate way to finish, but it is
    // not exempt from the guards: left competing on score it won on the CN
    // fund's book and swept all five holdings into one band, splintering the
    // smallest. It reaches the layout through `safest`, when nothing else can.
    if (!fits || !leaves || worst > MAX_ASPECT) continue;
    const score = Math.abs(meanLog / k - Math.log(want));
    if (score < bestScore) { bestScore = score; best = k; }
  }
  return best || safest;
}

export function treemap(nodes, x, y, w, h) {
  const out = [];
  let rest = nodes, step = 0;

  while (rest.length) {
    if (rest.length === 1) { out.push({ ...rest[0], x, y, w, h }); break; }
    if (rest.length <= NEST_COUNT || Math.min(w, h) < NEST_BELOW) {
      out.push(...nest(rest, x, y, w, h));
      break;
    }

    // Bands run across the SHORTER side, so the leftover stays as square as
    // it can and the next band has a sane shape to work with.
    const across = w <= h;
    const span = across ? w : h, perp = across ? h : w;
    const remaining = rest.reduce((s, n) => s + n.value, 0);
    const take = bandSize(rest, remaining, span, perp, across, step);

    const band = rest.slice(0, take);
    const sum = band.reduce((s, n) => s + n.value, 0);
    // The final band takes the rest of the box outright: rounding every other
    // band to whole pixels otherwise leaves a seam of leftovers at the end.
    const thick = take === rest.length
      ? perp
      : Math.max(1, Math.min(perp - 1, Math.round((sum / remaining) * perp)));

    let off = 0;
    band.forEach((n, i) => {
      const side = i === band.length - 1
        ? span - off
        : Math.max(1, Math.round((n.value / sum) * span));
      out.push(across
        ? { ...n, x: x + off, y, w: side, h: thick }
        : { ...n, x, y: y + off, w: thick, h: side });
      off += side;
    });

    if (across) { y += thick; h -= thick; } else { x += thick; w -= thick; }
    rest = rest.slice(take);
    step += 1;
  }
  return out;
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
  if (pctIsFlat(pct)) {
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

  // Saturation sweeps 20% → 50% — both sides share this. Lightness ranges
  // were previously 78 → 28 (green) and 70 → 28 (red), which gave the
  // smallest movers a near-white pastel look. The user wanted to skip the
  // two palest tiers and start from a noticeably tinted mid-light shade,
  // so each side now starts ~18 pp darker. Red still uses a steeper kL so
  // 1-2 % decliners don't get stuck in the pastel-pink band.
  const S = 20 + kS * 30;
  if (pct > 0) {
    const L1 = 60 - kL * 32;          // 60 % → 28 %
    const L2 = Math.max(22, L1 - 4);
    const useDarkText = L1 > 48;
    return {
      bg: `linear-gradient(180deg, hsl(142, ${S}%, ${L1}%) 0%, hsl(142, ${S}%, ${L2}%) 100%)`,
      tickerClr: useDarkText ? '#0f3a23' : '#e8f6ec',
      pctClr:    useDarkText ? '#0f5a31' : '#9be8b3',
    };
  }
  const kLr = Math.pow(t, 0.45);
  const L1r = 54 - kLr * 26;          // 54 % → 28 %
  const L2r = Math.max(24, L1r - 4);
  const useDarkTextR = L1r > 48;
  return {
    bg: `linear-gradient(180deg, hsl(354, ${S}%, ${L1r}%) 0%, hsl(354, ${S}%, ${L2r}%) 100%)`,
    tickerClr: useDarkTextR ? '#4a1620' : '#fbe6e9',
    pctClr:    useDarkTextR ? '#811f2c' : '#f4a8b0',
  };
}

// ── Component ─────────────────────────────────────────────────────────────────
function Heatmap({ metrics, extendedHours, onTileClick }) {
  const canvasRef = React.useRef(/** @type {HTMLDivElement | null} */ (null));
  const [size, setSize] = React.useState({ w: 0, h: 0 });

  React.useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      // Bail out of the state update (and the treemap recompute it
      // triggers) when the box didn't actually change size — the
      // observer fires on every layout pass, not just real resizes.
      const w = el.clientWidth, h = el.clientHeight;
      setSize((s) => (s.w === w && s.h === h ? s : { w, h }));
    });
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
      // Use the already-gated `p.dayPct` from computeMetrics — it
      // honours the same OTC-ADR / bogus-extPrice check
      // (`extPriceLooksReal` in metrics.js) that the tactics board
      // uses, so SFTBY-shape tickers can't show a phantom +8 % AH
      // move here while the rest of the app correctly says -7.49 %.
      // Reading raw `p.extDayPct` bypassed that gate and was the
      // reason the heatmap kept reporting the bogus number after
      // PR #81 fixed the cards.
      // `dayPctUnknown` means the extended-hours figure doesn't exist
      // for this row yet, not that it's flat. Carried through as a null
      // pct so the tile can say so instead of claiming 0.00%.
      const pct = p.dayPctUnknown ? null : (p.dayPct ?? 0);
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
            // Drop a decimal on tight tiles so the pct still fits next
            // to the ticker — "+15.26%" needs ~30px at 7px mono, but
            // "+15%" fits in ~22px. Without this, BMNR/NET-sized tiles
            // showed the ticker and silently swallowed the day move.
            const pctStr = tile.pct == null
              ? '—'
              : tw < 36
                ? (tile.pct >= 0 ? '+' : '') + Math.round(tile.pct) + '%'
                : (tile.pct >= 0 ? '+' : '') + tile.pct.toFixed(2) + '%';

            const showTicker = tw >= 22 && th >= 16;
            // Drop the pct threshold so medium-small tiles (BMNR / NET
            // etc.) still get their % — previously they showed only the
            // ticker and the user couldn't read the day move at all.
            // Allowed down to 24×22 px; below that we'd be stacking two
            // lines on a tile too small for either to be legible.
            const showPct    = tw >= 24 && th >= 22;
            const { label, fontSize: tickerFs, mid } = fitTicker(displayTicker(tile.ticker), tw, th);
            // Pct text is wider than the ticker (e.g. "+15.26%" is 7
            // chars), so it needs to scale on tile *width* and shrink
            // smaller (down to 7px) than the ticker so both lines stay
            // inside the tile.
            const pctFs    = Math.max(7, Math.min(10, Math.floor(tw / 5)));

            const clickable = typeof onTileClick === 'function';
            return (
              <div
                key={tile.ticker}
                className="hm-tile"
                role={clickable ? 'button' : undefined}
                tabIndex={clickable ? 0 : undefined}
                onClick={clickable ? () => onTileClick(tile.ticker) : undefined}
                onKeyDown={clickable ? (e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onTileClick(tile.ticker);
                  }
                } : undefined}
                title={clickable ? `Open ${tile.ticker} chart` : undefined}
                style={{
                  left:       tile.x + GAP / 2,
                  top:        tile.y + GAP / 2,
                  width:      tw,
                  height:     th,
                  background: bg,
                  cursor:     clickable ? 'pointer' : undefined,
                }}
              >
                {showTicker && (
                  <span className="hm-ticker mono" style={{ color: tickerClr, fontSize: tickerFs + 'px' }}>
                    {label.slice(0, mid)}<wbr />{label.slice(mid)}
                  </span>
                )}
                {showPct && (
                  <span className="hm-pct mono" style={{ color: pctClr, fontSize: pctFs + 'px' }}>
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

// React.memo — same rationale as Pitch: the treemap recomputes its
// binary-split layout + renders a tile per holding, no need to redo
// that on a Board render where neither `metrics` nor `extendedHours`
// changed (e.g. the mobile currency-cycle toggle).
const MemoHeatmap = React.memo(Heatmap);
export { MemoHeatmap as Heatmap };
