// The errors box's noise policy (Davies, 2026-10-20, relayed: why does the box have so many entries; deal with it, and from
// now on do not show low-level errors that mean nothing). Every row stays in `public.ops_errors`; this decides only what
// the box shows from the summary's rows (`?action=summary`), as LINES a person can act on:
//
//   always shown   monitor.* (the Worker's alerts and recoveries); code errors (a TypeError, a SQLSTATE in a database
//                  answer, "no code for its rule", …); auth and config errors (401/403, an invalid API key, a secret not
//                  set), except IG's known token churn (`account-token-invalid` on ig.*); and any other message it does
//                  not know, a live-money path's state included (an order left unread, a rung frozen, a pending order
//                  for a person to settle). A recorder's row that begins "coverage at risk" (the IG recorder, which
//                  reports only then) is shown too.
//   noise          a transient upstream error (a timeout, "Signal timed out", 429, 502/503/504 or an HTML error page, a
//                  venue's generic 500, a circuit breaker), unless a live-money path (`LIVE_KINDS`) says what it did about
//                  it (FROZEN, pending, left as it is, …): then it is that path's state and always shown. And a
//                  recorder's failed run that is neither code nor auth: one failed run loses nothing when the next works.
//   noise that persists is shown: the same kind and class failing on consecutive runs (rows no further apart than
//                  1.6 runs of its cadence) for at least `PERSIST_MINUTES` of a minute job, or `PERSIST_RUNS` runs of a
//                  slower one, becomes ONE line: "failing since HH:MM UTC, n times", or "failed HH:MM–HH:MM UTC, n times"
//                  once it has stopped.
//   dedupe         identical messages, ids, numbers and times aside, are one line with a count. A row `keptSeparate`
//                  names is shown at once, and the same fault is one line per hour: a trend-4h-live order whose outcome
//                  is unknown; a live-quotes guard (the dead-man beat, agent_risk or the balances unread, the loss stop,
//                  a lease renewal or a lease lost — the executor writes those at most hourly — and `LEASE CLAIM FAILED`,
//                  which it writes every minute, because the claim returns before that throttle); `grokpm.redeem`; and
//                  the weekend replica. The hour, the order or redeem ids and the words are the key, so a different order
//                  stays its own line and a minute writer is not sixty lines. `7ed60689` hid the ones that look like a
//                  passing timeout, because one row an hour or every other minute never lasts 15 minutes.

export type OpsRow = { kind: string; symbol: string | null; message: string | null; created_at: string };
export type NoiseClass = "monitor" | "code" | "auth" | "transient" | "recorder" | "other";
export type OpsLine = {
  kind: string; cls: NoiseClass; message: string; count: number; firstAt: string; latestAt: string;
  /** Set on a line made of persistent noise: whether it is still failing (its newest row within two runs of now). */
  persistent?: { ongoing: boolean };
};

/** A minute job's noise is shown once it has failed this many consecutive minutes. */
export const PERSIST_MINUTES = 15;
/** A slower job's (one run every five minutes or more) once it has failed this many consecutive runs. */
export const PERSIST_RUNS = 3;
/** Two rows of one kind are consecutive runs when no further apart than this many runs of its cadence. */
export const CONSECUTIVE_RUNS_GAP = 1.6;

/** Kinds whose runs are not every minute (`public.edge_calls.every_minutes`, 2026-10-20); every other is a minute job. */
const CADENCE: Array<[RegExp, number]> = [
  [/grokpm_rec|pm_?prog|rec_meta|rw_?select|overnight|snapshot/i, 5],
  [/t212|trading212/i, 10],
];
export function cadenceMinutes(kind: string): number {
  for (const [re, m] of CADENCE) if (re.test(kind)) return m;
  return 1;
}

/** The paths that trade real money: their own state is never noise. */
export const LIVE_KINDS = /^(agents\.quotes_live|agents\.pm_lp\b|agents\.pm_live|grokpm|agents\.grokpm(?!_rec))/;
/** Recorders: a failed run of theirs loses nothing when the next works. */
const RECORDER_KINDS = /(_rec|\.rec|_record|-record|record\b|\.views)$|^ig\.quotes$/;

const CODE = /\b(TypeError|ReferenceError|SyntaxError|RangeError)\b|is not a function|is not defined|Cannot read propert|is not iterable|no code for its rule|"code":\s*"[0-9A-Z]{5}"|ON CONFLICT|violates .* constraint|column .* does not exist|relation .* does not exist|invalid input syntax/i;
const AUTH = /\b40[13]\b|unauthori[sz]ed|forbidden|api[-_ ]?key|invalid[-_ ]token|token[-_ ]invalid|not configured|secret\b.*\bnot set|is not set\b/i;
const IG_TOKEN_CHURN = /account-token-invalid|client-token-invalid|token-missing/i;
const TRANSIENT = /timed? ?out|timeout|\b429\b|too many requests|rate[- ]?limit|\b50[234]\b|bad gateway|service unavailable|gateway time|temporary error|<html|ECONNRESET|connection (reset|refused|closed)|fetch failed|error sending request|network error|CIRCUIT_BREAKER|\b500 Something went wrong/i;
/** A live path saying what it did about the failure: its state, not a pure transient. */
const LIVE_STATE = /FROZEN|pending|outcome unknown|left as it is|stays|settle|stopp?ed|halt|disarm|tripped/i;

/**
 * Guard faults on `agents.quotes_live` that must stay visible. The dead-man beat, `agent_risk`, the balances and the
 * loss stop are written at most hourly (`liveAlerts`). `LEASE CLAIM FAILED` is not: the claim returns before that
 * throttle, so the fault writes a row every minute. A timeout-shaped row never made 15 consecutive minutes either, so
 * classifying it as transient noise hid it. The phrases are the writer's.
 */
const HOURLY_GUARD = /dead-man switch|agent_risk unreadable|balances unreadable|loss stop|LEASE CLAIM FAILED|lease renewal|lease lost|the lease is lost/i;

/**
 * Rows the box always shows, even when the words are a timeout. `7ed60689` hid these. A code or auth error on one of
 * these kinds is still that class (`classify` checks those first). `boxLines` then folds the same fault within one
 * hour; a different order or redeem stays its own line.
 */
function keptSeparate(row: Pick<OpsRow, "kind" | "message">): boolean {
  const kind = row.kind ?? "", msg = row.message ?? "";
  if (kind === "grokpm.redeem" || kind === "agents.quotes_weekend") return true;
  // The tick is not a LIVE_KIND, so "answered 500 … outcome unknown" was transient noise, and two orders became one count.
  if (kind === "agents.tick" && /\btrend-4h-live\b/.test(msg) && /outcome unknown|left pending/i.test(msg)) return true;
  if (kind === "agents.quotes_live" && HOURLY_GUARD.test(msg)) return true;
  return false;
}

/** A row's class, and whether it is shown at once or only when it persists. */
export function classify(row: Pick<OpsRow, "kind" | "message">): { cls: NoiseClass; noise: boolean } {
  const kind = row.kind ?? "", msg = row.message ?? "";
  if (kind.startsWith("monitor.")) return { cls: "monitor", noise: false };
  // A recorder that reports only when its coverage is at risk (the IG recorder since 2026-10-20) has already judged it.
  if (/^coverage at risk\b/i.test(msg)) return { cls: "other", noise: false };
  if (CODE.test(msg)) return { cls: "code", noise: false };
  if (kind.startsWith("ig.") && IG_TOKEN_CHURN.test(msg)) return { cls: RECORDER_KINDS.test(kind) ? "recorder" : "transient", noise: true };
  if (AUTH.test(msg)) return { cls: "auth", noise: false };
  // Before the transient path: these four are visible even when the words are a timeout or a 502.
  if (keptSeparate(row)) return { cls: "other", noise: false };
  if (TRANSIENT.test(msg)) {
    if (LIVE_KINDS.test(kind) && LIVE_STATE.test(msg)) return { cls: "other", noise: false };
    return { cls: "transient", noise: true };
  }
  if (RECORDER_KINDS.test(kind)) return { cls: "recorder", noise: true };
  return { cls: "other", noise: false };
}

/**
 * The order ids and redeem hashes a message names, lower case, in the order they appear, joined with commas.
 * Two rows of one fault share these; two orders do not.
 */
export function faultIds(msg: string | null): string {
  const found = String(msg ?? "").match(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b|\b0x[0-9a-f]{6,}\b/gi) ?? [];
  return found.map((s) => s.toLowerCase()).join(",");
}

/** A message with its ids, numbers and times taken out, so the same error reads as one line; an HTML page as its title. */
export function normalizeMessage(msg: string | null): string {
  const s = String(msg ?? "")
    .replace(/<html[\s\S]*?<title>([^<]*)<\/title>[\s\S]*$/i, "[$1]")
    .replace(/<html[\s\S]*$/i, "[html error page]")
    .replace(/\s+/g, " ").trim();
  return s
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "<id>")
    .replace(/\b0x[0-9a-f]{6,}\b/gi, "<hex>")
    .replace(/\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?/g, "<time>")
    .replace(/\d+(\.\d+)?/g, "#");
}

/** A message as a line shows it: whitespace folded, an HTML error page reduced to its title, at most 240 characters. */
export function displayMessage(msg: string | null): string {
  return String(msg ?? "")
    .replace(/<html[\s\S]*?<title>([^<]*)<\/title>[\s\S]*$/i, "[$1]")
    .replace(/<html[\s\S]*$/i, "[html error page]")
    .replace(/\s+/g, " ").trim().slice(0, 240);
}

const hhmm = (iso: string) => iso.slice(11, 16);

/**
 * Noise rows of one kind and class as episodes of consecutive runs, and the ones long enough to show. Rows any order.
 * An episode is shown when it has at least `PERSIST_MINUTES` rows of a minute job (`PERSIST_RUNS` of a slower one).
 */
export function persistentEpisodes(rows: OpsRow[], nowMs: number): Array<{ rows: OpsRow[]; ongoing: boolean }> {
  if (!rows.length) return [];
  const cadenceMs = cadenceMinutes(rows[0].kind) * 60_000;
  const need = cadenceMs <= 60_000 ? PERSIST_MINUTES : PERSIST_RUNS;
  const sorted = [...rows].sort((a, b) => a.created_at.localeCompare(b.created_at));
  const out: Array<{ rows: OpsRow[]; ongoing: boolean }> = [];
  let cur: OpsRow[] = [];
  const flush = () => {
    if (cur.length >= need) {
      const last = Date.parse(cur[cur.length - 1].created_at);
      out.push({ rows: cur, ongoing: nowMs - last <= 2 * cadenceMs });
    }
    cur = [];
  };
  for (const r of sorted) {
    if (cur.length && Date.parse(r.created_at) - Date.parse(cur[cur.length - 1].created_at) > CONSECUTIVE_RUNS_GAP * cadenceMs) flush();
    cur.push(r);
  }
  flush();
  return out;
}

const LABEL: Record<NoiseClass, string> = {
  monitor: "monitor", code: "code error", auth: "auth or config", transient: "upstream errors", recorder: "failed runs", other: "",
};

/**
 * What the box shows: its lines, newest first, and how many rows it leaves out as noise. `rows` are the summary's rows.
 */
export function boxLines(rows: OpsRow[], nowMs: number): { lines: OpsLine[]; shownRows: number; hiddenRows: number } {
  const shown = new Map<string, OpsLine>();
  const noise = new Map<string, OpsRow[]>();
  for (const r of rows) {
    const { cls, noise: isNoise } = classify(r);
    if (isNoise) {
      const k = `${r.kind}|${cls}`;
      (noise.get(k) ?? noise.set(k, []).get(k)!).push(r);
      continue;
    }
    // The hour bucket, the ids and the words. The same fault in one hour is one line; another order is not.
    const k = keptSeparate(r)
      ? `${r.kind}|${cls}|keep|${r.created_at.slice(0, 13)}|${faultIds(r.message)}|${normalizeMessage(r.message)}`
      : `${r.kind}|${cls}|${normalizeMessage(r.message)}`;
    const line = shown.get(k);
    if (!line) shown.set(k, { kind: r.kind, cls, message: displayMessage(r.message), count: 1, firstAt: r.created_at, latestAt: r.created_at });
    else {
      line.count++;
      if (r.created_at < line.firstAt) line.firstAt = r.created_at;
      if (r.created_at > line.latestAt) { line.latestAt = r.created_at; line.message = displayMessage(r.message); }
    }
  }
  const lines = [...shown.values()];
  let shownRows = lines.reduce((s, l) => s + l.count, 0);
  for (const [k, group] of noise) {
    const cls = k.slice(k.lastIndexOf("|") + 1) as NoiseClass;
    for (const ep of persistentEpisodes(group, nowMs)) {
      const first = ep.rows[0].created_at, last = ep.rows[ep.rows.length - 1].created_at, n = ep.rows.length;
      lines.push({
        kind: ep.rows[0].kind, cls, count: n, firstAt: first, latestAt: last, persistent: { ongoing: ep.ongoing },
        message: `${LABEL[cls]} ${ep.ongoing ? `failing since ${hhmm(first)} UTC` : `failed ${hhmm(first)}–${hhmm(last)} UTC`}, ${n} times; latest: ${displayMessage(ep.rows[n - 1].message).slice(0, 160)}`,
      });
      shownRows += n;
    }
  }
  lines.sort((a, b) => b.latestAt.localeCompare(a.latestAt));
  return { lines, shownRows, hiddenRows: rows.length - shownRows };
}
