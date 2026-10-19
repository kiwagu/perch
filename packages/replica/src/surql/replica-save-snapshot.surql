BEGIN TRANSACTION;
-- A document of an earlier generation of the region writes nothing: the device dropped
-- the region's local copy after it opened.
  IF (type::record('_replica_head', $region).generation ?? 0) != $generation {
    THROW 'replica: the region was reset';
  };
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
