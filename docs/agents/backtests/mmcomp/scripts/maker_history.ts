// MAKER-ABSENT (2026-10-30): the other maker's history, 2026-09-26 00:00 -> 2026-10-30 03:00 UTC, worked out by the watch's own
// code (supabase/functions/agents/maker_watch.ts, `mwStep`, imported unchanged) on the recorded books, so the windows the replay
// uses are the ones the live watch writes. Inputs: fair_price/data/book_<B>.txt.gz and minutes.txt.gz (to 10-29 00:00), then
// data/book2_<B>.txt.gz and minutes2.txt.gz (10-29 00:00 -> 10-30 03:00, sql/pull_1029.sql). Output: results/maker_history.json
// with every event, the absences, a line a day, and each book's minutes as one character each (B both sides, b bid only,
// a ask only, n none, u unseen) from 2026-09-26 00:00.
//   npx --yes deno@1.46.3 run --allow-read --allow-write docs/agents/backtests/mmcomp/scripts/maker_history.ts
import { MW_BOOKS, MW_FROM, mwMemo0, mwSnapFor, mwStep, type MwEventRow, type MwLevel, type MwSnap } from "../../../../../supabase/functions/agents/maker_watch.ts";

const HERE = new URL(".", import.meta.url).pathname;
const BT = `${HERE}../../`;
const END = Date.parse("2026-10-30T03:00:00Z");
const M = 60e3;

async function lines(path: string): Promise<string[]> {
  const f = await Deno.open(path);
  const text = await new Response(f.readable.pipeThrough(new DecompressionStream("gzip"))).text();
  return text.split("\n").filter((l) => l.trim());
}
const lv = (s: string): MwLevel[] => s ? s.split(";").map((z) => { const [p, q, n] = z.split(":"); return [Number(p), Number(q), n ? Number(n) : null] as MwLevel; }) : [];

const out: Record<string, unknown> = { window: "2026-09-26 00:00 -> 2026-10-30 03:00 UTC", code: "supabase/functions/agents/maker_watch.ts mwStep" };
const minutesFu = new Map<string, { x: number | null; fu: number | null }>();
for (const path of [`${BT}fair_price/data/minutes.txt.gz`, `${BT}mmcomp/data/minutes2.txt.gz`]) {
  for (const l of await lines(path)) {
    const [b, ms, x, fu] = l.split("|");
    minutesFu.set(`${b}|${ms}`, { x: x ? Number(x) : null, fu: fu ? Number(fu) : null });
  }
}
const events: MwEventRow[] = [];
const minutes: Record<string, string> = {};
const days: Record<string, Record<string, Record<string, number>>> = {};
const widthsByDay: Record<string, Record<string, number[]>> = {};
for (const book of MW_BOOKS) {
  const snaps = new Map<number, MwSnap>();
  for (const path of [`${BT}fair_price/data/book_${book}.txt.gz`, `${BT}mmcomp/data/book2_${book}.txt.gz`]) {
    for (const l of await lines(path)) {
      const [t, su, b, a] = l.split("|");
      snaps.set(Number(t), { ts: Number(t), seen: Math.max(Number(su), Number(t)), bids: lv(b), asks: lv(a) });
    }
  }
  const list = [...snaps.values()].sort((p, q) => p.ts - q.ts);
  let memo = mwMemo0(), i = 0, chars = "";
  days[book] = {}; widthsByDay[book] = {};
  for (let m = MW_FROM; m < END; m += M) {
    while (i + 1 < list.length && list[i + 1].ts < m + M) i++;
    const snap = list.length ? mwSnapFor(list.slice(i, i + 1), m) : null;
    const f = minutesFu.get(`${book}|${m}`);
    const r = mwStep(book, m, snap, f?.fu ?? null, f?.x ?? null, memo);
    memo = r.memo;
    events.push(...r.events);
    chars += { both: "B", bid: "b", ask: "a", none: "n", unseen: "u" }[r.row.present];
    const day = r.row.minute.slice(0, 10);
    const dd = (days[book][day] ??= { both: 0, bid: 0, ask: 0, none: 0, unseen: 0 });
    dd[r.row.present]++;
    if (r.row.width_ticks != null) (widthsByDay[book][day] ??= []).push(r.row.width_ticks);
  }
  minutes[book] = chars;
}
const med = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
const absences: Array<{ book: string; from: string; to: string | null; hours: number }> = [];
for (const book of MW_BOOKS) {
  let gone: string | null = null;
  for (const e of events.filter((e) => e.book === book)) {
    if (e.kind === "disappeared") gone = e.ts;
    if (e.kind === "appeared" && gone) { absences.push({ book, from: gone, to: e.ts, hours: Math.round((Date.parse(e.ts) - Date.parse(gone)) / 36e3) / 100 }); gone = null; }
  }
  if (gone) absences.push({ book, from: gone, to: null, hours: Math.round((END - Date.parse(gone)) / 36e3) / 100 });
}
out.events = events;
out.absences = absences;
out.days = Object.fromEntries(MW_BOOKS.map((b) => [b, Object.fromEntries(Object.entries(days[b]).map(([d, v]) => [d, { ...v, width_median: widthsByDay[b][d] ? med(widthsByDay[b][d]) : null }]))]));
out.minutes_from = new Date(MW_FROM).toISOString();
out.minutes = minutes;
await Deno.writeTextFile(`${HERE}../results/maker_history.json`, JSON.stringify(out, null, 1) + "\n");
console.log(JSON.stringify({ events: events.length, absences }, null, 1));
