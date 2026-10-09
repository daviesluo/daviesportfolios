// The shared Polymarket order path (supabase/functions/agents/pm_live.ts) runs live-prep, mini-pool and mid-pool, and each
// pre-registration names the bytes it runs on: a change deployed after a window opened is a deviation its addendum
// records. This fails when pm_live.ts is not the bytes the latest addendum of both live-prep's pre-registration
// (docs/agents/reviews/2026-10-04-polymarket-lp-prereg.md, Addendum 5) and mid-pool's
// (docs/agents/reviews/2026-10-02-polymarket-mid-pool-prereg.md, Addendum 6) names, so the next change to it cannot
// reach production without one; and when either addendum stops naming the changes since 57f4b1d7… (Addendum 4 and
// Addendum 5 respectively), or the code stops carrying them.
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
/** The last `## Addendum N` section of a document, and its number. */
const lastAddendum = (doc) => {
  const heads = [...doc.matchAll(/^## Addendum (\d+)\b.*$/gm)];
  const last = heads.at(-1);
  return { n: Number(last?.[1]), text: last ? doc.slice(last.index) : '' };
};
const namedPath = (text) => /`pm_live\.ts` sha256\s+`([0-9a-f]{64})`/.exec(text)?.[1];

describe("pm_live.ts is the bytes the pre-registrations' latest addenda name", () => {
  it("live-prep's Addendum 5 names today's pm_live.ts, after Addendum 4's 57f4b1d7…", () => {
    const { n, text } = lastAddendum(LP);
    expect(n).toBe(5);
    expect(namedPath(text)).toBe(sha);
    expect(LP.slice(LP.indexOf('## Addendum 4'), LP.indexOf('## Addendum 5'))).toContain('57f4b1d74b89b76f30fe5060ab4c9431cbe9757f78e4a82cc8d3b9cb81821e40');
    expect(text).toContain('`57f4b1d7…1e40`');
  });

  it("mid-pool's Addendum 6 names the same bytes, as deviation 6, after Addendum 5's 57f4b1d7…", () => {
    const { n, text } = lastAddendum(MID);
    expect(n).toBe(6);
    expect(namedPath(text)).toBe(sha);
    expect(text).toContain('deviation 6');
    expect(text).toContain('`57f4b1d7…1e40`');
  });

  it('both name every change since 57f4b1d7…, and say the dry-run decisions are unchanged', () => {
    for (const [doc, label] of [[lastAddendum(LP).text, 'live-prep'], [lastAddendum(MID).text, 'mid-pool']]) {
      for (const change of ['A6', 'A7', 'F1', 'F3', 'F4', 'F5', 'U1']) expect(doc, `${label}: ${change}`).toContain(`**${change}`);
      expect(doc, label).toMatch(/dry-run decision/i);
    }
    expect(lastAddendum(LP).text).toContain('> 可以按原计划上线 … 期间你再验证一下所有系统和下单等所有上线会用到的细节都确保没有问题');
  });

  it('the code carries each change the addenda name', () => {
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
  });
});
