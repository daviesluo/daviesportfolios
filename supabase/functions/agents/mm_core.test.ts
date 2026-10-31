// mm_core.ts against rule.py: the committed slice (backtests/cryptobooks/scripts/parity_fixture.py, six hours of XRP-GBP on
// 2026-10-29 with 142 fills under the card and 101 with a 30 bps stop, six of them stops) replayed in TypeScript must give
// rule.sim's fills, one for one (second, side, kind; coins and price to 1e-9 of their size), and its books at the end, run in
// one pass and run a minute at a time with the state saved and read back as JSON between minutes, as the paper arm runs it.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import fx from "../../../docs/agents/backtests/cryptobooks/results/parity_XRP-GBP.json" with { type: "json" };
import { MM_CARD, type MmParams, type MmPrint, type MmState, mmNew, mmRun, mmSortPrints, mmTakerOrders } from "./mm_core.ts";

type Case = { params: Record<string, number | null>; fills: Array<[number, number, number, number, string]>; end: Record<string, number> };
const fixture = fx as unknown as { t0: number; n: number; bn: number[]; rates: Array<[number, number]>; prints: Array<[number, number, number, number]>;
  quote_from: number; to: number; cases: Record<string, Case> };

const F = (s: number): number | null => {
  const i = s - fixture.t0;
  if (i < 0 || i >= fixture.n) return null;
  const [u, g] = fixture.rates[Math.floor(i / 60)];
  return fixture.bn[i] * (u / g);
};
const bySec = new Map<number, MmPrint[]>();
for (const [ms, price, qty, side] of fixture.prints) {
  const s = Math.floor(ms / 1000);
  const a = bySec.get(s) ?? [];
  a.push({ ms, price, qty, side: side > 0 ? 1 : -1 });
  bySec.set(s, a);
}
const prints = (s: number) => bySec.get(s) ?? [];

function paramsOf(c: Case): MmParams {
  const p = c.params;
  return { dBps: Number(p.d_min), thetaBps: Number(p.theta), kappa: Number(p.kappa), qGbp: Number(p.Q), capGbp: Number(p.cap), xArbBps: Number(p.x_arb),
    stopBps: p.stop == null ? null : Number(p.stop), exitSlipBps: Number(p.exit_slip), cooldownS: Number(p.cooldown), restLagS: Number(p.rest_lag),
    trailS: 3 * 3600 };
}

function check(name: string, c: Case, st: MmState, fills: Array<{ sec: number; side: number; qty: number; price: number; kind: string }>) {
  assertEquals(fills.length, c.fills.length, `${name}: fills`);
  c.fills.forEach(([sec, side, qty, price, kind], i) => {
    const f = fills[i];
    assertEquals([f.sec, f.side, f.kind], [sec, side, kind], `${name}: fill ${i}`);
    assert(Math.abs(f.qty - qty) <= 1e-9 * Math.max(1, qty), `${name}: fill ${i} coins ${f.qty} vs ${qty}`);
    assert(Math.abs(f.price - price) <= 1e-9 * price, `${name}: fill ${i} price ${f.price} vs ${price}`);
  });
  assert(Math.abs(st.cash - c.end.cash) < 1e-6, `${name}: cash ${st.cash} vs ${c.end.cash}`);
  assert(Math.abs(st.coin - c.end.coin) < 1e-9, `${name}: coin ${st.coin} vs ${c.end.coin}`);
  assert(Math.abs(st.cost - c.end.cost) < 1e-6, `${name}: cost`);
  assertEquals([st.placed, st.cancels, st.stops], [c.end.placed, c.end.cancels, c.end.stops], `${name}: placed, cancels, stops`);
}

Deno.test("mm_core — the card is rule.py's xrp_study.CARD with final_card.FINAL", () => {
  const p = paramsOf(fixture.cases.card);
  assertEquals(p, MM_CARD);
});

for (const [name, c] of Object.entries(fixture.cases)) {
  Deno.test(`mm_core — rule.sim's fills on the committed slice, one pass (${name})`, () => {
    const p = paramsOf(c), st = mmNew(p);
    const out = mmRun(st, p, fixture.t0, fixture.to, F, prints, fixture.quote_from);
    check(name, c, st, out.fills);
  });
  Deno.test(`mm_core — the same, a minute at a time through JSON (${name})`, () => {
    const p = paramsOf(c);
    let st = mmNew(p);
    const fills = [];
    for (let a = fixture.t0; a < fixture.to; a += 60) {
      const out = mmRun(st, p, a, Math.min(a + 60, fixture.to), F, prints, fixture.quote_from);
      fills.push(...out.fills);
      st = JSON.parse(JSON.stringify(st));
    }
    check(name, c, st, fills);
  });
}

Deno.test("mm_core — a missing second of the fair cancels what rests and quotes nothing until it is back", () => {
  const p = MM_CARD, st = mmNew(p);
  const gap = fixture.quote_from + 3600;
  const G = (s: number) => (s >= gap && s < gap + 5 ? null : F(s));
  const out = mmRun(st, p, fixture.t0, gap + 3, G, prints, fixture.quote_from);
  assertEquals([st.bid, st.ask], [null, null]);
  assert(out.seconds.at(-1)!.stale);
  mmRun(st, p, gap + 3, gap + 8, G, prints, fixture.quote_from);
  assert(st.bid != null, "quotes again once the fair is back");
});

Deno.test("mm_core — taker orders: one ms and side, a buy's prints lowest first and a sell's highest first", () => {
  const ps = mmSortPrints([
    { ms: 5, price: 1.02, qty: 1, side: 1 }, { ms: 5, price: 1.01, qty: 2, side: 1 }, { ms: 5, price: 0.99, qty: 3, side: -1 },
    { ms: 5, price: 0.98, qty: 4, side: -1 }, { ms: 6, price: 1.0, qty: 5, side: 1 },
  ]);
  const o = mmTakerOrders(ps);
  // sorted by price first, as rule.py's tuples: the sells (0.98, 0.99) come before the buys at one ms
  assertEquals(o.map((x) => [x.ms, x.side, x.prints]), [
    [5, -1, [[0.99, 3], [0.98, 4]]], [5, 1, [[1.01, 2], [1.02, 1]]], [6, 1, [[1.0, 5]]],
  ]);
});
