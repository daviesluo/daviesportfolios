// A read-only look at Finnhub's economic calendar, for the Coinbase blackout's release list (cb_releases.ts): `?action=econcal&from=YYYY-MM-DD&to=YYYY-MM-DD`,
// cron bearer only (index.ts). The key lives only in the function's secrets (`FINNHUB_API_KEY`) and is used here, server side; the answer carries
// the events (country, event, time as ISO UTC, impact) and nothing else of Finnhub's: never the key, never the request URL. Finnhub has marked the
// economic calendar Premium, so it may refuse; then the answer carries its status and its error text verbatim (the key scrubbed from it, should it
// ever echo one). Alpha Vantage has no equivalent: its documentation offers an earnings calendar and an IPO calendar, and its CPI and
// NONFARM_PAYROLL series are a month and a value, with no release instant (docs/agents/reviews/2026-10-15-coinbase-blackout.md, §1.1).
// Nothing here writes: no table, no order, no config.

export const FINNHUB_ECON_URL = "https://finnhub.io/api/v1/calendar/economic";
/** The longest window one call asks for, in days. */
export const ECONCAL_MAX_DAYS = 120;

export type EconEvent = { country: string; event: string; time: string; impact: string };

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const dayMs = (s: string) => Date.parse(`${s}T00:00:00Z`);

/** The query's `from` and `to`: whole UTC days, from not after to, at most ECONCAL_MAX_DAYS apart; otherwise the reason. */
export function parseEconcalRange(from: string | null, to: string | null): { from: string; to: string } | { error: string } {
  if (!from || !to || !DAY_RE.test(from) || !DAY_RE.test(to)) return { error: "from and to are required, as YYYY-MM-DD" };
  const a = dayMs(from), b = dayMs(to);
  if (!Number.isFinite(a) || !Number.isFinite(b) || new Date(a).toISOString().slice(0, 10) !== from || new Date(b).toISOString().slice(0, 10) !== to) return { error: "from and to must be real dates" };
  if (b < a) return { error: "from is after to" };
  if ((b - a) / 86400e3 > ECONCAL_MAX_DAYS) return { error: `at most ${ECONCAL_MAX_DAYS} days a call` };
  return { from, to };
}

/**
 * Finnhub's `{ economicCalendar: [{ country, event, impact, time: "YYYY-MM-DD HH:MM:SS" (UTC), … }] }` reduced to the four fields, time as ISO UTC,
 * in time order. Anything that is not that shape gives no events (the caller says so).
 */
export function parseFinnhubEconomic(body: unknown): EconEvent[] {
  const rows = (body as { economicCalendar?: unknown } | null)?.economicCalendar;
  if (!Array.isArray(rows)) return [];
  const out: EconEvent[] = [];
  for (const r of rows) {
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})(?::(\d{2}))?/.exec(String(o.time ?? ""));
    if (!m || typeof o.event !== "string") continue;
    out.push({ country: String(o.country ?? ""), event: o.event, time: `${m[1]}T${m[2]}:${m[3] ?? "00"}Z`, impact: String(o.impact ?? "") });
  }
  return out.sort((x, y) => x.time.localeCompare(y.time) || x.country.localeCompare(y.country) || x.event.localeCompare(y.event));
}

/** An error text with the key (and the request URL, should a library echo it) taken out, and cut short. */
export function scrubEconError(text: string, key: string): string {
  let t = text;
  if (key) t = t.split(key).join("***");
  t = t.replace(/token=[^&\s"']*/g, "token=***");
  return t.slice(0, 500);
}

export type EconcalAnswer = { ok: boolean; from?: string; to?: string; status?: number; error?: string; count?: number; events?: EconEvent[] };

/** The call: validate the window, ask Finnhub with the key, return the events or Finnhub's refusal. */
export async function runEconcal(d: { from: string | null; to: string | null; key: string | undefined; fetchImpl?: typeof fetch }): Promise<EconcalAnswer> {
  const range = parseEconcalRange(d.from, d.to);
  if ("error" in range) return { ok: false, error: range.error };
  if (!d.key) return { ok: false, from: range.from, to: range.to, error: "FINNHUB_API_KEY is not set" };
  const f = d.fetchImpl ?? fetch;
  let res: Response;
  try {
    res = await f(`${FINNHUB_ECON_URL}?from=${range.from}&to=${range.to}&token=${encodeURIComponent(d.key)}`);
  } catch (e) {
    return { ok: false, from: range.from, to: range.to, error: scrubEconError(e instanceof Error ? e.message : String(e), d.key) };
  }
  const text = await res.text();
  if (!res.ok) return { ok: false, from: range.from, to: range.to, status: res.status, error: scrubEconError(text, d.key) };
  let body: unknown = null;
  try { body = JSON.parse(text); } catch { return { ok: false, from: range.from, to: range.to, status: res.status, error: scrubEconError(`not JSON: ${text}`, d.key) }; }
  const events = parseFinnhubEconomic(body);
  return { ok: true, from: range.from, to: range.to, status: res.status, count: events.length, events };
}
