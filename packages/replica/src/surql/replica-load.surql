-- One transaction, so a compaction running meanwhile cannot drop rows the snapshot read here lacks.
-- The generation is read before this, apart: see `RegionDoc.open`.
BEGIN TRANSACTION;
  SELECT covers, bytes FROM _replica_snapshot WHERE region = $region LIMIT 1;
  SELECT seq, bytes FROM _replica_update WHERE region = $region ORDER BY seq;
  SELECT VALUE pulled FROM _replica_cursor WHERE region = $region LIMIT 1;
COMMIT TRANSACTION;
