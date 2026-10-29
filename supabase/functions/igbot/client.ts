// IGBOT's IG client: the DEMO dealing host and nothing else (docs/agents/reviews/2026-10-29-igbot-research.md §5;
// pre-registration draft docs/agents/reviews/2026-10-29-igbot-prereg.md).
//
// Davies, 2026-10-28: "…你仔细深度研究下是否可以做个类似的做ig的cfd/options/spread betting的trading bot并搭建架构…". The bot is
// built for IG's demo environment only. What this file guarantees, before anything is sent:
//
//   * One host. Every request is built on `IGBOT_DEMO_BASE` and checked by `assertIgbotAllowed`: any other origin (the
//     live host `api.ig.com` above all), scheme, port or path prefix throws `IgbotRefused`. There is no live host in this
//     folder and no live secret is read: going live is a code change, a migration and Davies' word, never a switch.
//   * One list of calls. Log in, switch account and log out (`/session`); GET the accounts, markets, a market's HOUR
//     bars (`/prices/{epic}`, for the reading), positions, working orders, a deal's confirmation and the account's
//     activity history; open a spread-bet position (`POST
//     /positions/otc`), close one (`POST /positions/otc` with `_method: DELETE`, IG's documented form for a DELETE with a
//     body), amend its stop or limit (`PUT /positions/otc/{dealId}`), place and delete a working order. Nothing else:
//     no watchlist, no application, no transfer, no funds path.
//   * No secret leaves. The API key, username, password and both session tokens are scrubbed (`scrubDeep`, shared with
//     the read-only `ig` function) from every answer and error. The session tokens live in memory and, for the other
//     isolates, in the database only sealed (AES-GCM under a key derived from the demo secrets, `IGBOT_SESSION`): a reader
//     of the row holds nothing IG would accept.
//   * IG's allowances (IG Labs FAQ, "Limits"): 30 non-trading and 100 trading requests a minute per account on live; the
//     demo's are lower and IG changes them without notice (trading-ig's FAQ; IG reports a key's own as
//     `allowanceAccountOverall` and `allowanceAccountTrading` from `GET /operations/application`, which this client does
//     not call: read them once by hand before the arm). The client counts both a minute at a time, across every client this
//     isolate makes (until the 2026-10-29 audit each request's new client counted from zero), and refuses past
//     `IGBOT_IG_LIMITS`; `index.ts` holds every isolate together to a minute's budget kept in `igbot_requests`.

import { igErrorCode, isTokenError, scrubDeep } from "../ig/client.ts";

/** The only host this code calls: IG's demo REST gateway. */
export const IGBOT_DEMO_BASE = "https://demo-api.ig.com/gateway/deal";
/** The environment, as a constant: the config table holds the same value under a check that allows nothing else. */
export const IGBOT_ENVIRONMENT = "demo" as const;
/** The Edge secrets read: the demo login, and the demo spread-bet account the bot trades (never the live ones). */
export const IGBOT_SECRET_NAMES = {
  key: "IGBOT_DEMO_API_KEY", username: "IGBOT_DEMO_USERNAME", password: "IGBOT_DEMO_PASSWORD", account: "IGBOT_DEMO_ACCOUNT_ID",
} as const;
/** Requests a rolling minute this client sends at most, under IG's 30 non-trading and 100 trading per account. */
export const IGBOT_IG_LIMITS = { nonTradingPerMinute: 24, tradingPerMinute: 20 } as const;

const EPIC = "[A-Za-z0-9._]{6,30}";
const DEAL = "[A-Za-z0-9_-]{1,40}";
/** Method, path (after `/gateway/deal`) and whether it is a trading request (IG counts those apart). */
export const IGBOT_ALLOWED: ReadonlyArray<readonly [string, RegExp, boolean]> = [
  ["POST", /^\/session$/, false],
  ["PUT", /^\/session$/, false],
  ["DELETE", /^\/session$/, false],
  ["GET", /^\/accounts$/, false],
  ["GET", /^\/markets$/, false],
  ["GET", new RegExp(`^/markets/${EPIC}$`), false],
  ["GET", new RegExp(`^/prices/${EPIC}$`), false],
  ["GET", /^\/positions$/, false],
  ["GET", /^\/workingorders$/, false],
  ["GET", new RegExp(`^/confirms/${DEAL}$`), false],
  ["GET", /^\/history\/activity$/, false],
  // Open, and (with `_method: DELETE`) close: one path, both trading requests.
  ["POST", /^\/positions\/otc$/, true],
  ["PUT", new RegExp(`^/positions/otc/${DEAL}$`), true],
  ["POST", /^\/workingorders\/otc$/, true],
  ["DELETE", new RegExp(`^/workingorders/otc/${DEAL}$`), true],
];
const ALLOWED_QUERY: Record<string, ReadonlySet<string>> = {
  "/markets": new Set(["epics"]),
  "/history": new Set(["from", "to", "detailed", "dealId", "pageSize"]),
  "/prices": new Set(["resolution", "max", "pageSize"]),
};

export class IgbotRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IgbotRefused";
  }
}

/** The guard: demo host, the list's method and path, the list's query parameters. Returns whether it is a trading request. */
export function assertIgbotAllowed(method: string, url: string): { path: string; trading: boolean } {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new IgbotRefused("refused: not a URL");
  }
  const base = new URL(IGBOT_DEMO_BASE);
  if (u.protocol !== "https:" || u.host !== base.host || u.username || u.password) {
    throw new IgbotRefused(`refused: host ${u.protocol}//${u.host} is not the IG demo host`);
  }
  if (!u.pathname.startsWith(base.pathname + "/")) throw new IgbotRefused(`refused: path ${u.pathname} is outside ${base.pathname}`);
  const path = u.pathname.slice(base.pathname.length);
  if (path.includes("..") || path.includes("//")) throw new IgbotRefused(`refused: path ${path}`);
  const m = method.toUpperCase();
  const hit = IGBOT_ALLOWED.find(([am, re]) => am === m && re.test(path));
  if (!hit) throw new IgbotRefused(`refused: ${m} ${path} is not on the bot's list`);
  if (m !== "GET" && u.search) throw new IgbotRefused(`refused: ${m} ${path} carries a query`);
  const allowedQ = ALLOWED_QUERY["/" + path.split("/")[1]] ?? new Set<string>();
  for (const k of u.searchParams.keys()) if (!allowedQ.has(k)) throw new IgbotRefused(`refused: query parameter ${k} on ${path}`);
  return { path, trading: hit[2] };
}

export type IgbotCreds = { key: string; username: string; password: string; accountId: string };
/** The demo credentials from the environment, or the names that are missing (names only, never a value). */
export function igbotCreds(env: Record<string, string | undefined>): IgbotCreds | { missing: string[] } {
  const N = IGBOT_SECRET_NAMES;
  const key = (env[N.key] ?? "").trim(), username = (env[N.username] ?? "").trim(), password = env[N.password] ?? "";
  const accountId = (env[N.account] ?? "").trim();
  const missing = [[N.key, key], [N.username, username], [N.password, password], [N.account, accountId]].filter(([, v]) => !v).map(([n]) => n);
  return missing.length ? { missing } : { key, username, password, accountId };
}

/** A session: its tokens, the account they are on, when it was logged in, and whether its switch to the account is done. */
export type IgbotSession = { cst: string; xst: string; accountId: string; accountType: string | null; at: number; ready: boolean };
export type IgbotAnswer = { status: number; body: unknown; ms: number };

export class IgbotHttpError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "IgbotHttpError";
    this.status = status;
    this.code = code;
  }
}

/**
 * A session with whichever of CST and X-SECURITY-TOKEN an answer's headers carry, each on its own: the X-SECURITY-TOKEN
 * names the current account, so `PUT /session` answers with a new one and no CST (the `ig` function's lesson of
 * 2026-10-15).
 */
export function withTokens<S extends { cst: string; xst: string }>(s: S, headers: Headers): S {
  const cst = headers.get("CST"), xst = headers.get("X-SECURITY-TOKEN");
  return { ...s, ...(cst ? { cst } : {}), ...(xst ? { xst } : {}) };
}

/**
 * How the session is handled (2026-10-29). In its first two hours on the demo the minute's sync was refused in 14 of the
 * 58 minutes that logged in, every time on the account switch right after the login (401
 * `error.security.account-token-invalid`; `igbot_requests` 00:16-02:00 UTC). The session lived only in an isolate's
 * memory and about half the minutes land in a fresh isolate (57 of 115 reused one: three IG calls, no login, never
 * refused), and a fresh isolate's sync logged in THREE times at once: its three reads (accounts, positions, working
 * orders) each found no session and each logged in and switched (nine calls a minute ok, six when all three switches
 * were refused, eight when one was). After a minute that had logged in, the next minute's logins were refused 13 times in
 * 17; after a minute that reused its session, 0 in 28. IG keeps one good session per login, and these were IGBOT's own
 * logins fighting each other. So, as the `ig` recorder learnt on 10-16..18 (`ig/actions.ts`, `QUOTES_*`):
 *
 *   * one session for the whole function: kept between isolates by the keeper (`igbot_exec_state.session_box`, 0165),
 *     sealed with AES-GCM under a key derived from the demo secrets, so the database holds no usable token; a request
 *     logs in only when there is none or IG refuses it;
 *   * one login at a time: the reads of a request share one login, and across isolates the login is claimed
 *     (`igbot_exec_state.login_until`); a request that finds another logging in waits for its session;
 *   * a wait after a login and after the switch, since a token IG has just issued is sometimes refused for a moment, and
 *     on a refusal the same tokens are tried again before anything logs in again;
 *   * after every login the switch to the configured account, even when the login names it as current: IG keeps one
 *     current account per user;
 *   * a refused session is logged out before the re-login (at most one session of ours alive), the re-login no sooner than
 *     18 s after the refused one's own login, and at most one re-login a request. A good session is never logged out.
 */
export const IGBOT_SESSION = {
  loginWaitMs: 2_000,
  switchWaitMs: 1_000,
  tokenRetries: 1,
  tokenRetryWaitMs: 3_000,
  reloginWaitMs: 18_000,
  /** A request's first login and one re-login. */
  maxLogins: 2,
  /** How long an isolate holds the right to log in; longer than a login with its waits and one re-login. */
  loginClaimMs: 30_000,
  /** How long a request waits for another isolate's login to store its session, and how often it looks. */
  adoptWaitMs: 20_000,
  adoptPollMs: 1_000,
} as const;

/** Where the session is kept between isolates, sealed (`igbotSessionKeeper` in `index.ts`: one row of `igbot_exec_state`). */
export type IgbotSessionKeeper = {
  /** The sealed session, or null. */
  load(): Promise<string | null>;
  save(box: string): Promise<void>;
  /** Forgets the sealed session only while it is still this one (another isolate's newer one stays). */
  clear(box: string): Promise<void>;
  /** The right to log in, for `IGBOT_SESSION.loginClaimMs`: a claim to release, or null while another isolate holds it. */
  claimLogin(now: number): Promise<string | null>;
  releaseLogin(claim: string): Promise<void>;
};

const enc = new TextEncoder();
const b64u = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64u = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4)), (ch) => ch.charCodeAt(0));

/** The sealing key: SHA-256 of the four demo secrets. It never leaves the function; a new password makes old boxes unreadable. */
async function sessionKey(c: IgbotCreds): Promise<CryptoKey> {
  const raw = await crypto.subtle.digest("SHA-256", enc.encode(["igbot-session-v1", c.key, c.username, c.password, c.accountId].join("\n")));
  return await crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}
const aad = (c: IgbotCreds) => enc.encode(`igbot-session|${c.accountId}`);

/** A ready session sealed for the keeper: `v1.<iv>.<ciphertext>`, base64url. */
export async function sealSession(s: IgbotSession, c: IgbotCreds): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plain = enc.encode(JSON.stringify({ cst: s.cst, xst: s.xst, accountId: s.accountId, at: s.at }));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: aad(c) }, await sessionKey(c), plain));
  return `v1.${b64u(iv)}.${b64u(ct)}`;
}

/** A sealed session opened, or null when it is not one this login sealed for this account. Never throws. */
export async function openSession(box: string, c: IgbotCreds): Promise<IgbotSession | null> {
  try {
    const [v, iv, ct, extra] = box.split(".");
    if (v !== "v1" || !iv || !ct || extra !== undefined) return null;
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64u(iv), additionalData: aad(c) }, await sessionKey(c), unb64u(ct));
    const o = JSON.parse(new TextDecoder().decode(plain)) as Record<string, unknown>;
    if (typeof o.cst !== "string" || !o.cst || typeof o.xst !== "string" || !o.xst || o.accountId !== c.accountId || typeof o.at !== "number") return null;
    return { cst: o.cst, xst: o.xst, accountId: c.accountId, accountType: "SPREADBET", at: o.at, ready: true };
  } catch {
    return null;
  }
}

export type IgbotSessionStore = { s: IgbotSession | null; box?: string | null };
/** This isolate's copy of the session (and of the sealed box it came from): memory only, never returned. */
const isolateSession: IgbotSessionStore = { s: null };
/** Every IG request this isolate sent in the last minute, whichever client sent it. */
const isolateSent: Array<{ at: number; trading: boolean }> = [];

export type IgbotClientOpts = {
  creds: IgbotCreds;
  fetchImpl?: typeof fetch;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  timeoutMs?: number;
  /** Where the session is kept in this isolate; this isolate's memory unless a test gives its own. */
  store?: IgbotSessionStore;
  /** Where it is kept between isolates (production: the database, sealed); none, and it lives in `store` alone. */
  keeper?: IgbotSessionKeeper;
  /** Where the minute's requests are counted; this isolate's list unless a test gives its own. */
  sent?: Array<{ at: number; trading: boolean }>;
};

const refusedTokens = (a: IgbotAnswer) => isTokenError(a.status, igErrorCode(a.body));

/**
 * One request's client. Takes the function's session (this isolate's, else the keeper's), logs in only when there is none
 * or IG refuses it (`IGBOT_SESSION`), puts it on the configured demo account (refusing any account that is not a
 * spread-bet account), and counts every request a minute at a time.
 */
export class IgbotClient {
  readonly opts: IgbotClientOpts;
  private store: IgbotSessionStore;
  private sent: Array<{ at: number; trading: boolean }>;
  private tokensSeen: string[] = [];
  /** Session work (adopting, logging in, renewing) runs one at a time: the reads of a request share one login. */
  private queue: Promise<unknown> = Promise.resolve();
  private checked = false;
  /** A login that failed for a reason other than refused tokens ends logging in for this client. */
  private loginError: Error | null = null;
  requests = 0;
  logins = 0;
  switches = 0;
  logouts = 0;
  tokenRetriesUsed = 0;
  /** Sessions taken from the keeper (another isolate's login). */
  adopted = 0;

  constructor(opts: IgbotClientOpts) {
    this.opts = opts;
    this.store = opts.store ?? isolateSession;
    this.sent = opts.sent ?? isolateSent;
  }

  secrets(): string[] {
    const c = this.opts.creds, s = this.store.s;
    if (s) for (const t of [s.cst, s.xst]) if (t && !this.tokensSeen.includes(t)) this.tokensSeen.push(t);
    return [c.key, c.username, c.password, ...this.tokensSeen];
  }
  scrub<T>(v: T): T {
    return scrubDeep(v, this.secrets());
  }

  private now(): number {
    return (this.opts.now ?? Date.now)();
  }
  private async pause(ms: number): Promise<void> {
    if (ms > 0) await (this.opts.sleep ?? ((x: number) => new Promise<void>((r) => setTimeout(r, x))))(ms);
  }
  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn);
    this.queue = run.catch(() => {});
    return run;
  }

  private budget(trading: boolean): void {
    const now = this.now();
    // Pruned in place: the list is shared by every client of the isolate.
    for (let i = this.sent.length - 1; i >= 0; i--) if (this.sent[i].at <= now - 60e3) this.sent.splice(i, 1);
    const n = this.sent.filter((r) => r.trading === trading).length;
    const cap = trading ? IGBOT_IG_LIMITS.tradingPerMinute : IGBOT_IG_LIMITS.nonTradingPerMinute;
    if (n >= cap) throw new IgbotRefused(`refused: ${n} ${trading ? "trading" : "non-trading"} requests in the last minute, at most ${cap}`);
    this.sent.push({ at: now, trading });
  }

  private async raw(method: string, path: string, o: { query?: Record<string, string>; body?: unknown; version: number; session: IgbotSession | null; override?: "DELETE" }) {
    const url = new URL(IGBOT_DEMO_BASE + path);
    for (const [k, v] of Object.entries(o.query ?? {})) url.searchParams.set(k, v);
    const { trading } = assertIgbotAllowed(method, url.toString());
    this.budget(trading);
    this.requests += 1;
    const headers: Record<string, string> = {
      "X-IG-API-KEY": this.opts.creds.key, "Accept": "application/json; charset=UTF-8", "Version": String(o.version),
    };
    if (o.body !== undefined) headers["Content-Type"] = "application/json; charset=UTF-8";
    if (o.override) headers["_method"] = o.override;
    if (o.session) {
      headers["CST"] = o.session.cst;
      headers["X-SECURITY-TOKEN"] = o.session.xst;
    }
    const t0 = this.now();
    const res = await (this.opts.fetchImpl ?? fetch)(url.toString(), {
      method, headers, body: o.body === undefined ? undefined : JSON.stringify(o.body), signal: AbortSignal.timeout(this.opts.timeoutMs ?? 10_000),
    });
    const text = await res.text();
    let body: unknown = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = { unparsed: text.slice(0, 300) };
    }
    return { answer: { status: res.status, body, ms: this.now() - t0 } as IgbotAnswer, headers: res.headers };
  }

  private usable(): boolean {
    const s = this.store.s;
    return !!s && s.ready && s.accountId === this.opts.creds.accountId;
  }

  /** The keeper's session when it holds one this isolate does not have; true when taken. */
  private async adoptStored(): Promise<boolean> {
    const k = this.opts.keeper;
    if (!k) return false;
    const box = await k.load().catch(() => null);
    if (!box || box === this.store.box) return false;
    const s = await openSession(box, this.opts.creds);
    if (!s) return false;
    this.store.s = s;
    this.store.box = box;
    this.adopted += 1;
    this.secrets();
    return true;
  }

  private async keep(): Promise<void> {
    const k = this.opts.keeper, s = this.store.s;
    if (!k || !s?.ready) return;
    const box = await sealSession(s, this.opts.creds);
    this.store.box = box;
    await k.save(box).catch(() => {});
  }

  /** The session to call on: this isolate's, else the keeper's, else a login. One at a time, so concurrent reads share it. */
  private async ensure(): Promise<IgbotSession> {
    await this.exclusive(async () => {
      if (!this.checked) {
        this.checked = true;
        await this.adoptStored();
      }
      if (!this.usable()) await this.logIn();
    });
    return this.store.s!;
  }

  /** A session IG refused on `used`: taken over by a newer one when a call beside it or another isolate has one, else replaced. */
  private async renew(used: IgbotSession): Promise<void> {
    await this.exclusive(async () => {
      if (this.usable() && this.store.s!.xst !== used.xst) return;
      if (await this.adoptStored()) return;
      await this.logIn();
    });
  }

  /** A login under the function's claim, with one re-login when IG refuses the new tokens. Runs inside `exclusive`. */
  private async logIn(): Promise<void> {
    if (this.loginError) throw this.loginError;
    const k = this.opts.keeper;
    // An unreadable claim does not stop the login: the keeper's database is down, and the session cannot be shared anyway.
    const claim = k ? await k.claimLogin(this.now()).catch(() => "") : "";
    if (claim === null) {
      // Another isolate is logging in: two logins at once are what IG refuses, so its session is this request's too.
      const until = this.now() + IGBOT_SESSION.adoptWaitMs;
      while (this.now() < until) {
        await this.pause(IGBOT_SESSION.adoptPollMs);
        if (await this.adoptStored()) return;
      }
      throw (this.loginError = new IgbotRefused("refused: another request was logging in to IG and stored no session in time"));
    }
    try {
      let last: Error | null = null;
      while (this.logins < IGBOT_SESSION.maxLogins) {
        const refused = this.store.s;
        if (refused) {
          // The refused session first: the re-login no sooner than `reloginWaitMs` after its own login, then it is logged
          // out, so at most one session of ours is alive.
          await this.pause(refused.at + IGBOT_SESSION.reloginWaitMs - this.now());
          await this.logout();
        }
        try {
          await this.loginOnce();
          await this.keep();
          return;
        } catch (e) {
          if (!(e instanceof IgbotHttpError && isTokenError(e.status, e.code))) throw (this.loginError = e as Error);
          last = e;
        }
      }
      // Refused to the end: the last session is logged out too, so nothing of ours is left alive for the next login.
      await this.logout();
      throw (this.loginError = last ?? new IgbotRefused(`refused: this request's ${IGBOT_SESSION.maxLogins} logins are spent`));
    } finally {
      if (k && claim) await k.releaseLogin(claim).catch(() => {});
    }
  }

  /** `POST /session` (version 2), a pause, `PUT /session` onto the configured account (always), a pause. */
  private async loginOnce(): Promise<void> {
    const c = this.opts.creds;
    this.logins += 1;
    this.store.s = null;
    this.store.box = null;
    const { answer, headers } = await this.raw("POST", "/session", { version: 2, session: null, body: { identifier: c.username, password: c.password, encryptedPassword: false } });
    const cst = headers.get("CST") ?? "", xst = headers.get("X-SECURITY-TOKEN") ?? "";
    if (answer.status !== 200 || !cst || !xst) {
      const code = igErrorCode(answer.body);
      throw new IgbotHttpError(answer.status, code, this.scrub(`login refused: ${answer.status} ${code || JSON.stringify(answer.body).slice(0, 200)}`));
    }
    const b = (answer.body ?? {}) as { currentAccountId?: string; accounts?: Array<{ accountId?: string; accountType?: string }> };
    const s: IgbotSession = { cst, xst, accountId: String(b.currentAccountId ?? ""), accountType: null, at: this.now(), ready: false };
    this.store.s = s;
    this.secrets();
    const target = (b.accounts ?? []).find((a) => a.accountId === c.accountId);
    if (!target) {
      await this.logout();
      throw new IgbotRefused("refused: the configured demo account is not one of this login's accounts");
    }
    if (target.accountType !== "SPREADBET") {
      await this.logout();
      throw new IgbotRefused(`refused: the configured demo account is a ${String(target.accountType ?? "unknown").slice(0, 20)} account, not a spread-bet account`);
    }
    s.accountType = "SPREADBET";
    await this.pause(IGBOT_SESSION.loginWaitMs);
    const put = () => {
      this.switches += 1;
      return this.raw("PUT", "/session", { version: 1, session: s, body: { accountId: c.accountId, defaultAccount: false } });
    };
    let sw = await put();
    for (let i = 0; i < IGBOT_SESSION.tokenRetries && refusedTokens(sw.answer); i++) {
      this.tokenRetriesUsed += 1;
      await this.pause(IGBOT_SESSION.tokenRetryWaitMs);
      sw = await put();
    }
    const code = igErrorCode(sw.answer.body);
    if (sw.answer.status !== 200 && code !== "error.switch.accountId-must-be-different") {
      throw new IgbotHttpError(sw.answer.status, code, this.scrub(`account switch refused: ${sw.answer.status} ${code}`));
    }
    this.store.s = { ...withTokens(s, sw.headers), accountId: c.accountId, ready: true };
    this.secrets();
    await this.pause(IGBOT_SESSION.switchWaitMs);
  }

  /**
   * A request on the function's session. When IG refuses the tokens the same tokens are tried again after a pause, then the
   * session is renewed once (`renew`) and the request sent again. IG refuses tokens before it deals, so a trading request
   * answered so was not carried out and goes again with the same body, an open's deal reference included; any other
   * answer (a rejection, a 5xx) is returned and an error (no answer, a timeout) thrown, never sent again here.
   */
  async call(method: string, path: string, o: { query?: Record<string, string>; body?: unknown; version: number; override?: "DELETE" }): Promise<IgbotAnswer> {
    let used = await this.ensure();
    let r = await this.raw(method, path, { ...o, session: used });
    for (let i = 0; i < IGBOT_SESSION.tokenRetries && refusedTokens(r.answer) && this.store.s?.xst === used.xst; i++) {
      this.tokenRetriesUsed += 1;
      await this.pause(IGBOT_SESSION.tokenRetryWaitMs);
      r = await this.raw(method, path, { ...o, session: used });
    }
    if (refusedTokens(r.answer)) {
      await this.renew(used);
      used = this.store.s!;
      r = await this.raw(method, path, { ...o, session: used });
    }
    // Tokens an answer carries replace the session's, and are kept for the other isolates.
    if (this.store.s && this.store.s.xst === used.xst && (r.headers.get("CST") || r.headers.get("X-SECURITY-TOKEN"))) {
      const next = withTokens(this.store.s, r.headers);
      if (next.cst !== used.cst || next.xst !== used.xst) {
        this.store.s = next;
        this.secrets();
        await this.keep();
      }
    }
    return this.scrub(r.answer);
  }

  /** A GET whose answer must be 200; anything else throws with IG's error code, scrubbed. */
  async get(path: string, version: number, query?: Record<string, string>): Promise<unknown> {
    const a = await this.call("GET", path, { version, query });
    if (a.status !== 200) {
      const code = igErrorCode(a.body);
      throw new IgbotHttpError(a.status, code, this.scrub(`GET ${path} answered ${a.status} ${code || JSON.stringify(a.body).slice(0, 200)}`));
    }
    return a.body;
  }

  /**
   * `DELETE /session`: ends this client's session at IG whatever it answers, forgets the tokens, and takes them from the
   * keeper while it still holds them. Never throws. Used only on a session IG refused or the client refuses: logging out a
   * good session made IG refuse the next login (the `ig` recorder, 10-18, `QUOTES_RELOGIN_WAIT_MS`).
   */
  async logout(): Promise<void> {
    const s = this.store.s, box = this.store.box;
    if (!s) return;
    this.logouts += 1;
    try {
      this.secrets();
      await this.raw("DELETE", "/session", { version: 1, session: s });
    } catch { /* the session lapses at IG on its own */ }
    this.store.s = null;
    this.store.box = null;
    if (box && this.opts.keeper) await this.opts.keeper.clear(box).catch(() => {});
  }
}
