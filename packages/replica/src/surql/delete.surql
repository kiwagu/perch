BEGIN TRANSACTION;
  DELETE type::record($table, $key);
  DELETE type::record('_replica_projected', [$region, $entry]);
COMMIT TRANSACTION;
