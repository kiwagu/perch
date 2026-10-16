BEGIN TRANSACTION;
  UPSERT type::record($table, $key) CONTENT $data;
  UPSERT type::record('_replica_projected', [$region, $entry]) SET
    region = $region,
    key = $entry;
COMMIT TRANSACTION;
