// The agents function's database access: PostgREST over fetch with the
// service-role key, the same way `data` and `snapshot-record` write.
// Every call is small and explicit; there is no ORM to hide a query.
// `fetchImpl` is injectable so tick.ts can be exercised with a stub.

export type Db = {
  select: <T = unknown>(table: string, query: string) => Promise<T[]>;
  insert: <T = unknown>(table: string, rows: unknown, returning?: boolean) => Promise<T[]>;
  upsert: (table: string, rows: unknown, onConflict: string) => Promise<void>;
  update: (table: string, query: string, patch: unknown) => Promise<void>;
};

export function makeDb(supabaseUrl: string, serviceKey: string, fetchImpl: typeof fetch = fetch, timeoutMs = 8_000): Db {
  const headers = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" };
  const call = async (method: string, path: string, body?: unknown, extra: Record<string, string> = {}) => {
    const res = await fetchImpl(`${supabaseUrl}/rest/v1/${path}`, {
      method, headers: { ...headers, ...extra },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`db ${method} ${path.split("?")[0]} → ${res.status}: ${text.slice(0, 200)}`);
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
  };
}
