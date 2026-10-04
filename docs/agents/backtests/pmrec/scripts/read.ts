// Reads one of the Polymarket book recorder's archive objects (an hour of one kind's frames, or a day's dump of the
// markets) as a study reads it, through the module's own decoder (`readFrames`, pm_book_rec.ts): every gzip member,
// each line named by its frame's fields and scaled back to dollars and shares.
//   - a file saved locally, or the object's signed URL from `pm_rec_archive.url` (read with SQL: a signed URL opens its
//     object to anyone who holds it until it expires, so it is never committed, and this script never prints it);
//   - prints each frame's kind, minute and line count, then the totals; with `--id <n>` every line of market n (the
//     `id` of `pm_rec_markets`, which the dump maps to its condition, tokens and question) as JSON; with `--out <file>`
//     every decoded line as JSON lines, a frame's minute on each.
// Run from the repository root:
//   npx --yes deno@1.46.3 run --allow-read --allow-write --allow-net docs/agents/backtests/pmrec/scripts/read.ts <file or URL> [--id <n>] [--out <file>]
import { gunzipSync } from "node:zlib";
import { readFrames } from "../../../../../supabase/functions/agents/pm_book_rec.ts";

const args = [...Deno.args];
const flag = (name: string) => { const i = args.indexOf(name); if (i < 0) return null; const v = args[i + 1]; args.splice(i, 2); return v ?? null; };
const id = flag("--id"), out = flag("--out");
const src = args[0];
if (!src) throw new Error("usage: read.ts <file or URL> [--id <n>] [--out <file>]");

let bytes: Uint8Array;
if (/^https:\/\//.test(src)) {
  const r = await fetch(src);
  if (!r.ok) throw new Error(`download: ${r.status}`);
  bytes = new Uint8Array(await r.arrayBuffer());
} else bytes = await Deno.readFile(src);
const name = /^https:\/\//.test(src) ? new URL(src).pathname.split("/").slice(-3).join("/") : src;

const frames = readFrames(new TextDecoder().decode(gunzipSync(bytes)));
const kinds = new Map<string, { frames: number; lines: number }>();
for (const f of frames) {
  const k = String(f.header.kind);
  const t = kinds.get(k) ?? { frames: 0, lines: 0 };
  t.frames++; t.lines += f.rows.length;
  kinds.set(k, t);
  console.log(`${k} ${String(f.header.minute ?? f.header.day ?? "")} ${f.rows.length} lines${f.header.n !== undefined && f.header.n !== f.rows.length ? ` (header says ${f.header.n})` : ""}`);
}
console.log(JSON.stringify({ object: name, gzipBytes: bytes.length, ...Object.fromEntries(kinds) }));
if (id !== null) {
  for (const f of frames) for (const r of f.rows) if (String(r.id) === id) console.log(JSON.stringify({ minute: f.header.minute ?? f.header.day, ...r }));
}
if (out) {
  const lines = frames.flatMap((f) => f.rows.map((r) => JSON.stringify({ minute: f.header.minute ?? f.header.day, ...r })));
  await Deno.writeTextFile(out, lines.join("\n") + "\n");
  console.log(`${lines.length} lines written to ${out}`);
}
