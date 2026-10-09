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

describe("pm_live.ts is the bytes the pre-registrations' latest addenda name", () => {
  it("live-prep's latest addendum (8) and mid-pool's (9) name today's pm_live.ts", () => {
    expect(lastNumber(LP)).toBe(8);
    expect(lastNumber(MID)).toBe(9);
    expect(namedPath(addendum(LP, 8))).toBe(sha);
    expect(namedPath(addendum(MID, 9))).toBe(sha);
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
    expect(src.match(/rule\(\{ market: m, book: b, held, own, capital: lim\.capTotal \}\)/g)?.length).toBe(2);
    expect(lp).toContain('export const PM_LP_NEAR_CERTAIN = { minPrice: 0.95, share: 0.08 } as const;');
    // The pm_lp.ts the addendum names is today's.
    const lpSha = crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, 'supabase/functions/agents/pm_lp.ts'))).digest('hex');
    expect(/`pm_lp\.ts` sha256 `([0-9a-f]{64})`/.exec(addendum(LP, 7))?.[1]).toBe(lpSha);
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
    expect(src.indexOf('lim.capTotal = lpCap.capTotal;')).toBeLessThan(src.indexOf('rule({ market: m, book: b, held, own, capital: lim.capTotal })'));
    const mig = read('supabase/migrations/0106_pm_lp_reinvest.sql');
    expect(mig).toContain('check (cap_ceiling_usd > 0 and cap_ceiling_usd <= 1000)');
    expect(mig).toContain('update public.pm_lp_config set reinvest = true where id = 1');
    // It writes live-prep's config alone, and of it the one column.
    expect(mig.replace(/--[^\n]*/g, '')).not.toMatch(/pm_live_config|pm_mid_config|dry_run|live_confirmed_at|cap_total_usd|updated_at/);
    expect(addendum(LP, 8)).toContain(crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, 'supabase/migrations/0106_pm_lp_reinvest.sql'))).digest('hex'));
  });
});
