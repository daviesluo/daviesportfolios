// The reading of "Stablecoin quotes variant-3" (`take50wk`) against variant-2 (`take50`):
// docs/agents/reviews/2026-10-18-revx-weekend-prereg.md §3, frozen with it. Each twin's round trips are the page's own
// (`liveRungs`, `liveRungTrips` of agents/index.ts, as the Agents page and scq_review/*/scripts/page_pnl.ts compute them),
// from the orders `sql/export.sql` exports; then the bars.
//
//   npx --yes deno@1.46.3 run --allow-read --allow-write --allow-env --no-check scripts/read.ts <data dir> <out.json>
//   … read.ts --dry <data dir> <out.json>   (the dry run: p50 as "variant-3", take50 as its control, over whatever span the
//                                             data holds, only to show the script runs; no bar is read from it)
import { liveRungs, liveRungTrips, type QuoteLiveOrderView } from "../../../../../supabase/functions/agents/index.ts";

const args = [...Deno.args];
const dry = args[0] === "--dry";
if (dry) args.shift();
const [dataDir, outFile] = args;
if (!dataDir || !outFile) throw new Error("usage: read.ts [--dry] <data dir> <out.json>");

const H = 3600e3, DAY = 24 * H;
/** The window (§3): trips entered from the rule's first minute to the Monday after PR5-W's eighth forward weekend. */
const FROM = dry ? Date.parse("2026-10-09T21:00:00Z") : Date.parse("2026-10-23T21:00:00Z");
const TO = dry ? Date.parse("2026-10-12T00:00:00Z") : Date.parse("2026-11-23T00:00:00Z");
/** Bar 3: no whole weekend's difference below this, in pounds (§3). */
const WORST_GBP = -1.5;
/** Bar 4: the best weekend at most this share of the summed difference. */
const BEST_SHARE = 0.6;
const ARMS = dry ? { treat: "p50", ctrl: "take50" } : { treat: "take50wk", ctrl: "take50" };

const meta = JSON.parse(await Deno.readTextFile(`${dataDir}/meta.json`));
type Trip = ReturnType<typeof liveRungTrips>[number];
function tripsOf(id: string): Trip[] {
  const p = JSON.parse(Deno.readTextFileSync(`${dataDir}/agent_quote_twin_${id}_orders.json`));
  const orders: Array<QuoteLiveOrderView & Record<string, unknown>> = p.rows.map((r: unknown[]) => ({
    id: r[0], ts: r[1], mode: r[2], book: r[3], rung_side: r[4], k: r[5], leg: r[6], side: r[7], state: r[8], base_size: r[9],
    filled_base: r[10], avg_fill_price: r[11], price: r[12], fee_gbp: r[13], filled_at: r[14], not_sent: r[15],
    paper_oid: r[16], paper_live: r[17], fair: r[18], take: r[19] === true,
  }));
  const I = meta.inst[id];
  const dayStart = Math.floor(Date.parse(meta.now) / DAY) * DAY;
  const rungs = liveRungs(orders, { state: I.paper } as never, dayStart, I.state.dust, I.rungs);
  return rungs.flatMap((r) => liveRungTrips({ ...r, dust: r.dust }, dayStart));
}
/** The whole weekends of the window: each Friday 21:00 → the Monday 00:00 after it (a trip belongs to the one it entered in). */
const weekends: Array<{ name: string; from: number; to: number }> = [];
for (let f = FROM; f + 51 * H <= TO; f += 7 * DAY) weekends.push({ name: new Date(f).toISOString().slice(0, 10), from: f, to: f + 51 * H });
const inSpan = (t: Trip, a: number, b: number) => { const e = Date.parse(t.tEntry); return e >= a && e < b; };
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

const trips = { treat: tripsOf(ARMS.treat), ctrl: tripsOf(ARMS.ctrl) };
const perWeekend = weekends.map((w) => {
  const a = trips.treat.filter((t) => inSpan(t, w.from, w.to)), b = trips.ctrl.filter((t) => inSpan(t, w.from, w.to));
  const sunday21 = w.from + 48 * H;
  return {
    weekend: w.name, treatTrips: a.length, ctrlTrips: b.length, treatGbp: +sum(a.map((t) => t.pnlGbp)).toFixed(4), ctrlGbp: +sum(b.map((t) => t.pnlGbp)).toFixed(4),
    diffGbp: +(sum(a.map((t) => t.pnlGbp)) - sum(b.map((t) => t.pnlGbp))).toFixed(4),
    treatStops: a.filter((t) => t.how === "stop").length, treatClosedAfterReopen: a.filter((t) => Date.parse(t.tExit) >= sunday21).length,
    treatClosedAfterReopenGbp: +sum(a.filter((t) => Date.parse(t.tExit) >= sunday21).map((t) => t.pnlGbp)).toFixed(4),
  };
});
const diffs = perWeekend.map((w) => w.diffGbp), total = sum(diffs);
const win = { treat: trips.treat.filter((t) => inSpan(t, FROM, TO)), ctrl: trips.ctrl.filter((t) => inSpan(t, FROM, TO)) };
let closures: { entries: Record<string, number> } | null = null;
try { closures = JSON.parse(await Deno.readTextFile(`${dataDir}/closures.json`)); } catch { /* the dry run has none */ }
const quotedIn = weekends.filter((w) => (closures?.entries?.[w.name] ?? 0) > 0).length;
const bars = {
  "1 it ran the rule (entries sent on the Saturday or Sunday before 21:00 of at least three whole weekends)": closures == null ? null : quotedIn >= 3,
  "2 better than variant-2 weekend by weekend (all but at most one positive, the sum positive)": weekends.length >= 3 && diffs.filter((d) => d > 0).length >= weekends.length - 1 && total > 0,
  "3 no weekend below the floor": diffs.every((d) => d >= WORST_GBP),
  "4 not one weekend": total > 0 && Math.max(...diffs) <= BEST_SHARE * total,
};
const out = {
  dry, arms: ARMS, window: [new Date(FROM).toISOString(), new Date(TO).toISOString()], wholeWeekends: weekends.length, readAt: meta.now, closures, quotedIn,
  perWeekend, sumDiffGbp: +total.toFixed(4),
  wholeWindow: { treatTrips: win.treat.length, ctrlTrips: win.ctrl.length, treatGbp: +sum(win.treat.map((t) => t.pnlGbp)).toFixed(4), ctrlGbp: +sum(win.ctrl.map((t) => t.pnlGbp)).toFixed(4) },
  bars, pass: !dry && weekends.length >= 3 && Object.values(bars).every((v) => v === true),
};
await Deno.writeTextFile(outFile, JSON.stringify(out, null, 1) + "\n");
console.log(JSON.stringify({ wholeWeekends: out.wholeWeekends, sumDiffGbp: out.sumDiffGbp, bars, pass: out.pass }));
