-- Undo a share-count overwrite: SPCX / RKLB / HOOD are held at Trading
-- 212 AND elsewhere, and a sync briefly took the broker's slice as the
-- whole position.
--
-- `0028` widened the T212 sync from two ETFs to every reported position,
-- which is right — it is what brought PLTR's 55 shares back. Shipped
-- with it was a rule that on a ticker's FIRST sync the broker's number
-- replaces the board's, on the reasoning that a board excess was stale
-- data. For this book that reasoning is simply false:
--
--   SPCX   board 130   broker  59   → 71 shares deleted
--   RKLB   board 160   broker 148.5 → 11.5 shares deleted
--   HOOD   board  50   broker  20   → 30 shares deleted
--
-- The excess was never stale. It is the rest of the position, held at
-- another platform, and the board totals were correct all along. The
-- rule is reverted in `applyTrading212` (a board position larger than
-- the broker's keeps its excess, always) with a pin test carrying these
-- exact numbers. This restores the three totals.
--
-- `t212Shares` / `t212Cost` are deliberately LEFT as they are: they now
-- hold the broker's true slice, which is exactly what the delta path
-- needs. After this, `otherShares` computes to 71 / 11.5 / 30 and every
-- later sync moves only the T212 portion.
--
-- `cost` goes back to the blended average across both platforms — the
-- figure the board carried before the overwrite, and the one that
-- matches the owner's own record.
--
-- Lots are untouched. They were already short of the board's share
-- count on most holdings (a long-standing gap; the deposit line stands
-- the residue in at board average cost rather than believing it), and
-- this migration is about the overwrite, not that.
--
-- Version bump: `board_data` uses optimistic concurrency, so without it
-- an open tab would save its stale copy over the repair. Bumping forces
-- that tab into the conflict banner and a reload.
--
-- Idempotent and narrowly guarded: each statement only fires while the
-- board still reads exactly the broker's slice, which is the damage
-- state and nothing else. Applied by `migrations.yml` on push to main —
-- do NOT also run it by hand.

update public.board_data
set data = jsonb_set(
             jsonb_set(data, '{holdings,SPCX,shares}', to_jsonb(130::numeric)),
             '{holdings,SPCX,cost}', to_jsonb(127.840692307692::numeric)
           ),
    version = version + 1,
    updated_at = now()
where id = 1
  and coalesce((data -> 'holdings' -> 'SPCX' ->> 'shares')::numeric, -1)
      = coalesce((data -> 'holdings' -> 'SPCX' ->> 't212Shares')::numeric, -2)
  and coalesce((data -> 'holdings' -> 'SPCX' ->> 'shares')::numeric, 0) < 130;

update public.board_data
set data = jsonb_set(
             jsonb_set(
               data,
               '{holdings,RKLB,shares}', to_jsonb(160::numeric)
             ),
             '{holdings,RKLB,cost}', to_jsonb(65.377125::numeric)
           ),
    updated_at = now()
where id = 1
  and coalesce((data -> 'holdings' -> 'RKLB' ->> 'shares')::numeric, -1)
      = coalesce((data -> 'holdings' -> 'RKLB' ->> 't212Shares')::numeric, -2)
  and coalesce((data -> 'holdings' -> 'RKLB' ->> 'shares')::numeric, 0) < 160;

update public.board_data
set data = jsonb_set(
             jsonb_set(
               data,
               '{holdings,HOOD,shares}', to_jsonb(50::numeric)
             ),
             '{holdings,HOOD,cost}', to_jsonb(85.762::numeric)
           ),
    updated_at = now()
where id = 1
  and coalesce((data -> 'holdings' -> 'HOOD' ->> 'shares')::numeric, -1)
      = coalesce((data -> 'holdings' -> 'HOOD' ->> 't212Shares')::numeric, -2)
  and coalesce((data -> 'holdings' -> 'HOOD' ->> 'shares')::numeric, 0) < 50;
