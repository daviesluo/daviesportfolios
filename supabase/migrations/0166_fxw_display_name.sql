-- 0166: the Agents page's name for the AUD weekend paper book, "AUD weekend (FXW-AUD)", becomes "FXW-AUD weekend"
-- (Davies, 2026-10-29: "“AUD weekend (FXW-AUD)”改名为 FXW-AUD weekend"). The name is display only: `ig_fxw_state.name`
-- is what the page shows, and the `ig` function's `fxw` run (fxw.ts, `FXW.name`) writes the same string on every run
-- (every five minutes), so this row is the new name at once rather than at the next run after the deploy. Guarded by its
-- old value: a row already renamed, or never written, is left as it is. No key, table or call changes.
update public.ig_fxw_state
   set name = 'FXW-AUD weekend'
 where name = 'AUD weekend (FXW-AUD)';
