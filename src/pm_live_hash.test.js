// The shared Polymarket order path (supabase/functions/agents/pm_live.ts) runs live-prep, mini-pool and mid-pool, and each
// pre-registration names the bytes it runs on: a change deployed after a window opened is a deviation its addendum
// records. This fails when pm_live.ts is not the bytes the latest addendum of both live-prep's pre-registration
// (docs/agents/reviews/2026-10-04-polymarket-lp-prereg.md) and mid-pool's
// (docs/agents/reviews/2026-10-02-polymarket-mid-pool-prereg.md) names, so the next change to it cannot reach
// production without one; when an addendum of the chain stops naming what it changed from; and when the code stops
// carrying what they name.
//   57f4b1d7…  live-prep's Addendum 4, mid-pool's Addendum 5 (the payouts per path)
//   a208878b…  live-prep's Addendum 5, mid-pool's Addendum 6 (A6, A7 and the go-live audit's F1, F3–F5, U1)
//   8920e0c2…  live-prep's Addendum 6, mid-pool's Addendum 7 (live-prep's 12,000 POSTs a day, 2026-10-09)
//   749bfcdb…  live-prep's Addendum 7, mid-pool's Addendum 8 (the rule's input carries the path's capital, 2026-10-09)
//   7e3e8c95…  live-prep's Addendum 8, mid-pool's Addendum 9 (live-prep's cap follows its equity, 2026-10-09)
//   e76d0234…  live-prep's Addendum 9, mid-pool's Addendum 10 (live-prep's reward check every minute, 2026-10-10)
//   c990ef3e…  live-prep's Addendum 10, mid-pool's Addendum 11 (live-prep's FUNDED and early readout, 2026-10-10)
//   2ae0e729…  live-prep's Addendum 11, mid-pool's Addendum 12 (FUNDED at once, the paper row off TESTING, 2026-10-10)
//   062ee916…  live-prep's Addendum 12, mid-pool's Addendum 13 (AI markets out, 2026-10-10)
//   (Addendum 13's)  live-prep's Addendum 13, mid-pool's Addendum 14 (live-prep's refill from a live reserve, 2026-10-10)
import { describe, expect, it } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const LP = read('docs/agents/reviews/2026-10-04-polymarket-lp-prereg.md');
const MID = read('docs/agents/reviews/2026-10-02-polymarket-mid-pool-prereg.md');
const PATH = 'supabase/functions/agents/pm_live.ts';
const sha = crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, PATH))).digest('hex');
const heads = (doc) => [...doc.matchAll(/^## Addendum (\d+)\b.*$/gm)];
/** The last `## Addendum N` section's number. */
const lastNumber = (doc) => Number(heads(doc).at(-1)?.[1]);
/** Addendum `n`'s section, to the next heading of its level or the end. */
const addendum = (doc, n) => {
  const hs = heads(doc), i = hs.findIndex((h) => Number(h[1]) === n);
  if (i < 0) return '';
  return doc.slice(hs[i].index, hs[i + 1]?.index ?? doc.length);
};
const namedPath = (text) => /`pm_live\.ts` sha256\s+`([0-9a-f]{64})`/.exec(text)?.[1];
const A208 = 'a208878b0f3b3c70fccee0fef34127ff28fa8fbd96c857e507bb494a88ed2703';
const A892 = '8920e0c25306b85784a9255840bb2144045a78404020370a0d3e83ec4100466a';
const A749 = '749bfcdb2b9170ddc455f18c4a5b691c89450c3bd9c8fd9784ada3d9ef2def09';
const A7E3 = '7e3e8c95823fa9ba3b8b7ca067aa745f41bde5340ed5686b661b4572b31709a3';
/** The pm_lp.ts live-prep's Addendum 7 named (the near-certain limit), its instance until Addendum 9. */
const LP_A7 = '98c060072ebac964df345930122a045a06ec1191f57b094e2dfead928565762c';
const AE76 = 'e76d0234d1b3454d0a4e5b0cdbe7fc1c43f92425626a0d593b91f31035cc6809';
const AC99 = 'c990ef3e3ad2700f5552c7a913e1376b7a1fc08368e7b39bd5589ad865a53616';
const A2AE = '2ae0e7296fd2038fd90bcba61a3daae1e52546fd9f22146789acd5db4a600ca3';
const A062 = '062ee9160c77edafd3c48e36ba3cd4857aed512e4ecc6e0219483818b78d7a50';
/** The pm_lp.ts live-prep's Addendum 9 named (the reward check), its instance until Addendum 10. */
const LP_A9 = 'c7e3a7ec271b8e798dcc756c3f9d83da2421ddee03f3fede6e3e66a541d173c7';

describe("pm_live.ts is the bytes the pre-registrations' latest addenda name", () => {
  it("live-prep's latest addendum (13) and mid-pool's (14) name today's pm_live.ts", () => {
    expect(lastNumber(LP)).toBe(13);
    expect(lastNumber(MID)).toBe(14);
    expect(namedPath(addendum(LP, 13))).toBe(sha);
    expect(namedPath(addendum(MID, 14))).toBe(sha);
  });

  it('each addendum of the chain names what it changed from', () => {
    expect(addendum(LP, 4)).toContain('57f4b1d74b89b76f30fe5060ab4c9431cbe9757f78e4a82cc8d3b9cb81821e40');
    expect(namedPath(addendum(LP, 5))).toBe(A208);
    expect(addendum(LP, 5)).toContain('`57f4b1d7…1e40`');
    expect(addendum(LP, 6)).toContain('`a208878b…2703`');
    expect(namedPath(addendum(MID, 6))).toBe(A208);
    expect(addendum(MID, 6)).toContain('`57f4b1d7…1e40`');
    expect(addendum(MID, 6)).toContain('deviation 6');
    expect(addendum(MID, 7)).toContain('`a208878b…2703`');
    expect(addendum(MID, 7)).toContain('deviation 7');
    expect(namedPath(addendum(LP, 6))).toBe(A892);
    expect(namedPath(addendum(MID, 7))).toBe(A892);
    expect(addendum(LP, 7)).toContain('`8920e0c2…466a`');
    expect(addendum(MID, 8)).toContain('`8920e0c2…466a`');
    expect(addendum(MID, 8)).toContain('deviation 8');
    expect(namedPath(addendum(LP, 7))).toBe(A749);
    expect(namedPath(addendum(MID, 8))).toBe(A749);
    expect(addendum(LP, 8)).toContain('`749bfcdb…ef09`');
    expect(addendum(MID, 9)).toContain('`749bfcdb…ef09`');
    expect(addendum(MID, 9)).toContain('deviation 9');
    expect(namedPath(addendum(LP, 8))).toBe(A7E3);
    expect(namedPath(addendum(MID, 9))).toBe(A7E3);
    expect(addendum(LP, 9)).toContain('`7e3e8c95…09a3`');
    expect(addendum(MID, 10)).toContain('`7e3e8c95…09a3`');
    expect(addendum(MID, 10)).toContain('deviation 10');
    expect(namedPath(addendum(LP, 9))).toBe(AE76);
    expect(namedPath(addendum(MID, 10))).toBe(AE76);
    expect(addendum(LP, 10)).toContain('`e76d0234…6809`');
    expect(addendum(MID, 11)).toContain('`e76d0234…6809`');
    expect(addendum(MID, 11)).toContain('deviation 11');
    expect(namedPath(addendum(LP, 10))).toBe(AC99);
    expect(namedPath(addendum(MID, 11))).toBe(AC99);
    expect(addendum(LP, 11)).toContain('`c990ef3e…3616`');
    expect(addendum(MID, 12)).toContain('`c990ef3e…3616`');
    expect(addendum(MID, 12)).toContain('deviation 12');
    expect(namedPath(addendum(LP, 11))).toBe(A2AE);
    expect(namedPath(addendum(MID, 12))).toBe(A2AE);
    expect(addendum(LP, 12)).toContain('`2ae0e729…0ca3`');
    expect(addendum(MID, 13)).toContain('`2ae0e729…0ca3`');
    expect(addendum(MID, 13)).toContain('deviation 13');
    expect(namedPath(addendum(LP, 12))).toBe(A062);
    expect(namedPath(addendum(MID, 13))).toBe(A062);
    expect(addendum(LP, 13)).toContain('`062ee916…7a50`');
    expect(addendum(MID, 14)).toContain('`062ee916…7a50`');
    expect(addendum(MID, 14)).toContain('deviation 14');
  });

  it("live-prep's Addendum 5 and mid-pool's 6 name every change of the go-live audit, and the dry-run decisions unchanged", () => {
    for (const [doc, label] of [[addendum(LP, 5), 'live-prep'], [addendum(MID, 6), 'mid-pool']]) {
      for (const change of ['A6', 'A7', 'F1', 'F3', 'F4', 'F5', 'U1']) expect(doc, `${label}: ${change}`).toContain(`**${change}`);
      expect(doc, label).toMatch(/dry-run decision/i);
    }
    expect(addendum(LP, 5)).toContain('> 可以按原计划上线 … 期间你再验证一下所有系统和下单等所有上线会用到的细节都确保没有问题');
  });

  it("live-prep's Addendum 6 and mid-pool's 7 record the 12,000 POSTs a day, in Davies' word, live-prep's alone", () => {
    expect(addendum(LP, 6)).toContain('> 同意提到 12000');
    for (const doc of [addendum(LP, 6), addendum(MID, 7)]) {
      expect(doc).toContain('12,000');
      expect(doc).toContain('`0105_pm_lp_posts_12000.sql`');
      expect(doc).toMatch(/dry-run decision/i);
    }
    expect(addendum(MID, 7)).toContain("Mid-pool's governor stays at 6,000");
  });

  it("live-prep's Addendum 7 and mid-pool's 8 record the capital in the rule's input, in Davies' word, and mid-pool unchanged", () => {
    for (const doc of [addendum(LP, 7), addendum(MID, 8)]) expect(doc).toContain('加上，但你研究下这个最多买的数值最优的设定后再加，并且以持仓比例来算不是硬数值');
    expect(addendum(LP, 7)).toContain('**8 % of the path\'s capital**');
    expect(addendum(LP, 7)).toMatch(/dry-run decision/i);
    expect(addendum(MID, 8)).toContain('**Mid-pool is unchanged.**');
    const src = read(PATH), lp = read('supabase/functions/agents/pm_lp.ts');
    // Two calls of the rule, each given the capital: a quoted market's (on the programme its reward check read, Addendum
    // 9) and a carried one's.
    expect(src.match(/rule\(\{ market(: m)?, book: b, held, own, capital: lim\.capTotal \}\)/g)?.length).toBe(2);
    expect(lp).toContain('export const PM_LP_NEAR_CERTAIN = { minPrice: 0.95, share: 0.08 } as const;');
    // The pm_lp.ts the addendum names, the instance until Addendum 9.
    expect(/`pm_lp\.ts` sha256 `([0-9a-f]{64})`/.exec(addendum(LP, 7))?.[1]).toBe(LP_A7);
  });

  it('the code and the migration carry what the addenda name', () => {
    const src = read(PATH);
    expect(src).toContain('.sort((a, b) => a.ts - b.ts || (a.side === b.side ? 0 : a.side === "BUY" ? -1 : 1))');   // A6
    expect(src).toContain('const leaving = new Map<string, number>();');                                           // A7
    expect(src).toContain('export function ctfApproval(');                                                          // F1
    expect(src).toContain('const ctfApproved = inst.lp && mode === "live" ? ctfApproval(ctfAllowances) : undefined;');
    expect(src).toContain('const closeIfExpired = async (o: PmOrderRow, r: PmReply<PmOpenOrder>)');               // F3
    expect(src).toContain('export function bookProtocol(');                                                         // F4
    expect(src).toContain('if (!b || bookProtocol(b) !== null) return null;');
    expect(src).toContain('if (o.state !== "pending" && !unreadable.has(o.id)) await cancel(o, "mode"');              // F5
    expect(src).toContain('export function heldFromBalance(');                                                      // U1
    expect(src).toContain('if (inst.lp && mode === "live") {');
    expect(src).toContain('export const PM_LIVE_MAX_POSTS_DAY = 6000;');                                             // the governor
    expect(src).toContain('export const PM_LP_MAX_POSTS_DAY = 12000;');
    expect(src).toContain('maxPosts: Math.floor(Number.isFinite(p) && p >= 0 ? Math.min(p, PM_LP_MAX_POSTS_DAY) : PM_LP_MAX_POSTS_DAY),');
    const mig = read('supabase/migrations/0105_pm_lp_posts_12000.sql');
    expect(mig).toContain('check (max_posts_day >= 0 and max_posts_day <= 12000)');
    expect(mig).toContain('update public.pm_lp_config set max_posts_day = 12000 where id = 1');
    // It writes live-prep's config alone, and of it the one column.
    expect(mig.replace(/--[^\n]*/g, '')).not.toMatch(/pm_live_config|pm_mid_config|dry_run|live_confirmed_at|cap_total_usd|updated_at/);
  });

  it("live-prep's Addendum 8 and mid-pool's 9 record the cap following the equity, in Davies' word, live-prep's alone", () => {
    expect(addendum(LP, 8)).toContain('> 每天的rewards受益payout之后立马运用资金进策略，你研究一下最好的方式，如果我补充资金的话也可以立马运用资金');
    for (const doc of [addendum(LP, 8), addendum(MID, 9)]) {
      expect(doc).toContain('`0106_pm_lp_reinvest.sql`');
      expect(doc).toContain('`lpCapital`');
    }
    expect(addendum(LP, 8)).toMatch(/No dry-run decision changes/);
    expect(addendum(MID, 9)).toContain("Mid-pool's caps are unchanged");
    const src = read(PATH);
    expect(src).toContain('export function lpCapital(');
    expect(src).toContain('export const PM_LP_CAP_CEILING_USD = 1000;');
    expect(src).toContain('lim.capTotal = lpCap.capTotal;');
    // The cap is set before the rule is asked, so Addendum 7's limit reads the equity's cap.
    expect(src.indexOf('lim.capTotal = lpCap.capTotal;')).toBeLessThan(src.indexOf('rule({ market, book: b, held, own, capital: lim.capTotal })'));
    expect(src.indexOf('lim.capTotal = lpCap.capTotal;')).toBeLessThan(src.indexOf('rule({ market: m, book: b, held, own, capital: lim.capTotal })'));
    const mig = read('supabase/migrations/0106_pm_lp_reinvest.sql');
    expect(mig).toContain('check (cap_ceiling_usd > 0 and cap_ceiling_usd <= 1000)');
    expect(mig).toContain('update public.pm_lp_config set reinvest = true where id = 1');
    // It writes live-prep's config alone, and of it the one column.
    expect(mig.replace(/--[^\n]*/g, '')).not.toMatch(/pm_live_config|pm_mid_config|dry_run|live_confirmed_at|cap_total_usd|updated_at/);
    expect(addendum(LP, 8)).toContain(crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, 'supabase/migrations/0106_pm_lp_reinvest.sql'))).digest('hex'));
  });

  it("live-prep's Addendum 9 and mid-pool's 10 record the reward check every minute, in Davies' word, live-prep's alone", () => {
    const words = '策略每分钟读的时候都检查奖励配置，避免再次出现这种白挂了并且承担风险并且没奖励的事情';
    for (const doc of [addendum(LP, 9), addendum(MID, 10)]) {
      expect(doc).toContain(words);
      expect(doc).toContain('`0111_pm_lp_reward_check.sql`');
      expect(doc).toContain('`lpRewardVerdict`');
    }
    expect(addendum(LP, 9)).toContain('`docs/agents/backtests/lpcfg/`');
    expect(addendum(MID, 10)).toContain('**Mid-pool is unchanged.**');
    const src = read(PATH), lp = read('supabase/functions/agents/pm_lp.ts');
    expect(src).toContain('export function lpRewardVerdict(');
    expect(src).toContain('export function rewardConfigOf(');
    expect(src).toContain('export function scoringStreak(');
    expect(src).toContain('const rc = inst.lp?.rewardCheck;');
    // The check reads before the minute's formula, and the formula and the backstop before the quotes.
    expect(src.indexOf('const rc = inst.lp?.rewardCheck;')).toBeLessThan(src.indexOf('const f = minuteFormula({ rate, v, minSize, levels: b.levels, inBook, quotes });'));
    expect(src.indexOf('backstop.dropped[m.cond] = { at: nowIso, why };')).toBeLessThan(src.indexOf('rule({ market, book: b, held, own, capital: lim.capTotal })'));
    expect(lp).toContain('export const PM_LP_REWARD_CHECK = { staleMs: 5 * 60e3, backstopMinutes: 3 } as const;');
    expect(lp).toContain('rewardCheck: { ...PM_LP_REWARD_CHECK },');
    // The instance and the migration are the bytes Addendum 9 names; the instance changed from Addendum 7's.
    expect(/`pm_lp\.ts` sha256\s+`([0-9a-f]{64})`/.exec(addendum(LP, 9))?.[1]).toBe(LP_A9);
    expect(addendum(LP, 9)).toContain('`98c06007…762c`');
    const mig = read('supabase/migrations/0111_pm_lp_reward_check.sql');
    expect(addendum(LP, 9)).toContain(crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, 'supabase/migrations/0111_pm_lp_reward_check.sql'))).digest('hex'));
    // It touches live-prep's minutes and its live-hours view alone, and of the minutes only the rate's CHECK.
    const body = mig.replace(/--[^\n]*/g, '');
    expect([...body.matchAll(/public\.([a-z_]+)/g)].map((m) => m[1]).filter((t, i, a) => a.indexOf(t) === i).sort()).toEqual(['pm_lp_live_hours', 'pm_lp_minutes']);
    expect(body).toContain('add constraint pm_lp_minutes_rate_check check (rate >= 0)');
    expect(body).not.toMatch(/pm_live_|pm_mid_|insert|update|delete/);
  });

  it("live-prep's Addendum 10 and mid-pool's 11 record FUNDED, the early readout, R for 10-09 and the paper rows at the live R", () => {
    const lp10 = addendum(LP, 10), mid11 = addendum(MID, 11);
    expect(lp10).toContain('子页面中的FUNDED得显示我实际真实投入的钱（应该是402左右）');
    expect(lp10).toContain('确保r更新后所有testing的策略都用这个最新的来算他们的r');
    expect(lp10).toContain('**$402.028365**');
    expect(lp10).toContain('**$6.524180 /\n$8.081876 = 0.807**');
    expect(lp10).toContain('**Every\npre-registered reading keeps the R it froze**');
    for (const doc of [lp10, mid11]) expect(doc).toContain('`lpFunding`');
    expect(mid11).toContain('**Mid-pool is unchanged.**');
    const src = read(PATH), lp = read('supabase/functions/agents/pm_lp.ts');
    expect(src).toContain('export function lpFunding(');
    expect(src).toContain('export const PM_LP_FUNDING = { minMoveUsd: 1, agreeUsd: 0.01, freshMs: 5 * M, quietMs: 3 * 3600e3 + 10 * M } as const;');
    expect(src).toContain('const ro = inst.lp?.readout;');
    expect(lp).toContain('export const PM_LP_READOUT = { fromMs: 5 * 60e3, acceptZeroAfterMs: 3 * 3600e3 } as const;');
    expect(lp).toContain('readout: { ...PM_LP_READOUT },');
    // The pm_lp.ts it named, the instance until Addendum 12 (AI markets out), which names it.
    expect(/`pm_lp\.ts` sha256\s+`([0-9a-f]{64})`/.exec(lp10)?.[1]).toBe('be8947b58517510dbf91b19ba167a183d6ec20d433a651771e1ba26a9d0356e2');
    expect(addendum(LP, 12)).toContain('`be8947b5…56e2`');
    expect(lp10).toContain('`c7e3a7ec…73c7`');
    expect(lp10).toContain(crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, 'supabase/migrations/0113_pm_lp_funding.sql'))).digest('hex'));
    // 0113 widens live-prep's events' kinds by one and touches nothing else.
    const body = read('supabase/migrations/0113_pm_lp_funding.sql').replace(/--[^\n]*/g, '');
    expect([...body.matchAll(/public\.([a-z_]+)/g)].map((m) => m[1]).filter((t, i, a) => a.indexOf(t) === i)).toEqual(['pm_lp_events']);
    expect(body).toContain("'readout', 'funding'");
    // The dashboard prices the paper rows at one R, read once.
    const idx = read('supabase/functions/agents/index.ts');
    expect(idx.match(/lpLiveR\(\[\], now\)/g)?.length).toBe(1);
    expect(idx).toContain('const liveR: LpLiveRPrice = lpLive?.estimate?.r ?? lpLiveR([], now);');
  });

  it("live-prep's Addendum 11 records FUNDED at once and the paper row off TESTING, in Davies' words, the calls kept and why", () => {
    const lp11 = addendum(LP, 11);
    expect(lp11).toContain('live的Reward quotes子页面中FUNDED还是显示的是$322');
    expect(lp11).toContain('testing里Reward quotes live-prep这个可以删了');
    expect(lp11).toContain("**Its\npaper layer's calls stay on**");
    expect(lp11).toContain('`pm_lpprep_days`');
    const src = read(PATH);
    // The first booking needs no quiet hours; a later move does (the quiet check comes after the first booking's return).
    expect(src.indexOf('if (!i.prev) return { next: { depositUsd: round(r)')).toBeLessThan(src.indexOf('if (i.nowMs - i.dayStartMs < PM_LP_FUNDING.quietMs)'));
    expect(src).toContain('if (residual !== null) fundingResidual = { usd: residual, at: nowIso };');
    const page = read('src/agents/agents.js');
    expect(page).toContain('...one(midRow(dash?.prepMid)),\n  ];');
    expect(page).not.toContain('...one(lpRow(dash?.prepLp))');
  });

  it("live-prep's Addendum 13 and mid-pool's 14 record the refill from a live reserve, in Davies' words, and mid-pool unchanged", () => {
    const lp13 = addendum(LP, 13), mid14 = addendum(MID, 14);
    expect(lp13).toContain('现在就做补选吧，不然资金利用率太低了，研究出一套最合理的机制');
    expect(lp13).toContain('这个候补名单也要在当天中实时更新比如每分钟之类的');
    expect(mid14).toContain('**Mid-pool is unchanged.**');
    const lp = read('supabase/functions/agents/pm_lp.ts');
    // The constant the addendum quotes is the instance's, word for word.
    const line = 'afterMin: 15, afterMinAllOut: 0, maxPerDay: 10, perTurn: 1, triesPerTurn: 3, retryMin: 15, reserveSize: 30, refreshTop: 15, rerankEveryMin: 5, idleAlarmMin: 30,';
    expect(lp).toContain(`export const PM_LP_REFILL: LpRefillOptions = {\n  ${line}\n};`);
    expect(lp13).toContain(line);
    expect(lp).toContain('refill: { ...PM_LP_REFILL, table: "pm_lp_reserve" },');
    expect(/`pm_lp\.ts` sha256\s+`([0-9a-f]{64})`/.exec(lp13)?.[1]).toBe(crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, 'supabase/functions/agents/pm_lp.ts'))).digest('hex'));
    expect(lp13).toContain('`de26be30…d1ed`');
    expect(read('supabase/functions/agents/pm_lp_reserve.ts')).toContain('export async function runPmLpReserve(');
    expect(lp13).toContain(crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, 'supabase/migrations/0116_pm_lp_refill.sql'))).digest('hex'));
    // 0116 adds the reserve's table and lease, one event kind and one call, and touches no other path's table.
    const body = read('supabase/migrations/0116_pm_lp_refill.sql').replace(/--[^\n]*/g, '');
    expect(body).not.toMatch(/pm_live_|pm_mid_/);
    expect(body).toContain("'funding', 'refill'");
    expect(body).toContain("'agents?action=pmlpreserve'");
    // Only live-prep's instance keeps a reserve or refills.
    const src = read(PATH);
    expect(src).toContain('const rf = inst.lp?.refill;');
    expect(read('supabase/functions/agents/pm_mid.ts')).not.toContain('refill');
  });
});
