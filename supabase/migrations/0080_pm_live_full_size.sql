-- 0080: Polymarket's order path runs its dry-run at the $400 deposit's full size from now, and nothing arms it but
-- Davies' own word.
--
-- On whose word. Davies, 2026-10-02 (UTC), choosing option B of the two put to him that night ("B. 现在就切：今天纸面
-- 就是 8 个市场。但这次测试按规则判 FAIL，10-03 全天重测，上线最早推迟到 10-04 00:15，上线即 8 个市场。"), verbatim:
--
--   现在就切 全功率320刀，并且什么时候上线我说了算不自动转了
--
-- In English: switch now, at full power, $320; and when it goes live is my call, it no longer goes live by itself.
--
-- What it sets. The design's phase 2 (docs/agents/reviews/2026-10-01-polymarket-live-calibration.md, step 15): eight
-- markets a UTC day and $160 of first-quote capital, under the total cap the row already holds, $320 (the $400 deposit
-- less the -$75 total stop and $5). Eight is the most that keeps about half of the $320 free for the inventory fills
-- leave (the design's table); the code allows twelve. The design had phase 2 wait for the first live payout; on his
-- word it starts now, in the dry-run, and the path goes live at this size when he says go.
--
-- Today's markets are chosen again now, at this size: the path chooses a UTC day once, on the first turn that finds no
-- row of the day, so 2026-10-02's rows are taken out, as Addendum 1 took out 2026-10-01's placeholders. No foreign key
-- reads `pm_live_markets`; the dry-run orders of a market not chosen again expire within their 600 s; the paper layer
-- keeps each market's tokens in its own state, so a held market stays marked. The delete runs only on 2026-10-02 (UTC),
-- so a late or repeated run removes nothing of another day.
--
-- What it ends. The live-prep pre-registration (docs/agents/reviews/2026-10-01-polymarket-live-prep-prereg.md): a change
-- to these tables inside its window ends the window as FAIL, and the check runs again on the first full UTC day after
-- the change, 2026-10-03 (its Addendum 2, written before that day, with its own frozen check). And, on his word above,
-- no session and no routine runs the go-time statement any more: the check's output is reported to him, and the path
-- goes live only in the conversation where he says go (the design's step 8, word for word, then).
--
-- Only while the row is in dry-run: a live row is never resized by this file.

update public.pm_live_config
   set max_markets = 8, select_budget_usd = 160, updated_at = now()
 where id = 1 and dry_run;

delete from public.pm_live_markets
 where day = date '2026-10-02' and (now() at time zone 'utc')::date = date '2026-10-02';
