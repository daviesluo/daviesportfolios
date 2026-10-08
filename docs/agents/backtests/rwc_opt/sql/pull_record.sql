-- RWC-OPT: a run's selections, settlements, engine day rows, prints and fills, read-only. Replace {{p}} with pm_rw (RW) or
-- pm_rwc (RW-C). Run through the Supabase connector; scripts/grab_payload.py writes the payload to data/<run>_record.json.
select jsonb_build_object(
 'selection', (select jsonb_agg(to_jsonb(s) - 'yes' order by day, rank) from public.{{p}}_selection s),
 'settlements', (select jsonb_agg(to_jsonb(s) order by settled_at) from public.{{p}}_settlements s),
 'rwDays', (select jsonb_agg(to_jsonb(d) - 'detail' order by day) from public.{{p}}_days d),
 'state', (select jsonb_build_object('last_minute', last_minute, 'updated_at', updated_at, 'queried', now()) from public.{{p}}_state),
 'prints', (select jsonb_agg(jsonb_build_object('id',id,'cond',cond,'ts',ts,'side',side,'oi',oi,'price',price,'size',size) order by ts, id) from public.{{p}}_prints),
 'fills', (select jsonb_agg(jsonb_build_object('cond',cond,'minute',minute,'ts',ts,'side',side,'price',price,'size',size,'print_id',print_id) order by cond, minute, print_id) from public.{{p}}_fills)
) payload
