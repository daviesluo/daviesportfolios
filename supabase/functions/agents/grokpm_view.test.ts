// Pins "Polymarket analyst"'s page figures (grokpm_view.ts) against a record worked out by hand at the browser
// sweep's clock (`src/e2e/grokpm_fixture.json`, which the sweep serves as the dashboard's `grokPm`): the fixture's `output`
// is the function's answer for its `input`, and every figure the page shows is checked against the arithmetic below, not
// against another part of the code.
//
// The record by hand. FUNDED $100 from 2026-09-16 10:05 UTC. Cash: 100 − 10 × 0.70 (333) − 15 × 0.31 (444) + 15 × 0.25
// (444 sold) − 25 × 0.60 (222) − 20 × 0.40 (111) = $69.10. Held at 22:55: 111 20 at the mid 0.46 = $9.20, 222 25 at 0.56 =
// $14.00, 333 10 redeemable at its payout 1 = $10.00: $33.20. Equity $102.30, total +$2.30. Unrealised: 20 × (0.46 − 0.40)
// + 25 × (0.56 − 0.60) = +$0.20 (333 is redeemable: settled, not unrealised). Realised +$2.10 = 333's 10 × 0.30 + 444's
// 15 × (0.25 − 0.31). Cost of what it holds 8 + 15 + 7 = $30. The day: 09-17 opened at $101.60 (cash 92.10 + 333 at 0.95),
// so today +$0.70 and 09-16 +$1.60 (from FUNDED), which add up to the total. Stop room: 30 + 2.30 = $32.30, 10 + 0.70 =
// $10.70. Brier on the two resolved entries: the agent (0.90 − 1)² and (0.45 − 0)², mean 0.10625; the market (0.72 − 1)²
// and (0.30 − 0)², mean 0.0842. The agent's last cycle says $69.10 + $31.00 = $100.10 and +$0.10 where the record at its
// slot says $102.30 and +$2.30: a mismatch. Its 09-16 summary says +$1.50 against the record's +$1.60: within $1.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import fixture from "../../../src/e2e/grokpm_fixture.json" with { type: "json" };
import { brierOf, GROKPM_MISMATCH_USD, grokPmSummary, marketUrl, safeLinks } from "./grokpm_view.ts";

// deno-lint-ignore no-explicit-any
const input = fixture.input as any;
const close = (a: number | null | undefined, b: number) => assert(a !== null && a !== undefined && Math.abs(a - b) < 1e-9, `${a} ≠ ${b}`);

// The waiting state: the same account before the go, in dry-run, its journal already filling (as the agent rehearses).
const waitingInput = { ...input, config: { ...input.config, started_at: null, dry_run: true, armed_at: null }, latest: null, dayOpens: [], cycle: null, cycleSnap: null, daily: [], entries: [], resolutions: [], opens: [], recState: { updated_at: null, last_error: null } };

Deno.test("the fixture's output is the function's answer for its input, and its waiting state likewise", () => {
  assertEquals(grokPmSummary(input) as unknown, fixture.output);
  assertEquals(grokPmSummary(waitingInput) as unknown, fixture.waiting);
});

Deno.test("every figure matches the arithmetic worked by hand", () => {
  const o = grokPmSummary(input)!;
  close(o.fundedUsd, 100); close(o.equityUsd, 102.3); close(o.cashUsd, 69.1); close(o.positionsValueUsd, 33.2);
  close(o.totalUsd, 2.3); close(o.todayUsd, 0.7); close(o.unrealisedUsd, 0.2); close(o.realisedUsd, 2.1); close(o.costUsd, 30);
  close(o.stop.totalRoomUsd, 32.3); close(o.stop.dayRoomUsd, 10.7);
  assertEquals([o.stop.totalTripped, o.stop.dayTripped], [false, false]);
  close(o.status.brierAgent, 0.10625); close(o.status.brierMarket, 0.0842);
  assertEquals([o.status.open, o.status.scored, o.status.resolved], [2, 2, 2]);
  assertEquals(o.days.map((d) => [d.day, d.recordUsd, d.agentUsd, d.mismatch]), [["2026-09-17", 0.7, null, false], ["2026-09-16", 1.6, 1.5, false]]);
  close(o.days.reduce((s, d) => s + Number(d.recordUsd), 0), o.totalUsd);
  assertEquals(o.cycle, { ts: "2026-09-17T22:31:00.000Z", kind: "light", actions: 0, openPositions: 3, agentEquityUsd: 100.1, agentPnlUsd: 0.1, recordEquityUsd: 102.3, recordPnlUsd: 2.3, mismatch: true });
  assertEquals(o.mismatch, true);
  assertEquals(o.running, true);
  // The account's address never reaches the page (D2): only the order path's mode.
  assertEquals(["wallet" in o, o.mode, fixture.waiting.mode], [false, "live", "dry_run"]);
  // The journal: newest first, and only http(s) links.
  assertEquals(o.journal.map((j) => j.id), ["d-6", "d-5", "d-4", "d-3", "d-2", "d-1", "x-2", "x-1"]);
  assertEquals(o.journal[5].sources, ["https://www.senate.gov/legislative/votes.htm"]);
  assertEquals(o.journal[0].title, null);
});

Deno.test("journal titles: Gamma's (0126) with its link, else the record's own unlinked, else none; never the condition id", () => {
  const o = grokPmSummary(input)!;
  assertEquals(o.journal.map((j) => [j.id, j.title, j.url]), [
    ["d-6", null, null],
    ["d-5", "Will the Fed cut rates in October?", "https://polymarket.com/market/will-the-fed-cut-rates-in-october"],
    // Not in grokpm_markets: the title of the market it holds, from the record, and no link.
    ["d-4", "Will the bill be signed by September 30?", null],
    // In grokpm_markets without a slug: its title, no link.
    ["d-3", "Will the summit take place by September 17?", null],
    ["d-2", "Will the summit take place by September 17?", null],
    ["d-1", "Will the nominee be confirmed?", "https://polymarket.com/market/will-the-nominee-be-confirmed"],
    // A market it never held (the "0xdf9bf27e…" of 2026-10-17): titled only by Gamma's row.
    ["x-2", "Will there be no change in Fed interest rates after the October 2026 meeting?", "https://polymarket.com/market/will-there-be-no-change-in-fed-interest-rates-after-the-october-2026-meeting"],
    // Named nowhere yet: no title, and the page says it is pending.
    ["x-1", null, null],
  ]);
  for (const j of [...o.journal, ...fixture.waiting.journal]) assert(!/0x[0-9a-f]{6}/i.test(String(j.title ?? "") + String(j.url ?? "")), j.id);
  // The old page found titles only among what the agent held: without grokpm_markets x-2 has none.
  assertEquals(grokPmSummary({ ...input, markets: undefined })!.journal[6].title, null);
  // A condition id written in capitals is the same market.
  const upper = grokPmSummary({ ...input, decisions: [{ ...input.decisions[6], market_id: input.decisions[6].market_id.toUpperCase().replace("0X", "0x") }] })!;
  assertEquals(upper.journal[0].url, o.journal[6].url);
  // In dry-run, before any entry, Gamma's titles still name the journal's markets; d-4's market has none yet.
  assertEquals(fixture.waiting.journal.map((j) => j.title === null), [true, false, true, false, false, false, false, true]);
  // A position the record holds without a title takes Gamma's.
  const untitled = grokPmSummary({ ...input, latest: { ...input.latest, positions: input.latest.positions.map((p: Record<string, unknown>) => ({ ...p, title: null })) } })!;
  assertEquals(untitled.positions.map((p) => p.title).sort(), ["", "Will the Fed cut rates in October?", "Will the nominee be confirmed?"]);
  // A slug is linked only in Polymarket's shape.
  assertEquals([marketUrl("will-a-b"), marketUrl("../x"), marketUrl("a b"), marketUrl(null), marketUrl("")], ["https://polymarket.com/market/will-a-b", null, null, null, null]);
});

Deno.test("its fees: each counted fill from the go, none before it and none failed, and 0 before the go", () => {
  // The fixture's fills: $0.30 before the go and $0.50 on a FAILED fill, neither counted; its own fills paid nothing.
  assertEquals([grokPmSummary(input)!.feesUsd, fixture.output.feesUsd, fixture.waiting.feesUsd], [0, 0, 0]);
  const fills = [...input.fills, { fee_usd: "0.12", status: "CONFIRMED", match_time: "2026-09-17T15:00:00.000Z" }, { fee_usd: 0.03, status: "RETRYING", match_time: "2026-09-17T16:00:00.000Z" }];
  close(grokPmSummary({ ...input, fills })!.feesUsd, 0.15);
  assertEquals(grokPmSummary({ ...waitingInput, fills })!.feesUsd, 0);
  assertEquals(grokPmSummary({ ...input, fills: undefined })!.feesUsd, 0);
});

Deno.test("a day the agent misreports by more than $1 is flagged; within $1 it is not", () => {
  const off = grokPmSummary({ ...input, daily: [{ ...input.daily[0], pnl_day_usd: 1.6 - GROKPM_MISMATCH_USD - 0.01 }], cycle: null })!;
  assertEquals(off.days[1].mismatch, true);
  assertEquals(off.mismatch, true);
  const on = grokPmSummary({ ...input, daily: [{ ...input.daily[0], pnl_day_usd: 1.6 - GROKPM_MISMATCH_USD + 0.01 }], cycle: null })!;
  assertEquals(on.mismatch, false);
});

Deno.test("the stops' room: a total of −$30 trips the total stop, a day of −$10 the day's", () => {
  const down = grokPmSummary({ ...input, latest: { ...input.latest, equity_usd: 70 } })!;
  close(down.totalUsd, -30); assertEquals(down.stop.totalTripped, true); close(down.stop.totalRoomUsd, 0);
  close(down.todayUsd, 70 - 101.6); assertEquals(down.stop.dayTripped, true);
});

Deno.test("nothing before the wallet; before the go the record counts nothing, and the budget it is given is $100", () => {
  assertEquals(grokPmSummary({ ...input, config: { ...input.config, wallet: null } }), null);
  const w = fixture.waiting;
  assertEquals([w.started, w.fundedUsd, w.totalUsd, w.todayUsd, w.realisedUsd, w.unrealisedUsd, w.days.length, w.running], [false, null, 0, 0, 0, 0, 0, false]);
  // FUNDED on the page and the LIVE row (Davies, 2026-10-17: "明确目前funded就是100美元") is this configured budget.
  assertEquals([w.configuredFundedUsd, w.mode], [100, "dry_run"]);
});

Deno.test("Brier takes the agent's last open before the first fill, and the record's mid, else the agent's m", () => {
  const entries = [{ asset: "9", cond: "c", title: null, first_seen_at: "2026-09-16T12:00:00Z", first_fill_at: "2026-09-16T11:00:00Z", mid: null }];
  const resolutions = [{ cond: "c", tokens: ["9", "8"], payouts: [1, 0] }];
  const opens = [
    { id: "a", ts: "2026-09-16T10:00:00Z", token_id: "9", p: 0.6, m: 0.5, category: "B" },
    { id: "b", ts: "2026-09-16T10:30:00Z", token_id: "9", p: 0.7, m: 0.55, category: "B" },
    { id: "c", ts: "2026-09-16T13:00:00Z", token_id: "9", p: 0.99, m: 0.9, category: "C" },
  ];
  const b = brierOf(entries, resolutions, opens);
  assertEquals(b.n, 1);
  close(b.agent, 0.09); close(b.market, 0.2025);
  assertEquals(b.scored[0].mFrom, "agent");
  assertEquals(brierOf(entries, [], opens).n, 0);
});

Deno.test("links", () => {
  assertEquals(safeLinks(["https://a.b/c", "ftp://x", "javascript:alert(1)", 3, "http://ok.example/"]), ["https://a.b/c", "http://ok.example/"]);
  assertEquals(safeLinks("https://a.b"), []);
});
