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
//   ef036c76…  live-prep's Addendum 13, mid-pool's Addendum 14 (live-prep's refill from a live reserve, 2026-10-10)
//   59a1201a…  live-prep's Addendum 14 (and 15, unchanged), mid-pool's Addendum 15 (live-prep's per-market loss guard, 2026-10-10)
//   b002c558…  live-prep's Addendum 16, mid-pool's Addendum 16 (live-prep's exit in a one-tick book, 2026-10-11)
//   a01c8560…  live-prep's Addendum 17, mid-pool's Addendum 17 (live-prep's caps in rank order, 2026-10-11)
//   ee96ba0e…  live-prep's Addendum 18, mid-pool's Addendum 18 (the refill's cash check, exits through a pause, the stop
//              on the page's TOTAL, 2026-10-11)
//   (Addendum 19's)  live-prep's Addendum 19, mid-pool's Addendum 19 (quiet books, 2N, 90 % of the cap, the stop from a
//              restart; Davies 2026-10-13, no dry-run day)
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
const AEF0 = 'ef036c76a0cc75cf8a9f3bcec2de9e554f0bfb7f44a6b658b89c35aac477c480';
const A59A = '59a1201a35b0ef2ccbdf16de933ea7b4469a1c4404146b252c481aa99068a510';
/** The pm_lp.ts live-prep's Addendum 15 named (the reserve ranked at 00:00), its instance until Addendum 16. */
const LP_A15 = '277baa7ad0fb7f79e10ef08c0426e873b4de105fbf9deb060f06a96fcd7de8cb';
const AB00 = 'b002c55830e0104001eb13715cdabd8e9b83a52d82325bf98e4c10b546c6ba85';
const AA01 = 'a01c8560ccba06356929baab7235ba74071831241426fa38531240cded03778f';
/** The pm_lp.ts live-prep's Addendum 17 named (the caps in rank order), its instance until Addendum 18. */
const LP_A17 = '82d1aa9403dbfd8bbfd4771571a88b53752d186063422d0b684f1934c3e5a850';
/** The pm_lp.ts live-prep's Addendum 16 named (the exit in a one-tick book), its instance until Addendum 17. */
const LP_A16 = '2e5ca3ee27afa6875b899dcf4a163bcd0ce935c9cd8482ee4efa5ba278ad9e3c';
/** The pm_lp.ts live-prep's Addendum 9 named (the reward check), its instance until Addendum 10. */
const LP_A9 = 'c7e3a7ec271b8e798dcc756c3f9d83da2421ddee03f3fede6e3e66a541d173c7';
/** The pm_live.ts and pm_lp.ts live-prep's Addendum 18 named, the path and its instance until Addendum 19. */
const AEE9 = 'ee96ba0e40e38ac9999f78028470cc8713584cf05c45539f265eca76c2d3667d';
const LP_A18 = '53f7f788a47e93f52770f96410db9faf8f34cdd7dc2cf4ddbd877c9038d07278';
/** The pm_live.ts Addendum 19 named (quiet books and the restart), the path until Addendum 20. */
const A289 = '28930ad918b0358c98e6bd6268715c6fd845b6092bcefcd1b44ffd45daf7f43d';

describe("pm_live.ts is the bytes the pre-registrations' latest addenda name", () => {
  it("live-prep's latest addendum (20) and mid-pool's (20) name today's pm_live.ts", () => {
    expect(lastNumber(LP)).toBe(21);
    expect(lastNumber(MID)).toBe(20);
    expect(namedPath(addendum(LP, 21))).toBe(sha);
    expect(namedPath(addendum(LP, 20))).toBe(sha);
    expect(namedPath(addendum(MID, 20))).toBe(sha);
    expect(namedPath(addendum(LP, 19))).toBe(A289);
    expect(namedPath(addendum(MID, 19))).toBe(A289);
    expect(addendum(LP, 20)).toContain('`28930ad9…f43d`');
    expect(addendum(MID, 20)).toContain('`28930ad9…f43d`');
    expect(addendum(MID, 20)).toContain('deviation 20');
    expect(namedPath(addendum(LP, 18))).toBe(AEE9);
    expect(namedPath(addendum(MID, 18))).toBe(AEE9);
    expect(addendum(LP, 19)).toContain('`ee96ba0e…667d`');
    expect(addendum(MID, 19)).toContain('`ee96ba0e…667d`');
    expect(addendum(MID, 19)).toContain('deviation 19');
    expect(namedPath(addendum(LP, 17))).toBe(AA01);
    expect(namedPath(addendum(MID, 17))).toBe(AA01);
    expect(addendum(LP, 18)).toContain('`a01c8560…778f`');
    expect(addendum(MID, 18)).toContain('`a01c8560…778f`');
    expect(addendum(MID, 18)).toContain('deviation 18');
    expect(namedPath(addendum(LP, 16))).toBe(AB00);
    expect(namedPath(addendum(MID, 16))).toBe(AB00);
    expect(addendum(LP, 17)).toContain('`b002c558…ba85`');
    expect(addendum(MID, 17)).toContain('`b002c558…ba85`');
    expect(addendum(MID, 17)).toContain('deviation 17');
    // Live-prep's Addendum 15 changed pm_lp.ts alone: it named pm_live.ts unchanged, as Addendum 14 did.
    expect(namedPath(addendum(LP, 15))).toBe(A59A);
    expect(namedPath(addendum(LP, 14))).toBe(A59A);
    expect(namedPath(addendum(MID, 15))).toBe(A59A);
    expect(addendum(LP, 16)).toContain('`59a1201a…a510`');
    expect(addendum(MID, 16)).toContain('`59a1201a…a510`');
    expect(addendum(MID, 16)).toContain('deviation 16');
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
    expect(namedPath(addendum(LP, 13))).toBe(AEF0);
    expect(namedPath(addendum(MID, 14))).toBe(AEF0);
    expect(addendum(LP, 14)).toContain('`ef036c76…c480`');
    expect(addendum(MID, 15)).toContain('`ef036c76…c480`');
    expect(addendum(MID, 15)).toContain('deviation 15');
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
    // Since Addendum 16 the two calls are `(g.open ? rule : exitRule)(…)` and `exitRule(…)`: still two, each with the capital.
    expect(src.match(/(?:rule|Rule|\))\(\{ market(: m)?, book: b, held, own, capital: lim\.capTotal \}\)/g)?.length).toBe(2);
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
    expect(src.indexOf('lim.capTotal = lpCap.capTotal;')).toBeLessThan(src.indexOf('({ market, book: b, held, own, capital: lim.capTotal })'));
    expect(src.indexOf('lim.capTotal = lpCap.capTotal;')).toBeLessThan(src.indexOf('Rule({ market: m, book: b, held, own, capital: lim.capTotal })'));
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
    expect(src.indexOf('backstop.dropped[m.cond] = { at: nowIso, why };')).toBeLessThan(src.indexOf('({ market, book: b, held, own, capital: lim.capTotal })'));
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
    // The dashboard priced the paper rows at one R, read once (since LP-OBS-DEEP, 2026-10-11, the R over the whole
    // formula). Since 0120 (Davies, 2026-10-13: "目前paper testing里的reward quotes全关了吧？") it sends no paper Reward quotes
    // row, so it reads no R for them: LIVE's row reads its own (`readLpLive`), and the estimate's scored R prices nothing else.
    const idx = read('supabase/functions/agents/index.ts');
    expect(idx).not.toMatch(/lpLiveR\(|atLiveR\(|atProgramme\(/);
    expect(idx).toContain('const lpLive = await readLpLive(d, now);');
    expect(idx).not.toContain('lpLive?.estimate?.r');
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
    // Since 0120 no paper Reward quotes row is on TESTING at all (mid-pool's included); live-prep's paper row left first.
    expect(page).not.toContain('...one(midRow(dash?.prepMid))');
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
    expect(lp13).toContain(line);
    // Addendum 15 changed one of its numbers (`rerankEveryMin` 5 → 1440) and quotes the constant as it was then, word for
    // word; Addendum 18 added one (`minFreeUsd: 20`), on a line of its own.
    expect(lp).toContain(`export const PM_LP_REFILL: LpRefillOptions = {\n  ${line.replace('rerankEveryMin: 5,', 'rerankEveryMin: 1440,')}\n  minFreeUsd: 20,\n};`);
    expect(addendum(LP, 15)).toContain(line.replace('rerankEveryMin: 5,', 'rerankEveryMin: 1440,'));
    expect(lp).toContain('refill: { ...PM_LP_REFILL, table: "pm_lp_reserve" },');
    // The pm_lp.ts it named, the instance until Addendum 14 (the loss guard), which names it.
    expect(/`pm_lp\.ts` sha256\s+`([0-9a-f]{64})`/.exec(lp13)?.[1]).toBe('0a85f529d26a397a26ed3e709ab7477ff71a29531b32212fc3805c05e1a32b25');
    expect(addendum(LP, 14)).toContain('`0a85f529…2b25`');
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

  it("live-prep's Addendum 14 and mid-pool's 15 record the per-market loss guard, its constant and its evidence, and mid-pool unchanged", () => {
    const lp14 = addendum(LP, 14), mid15 = addendum(MID, 15);
    expect(lp14).toContain('`reviews/2026-10-10-lp-refill-and-guards.md`');
    expect(lp14).toContain('`PM_LP_MARKET_LOSS = 10`');
    expect(lp14).toContain('`rerankEveryMin` among them, which waits on\nDavies');
    expect(lp14).toContain('No migration.');
    expect(mid15).toContain('**Mid-pool is unchanged.**');
    const lp = read('supabase/functions/agents/pm_lp.ts');
    expect(lp).toContain('export const PM_LP_MARKET_LOSS = 10;');
    expect(lp).toContain('    marketLoss: PM_LP_MARKET_LOSS,');
    // The pm_lp.ts it named, the instance until Addendum 15 (the reserve ranked at 00:00), which names it and today's.
    expect(/`pm_lp\.ts` sha256\s+`([0-9a-f]{64})`/.exec(lp14)?.[1]).toBe('a745ca4f7f074a98a320514495f7747184310f300673be80ffb416041f41bc12');
    expect(addendum(LP, 15)).toContain('`a745ca4f…bc12`');
    // The pm_lp.ts Addendum 15 named, the instance until Addendum 16 (the exit in a one-tick book), which names it.
    expect(/`pm_lp\.ts` sha256\s+`([0-9a-f]{64})`/.exec(addendum(LP, 15))?.[1]).toBe(LP_A15);
    expect(addendum(LP, 16)).toContain('`277baa7a…e8cb`');
    expect(addendum(LP, 15)).toContain('这个候补名单也要在当天中实时更新比如每分钟之类的');
    expect(addendum(LP, 15)).toContain("**It ships only on\nDavies' word**");
    const src = read(PATH);
    expect(src).toContain('export function lpMarketMark(');
    expect(src).toContain('if (!(mark === null ? !!was : mark <= -limit)) return;');
    // A market held back by the guard alone keeps its slot for the refill.
    expect(src).toContain('const out = (lpOut.has(m.cond) && !guardOnly(m.cond)) || gone.has(m.cond)');
    for (const f of ['pm_mid.ts', 'pm_mini.ts']) if (fs.existsSync(path.join(ROOT, 'supabase/functions/agents', f))) expect(read(`supabase/functions/agents/${f}`)).not.toContain('marketLoss');
  });

  it("live-prep's Addendum 16 and mid-pool's 16 record the exit in a one-tick book: lpQuotes without TB1's skip, for close-only markets only, and mid-pool unchanged", () => {
    const lp16 = addendum(LP, 16), mid16 = addendum(MID, 16);
    expect(lp16).toContain('`reviews/2026-10-11-lp-cap-inventory.md`');
    expect(lp16).toContain('No migration.');
    expect(lp16).toContain('six tokens, 14.7 shares, $8.60 at the mid');
    expect(mid16).toContain('**Mid-pool is unchanged.**');
    // The pm_lp.ts it named, the instance until Addendum 17 (the caps in rank order), which names it.
    expect(/`pm_lp\.ts` sha256\s+`([0-9a-f]{64})`/.exec(lp16)?.[1]).toBe(LP_A16);
    expect(addendum(LP, 17)).toContain('`2e5ca3ee…9e3c`');
    const lp = read('supabase/functions/agents/pm_lp.ts');
    // Since Addendum 19 the rule takes its shape (`PM_LP_SHAPE`: 4 ¢ and 2N; Addendum 18's one tick and 5N through `lpRulesOf`).
    expect(lp).toContain('export const lpQuotes: PmQuoteRule = (input) => lpQuotesOn(input, true, PM_LP_SHAPE);');
    expect(lp).toContain('export const lpExitQuotes: PmQuoteRule = (input) => lpQuotesOn(input, false, PM_LP_SHAPE);');
    expect(lp).toContain('if (skip && ("minTouchCents" in shape.tight ? !wideTouch(row, shape.tight.minTouchCents) : isTight(row, Number(book.tick), shape.tight.maxTicks))) return [];');
    expect(lp).toContain('    exitRule: lpExitQuotes,');
    const src = read(PATH);
    expect(src).toContain('const exitRule = d.rule ?? inst.lp?.exitRule ?? rule;');
    expect(src).toContain('intents = (g.open ? rule : exitRule)({ market, book: b, held, own, capital: lim.capTotal });');
    expect(src).toContain('intents = closeOnly(exitRule({ market: m, book: b, held, own, capital: lim.capTotal }), held, b);');
    for (const f of ['pm_mid.ts', 'pm_mini.ts']) if (fs.existsSync(path.join(ROOT, 'supabase/functions/agents', f))) expect(read(`supabase/functions/agents/${f}`)).not.toContain('exitRule');
  });

  it("live-prep's Addendum 17 and mid-pool's 17 record the caps in rank order, on Davies' word, live-prep's alone", () => {
    const lp17 = addendum(LP, 17), mid17 = addendum(MID, 17);
    expect(lp17).toContain('`reviews/2026-10-11-lp-cap-inventory.md`');
    expect(lp17).toContain("**It ships only on\nDavies' word**");
    expect(lp17).toContain('His answer, 2026-10-11 00:29 UTC, verbatim: "按照你推荐的来" (go with what you recommend)');
    expect(lp17).toContain('No migration.');
    expect(mid17).toContain('**Mid-pool is unchanged.**');
    // The pm_lp.ts it named, the instance until Addendum 18, which names it and today's.
    expect(/`pm_lp\.ts` sha256\s+`([0-9a-f]{64})`/.exec(lp17)?.[1]).toBe(LP_A17);
    expect(addendum(LP, 18)).toContain('`82d1aa94…a850`');
    // The pm_lp.ts Addendum 18 named, the instance until Addendum 19, which names it and today's.
    expect(/`pm_lp\.ts` sha256\s+`([0-9a-f]{64})`/.exec(addendum(LP, 18))?.[1]).toBe(LP_A18);
    expect(addendum(LP, 19)).toContain('`53f7f788…7278`');
    // The pm_lp.ts Addendum 19 named, the instance until Addendum 21, which names it and today's.
    expect(/`pm_lp\.ts` sha256\s+`([0-9a-f]{64})`/.exec(addendum(LP, 19))?.[1]).toBe('08be78270a160003b36ddc3b269072c0c0a37a6fe4b823f2b91d8fc73ad89ac9');
    expect(addendum(LP, 21)).toContain('`08be7827…9ac9`');
    expect(/`pm_lp\.ts` sha256\s+`([0-9a-f]{64})`/.exec(addendum(LP, 21))?.[1]).toBe(crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, 'supabase/functions/agents/pm_lp.ts'))).digest('hex'));
    expect(read('supabase/functions/agents/pm_lp.ts')).toContain('    fundByRank: true,');
    const src = read(PATH);
    expect(src).toContain('if (!inst.lp?.fundByRank) {');
    expect(src).toContain("pair.length > 1 ? `${no[1]}; its market's buys are funded together or not at all` : no[1]");
    for (const f of ['pm_mid.ts', 'pm_mini.ts']) if (fs.existsSync(path.join(ROOT, 'supabase/functions/agents', f))) expect(read(`supabase/functions/agents/${f}`)).not.toContain('fundByRank');
  });

  it("live-prep's Addendum 18 and mid-pool's 18 record the four changes on Davies' word, the $80 kept, live-prep's alone", () => {
    const lp18 = addendum(LP, 18), mid18 = addendum(MID, 18);
    expect(lp18).toContain("**It ships only on\nDavies' word**");
    expect(lp18).toContain('His answer, 2026-10-11 01:41 UTC, verbatim: "同意，这些都按你推荐的来" (agreed, all of these as you recommend), given after the main session laid out LP-CAPDEEP\'s and LP-OBS-DEEP\'s recommendations.');
    for (const r of ['`reviews/2026-10-11-lp-observations-deep.md`', '`reviews/2026-10-11-lp-capital-deep.md`', '**the total cap\'s $80 buffer stays**', '**$8.081876**', '**R 0.7366**', 'No migration.']) expect(lp18).toContain(r);
    expect(mid18).toContain('**Mid-pool is unchanged.**');
    const src = read(PATH), lp = read('supabase/functions/agents/pm_lp.ts');
    expect(src).toContain('const pauseSpares = !!inst.lp?.pauseQuotingOnly && (!m.quoting || lpOut.has(m.cond) || !g.open);');
    expect(src).toContain('if (paused && intents.length && !pauseSpares) {');
    // Since Addendum 19 the fills' part is `stopFills`: `pnl.total` without a restart, the change since it with one.
    expect(src).toContain('const stopBasis = stopFills + (paid ?? 0) + (rebates ?? 0) - (fees ?? 0);');
    expect(src).toContain('let stopFills = pnl.total;');
    expect(src).toContain('const freeUsd = Math.min(lim.capTotal - committed, mode === "live" ? pusdLeft : Infinity);');
    expect(src).toContain('for (const v of fundable ? vacant() : []) {');
    // The cash check comes after the turn's buys are funded and before any candidate is read.
    expect(src.indexOf('const freeUsd = ')).toBeGreaterThan(src.indexOf('const fund = (slot: string'));
    expect(src.indexOf('const freeUsd = ')).toBeLessThan(src.indexOf('const g = await venue.gammaByConditions([cand.cond], false);'));
    expect(lp).toContain('    pauseQuotingOnly: true,\n    stopCountsRebates: true,');
    expect(lp).toContain('export const PM_LP_PAUSE = { cents: 15, minutes: 60 } as const;');
    for (const f of ['pm_mid.ts', 'pm_mini.ts']) if (fs.existsSync(path.join(ROOT, 'supabase/functions/agents', f))) expect(read(`supabase/functions/agents/${f}`)).not.toMatch(/pauseQuotingOnly|stopCountsRebates|minFreeUsd/);
  });

  it("live-prep's Addendum 19 and mid-pool's 19 record quiet books, 2N, 90 % of the cap and the restart, on Davies' word, the dry-run day waived, live-prep's alone", () => {
    const lp19 = addendum(LP, 19), mid19 = addendum(MID, 19);
    expect(lp19).toContain('"做B，不用空跑吧 做好后验证没问题了直接上线吧？"');
    expect(lp19).toContain('2026-10-13 about 01:40 UTC');
    expect(lp19).toContain('**The dry-run day LP-BEST proposed is waived on his word.**');
    for (const r of ['`reviews/2026-10-13-lp-best-strategy.md`', '**at most 50 taker shares in the 24 hours', '**at least 4 ¢**', '**2N**', '**$25**', '**at least $0**',
      '**at least 1.5 ¢ a filled share**', '**no UTC day below −$15**', '**The 7-day end rule**', '**The 14-day readout**', "**The 10-16 re-read of the $80 buffer**",
      'never assumed quiet**', 'update public.pm_lp_config set restarted_at = null where id = 1;']) expect(lp19, r).toContain(r);
    expect(mid19).toContain('**Mid-pool is unchanged.**');
    // The go statement restarts only on a fresh state of this code, keyed in eu-west-1, armed, attested, the others unarmed.
    for (const c of ["s.addendum is distinct from 19", "s.region is distinct from 'eu-west-1'", 'c.live_confirmed_at is null', 'restart_loss_usd = 25, max_markets = 12, select_budget_usd = 320']) expect(lp19, c).toContain(c);
    const mig = read('supabase/migrations/0119_pm_lp_restart.sql');
    expect(lp19).toContain(crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, 'supabase/migrations/0119_pm_lp_restart.sql'))).digest('hex'));
    // 0119 adds two columns to live-prep's config and its CHECK, and writes no row.
    const body = mig.replace(/--[^\n]*/g, '');
    expect([...body.matchAll(/public\.([a-z_]+)/g)].map((m) => m[1]).filter((t, i, a) => a.indexOf(t) === i)).toEqual(['pm_lp_config']);
    expect(body).toContain('check (restart_loss_usd > 0 and restart_loss_usd <= 75)');
    expect(body).not.toMatch(/\b(insert|update|delete)\b/i);
    const src = read(PATH), lp = read('supabase/functions/agents/pm_lp.ts');
    expect(src).toContain('export async function quietChoose<');
    expect(src).toContain('export function quietVerdict(');
    expect(src).toContain('export function lpRestartOf(');
    expect(src).toContain('const restart = inst.lp?.restartable ? lpRestartOf(cfg, lim.lossTotal, d.now) : null;');
    expect(src).toContain('stopTrippedAt = await eventAt("loss_stop_total", restartMinute);');
    expect(lp).toContain('export const PM_LP_INV_CAP = 2;');
    expect(lp).toContain('export const PM_LP_TIGHT = { minTouchCents: 4 } as const;');
    expect(lp).toContain('export const PM_LP_QUIET: PmQuietRule = { maxShares24h: 50, minTouchCents: PM_LP_TIGHT.minTouchCents, maxReads: 150, concurrency: 10 };');
    expect(lp).toContain('export const PM_LP_SELECT_SHARE = 0.9;');
    expect(lp).toContain('    quietRead: lpQuietRead,\n    selectShare: PM_LP_SELECT_SHARE,\n    restartable: true,');
    for (const f of ['pm_mid.ts', 'pm_mini.ts']) if (fs.existsSync(path.join(ROOT, 'supabase/functions/agents', f))) expect(read(`supabase/functions/agents/${f}`)).not.toMatch(/quietRead|selectShare|restartable|quiet:/);
  });
});
