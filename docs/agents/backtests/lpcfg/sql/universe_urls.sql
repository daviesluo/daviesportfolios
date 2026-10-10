-- LPCFG: the pm-rec universe objects of 2026-10-08 23:00 to 2026-10-10 00:59 UTC with their signed URLs, read-only. The
-- URLs open private objects until they expire, so the reply is padded past the connector's inline limit (saved to a
-- file, never shown) and ../lpresel6/scripts/fetch.py downloads each, checks its sha256 and prints no URL. Never commit
-- the reply or the objects.
select jsonb_build_object('pad', repeat('x', 300000), 'objects', (select jsonb_agg(jsonb_build_object('kind', kind, 'hour', hour, 'bytes', bytes, 'frames', frames, 'sha256', sha256, 'url', url) order by kind, hour) from public.pm_rec_archive where kind = 'universe' and hour >= '2026-10-08T23:00:00Z' and hour < '2026-10-10T01:00:00Z')) payload
