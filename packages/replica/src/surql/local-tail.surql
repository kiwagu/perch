-- The snapshot of a compaction past the rows already read, and the rows after them, in one
-- transaction: a compaction meanwhile cannot drop rows that neither of them holds. The rows first,
-- the generation after them: rows read before a reset are checked against the generation they
-- belong to or a later one, never applied under a generation they predate.
BEGIN TRANSACTION;
  SELECT
    covers,
    bytes
  FROM _replica_snapshot
  WHERE
    region = $region
    AND covers > $after
  LIMIT 1;
  SELECT
    seq,
    bytes
  FROM _replica_update
  WHERE
    region = $region
    AND seq > $after
  ORDER BY seq;
COMMIT TRANSACTION;
RETURN type::record('_replica_head', $region).generation ?? 0;
