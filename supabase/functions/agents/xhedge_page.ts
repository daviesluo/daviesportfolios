// "Stablecoin quotes RX↔Coinbase hedge" and "… - 1" on the page, each venue's half apart (Davies, 2026-10-30 ~03:30 UTC: "…两个新策略在
// venue列两个币所都加上，funded和deployed资金按两个币所实际的来，盈利状况也一样", then ~03:45: "…VENUES不要把两个单独新开一个放一起，按实际两个
// 币所的funded和deployed和营收分别放在两个各自的里面去"). The engine and its view (xhedge.ts) are frozen by the test's pre-registration, so
// the page's money is worked out here from what that view sends and from the arm's trips. Each venue's half:
//   - FUNDED: its money for every book (`XH_VENUE_GBP` a venue a book, the engine's own setting);
//   - DEPLOYED: what is at work there, the page's definition for every Stablecoin quotes row: on Revolut X the coin it holds at
//     Revolut X's mid and the pounds resting in its bids; on Coinbase the coin it holds (Coinbase rests nothing: its hedges take);
//   - REALIZED, by each leg of every round trip, the hedge's price as the line between them: Revolut X's leg made what the trip
//     made before Coinbase's fee (it bought or sold at its own price against the Coinbase trade's), and Coinbase's leg paid the
//     fee (it traded at the market's price); the two sum to the trip's P&L to the bit;
//   - UNREALIZED: what the venue holds now (pounds, and coin at Revolut X's mid; a book not open yet at its funding) less its FUNDED
//     less its REALIZED. One venue holds the coin the other sold, so these mostly offset;
//   - TODAY: what the venue holds now less what it held at the last minute before 00:00 UTC (FUNDED on the arm's first day; the
//     trips closed today, split the same way, when 00:00 has no balances).
// The arm's row and page show the two halves summed, so Revolut X's half plus Coinbase's is the arm exactly; each percent is on
// FUNDED. The halves go out as `byVenue`, for the page's lines under its scoreboard and each venue's card.
import type { Db } from "./db.ts";
import { XH_ARMS, XH_BOOKS, XH_TABLES, XH_VENUE_GBP, readXhedge, xhView } from "./xhedge.ts";

export type XhView = NonNullable<ReturnType<typeof xhView>>;
/** The venues an arm's money is on, in the order the page names them. */
export const XH_VENUES = ["revx", "coinbase"] as const;
export type XhVenue = typeof XH_VENUES[number];
const VENUE_NAME: Record<XhVenue, string> = { revx: "Revolut X", coinbase: "Coinbase" };

/** A book's balances after a minute, as `agent_xhedge_minutes` keeps them. */
export type XhOpenRow = { book: string; rx_bid: number | null; rx_ask: number | null; rx_gbp: number; rx_coin: number; cb_gbp: number; cb_coin: number };
/** A round trip as the page needs it. */
export type XhTripMoney = { pnl_gbp: number; fee_gbp: number; t_hedge: string };

/** What each venue holds at a minute's balances, coin at that minute's Revolut X mid; null when a book has no mid. */
export function xhHeldAt(rows: XhOpenRow[]): Record<XhVenue, number> | null {
  const held = { revx: 0, coinbase: 0 };
  for (const r of rows) {
    if (r.rx_bid == null || r.rx_ask == null) return null;
    const mid = (Number(r.rx_bid) + Number(r.rx_ask)) / 2;
    held.revx += Number(r.rx_gbp) + Number(r.rx_coin) * mid;
    held.coinbase += Number(r.cb_gbp) + Number(r.cb_coin) * mid;
  }
  return held;
}

/** Each venue's realised from a set of trips: Revolut X's leg each trip's P&L before Coinbase's fee, Coinbase's leg less the fee. */
export function xhRealisedByVenue(trips: XhTripMoney[]): Record<XhVenue, number> {
  let revx = 0, coinbase = 0;
  for (const t of trips) { revx += Number(t.pnl_gbp) + Number(t.fee_gbp); coinbase -= Number(t.fee_gbp); }
  return { revx, coinbase };
}

/**
 * An arm's view with its money split by venue and summed back (the file's head says how). `open` is the arm's balances at the last
 * minute before `dayStartMs`, a row a book; empty or partial when the arm had not opened every book by then. `trips` is every trip.
 */
export function xhPageMoney(v: XhView, open: XhOpenRow[], dayStartMs: number, trips: XhTripMoney[]) {
  const assets = v.detail.inventory.assets as Array<{ asset: string; amount: number; gbp?: number }>;
  const coinOf = (b: string) => b.split("-")[0];
  // A book not open yet holds its funding on each venue, as the view counts it.
  const notOpen = XH_BOOKS.filter((b) => !assets.some((a) => a.asset.startsWith(`${coinOf(b)} · `))).length;
  const realised = xhRealisedByVenue(trips);
  const realisedToday = xhRealisedByVenue(trips.filter((t) => Date.parse(t.t_hedge) >= dayStartMs));
  const openHeld = Date.parse(v.twin.startedAt) >= dayStartMs ? null : open.length === XH_BOOKS.length ? xhHeldAt(open) : null;
  const firstDay = Date.parse(v.twin.startedAt) >= dayStartMs;
  const rate = Number(v.capitalUsd) > 0 && Number(v.capitalGbp) > 0 ? Number(v.capitalUsd) / Number(v.capitalGbp) : null;
  const usd = (gbp: number) => (rate == null ? 0 : gbp * rate);
  const fees = trips.reduce((s, t) => s + Number(t.fee_gbp), 0);
  const half = (id: XhVenue) => {
    const name = VENUE_NAME[id];
    const on = assets.filter((a) => a.asset.endsWith(`· ${name}`));
    const gbp = on.filter((a) => a.asset.startsWith("GBP")).reduce((s, a) => s + Number(a.amount), 0);
    const coinGbp = on.filter((a) => !a.asset.startsWith("GBP")).reduce((s, a) => s + (Number(a.gbp) || 0), 0);
    // Bids rest on Revolut X; Coinbase only takes.
    const restingGbp = id === "revx"
      ? (v.detail.orders as Array<{ side: string; price: number; base: number | null }>).filter((o) => o.side === "bid").reduce((s, o) => s + Number(o.price) * (Number(o.base) || 0), 0)
      : 0;
    const capitalGbp = XH_VENUE_GBP * XH_BOOKS.length;
    const heldGbp = gbp + coinGbp + notOpen * XH_VENUE_GBP;
    const realisedGbp = realised[id];
    const todayGbp = firstDay ? heldGbp - capitalGbp : openHeld ? heldGbp - openHeld[id] : realisedToday[id];
    const deployedGbp = coinGbp + restingGbp;
    const unrealisedGbp = heldGbp - capitalGbp - realisedGbp;
    const feesGbp = id === "coinbase" ? fees : 0;
    return {
      id, name, gbp, coinGbp, restingGbp, heldGbp, capitalGbp, deployedGbp, realisedGbp, unrealisedGbp, todayGbp, feesGbp,
      capitalUsd: usd(capitalGbp), deployedUsd: usd(deployedGbp), realisedUsd: usd(realisedGbp), unrealisedUsd: usd(unrealisedGbp),
      todayUsd: usd(todayGbp), feesUsd: usd(feesGbp),
    };
  };
  const byVenue = XH_VENUES.map(half);
  const [rx, cb] = byVenue;
  const sum = (k: keyof typeof rx) => Number(rx[k]) + Number(cb[k]);
  const money = (n: number) => `£${Math.abs(n).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const signed = (n: number) => `${n < 0 ? "−" : "+"}${money(n)}`;
  return {
    ...v,
    capitalGbp: sum("capitalGbp"), costGbp: sum("capitalGbp"), valueGbp: sum("deployedGbp"), heldGbp: sum("heldGbp"),
    realisedGbp: sum("realisedGbp"), unrealisedGbp: sum("unrealisedGbp"), todayGbp: sum("todayGbp"), feesGbp: sum("feesGbp"),
    capitalUsd: sum("capitalUsd"), costUsd: sum("capitalUsd"), valueUsd: sum("deployedUsd"), realisedUsd: sum("realisedUsd"),
    unrealisedUsd: sum("unrealisedUsd"), todayUsd: sum("todayUsd"), feesUsd: sum("feesUsd"),
    venues: [...XH_VENUES],
    byVenue,
    twin: {
      ...v.twin,
      // A line a venue under the scoreboard: its half of the arm (masked on the page with the other figures).
      venueNotes: byVenue.map((x) => `${x.name}: ${money(x.capitalGbp)} funded, ${money(x.deployedGbp)} deployed (coin ${money(x.coinGbp)}${x.id === "revx" ? `, resting bids ${money(x.restingGbp)}` : ""}); realised ${signed(x.realisedGbp)}, unrealised ${signed(x.unrealisedGbp)}, today ${signed(x.todayGbp)}`),
    },
  };
}

/** The page's reader: each arm's view (`readXhedge`) with its money split by venue. */
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
    const trips = await d.selectAll<XhTripMoney>(XH_TABLES.trips, `arm=eq.${arm}&select=pnl_gbp,fee_gbp,t_hedge&order=arm.asc,book.asc,side.asc,t_fill.asc,t_hedge.asc`);
    out.push(xhPageMoney(v, open, dayStartMs, trips));
  }
  return out;
}
