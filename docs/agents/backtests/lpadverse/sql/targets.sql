-- LP-ADVERSE (2026-10-12): the markets whose pm-rec books the study extracts, read-only: every market live-prep selected
-- or filled, RW-C selected or filled, live-prep's paper layer filled, and RW filled since the recorder's first hour; with
-- pm_rec_markets' id (the books lines' `id`), YES token, question, end date, event, neg-risk, fee type and category.
with c as (select cond from pm_lp_markets union select cond from pm_lp_fills union select cond from pm_rwc_selection union select cond from pm_rwc_fills union select cond from pm_lpprep_fills union select cond from pm_rw_fills where minute >= '2026-10-04 19:00')
select jsonb_build_object('pad', repeat('x', 100000), 'ids', (select jsonb_agg(jsonb_build_array(r.id, r.cond, r.yes, r.question, r.end_date, r.event_slug, r.neg_risk, r.fee_type, r.category)) from public.pm_rec_markets r join c using (cond))) payload
