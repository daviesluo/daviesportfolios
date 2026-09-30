// Each price recorder audits the other's last 24 hours once a day (improvement plan item 10, 2026-09-30).
//
// Until then nothing noticed a recorder that stopped writing: `healthcheck.yml` pings the site and the Edge runtime,
// not the tables, and a recorder whose deploy the JWT gate refused, whose row left the cron job, or whose upstream
// turned it away simply wrote nothing. Counted by hand before this was built, the two recorders were losing a third to
// two thirds of the US overnight session to each other at Trading 212 (`t212_positions.ts`).
//
// The calendar is the whole trick. The snapshot recorder owes a row every five minutes, day and night; the overnight
// recorder owes one only inside a session it records (`us_overnight_session.ts`), so a weekend or a holiday is never
// "missing". An audit counts the buckets the recorder owed in the 24 hours before its call (the last ten minutes
// excepted, which may still be in flight) against the ones it wrote, and writes one `recorder.watch` ops error when it
// wrote under 90 % of them or none of the last six. The snapshot recorder audits the overnight recorder at 10:00 UTC,
// after the session ends in either season; the overnight recorder audits the snapshot recorder at 09:30 UTC. Neither
// audits itself, so a recorder that is not running at all is still reported, by the other. The 24 hours stay inside
// the 26 that `price_snapshots` keeps at five minutes (`0036`); older rows are thinned and would read as missing.

import { reportServerError } from "./ops.ts";

export const BUCKET_MS = 5 * 60_000;
/** An audit reports a recorder that wrote under this share of the buckets it owed… */
export const WATCH_MIN_COVERAGE = 0.9;
/** …or none of the last this many. */
export const WATCH_TAIL = 6;
/** Buckets this young are not owed yet: the recorder's call for them may still be running. */
export const WATCH_GRACE_MS = 10 * 60_000;
const DAY_MS = 24 * 3_600_000;
const PAGE = 1_000;

/** Is this the day's audit call: the one whose five-minute bucket starts at `hh:mm` UTC? */
export function isAuditCall(now: Date, hourUtc: number, minuteUtc: number): boolean {
  const b = new Date(Math.floor(now.getTime() / BUCKET_MS) * BUCKET_MS);
  return b.getUTCHours() === hourUtc && b.getUTCMinutes() === minuteUtc;
}

/** Every five-minute bucket start in [fromMs, toMs) that `owed` accepts, as ISO strings, oldest first. */
export function owedBuckets(fromMs: number, toMs: number, owed: (at: Date) => boolean = () => true): string[] {
  const out: string[] = [];
  for (let t = Math.ceil(fromMs / BUCKET_MS) * BUCKET_MS; t < toMs; t += BUCKET_MS) {
    const at = new Date(t);
    if (owed(at)) out.push(at.toISOString());
  }
  return out;
}

/** One line for `ops_errors`, or null when the recorder wrote what it owed. `written` may be in any ISO form. */
export function auditFinding(recorder: string, owed: string[], written: Iterable<string>, toIso: string): string | null {
  if (owed.length === 0) return null;
  const have = new Set([...written].map((s) => new Date(s).toISOString()));
  const kept = owed.filter((b) => have.has(b));
  const tail = owed.slice(-WATCH_TAIL);
  const stopped = tail.length === WATCH_TAIL && tail.every((b) => !have.has(b));
  if (kept.length >= WATCH_MIN_COVERAGE * owed.length && !stopped) return null;
  return `${recorder} wrote ${kept.length} of the ${owed.length} five-minute buckets it owed in the 24 h to ${toIso} ` +
    `(${Math.round((100 * kept.length) / owed.length)} %)${stopped ? `, none of the last ${WATCH_TAIL}` : ""}; ` +
    `the newest it wrote: ${kept.at(-1) ?? "none"}.`;
}

/**
 * The distinct buckets `table.column` holds in [fromIso, toIso), a page at a time; null when a page could not be
 * read. `order` must be a total order (the table's key), so no row falls between two pages.
 */
export async function readBuckets(
  table: string, column: string, order: string, fromIso: string, toIso: string,
  env: { sbUrl: string; serviceKey: string; fetchImpl?: typeof fetch },
): Promise<string[] | null> {
  const fetchImpl = env.fetchImpl ?? fetch;
  const out = new Set<string>();
  for (let offset = 0; ; offset += PAGE) {
    const url = `${env.sbUrl}/rest/v1/${table}?select=${column}` +
      `&${column}=gte.${encodeURIComponent(fromIso)}&${column}=lt.${encodeURIComponent(toIso)}` +
      `&order=${order}&limit=${PAGE}&offset=${offset}`;
    try {
      const res = await fetchImpl(url, {
        headers: { apikey: env.serviceKey, Authorization: `Bearer ${env.serviceKey}` },
        signal: AbortSignal.timeout(5_000),
      });
      if (!res.ok) { await res.body?.cancel(); return null; }
      const rows = await res.json() as Record<string, string>[];
      for (const r of rows) out.add(new Date(r[column]).toISOString());
      if (rows.length < PAGE) return [...out];
    } catch {
      return null;
    }
  }
}

/**
 * Audit one recorder's last 24 hours and report what is wrong, once. Never throws: an audit that cannot read its
 * table reports that instead. Returns the line it reported, or null.
 */
export async function auditRecorder(o: {
  recorder: string; table: string; column: string; order: string; now: Date;
  owed?: (at: Date) => boolean;
  env?: { sbUrl: string; serviceKey: string; fetchImpl?: typeof fetch };
  report?: (message: string) => Promise<void>;
}): Promise<string | null> {
  const env = o.env ?? {
    sbUrl: Deno.env.get("SUPABASE_URL") ?? "", serviceKey: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  };
  const report = o.report ?? ((message: string) => reportServerError("recorder.watch", { symbol: o.recorder, message }));
  try {
    const to = o.now.getTime() - WATCH_GRACE_MS;
    const toIso = new Date(to).toISOString();
    const owed = owedBuckets(to - DAY_MS, to, o.owed);
    if (owed.length === 0) return null;
    const written = await readBuckets(o.table, o.column, o.order, owed[0], toIso, env);
    const line = written == null
      ? `the audit of ${o.recorder} could not read ${o.table}.`
      : auditFinding(o.recorder, owed, written, toIso);
    if (line) await report(line);
    return line;
  } catch (e) {
    const line = `the audit of ${o.recorder} failed: ${e instanceof Error ? e.message : String(e)}`;
    await report(line).catch(() => {});
    return line;
  }
}
