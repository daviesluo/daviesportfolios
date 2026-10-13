-- LP-BEST (2026-10-13): the pm-rec archive objects to download, read-only. Each object's signed URL is read here only to
-- download it into a scratch folder (scripts/fetch.py checks its sha256); the reply is padded so the connector saves it
-- to a file, and neither the reply nor a URL is ever printed or committed. Run once per :kinds (('universe')), and once
-- for the books/prints hours after LP-ADVERSE's download (>= 2026-10-12 22:00) with the 10-13 markets dump.
select jsonb_build_object('pad', repeat('x', 200000), 'rows', (select jsonb_agg(jsonb_build_object('hour', hour, 'kind', kind,
  'sha256', sha256, 'bytes', bytes, 'url', url) order by hour) from public.pm_rec_archive where kind = 'universe')) payload;
select jsonb_build_object('pad', repeat('x', 200000), 'rows', (select jsonb_agg(jsonb_build_object('hour', hour, 'kind', kind,
  'sha256', sha256, 'bytes', bytes, 'url', url) order by kind, hour) from public.pm_rec_archive
  where (kind in ('books', 'prints') and hour >= '2026-10-12 22:00') or (kind = 'markets' and hour >= '2026-10-13'))) payload;
