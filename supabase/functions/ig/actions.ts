// The three actions of the `ig` function: `facts` (G1), `history` (G2) and `quotes` (G4's recorder, by REST polling).
// Each writes what it read to its own table and returns a short report; none can place, amend or close anything,
// because the client it is given cannot (`client.ts`).

import { IgClient, IgHttpError, IgRefused, isTokenError, stripBalances, type IgSession } from "./client.ts";
import { keepSearch, parsePins, pickEpics, ROLES, SEARCH_TERMS, type SearchMarket } from "./epics.ts";
import { activeWindows, historyWindows, HISTORY_PLANS, type HistoryPlanId } from "./windows.ts";

// ---------------------------------------------------------------------------------------------------------------------
// The database, through PostgREST with the service role.

export type Rest = {
  insert(table: string, rows: unknown[] | Record<string, unknown>): Promise<void>;
  /** Every row a query names, paged past PostgREST's 1,000-row cap; or, with `limit`, at most that many in one read. */
  select<T>(table: string, query: string, limit?: number): Promise<T[]>;
  rpc<T>(fn: string, args: Record<string, unknown>): Promise<T>;
};

export function restClient(sbUrl: string, serviceKey: string, fetchImpl: typeof fetch = fetch): Rest {
  const h = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" };
  const check = async (res: Response, what: string) => {
    if (!res.ok) throw new Error(`${what}: ${res.status} ${(await res.text()).slice(0, 200)}`);
  };
  return {
    async insert(table, rows) {
      const res = await fetchImpl(`${sbUrl}/rest/v1/${table}`, {
        method: "POST", headers: { ...h, Prefer: "return=minimal" }, body: JSON.stringify(rows), signal: AbortSignal.timeout(10_000),
      });
      await check(res, `insert ${table}`);
      await res.body?.cancel();
    },
    async select<T>(table: string, query: string, limit?: number): Promise<T[]> {
      if (limit !== undefined) {
        const res = await fetchImpl(`${sbUrl}/rest/v1/${table}?${query}&limit=${Math.min(limit, 1000)}`, { headers: h, signal: AbortSignal.timeout(10_000) });
        await check(res, `select ${table}`);
        return await res.json() as T[];
      }
      const out: T[] = [];
      for (let offset = 0; ; offset += 1000) {
        const res = await fetchImpl(`${sbUrl}/rest/v1/${table}?${query}&limit=1000&offset=${offset}`, { headers: h, signal: AbortSignal.timeout(10_000) });
        await check(res, `select ${table}`);
        const page = await res.json() as T[];
        out.push(...page);
        if (page.length < 1000) return out;
      }
    },
    async rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
      const res = await fetchImpl(`${sbUrl}/rest/v1/rpc/${fn}`, { method: "POST", headers: h, body: JSON.stringify(args), signal: AbortSignal.timeout(15_000) });
      await check(res, `rpc ${fn}`);
      return await res.json() as T;
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// The two demo accounts (Davies, 2026-10-15): CFD `Z6F18J`, spread betting `Z6F18K`. A role's account is found by its
// type in the session's own list; these ids are only checked against it, and a difference is recorded, not obeyed.

export type AccountKind = "sb" | "cfd";
export const ACCOUNT_KINDS: readonly AccountKind[] = ["sb", "cfd"];
export const EXPECTED_DEMO_ACCOUNTS: Record<AccountKind, string> = { cfd: "Z6F18J", sb: "Z6F18K" };
const ACCOUNT_TYPE: Record<AccountKind, string> = { cfd: "CFD", sb: "SPREADBET" };

/** The session's account of a kind, by its type, or null. */
export function accountOf(sessionInfo: Record<string, unknown> | null, kind: AccountKind): string | null {
  const list = (sessionInfo?.accounts ?? []) as { accountId?: string; accountType?: string }[];
  const hit = Array.isArray(list) ? list.find((a) => a?.accountType === ACCOUNT_TYPE[kind]) : undefined;
  return hit?.accountId ?? null;
}

export const errText = (e: unknown) =>
  e instanceof IgHttpError ? `${e.status} ${e.code || e.message}` : e instanceof Error ? `${e.name === "IgRefused" ? "refused: " : ""}${e.message}` : String(e);

// ---------------------------------------------------------------------------------------------------------------------
// facts (G1): one account a call, about 34 requests 2.5 s apart (inside IG's 30 a minute per account).

export const FACTS_GAP_MS = 2_500;
export const FACTS_MAX_REQUESTS = 36;
/** At most this many fallback searches when the standard terms left a role without a candidate. */
const FALLBACK_SEARCHES = 8;

export type FactsRow = { id?: number; at?: string; account_kind: AccountKind; account_id: string | null; ok: boolean; selected: Record<string, string> };

export async function runFacts(o: { client: IgClient; rest: Rest; kind: AccountKind; pin: string | null }): Promise<Record<string, unknown>> {
  const { client, rest, kind } = o;
  const errors: string[] = [];
  const payload: Record<string, unknown> = {};
  let accountId: string | null = null;
  let selected: Record<string, string> = {};
  const pins = parsePins(o.pin);
  try {
    await client.login();
    payload.session = client.sessionInfo;
    accountId = accountOf(client.sessionInfo, kind);
    payload.expected_account = EXPECTED_DEMO_ACCOUNTS[kind];
    payload.expected_account_matches = accountId === EXPECTED_DEMO_ACCOUNTS[kind];
    if (!accountId) throw new Error(`the session lists no ${ACCOUNT_TYPE[kind]} account`);
    await client.switchTo(accountId);
    payload.accounts = stripBalances(await client.get("/accounts", 1));
    try {
      payload.navigation = await client.get("/marketnavigation", 1);
    } catch (e) {
      errors.push(`marketnavigation: ${errText(e)}`);
    }
    const searches: Record<string, SearchMarket[]> = {};
    for (const term of SEARCH_TERMS) {
      try {
        searches[term] = keepSearch(await client.get("/markets", 1, { searchTerm: term }));
      } catch (e) {
        errors.push(`search ${term}: ${errText(e)}`);
      }
    }
    let pick = pickEpics(Object.values(searches).flat(), pins);
    const fallbacks = [...new Set(pick.missing.map((r) => ROLES[r].fallback))].filter((t) => !(t in searches)).slice(0, FALLBACK_SEARCHES);
    for (const term of fallbacks) {
      try {
        searches[term] = keepSearch(await client.get("/markets", 1, { searchTerm: term }));
      } catch (e) {
        errors.push(`search ${term}: ${errText(e)}`);
      }
    }
    pick = pickEpics(Object.values(searches).flat(), pins);
    selected = pick.selected;
    payload.searches = searches;
    payload.candidates = pick.candidates;
    payload.missing = pick.missing;
    payload.pins = pins;
    const details: Record<string, unknown> = {};
    for (const epic of [...new Set(Object.values(selected))]) {
      try {
        details[epic] = await client.get(`/markets/${epic}`, 3);
      } catch (e) {
        errors.push(`details ${epic}: ${errText(e)}`);
      }
    }
    payload.details = details;
    const audId = (details[selected.fx_audusd] as { instrument?: { marketId?: string } } | undefined)?.instrument?.marketId;
    if (audId) {
      try {
        payload.sentiment = await client.get(`/clientsentiment/${audId}`, 1);
      } catch (e) {
        errors.push(`sentiment: ${errText(e)}`);
      }
    }
  } catch (e) {
    errors.push(errText(e));
  }
  const ok = Object.keys(selected).length > 0;
  const row = client.scrub({
    account_kind: kind, account_id: accountId, ok, selected, payload, errors, requests: client.requests,
    clock_offset_ms: client.clockOffsetMs,
  });
  await rest.insert("ig_facts", row);
  return { action: "facts", account_kind: kind, account_id: accountId, ok, selected, missing: payload.missing ?? null, errors, requests: client.requests };
}

/** The newest successful `facts` row of each account kind. */
export async function latestFacts(rest: Rest): Promise<Partial<Record<AccountKind, FactsRow>>> {
  const out: Partial<Record<AccountKind, FactsRow>> = {};
  for (const kind of ACCOUNT_KINDS) {
    const rows = await rest.select<FactsRow>("ig_facts", `select=id,at,account_kind,account_id,ok,selected&account_kind=eq.${kind}&ok=eq.true&order=id.desc`, 1);
    if (rows[0]) out[kind] = rows[0];
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------
// history (G2): the frozen windows of a plan, each one request, newest weekend first, stopping before the allowance.

export const HISTORY_GAP_MS = 2_500;
export const HISTORY_MAX_REQUESTS = 22;
/** Never let a pull take the week's remaining allowance under this. */
export const ALLOWANCE_RESERVE = 500;
/** At most this many windows a call (a call stays well inside the platform's wall-clock limit). */
export const HISTORY_MAX_WINDOWS = 15;

type PullRow = { window_key: string; epic: string; ok: boolean; at: string; remaining_allowance: number | null; allowance_expiry_s: number | null };

/** What IG says is left of the week's allowance, if a pull in the current period said so. */
export function knownAllowance(pulls: readonly PullRow[], nowMs: number): { remaining: number; resetsAt: number } | null {
  // The newest: the latest `at`, and of equal ones the last in the list (the list is in id order).
  let p: PullRow | undefined;
  for (const x of pulls) {
    if (x.remaining_allowance === null || x.allowance_expiry_s === null) continue;
    if (!p || Date.parse(x.at) >= Date.parse(p.at)) p = x;
  }
  if (!p) return null;
  const resetsAt = Date.parse(p.at) + (p.allowance_expiry_s as number) * 1000;
  return resetsAt > nowMs ? { remaining: p.remaining_allowance as number, resetsAt } : null;
}

export async function runHistory(o: {
  client: IgClient | null; rest: Rest; kind: AccountKind; plan: string; max: number; dry: boolean; now: () => number;
}): Promise<Record<string, unknown>> {
  const { rest, kind } = o;
  if (!(o.plan in HISTORY_PLANS)) throw new Error(`unknown plan '${o.plan.slice(0, 20)}' (probe, fxw, wknd, esg)`);
  const plan = o.plan as HistoryPlanId;
  const facts = (await latestFacts(rest))[kind];
  if (!facts) return { action: "history", plan, error: `no facts row for ${kind}: run ?action=facts&account=${kind} first` };
  const windows = historyWindows(plan).filter((w) => facts.selected[w.role]);
  const pulls = await rest.select<PullRow>("ig_price_pulls", `select=window_key,epic,ok,at,remaining_allowance,allowance_expiry_s&account_kind=eq.${kind}&order=id.asc`);
  const done = new Set(pulls.filter((p) => p.ok).map((p) => `${p.window_key}|${p.epic}`));
  const pending = windows.filter((w) => !done.has(`${w.key}|${facts.selected[w.role]}`));
  const allowance = knownAllowance(pulls, o.now());
  const probed = pulls.some((p) => p.ok && p.window_key.startsWith("probe:"));
  const report: Record<string, unknown> = {
    action: "history", plan, account_kind: kind, windows: windows.length, pending: pending.length,
    allowance, budget_upper_bound: pending.reduce((s, w) => s + w.maxPoints, 0),
  };
  if (o.dry || !o.client) return { ...report, dry: true, next: pending.slice(0, o.max).map((w) => ({ key: w.key, epic: facts.selected[w.role], from: w.from, to: w.to, maxPoints: w.maxPoints })) };
  if (plan !== "probe" && !probed) return { ...report, refused: "G2: the probe plan runs first, and its answer is read, before any bulk pull" };
  if (plan !== "probe" && !allowance) return { ...report, refused: "the week's allowance is not known from a pull in the current period: run the probe plan again" };
  const client = o.client;
  let remaining = allowance?.remaining ?? null;
  const pulled: unknown[] = [];
  let stop: string | null = null;
  for (const w of pending.slice(0, Math.min(o.max, HISTORY_MAX_WINDOWS))) {
    if (remaining !== null && remaining - w.maxPoints < ALLOWANCE_RESERVE) {
      stop = `allowance: ${remaining} left, this window may cost ${w.maxPoints}, the reserve is ${ALLOWANCE_RESERVE}`;
      break;
    }
    if (plan === "probe" && w.maxPoints > 60) {
      stop = `probe window ${w.key} could cost ${w.maxPoints} points`;
      break;
    }
    const epic = facts.selected[w.role];
    const row: Record<string, unknown> = {
      account_kind: kind, account_id: facts.account_id, plan, role: w.role, epic, resolution: "HOUR", window_key: w.key,
      from_param: w.from, to_param: w.to, ok: false,
    };
    try {
      if (facts.account_id) await client.switchTo(facts.account_id);
      const a = await client.call("GET", `/prices/${epic}`, { version: 3, query: { resolution: "HOUR", from: w.from, to: w.to, pageSize: "0" } });
      const body = a.body as { prices?: unknown[]; metadata?: { allowance?: { remainingAllowance?: number; totalAllowance?: number; allowanceExpiry?: number } } };
      const al = body?.metadata?.allowance;
      row.status = a.status;
      row.raw = a.body;
      row.ok = a.status === 200 && Array.isArray(body?.prices);
      row.points = Array.isArray(body?.prices) ? body.prices.length : null;
      row.remaining_allowance = al?.remainingAllowance ?? null;
      row.total_allowance = al?.totalAllowance ?? null;
      row.allowance_expiry_s = al?.allowanceExpiry ?? null;
      if (typeof al?.remainingAllowance === "number") remaining = al.remainingAllowance;
      if (!row.ok) row.error = `${a.status} ${(a.body as { errorCode?: string })?.errorCode ?? ""}`.trim();
    } catch (e) {
      row.error = errText(e);
      if (e instanceof IgRefused) stop = row.error as string;
    }
    await rest.insert("ig_price_pulls", client.scrub(row));
    pulled.push(client.scrub({ key: w.key, epic, ok: row.ok, points: row.points ?? null, remaining: row.remaining_allowance ?? null, error: row.error ?? null }));
    if (/exceeded-account-historical-data-allowance/.test(String(row.error ?? ""))) {
      stop = "IG says the historical-data allowance is spent";
      break;
    }
    if (stop) break;
  }
  return { ...report, pulled, stop, remaining, requests: client.requests };
}

// ---------------------------------------------------------------------------------------------------------------------
// quotes (G4 by REST): in the weekend windows, two snapshots a minute (at its start and 30 s in) of each account's epics
// for the windows' roles, one `GET /markets?epics=…&filter=SNAPSHOT_ONLY` an account a snapshot.

export const QUOTES_MAX_REQUESTS = 18;
export const QUOTES_GAP_MS = 300;
/**
 * Each run logs in afresh, replaces tokens IG calls invalid at most once, and stops at the next such answer; it waits
 * after a switch. From 10-16 20:52 to 10-18 04:07 UTC two runs in three failed with 401 account-token-invalid: every
 * failing run had started on the session the previous minute's run left in this isolate, and each 401 led to another
 * login (up to five a run, ~190 an hour) that failed the same way, while every run that began with its own login
 * (237 of 237) and every run whose kept session was still good (12 of 12) succeeded. One login a run is 60 an hour.
 */
export const QUOTES_MAX_RELOGINS = 1;
export const QUOTES_SWITCH_WAIT_MS = 2_000;
/**
 * After that fix (deployed 04:19 UTC 10-18) 3 runs in 12 still failed in about a second: login, the first call 0.3 s
 * later refused (account-token-invalid, no switch), the re-login's call refused the same way; three more needed the
 * re-login. A fresh token is sometimes refused for a moment, so the recorder waits 2 s after a login or a switch, and
 * on a refusal tries the same tokens again after 3 s, twice, before its one re-login.
 */
export const QUOTES_LOGIN_WAIT_MS = 2_000;
/**
 * With those waits deployed (04:39 UTC), 4 runs in 15 still failed the same way, in ~10.7 s, waits and retries spent:
 * the token stayed refused, so timing is not the cause. Every failing run made no switch: the client took the fresh
 * login to be on the CFD account, as the login said, and called it there. IG keeps one current account per user, and
 * a run can end on the spread-bet account. So after every login the recorder now switches to the account it wants
 * even when the login says it is current (IG's "must be different" confirms it), reads the spread-bet account first
 * (S1b's FX), and a refusal on one account no longer stops the other.
 */
export const QUOTES_FORCE_SWITCH_AFTER_LOGIN = true;
/**
 * With that live (05:06 UTC), runs 05:07-05:16 kept a strict three-minute cycle: ok on one login, ok on two (the first
 * token refused), then a run with both accounts refused after its re-login; five logins in three minutes and not one
 * session ever logged out. IG documents no session cap (IG Labs FAQ "Limits": 60 non-trading requests a minute per app,
 * 30 per account, 10,000 history points a week; tokens live 12 h, or 6 h extended to 72 h, from the last call), but
 * every login left a live session behind it. So the recorder logs out (`DELETE /session`) at the end of every run, in a
 * finally, failures too, and logs the refused session out before its one re-login: at most one session of ours alive.
 */
export const QUOTES_LOGOUT = true;
/**
 * With a fresh login and a log-out every run (05:43-20:16 UTC 10-18, runs never overlapping), every run after a failed
 * run worked on its first login (210 of 210), while after an ok run the first login was refused 576 times in 662 (367
 * rescued by the re-login, 209 failed with both logins refused, client-token-invalid). A failed run's log-out ends a
 * session IG had already dropped; an ok run's ends a live one, and the next login is refused. Without log-outs but with
 * a login a minute (8cd5fb8e) the same cycle ran; the only clean stretch the recorder had (12 of 12) was on a session
 * kept between runs. So the session is kept: a run logs in only when it has none or IG refuses it, re-logs in at most
 * once (the refused session logged out first), and keeps a session that read without refusal for the next run. A run
 * that ends refused logs out and keeps nothing. The explicit switch at the start of every run stays (8cd5fb8e).
 */
export const QUOTES_KEEP_SESSION = true;
export const QUOTES_TOKEN_RETRIES = 2;
export const QUOTES_TOKEN_RETRY_WAIT_MS = 3_000;
/** The second snapshot is taken this long after the call started, if the call started early enough. */
export const SECOND_SAMPLE_MS = 30_000;
export const SECOND_SAMPLE_LATEST_START_MS = 25_000;

export type QuoteSample = {
  account_kind: AccountKind; account_id: string; epic: string; received_at: string;
  bid: number | null; offer: number | null; market_status: string; update_time: string | null; update_time_utc: string | null; delay_time: number | null;
};

/** The snapshots of one `/markets` answer. A market with no status is recorded `UNKNOWN`, never dropped. */
export function samplesOf(body: unknown, kind: AccountKind, accountId: string, receivedAt: string): QuoteSample[] {
  const list = (body as { marketDetails?: unknown })?.marketDetails;
  if (!Array.isArray(list)) return [];
  return list.map((m: { instrument?: { epic?: string }; snapshot?: Record<string, unknown> }) => {
    const s = m?.snapshot ?? {};
    const num = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? x : null);
    return {
      account_kind: kind, account_id: accountId, epic: String(m?.instrument?.epic ?? ""), received_at: receivedAt,
      bid: num(s.bid), offer: num(s.offer), market_status: typeof s.marketStatus === "string" ? s.marketStatus : "UNKNOWN",
      update_time: typeof s.updateTime === "string" ? s.updateTime : null,
      update_time_utc: typeof s.updateTimeUTC === "string" ? s.updateTimeUTC : null,
      delay_time: num(s.delayTime),
    };
  }).filter((x) => x.epic);
}

/** Each account's epics for the roles now active, from its newest facts row. */
export function quoteEpics(facts: Partial<Record<AccountKind, FactsRow>>, roles: readonly string[]): { kind: AccountKind; accountId: string; epics: string[] }[] {
  const out: { kind: AccountKind; accountId: string; epics: string[] }[] = [];
  for (const kind of ACCOUNT_KINDS) {
    const f = facts[kind];
    if (!f?.account_id) continue;
    const epics = [...new Set(roles.map((r) => f.selected?.[r]).filter((e): e is string => !!e))].slice(0, 50);
    if (epics.length) out.push({ kind, accountId: f.account_id, epics });
  }
  return out;
}

type RunRow = { id: number; ok: boolean; started_at: string; reported: boolean };

/**
 * Whether a failed run goes to the errors box: the first failure after a run that did not fail, and then once an hour
 * while the failures last. `prev` is the newest runs first.
 */
export function shouldReport(prev: readonly RunRow[], nowMs: number): boolean {
  const streak: RunRow[] = [];
  for (const r of prev) {
    if (r.ok) break;
    streak.push(r);
  }
  return !streak.some((r) => r.reported && nowMs - Date.parse(r.started_at) < 3_600_000);
}

export async function runQuotes(o: {
  makeClient: (session: IgSession | null) => IgClient; session: IgSession | null; rest: Rest; now: () => number;
  sleep: (ms: number) => Promise<void>; report: (message: string, context: unknown) => Promise<void>;
}): Promise<{ result: Record<string, unknown>; session: IgSession | null }> {
  const start = o.now();
  const { ids, roles } = activeWindows(start);
  if (!ids.length) return { result: { action: "quotes", skipped: "outside the recorder's windows" }, session: o.session };
  // The session the last clean run kept, if any (QUOTES_KEEP_SESSION); otherwise this run logs in.
  const client = o.makeClient(QUOTES_KEEP_SESSION ? o.session : null);
  const errors: string[] = [];
  const samples: QuoteSample[] = [];
  const perAccount: Partial<Record<AccountKind, { snapshots: number; errors: string[] }>> = {};
  let snapshots = 0;
  let changed: number | null = null;
  let plan: ReturnType<typeof quoteEpics> = [];
  try {
    plan = quoteEpics(await latestFacts(o.rest), roles);
    if (!plan.length) throw new Error("no facts row names an epic for these windows: run ?action=facts for each account");
    // The spread-bet account first (S1b's FX); `quoteEpics` lists it first.
    plan = [...plan].sort((a, b) => ACCOUNT_KINDS.indexOf(a.kind) - ACCOUNT_KINDS.indexOf(b.kind));
    if (!client.session) await client.login();
    // Accounts whose tokens IG refused again after the run's one re-login: not called again this run.
    const refused = new Set<AccountKind>();
    let forced = false;
    for (let k = 0; k < 2 && refused.size < plan.length; k++) {
      if (k === 1) {
        if (o.now() - start > SECOND_SAMPLE_LATEST_START_MS) break;
        const wait = start + SECOND_SAMPLE_MS - o.now();
        if (wait > 0) await o.sleep(wait);
      }
      // The first pass in plan order; the second with the account the session is on first, so it costs one switch.
      const order = k === 0 ? plan
        : [...plan].sort((a, b) => Number(b.accountId === client.session?.accountId) - Number(a.accountId === client.session?.accountId));
      for (const p of order) {
        if (refused.has(p.kind)) continue;
        const acct = (perAccount[p.kind] ??= { snapshots: 0, errors: [] });
        try {
          // The run's first call goes after a switch sent even if the login names this account (see above).
          await client.switchTo(p.accountId, !forced);
          forced = true;
          const body = await client.get("/markets", 2, { epics: p.epics.join(","), filter: "SNAPSHOT_ONLY" });
          const got = samplesOf(body, p.kind, p.accountId, new Date(o.now()).toISOString());
          samples.push(...got);
          snapshots += 1;
          acct.snapshots += 1;
          const missing = p.epics.filter((e) => !got.some((g) => g.epic === e));
          if (missing.length) errors.push(`${p.kind}: no snapshot for ${missing.join(",")}`);
        } catch (e) {
          errors.push(`${p.kind}: ${errText(e)}`);
          acct.errors.push(errText(e));
          if (e instanceof IgRefused) throw e;
          // Tokens refused again after this run's one re-login: this account is left for the minute, not the other.
          if (e instanceof IgHttpError && isTokenError(e.status, e.code) && client.relogins >= QUOTES_MAX_RELOGINS) {
            refused.add(p.kind);
          }
        }
      }
    }
    if (samples.length) changed = await o.rest.rpc<number>("ig_quotes_record", { samples: client.scrub(samples) });
  } catch (e) {
    errors.push(errText(e));
  } finally {
    // A session IG refused in this run is ended and not kept; a clean one is kept for the next run (QUOTES_KEEP_SESSION).
    const refusedHere = errors.some((e) => /token-invalid|token-missing/.test(e));
    if (!QUOTES_KEEP_SESSION || refusedHere || snapshots === 0) await client.logout();
  }
  const ok = snapshots > 0 && errors.length === 0;
  const run: Record<string, unknown> = client.scrub({
    started_at: new Date(start).toISOString(), windows: ids, ok, snapshots, samples: samples.length, changed,
    requests: client.requests, logins: client.logins, switches: client.switches, clock_offset_ms: client.clockOffsetMs,
    ms: o.now() - start, error: errors.length ? errors.join("; ").slice(0, 1000) : null, reported: false,
  });
  // One error-box row when a run fails after one that did not, then one an hour while it lasts: not one a minute.
  if (!ok) {
    try {
      const prev = await o.rest.select<RunRow>("ig_quote_runs", "select=id,ok,started_at,reported&order=id.desc", 120);
      if (shouldReport(prev, start)) {
        await o.report(String(run.error ?? "quotes failed"), { windows: ids, snapshots });
        run.reported = true;
      }
    } catch { /* the run row below still records the failure */ }
  }
  try {
    await o.rest.insert("ig_quote_runs", run);
  } catch (e) {
    errors.push(`run row: ${errText(e)}`);
  }
  // The same-token retries are in the answer, not the row (ig_quote_runs has no column for them; `requests` counts them).
  return {
    result: { action: "quotes", ...run, token_retries: client.tokenRetriesUsed, logouts: client.logouts, accounts: client.scrub(perAccount) },
    session: client.session,
  };
}

