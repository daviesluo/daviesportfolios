// The hand-kept tables, read live from the `hand-targets` branch (Davies, 2026-10-21: the site shows Grok's updates as
// soon as they are pushed, with no redeploy).
//
// An outside agent (Grok) refreshes two files on branch `hand-targets` of this (public) repository every day at 09:30
// New York time: HAND_TARGETS.json (bitcoin's bank targets, `btc.rows`, and the S&P 500 strategists' year-end targets,
// `sp500.rows`, which VUAA is priced from) and HAND_RISKS.json (the Target price page's Key risks). The `targets`
// function's one-minute call checks the branch head every HAND_CHECK_MS; when it moved, it reads both files AT THAT
// COMMIT (an immutable URL, so the raw CDN's few minutes of staleness cannot serve the old file), validates them whole,
// keeps them in the state row and rebuilds the bitcoin and VUAA rows from them. A file that fails any check is not used
// at all: the copies baked into the code (`strategists.ts`, the page's `target_risks.js`) stand instead, and the failure
// is reported once, when it starts, not every minute. The main session still copies the branch into the code each day,
// so the baked copies stay current.
//
// Reads only: the head through GitHub's API (unauthenticated, 60 an hour per IP, so once per HAND_CHECK_MS) or, when the
// API refuses, git's own ref advertisement; the files from raw.githubusercontent.com. No token, no write anywhere.

export const HAND_REPO = "daviesluo/daviesportfolios";
export const HAND_BRANCH = "hand-targets";
/** How often the branch head is asked for: 12 an hour, well inside the API's 60. */
export const HAND_CHECK_MS = 5 * 60e3;
/** Each target within this band of the current price or level, or the file is refused (a typo, a unit slip). */
export const HAND_TARGET_BAND = { min: 0.3, max: 3 };
export const HAND_RISK_MAX_CHARS = 120;
export const HAND_RISK_MAX_NOTES = 3;
/** RKLB's computed note ("lowest target $X still Y% above price"): the page fills it in. */
export const LOWEST_TARGET_PLACEHOLDER = "@lowest-target";
const UA = "daviesportfolios-targets";
const TIMEOUT_MS = 8_000;

export type HandRow = { firm: string; target: number; date: string; horizon: string; url: string };
export type HandTargets = { asOf: string; btc: HandRow[]; sp500: HandRow[] };
export type HandRisks = { asOf: string; risks: Record<string, Array<{ text: string; until?: string }>> };
export type HandState = {
  /** The commit the loaded copy is from, or null (the baked copy stands). */
  sha: string | null;
  checkedAt: number;
  /** How the head was found: the API, git's ref advertisement, or the branch URL itself (no commit known). */
  via: "api" | "git" | "branch" | null;
  targets: HandTargets | null;
  risks: HandRisks | null;
  /** The failure in force, or null: reported once when it appears, cleared when a check succeeds. */
  error: string | null;
};

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const isYmd = (x: unknown): x is string => {
  if (typeof x !== "string" || !YMD.test(x)) return false;
  const d = new Date(`${x}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === x;
};
const isHttps = (x: unknown): x is string => {
  if (typeof x !== "string") return false;
  try { return new URL(x).protocol === "https:"; } catch { return false; }
};
const keysAre = (o: unknown, want: string[], optional: string[] = []): boolean =>
  !!o && typeof o === "object" && !Array.isArray(o)
  && want.every((k) => k in (o as Record<string, unknown>))
  && Object.keys(o as Record<string, unknown>).every((k) => want.includes(k) || optional.includes(k));

/**
 * HAND_TARGETS.json checked whole: the keys it has always had, numbers that are numbers, YYYY-MM-DD dates, https
 * sources, bitcoin's horizon free text and the S&P 500's "end-YYYY", one row per firm, and each target within
 * HAND_TARGET_BAND of the price it is a target for (`btcPrice`, `spxLevel`). Returns the tables, or the first fault.
 */
export function validateHandTargets(raw: unknown, now: { btcPrice: number; spxLevel: number }): { ok: true; value: HandTargets } | { ok: false; error: string } {
  const bad = (error: string) => ({ ok: false as const, error });
  if (!keysAre(raw, ["asOf", "btc", "sp500"])) return bad("HAND_TARGETS.json: keys are not asOf, btc, sp500");
  const r = raw as Record<string, any>;
  if (!isYmd(r.asOf)) return bad("HAND_TARGETS.json: asOf is not a date");
  if (!keysAre(r.btc, ["asset", "unit", "rows"])) return bad("HAND_TARGETS.json: btc's keys changed");
  if (!keysAre(r.sp500, ["asset", "unit", "horizon", "rows"])) return bad("HAND_TARGETS.json: sp500's keys changed");
  const rows = (name: "btc" | "sp500", level: number): HandRow[] | string => {
    const list = r[name].rows;
    if (!Array.isArray(list) || list.length === 0) return `${name}.rows is empty or not a list`;
    const firms = new Set<string>();
    for (const [i, x] of list.entries()) {
      const at = `${name}.rows[${i}]`;
      if (!keysAre(x, ["firm", "target", "date", "horizon", "url"])) return `${at}: keys are not firm, target, date, horizon, url`;
      if (typeof x.firm !== "string" || !x.firm.trim() || x.firm.length > 80) return `${at}: firm`;
      if (firms.has(x.firm)) return `${at}: ${x.firm} twice`;
      firms.add(x.firm);
      if (typeof x.target !== "number" || !Number.isFinite(x.target) || x.target <= 0) return `${at}: target is not a positive number`;
      if (!isYmd(x.date)) return `${at}: date is not YYYY-MM-DD`;
      if (x.date > r.asOf) return `${at}: dated after the file's asOf`;
      if (typeof x.horizon !== "string" || !x.horizon.trim() || x.horizon.length > 40) return `${at}: horizon`;
      if (name === "sp500" && !/^end-\d{4}$/.test(x.horizon)) return `${at}: horizon is not end-YYYY`;
      if (!isHttps(x.url)) return `${at}: url is not https`;
      const ratio = x.target / level;
      if (!(ratio >= HAND_TARGET_BAND.min && ratio <= HAND_TARGET_BAND.max)) return `${at}: ${x.firm}'s ${x.target} is ${ratio.toFixed(2)}× the current level`;
    }
    return list.map((x: HandRow) => ({ firm: x.firm, target: x.target, date: x.date, horizon: x.horizon, url: x.url }));
  };
  if (!(now.btcPrice > 0) || !(now.spxLevel > 0)) return bad("no current bitcoin price or S&P 500 level to check the targets against");
  const btc = rows("btc", now.btcPrice);
  if (typeof btc === "string") return bad(`HAND_TARGETS.json: ${btc}`);
  const sp = rows("sp500", now.spxLevel);
  if (typeof sp === "string") return bad(`HAND_TARGETS.json: ${sp}`);
  return { ok: true, value: { asOf: r.asOf, btc, sp500: sp } };
}

/**
 * HAND_RISKS.json checked whole: `{asOf, risks: {TICKER: [{text, until?}]}}`, at most HAND_RISK_MAX_NOTES notes a
 * ticker, each text non-empty and at most HAND_RISK_MAX_CHARS, an `until` a real date; the `@lowest-target` placeholder
 * only alone in its note, and no other "@" followed by a letter. Returns the table, or the first fault.
 */
export function validateHandRisks(raw: unknown): { ok: true; value: HandRisks } | { ok: false; error: string } {
  const bad = (error: string) => ({ ok: false as const, error });
  if (!keysAre(raw, ["asOf", "risks"])) return bad("HAND_RISKS.json: keys are not asOf, risks");
  const r = raw as Record<string, any>;
  if (!isYmd(r.asOf)) return bad("HAND_RISKS.json: asOf is not a date");
  if (!r.risks || typeof r.risks !== "object" || Array.isArray(r.risks) || Object.keys(r.risks).length === 0) return bad("HAND_RISKS.json: risks is empty");
  const out: HandRisks["risks"] = {};
  for (const [ticker, notes] of Object.entries(r.risks as Record<string, unknown>)) {
    if (!/^[A-Z0-9][A-Z0-9.^=-]{0,11}$/.test(ticker)) return bad(`HAND_RISKS.json: ticker ${ticker.slice(0, 20)}`);
    if (!Array.isArray(notes) || notes.length === 0 || notes.length > HAND_RISK_MAX_NOTES) return bad(`HAND_RISKS.json: ${ticker} has ${Array.isArray(notes) ? notes.length : "no"} notes (1 to ${HAND_RISK_MAX_NOTES})`);
    out[ticker] = [];
    for (const [i, n] of notes.entries()) {
      if (!keysAre(n, ["text"], ["until"])) return bad(`HAND_RISKS.json: ${ticker}[${i}] keys are not text, until`);
      if (typeof n.text !== "string" || !n.text.trim()) return bad(`HAND_RISKS.json: ${ticker}[${i}] has no text`);
      if (n.text.length > HAND_RISK_MAX_CHARS) return bad(`HAND_RISKS.json: ${ticker}[${i}] is ${n.text.length} characters (${HAND_RISK_MAX_CHARS} at most)`);
      // A placeholder is "@" then a letter; "@$625" is a price ("at $625", 10-27: it took both tables down for 30 hours).
      if (/@[A-Za-z]/.test(n.text) && n.text !== LOWEST_TARGET_PLACEHOLDER) return bad(`HAND_RISKS.json: ${ticker}[${i}] has an unknown placeholder`);
      if ("until" in n && !isYmd(n.until)) return bad(`HAND_RISKS.json: ${ticker}[${i}] until is not a date`);
      out[ticker].push("until" in n ? { text: n.text, until: n.until } : { text: n.text });
    }
  }
  return { ok: true, value: { asOf: r.asOf, risks: out } };
}

/** The 40-hex commit a ref advertisement of git's smart HTTP protocol gives for refs/heads/<branch>, or null. */
export function headFromRefAdvertisement(body: string, branch: string): string | null {
  const m = body.match(new RegExp(`([0-9a-f]{40}) refs/heads/${branch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:\\n|\\0|$)`));
  return m ? m[1] : null;
}

/** The branch head: GitHub's API first, then git's ref advertisement (not rate-limited the same way). Null on both failing. */
export async function resolveHead(f: typeof fetch): Promise<{ sha: string; via: "api" | "git" } | null> {
  try {
    const res = await f(`https://api.github.com/repos/${HAND_REPO}/commits/${HAND_BRANCH}`, {
      headers: { Accept: "application/vnd.github.sha", "User-Agent": UA }, signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.ok) {
      const sha = (await res.text()).trim();
      if (/^[0-9a-f]{40}$/.test(sha)) return { sha, via: "api" };
    } else await res.body?.cancel();
  } catch { /* the advertisement next */ }
  try {
    const res = await f(`https://github.com/${HAND_REPO}.git/info/refs?service=git-upload-pack`, {
      headers: { "User-Agent": "git/2.40.0" }, signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.ok) {
      const sha = headFromRefAdvertisement(await res.text(), HAND_BRANCH);
      if (sha) return { sha, via: "git" };
    } else await res.body?.cancel();
  } catch { /* nothing more */ }
  return null;
}

/** One file of the branch, at a commit when one is known (immutable), else at the branch's name. */
export async function fetchHandFile(name: string, ref: string, f: typeof fetch): Promise<unknown> {
  const res = await f(`https://raw.githubusercontent.com/${HAND_REPO}/${ref}/${name}`, {
    headers: { "User-Agent": UA, Accept: "application/json" }, signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) { await res.body?.cancel(); throw new Error(`${name}: ${res.status}`); }
  return await res.json();
}

export const EMPTY_HAND: HandState = { sha: null, checkedAt: 0, via: null, targets: null, risks: null, error: null };

/**
 * One check of the branch, when HAND_CHECK_MS has passed since the last. Returns the state to keep and whether the
 * loaded tables changed (so the bitcoin and VUAA rows are rebuilt), and `newError` when a failure starts (reported
 * once). A failure of any kind leaves no branch copy in force: the baked one stands until a check succeeds.
 */
export async function checkHand(prev: HandState | null | undefined, nowMs: number, f: typeof fetch, levels: () => Promise<{ btcPrice: number; spxLevel: number } | null>):
  Promise<{ state: HandState; changed: boolean; newError: string | null }> {
  const p: HandState = prev && typeof prev === "object" ? { ...EMPTY_HAND, ...prev } : { ...EMPTY_HAND };
  if (nowMs - p.checkedAt < HAND_CHECK_MS) return { state: p, changed: false, newError: null };
  const head = await resolveHead(f);
  // The same commit already loaded and valid: nothing to read.
  if (head && head.sha === p.sha && p.targets && p.risks && !p.error) return { state: { ...p, checkedAt: nowMs, via: head.via }, changed: false, newError: null };
  const fail = (error: string) => {
    const state: HandState = { sha: null, checkedAt: nowMs, via: head?.via ?? "branch", targets: null, risks: null, error };
    return { state, changed: p.targets !== null || p.risks !== null, newError: p.error === error ? null : error };
  };
  const ref = head?.sha ?? HAND_BRANCH;
  let targetsRaw: unknown, risksRaw: unknown;
  try {
    [targetsRaw, risksRaw] = await Promise.all([fetchHandFile("HAND_TARGETS.json", ref, f), fetchHandFile("HAND_RISKS.json", ref, f)]);
  } catch (e) {
    return fail(`hand-targets: could not read the branch (${e instanceof Error ? e.message : String(e)})`);
  }
  const lv = await levels();
  if (!lv) return fail("hand-targets: no current bitcoin price or S&P 500 level to check the targets against");
  const t = validateHandTargets(targetsRaw, lv);
  if (!t.ok) return fail(`hand-targets: ${t.error}`);
  const r = validateHandRisks(risksRaw);
  if (!r.ok) return fail(`hand-targets: ${r.error}`);
  const changed = JSON.stringify([t.value, r.value]) !== JSON.stringify([p.targets, p.risks]);
  return { state: { sha: head?.sha ?? null, checkedAt: nowMs, via: head?.via ?? "branch", targets: t.value, risks: r.value, error: null }, changed, newError: null };
}
