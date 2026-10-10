-- LP-REFILL (2026-10-10): ../lpself/sql/archive_urls.sql unchanged. Its reply holds signed URLs: it is never written to this folder or committed.
-- LPSELF: every pm-rec archive object with its signed URL, read-only. The URLs open private objects until they expire, so
-- the reply is padded past the connector's inline limit (it is saved to a file, never shown) and scripts/fetch.py reads
-- it and prints none of them. Never commit the reply.
select jsonb_build_object('pad', repeat('x', 300000), 'objects', (select jsonb_agg(jsonb_build_object('kind', kind, 'hour', hour, 'bytes', bytes, 'frames', frames, 'sha256', sha256, 'url', url) order by kind, hour) from public.pm_rec_archive)) payload
