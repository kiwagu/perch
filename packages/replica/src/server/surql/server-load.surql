-- One transaction, so a compaction running meanwhile cannot drop rows the snapshot read here lacks.
BEGIN TRANSACTION;
  SELECT VALUE bytes FROM _replica_snapshot WHERE region = $region LIMIT 1;
  SELECT seq, bytes FROM _replica_update WHERE region = $region ORDER BY seq;
COMMIT TRANSACTION;
