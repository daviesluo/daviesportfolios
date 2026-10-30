// "Stablecoin quotes RX↔Coinbase hedge" and "… - 1" on the page, across both venues (Davies, 2026-10-30 ~03:30 UTC: "“Stablecoin quotes
// RX↔Coinbase hedge”的两个新策略在venue列两个币所都加上，funded和deployed资金按两个币所实际的来，盈利状况也一样"). The engine and its view
// (xhedge.ts) are frozen by the test's pre-registration, so the page's money is worked out here from what that view sends:
//   - FUNDED: each venue's money for every book (`XH_VENUE_GBP` a venue a book, the engine's own setting), both venues together;
//   - DEPLOYED: what is at work on both venues, the page's definition for every Stablecoin quotes row: the coin held on Revolut X
//     and on Coinbase at Revolut X's mid, and the pounds resting in Revolut X bids (Coinbase rests nothing: its hedges take);
//   - REALIZED: every round trip, both legs (the Revolut X fill and its Coinbase hedge) and Coinbase's fee (Revolut X's maker
//     fee is 0 %); UNREALIZED: what both venues hold (pounds, and coin at the mid) less FUNDED less REALIZED; TODAY: what both
//     venues hold now less what they held at the last minute before 00:00 UTC (FUNDED on the arm's first day), so it is
//     realised today plus the coin's move; each percent on FUNDED.
// Each venue's FUNDED and DEPLOYED also go out apart (`byVenue`), for the page's lines under its scoreboard.
import type { Db } from "./db.ts";
import { XH_ARMS, XH_BOOKS, XH_TABLES, XH_VENUE_GBP, readXhedge, xhView } from "./xhedge.ts";

export type XhView = NonNullable<ReturnType<typeof xhView>>;
/** The venues an arm's money is on, in the order the page names them. */
export const XH_VENUES = ["revx", "coinbase"] as const;
const VENUE_NAME: Record<typeof XH_VENUES[number], string> = { revx: "Revolut X", coinbase: "Coinbase" };

/** A book's balances after a minute, as `agent_xhedge_minutes` keeps them. */
export type XhOpenRow = { book: string; rx_bid: number | null; rx_ask: number | null; rx_gbp: number; rx_coin: number; cb_gbp: number; cb_coin: number };

/** What both venues hold at a minute's balances, coin at that minute's Revolut X mid; null when a book has no mid. */
export function xhHeldAt(rows: XhOpenRow[]): number | null {
  let held = 0;
  for (const r of rows) {
    if (r.rx_bid == null || r.rx_ask == null) return null;
    const mid = (Number(r.rx_bid) + Number(r.rx_ask)) / 2;
    held += Number(r.rx_gbp) + Number(r.cb_gbp) + (Number(r.rx_coin) + Number(r.cb_coin)) * mid;
  }
  return held;
}

/**
 * An arm's view with its money across both venues (the file's head says how). `open` is the arm's balances at the last minute
 * before `dayStartMs`, a row a book; empty or partial when the arm had not opened every book by then.
 */
export function xhPageMoney(v: XhView, open: XhOpenRow[], dayStartMs: number) {
  const assets = v.detail.inventory.assets as Array<{ asset: string; amount: number; gbp?: number }>;
  const on = (venue: string) => assets.filter((a) => a.asset.endsWith(`· ${venue}`));
  const venue = (id: typeof XH_VENUES[number]) => {
    const name = VENUE_NAME[id];
    const gbp = on(name).filter((a) => a.asset.startsWith("GBP")).reduce((s, a) => s + Number(a.amount), 0);
    const coinGbp = on(name).filter((a) => !a.asset.startsWith("GBP")).reduce((s, a) => s + (Number(a.gbp) || 0), 0);
    // Bids rest on Revolut X; Coinbase only takes.
    const restingGbp = id === "revx"
      ? (v.detail.orders as Array<{ side: string; price: number; base: number | null }>).filter((o) => o.side === "bid").reduce((s, o) => s + Number(o.price) * (Number(o.base) || 0), 0)
      : 0;
    return { id, name, capitalGbp: XH_VENUE_GBP * XH_BOOKS.length, gbp, coinGbp, restingGbp, deployedGbp: coinGbp + restingGbp };
  };
  const byVenue = XH_VENUES.map(venue);
  const capitalGbp = byVenue.reduce((s, x) => s + x.capitalGbp, 0);
  const deployedGbp = byVenue.reduce((s, x) => s + x.deployedGbp, 0);
  // What both venues hold now: xhView's valueGbp (every pound and coin of both venues, a book not open yet at its funding).
  const heldGbp = Number(v.valueGbp);
  const started = Date.parse(v.twin.startedAt);
  const openHeld = started >= dayStartMs ? capitalGbp : open.length === XH_BOOKS.length ? xhHeldAt(open) : null;
  // No balances for 00:00 (the record dark at the day's open): today falls back to the trips closed today.
  const todayGbp = openHeld == null ? Number(v.todayGbp) : heldGbp - openHeld;
  const rate = Number(v.capitalUsd) > 0 && Number(v.capitalGbp) > 0 ? Number(v.capitalUsd) / Number(v.capitalGbp) : null;
  const usd = (gbp: number) => (rate == null ? 0 : gbp * rate);
  const money = (n: number) => `£${n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return {
    ...v,
    capitalGbp, costGbp: capitalGbp, valueGbp: deployedGbp, heldGbp, todayGbp,
    capitalUsd: usd(capitalGbp), costUsd: usd(capitalGbp), valueUsd: usd(deployedGbp), todayUsd: usd(todayGbp),
    venues: [...XH_VENUES],
    byVenue: byVenue.map((x) => ({ ...x, capitalUsd: usd(x.capitalGbp), deployedUsd: usd(x.deployedGbp) })),
    twin: {
      ...v.twin,
      // A line a venue under the scoreboard: its funding and what is at work there (masked on the page with the other figures).
      venueNotes: byVenue.map((x) => `${x.name}: ${money(x.capitalGbp)} funded, ${money(x.deployedGbp)} deployed (coin ${money(x.coinGbp)}${x.id === "revx" ? `, resting bids ${money(x.restingGbp)}` : ""})`),
    },
  };
}

/** The page's reader: each arm's view (`readXhedge`) with its money across both venues. */
export async function readXhedgePage(d: Db, now: number, dayStartMs: number) {
  const views = await readXhedge(d, now, dayStartMs);
  const out = [];
  for (const v of views) {
    const arm = XH_ARMS.find((a) => a.id === v.twin.id)?.arm ?? "inside";
    let open: XhOpenRow[] = [];
    try {
      open = await d.select<XhOpenRow>(XH_TABLES.minutes,
        `arm=eq.${arm}&minute=eq.${encodeURIComponent(new Date(dayStartMs - 60e3).toISOString())}&select=book,rx_bid,rx_ask,rx_gbp,rx_coin,cb_gbp,cb_coin`);
    } catch { /* today falls back to the trips closed today */ }
    out.push(xhPageMoney(v, open, dayStartMs));
  }
  return out;
}
