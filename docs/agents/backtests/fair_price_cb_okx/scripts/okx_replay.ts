// The OKX twins' own engine (`stepOkxMinute`, supabase/functions/agents/okx_quotes.ts, imported read-only and called unchanged)
// replayed on the recorded tape with each candidate fair (okx_replay_prep.py writes the inputs). LIVE's "at" fill by the
// print's size, the post-only refusal against the recorded book (or the last print where no book was recorded, before
// 2026-10-28 19:53), the 24-hour stop, the de-peg guard. The account's daily loss stop is left out (it never fired on the
// record), and the rung is €50 as before the dollar switch. A candidate is passed as the EUR/USD that gives its fair.
// usage (from the repository root): deno run --allow-read --allow-write docs/agents/backtests/fair_price_cb_okx/scripts/okx_replay.ts IN.json OUT.json
import { newOkxBookState, okxTouchAt, stepOkxMinute, type OkxBook, type OkxTapePrint, type OkxTouch } from "../../../../../supabase/functions/agents/okx_quotes.ts";

const M = 60e3;
type Book = { t0: number; minutes: number[]; gbpusd: Array<number | null>; cands: Record<string, Array<number | null>>; tick: number; prints: Array<[number, number, number, string, number]>; touches: OkxTouch[] };
const [inPath, outPath] = Deno.args;
const data = JSON.parse(await Deno.readTextFile(inPath)) as Record<OkxBook, Book>;
const out: Record<string, unknown> = {};
for (const [book, d] of Object.entries(data) as Array<[OkxBook, Book]>) {
  const prints: OkxTapePrint[] = d.prints.map(([ts, ticks, qty, side, id]) => ({ ts, ticks, qty, side: side === "buy" ? "buy" : "sell", id }));
  for (const [name, xs] of Object.entries(d.cands)) {
    const s = newOkxBookState(book);
    const trips: unknown[] = [];
    let j = 0, orders = 0, refused = 0, fills = 0;
    const guards: Record<string, number> = {};
    d.minutes.forEach((t, i) => {
      const mine: OkxTapePrint[] = [];
      while (j < prints.length && prints[j].ts < t + M) { if (prints[j].ts >= t) mine.push(prints[j]); j++; }
      const r = stepOkxMinute(s, t, { eurusd: xs[i], gbpusd: d.gbpusd[i], prints: mine, touchStart: okxTouchAt(d.touches, t), touchEnd: okxTouchAt(d.touches, t + M - 1) });
      orders += r.orders;
      refused += r.events.filter((e) => e.kind === "refused").length;
      fills += r.events.filter((e) => e.kind === "fill").length;
      if (r.guard) guards[r.guard] = (guards[r.guard] ?? 0) + 1;
      for (const x of r.trips) trips.push([x.tEntry, x.tExit, x.side, x.k, x.entry, x.qty, x.exit, x.how, x.pnlQuote]);
    });
    const open = s.rungs.filter((r) => r.mode === "position").map((r) => [r.side, r.k, r.tEntry, r.entry, r.qty]);
    out[`${book}|${name}`] = { orders, refused, fills, guards, trips, open };
  }
}
await Deno.writeTextFile(outPath, JSON.stringify(out));
console.log(Object.fromEntries(Object.entries(out).map(([k, v]) => {
  const tr = (v as { trips: Array<[number, number, string, number, number, number, number, string, number]> }).trips;
  return [k, { trips: tr.length, pnlQuote: Number(tr.reduce((a, x) => a + x[8], 0).toFixed(4)), fills: (v as { fills: number }).fills, open: (v as { open: unknown[] }).open.length }];
})));
