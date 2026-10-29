// The IG REST client for the demo verification, and the two limits that make it read-only and demo-only.
//
// Davies, 2026-10-15: "ig我的账户开好了，api也加了" and "FXW-AUD你继续验证研究并记录…". The spec it serves is
// `docs/agents/backtests/ig_deepdive/SPEC-for-verification.md` (hard rules 1, 2 and 8). What this file guarantees:
//
//   * One host. Every request is built on `IG_DEMO_BASE` and checked by `assertAllowed` before `fetch` is reached: any
//     other origin (the live host `api.ig.com` above all), scheme, port or path prefix throws `IgRefused`. Nothing here
//     reads the live credentials; the only secrets read are the three demo names in `IG_DEMO_SECRET_NAMES`.
//   * One list of calls. `POST /session` (log in), `PUT /session` (switch between the two demo accounts) and
//     `DELETE /session` (log out, 2026-10-18: the recorder ends every session it opens), and GET on `/accounts`,
//     `/markets` (by epics or a search term), `/markets/{epic}`, `/marketnavigation[/{node}]`, `/prices/{epic}` and
//     `/clientsentiment[/{marketId}]`. Every other method or path throws before fetch: positions, working orders,
//     confirms, watchlists, history, costs, applications. There is no order code, and none can be sent through this
//     client: a DELETE anywhere but `/session`, a POST anywhere but `/session`, a PUT anywhere but `/session` are refused.
//   * No secret leaves. The API key, username, password and both session tokens are scrubbed (`scrubDeep`) from every
//     error, every stored payload and every answer; the session tokens live only in this isolate's memory.
//   * A budget of requests per run (`maxRequests`) and a gap between them (`minGapMs`), so a run stays inside IG's
//     30 non-trading requests a minute per account (IG Labs FAQ, "Limits").

/** The only host this code calls. */
export const IG_DEMO_BASE = "https://demo-api.ig.com/gateway/deal";
/** Hard rule 1: the environment is demo, and nothing in this folder can say otherwise. */
export const IG_ENVIRONMENT = "demo" as const;
/** The three Edge secrets read, all demo. */
export const IG_DEMO_SECRET_NAMES = { key: "IG_API_KEY_DEMO", username: "IG_DEMO_USERNAME", password: "IG_DEMO_PASSWORD" } as const;

const EPIC = "[A-Za-z0-9._]{6,30}";
/** Method and path (after `/gateway/deal`) of every call this client may make. Nothing else is sent. */
export const IG_ALLOWED: ReadonlyArray<readonly [string, RegExp]> = [
  ["POST", /^\/session$/],
  ["PUT", /^\/session$/],
  // Log out: it ends this client's own session and nothing else.
  ["DELETE", /^\/session$/],
  ["GET", /^\/accounts$/],
  ["GET", /^\/markets$/],
  ["GET", new RegExp(`^/markets/${EPIC}$`)],
  ["GET", /^\/marketnavigation(\/[0-9]{1,12})?$/],
  ["GET", new RegExp(`^/prices/${EPIC}$`)],
  // IG serves it at `/clientsentiment` (the reference page is titled `/client-sentiment`; that path answered 404 on
  // 2026-10-15).
  ["GET", /^\/clientsentiment(\/[A-Za-z0-9._-]{1,40})?$/],
];
/** The query parameters each GET may carry; anything else is refused too. */
const ALLOWED_QUERY: Record<string, ReadonlySet<string>> = {
  "/markets": new Set(["epics", "filter", "searchTerm"]),
  "/prices": new Set(["resolution", "from", "to", "max", "pageSize", "pageNumber"]),
  "/clientsentiment": new Set(["marketIds"]),
};

export class IgRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IgRefused";
  }
}

/**
 * The guard: the URL must be on the demo host under `/gateway/deal`, and its method and path on the list. Returns the
 * path after the base. Throws `IgRefused` otherwise, before anything is sent.
 */
export function assertAllowed(method: string, url: string): string {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new IgRefused("refused: not a URL");
  }
  const base = new URL(IG_DEMO_BASE);
  if (u.protocol !== "https:" || u.host !== base.host || u.username || u.password) {
    throw new IgRefused(`refused: host ${u.protocol}//${u.host} is not the IG demo host`);
  }
  if (!u.pathname.startsWith(base.pathname + "/")) throw new IgRefused(`refused: path ${u.pathname} is outside ${base.pathname}`);
  const path = u.pathname.slice(base.pathname.length);
  if (path.includes("..") || path.includes("//")) throw new IgRefused(`refused: path ${path}`);
  const m = method.toUpperCase();
  if (!IG_ALLOWED.some(([am, re]) => am === m && re.test(path))) throw new IgRefused(`refused: ${m} ${path} is not on the read-only list`);
  if (m !== "GET" && u.search) throw new IgRefused(`refused: ${m} ${path} carries a query`);
  const family = "/" + path.split("/")[1];
  const allowedQ = ALLOWED_QUERY[family] ?? new Set<string>();
  for (const k of u.searchParams.keys()) if (!allowedQ.has(k)) throw new IgRefused(`refused: query parameter ${k} on ${path}`);
  return path;
}

/** Replace every non-trivial secret in every string of a value (deep). Secrets shorter than 4 characters are ignored. */
export function scrubDeep<T>(value: T, secrets: readonly string[]): T {
  const list = [...new Set(secrets.filter((s) => typeof s === "string" && s.length >= 4))].sort((a, b) => b.length - a.length);
  const scrub = (s: string): string => {
    let out = s;
    for (const sec of list) out = out.split(sec).join("[redacted]");
    // A password or token URL-encoded in an echoed request is the same secret.
    for (const sec of list) {
      const enc = encodeURIComponent(sec);
      if (enc !== sec) out = out.split(enc).join("[redacted]");
    }
    return out;
  };
  const walk = (v: unknown): unknown => {
    if (typeof v === "string") return scrub(v);
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") {
      const o: Record<string, unknown> = {};
      for (const [k, x] of Object.entries(v as Record<string, unknown>)) o[scrub(k)] = walk(x);
      return o;
    }
    return v;
  };
  return walk(value) as T;
}

/** Keys that carry an account's money or the client's identity: removed from session and account payloads. */
export const BALANCE_KEYS = new Set(["balance", "deposit", "profitLoss", "available", "accountInfo", "funds", "clientId", "accountAlias"]);
/** A session or `/accounts` answer with every balance and the client id taken out (hard rule 1: balances not recorded). */
export function stripBalances<T>(value: T): T {
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") {
      const o: Record<string, unknown> = {};
      for (const [k, x] of Object.entries(v as Record<string, unknown>)) if (!BALANCE_KEYS.has(k)) o[k] = walk(x);
      return o;
    }
    return v;
  };
  return walk(value) as T;
}

export type IgCreds = { key: string; username: string; password: string };
/** The demo credentials from the environment, or the names that are missing. */
export function demoCreds(env: Record<string, string | undefined>): IgCreds | { missing: string[] } {
  const key = (env[IG_DEMO_SECRET_NAMES.key] ?? "").trim();
  const username = (env[IG_DEMO_SECRET_NAMES.username] ?? "").trim();
  const password = env[IG_DEMO_SECRET_NAMES.password] ?? "";
  const missing: string[] = [];
  if (!key) missing.push(IG_DEMO_SECRET_NAMES.key);
  if (!username) missing.push(IG_DEMO_SECRET_NAMES.username);
  if (!password) missing.push(IG_DEMO_SECRET_NAMES.password);
  return missing.length ? { missing } : { key, username, password };
}

export type IgSession = { cst: string; xst: string; accountId: string; at: number };
export type IgAnswer = { status: number; body: unknown; date: string | null; ms: number };

export class IgHttpError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "IgHttpError";
    this.status = status;
    this.code = code;
  }
}

/** The error code IG puts in a refusal's body (`{"errorCode":"error.security.client-token-invalid"}`), or "". */
export function igErrorCode(body: unknown): string {
  if (body && typeof body === "object" && typeof (body as { errorCode?: unknown }).errorCode === "string") {
    return (body as { errorCode: string }).errorCode;
  }
  return "";
}

/** A 401 whose code says the session tokens are no good (weekend maintenance invalidates them all; IG Labs FAQ). */
export function isTokenError(status: number, code: string): boolean {
  return status === 401 && /token|missing\.credentials/i.test(code);
}

/** A session with whichever of CST and X-SECURITY-TOKEN an answer's headers carry, each on its own. */
export function adoptTokens(session: IgSession | null, headers: Headers): IgSession | null {
  if (!session) return session;
  const cst = headers.get("CST"), xst = headers.get("X-SECURITY-TOKEN");
  return { ...session, ...(cst ? { cst } : {}), ...(xst ? { xst } : {}) };
}

export type IgClientOpts = {
  creds: IgCreds;
  fetchImpl?: typeof fetch;
  /** At most this many requests in this client's life; the next throws. */
  maxRequests: number;
  /** At least this long between two requests. */
  minGapMs: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  /** A session from an earlier run in this isolate, reused while IG accepts it. */
  session?: IgSession | null;
  timeoutMs?: number;
  /** At most this many logins in this client's life, including its first (unset: no cap). */
  maxLogins?: number;
  /** At most this many logins to replace tokens IG calls invalid, in this client's life (unset: one a call, no cap). */
  maxRelogins?: number;
  /** No ordinary request starts at or after this instant on `now`'s clock; each request's timeout is capped at what remains. */
  deadlineAt?: number;
  /** A log-out may use the margin up to this later instant, so a deadline can leave time to end the session. */
  logoutDeadlineAt?: number;
  /** After a `PUT /session` that switched account, wait this long before the next request (unset: no wait). */
  switchWaitMs?: number;
  /** After a login, wait this long before the next request (unset: no wait). */
  loginWaitMs?: number;
  /** On a token refusal, send the same request again with the same tokens this many times, after `tokenRetryWaitMs`,
   *  before any re-login (unset: none). */
  tokenRetries?: number;
  tokenRetryWaitMs?: number;
  /** After a re-login, `PUT /session` to the account even when the login says it is already current. */
  forceSwitchAfterLogin?: boolean;
  /** Before a re-login, log the refused session out (`DELETE /session`), so a run leaves no session behind it. */
  logoutBeforeRelogin?: boolean;
  /** Re-log in no sooner than this long after the refused session's own login (unset: at once). */
  reloginWaitMs?: number;
};

/**
 * One run's client. Logs in when it has no session, switches account with `PUT /session`, logs in again once when IG
 * says the tokens are no good, and counts every request.
 */
export class IgClient {
  readonly opts: IgClientOpts;
  session: IgSession | null;
  requests = 0;
  logins = 0;
  switches = 0;
  /** Logins made to replace tokens IG called invalid (counted in `logins` too). */
  relogins = 0;
  /** Requests sent again on the same tokens after a refusal. */
  tokenRetriesUsed = 0;
  /** `DELETE /session` calls sent. */
  logouts = 0;
  /** Asked before a re-login: false keeps the refusal (the caller's time budget would not hold the wait). */
  reloginAllowed: () => boolean = () => true;
  /** The run's deadlines on `now`'s clock; a caller that knows the run's start may set them after making the client. */
  deadlineAt: number | undefined;
  logoutDeadlineAt: number | undefined;
  /** A re-login that itself failed ends login attempts for this client, even if a later switch finds no session. */
  private reloginFailed = false;
  /** The last session answer, balances stripped (accounts, current account, time zone offset, …). */
  sessionInfo: Record<string, unknown> | null = null;
  /** IG's `Date` header against this clock, from the latest answer: the run's clock check. */
  clockOffsetMs: number | null = null;
  private lastAt = 0;
  /** Every session token this client has held: a replaced account token is still a secret. */
  private tokensSeen: string[] = [];

  constructor(opts: IgClientOpts) {
    this.opts = opts;
    this.session = opts.session ?? null;
    this.deadlineAt = opts.deadlineAt;
    this.logoutDeadlineAt = opts.logoutDeadlineAt;
  }

  /** Every secret this client could leak: the credentials and the session's tokens. */
  secrets(): string[] {
    const c = this.opts.creds;
    if (this.session) for (const t of [this.session.cst, this.session.xst]) if (!this.tokensSeen.includes(t)) this.tokensSeen.push(t);
    return [c.key, c.username, c.password, ...this.tokensSeen];
  }

  scrub<T>(v: T): T {
    return scrubDeep(v, this.secrets());
  }

  /** Start this client's run deadlines on its own clock. */
  beginRun(deadlineMs: number, logoutDeadlineMs = deadlineMs): void {
    const start = (this.opts.now ?? Date.now)();
    this.deadlineAt = start + deadlineMs;
    this.logoutDeadlineAt = start + logoutDeadlineMs;
  }

  private async raw(method: string, path: string, o: { query?: Record<string, string>; body?: unknown; version: number; auth: boolean; logout?: boolean }): Promise<{ answer: IgAnswer; headers: Headers }> {
    const url = new URL(IG_DEMO_BASE + path);
    for (const [k, v] of Object.entries(o.query ?? {})) url.searchParams.set(k, v);
    assertAllowed(method, url.toString());
    if (this.requests >= this.opts.maxRequests) throw new IgRefused(`refused: this run's budget of ${this.opts.maxRequests} requests is spent`);
    const now = this.opts.now ?? Date.now;
    const sleep = this.opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
    const deadline = o.logout && this.logoutDeadlineAt !== undefined ? this.logoutDeadlineAt : this.deadlineAt;
    let remainingMs = deadline === undefined ? Infinity : deadline - now();
    if (remainingMs <= 0) throw new IgRefused("refused: this run's deadline is spent");
    const wait = this.lastAt + this.opts.minGapMs - now();
    if (this.lastAt && wait > 0) {
      if (wait >= remainingMs) throw new IgRefused("refused: this run's deadline is spent");
      await sleep(wait);
      remainingMs = deadline === undefined ? Infinity : deadline - now();
      if (remainingMs <= 0) throw new IgRefused("refused: this run's deadline is spent");
    }
    const timeoutMs = Math.min(this.opts.timeoutMs ?? 15_000, remainingMs);
    if (timeoutMs <= 0) throw new IgRefused("refused: this run's deadline is spent");
    this.requests += 1;
    this.lastAt = now();
    const headers: Record<string, string> = {
      "X-IG-API-KEY": this.opts.creds.key,
      "Accept": "application/json; charset=UTF-8",
      "Version": String(o.version),
    };
    if (o.body !== undefined) headers["Content-Type"] = "application/json; charset=UTF-8";
    if (o.auth && this.session) {
      headers["CST"] = this.session.cst;
      headers["X-SECURITY-TOKEN"] = this.session.xst;
    }
    const t0 = now();
    const res = await (this.opts.fetchImpl ?? fetch)(url.toString(), {
      method,
      headers,
      body: o.body === undefined ? undefined : JSON.stringify(o.body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await res.text();
    let body: unknown = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = { unparsed: text.slice(0, 300) };
    }
    const date = res.headers.get("date");
    if (date) {
      const t = Date.parse(date);
      if (Number.isFinite(t)) this.clockOffsetMs = t - Math.round((t0 + now()) / 2);
    }
    return { answer: { status: res.status, body, date, ms: now() - t0 }, headers: res.headers };
  }

  /** `POST /session` (version 2). Keeps the tokens in memory and the answer, balances stripped, in `sessionInfo`. */
  async login(): Promise<IgSession> {
    if (this.reloginFailed) throw new IgRefused("refused: a re-login in this run already failed");
    if (this.logins >= (this.opts.maxLogins ?? Infinity)) {
      throw new IgRefused(`refused: this run's budget of ${this.opts.maxLogins} logins is spent`);
    }
    const c = this.opts.creds;
    this.logins += 1;
    const { answer, headers } = await this.raw("POST", "/session", { version: 2, auth: false, body: { identifier: c.username, password: c.password, encryptedPassword: false } });
    const cst = headers.get("CST") ?? "", xst = headers.get("X-SECURITY-TOKEN") ?? "";
    if (answer.status !== 200 || !cst || !xst) {
      const code = igErrorCode(answer.body);
      throw new IgHttpError(answer.status, code, this.scrub(`login refused: ${answer.status} ${code || JSON.stringify(answer.body).slice(0, 200)}`));
    }
    const b = (answer.body ?? {}) as Record<string, unknown>;
    this.session = { cst, xst, accountId: String(b.currentAccountId ?? ""), at: (this.opts.now ?? Date.now)() };
    this.sessionInfo = this.scrub(stripBalances(b));
    if (this.opts.loginWaitMs) await this.pause(this.opts.loginWaitMs);
    return this.session;
  }

  /** A request on the session, logging in first when there is none and once more when IG says the tokens are no good. */
  async call(method: string, path: string, o: { query?: Record<string, string>; body?: unknown; version: number }): Promise<IgAnswer> {
    if (!this.session) await this.login();
    let { answer, headers } = await this.raw(method, path, { ...o, auth: true });
    // A token IG has just issued is sometimes refused for a moment (the recorder, 2026-10-18 04:19-04:30 UTC: a call
    // 0.3 s after a fresh login was refused in about half the runs; `history`, 2.5 s apart, about one in fifty): the
    // same tokens are tried again after a pause before anything logs in again.
    for (let i = 0; i < (this.opts.tokenRetries ?? 0) && isTokenError(answer.status, igErrorCode(answer.body)); i++) {
      this.tokenRetriesUsed += 1;
      await this.pause(this.opts.tokenRetryWaitMs ?? 0);
      ({ answer, headers } = await this.raw(method, path, { ...o, auth: true }));
    }
    if (isTokenError(answer.status, igErrorCode(answer.body)) && this.relogins < (this.opts.maxRelogins ?? Infinity) && this.reloginAllowed()) {
      this.relogins += 1;
      const account = this.session?.accountId ?? "";
      // A session refused right after its own login: the re-login waits until `reloginWaitMs` after that login.
      const since = (this.opts.now ?? Date.now)() - (this.session?.at ?? 0);
      if (this.opts.reloginWaitMs && since < this.opts.reloginWaitMs) await this.pause(this.opts.reloginWaitMs - since);
      if (this.opts.logoutBeforeRelogin) await this.logout();
      this.session = null;
      try {
        await this.login();
      } catch (e) {
        this.reloginFailed = true;
        throw e;
      }
      if (account && this.session && (this.opts.forceSwitchAfterLogin || (this.session as IgSession).accountId !== account)) {
        await this.switchTo(account, this.opts.forceSwitchAfterLogin);
      }
      ({ answer, headers } = await this.raw(method, path, { ...o, auth: true }));
    }
    // The X-SECURITY-TOKEN names the current ACCOUNT (IG Labs REST guide: "a token identifying the current account"), so
    // `PUT /session` answers with a new one, and with no CST. Each is taken on its own whenever an answer carries it:
    // keeping the old account token after a switch made every later call answer 401 account-token-invalid
    // (production, 2026-10-15 16:25 UTC, the spread-bet account's first `facts`).
    this.secrets();
    this.session = adoptTokens(this.session, headers);
    return this.scrub(answer);
  }

  /** A GET whose answer must be 200; anything else throws with IG's code, scrubbed. */
  async get(path: string, version: number, query?: Record<string, string>): Promise<unknown> {
    const a = await this.call("GET", path, { version, query });
    if (a.status !== 200) {
      const code = igErrorCode(a.body);
      throw new IgHttpError(a.status, code, this.scrub(`GET ${path} answered ${a.status} ${code || JSON.stringify(a.body).slice(0, 200)}`));
    }
    return a.body;
  }

  /** `PUT /session` to a demo account, unless it is the current one. `defaultAccount` false: the default is left alone. */
  async switchTo(accountId: string, force = false): Promise<void> {
    if (!this.session) await this.login();
    // `force`: send the switch even when the session says it is on that account already. A login's `currentAccountId`
    // is not always the account its token works for (the recorder, 10-18: tokens refused on the account the login
    // named, with no switch made); IG's "accountId-must-be-different" then confirms the account.
    if (!force && this.session?.accountId === accountId) return;
    this.switches += 1;
    const a = await this.call("PUT", "/session", { version: 1, body: { accountId, defaultAccount: false } });
    if (a.status !== 200) {
      const code = igErrorCode(a.body);
      if (code !== "error.switch.accountId-must-be-different") {
        throw new IgHttpError(a.status, code, this.scrub(`switch to ${accountId} refused: ${a.status} ${code}`));
      }
    }
    if (this.session) this.session = { ...this.session, accountId };
    // A pause before the switched account's first call (the recorder's choice; `facts` and `history` already wait 2.5 s
    // between any two requests).
    if (this.opts.switchWaitMs) await this.pause(this.opts.switchWaitMs);
  }

  /**
   * `DELETE /session`: ends this client's session at IG, whatever IG answers (a refused session may answer 401), and
   * forgets its tokens. Never throws: a run that cannot log out still records what it read.
   */
  async logout(): Promise<void> {
    if (!this.session) return;
    this.logouts += 1;
    try {
      this.secrets();
      await this.raw("DELETE", "/session", { version: 1, auth: true, logout: true });
    } catch { /* the budget spent or the network: the session then lapses at IG on its own */ }
    this.session = null;
  }

  private async pause(ms: number): Promise<void> {
    if (ms > 0) await (this.opts.sleep ?? ((x: number) => new Promise<void>((r) => setTimeout(r, x))))(ms);
  }
}
