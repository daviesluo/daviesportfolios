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
//     the read-only `ig` function) from every answer and error; the session tokens live only in this isolate's memory.
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

export type IgbotSession = { cst: string; xst: string; accountId: string; accountType: string | null };
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
export function withTokens(s: IgbotSession, headers: Headers): IgbotSession {
  const cst = headers.get("CST"), xst = headers.get("X-SECURITY-TOKEN");
  return { ...s, ...(cst ? { cst } : {}), ...(xst ? { xst } : {}) };
}

/** A session kept between requests of one isolate (memory only: never stored, never returned). */
const isolateSession: { s: IgbotSession | null } = { s: null };
/** Every IG request this isolate sent in the last minute, whichever client sent it. */
const isolateSent: Array<{ at: number; trading: boolean }> = [];

export type IgbotClientOpts = {
  creds: IgbotCreds;
  fetchImpl?: typeof fetch;
  now?: () => number;
  timeoutMs?: number;
  /** Where the session is kept; this isolate's memory unless a test gives its own. */
  store?: { s: IgbotSession | null };
  /** Where the minute's requests are counted; this isolate's list unless a test gives its own. */
  sent?: Array<{ at: number; trading: boolean }>;
};

/**
 * One isolate's client. Logs in when it has no session, puts the session on the configured demo account (refusing any
 * account that is not a spread-bet account), logs in again once when IG calls the tokens invalid (weekend maintenance
 * invalidates every token), and counts every request a minute at a time.
 */
export class IgbotClient {
  readonly opts: IgbotClientOpts;
  private store: { s: IgbotSession | null };
  private sent: Array<{ at: number; trading: boolean }>;
  private tokensSeen: string[] = [];
  requests = 0;
  logins = 0;

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

  private budget(trading: boolean): void {
    const now = (this.opts.now ?? Date.now)();
    // Pruned in place: the list is shared by every client of the isolate.
    for (let i = this.sent.length - 1; i >= 0; i--) if (this.sent[i].at <= now - 60e3) this.sent.splice(i, 1);
    const n = this.sent.filter((r) => r.trading === trading).length;
    const cap = trading ? IGBOT_IG_LIMITS.tradingPerMinute : IGBOT_IG_LIMITS.nonTradingPerMinute;
    if (n >= cap) throw new IgbotRefused(`refused: ${n} ${trading ? "trading" : "non-trading"} requests in the last minute, at most ${cap}`);
    this.sent.push({ at: now, trading });
  }

  private async raw(method: string, path: string, o: { query?: Record<string, string>; body?: unknown; version: number; auth: boolean; override?: "DELETE" }) {
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
    const s = this.store.s;
    if (o.auth && s) {
      headers["CST"] = s.cst;
      headers["X-SECURITY-TOKEN"] = s.xst;
    }
    const now = this.opts.now ?? Date.now;
    const t0 = now();
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
    return { answer: { status: res.status, body, ms: now() - t0 } as IgbotAnswer, headers: res.headers };
  }

  /** `POST /session` (version 2), then `PUT /session` onto the configured account unless the login is already on it. */
  async login(): Promise<IgbotSession> {
    const c = this.opts.creds;
    this.logins += 1;
    const { answer, headers } = await this.raw("POST", "/session", { version: 2, auth: false, body: { identifier: c.username, password: c.password, encryptedPassword: false } });
    const cst = headers.get("CST") ?? "", xst = headers.get("X-SECURITY-TOKEN") ?? "";
    if (answer.status !== 200 || !cst || !xst) {
      const code = igErrorCode(answer.body);
      throw new IgbotHttpError(answer.status, code, this.scrub(`login refused: ${answer.status} ${code || JSON.stringify(answer.body).slice(0, 200)}`));
    }
    const b = (answer.body ?? {}) as { currentAccountId?: string; accounts?: Array<{ accountId?: string; accountType?: string }> };
    const target = (b.accounts ?? []).find((a) => a.accountId === c.accountId);
    if (!target) {
      this.store.s = { cst, xst, accountId: String(b.currentAccountId ?? ""), accountType: null };
      await this.logout();
      throw new IgbotRefused("refused: the configured demo account is not one of this login's accounts");
    }
    if (target.accountType !== "SPREADBET") {
      this.store.s = { cst, xst, accountId: String(b.currentAccountId ?? ""), accountType: null };
      await this.logout();
      throw new IgbotRefused(`refused: the configured demo account is a ${String(target.accountType ?? "unknown").slice(0, 20)} account, not a spread-bet account`);
    }
    this.store.s = { cst, xst, accountId: String(b.currentAccountId ?? ""), accountType: "SPREADBET" };
    this.secrets();
    if (this.store.s.accountId !== c.accountId) {
      const sw = await this.raw("PUT", "/session", { version: 1, auth: true, body: { accountId: c.accountId, defaultAccount: false } });
      const code = igErrorCode(sw.answer.body);
      if (sw.answer.status !== 200 && code !== "error.switch.accountId-must-be-different") {
        throw new IgbotHttpError(sw.answer.status, code, this.scrub(`account switch refused: ${sw.answer.status} ${code}`));
      }
      this.store.s = { ...withTokens(this.store.s, sw.headers), accountId: c.accountId, accountType: "SPREADBET" };
      this.secrets();
    }
    return this.store.s;
  }

  /** A request on the session: logs in first when there is none, and once more when IG calls the tokens invalid. */
  async call(method: string, path: string, o: { query?: Record<string, string>; body?: unknown; version: number; override?: "DELETE" }): Promise<IgbotAnswer> {
    if (!this.store.s || this.store.s.accountId !== this.opts.creds.accountId) await this.login();
    let { answer, headers } = await this.raw(method, path, { ...o, auth: true });
    if (isTokenError(answer.status, igErrorCode(answer.body))) {
      this.store.s = null;
      await this.login();
      ({ answer, headers } = await this.raw(method, path, { ...o, auth: true }));
    }
    if (this.store.s) {
      this.store.s = withTokens(this.store.s, headers);
      this.secrets();
    }
    return this.scrub(answer);
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

  /** `DELETE /session`: ends this client's session at IG whatever it answers, and forgets the tokens. Never throws. */
  async logout(): Promise<void> {
    if (!this.store.s) return;
    try {
      this.secrets();
      await this.raw("DELETE", "/session", { version: 1, auth: true });
    } catch { /* the session lapses at IG on its own */ }
    this.store.s = null;
  }
}
