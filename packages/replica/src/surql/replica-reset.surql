-- Drops the device's local copy of region $region, its snapshot, update log, outbox and
-- cursor, and moves the region to a new generation, in one transaction: a document opened
-- before can then neither write to the log nor read from it. Numbering goes on (the head is
-- not reset), so a row number is never used twice and no tab's watermark skips rows. Deleted
-- with `=`, not `IN`: SurrealDB 3.3.4 deletes nothing for `region IN [...]` on a table whose
-- composite index starts with the region.
BEGIN TRANSACTION;
  LET $generation = (
    UPSERT type::record('_replica_head', $region) SET
      region = $region,
      generation = (
        generation OR 0
      ) + 1
    RETURN VALUE generation
  )[0];
  DELETE _replica_update WHERE region = $region;
  DELETE _replica_outbox WHERE region = $region;
  DELETE _replica_snapshot WHERE region = $region;
  UPSERT type::record('_replica_cursor', $region) SET
    region = $region,
    pulled = 0;
  RETURN $generation;
COMMIT TRANSACTION;
