# F3's two arms that production does not have, as patched COPIES of the production modules (nothing in
# supabase/functions is edited): the copies are written to <gen dir> with their relative imports pointed back at the
# production files, and an import map sends every import of the two originals to them, so quotes_twin.ts, index.ts and
# the rest run unchanged on top. Each patch is read at run time from globalThis.__SCQ_F3 and, with it unset or zero,
# leaves the copy's behaviour the original's (replay.ts checks that the baseline's record is the same either way).
#
#   quotes_live.ts  the exit's price: `exitTicks(fair, side)` plus `offset` ticks in the position's favour (a long sells at
#                   ceil(fair/tick) + offset, a short buys back at floor(fair/tick) - offset), where the exit is placed and
#                   where it is re-priced, as the p50x1 draft says; with `fallbackMin`, an exit whose position has been
#                   open that long goes back to fair (a resting one is re-priced to it on the next turn).
#   revx_sim.ts     the fill assumption: with `fill: "at"`, a print AT a resting order's price fills it too, when the print's
#                   aggressor is on the other side (a seller hitting our bid's price, a buyer lifting our ask's), by its
#                   quantity, as a print through it does; the original fills only on prints strictly through.
#
# python3 -I scripts/patch.py <gen dir>   (writes quotes_live.ts, revx_sim.ts and import_map.json there)
import os, sys, json
here = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(here, '..', '..', '..', '..', '..'))
AG = os.path.join(REPO, 'supabase', 'functions', 'agents')
gen = os.path.abspath(sys.argv[1]); os.makedirs(gen, exist_ok=True)
url = lambda p: 'file://' + p

def absolute(src):
    return src.replace('from "./', f'from "{url(AG)}/').replace('from "../_shared/', f'from "{url(os.path.join(REPO, "supabase", "functions", "_shared"))}/')

def sub(src, old, new, n):
    if src.count(old) != n: raise SystemExit(f'patch anchor found {src.count(old)} times, not {n}: {old[:80]}')
    return src.replace(old, new)

live = open(os.path.join(AG, 'quotes_live.ts')).read()
live = sub(live, 'const ticks = exitTicks(fair, r.side);', 'const ticks = f3ExitTicks(fair, r.side, r.live.openedAt, d.now);', 2)
live = sub(live, 'if (fair == null || staleBook(r.book) || o.fair == null || Math.abs(fair / Number(o.fair) - 1) <= inst.exitReprice) continue;',
           'if (fair == null || staleBook(r.book) || o.fair == null || (Math.abs(fair / Number(o.fair) - 1) <= inst.exitReprice && !f3FallbackDue(o, r.side, r.live.openedAt, d.now))) continue;', 1)
live = absolute(live) + '''
// ---- scq_f3 patch (docs/agents/backtests/scq_f3/scripts/patch.py): the exit offset and its fallback to fair
type F3 = { offset?: number; fallbackMin?: number | null };
const f3 = (): F3 => ((globalThis as unknown as { __SCQ_F3?: F3 }).__SCQ_F3 ?? {});
function f3Fallen(openedAt: number | null, now: number): boolean {
  const c = f3();
  return c.fallbackMin != null && openedAt != null && now - openedAt >= c.fallbackMin * 60e3;
}
function f3ExitTicks(fair: number, side: Side, openedAt: number | null, now: number): number {
  const base = exitTicks(fair, side), off = f3().offset ?? 0;
  if (!off || f3Fallen(openedAt, now)) return base;
  return side === "bid" ? base + off : base - off;
}
function f3FallbackDue(o: { price: number | string; fair: number | string | null }, side: Side, openedAt: number | null, now: number): boolean {
  if (!(f3().offset ?? 0) || !f3Fallen(openedAt, now) || o.fair == null) return false;
  return Math.round(Number(o.price) / QUOTE_TICK) !== exitTicks(Number(o.fair), side);
}
'''
open(os.path.join(gen, 'quotes_live.ts'), 'w').write(live)

sim = open(os.path.join(AG, 'revx_sim.ts')).read()
sim = sub(sim, 'const through = (o: SimOrder) => (o.side === "buy" ? p.ticks < ticksOf(o.price) : p.ticks > ticksOf(o.price));',
          'const atFill = ((globalThis as unknown as { __SCQ_F3?: { fill?: string } }).__SCQ_F3?.fill) === "at";\n'
          '    const through = (o: SimOrder) => (o.side === "buy" ? p.ticks < ticksOf(o.price) || (atFill && p.side === "sell" && p.ticks === ticksOf(o.price))\n'
          '      : p.ticks > ticksOf(o.price) || (atFill && p.side === "buy" && p.ticks === ticksOf(o.price)));', 1)
open(os.path.join(gen, 'revx_sim.ts'), 'w').write(absolute(sim))

json.dump({'imports': {url(os.path.join(AG, 'quotes_live.ts')): url(os.path.join(gen, 'quotes_live.ts')),
                       url(os.path.join(AG, 'revx_sim.ts')): url(os.path.join(gen, 'revx_sim.ts'))}},
          open(os.path.join(gen, 'import_map.json'), 'w'), indent=1)
print(gen)
