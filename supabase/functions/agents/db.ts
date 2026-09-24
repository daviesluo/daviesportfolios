// The agents function's database access: PostgREST over fetch with the
// service-role key, the same way `data` and `snapshot-record` write.
// Every call is small and explicit; there is no ORM to hide a query.
// `fetchImpl` is injectable so tick.ts can be exercised with a stub.

export type Db = {
  select: <T = unknown>(table: string, query: string) => Promise<T[]>;
  insert: <T = unknown>(table: string, rows: unknown, returning?: boolean) => Promise<T[]>;
  upsert: (table: string, rows: unknown, onConflict: string) => Promise<void>;
  update: (table: string, query: string, patch: unknown) => Promise<void>;
  /** An update that returns the rows it changed — a compare-and-set when the filter names the expected state (the tick's lease). */
  claim: <T = unknown>(table: string, query: string, patch: unknown) => Promise<T[]>;
  /**
   * Every row the query matches, fetched a page at a time. PostgREST answers
   * at most `max-rows` rows per request (1,000 on Supabase) and says nothing
   * when it stops; a book read from a silently truncated list of fills would
   * freeze every position at a state weeks old. `query` must not carry its
   * own `limit`.
   */
  selectAll: <T = unknown>(table: string, query: string) => Promise<T[]>;
};

/**
 * LIMIT/OFFSET paging is only stable under a TOTAL order: with `order=ts.asc` alone, two rows sharing a timestamp
 * can land either side of a page boundary and be read twice or not at all — and a fill read twice is a position
 * counted twice. So a paged read must name its order, and end it with the unique `id`.
 *
 * ONE implementation, called by the real client AND by every test stub. On 2026-09-22 this check lived only in
 * the real client, the stubs paged without it, every test was green — and one production caller with no `order=`
 * (`tick.ts`'s count of today's orders) threw on every tick for two hours, after the basis was written and before
 * the book, the stops and the decisions ran. A stub looser than the thing it stands in for certifies what
 * production rejects; this is the second time in a day that lesson was paid for.
 */
/** Tables whose unique key is not an `id` column: ordering by that whole key, in its order, is as total as `id`. */
const PAGED_KEYS: Record<string, string> = {
  agent_quote_inputs: "kind,t", agent_quote_events: "book,minute,side,k,kind", pm_rw_minutes: "minute,cond", pm_rw_fills: "cond,minute,print_id",
};

export function assertPagedOrder(table: string, query: string): void {
  const order = /(?:^|&)order=([^&]*)/.exec(query)?.[1];
  if (!order) throw new Error(`selectAll(${table}) needs an explicit order to page safely`);
  // And the LAST column must be the unique `id`: rows that tie on every column named are in no fixed order between
  // two page reads, so ordering by `ts` alone is the same hole with a smaller mouth. Every caller ended with `id`
  // already; the pre-live review (2026-09-22, #13) found the rule written down and nowhere enforced.
  const cols = decodeURIComponent(order).split(",").map((c) => c.split(".")[0]);
  const key = PAGED_KEYS[table]?.split(",");
  if (key && cols.slice(-key.length).join(",") === key.join(",")) return;
  if (cols.at(-1) !== "id") throw new Error(`selectAll(${table}) must order by the unique id last (…,id.asc), not "${order}"`);
}

/** How much of a refusal's text an error keeps. */
export const DB_ERROR_CHARS = 300;

/**
 * PostgREST's error body, reordered so the part that names the failure survives the cut. PostgREST writes
 * `code, details, hint, message`, and `details` is often the whole failing row ("Failing row contains (…)", hundreds of
 * characters): cut at 200 characters as it was until 2026-09-22, a CHECK or NOT NULL refusal lost the constraint or
 * column that `message` names — the one word the test doubles' own messages always showed. `code` and `message` now go
 * first. A body that is not PostgREST's JSON is kept as it came, cut the same way.
 */
export function dbErrorText(body: string, max = DB_ERROR_CHARS): string {
  try {
    const j = JSON.parse(body);
    if (j && typeof j === "object" && !Array.isArray(j) && ("message" in j || "code" in j)) {
      const { code, message, hint, details, ...rest } = j as Record<string, unknown>;
      return JSON.stringify({ code, message, hint, details, ...rest }).slice(0, max);
    }
  } catch { /* not JSON: kept as it came */ }
  return body.slice(0, max);
}

/** PostgREST's page: Supabase's `max-rows` default, and the page size `selectAll` asks for. */
export const PAGE_ROWS = 1000;

export function makeDb(supabaseUrl: string, serviceKey: string, fetchImpl: typeof fetch = fetch, timeoutMs = 8_000): Db {
  const headers = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" };
  const call = async (method: string, path: string, body?: unknown, extra: Record<string, string> = {}) => {
    const res = await fetchImpl(`${supabaseUrl}/rest/v1/${path}`, {
      method, headers: { ...headers, ...extra },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`db ${method} ${path.split("?")[0]} → ${res.status}: ${dbErrorText(text)}`);
    return text ? JSON.parse(text) : [];
  };
  return {
    select: (table, query) => call("GET", `${table}?${query}`),
    insert: (table, rows, returning = true) =>
      call("POST", table, rows, { Prefer: returning ? "return=representation" : "return=minimal" }),
    upsert: async (table, rows, onConflict) => {
      await call("POST", `${table}?on_conflict=${onConflict}`, rows, { Prefer: "resolution=merge-duplicates,return=minimal" });
    },
    update: async (table, query, patch) => { await call("PATCH", `${table}?${query}`, patch, { Prefer: "return=minimal" }); },
    claim: (table, query, patch) => call("PATCH", `${table}?${query}`, patch, { Prefer: "return=representation" }),
    selectAll: async (table, query) => {
      assertPagedOrder(table, query);
      const out: unknown[] = [];
      for (let offset = 0; ; offset += PAGE_ROWS) {
        const page = await call("GET", `${table}?${query}&limit=${PAGE_ROWS}&offset=${offset}`) as unknown[];
        out.push(...page);
        if (page.length < PAGE_ROWS) break;
      }
      // deno-lint-ignore no-explicit-any
      return out as any;
    },
  };
}
