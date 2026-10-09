// The realistic twins of PR5's live executor: the TESTING rows "Stablecoin quotes" (PR5's rule), "Stablecoin quotes
// variant-1" (PR5's rule at £50 a rung, since 2026-10-03), "Stablecoin quotes variant-2" (variant-1 with TAKE's taker
// entry from 2026-10-05, `take50`, 0089) and "Stablecoin quotes variant-3" (rule D's arm d, "variant-2" in
// its own pre-registration; "variant-1" on the page from 2026-10-02, Davies: "这个variant-2上线testing后改名为variant-1", until
// 2026-10-03). Davies, 2026-10-02: "…把所有已知的live遇到的不同点和问题全部在这几个testing策略上改动，确保一致，确保真实"; on the
// sizes the same evening, "改成原版每档100磅，variant-2 每档50磅，一定要确保新架构真实"; on the conversions, "都按我们昨天新设立的maker
// 费来换币". The design is frozen in docs/agents/reviews/2026-10-02-pr5-realistic-twins-prereg.md.
//
// A twin IS the live executor: `quotes_live.ts`'s own `runQuotesLive` and `runQuotesConvert`, run as an instance
// (`QuoteLiveInstance`) on tables of the twin's own, through the live client's own `revxVenue`, against a SIMULATED
// Revolut X account (`revx_sim.ts`) instead of the venue. Every rule the live executor has — the penny sizing, the exit
// trimmed to the penny, a refused exit waiting for a newer print, the crossing check before a POST, the cancel read back
// twice, the governor, the loss stop, the 24-hour stop, the de-peg and stale-input guards, the automatic top-ups — is
// the twin's by construction, today's and any added later. What the account does is the simulation's: fills only from
// public prints strictly through a resting order, by their quantity; money moved as Revolut X moves it; the dead-man.
// The asks' coin is bought as the operator buys it, through `runQuotesConvert`'s default: a maker conversion resting at
// the top of the bids, a quarter of the capital a book, at the twin's start. It fills only by the prints through it, so an
// ask has no coin until its conversion fills; one the executor cancels after 24 hours, or the venue refuses, the operator
// sends again for what the asks still lack. After that the executor's own automatic top-ups keep the asks' coin.
//
// Each twin is a row of `agent_quote_twin_specs` (0088, the twins' pre-registration's deviation 1: a variant that differs
// in its parameters is a row and its tables, not code) and carries out the decisions of one paper engine, minute for minute:
//   pr5  PR5's rule (`stepMinute`, quotes.ts), £1,200: twelve rungs of £100, one governed key, as the live account.
//   p50  PR5's rule again, £600: twelve rungs of £50, "Stablecoin quotes variant-1" on the page (2026-10-03, the size
//        study's proposal: what size does, measured forward beside pr5; docs/agents/reviews/2026-10-03-pr5-size-twin-prereg.md).
//   d    rule D (`stepVariantMinute` with `RULED_ARMS.d`, quotes_ruled.ts's judged arm), £1,800: thirty-six rungs of £50,
//        nine a side of each book, four governed keys (a book and a side each: the frozen design's four sub-accounts); from
//        2026-10-10 it quotes no entry on the 0.03 % rungs (`RULED_D_RETIRED`, Davies 2026-10-09), eight a side.
//        "Stablecoin quotes variant-3" on the page since 2026-10-03 (variant-1 before); PR5V keeps running off the page.
//   take50  0089's row: p50 with the rule extension `take` (`TWIN_RULES`), "Stablecoin quotes variant-2", TAKE's forward
//        test (docs/agents/reviews/2026-10-03-take-prereg.md). From its `take.from` a turn reads the book recorder's reads
//        around it (`takeReadsAt`) and waits for the first after it, so it turns a call behind; before then it is p50's.
// An id names a twin's tables and lease and never a variant number, so a page name changes in its row alone. pr5's and
// d's specs are what they were (quotes_twin.test.ts pins them; their backfills rebuild to the same bytes).
// It steps a REPLICA of its engine itself, from the inputs that engine decides on (PR5's stored minutes and prints), at
// PR5's own timing: rule D's own call decides each minute a minute after PR5's (it waits for PR5's record), so following
// its stored state would put every decision a minute late and the executor's stale-input guard would refuse every entry.
// Each call checks the replica against the engine's own record of the minutes that engine has since decided
// (`paperCheck`): for PR5 every event, for rule D its order, refusal and withdrawal events only (its pre-registration
// allows no read of its results before 2026-10-28).
//
// One call a minute (`agents?action=quotestwins`, 0087), every enabled twin in turn. A twin acts once a call, as the live executor
// acts once a minute: its turn stands at the instant PR5's call last read the prints (`fetchedTo`, about :25 into the
// minute), after every print up to that instant has been applied to the account in time order. A call that runs before
// PR5's (no new instant) does nothing; a twin that missed turns does not act in them, and a gap of more than three
// minutes since its last turn brings the dead-man down on its resting orders, as monitor/deadman.ts does live. Only
// while it is CATCHING UP — from its start, or from the record a backfill loaded — does a call run several turns, one in
// each minute PR5's call ran (its beats in `edge_call_beats`; every minute before they began), each at :25.

import type { Db } from "./db.ts";
import {
  fairHours, fxBarAt, median, newBookState, QUOTE_BOOKS, QUOTE_FX_LOOKBACK_MS, QUOTE_REPRICE, QUOTE_RUNGS, QUOTE_TICK, QUOTE_USD_BOOK, stepMinute,
  type BookState, type MinuteInputs, type Print, type QuoteBook, type Side,
} from "./quotes.ts";
import { newGovCounts, newVariantBook, printOrder, stepVariantMinute, variantKey, type GovCounts } from "./quotes_variant.ts";
import { RULED_ARMS } from "./quotes_ruled.ts";
import {
  pennyUp, QUOTE_LIVE_CONVERT_MAX_FRACTION, runQuotesConvert, runQuotesLive, seenUntil, takeBookRow, type QuoteLiveInstance, type QuoteLiveReport, type RecordedRead,
} from "./quotes_live.ts";
import { newSimState, SimRevx, type SimBook, type SimLevel, type SimState } from "./revx_sim.ts";
import { REVX_REGION, revxVenue } from "../_shared/revx.ts";

const M = 60e3, H = 3600e3, DAY = 86400e3;
const iso = (ms: number) => new Date(ms).toISOString();
const minuteOf = (ms: number) => Math.floor(ms / M) * M;
const msOf = (v: unknown) => (typeof v === "number" ? v : Date.parse(String(v)));
const enc = (ms: number) => encodeURIComponent(iso(ms));
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 300);

/** A catch-up turn stands this far into its minute: where PR5's call reads the prints (`QUOTES_START_MS`), as the live turn does. */
export const TWIN_TURN_OFFSET_MS = 25e3;
/** The dead-man's three minutes (monitor/deadman.ts): a twin whose last turn is older than this has its resting orders cancelled. */
export const TWIN_DEADMAN_MS = 3 * M;
/** PR5's call has written a beat since this minute (0075); before it, it is taken to have run every minute (its runs were not kept). */
export const QUOTES_BEATS_FROM = Date.parse("2026-10-01T16:25:00Z");
/** The beat PR5's call writes (`beatKeyOfRequest("agents", …?action=quotes)`). */
export const QUOTES_BEAT_PATH = "agents?action=quotes";
/**
 * Minutes whose beat says PR5's call started but whose executor did not finish a turn: the database stall of 2026-10-02
 * (ledger 14:23 and 18:44 UTC: the executor's last whole turn 12:16, the next 14:12). Its call began at 12:22, 12:36,
 * 13:05 and 13:09 and the paper engine's record stood at 12:21 from 12:22:43; a turn then would have withdrawn every
 * entry for stale inputs, as the 14:12:31 turn did, and the live account shows no order touched from 12:05:37 to 14:12:31.
 */
export const QUOTES_NO_TURN: Array<[number, number]> = [[Date.parse("2026-10-02T12:17:00Z"), Date.parse("2026-10-02T14:12:00Z")]];
/** PR5's engine has recorded what it decided each minute on since this minute (0055); before it, it is taken to have been caught up. */
export const QUOTE_RECORDS_FROM = Date.parse("2026-09-25T00:05:00Z");
/**
 * A call starts no new catch-up turn this long after it began: it begins 38 s into its minute, and its last turn ends
 * before the one-minute job's 58 s timeout and its own 55 s lease.
 */
export const TWIN_CALL_BUDGET_MS = 12e3;
/** At most this many minutes of the replica are stepped in one call, as PR5's engine catches up at most 120. */
export const TWIN_PAPER_MAX_MINUTES = 120;
/** A read of the replica's inputs covers at most this many minutes: their records, two a minute, stay inside one page. */
export const TWIN_PAPER_CHUNK_MINUTES = 480;
/** The lease of one call (every twin in turn). */
export const TWINS_LEASE = "quotes-twins";
export const TWINS_LEASE_MS = 55e3;
/**
 * TAKE's twin (docs/agents/reviews/2026-10-03-take-prereg.md): a turn at which a take may happen waits for the book
 * recorder's first read after it (it reads 40 s into the minute, after this call starts), at most this long; then it
 * turns, and a take finds no read to fill against.
 */
export const TWIN_TAKE_WAIT_MS = 120e3;
/** A take fills against the recorder's next read only when it came this soon after the turn (step 5). */
export const TAKE_NEXT_READ_MS = 60e3;

/** A twin's id: its spec row's, which names its tables and lease and never a variant number (a page name can change). */
export type TwinId = string;
export type TwinSpec = {
  id: TwinId;
  /** The page's name. */
  name: string;
  engine: "pr5" | "ruled-d";
  instance: QuoteLiveInstance;
  /** The twin's simulated account and its own driver state: one row. */
  sim: string;
  /** What it is funded with, all in pounds at its start; a quarter of it is converted into each coin, as a maker. */
  capitalGbp: number;
  /** Its engine's first decided minute: the replica starts flat the minute before, as the engine did. */
  start: number;
  /** Its committed record to a minute, which the call loads before its first turn (`loadTwinBackfill`); none: it starts. */
  backfill?: TwinBackfill;
  /**
   * The validation's replay of the live account only (the twins leave these out): its first turn's minute (the replica
   * steps from `start` without turns until then), its starting balances, the live account's own conversions at their
   * instants (the go-live's taker IOCs, as they were sent) in place of the operator's maker ones, and the instant from
   * which the dead-man exists.
   */
  replay?: { firstTurn: number; balances: Record<string, number>; conversions: Array<{ at: number; book: QuoteBook; gbp: number }>; deadmanFrom: number };
};
/**
 * A twin as a row of `agent_quote_twin_specs` (0088; Davies, 2026-10-03, "你说的这四点建议全做": a small variant is a row,
 * not a hand-wired twin). Its tables are `<table_prefix>_*`, made by `create_quote_twin_tables` from 0087's template. Its
 * rungs and exit re-price are its engine's own: the executor carries out the engine's rung decisions, so a twin with others
 * would quote rungs no engine decides; a different rule is an engine of its own, or a rule extension (`rules`).
 */
export type TwinSpecRow = {
  id: string; display_name: string; display_order: number; engine: "pr5" | "ruled-d"; capital_gbp: number | string;
  gov: "account" | "variant-keys"; start: string; table_prefix: string; lease: string;
  /** Rule extensions by key, each the code of `TWIN_RULES[key]`: `take` (`{ "from": "<UTC>" }`, TAKE's, 0089) the first. */
  rules: Record<string, unknown> | null;
  backfill: TwinBackfill | null; prereg: string;
  /** The migration that made its tables, which the executor names when they are missing. */
  migration: string; enabled: boolean;
};
/**
 * Rule D's twin quotes no entry on rule D's innermost rung, 0.03 %, from 2026-10-10 00:00 UTC (Davies, 2026-10-09, after
 * the stablecoin quotes review's F7, "…"规则 D 最内层的档位基本不赚钱"这个档删了": 114 trips for +£0.26 to 10-09, about 0 bps a
 * trip, and the POSTs that took `d` over one account's 1,000 a weekday). The twin alone: rule D's paper engine (arm `d`,
 * quotes_ruled.ts) keeps its nine rungs, so its 10-28 reading of rule D against variant-1 is unchanged, and the twin's
 * replica keeps deciding all nine (`paperCheck` still compares it with that engine's record); the executor carries out
 * eight. A rung keeps its £50 (its share of £1,800 over nine a side) and its holding exits as before. The twins'
 * pre-registration's deviation 4.
 */
export const RULED_D_RETIRED = { ks: [0.0003] as readonly number[], from: Date.parse("2026-10-10T00:00:00Z") };
/** Each engine's own rungs and exit re-price (`QuoteLiveInstance`), and the rungs its twins no longer quote. */
const ENGINES: Record<TwinSpecRow["engine"], { rungs: readonly number[]; exitReprice: number; retired?: QuoteLiveInstance["retired"] }> = {
  pr5: { rungs: QUOTE_RUNGS, exitReprice: QUOTE_REPRICE },
  "ruled-d": { rungs: RULED_ARMS.d.rungs, exitReprice: RULED_ARMS.d.reprice, retired: RULED_D_RETIRED },
};
/** The governed keys: the live account's one; or rule D's frozen design's four, a book and a side each (a conversion on its book's ask key). */
const GOV_KEYS: Record<TwinSpecRow["gov"], QuoteLiveInstance["govKey"]> = {
  account: () => "account",
  "variant-keys": (b, s) => variantKey(b, s ?? "ask"),
};
/**
 * The rule extensions a spec row may name in `rules`, by key, each the instance option it sets: `take`, TAKE's taker
 * entry from `from` (`QuoteLiveInstance.take`; docs/agents/reviews/2026-10-03-take-prereg.md). A key with no code here,
 * or one whose settings it cannot read, is refused.
 */
export const TWIN_RULES: Record<string, (v: unknown) => Partial<QuoteLiveInstance>> = {
  take: (v) => {
    const from = Date.parse(String((v as { from?: unknown } | null)?.from));
    if (!Number.isFinite(from)) throw new Error(`its rule take needs "from", a UTC instant`);
    return { take: { from } };
  },
};

/** A spec row as the call and the page use it; a row this code cannot carry out is refused with why. */
export function specFromRow(r: TwinSpecRow): TwinSpec {
  const eng = ENGINES[r.engine], govKey = GOV_KEYS[r.gov];
  if (!eng) throw new Error(`twin ${r.id}: no engine ${r.engine}`);
  if (!govKey) throw new Error(`twin ${r.id}: no governed keys ${r.gov}`);
  const noCode = Object.keys(r.rules ?? {}).filter((k) => !Object.hasOwn(TWIN_RULES, k));
  if (noCode.length) throw new Error(`twin ${r.id}: no code for its rule ${noCode.join(", ")}`);
  const rules: Partial<QuoteLiveInstance> = {};
  for (const [k, v] of Object.entries(r.rules ?? {})) {
    try { Object.assign(rules, TWIN_RULES[k](v)); } catch (e) { throw new Error(`twin ${r.id}: ${msg(e)}`); }
  }
  const p = r.table_prefix;
  return {
    id: r.id, name: r.display_name, engine: r.engine, sim: `${p}_sim`, capitalGbp: Number(r.capital_gbp), start: Date.parse(r.start),
    ...(r.backfill ? { backfill: r.backfill } : {}),
    instance: {
      config: `${p}_config`, orders: `${p}_orders`, events: `${p}_events`, state: `${p}_state`, paper: `${p}_paper`,
      migration: r.migration, lease: r.lease, rungs: eng.rungs, exitReprice: eng.exitReprice, govKey, ...(eng.retired ? { retired: eng.retired } : {}), ...rules,
    },
  };
}

/**
 * The rows 0088 inserts into `agent_quote_twin_specs`, in the page's order (Davies, 2026-10-03: "你目前正在做的variant改名为
 * variant-1排上面，这个新的是variant-2，原来的variant-1改名为variant-3"; variant-2 is 0089's row, take50). At run time the call and
 * the page read the table (`twinSpecs`); these are what the tests pin. A later variant is a row of its own migration, not a
 * line here; src/twin_specs.test.js holds these equal to 0088's rows. A row's `start` is its engine's first decided minute:
 * PR5's 2026-09-23 15:09 UTC (`agent_quote_events`' first row), rule D's 2026-09-28 00:00 (`RULED_START`).
 */
export const TWIN_SPEC_ROWS: TwinSpecRow[] = /* spec rows */ [
  { "id": "pr5", "display_name": "Stablecoin quotes", "display_order": 10, "engine": "pr5", "capital_gbp": 1200, "gov": "account", "start": "2026-09-23T15:09:00Z", "table_prefix": "agent_quote_twin_pr5", "lease": "quotes-twin-pr5", "rules": null, "backfill": { "file": "docs/agents/backtests/twins/pr5.json.gz", "sha256": "f04fb89659b608d12cc1533b4afc0599d4c008048ab9a1a6c40c5c8cc4843c98", "until": "2026-10-02T21:05:00.000Z" }, "prereg": "docs/agents/reviews/2026-10-02-pr5-realistic-twins-prereg.md", "migration": "0087", "enabled": true },
  { "id": "p50", "display_name": "Stablecoin quotes variant-1", "display_order": 20, "engine": "pr5", "capital_gbp": 600, "gov": "account", "start": "2026-09-23T15:09:00Z", "table_prefix": "agent_quote_twin_p50", "lease": "quotes-twin-p50", "rules": null, "backfill": { "file": "docs/agents/backtests/twins/p50.json.gz", "sha256": "f94c9ebecb6a757498fa39f25a2e9907c4e0e4a00f008a16dda17f25335a7bc8", "until": "2026-10-02T21:05:00.000Z" }, "prereg": "docs/agents/reviews/2026-10-03-pr5-size-twin-prereg.md", "migration": "0088", "enabled": true },
  { "id": "d", "display_name": "Stablecoin quotes variant-3", "display_order": 40, "engine": "ruled-d", "capital_gbp": 1800, "gov": "variant-keys", "start": "2026-09-28T00:00:00Z", "table_prefix": "agent_quote_twin_d", "lease": "quotes-twin-d", "rules": null, "backfill": { "file": "docs/agents/backtests/twins/d.json.gz", "sha256": "ecbec6c51dc34d1ae6d2e7b80dafa03194e3296600d460ac3fa1692b04bb9392", "until": "2026-10-02T21:05:00.000Z" }, "prereg": "docs/agents/reviews/2026-10-02-pr5-realistic-twins-prereg.md", "migration": "0087", "enabled": true }
] /* end spec rows */;
/** Each of those rows as a spec, by id. */
export const TWINS: Record<TwinId, TwinSpec> = Object.fromEntries(TWIN_SPEC_ROWS.map((r) => [r.id, specFromRow(r)]));
/** Their ids in the page's order, which the call also runs them in. */
export const TWIN_IDS: TwinId[] = TWIN_SPEC_ROWS.filter((r) => r.enabled).map((r) => r.id);
/** The spec table is missing: the function deployed before 0088 applied. */
const NO_TABLE = /PGRST205|42P01|Could not find the table|relation .* does not exist/i;

/**
 * The enabled twins in the page's order, from their rows; each row this code cannot carry out is left out, with why.
 * Before 0088 has applied, the twins 0087 made, as they ran before it (p50's tables are 0088's too).
 */
export async function twinSpecs(db: Db): Promise<{ specs: TwinSpec[]; refused: Array<{ id: string; why: string }> }> {
  let rows: TwinSpecRow[];
  try {
    rows = await db.select<TwinSpecRow>("agent_quote_twin_specs", "enabled=eq.true&select=*&order=display_order.asc");
  } catch (e) {
    if (!NO_TABLE.test(msg(e))) throw e;
    rows = TWIN_SPEC_ROWS.filter((r) => r.enabled && r.migration === "0087");
  }
  const specs: TwinSpec[] = [], refused: Array<{ id: string; why: string }> = [];
  for (const r of rows) {
    try { specs.push(specFromRow(r)); } catch (e) { refused.push({ id: r.id, why: msg(e) }); }
  }
  return { specs, refused };
}
/** Every table a twin writes, and every table it reads: what `onlyTables` holds it to in the tests. */
export const twinWrites = (s: TwinSpec) => [s.instance.config, s.instance.orders, s.instance.events, s.instance.state, s.instance.paper, s.sim];
export const TWIN_READS = [
  "agent_quote_state", "agent_quote_minutes", "agent_quote_prints", "agent_quote_inputs", "agent_quote_events", "agent_quoted_state", "agent_quoted_events",
  "edge_call_beats", "agent_risk", "agent_quote_twin_specs", "agent_book_levels",
];

// ------------------------------------------------------------------ TAKE's reads of the recorded books

/** Whether a twin's turn at `at` may take (its spec's `take`, from its instant): only then does it read the recorded books. */
export const takesAt = (spec: TwinSpec, at: number) => !!spec.instance.take && at >= spec.instance.take.from;
/** What the book recorder holds of a book around a turn: its last read at or before the turn, and its first after it. */
export type TakeReads = { before: RecordedRead | null; after: RecordedRead | null };
export async function takeReadsAt(db: Db, at: number): Promise<Record<QuoteBook, TakeReads>> {
  const out = {} as Record<QuoteBook, TakeReads>;
  for (const b of QUOTE_BOOKS) {
    const sel = "select=ts,seen_until,bids,asks";
    const [before] = await db.select<RecordedRead>("agent_book_levels", `book=eq.${b}&ts=lte.${enc(at)}&${sel}&order=ts.desc&limit=1`);
    const [after] = await db.select<RecordedRead>("agent_book_levels", `book=eq.${b}&ts=gt.${enc(at)}&${sel}&order=ts.asc&limit=1`);
    out[b] = { before: before ?? null, after: after ?? null };
  }
  return out;
}
/** Has the recorder read the book since `at`: the read the turn met, read again after it, or a new one? */
export const recorderReadAfter = (r: TakeReads, at: number) => (r.before != null && seenUntil(r.before) > at) || r.after != null;
/**
 * The read a take at `at` fills against (step 5): the one the turn met when the recorder read it again after the turn,
 * else the recorder's next read when it came within TAKE_NEXT_READ_MS; else none, and nothing fills.
 */
export function takeFillRead(r: TakeReads, at: number): RecordedRead | null {
  if (r.before && Date.parse(r.before.ts) <= at && seenUntil(r.before) > at) return r.before;
  return r.after && Date.parse(r.after.ts) > at && Date.parse(r.after.ts) - at <= TAKE_NEXT_READ_MS ? r.after : null;
}
/** A recorded read as the simulated account's book: its levels, named by the read and its first instant (`SimBook.at`). */
export const simBookOfRead = (r: RecordedRead): SimBook => ({
  bids: r.bids.map((l): SimLevel => [Number(l[0]), Number(l[1])]), asks: r.asks.map((l): SimLevel => [Number(l[0]), Number(l[1])]),
  source: `recorded read ${new Date(Date.parse(r.ts)).toISOString()}`, at: Date.parse(r.ts),
});

// ------------------------------------------------------------------ the replica of the paper engine

/** The replica, in the shape the executor reads a paper engine's state (`QuoteState`), and what is still to be checked. */
export type TwinPaper = {
  engine: "pr5" | "ruled-d"; lastMinute: number; books: Record<QuoteBook, BookState>; gov: GovCounts | null;
  fetchedTo: Record<string, number>; hourFetchedFor: number;
  /** Events the replica decided that its engine's own record has not been checked against yet: [minute, book, side, k, kind, ticks]. */
  unchecked: Array<[number, string, string, number, string, number | null]>;
};
/** The kinds checked against each engine's own record: every one of PR5's; rule D's decisions only (its no-peek). */
const CHECKED: Record<TwinPaper["engine"], string[]> = { pr5: ["order", "refused", "withdraw", "fill", "exit", "stop"], "ruled-d": ["order", "refused", "withdraw"] };

/** The replica flat, the minute before its engine's first, each book seeded with its last print before then (as the engine was). */
export function newTwinPaper(spec: TwinSpec, seeds: Record<QuoteBook, Print | null>): TwinPaper {
  const books = Object.fromEntries(QUOTE_BOOKS.map((b) => [b, spec.engine === "pr5" ? newBookState(b, seeds[b]) : newVariantBook(b, RULED_ARMS.d, seeds[b])])) as Record<QuoteBook, BookState>;
  return { engine: spec.engine, lastMinute: spec.start - M, books, gov: spec.engine === "pr5" ? null : newGovCounts(), fetchedTo: {}, hourFetchedFor: 0, unchecked: [] };
}

type PrintRow = { id: string; ts: string; price: number | string; qty: number | string; side: Print["side"] };
const toPrint = (r: PrintRow): Print => ({ id: r.id, ts: msOf(r.ts), ticks: Math.round(Number(r.price) / QUOTE_TICK), qty: Number(r.qty), side: r.side });
type MinuteRow = { book: QuoteBook; minute: string; x: number | string | null; fair_u: number | string | null };
const num = (v: unknown) => (v == null ? null : Number(v));

/** Each book's last stored print before `t`, as the engines seed themselves (the last in code-point order of the newest few). */
export async function seedPrints(db: Db, t: number): Promise<Record<QuoteBook, Print | null>> {
  const out = {} as Record<QuoteBook, Print | null>;
  for (const b of QUOTE_BOOKS) {
    const p = await db.select<PrintRow>("agent_quote_prints", `book=eq.${b}&ts=lt.${enc(t)}&select=id,ts,price,qty,side&order=ts.desc,id.desc&limit=50`);
    out[b] = p.map(toPrint).sort(printOrder).at(-1) ?? null;
  }
  return out;
}

/** The stored prints of each book in [from, to), in the rule's order (time, then id code point by code point). */
export async function printsBetween(db: Db, from: number, to: number): Promise<Record<QuoteBook, Print[]>> {
  const out = {} as Record<QuoteBook, Print[]>;
  for (const b of QUOTE_BOOKS) {
    const rows = await db.selectAll<PrintRow>("agent_quote_prints", `book=eq.${b}&ts=gte.${enc(from)}&ts=lt.${enc(to)}&select=id,ts,price,qty,side&order=ts.asc,id.asc`);
    out[b] = rows.map(toPrint).sort(printOrder);
  }
  return out;
}

/**
 * Steps the replica through minutes (lastMinute, upTo], at most TWIN_PAPER_MAX_MINUTES, on what its engine decides
 * them on: PR5's record of each book-minute (`agent_quote_minutes`: the X and fairU its `stepMinute` was given) and the
 * minute's stored prints; a book-minute with no record is rebuilt from the stored series with PR5's own functions, as the
 * variant engines rebuild it. Rule D's books are stepped minute by minute across both (their governor's day is shared).
 */
export async function stepTwinPaper(db: Db, p: TwinPaper, upTo: number, maxMinutes = TWIN_PAPER_MAX_MINUTES): Promise<{ minutes: number; rebuilt: number }> {
  const out = { minutes: 0, rebuilt: 0 };
  const stop = Math.min(upTo, p.lastMinute + maxMinutes * M);
  // Eight hours at most per read: two books' records of 480 minutes are 960 rows, inside PostgREST's 1,000 a request
  // (a longer chunk lost its later records to that cap and rebuilt those minutes from the series instead).
  while (p.lastMinute < stop) {
    const r = await stepChunk(db, p, Math.min(stop, p.lastMinute + TWIN_PAPER_CHUNK_MINUTES * M));
    out.minutes += r.minutes; out.rebuilt += r.rebuilt;
  }
  return out;
}

async function stepChunk(db: Db, p: TwinPaper, last: number): Promise<{ minutes: number; rebuilt: number }> {
  const first = p.lastMinute + M;
  if (last < first) return { minutes: 0, rebuilt: 0 };
  const n = (last - first) / M + 1;
  const recRows = await db.select<MinuteRow>("agent_quote_minutes", `minute=gte.${enc(first)}&minute=lte.${enc(last)}&select=book,minute,x,fair_u&order=minute.asc,book.asc&limit=${2 * n}`);
  if (recRows.length >= 1000) throw new Error(`replica: ${recRows.length} minute records in one read of ${n} minutes, at PostgREST's page size`);
  const recs = new Map(recRows.map((r) => [`${r.book}|${msOf(r.minute)}`, r]));
  const prints = await printsBetween(db, first, last + M);
  const missing = QUOTE_BOOKS.filter((b) => { for (let t = first; t <= last; t += M) if (!recs.has(`${b}|${t}`)) return true; return false; });
  let fxBars: Array<[number, number]> = [];
  const hours = {} as Record<QuoteBook, Array<[number, number]>>;
  if (missing.length) {
    const fxRows = await db.selectAll<{ t: string; value: number }>("agent_quote_inputs", `kind=eq.fx&t=gte.${enc(first - QUOTE_FX_LOOKBACK_MS)}&t=lte.${enc(last)}&select=t,value&order=kind.asc,t.asc`);
    fxBars = fxRows.map((r) => [msOf(r.t), Number(r.value)] as [number, number]);
    for (const b of missing) {
      const hRows = await db.selectAll<{ t: string; value: number }>("agent_quote_inputs", `kind=eq.${encodeURIComponent(`fair:${QUOTE_USD_BOOK[b]}`)}&t=gte.${enc(first - DAY)}&t=lte.${enc(last)}&select=t,value&order=kind.asc,t.asc`);
      hours[b] = hRows.map((r) => [msOf(r.t), Number(r.value)] as [number, number]);
    }
  }
  const j = { "USDC-GBP": 0, "USDT-GBP": 0 } as Record<QuoteBook, number>;
  let rebuilt = 0;
  for (let t = first; t <= last; t += M) {
    for (const b of QUOTE_BOOKS) {
      const mine: Print[] = [];
      while (j[b] < prints[b].length && prints[b][j[b]].ts < t + M) { if (prints[b][j[b]].ts >= t) mine.push(prints[b][j[b]]); j[b]++; }
      const rec = recs.get(`${b}|${t}`);
      let inp: MinuteInputs;
      if (rec) inp = { x: num(rec.x), fairU: num(rec.fair_u), prints: mine };
      else {
        const bar = fxBarAt(t, fxBars);
        inp = { x: bar ? bar[1] : null, fairU: median(fairHours(t, hours[b] ?? [])), prints: mine };
        rebuilt++;
      }
      const events = p.engine === "pr5" ? stepMinute(p.books[b], t, inp).events : stepVariantMinute(p.books[b], t, inp, RULED_ARMS.d, p.gov!).events;
      for (const e of events) if (CHECKED[p.engine].includes(e.kind)) p.unchecked.push([t, b, e.side, e.k, e.kind, e.ticks]);
    }
  }
  p.lastMinute = last;
  return { minutes: n, rebuilt };
}

/** What the last check of the replica against its engine's own record found. */
export type PaperCheck = { through: number | null; minutes: number; events: number; mismatches: number; first: string | null };

/**
 * The replica against its engine's own record, for every minute the engine has decided since: PR5's `agent_quote_events`
 * (every event), rule D's `agent_quoted_events` of arm `d` (its order, refusal and withdrawal events: nothing of its
 * results). Equal event for event, minute for minute, or the mismatch is counted and the first one named.
 */
export async function checkTwinPaper(db: Db, p: TwinPaper, prev: PaperCheck | null): Promise<PaperCheck> {
  const out: PaperCheck = prev ? { ...prev } : { through: null, minutes: 0, events: 0, mismatches: 0, first: null };
  if (!p.unchecked.length) return out;
  const engineState = p.engine === "pr5" ? "agent_quote_state" : "agent_quoted_state";
  const decided = (await db.select<{ last_minute: string | null }>(engineState, "id=eq.1&select=last_minute"))[0]?.last_minute;
  if (!decided) return out;
  const upTo = msOf(decided);
  const due = p.unchecked.filter((e) => e[0] <= upTo);
  if (!due.length) return out;
  const from = due[0][0], to = due.at(-1)![0];
  const kinds = CHECKED[p.engine].join(",");
  const rows = p.engine === "pr5"
    ? await db.selectAll<{ minute: string; book: string; side: string; k: number | string; kind: string; ticks: number | string | null }>("agent_quote_events",
      `minute=gte.${enc(from)}&minute=lte.${enc(to)}&kind=in.(${kinds})&select=book,minute,side,k,kind,ticks&order=book.asc,minute.asc,side.asc,k.asc,kind.asc`)
    : await db.selectAll<{ minute: string; book: string; side: string; k: number | string; kind: string; ticks: number | string | null }>("agent_quoted_events",
      `arm=eq.d&minute=gte.${enc(from)}&minute=lte.${enc(to)}&kind=in.(${kinds})&select=book,minute,side,k,kind,ticks&order=arm.asc,book.asc,minute.asc,side.asc,k.asc,kind.asc`);
  const key = (m: number, b: string, s: string, k: number, kind: string, ticks: number | null) => `${iso(m)}|${b}|${s}|${Number(k)}|${kind}|${ticks == null ? "" : Number(ticks)}`;
  const theirs = rows.map((r) => key(msOf(r.minute), r.book, r.side, Number(r.k), r.kind, r.ticks == null ? null : Number(r.ticks))).sort();
  const ours = due.map((e) => key(e[0], e[1], e[2], e[3], e[4], e[5])).sort();
  const a = new Set(theirs), b = new Set(ours);
  const diff = [...ours.filter((x) => !a.has(x)).map((x) => `replica only ${x}`), ...theirs.filter((x) => !b.has(x)).map((x) => `engine only ${x}`)];
  out.through = to; out.minutes += new Set(due.map((e) => e[0])).size; out.events += ours.length;
  if (diff.length) { out.mismatches += diff.length; out.first ??= diff[0]; }
  p.unchecked = p.unchecked.filter((e) => e[0] > upTo);
  return out;
}

// ------------------------------------------------------------------ the simulated account's book and prints

/** PR5's order-book snapshot as `agent_quote_events` keeps it (kind `book`): the levels the venue served, when. */
type SnapshotRow = { book: QuoteBook; minute: string; detail: { at?: number; book?: unknown } };
/** The levels of a snapshot as the venue served them (`{ bids, asks }` of `{ price, quantity }`), or nothing. */
export function snapshotLevels(raw: unknown): { bids: SimLevel[]; asks: SimLevel[] } | null {
  const top = raw && typeof raw === "object" ? raw as Record<string, unknown> : null;
  const d = top && "data" in top && top.data && typeof top.data === "object" ? top.data as Record<string, unknown> : top;
  if (!d || !Array.isArray(d.bids) || !Array.isArray(d.asks)) return null;
  const lv = (x: unknown): SimLevel | null => {
    const o = x && typeof x === "object" ? x as Record<string, unknown> : null;
    const px = Number(Array.isArray(x) ? x[0] : o?.price ?? o?.p), q = Number(Array.isArray(x) ? x[1] : o?.quantity ?? o?.q);
    return px > 0 ? [px, q > 0 ? q : 0] : null;
  };
  return { bids: (d.bids as unknown[]).map(lv).filter((l): l is SimLevel => !!l), asks: (d.asks as unknown[]).map(lv).filter((l): l is SimLevel => !!l) };
}

/** The books a turn's account meets: PR5's snapshot of the turn's minute, read once for the minutes a call turns in. */
export async function snapshotsFor(db: Db, from: number, to: number): Promise<Map<string, SimBook>> {
  const rows = await db.selectAll<SnapshotRow>("agent_quote_events",
    `kind=eq.book&side=eq.-&k=eq.0&minute=gte.${enc(from)}&minute=lte.${enc(to)}&select=book,minute,side,k,kind,detail&order=book.asc,minute.asc,side.asc,k.asc,kind.asc`);
  const out = new Map<string, SimBook>();
  for (const r of rows) {
    const lv = snapshotLevels(r.detail?.book);
    if (lv && (lv.bids.length || lv.asks.length)) out.set(`${r.book}|${msOf(r.minute)}`, { ...lv, source: "paper snapshot", at: Number(r.detail?.at) || msOf(r.minute) });
  }
  return out;
}

/**
 * Every stored print of each book after the last one applied and up to `at`, applied to the account in time order —
 * with the dead-man: when the twin's last turn is more than TWIN_DEADMAN_MS before `at`, the prints up to that
 * deadline are applied, every resting order is cancelled at it, and the prints after it fill nothing.
 */
export async function applyPrintsTo(db: Db, sim: SimRevx, at: number, setClock: (t: number) => void, deadmanFrom = -Infinity): Promise<{ prints: number; deadman: number | null; cancelled: number }> {
  const st = sim.st;
  const from = Math.min(...QUOTE_BOOKS.map((b) => st.applied[b]?.ts ?? at - H));
  const all = await printsBetween(db, from, at + 1);
  const deadline = st.lastTurnAt != null && at - st.lastTurnAt > TWIN_DEADMAN_MS && st.lastTurnAt + TWIN_DEADMAN_MS >= deadmanFrom ? st.lastTurnAt + TWIN_DEADMAN_MS : null;
  let prints = 0, cancelled = 0;
  const run = (upTo: number) => {
    for (const b of QUOTE_BOOKS) for (const p of all[b]) {
      if (p.ts > upTo) break;
      const last = st.applied[b];
      if (last && (p.ts < last.ts || (p.ts === last.ts && p.id <= last.id))) continue;
      setClock(p.ts);
      sim.applyPrint(b, p);
      prints++;
    }
  };
  if (deadline != null) {
    run(deadline);
    setClock(deadline);
    cancelled = sim.deadman(deadline);
  }
  run(at);
  return { prints, deadman: deadline, cancelled };
}

// ------------------------------------------------------------------ the backfill

/**
 * A twin's record from its engine's first minute up to `until`, computed by THIS code in memory on PR5's stored inputs
 * (docs/agents/scripts/twins/backfill.ts) and committed beside them (docs/agents/backtests/twins/). A twin with no record
 * yet loads its backfill on its first call, checked against the sha256 its spec row pins (`backfill`), and then catches
 * up from `until`, turn by turn, as the catch-up has run from the start; the record is the one the code would have written
 * in production.
 */
export type TwinBackfill = { file: string; sha256: string; until: string };
/** Where the committed backfills are read from: the repository's own files on `main`, which is public. */
export const TWIN_BACKFILL_BASE = "https://raw.githubusercontent.com/daviesluo/daviesportfolios/main/";
/** The rows a backfill carries: each of the twin's tables as the code left them, the orders without their ids. */
export type TwinBackfillData = {
  v: 1; twin: TwinId; until: string;
  config: Record<string, unknown>; orders: Array<Record<string, unknown>>; events: Array<Record<string, unknown>>;
  state: Record<string, unknown>; paper: Record<string, unknown>; sim: Record<string, unknown>;
};
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");

type TableRow = Record<string, unknown>;
/**
 * A twin's backfill from its tables as the code left them (docs/agents/scripts/twins/backfill.ts writes it): every row,
 * the orders in the order they were written and without their ids, which the database gives them again as it loads them
 * (nothing a twin keeps names an order by its id: the operator's conversions are named by their client ids).
 */
export function twinBackfillOf(spec: TwinSpec, until: number, t: Record<"config" | "orders" | "events" | "state" | "paper" | "sim", TableRow[]>): TwinBackfillData {
  const one = (name: keyof typeof t) => {
    if (t[name].length !== 1) throw new Error(`backfill ${spec.id}: ${t[name].length} ${name} rows, not one`);
    return t[name][0];
  };
  return {
    v: 1, twin: spec.id, until: iso(until),
    config: one("config"),
    orders: [...t.orders].sort((a, b) => Number(a.id) - Number(b.id)).map(({ id: _id, ...o }) => o),
    events: t.events, state: one("state"), paper: one("paper"), sim: one("sim"),
  };
}

/** Reads, checks and writes a twin's backfill; null when its record is whole, else what stopped it (the next call tries again). */
export async function loadTwinBackfill(db: Db, spec: TwinSpec, bf: TwinBackfill, fetchImpl: typeof fetch, now: number): Promise<string | null> {
  const res = await fetchImpl(`${TWIN_BACKFILL_BASE}${bf.file}`, { signal: AbortSignal.timeout(20_000) });
  if (!res.ok) return `backfill ${bf.file}: ${res.status}`;
  const bytes = new Uint8Array(await res.arrayBuffer());
  const hash = hex(await crypto.subtle.digest("SHA-256", bytes));
  if (hash !== bf.sha256) return `backfill ${bf.file}: sha256 ${hash}, not the pinned ${bf.sha256}`;
  const text = await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"))).text();
  const data = JSON.parse(text) as TwinBackfillData;
  if (data.v !== 1 || data.twin !== spec.id || data.until !== bf.until) return `backfill ${bf.file}: it is not ${spec.id}'s to ${bf.until}`;
  // Idempotent by their keys, so a load cut short is completed by the next call; the account's row goes last: it says
  // the record is whole.
  await db.upsert(spec.instance.config, [data.config], "id");
  for (let i = 0; i < data.orders.length; i += 250) await db.upsert(spec.instance.orders, data.orders.slice(i, i + 250), "client_order_id");
  for (let i = 0; i < data.events.length; i += 1000) await db.upsert(spec.instance.events, data.events.slice(i, i + 1000), "mode,minute,book,rung_side,k,kind");
  await db.upsert(spec.instance.state, [data.state], "id");
  await db.upsert(spec.instance.paper, [data.paper], "id");
  const sim = data.sim as { state: TwinDriverState };
  sim.state.origin = { kind: "backfill", file: bf.file, sha256: bf.sha256, until: Date.parse(bf.until), loadedAt: now };
  await db.upsert(spec.sim, [sim], "id");
  return null;
}

// ------------------------------------------------------------------ the call

/** The twin's own state, beside its account: how it is running, and what it has checked. */
export type TwinDriverState = {
  venue: SimState;
  /** "catch-up" runs a turn in each minute PR5's call ran; "forward" one turn a call, at PR5's instant. */
  mode: "catch-up" | "forward";
  turns: number; started: number | null;
  paperCheck: PaperCheck | null;
  /** Where its record came from: a backfill loaded (its file and sha256), or its own start. */
  origin: { kind: "fresh" } | { kind: "backfill"; file: string; sha256: string; until: number; loadedAt: number };
  lastReport: { at: string; prints: number; deadman: string | null; cancelled: number; errors: string[]; skipped?: string } | null;
  /** The operator's conversions, newest last (the last TWIN_CONVERSIONS_KEPT): when, which book, the pounds, the answer. */
  conversions?: Array<{ at: string; book: QuoteBook; gbp: number; taker: boolean; result: unknown }>;
  /**
   * Each book's operator conversion: the order the operator sent last (its client order id, which a backfill's load
   * keeps), until a conversion has filled whole or the asks hold their worth (`done`); while it rests, nothing; once the
   * executor cancels it or the venue refuses it, the operator sends another for what the asks still lack.
   */
  operator?: Partial<Record<QuoteBook, { cid: string | null; at: string; gbp: number; sent: number; done: boolean; last?: string }>>;
  /** The orders it sent each UTC day (rows written, less those recorded refused and never sent): its page's DAYS. */
  days?: Record<string, number>;
  /**
   * TAKE's twin, forward: the turns waiting for the book recorder's read after them (`TWIN_TAKE_WAIT_MS`), oldest first,
   * each at PR5's instant with the minute PR5 had decided then. Absent when none waits.
   */
  waiting?: Array<{ at: number; upTo: number }>;
};
/** How many of the operator's conversions the twin's state keeps. */
export const TWIN_CONVERSIONS_KEPT = 20;

export type TwinDeps = {
  db: Db;
  /** The wall clock (the call's start); turns stand at PR5's instants, never at it. */
  now: number;
  holder: string;
  /** The wall clock the call's budget reads (the tests move it). */
  clock?: () => number;
  /** A signing key for the live client's signed calls. The simulated account never reads it: it is generated, never a Revolut X key. */
  signingKey: CryptoKey;
  /** The harness only: catch up to this minute and stay catching up (a backfill's end), never turn forward. */
  catchUpUntil?: number;
  /** The call's budget for catch-up turns (TWIN_CALL_BUDGET_MS); the harness passes Infinity. */
  budgetMs?: number;
  /** How a twin with no record yet gets its committed backfill (its spec's `backfill`); without it, the twin starts itself. */
  fetch?: typeof fetch;
  /** The tests' backfills by twin id, in place of each spec's own. */
  backfills?: Partial<Record<TwinId, TwinBackfill>>;
  /** Its orders' client ids: random, as the live executor's; the backfill's builder numbers them, so its file is the same each run. */
  uuid?: () => string;
};
export type TwinReport = {
  twin: TwinId; skipped?: string; mode?: TwinDriverState["mode"]; turns: number; lastTurn: string | null;
  paper?: { minutes: number; rebuilt: number }; check?: PaperCheck | null;
  /** How many errors the executor's turns reported (they are its record's, not faults of the twin). */
  executorErrors?: number;
  /** The executor's report of the call's last turn, as `runQuotesLive` returned it. */
  lastTurnReport?: QuoteLiveReport;
  /** The twin's own faults: a read that failed, a write refused. */
  errors: string[];
};

/** The minutes PR5's call ran in [from, to]: its beats, and every minute before they began. */
export async function quotesCallMinutes(db: Db, from: number, to: number): Promise<number[]> {
  const out: number[] = [];
  for (let m = from; m <= Math.min(to, QUOTES_BEATS_FROM - M); m += M) out.push(m);
  const lo = Math.max(from, QUOTES_BEATS_FROM);
  if (lo <= to) {
    for (let a = lo; a <= to; a += 900 * M) {
      const b = Math.min(to, a + 899 * M);
      const rows = await db.select<{ minute: string }>("edge_call_beats", `path=eq.${encodeURIComponent(QUOTES_BEAT_PATH)}&minute=gte.${enc(a)}&minute=lte.${enc(b)}&select=minute&order=minute.asc&limit=1000`);
      for (const r of rows) out.push(minuteOf(msOf(r.minute)));
    }
  }
  return [...new Set(out)].filter((m) => !QUOTES_NO_TURN.some(([a, b]) => m >= a && m < b)).sort((x, y) => x - y);
}

/**
 * Where PR5's engine stood when its call of minute `m` had run: the last minute it had recorded by the end of that
 * minute (`agent_quote_minutes.recorded_at`, about 27 s in, written before the live executor's turn in the same call).
 * Before its records began, caught up; otherwise, with nothing recorded in the four hours before, `null`: it is no
 * further on than the replica already is.
 */
export async function pr5DecidedBy(db: Db, m: number): Promise<number | null> {
  if (m - M < QUOTE_RECORDS_FROM) return m - M;
  const rows = await db.select<{ minute: string }>("agent_quote_minutes",
    `minute=gte.${enc(m - 240 * M)}&minute=lte.${enc(m - M)}&recorded_at=lte.${enc(m + M - 1)}&select=minute&order=minute.desc&limit=1`);
  return rows[0] ? msOf(rows[0].minute) : null;
}

/** A twin's tables seeded at its start: its config (live and armed on the simulated account), its account, its replica. */
async function startTwin(d: TwinDeps, spec: TwinSpec): Promise<TwinDriverState> {
  const seeds = await seedPrints(d.db, spec.start);
  const paper = newTwinPaper(spec, seeds);
  await d.db.upsert(spec.instance.config, [{ id: 1, dry_run: false, live_confirmed_at: iso(spec.start), capital_gbp: spec.capitalGbp, updated_at: iso(spec.start) }], "id");
  await d.db.upsert(spec.instance.paper, [{ id: 1, state: paper, last_minute: iso(paper.lastMinute), updated_at: iso(spec.start) }], "id");
  return {
    venue: newSimState(spec.replay?.balances ?? { GBP: spec.capitalGbp }, seeds), mode: "catch-up", turns: 0, started: null, paperCheck: null, origin: { kind: "fresh" }, lastReport: null,
  };
}

/**
 * One turn of a twin at `at`: the replica stepped to `upTo`, the prints to `at` applied (and the dead-man), at its first
 * turn the operator's conversions (a quarter of the capital into each coin, as makers), then the live executor, and
 * after it the operator's look at each conversion it sent.
 */
async function twinTurn(
  d: TwinDeps, spec: TwinSpec, ds: TwinDriverState, paper: TwinPaper, at: number, upTo: number, snapshots: Map<string, SimBook>, report: TwinReport,
  reads: Record<QuoteBook, TakeReads> | null = null,
) {
  // Catching up, the replica stands where its engine stood at each of those turns: caught up, as PR5's engine was
  // whenever its call ran (it decides up to 120 missed minutes a run, and no gap in its beats is longer). Forward, it
  // steps as PR5's engine does, at most TWIN_PAPER_MAX_MINUTES a call: behind, the executor's stale-input guard holds.
  const stepped = await stepTwinPaper(d.db, paper, upTo, ds.mode === "catch-up" ? Number.POSITIVE_INFINITY : TWIN_PAPER_MAX_MINUTES);
  report.paper = { minutes: (report.paper?.minutes ?? 0) + stepped.minutes, rebuilt: (report.paper?.rebuilt ?? 0) + stepped.rebuilt };
  await d.db.upsert(spec.instance.paper, [{ id: 1, state: paper, last_minute: iso(paper.lastMinute), updated_at: iso(at) }], "id");
  // The venue's clock: a print's instant while the prints are applied, then the turn's for the whole turn. A turn that
  // may take (`reads`) gives the account the recorded read each take meets (`takeFillRead`).
  let venueNow = at;
  const takeRead = reads ? (b: QuoteBook) => { const r = takeFillRead(reads[b], at); return r ? simBookOfRead(r) : null; } : undefined;
  const sim = new SimRevx(ds.venue, () => venueNow, (b, t) => snapshots.get(`${b}|${minuteOf(t)}`) ?? null, takeRead);
  const applied = await applyPrintsTo(d.db, sim, at, (t) => { venueNow = t; }, spec.replay?.deadmanFrom);
  venueNow = at;
  if (applied.deadman != null) {
    await d.db.upsert(spec.instance.events, [{ mode: "live", minute: iso(minuteOf(applied.deadman)), book: "-", rung_side: "-", k: 0, kind: "deadman",
      detail: { at: iso(applied.deadman), lastTurn: ds.venue.lastTurnAt != null ? iso(ds.venue.lastTurnAt) : null, cancelled: applied.cancelled } }], "mode,minute,book,rung_side,k,kind");
  }
  // The orders it sends, by UTC day: each row written counts, one recorded refused and never sent does not.
  const tally = (t: number) => (n: number) => { const day = iso(t).slice(0, 10); (ds.days ??= {})[day] = (ds.days[day] ?? 0) + n; };
  // The executor's own clock moves with its pauses (its pacing, its re-reads); the venue's stands at the turn's instant.
  // A take reaches the account by its order row, written before its POST (`request.take`), and decides on the read the
  // turn met (`takeBookRow`).
  let offset = 0;
  const markTake = (row: Record<string, unknown>) => { if ((row.request as { take?: unknown } | null)?.take === true) sim.markTake(String(row.client_order_id)); };
  const deps = {
    db: stampTs(d.db, spec.instance.orders, () => at, tally(at), reads ? markTake : undefined), now: at, holder: `${d.holder}:${spec.id}:${at}`, uuid: d.uuid ?? (() => crypto.randomUUID()),
    account: revxVenue({ apiKey: `simulated-${spec.id}`, privateKey: d.signingKey }, sim.fetch, REVX_REGION, () => at), accountNote: null,
    fetch: sim.publicFetch, pause: (ms: number) => { offset += ms; return Promise.resolve(); }, clock: () => at + offset, instance: spec.instance,
    ...(reads ? { recordedBook: (b: QuoteBook) => Promise.resolve(takeBookRow(reads[b].before, at)) } : {}),
  };
  const errors: string[] = [];
  /**
   * The operator's `quotes-convert` through the live code's own `runQuotesConvert`, at its own instant: by default a maker
   * resting at the top of the bids (the twins'); `taker`, the IOC the live account's go-live sent (the validation's replay
   * only). Without `send`, what it would send: the operator reads the asks' shortfall from it.
   */
  const convert = async (c: { at: number; book: QuoteBook; gbp: number }, o: { taker?: boolean; send?: boolean } = {}) => {
    const cd = {
      ...deps, db: stampTs(d.db, spec.instance.orders, () => c.at, tally(c.at)), now: c.at, clock: () => c.at, holder: `${deps.holder}:convert:${c.at}`,
      account: revxVenue({ apiKey: `simulated-${spec.id}`, privateKey: d.signingKey }, sim.fetch, REVX_REGION, () => c.at),
    };
    venueNow = c.at;
    try {
      const send = o.send !== false;
      const r = await runQuotesConvert(cd, { book: c.book, gbp: c.gbp, send, ...(o.taker ? { taker: true } : {}) });
      if (send) {
        (ds.conversions ??= []).push({ at: iso(c.at), book: c.book, gbp: c.gbp, taker: !!o.taker, result: r });
        if (ds.conversions.length > TWIN_CONVERSIONS_KEPT) ds.conversions.splice(0, ds.conversions.length - TWIN_CONVERSIONS_KEPT);
      }
      return r;
    } finally { venueNow = at; }
  };
  const cidOf = (r: Record<string, unknown>) => String((r.row as { client_order_id?: unknown } | null | undefined)?.client_order_id ?? "") || null;
  // A twin's start, as the operator went live: a quarter of its capital into each coin (three asks' worth, the most one
  // conversion may buy), each a maker at the top of the bids, two and one seconds before its first turn, so that turn
  // places its bids from the pounds the conversions leave. Its asks wait for their coin until a conversion fills.
  if (ds.turns === 0 && !spec.replay) {
    for (const [i, book] of QUOTE_BOOKS.entries()) {
      const c = { at: at - 1_000 * (QUOTE_BOOKS.length - i), book, gbp: spec.capitalGbp * QUOTE_LIVE_CONVERT_MAX_FRACTION };
      const r = await convert(c);
      (ds.operator ??= {})[book] = { cid: cidOf(r), at: iso(c.at), gbp: c.gbp, sent: 1, done: false, ...("error" in r ? { last: String(r.error) } : {}) };
      if ("error" in r) errors.push(`conversion ${book}: ${String(r.error)}`);
    }
  }
  const live: QuoteLiveReport = await runQuotesLive(deps);
  // The validation's replay converts as the live account did, at its own instants after a turn: taker IOCs.
  for (const c of spec.replay?.conversions ?? []) {
    if (!(c.at > at && c.at < at + M)) continue;
    const r = await convert(c, { taker: true });
    if ("error" in r) errors.push(`conversion ${c.book}: ${String(r.error)}`);
  }
  // The operator's look at each conversion it sent, two and three seconds after the turn: resting, it waits; filled, it is
  // done; cancelled after 24 hours or refused, another goes out for what the asks still lack (the shortfall the live
  // code reports, at the maker price it would rest at, at most a quarter of the capital), or none when they lack nothing.
  for (const [i, book] of QUOTE_BOOKS.entries()) {
    const op = ds.operator?.[book];
    if (!op || op.done) continue;
    const row = op.cid == null ? null : (await d.db.select<{ state: string; base_size: number | string; filled_base: number | string }>(spec.instance.orders,
      `client_order_id=eq.${op.cid}&select=state,base_size,filled_base`))[0] ?? null;
    if (row && ["pending", "new", "partially_filled"].includes(row.state)) continue;
    // Filled whole, it is done. One cancelled after filling in part is booked `filled` with what it filled (the executor's
    // own rule): the asks still lack the rest, as after a cancel that filled nothing.
    if (row?.state === "filled" && Number(row.filled_base) >= Number(row.base_size) - 1e-9) { op.done = true; continue; }
    const t = at + 1_000 * (2 + i), cap = spec.capitalGbp * QUOTE_LIVE_CONVERT_MAX_FRACTION;
    const would = await convert({ at: t, book, gbp: cap }, { send: false });
    const ws = (would as { wouldSend?: { limit?: string; asksNeed?: number; coinBeyondLongs?: number } }).wouldSend;
    if (!ws) {
      op.last = String((would as { error?: unknown }).error ?? "no answer");
      if (/already holds/.test(op.last)) op.done = true;
      continue;
    }
    const gbp = Math.min(cap, pennyUp(Math.max(0, Number(ws.asksNeed) - Number(ws.coinBeyondLongs)) * Number(ws.limit)));
    if (!(gbp > 0)) { op.done = true; continue; }
    const r = await convert({ at: t, book, gbp });
    op.last = "error" in r ? String(r.error) : undefined;
    if ("error" in r) { if (/already holds|under the venue's minimum/.test(String(r.error))) op.done = true; continue; }
    Object.assign(op, { cid: cidOf(r), at: iso(t), gbp, sent: op.sent + 1 });
  }
  // The executor's own errors are its record's (its state row's `last_error`, as the live account's): they say what the
  // simulated account did, and none of them is a fault of the twin. The call's report counts them.
  errors.push(...live.errors);
  ds.venue.lastTurnAt = at;
  ds.turns++;
  ds.started ??= at;
  // A finished order the executor no longer has open is kept an hour, then dropped from the account's record.
  const open = await d.db.select<{ venue_order_id: string | null }>(spec.instance.orders, "state=in.(pending,new,partially_filled)&select=venue_order_id&limit=1000");
  sim.prune(new Set(open.map((o) => o.venue_order_id).filter((x): x is string => !!x)));
  ds.lastReport = { at: iso(at), prints: applied.prints, deadman: applied.deadman != null ? iso(applied.deadman) : null, cancelled: applied.cancelled, errors: errors.slice(0, 20), ...(live.skipped ? { skipped: live.skipped } : {}) };
  report.executorErrors = (report.executorErrors ?? 0) + errors.length;
  report.lastTurnReport = live;
}

/**
 * A database that stamps the orders it inserts with the turn's instant (`ts`), where the database would stamp its own
 * clock, tells `tally` how many it wrote (+1 a row) and how many of them were recorded refused and never sent (−1), and
 * shows `onRow` each order it wrote (TAKE's twin: a take reaches the simulated account this way, before its POST).
 */
export function stampTs(db: Db, table: string, at: () => number, tally?: (n: number) => void, onRow?: (row: Record<string, unknown>) => void): Db {
  return {
    ...db,
    insert: async <T = unknown>(t: string, rows: unknown, returning?: boolean): Promise<T[]> => {
      if (t !== table) return db.insert<T>(t, rows, returning);
      const list = (Array.isArray(rows) ? rows : [rows]).map((r) => ({ ts: iso(at()), ...(r as Record<string, unknown>) }));
      const out = await db.insert<T>(t, Array.isArray(rows) ? list : list[0], returning);
      tally?.(list.length);
      if (onRow) for (const r of list) onRow(r);
      return out;
    },
    update: async (t, query, patch) => {
      const out = await db.update(t, query, patch);
      if (t === table && (patch as { response?: { wouldBeRefused?: unknown } } | null)?.response?.wouldBeRefused === true) tally?.(-1);
      return out;
    },
  };
}

/** One twin's part of the call. */
async function runOneTwin(d: TwinDeps, spec: TwinSpec, began: number): Promise<TwinReport> {
  const report: TwinReport = { twin: spec.id, turns: 0, lastTurn: null, errors: [] };
  const clock = d.clock ?? Date.now;
  const pr5 = (await d.db.select<{ last_minute: string | null; fetched: Record<string, number> | null }>("agent_quote_state", "id=eq.1&select=last_minute,fetched:state->fetchedTo"))[0];
  if (!pr5?.last_minute) return { ...report, skipped: "PR5's engine has decided no minute yet" };
  const T = msOf(pr5.last_minute);
  const horizon = Math.min(...QUOTE_BOOKS.map((b) => Number(pr5.fetched?.[b] ?? NaN)));
  const row = (await d.db.select<{ state: TwinDriverState }>(spec.sim, "id=eq.1&select=state"))[0];
  const ds = row?.state && "venue" in row.state ? row.state : await startTwin(d, spec);
  const paperRow = (await d.db.select<{ state: TwinPaper }>(spec.instance.paper, "id=eq.1&select=state"))[0];
  const paper = paperRow?.state && "books" in paperRow.state ? paperRow.state : newTwinPaper(spec, await seedPrints(d.db, spec.start));
  report.mode = ds.mode;
  const save = async (lastError: string | null) => {
    await d.db.upsert(spec.sim, [{ id: 1, state: ds, updated_at: iso(ds.venue.lastTurnAt ?? spec.start), last_error: lastError }], "id");
  };
  try {
    if (ds.mode === "catch-up") {
      // A turn in each minute PR5's call ran, each at :25, up to the minute before PR5's present instant.
      const lastTurnMinute = ds.venue.lastTurnAt != null ? minuteOf(ds.venue.lastTurnAt) : (spec.replay ? spec.replay.firstTurn - M : spec.start);
      const until = d.catchUpUntil ?? (Number.isFinite(horizon) ? minuteOf(horizon) - M : T);
      const minutes = (await quotesCallMinutes(d.db, lastTurnMinute + M, Math.min(until, T + M))).filter((m) => m - M <= T);
      const budget = d.budgetMs ?? TWIN_CALL_BUDGET_MS;
      let snapshots = new Map<string, SimBook>(), snapTo = -Infinity, left = minutes.length;
      for (const m of minutes) {
        if (clock() - began >= budget) break;
        // A turn that may take waits for the recorder's read after it (TAKE's twin), at most TWIN_TAKE_WAIT_MS.
        const reads = takesAt(spec, m + TWIN_TURN_OFFSET_MS) ? await takeReadsAt(d.db, m + TWIN_TURN_OFFSET_MS) : null;
        if (reads && !QUOTE_BOOKS.every((b) => recorderReadAfter(reads[b], m + TWIN_TURN_OFFSET_MS)) && d.now < m + TWIN_TURN_OFFSET_MS + TWIN_TAKE_WAIT_MS) break;
        if (m > snapTo) { snapTo = m + 240 * M; snapshots = await snapshotsFor(d.db, m, snapTo); }
        await twinTurn(d, spec, ds, paper, m + TWIN_TURN_OFFSET_MS, (await pr5DecidedBy(d.db, m)) ?? paper.lastMinute, snapshots, report, reads);
        report.turns++;
        report.lastTurn = iso(m + TWIN_TURN_OFFSET_MS);
        left--;
      }
      // Caught up: every minute PR5's call ran before its present one has had its turn. From here one turn a call.
      if (!left && d.catchUpUntil == null && Number.isFinite(horizon) && minuteOf(horizon) - M <= T) ds.mode = "forward";
    }
    if (ds.mode === "forward" && d.catchUpUntil == null && !spec.instance.take) {
      if (!Number.isFinite(horizon) || horizon <= (ds.venue.lastTurnAt ?? 0)) report.skipped = "PR5's call has read no print since this twin's last turn";
      else {
        const snapshots = await snapshotsFor(d.db, minuteOf(horizon), minuteOf(horizon));
        await twinTurn(d, spec, ds, paper, horizon, T, snapshots, report);
        report.turns++;
        report.lastTurn = iso(horizon);
      }
    } else if (ds.mode === "forward" && d.catchUpUntil == null) {
      // TAKE's twin: each new instant of PR5's call joins the queue with the minute PR5 had decided then, and turns as soon
      // as it need not wait; one that may take waits for the recorder's read after it, which comes after this call starts,
      // so from `take.from` it turns a call behind. Before then it turns in the call, as every twin does.
      const queue = ds.waiting ?? [];
      const newest = Math.max(ds.venue.lastTurnAt ?? 0, ...queue.map((w) => w.at));
      if (Number.isFinite(horizon) && horizon > newest) queue.push({ at: horizon, upTo: T });
      let turned = 0;
      while (queue.length) {
        const w = queue[0];
        const reads = takesAt(spec, w.at) ? await takeReadsAt(d.db, w.at) : null;
        if (reads && !QUOTE_BOOKS.every((b) => recorderReadAfter(reads[b], w.at)) && d.now < w.at + TWIN_TAKE_WAIT_MS) break;
        queue.shift();
        if (queue.length) ds.waiting = queue; else delete ds.waiting;
        const snapshots = await snapshotsFor(d.db, minuteOf(w.at), minuteOf(w.at));
        await twinTurn(d, spec, ds, paper, w.at, w.upTo, snapshots, report, reads);
        report.turns++;
        report.lastTurn = iso(w.at);
        turned++;
      }
      if (queue.length) ds.waiting = queue; else delete ds.waiting;
      if (!turned) report.skipped = queue.length ? `its turn at ${iso(queue[0].at)} waits for the book recorder's read after it` : "PR5's call has read no print since this twin's last turn";
    }
    ds.paperCheck = await checkTwinPaper(d.db, paper, ds.paperCheck).catch((e) => { report.errors.push(`paper check: ${msg(e)}`); return ds.paperCheck; });
    report.check = ds.paperCheck;
    await d.db.upsert(spec.instance.paper, [{ id: 1, state: paper, last_minute: iso(paper.lastMinute), updated_at: iso(ds.venue.lastTurnAt ?? spec.start) }], "id");
    await save(report.errors.length ? report.errors.join(" | ").slice(0, 500) : null);
  } catch (e) {
    report.errors.push(msg(e));
    try { await save(report.errors.join(" | ").slice(0, 500)); } catch { /* the next call reads the last saved state */ }
  }
  return report;
}

/**
 * One call: every enabled twin in turn, in the page's order, under one lease: the spec table's rows (`twinSpecs`), unless
 * `specs` names the twins (the tests, the backfill builder). A twin's failure is its report's and its row's, and does not
 * stop the twins after it.
 */
export async function runQuotesTwins(d: TwinDeps, specs?: TwinSpec[]): Promise<{ skipped?: string; twins: TwinReport[] }> {
  const clock = d.clock ?? Date.now, began = clock();
  const held = await d.db.claim<{ name: string }>("agent_locks", `name=eq.${TWINS_LEASE}&lease_until=lt.${enc(d.now)}`, { lease_until: iso(d.now + TWINS_LEASE_MS), holder: d.holder });
  if (!held.length) return { skipped: `another run holds the ${TWINS_LEASE} lease`, twins: [] };
  const twins: TwinReport[] = [];
  let loaded = false;
  try {
    if (!specs) {
      const read = await twinSpecs(d.db);
      specs = read.specs;
      for (const r of read.refused) twins.push({ twin: r.id, turns: 0, lastTurn: null, errors: [r.why], skipped: "its spec row is not one this code carries out" });
    }
    // A twin with no record yet loads its committed backfill first: one file a call (each is megabytes), and no turn of
    // that twin in the call that loads it, so the call ends inside its minute. The twins whose records are whole still
    // take their turns in that call (deviation 1, 2026-10-03: a twin added later must not cost the running ones a turn).
    // A twin whose own record cannot be read (its migration not yet applied) neither loads nor turns this call, and says
    // why; the other twins run.
    const apart = new Set<TwinId>();
    if (d.fetch) {
      for (const spec of specs) {
        const bf = d.backfills ? d.backfills[spec.id] : spec.backfill;
        if (!bf) continue;
        let row: { state: TwinDriverState | Record<string, never> } | undefined;
        try {
          row = (await d.db.select<{ state: TwinDriverState | Record<string, never> }>(spec.sim, "id=eq.1&select=state"))[0];
        } catch (e) {
          apart.add(spec.id);
          twins.push({ twin: spec.id, turns: 0, lastTurn: null, errors: [`its record cannot be read: ${msg(e)}`], skipped: "its record cannot be read" });
          continue;
        }
        if (row?.state && "venue" in row.state) continue;
        apart.add(spec.id);
        if (loaded) { twins.push({ twin: spec.id, turns: 0, lastTurn: null, errors: [], skipped: "its backfill loads on a later call: one file a call" }); continue; }
        loaded = true;
        const report: TwinReport = { twin: spec.id, turns: 0, lastTurn: null, errors: [] };
        const why = await loadTwinBackfill(d.db, spec, bf, d.fetch, d.now).catch((e) => `backfill ${bf.file}: ${msg(e)}`);
        if (why) report.errors.push(why);
        twins.push({ ...report, skipped: why ? "its backfill is not loaded yet" : `its backfill to ${bf.until} is loaded; it catches up from there` });
      }
    }
    for (const spec of specs) {
      if (apart.has(spec.id)) continue;
      twins.push(await runOneTwin(d, spec, began).catch((e): TwinReport => ({ twin: spec.id, turns: 0, lastTurn: null, errors: [msg(e)] })));
    }
  } finally {
    try { await d.db.update("agent_locks", `name=eq.${TWINS_LEASE}&holder=eq.${encodeURIComponent(d.holder)}`, { lease_until: iso(d.now), holder: null }); } catch { /* it expires */ }
  }
  return loaded ? { skipped: "a backfill was loaded this call", twins } : { twins };
}
