// ig — IG's demo REST API for the FXW / WKND verification, READ-ONLY and DEMO-ONLY (spec:
// docs/agents/backtests/ig_deepdive/SPEC-for-verification.md; review: docs/agents/reviews/2026-10-15-ig-verification.md).
//
// Davies, 2026-10-15: "ig我的账户开好了，api也加了" — the demo and live keys are Edge secrets he stored and tested — and
// "FXW-AUD你继续验证研究并记录". The spec's hard rule 3 reserved an Edge Function for his ask; the secrets live only in
// Supabase, so reaching IG from here is the only way that never prints or moves them. This function reads the three
// DEMO secrets and nothing else of IG's; the live ones are read by no code in this folder (a vitest pins that).
//
//   POST ?action=facts&account=sb|cfd[&pin=role:EPIC,…]   G1: the session's accounts (balances stripped), the market
//        navigation's root, IG's search answers for the roles, the chosen epics and their `/markets/{epic}` details, and
//        AUD/USD's client sentiment → one `ig_facts` row. One account a call, ~34 requests 2.5 s apart (~90 s).
//        Answered 202 at once; the work runs on under `waitUntil` and writes its report to `ig_action_log`.
//   POST ?action=history&account=sb|cfd&plan=probe|fxw|wknd|esg[&max=N][&dry=1]   G2: the plan's frozen windows (HOUR
//        bars, newest weekend first), one request each, never past the week's allowance less a 500-point reserve; the
//        probe plan runs first. Each answer, raw, → `ig_price_pulls`; answered 202 at once as `facts` is. `dry=1` lists
//        what would be pulled, calls nothing, and answers with it.
//   POST ?action=quotes   G4's recorder by REST: in the weekend windows (`windows.ts`), two snapshots a minute of each
//        demo account's epics → `ig_quotes` (a row when a quote changes) and `ig_quote_runs` (every run). A row of the
//        one-minute job (0122), switched on only around the windows.
//
// Auth: `Authorization: Bearer <CRON_SECRET>` (pg_net with the Vault `cron_secret`) or an admin `x-app-token`; deployed
// --no-verify-jwt (PUBLIC_FNS in edge-functions.yml). Secrets: IG_API_KEY_DEMO, IG_DEMO_USERNAME, IG_DEMO_PASSWORD; never
// echoed, and scrubbed with the session tokens from every answer, row and error.

import { reportServerError } from "../_shared/ops.ts";
import { constantTimeEqual, verifyToken } from "../_shared/token.ts";
import { beatKeyOfRequest, writeBeat } from "../_shared/beats.ts";
import { demoCreds, IgClient, scrubDeep, type IgSession } from "./client.ts";
import {
  FACTS_GAP_MS, FACTS_MAX_REQUESTS, HISTORY_GAP_MS, HISTORY_MAX_REQUESTS, HISTORY_MAX_WINDOWS, QUOTES_GAP_MS, QUOTES_MAX_RELOGINS,
  QUOTES_FORCE_SWITCH_AFTER_LOGIN, QUOTES_LOGIN_WAIT_MS, QUOTES_LOGOUT, QUOTES_MAX_REQUESTS, QUOTES_SWITCH_WAIT_MS, QUOTES_TOKEN_RETRIES, QUOTES_TOKEN_RETRY_WAIT_MS,
  restClient, runFacts, runHistory, runQuotes, type AccountKind, type Rest,
} from "./actions.ts";
import { HISTORY_PLANS } from "./windows.ts";

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/** The scheduler's bearer, or an admin app token. Nothing here is for a read-only token or the page. */
export async function authorise(req: Request, cronSecret: string, verify = verifyToken): Promise<"cron" | "admin" | null> {
  const auth = req.headers.get("authorization") ?? "";
  if (cronSecret && auth.startsWith("Bearer ") && constantTimeEqual(auth.slice(7).trim(), cronSecret)) return "cron";
  const token = req.headers.get("x-app-token") ?? "";
  if (token && (await verify(token))?.role === "admin") return "admin";
  return null;
}

export type Deps = {
  env: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
  rest: Rest;
  beat: (key: string) => Promise<boolean>;
  report: (kind: string, message: string, context: unknown) => Promise<void>;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  verify?: typeof verifyToken;
  /** Keeps the worker until a promise settles (`EdgeRuntime.waitUntil`). */
  keepAlive: (p: Promise<unknown>) => void;
  /** Where the recorder's kept session lives: this isolate's memory unless a test gives its own. */
  sessionStore?: SessionStore;
};

export type SessionStore = { session: IgSession | null };

/**
 * The recorder's session, kept between runs in this isolate (memory only: never stored, never returned) when the run
 * that used it read without a refusal (actions.ts, QUOTES_KEEP_SESSION says why).
 */
const isolateStore: SessionStore = { session: null };

export async function handle(req: Request, d: Deps): Promise<Response> {
  // The beat first, before anything else the call does (`_shared/beats.ts`; the watchdog reads it).
  await d.beat(beatKeyOfRequest("ig", req.url)).catch(() => false);
  const who = await authorise(req, d.env.CRON_SECRET ?? "", d.verify);
  if (!who) return json(401, { error: "unauthorised" });
  if (req.method !== "POST") return json(405, { error: "POST only" });
  const url = new URL(req.url);
  const action = url.searchParams.get("action") ?? "";
  const creds = demoCreds(d.env);
  if ("missing" in creds) return json(503, { error: "IG demo credentials not set", missing: creds.missing });
  const secrets = [creds.key, creds.username, creds.password];
  const kindParam = url.searchParams.get("account") ?? "sb";
  try {
    if (action === "facts" || action === "history") {
      if (kindParam !== "sb" && kindParam !== "cfd") return json(400, { error: "account is sb or cfd" });
      const kind = kindParam as AccountKind;
      const plan = url.searchParams.get("plan") ?? "";
      if (action === "history" && !(plan in HISTORY_PLANS)) return json(400, { error: "plan is probe, fxw, wknd or esg" });
      const dry = action === "history" && url.searchParams.get("dry") === "1";
      const max = Math.max(1, Math.min(HISTORY_MAX_WINDOWS, Number(url.searchParams.get("max") ?? "6") || 6));
      const pin = url.searchParams.get("pin");
      const params = { account: kind, ...(action === "history" ? { plan, max, dry } : { pin }) };
      let client: IgClient | null = null;
      const work = async (): Promise<Record<string, unknown>> => {
        if (action === "facts") {
          client = new IgClient({ creds, fetchImpl: d.fetchImpl, maxRequests: FACTS_MAX_REQUESTS, minGapMs: FACTS_GAP_MS, sleep: d.sleep, now: d.now });
          return client.scrub(await runFacts({ client, rest: d.rest, kind, pin }));
        }
        client = dry ? null : new IgClient({ creds, fetchImpl: d.fetchImpl, maxRequests: HISTORY_MAX_REQUESTS, minGapMs: HISTORY_GAP_MS, sleep: d.sleep, now: d.now });
        return await runHistory({ client, rest: d.rest, kind, plan, max, dry, now: d.now });
      };
      const scrubbed = (v: unknown) => scrubDeep(v, client ? (client as IgClient).secrets() : secrets);
      const log = (result: unknown) => d.rest.insert("ig_action_log", { action, params, result: scrubbed(result) }).catch(() => {});
      if (dry) {
        const out = scrubbed(await work());
        return json(200, out);
      }
      // A facts call takes ~90 s and a history call up to ~40 s: answered at once, so a call fired through pg_net never
      // holds the one-minute job's next batch; the work goes on under `waitUntil` and writes its report to `ig_action_log`.
      d.keepAlive(
        work().then(log).catch(async (e) => {
          const message = String(scrubbed(e instanceof Error ? e.message : String(e))).slice(0, 300);
          await d.report(`ig.${action}`, `crashed: ${message}`, params).catch(() => {});
          await log({ error: message });
        }),
      );
      return json(202, { accepted: true, action, params, result: "written to public.ig_action_log, and the rows to ig_facts / ig_price_pulls" });
    }
    if (action === "quotes") {
      const { result, session } = await runQuotes({
        makeClient: (s) => new IgClient({
          creds, fetchImpl: d.fetchImpl, maxRequests: QUOTES_MAX_REQUESTS, minGapMs: QUOTES_GAP_MS, sleep: d.sleep, now: d.now, session: s,
          maxRelogins: QUOTES_MAX_RELOGINS, switchWaitMs: QUOTES_SWITCH_WAIT_MS, loginWaitMs: QUOTES_LOGIN_WAIT_MS,
          tokenRetries: QUOTES_TOKEN_RETRIES, tokenRetryWaitMs: QUOTES_TOKEN_RETRY_WAIT_MS,
          forceSwitchAfterLogin: QUOTES_FORCE_SWITCH_AFTER_LOGIN, logoutBeforeRelogin: QUOTES_LOGOUT,
        }),
        session: (d.sessionStore ?? isolateStore).session, rest: d.rest, now: d.now, sleep: d.sleep, report: (m, c) => d.report("ig.quotes", m, c),
      });
      (d.sessionStore ?? isolateStore).session = session;
      return json(200, scrubDeep(result, [...secrets, session?.cst ?? "", session?.xst ?? ""]));
    }
    return json(404, { error: `unknown action '${action.slice(0, 20)}'` });
  } catch (e) {
    const message = scrubDeep(e instanceof Error ? e.message : String(e), [...secrets, (d.sessionStore ?? isolateStore).session?.cst ?? "", (d.sessionStore ?? isolateStore).session?.xst ?? ""]).slice(0, 300);
    await d.report(`ig.${/^[a-z]{1,10}$/.test(action) ? action : "unknown"}`, `crashed: ${message}`, { action: action.slice(0, 20) }).catch(() => {});
    return json(500, { error: "ig crashed", message });
  }
}

if (import.meta.main) {
  Deno.serve((req: Request) =>
    handle(req, {
      env: Deno.env.toObject(),
      rest: restClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""),
      beat: (key) => writeBeat(key),
      report: (kind, message, context) => reportServerError(kind, { message, context }),
      now: Date.now,
      sleep: (ms) => new Promise<void>((r) => setTimeout(r, ms)),
      keepAlive: (p) => {
        const rt = (globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime;
        try {
          rt?.waitUntil?.(p);
        } catch { /* without it the worker may stop before the work ends; the action log then lacks its row */ }
      },
    })
  );
}
