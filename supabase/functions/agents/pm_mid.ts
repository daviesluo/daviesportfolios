// "Reward quotes mid-pool": Polymarket's order path and its paper layer, run a second time on rewarded markets of $10 to
// under $50 a day, in DRY-RUN only. Davies, 2026-10-02, verbatim:
//
//   把目前Reward quotes live-prep改名为Reward quotes small-pool，再做一个Reward quotes mid-pool只做10-50，同时也不打扰其他的Reward
//   quotes，也是400美元funded测试
//
// In English: rename the current "Reward quotes live-prep" to "Reward quotes small-pool"; build a "Reward quotes
// mid-pool" that only does $10–50; without disturbing the other Reward quotes; also tested as funded with $400.
//
// WHAT IT IS: the same code as small-pool, the path (`pm_live.ts`) and the layer (`pm_prep.ts`), each given an instance
// (`PM_MID_INSTANCE`, `PREP_MID_INSTANCE`) that names its own tables (`pm_mid_*`, `pm_midprep_*`, migration 0081), its own
// leases (`pm-mid`, `pm-midprep`) and its band. Every other filter of the selection, RW's ranking, RW's quoting rule as
// RW-E applies it, the gates, the caps and the stops are the path's, at small-pool's $400 sizes (0081's config row: eight
// markets, $160, $320, $60 a market, −$25 a day, −$75 in all, GTD 600 s).
//
// THE SAME REAL ORDER PATH, IN DRY-RUN (0084; Davies, 2026-10-02: "把mid-pool 的结构和路径也做成和mini-pool一样的真实下单路径，按上线规模
// 跑 dry-run，之后更好对比，现在就做不要等"). Until 0084 it could never place an order: its config refused `dry_run` false and
// any `live_confirmed_at`, its action loaded no signing key, and its wire refused every POST and DELETE. Now its action
// is mini-pool's (`agents?action=pmmid`, index.ts): the key loaded for the stored signer, the account's pUSD read every
// minute, the same keyed wire; and its config row is the lock, `dry_run` true and `live_confirmed_at` null, as
// mini-pool's is. One Polymarket account cannot carry two armed paths: a trigger on both configs refuses arming either
// while the other is armed (0084), and each go-time statement refuses it too (the design doc's steps 8 and 8m). Going
// live is that one statement, only in the conversation where Davies says go, and needs first what that step lists.
//
// NOT DISTURBING THE OTHER REWARD QUOTES. RW (to 10-09), RW-E and RW-X (replays on RW's minutes) and RW-C (10-09 → 10-23,
// warm-up 10-08) quote, on paper, the markets RW's frozen selection takes from the universe of $10 and over, which holds
// this band. A market of theirs must never be one of mid-pool's: its page would show RW's rule on their markets before
// their verdicts, and a live mid-pool's orders would sit in the books they quote against. Their tables are not to be
// read (RW-NEXT's no-peek list forbids every row of `pm_rwc_*` before 10-23; RW's spec, market-level figures of 09-28 or
// later before 10-09), so mid-pool computes, at its own selection, RW's frozen selection rule from public data, exactly
// as the RW spec words it ("The portfolio, re-selected daily"), with RW's own functions (`summarize`, `firstScore`,
// `choose`, `RW_BUDGET_USD`, `RW_MIN_RATE`; pmrw.ts, frozen and only imported) and RW's own reads (the CLOB's short list
// for the tokens, its books in one POST, Gamma for what the list lacks and for whether a chosen market accepts orders;
// `_shared/polymarket_public.ts`, keyless), on the reward listing the selection has just read whole: the universe a rate
// of at least $10 and a maximum spread above 0; each market scored by RW's first-round reward per dollar; whole markets
// taken in that order while they fit in $300, one that does not fit passed over, and one Gamma does not show accepting
// dropped and the choice made again (`runPmrwSelect`'s loop). Then it leaves out of its own universe every market scoring
// at least (1 − `PM_MID_EXCLUSION_MARGIN`) of the last market that rule takes (`rwExclusion`), and records only how many
// it left out — never which, so its records are never a list of RW-C's likely picks. After RW-C's verdict the audit
// compares its daily picks with RW-C's actual ones (the pre-registration, reviews/2026-10-02-polymarket-mid-pool-prereg.md).

import { choose, firstScore, RW_BUDGET_USD, RW_MIN_RATE, summarize } from "./pmrw.ts";
import { PM_CLOB, pmBooks, pmMarkets, pmSimplifiedMarkets, type PmBook, type PmMarket, type PmPublicOpts } from "../_shared/polymarket_public.ts";
import type { PmBookReply } from "../_shared/polymarket_orders.ts";
import type { PmExclusion, PmLiveInstance, PmRewardRow } from "./pm_live.ts";
import type { PrepInstance } from "./pm_prep.ts";

/** Mid-pool's band of total daily reward rates: from RW's own floor ($10, `RW_MIN_RATE`) to under $50. */
export const PM_MID_BAND = { floor: RW_MIN_RATE, ceiling: 50 } as const;

/**
 * The exclusion's margin: a market of mid-pool's band is left out when it scores at least (1 − this) of the last market
 * RW's rule takes, by RW's own first-round reward per dollar on the books read at mid-pool's selection. RW's selection
 * and RW-C's read their books seconds to minutes from ours (each tries every five minutes until a day lands), and a
 * market's score moves with its book. Measured keylessly on 2026-10-02 (`backtests/pmlive/scripts/mid_margin.ts`, output
 * `backtests/pmlive/results/mid_margin_out.txt`: RW's selection recomputed fourteen times about 72 s apart by this file's
 * `rwSelectionNow`, counts and ratios only, no market named):
 *   - 37 markets joined RW's picks from one recomputation to the next. 18 were not scorable the minute before; of the
 *     19 that were, three scored under half of that minute's last pick (0.158, 0.431, 0.473) and the rest 0.719 or more.
 *   - Mid-pool's picks at each recomputation against RW's picks at every later one (91 pairs, 1 to 16 minutes apart): at
 *     a margin of 0.5 one of them was RW's in 40 pairs (3 of the 25 at most two minutes apart); at 0.67 and 0.8, in none.
 *   - The cost: about 17 of the band's markets left out at each recomputation at 0.67 (7 at 0.5, 60 at 0.8). Mid-pool's
 *     own selection at 0.67 left out 9 to 12 of the about 1,370 markets of its universe
 *     (`backtests/pmlive/results/mid_selection_time_out.txt`).
 * So 0.67, the least margin with no overlap: a market of ours must triple its score to become RW's. What no margin can
 * cover, a market first scorable after our read, the post-10-23 audit counts.
 */
export const PM_MID_EXCLUSION_MARGIN = 0.67;

/** One market of RW's universe as RW's first round scores it (`firstScore`), from the books read now. */
export type RwScored = { cond: string; perDollar: number; cap: number };

/**
 * RW's frozen selection, recomputed: the RW spec's "The portfolio, re-selected daily", by RW's own functions and reads
 * (`runPmrwSelect` in pmrw.ts, whose loop this follows step for step, without its table). `listing` is the reward listing
 * the path's selection has just read whole (both listings, a market listed twice at its larger rate, as
 * `pmRewardsCurrent` keeps it). Returns every market it scored and the markets it takes, or why it could not.
 */
export async function rwSelectionNow(listing: Map<string, PmRewardRow>, ctx: Parameters<PmExclusion>[1]): Promise<{ scored: RwScored[]; taken: RwScored[]; universe: number } | { error: string }> {
  const { dl, pm } = ctx;
  const late = () => dl.clock() > dl.until;
  const universe = [...listing].filter(([, r]) => r.rate >= RW_MIN_RATE && r.v > 0);
  try {
    // Every market's YES token: the CLOB's short list, and Gamma for the few it does not carry.
    if (late()) return { error: "time budget: the deadline came before RW's tokens were read" };
    const simple = new Map([...await pmSimplifiedMarkets(pm)].map(([c, t]) => [c.toLowerCase(), t]));
    const gamma = new Map<string, PmMarket>();
    const gammaRead = async (conds: string[]) => { for (const m of await pmMarkets(conds, false, pm)) gamma.set(m.cond.toLowerCase(), m); };
    const absent = universe.filter(([c]) => !simple.has(c)).map(([c]) => c);
    if (absent.length) {
      if (late()) return { error: "time budget: the deadline came before RW's tokens were read" };
      await gammaRead(absent);
    }
    const yesOf = new Map<string, string>();
    for (const [c] of universe) {
      const yes = simple.get(c)?.yes ?? gamma.get(c)?.yes;
      if (yes) yesOf.set(c, yes);
    }
    if (late()) return { error: "time budget: the deadline came before RW's books were read" };
    const books: Map<string, PmBook> = await pmBooks([...yesOf.values()], pm);
    const scored: RwScored[] = [];
    for (const [c, r] of universe) {
      const yes = yesOf.get(c), bk = yes ? books.get(yes) : undefined;
      if (!bk) continue;
      const tick = bk.tick ?? gamma.get(c)?.tick ?? 0.01;
      const fs = firstScore(summarize(bk.bids, bk.asks, r.v, r.minSize), tick, r.v, r.minSize, r.rate);
      if (fs) scored.push({ cond: c, ...fs });
    }
    // `choose` over the markets Gamma accepts, asking Gamma only about the ones it takes, as RW's selection does.
    const out = new Set<string>();
    let taken = choose(scored, RW_BUDGET_USD);
    for (;;) {
      const ask = taken.map((x) => x.cond).filter((c) => !gamma.has(c) && !out.has(c));
      if (ask.length) {
        if (late()) return { error: "time budget: the deadline came before Gamma was read for RW's picks" };
        await gammaRead(ask);
      }
      const drop = taken.filter((x) => {
        const m = gamma.get(x.cond);
        return !m || !m.accepting || m.yes !== yesOf.get(x.cond);
      });
      if (!drop.length) break;
      for (const x of drop) out.add(x.cond);
      taken = choose(scored.filter((x) => !out.has(x.cond)), RW_BUDGET_USD);
    }
    return { scored, taken, universe: universe.length };
  } catch (e) {
    return { error: `RW's selection could not be recomputed: ${(e instanceof Error ? e.message : String(e)).slice(0, 200)}` };
  }
}

/**
 * The markets that must not be mid-pool's: every market scoring at least (1 − margin) of the last market RW's rule takes,
 * RW's picks among them. Nothing taken leaves nothing out.
 */
export function leftOut(r: { scored: RwScored[]; taken: RwScored[] }, margin = PM_MID_EXCLUSION_MARGIN): Set<string> {
  if (!r.taken.length) return new Set();
  const last = Math.min(...r.taken.map((x) => x.perDollar)), bar = (1 - margin) * last;
  return new Set([...r.taken.map((x) => x.cond), ...r.scored.filter((x) => x.perDollar >= bar - 1e-15).map((x) => x.cond)]);
}

/**
 * Mid-pool's exclusion (`PmExclusion`): RW's selection recomputed now, and the markets near its top left out. Its note
 * holds counts only: RW's universe and how many of it RW's score could rank (the path's selection adds how many of
 * mid-pool's universe were left out). A read that fails fails the selection, which is tried again five minutes later.
 */
export const rwExclusion: PmExclusion = async (listing, ctx) => {
  const began = ctx.dl.clock();
  const r = await rwSelectionNow(listing, ctx);
  if ("error" in r) return r;
  return { excluded: leftOut(r), note: { rule: "RW", margin: PM_MID_EXCLUSION_MARGIN, universe: r.universe, scored: r.scored.length, ms: Math.round(ctx.dl.clock() - began) } };
};

/** A hundred tokens a POST, six POSTs at once: `pmBooks`' own pace (`_shared/polymarket_public.ts`). */
const BATCH_TOKENS = 100, BATCH_CONCURRENCY = 6;

/**
 * Many tokens' books, a hundred a keyless POST to the CLOB's `/books`, each answered as GET /book serves it (`market`,
 * `asset_id`, `bids`, `asks`, `tick_size`, `min_order_size`, `neg_risk`, `hash`, `timestamp`; measured identical,
 * keyless, 2026-10-02), so the path's own `bookNow` reads it; a token the CLOB has no book for is not in the answer. The
 * read `pmBooks` makes (the same host and route, no redirect, a timeout), keeping the whole reply. Mid-pool's selection
 * reads its candidates' books this way (`PmLiveInstance.bookBatch`): about 1,010 of them on 2026-10-02, against
 * small-pool's about 490 (`backtests/pmlive/results/selection_time_out.txt`). Read one GET each, as small-pool reads its
 * own, mid-pool's whole selection took about 2.1 s of CPU, past the 2 s an Edge request may use; read in batches, about
 * 1.2 s (`backtests/pmlive/results/mid_selection_time_out.txt`: the process's CPU, every thread counted, three
 * selections each way less the imports alone, in this repository's container, never measured on Supabase).
 */
export async function bookReplies(tokens: string[], pm: PmPublicOpts = {}): Promise<Map<string, PmBookReply>> {
  const out = new Map<string, PmBookReply>();
  const chunks: string[][] = [];
  for (let i = 0; i < tokens.length; i += BATCH_TOKENS) chunks.push(tokens.slice(i, i + BATCH_TOKENS));
  let next = 0;
  const worker = async () => {
    while (next < chunks.length) {
      const chunk = chunks[next++];
      const res = await (pm.fetchImpl ?? fetch)(`${PM_CLOB}/books`, {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json", "User-Agent": "daviesportfolios-pm-mid/1.0 (public data only)" },
        body: JSON.stringify(chunk.map((t) => ({ token_id: t }))),
        redirect: "manual",
        signal: AbortSignal.timeout(pm.timeoutMs ?? 15_000),
      });
      const text = await res.text();
      if (!res.ok) throw new Error(`POST clob.polymarket.com/books → ${res.status} ${text.slice(0, 160)}`);
      let rows: unknown;
      try { rows = JSON.parse(text); } catch { throw new Error("POST clob.polymarket.com/books → not JSON"); }
      for (const b of Array.isArray(rows) ? rows as PmBookReply[] : []) if (b && typeof b.asset_id === "string") out.set(b.asset_id, b);
    }
  };
  await Promise.all(Array.from({ length: Math.min(BATCH_CONCURRENCY, chunks.length) }, worker));
  return out;
}

/**
 * The path's mid-pool instance (0081): its tables, its lease, its band and its exclusion. Its config row keeps it a
 * dry-run (0084). It reads no payout, share or rebate (`readsPayouts` false), so its records stay what its
 * pre-registration names: the account is mini-pool's too, and Polymarket pays the account, not a path. Mini-pool's
 * readout books every market the account is paid for; a funded mid-pool needs that readout to tell the two paths'
 * markets apart first (a change to `pm_live.ts`, after mini-pool's window), the design doc's step 8m.
 */
export const PM_MID_INSTANCE: PmLiveInstance = {
  name: "Reward quotes mid-pool",
  tables: {
    config: "pm_mid_config", markets: "pm_mid_markets", orders: "pm_mid_orders", fills: "pm_mid_fills", events: "pm_mid_events", state: "pm_mid_state",
    minutes: "pm_mid_minutes", rewardDays: "pm_mid_reward_days", settlements: "pm_mid_settlements",
  },
  lock: "pm-mid",
  band: { ...PM_MID_BAND },
  migrations: { tables: "0081", selection: "0081" },
  exclusion: rwExclusion,
  bookBatch: bookReplies,
  readsPayouts: false,
  action: "pmmid",
  path: "agents?action=pmmid&forceFunctionRegion=eu-west-1",
  errorKind: "agents.pm_mid",
};

/** The paper layer's mid-pool instance (0081): it reads `pm_mid_*` and writes `pm_midprep_*`. */
export const PREP_MID_INSTANCE: PrepInstance = {
  name: "Reward quotes mid-pool",
  tables: {
    state: "pm_midprep_state", minutes: "pm_midprep_minutes", prints: "pm_midprep_prints", fills: "pm_midprep_fills", days: "pm_midprep_days",
    settlements: "pm_midprep_settlements", events: "pm_midprep_events",
  },
  reads: { config: "pm_mid_config", markets: "pm_mid_markets", minutes: "pm_mid_minutes", orders: "pm_mid_orders" },
  lock: "pm-midprep",
  migration: "0081",
};
