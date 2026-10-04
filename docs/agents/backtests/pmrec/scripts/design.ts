// Keyless, read-only: the measurements the book recorder's shape rests on (supabase/functions/agents/pm_book_rec.ts), on
// the public API through the recorder's own readers:
//   1. The reward listing whole (the order path's `rewardListing`) and the CLOB's short list: markets by daily rate.
//   2. The YES books of every market of $10 a day or more, read three times a minute apart (POST /books, a hundred a
//      request): wall and main-thread CPU, levels in RW's 10 ¢ window, how many books changed between reads in the
//      window and in full, and whether the book's `timestamp` (and `hash`) moved with them; and how old a book's
//      `timestamp` is when it is read.
//   3. One read's books frame in four encodings, gzip'd: with RW's summary on every line, without it, with prices as
//      steps from the touch, and both.
//   4. The data API's global tape, three pages back by its cursor, against each rewarded market's own feed over the same
//      seconds: whether the tape holds every print, and how many prints a minute fall in the $10 set.
// Run from the repository root:
//   npx --yes deno@1.46.3 run --allow-all docs/agents/backtests/pmrec/scripts/design.ts <out.txt>
import { rewardListing, PM_LIVE_SELECT_UNTIL_MS, PM_LIVE_TIMEOUT_MS } from "../../../../../supabase/functions/agents/pm_live.ts";
import { pmVenue } from "../../../../../supabase/functions/_shared/polymarket_orders.ts";
import { pmSimplifiedMarkets } from "../../../../../supabase/functions/_shared/polymarket_public.ts";
import {
  bookLine, bookSummary, frameText, gzip, readBooks, tapeRow, windowLadder, type PmRecBookReply,
} from "../../../../../supabase/functions/agents/pm_book_rec.ts";

const OUT = Deno.args[0];
if (!OUT) throw new Error("usage: design.ts <out.txt>");
const lines: string[] = [];
const say = (x: unknown) => { const s = JSON.stringify(x); console.log(s); lines.push(s); };
const cpu = () => {
  const s = Deno.readTextFileSync(`/proc/self/task/${Deno.pid}/stat`);
  const f = s.slice(s.lastIndexOf(")") + 2).split(" ");
  return (Number(f[11]) + Number(f[12])) * 10;
};

// 1. The listing and the tokens.
const venue = pmVenue({ sigType: 1, creds: null, address: null, timeoutMs: PM_LIVE_TIMEOUT_MS, sendsEnabled: false });
let t = Date.now(), c = cpu();
let l = await rewardListing(venue, { clock: () => Date.now(), until: Date.now() + PM_LIVE_SELECT_UNTIL_MS });
if (!l.ok) l = await rewardListing(venue, { clock: () => Date.now(), until: Date.now() + PM_LIVE_SELECT_UNTIL_MS });
if (!l.ok) throw new Error(`listing: ${l.error}`);
say({ step: "listing", rows: l.rows.size, pages: l.pages, how: l.how, ms: Date.now() - t, cpuMs: cpu() - c });
const rates = [...l.rows.values()];
const band = (lo: number) => rates.filter((r) => r.rate >= lo && r.v > 0).length;
say({ step: "rates", atLeast: Object.fromEntries([0, 1, 5, 6, 10, 20, 50, 100, 500].map((b) => [`$${b}`, band(b)])),
  dailyRateSum: { all: Math.round(rates.reduce((s, r) => s + r.rate, 0)), "$10+": Math.round(rates.filter((r) => r.rate >= 10).reduce((s, r) => s + r.rate, 0)) } });
t = Date.now(); c = cpu();
const simple = new Map([...await pmSimplifiedMarkets({ timeoutMs: 20_000 })].map(([k, v]) => [k.toLowerCase(), v]));
say({ step: "short list", rows: simple.size, ms: Date.now() - t, cpuMs: cpu() - c, listedWithTokens: [...l.rows.keys()].filter((k) => simple.has(k)).length });
const ten = [...l.rows].filter(([cond, r]) => r.rate >= 10 && r.v > 0 && simple.has(cond)).map(([cond, r]) => ({ cond, ...r, yes: simple.get(cond)!.yes }));

// 2. The $10 set's books, three reads a minute apart.
type Read = Map<string, { key: string; full: string; hash: string; ts: number | null }>;
let prev: Read | null = null, last: PmRecBookReply[] = [];
for (let k = 0; k < 3; k++) {
  if (k) await new Promise((r) => setTimeout(r, 60e3 - ((Date.now() - t) % 60e3)));
  t = Date.now(); c = cpu();
  const got: PmRecBookReply[] = [];
  const r = await readBooks(ten.map((m) => m.yes), {}, (b) => got.push(b));
  const ms = Date.now() - t, cpuMs = cpu() - c;
  const cur: Read = new Map();
  let levels = 0, twoSided = 0;
  for (const b of got) {
    const lad = windowLadder(b);
    levels += lad.bids.length + lad.asks.length;
    if (lad.bids.length && lad.asks.length) twoSided++;
    const all = (xs: PmRecBookReply["bids"]) => (xs ?? []).map((l) => [l.price, l.size]);
    cur.set(String(b.asset_id), { key: JSON.stringify([lad.bids, lad.asks]), full: JSON.stringify([all(b.bids), all(b.asks)]), hash: String(b.hash), ts: lad.ts });
  }
  // The window's ladder, then the whole book: unchanged, and of those how many moved their timestamp (and hash); changed
  // with the timestamp where it was.
  let same = 0, changed = 0, sameTsMoved = 0, fullSame = 0, fullSameTsMoved = 0, fullSameHashMoved = 0, changedTsSame = 0;
  if (prev) for (const [tok, x] of cur) {
    const p = prev.get(tok);
    if (!p) continue;
    if (p.key === x.key) { same++; if (p.ts !== x.ts) sameTsMoved++; } else changed++;
    if (p.full === x.full) { fullSame++; if (p.ts !== x.ts) fullSameTsMoved++; if (p.hash !== x.hash) fullSameHashMoved++; } else if (p.ts === x.ts) changedTsSame++;
  }
  const ages = [...cur.values()].map((x) => t + ms - Number(x.ts)).filter(Number.isFinite).sort((a, b) => a - b);
  const age = (f: number) => Math.round(ages[Math.floor(f * (ages.length - 1))] / 1e3);
  say({
    step: "books", read: k, markets: ten.length, books: r.books, requests: r.requests, failed: r.failed, ms, cpuMs, twoSided, levels,
    timestampAgeS: { p10: age(0.1), p50: age(0.5), p90: age(0.9) },
    ...(prev ? { window: { same, changed, sameTsMoved }, whole: { same: fullSame, sameTsMoved: fullSameTsMoved, sameHashMoved: fullSameHashMoved, changedTsSame } } : {}),
  });
  prev = cur; last = got;
}

// 3. One read's frame, four ways.
const byYes = new Map(ten.map((m, i) => [m.yes, { ...m, id: i + 1 }]));
const minute = Math.floor(Date.now() / 60e3) * 60e3;
const enc: Record<string, unknown[]> = { "ladder, size-cutoff touch, last trade (as recorded)": [], "and RW's q1, q2 and depth within v": [], "ladder only": [], "as recorded, prices as steps": [] };
for (const b of last) {
  const m = byYes.get(String(b.asset_id));
  if (!m) continue;
  const lad = windowLadder(b);
  const line = bookLine(m.id, minute, lad, { minSize: m.minSize }) as unknown[];
  const s = bookSummary(lad, { v: m.v, minSize: m.minSize });
  const tk = Math.max(1, Number(line[2] ?? 100));
  const steps = (xs: number[]) => xs.map((x, i) => (i === 0 ? x : Math.abs(x - xs[i - 1]) / tk));
  enc["ladder, size-cutoff touch, last trade (as recorded)"].push(line);
  enc["and RW's q1, q2 and depth within v"].push([...line.slice(0, 9), s.q1, s.q2, s.dvBid, s.dvAsk, line[9]]);
  enc["ladder only"].push(line.slice(0, 7));
  enc["as recorded, prices as steps"].push([line[0], line[1], line[2], steps(line[3] as number[]), line[4], steps(line[5] as number[]), ...line.slice(6)]);
}
for (const [k, v] of Object.entries(enc)) {
  const text = frameText({ v: 1 }, v);
  say({ step: "encoding", encoding: k, books: v.length, rawKb: Math.round(text.length / 1e3), gzipKb: Math.round((await gzip(text)).length / 1e3) });
}

// 4. The global tape against each market's own feed.
const tapeRows: Array<Record<string, unknown>> = [];
let cursor = "";
for (let p = 0; p < 3; p++) {
  const q = new URLSearchParams({ limit: "1000", _: String(Date.now()) });
  if (cursor) q.set("cursor", cursor);
  const d = await (await fetch(`https://data-api.polymarket.com/v2/trades?${q}`)).json() as { data: Array<Record<string, unknown>>; pagination: { next_cursor?: string } };
  tapeRows.push(...d.data);
  cursor = d.pagination?.next_cursor ?? "";
  if (!cursor) break;
}
const parsed = tapeRows.map(tapeRow).filter((x) => x !== null);
const oldest = Math.min(...parsed.map((x) => x.ts)), newest = Math.max(...parsed.map((x) => x.ts));
const tenSet = new Set(ten.map((m) => m.cond)), inWindow = (x: { ts: number }) => x.ts > oldest && x.ts < newest;
const perCond = new Map<string, number>();
for (const x of parsed) if (tenSet.has(x.cond) && inWindow(x)) perCond.set(x.cond, (perCond.get(x.cond) ?? 0) + 1);
let tapeN = 0, ownN = 0;
for (const cond of [...perCond.keys()].slice(0, 10)) {
  const q = new URLSearchParams({ condition: cond, limit: "1000", _: String(Date.now()) });
  const d = await (await fetch(`https://data-api.polymarket.com/v2/trades?${q}`)).json() as { data: Array<Record<string, unknown>> };
  tapeN += perCond.get(cond)!;
  ownN += d.data.map(tapeRow).filter((x) => x !== null && inWindow(x)).length;
}
const span = newest - oldest;
say({
  step: "tape", pages: 3, prints: parsed.length, windowS: span, perMinute: Math.round(parsed.length / span * 60),
  "$10 set per minute": Math.round([...perCond.values()].reduce((s, n) => s + n, 0) / span * 60),
  compared: { markets: Math.min(10, perCond.size), inTape: tapeN, inOwnFeed: ownN },
});
await Deno.writeTextFile(OUT, lines.join("\n") + "\n");
