-- The rows first, the generation after them: rows read before a reset are checked against the
-- generation they belong to or a later one, never applied under a generation they predate.
SELECT
  seq,
  bytes
FROM _replica_update
WHERE
  region = $region
  AND seq > $after
ORDER BY seq;
RETURN type::record('_replica_head', $region).generation ?? 0;
