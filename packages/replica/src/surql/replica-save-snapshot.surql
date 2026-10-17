BEGIN TRANSACTION;
  DELETE _replica_snapshot WHERE region = $region;
  CREATE _replica_snapshot SET
    region = $region,
    bytes = $bytes,
    version = $version,
    covers = $covers;
  DELETE _replica_update
  WHERE
    region = $region
    AND seq <= $covers;
COMMIT TRANSACTION;
