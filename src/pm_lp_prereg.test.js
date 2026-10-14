// The live-prep pre-registration (docs/agents/reviews/2026-10-04-polymarket-lp-prereg.md) freezes two statements by
// sha256: its day-1 check and its live readout (docs/agents/backtests/pmlp/lp_*.sql). A statement edited after the
// window opened would read the run on terms nobody pre-registered: this fails on any change to them, on a window that is
// not the document's, on a write, on a read of another test's tables where the document allows none, and on a rule the
// code, the migration and the document do not share (5N, $100 a market, x2's pause, no weather market, ten markets and
// $200, the −$75 stop on the fills and what was paid, no day stop).
import { describe, expect, it } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DOC = fs.readFileSync(path.join(ROOT, 'docs/agents/reviews/2026-10-04-polymarket-lp-prereg.md'), 'utf8');
const read = (f) => fs.readFileSync(path.join(ROOT, 'docs/agents/backtests/pmlp', f));
const FILES = ['lp_check.sql', 'lp_readout.sql'];
const sqlOf = (f) => read(f).toString('utf8').replace(/--[^\n]*/g, '');
/** Every table a statement names after FROM or JOIN, schema-qualified. */
const tablesOf = (sql) => [...new Set([...sql.matchAll(/\b(?:from|join)\s+public\.([a-z_]+)/g)].map((m) => m[1]))].sort();
const src = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

/** The instance's bytes Addendum 2 named (TB1's skip), the rule until Addendum 7. */
const LP_A2 = 'c404d510c0fdeea529c4edba7a314867d6943d18e4bc1e49e82842ef4fcf5eb4';

describe('the live-prep pre-registration', () => {
  it.each(FILES)('names the sha256 of %s, and the statement is that file', (f) => {
    const named = new RegExp('`(?:[\\w./-]*/)?' + f.replace('.', '\\.') + '` sha256\\s+`([0-9a-f]{64})`').exec(DOC)?.[1];
    expect(named).toMatch(/^[0-9a-f]{64}$/);
    expect(crypto.createHash('sha256').update(read(f)).digest('hex')).toBe(named);
  });

  it.each(FILES)('%s is one read-only statement', (f) => {
    const sql = sqlOf(f);
    expect(sql).not.toMatch(/\b(insert|update|delete|alter|drop|create|truncate|grant|revoke|copy|call|do)\b/i);
    expect(sql.replace(/'(?:[^']|'')*'/g, "''").trim().replace(/;\s*$/, '')).not.toContain(';');
    expect(sql.trim()).toMatch(/^with\b/);
  });

  it("reads the document's window: d1, the first full UTC day after pm_lp_config.created_at", () => {
    expect(DOC).toContain('**d1 is the first full UTC day after `pm_lp_config.created_at`**');
    expect(sqlOf('lp_check.sql')).toContain("(date_trunc('day', c.created_at at time zone 'utc') + interval '1 day')");
    expect(sqlOf('lp_check.sql')).toContain("x.w0 + interval '1 day' as w1");
    expect(sqlOf('lp_check.sql')).toContain('from public.pm_lp_config c where c.id = 1');
  });

  it("reads live-prep's own tables and ops_errors; of the others, only mini-pool's and mid-pool's arms, in (f)", () => {
    expect(tablesOf(sqlOf('lp_check.sql'))).toEqual(['ops_errors', 'pm_live_config', 'pm_lp_config', 'pm_lp_events', 'pm_lp_markets', 'pm_lp_minutes', 'pm_lp_orders',
      'pm_lp_state', 'pm_lpprep_days', 'pm_lpprep_state', 'pm_mid_config']);
    expect(tablesOf(sqlOf('lp_readout.sql'))).toEqual(['pm_lp_fills', 'pm_lp_orders', 'pm_lp_reward_days', 'pm_lp_state']);
    for (const f of FILES) expect(sqlOf(f), f).not.toMatch(/pm_rwc?_|pm_prep_|pm_midprep_/);
    expect([...sqlOf('lp_check.sql').matchAll(/public\.pm_(live|mid)_config/g)].length).toBe(2);
    expect(sqlOf('lp_check.sql')).toContain('live_confirmed_at is not null');
  });

  it("names the code it froze, the path's, the layer's and live-prep's instance, and the migration, each by a sha256", () => {
    for (const f of ['pm_live.ts', 'pm_prep.ts', 'pm_lp.ts', '0091_pm_lp.sql']) expect(DOC).toMatch(new RegExp('`' + f.replace('.', '\\.') + '` sha256\\s+`[0-9a-f]{64}`'));
    // The migration is named by its bytes: 0091 is applied once, and a different file would be a different test.
    const mig = /`0091_pm_lp\.sql` sha256\s+`([0-9a-f]{64})`/.exec(DOC)?.[1];
    expect(crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, 'supabase/migrations/0091_pm_lp.sql'))).digest('hex')).toBe(mig);
  });

  it('shares its rules between the code, the migration, the check and the document', () => {
    const lp = src('supabase/functions/agents/pm_lp.ts'), mig = src('supabase/migrations/0091_pm_lp.sql');
    // 5N as frozen, 2N since Addendum 19 (2026-10-13, Davies: "做B…"), which says so.
    expect(lp).toContain('export const PM_LP_INV_CAP = 2;');
    expect(DOC.slice(DOC.indexOf('## Addendum 19'))).toContain('**2N** (`PM_LP_INV_CAP` 5 → 2)');
    expect(lp).toContain('export const PM_LP_CAP_MARKET_USD = 100;');
    expect(lp).toContain('export const PM_LP_PAUSE = { cents: 15, minutes: 60 } as const;');
    // Addendum 12 (2026-10-10) adds the AI markets to what its candidate rules leave out, Addendum 19 the quiet books; the
    // rest is as frozen.
    expect(lp).toContain('export const PM_LP_CANDIDATE: PmCandidateRules = { endHorizon: false, excludeFeeTypes: ["weather_fees"], excludeQuestion: PM_LP_EXCLUDE_AI, quiet: PM_LP_QUIET };');
    expect(DOC.slice(DOC.indexOf('## Addendum 12'))).toContain('由你来决定吧，并且考虑rewards');
    expect(lp).toContain('export const PM_LP_BAND = { floor: RW_MIN_RATE, ceiling: Infinity } as const;');
    expect(mig).toContain('cap_market_usd      numeric not null default 100 check (cap_market_usd > 0 and cap_market_usd <= 100)');
    expect(mig).toContain('loss_day_usd        numeric check (loss_day_usd is null)');
    expect(mig).toContain('loss_total_usd      numeric not null default 75 check (loss_total_usd > 0 and loss_total_usd <= 75)');
    expect(mig).toContain('320, 100, null, 75, 6000, 600, 10, 200');
    expect(mig).toContain('reward_rate    numeric not null check (reward_rate >= 10),');
    expect(DOC).toContain('**5N** its way (RW\'s 3N)');
    expect(DOC).toContain('**$100 a market**');
    expect(DOC).toContain('at most **10 markets\nwithin $200**');
    expect(DOC).toContain('**No day stop**');
    expect(DOC).toContain('no market of Gamma\'s fee type `weather_fees`');
    expect(sqlOf('lp_check.sql')).toContain('5 * od.n - 1e-9');
    expect(sqlOf('lp_check.sql')).toContain('d.scored >= 0.60 * d.rows');
    expect(sqlOf('lp_check.sql')).toContain('e.pnl_day_r40 > -25');
    expect(sqlOf('lp_check.sql')).toContain('f.pusd >= 81');
  });

  it("says RW-C's markets stay in on Davies' own words, and that live-prep arms only on his", () => {
    expect(DOC).toContain('不考虑其他一切因素');
    expect(DOC).toContain('目前上线live的最大candidate是这个live-prep策略');
    expect(DOC).toMatch(/Live-prep goes live only in the\s+conversation where he\s+says go/);
  });

  // Addendum 1 (2026-10-07, Davies: "只算当天变化"): the shared code's day stop changes; live-prep has none, and is
  // unchanged (supabase/functions/agents/pm_lp.test.ts runs it beside the frozen rule and finds every turn the same).
  it("records the day stop of 2026-10-07 in its Addendum 1, in Davies' words: no day stop here, its rules and statements unchanged", () => {
    const add1 = DOC.slice(DOC.indexOf('## Addendum 1'));
    expect(add1.length).toBeGreaterThan(100);
    expect(add1).toContain('> 只算当天变化');
    expect(add1).toContain('**Live-prep has no day stop**');
    for (const f of ['pm_live.ts', 'pm_prep.ts']) expect(add1).toMatch(new RegExp('`' + f.replace('.', '\\.') + '` sha256 `[0-9a-f]{64}`'));
    // Its own instance and migration are the bytes frozen above.
    const sha = (rel) => crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, rel))).digest('hex');
    // Its migration is the bytes frozen above; its instance the bytes Addendum 2 deploys (TB1's skip, 2026-10-08).
    expect(/`pm_lp\.ts` sha256\s+`([0-9a-f]{64})`/.exec(DOC)?.[1]).toBe('bfe38d1c94026641755ed6515b1ae0c91a00c11b4ea80dae3a2f6d6df4d7c3da');
    expect(src('supabase/functions/agents/pm_live.ts')).toContain('const dayOpen = !inst.dayStopOnCost && Number.isFinite(lim.lossDay)');
  });

  // Addendum 2 (2026-10-08, Davies: "给 live-prep 加上 TB1 的 variant-3 规则：盘口只差 1 tick 时不挂单"): TB1's skip at one tick,
  // in live-prep's rule alone (supabase/functions/agents/pm_lp.test.ts pins the rule).
  it("records TB1's skip in its Addendum 2, in Davies' words, and the instance is the bytes it names", () => {
    const add2 = DOC.slice(DOC.indexOf('## Addendum 2'));
    expect(add2.length).toBeGreaterThan(100);
    expect(add2).toContain('> 给 live-prep 加上 TB1 的 variant-3 规则：盘口只差 1 tick 时不挂单');
    // The bytes it named are the rule until Addendum 7 (below), which names what it changed from.
    expect(/`pm_lp\.ts` sha256\s+`([0-9a-f]{64})`/.exec(add2)?.[1]).toBe(LP_A2);
    const lp = src('supabase/functions/agents/pm_lp.ts');
    // Addendum 19 replaced the one-tick skip by a 4 ¢ touch; the one tick stays expressible (`lpRulesOf`) for the tests
    // that pin Addendums 2 to 18.
    expect(lp).toContain('export const PM_LP_TIGHT = { minTouchCents: 4 } as const;');
    expect(lp).toContain('export function lpRulesOf(shape: LpShape)');
    // Since Addendum 16 the skip is the quoting rule's alone (`skip` true); the exit rule of close-only markets skips it.
    expect(lp).toContain('if (skip && ("minTouchCents" in shape.tight ? !wideTouch(row, shape.tight.minTouchCents) : isTight(row, Number(book.tick), shape.tight.maxTicks))) return [];');
    expect(lp).toContain('export const lpQuotes: PmQuoteRule = (input) => lpQuotesOn(input, true, PM_LP_SHAPE);');
  });

  // Addendum 3 (2026-10-08): live-prep against itself; nothing further adopted, the rule the bytes Addendum 2 named.
  it("records the study of live-prep against itself in its Addendum 3: no change adopted, the instance unchanged since Addendum 2", () => {
    const add3 = DOC.slice(DOC.indexOf('## Addendum 3'));
    expect(add3.length).toBeGreaterThan(100);
    expect(add3).toContain('**Nothing passes.**');
    expect(add3).toContain('`docs/agents/backtests/lpself/`');
    const add2 = DOC.slice(DOC.indexOf('## Addendum 2'), DOC.indexOf('## Addendum 3'));
    expect(/`pm_lp\.ts` sha256\s+`([0-9a-f]{64})`/.exec(add2)?.[1]).toBe(LP_A2);
    // No addendum between 3 and 7 names other bytes for the instance: Addendum 7 changes it from Addendum 2's.
    const mid = DOC.slice(DOC.indexOf('## Addendum 3'), DOC.indexOf('## Addendum 7'));
    expect(mid).not.toMatch(/`pm_lp\.ts` sha256/);
    expect(DOC.slice(DOC.indexOf('## Addendum 7'))).toContain('`c404d510…5eb4`');
  });

  // Addendum 7 (2026-10-09, Davies: "加上，但你研究下这个最多买的数值最优的设定后再加，并且以持仓比例来算不是硬数值"): the limit on
  // near-certain buys, a share of the path's capital (supabase/functions/agents/pm_lp.test.ts pins the rule).
  it("records the near-certain limit in its Addendum 7, in Davies' words, and the instance is the bytes it names", () => {
    const add7 = DOC.slice(DOC.indexOf('## Addendum 7'));
    expect(add7).toContain('> 加上，但你研究下这个最多买的数值最优的设定后再加，并且以持仓比例来算不是硬数值');
    expect(add7).toContain('`backtests/rwc_opt/results/expensive_limit.txt`');
    // The bytes it named were the instance until Addendum 9 (the reward check), which names what it changed from.
    expect(/`pm_lp\.ts` sha256\s+`([0-9a-f]{64})`/.exec(add7)?.[1]).toBe('98c060072ebac964df345930122a045a06ec1191f57b094e2dfead928565762c');
    const add9 = DOC.slice(DOC.indexOf('## Addendum 9'), DOC.indexOf('## Addendum 10'));
    expect(add9).toContain('`98c06007…762c`');
    // Addendum 9's bytes were the instance until Addendum 10, which names what it changed from and today's.
    expect(/`pm_lp\.ts` sha256\s+`([0-9a-f]{64})`/.exec(add9)?.[1]).toBe('c7e3a7ec271b8e798dcc756c3f9d83da2421ddee03f3fede6e3e66a541d173c7');
    const add10 = DOC.slice(DOC.indexOf('## Addendum 10'), DOC.indexOf('## Addendum 11'));
    expect(add10).toContain('`c7e3a7ec…73c7`');
    expect(/`pm_lp\.ts` sha256\s+`([0-9a-f]{64})`/.exec(add10)?.[1]).toBe('be8947b58517510dbf91b19ba167a183d6ec20d433a651771e1ba26a9d0356e2');
    const add12 = DOC.slice(DOC.indexOf('## Addendum 12'), DOC.indexOf('## Addendum 13'));
    expect(add12).toContain('`be8947b5…56e2`');
    // Addendum 12's bytes were the instance until Addendum 13 (the refill), which names what it changed from and today's.
    expect(/`pm_lp\.ts` sha256\s+`([0-9a-f]{64})`/.exec(add12)?.[1]).toBe('de26be30aaa06feed4d55397b9d8ce1acafeb9db001f980173550fa1342fd1ed');
    const add13 = DOC.slice(DOC.indexOf('## Addendum 13'), DOC.indexOf('## Addendum 14'));
    expect(add13).toContain('`de26be30…d1ed`');
    // Addendum 13's bytes were the instance until Addendum 14 (the loss guard), which names what it changed from and today's.
    expect(/`pm_lp\.ts` sha256\s+`([0-9a-f]{64})`/.exec(add13)?.[1]).toBe('0a85f529d26a397a26ed3e709ab7477ff71a29531b32212fc3805c05e1a32b25');
    const add14 = DOC.slice(DOC.indexOf('## Addendum 14'), DOC.indexOf('## Addendum 15'));
    expect(add14).toContain('`0a85f529…2b25`');
    // Addendum 14's bytes were the instance until Addendum 15 (the reserve ranked at 00:00), which names what it changed from and today's.
    expect(/`pm_lp\.ts` sha256\s+`([0-9a-f]{64})`/.exec(add14)?.[1]).toBe('a745ca4f7f074a98a320514495f7747184310f300673be80ffb416041f41bc12');
    const add15 = DOC.slice(DOC.indexOf('## Addendum 15'), DOC.indexOf('## Addendum 16'));
    expect(add15).toContain('`a745ca4f…bc12`');
    // Addendum 15's bytes were the instance until Addendum 16 (the exit in a one-tick book), which names what it changed from and today's.
    expect(/`pm_lp\.ts` sha256\s+`([0-9a-f]{64})`/.exec(add15)?.[1]).toBe('277baa7ad0fb7f79e10ef08c0426e873b4de105fbf9deb060f06a96fcd7de8cb');
    const add16 = DOC.slice(DOC.indexOf('## Addendum 16'), DOC.indexOf('## Addendum 17'));
    expect(add16).toContain('`277baa7a…e8cb`');
    // Addendum 16's bytes were the instance until Addendum 17 (the caps in rank order), which names what it changed from and today's.
    expect(/`pm_lp\.ts` sha256\s+`([0-9a-f]{64})`/.exec(add16)?.[1]).toBe('2e5ca3ee27afa6875b899dcf4a163bcd0ce935c9cd8482ee4efa5ba278ad9e3c');
    const add17 = DOC.slice(DOC.indexOf('## Addendum 17'), DOC.indexOf('## Addendum 18'));
    expect(add17).toContain('`2e5ca3ee…9e3c`');
    // Addendum 17's bytes were the instance until Addendum 18 (the refill's cash check, the pause, the stop), which names
    // what it changed from and today's.
    expect(/`pm_lp\.ts` sha256\s+`([0-9a-f]{64})`/.exec(add17)?.[1]).toBe('82d1aa9403dbfd8bbfd4771571a88b53752d186063422d0b684f1934c3e5a850');
    const add18 = DOC.slice(DOC.indexOf('## Addendum 18'), DOC.indexOf('## Addendum 19'));
    expect(add18).toContain('`82d1aa94…a850`');
    // Addendum 18's bytes were the instance until Addendum 19 (quiet books, the restart), which names what it changed from
    // and today's.
    expect(/`pm_lp\.ts` sha256\s+`([0-9a-f]{64})`/.exec(add18)?.[1]).toBe('53f7f788a47e93f52770f96410db9faf8f34cdd7dc2cf4ddbd877c9038d07278');
    const add19 = DOC.slice(DOC.indexOf('## Addendum 19'), DOC.indexOf('## Addendum 20'));
    expect(add19).toContain('`53f7f788…7278`');
    // Addendum 19's bytes were the instance until Addendum 21 (the exit under the 4 ¢ touch), which names what it changed
    // from and today's.
    expect(/`pm_lp\.ts` sha256\s+`([0-9a-f]{64})`/.exec(add19)?.[1]).toBe('08be78270a160003b36ddc3b269072c0c0a37a6fe4b823f2b91d8fc73ad89ac9');
    const add21 = DOC.slice(DOC.indexOf('## Addendum 21'), DOC.indexOf('## Addendum 22'));
    expect(add21).toContain('`08be7827…9ac9`');
    // Addendum 21's bytes were the instance until Addendum 22 (no refills), which names what it changed from and today's.
    expect(/`pm_lp\.ts` sha256\s+`([0-9a-f]{64})`/.exec(add21)?.[1]).toBe('9cc5a4430730f845333b948a6060746af280faeed84e0eb501f1702c1185bd48');
    const add22 = DOC.slice(DOC.indexOf('## Addendum 22'));
    expect(add22).toContain('`9cc5a443…bd48`');
    expect(crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, 'supabase/functions/agents/pm_lp.ts'))).digest('hex')).toBe(/`pm_lp\.ts` sha256\s+`([0-9a-f]{64})`/.exec(add22)?.[1]);
    const lp = src('supabase/functions/agents/pm_lp.ts');
    expect(lp).toContain('export const PM_LP_NEAR_CERTAIN = { minPrice: 0.95, share: 0.08 } as const;');
    expect(lp).toContain('else if (nearCertainBuyOk(bYes, N, held.yes, q.m, capital))');
    expect(lp).toContain('else if (nearCertainBuyOk(aNo, N, held.no, 1 - q.m, capital))');
  });

  // Addendum 4 (2026-10-08): P3 applied; the payouts change is code on main, no longer a pending patch.
  it("records P3 met in its Addendum 4: the payouts change applied, the patch gone from pending, the per-path test present", () => {
    const add4 = DOC.slice(DOC.indexOf('## Addendum 4'));
    expect(add4.length).toBeGreaterThan(100);
    expect(add4).toContain('P3 is met');
    expect(fs.existsSync(path.join(ROOT, 'docs/agents/pending/2026-10-04-mid-pool-payouts-per-path.patch'))).toBe(false);
    expect(fs.existsSync(path.join(ROOT, 'supabase/functions/agents/pm_payouts.test.ts'))).toBe(true);
  });

  // Addendum 18 (2026-10-11, Davies: "同意，这些都按你推荐的来"): the end rule and the readouts read 10-09 like for like, from a
  // corrected copy of the frozen readout (LP-OBS-DEEP's defect 1). The frozen script is unchanged (its sha256 above).
  it("Addendum 18's corrected readout: its bytes, one read-only statement, 10-09 at Addendum 10's like-for-like figures, the rest as frozen", () => {
    const f = 'lp_readout_a18.sql';
    const named = /`docs\/agents\/backtests\/pmlp\/lp_readout_a18\.sql` sha256\s+`([0-9a-f]{64})`/.exec(DOC.slice(DOC.indexOf('## Addendum 18')))?.[1];
    expect(crypto.createHash('sha256').update(read(f)).digest('hex')).toBe(named);
    const sql = sqlOf(f);
    expect(sql).not.toMatch(/\b(insert|update|delete|alter|drop|create|truncate|grant|revoke|copy|call|do)\b/i);
    expect(sql.replace(/'(?:[^']|'')*'/g, "''").trim().replace(/;\s*$/, '')).not.toContain(';');
    expect(sql.trim()).toMatch(/^with\b/);
    expect(tablesOf(sql)).toEqual(tablesOf(sqlOf('lp_readout.sql')));
    // Its 10-09 figures are the view's table (`LP_R_DAY_CORRECTIONS`), market by market: $8.081876 in all.
    const view = src('supabase/functions/agents/pm_lp_live_view.ts');
    const table = Object.fromEntries([...view.slice(view.indexOf('export const LP_R_DAY_CORRECTIONS')).matchAll(/"(0x[0-9a-f]{64})": ([0-9.]+),/g)].slice(0, 10).map((m) => [m[1], Number(m[2])]));
    const corr = Object.fromEntries([...sql.matchAll(/\('(0x[0-9a-f]{64})', ([0-9.]+)\)/g)].map((m) => [m[1], Number(m[2])]));
    expect(corr).toEqual(table);
    expect(Object.values(corr).reduce((a, b) => a + b, 0)).toBeCloseTo(8.081876, 5);                   // rtrue.py's total, to rounding
    expect(sql).toContain("sum(case when r.day = date '2026-10-09' then coalesce(k.formula, r.formula_usd) else r.formula_usd end) as formula");
    expect(sql).toContain('round(sum(n.native + n.sponsored) / nullif(sum(n.formula), 0), 4)');
    expect(sql).toContain('from numbered n where n.n <= 7');
  });

  it("Addendum 18: on the live record of 10-11 01:19 UTC the corrected readout's R is 0.7366, over the end rule's 0.20; the frozen one's 0.1541 was under it", () => {
    const rows = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs/agents/backtests/lpobsdeep/data/reward_days.json'), 'utf8'));
    const corr = Object.fromEntries([...sqlOf('lp_readout_a18.sql').matchAll(/\('(0x[0-9a-f]{64})', ([0-9.]+)\)/g)].map((m) => [m[1], Number(m[2])]));
    // The two statements' arithmetic on these rows: Σ (native + sponsored) ÷ Σ formula, 10-09 corrected or as written.
    const paid = rows.reduce((a, r) => a + Number(r.actual_usd ?? 0) + Number(r.actual_sponsored_usd ?? 0), 0);
    const fixed = rows.reduce((a, r) => a + (r.day === '2026-10-09' && r.cond in corr ? corr[r.cond] : Number(r.formula_usd)), 0);
    const frozen = rows.reduce((a, r) => a + Number(r.formula_usd), 0);
    expect(Math.round((paid / fixed) * 1e4) / 1e4).toBe(0.7366);
    expect(Math.round((paid / frozen) * 1e4) / 1e4).toBe(0.1541);
    expect(paid / fixed).toBeGreaterThanOrEqual(0.2);
    expect(paid / frozen).toBeLessThan(0.2);
    // The production run of the corrected copy (about 02:02 UTC) read the same.
    expect(fs.readFileSync(path.join(ROOT, 'docs/agents/backtests/pmlp/results/lp_readout_a18_2026-10-11.txt'), 'utf8')).toMatch(/R after the first 7 live days .*38\s+21353\s+5306\s+38\.5752\s+28\.4145\s+6\.7922\s+0\.7366/);
  });
});
