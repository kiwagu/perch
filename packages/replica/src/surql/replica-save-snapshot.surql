BEGIN TRANSACTION;
-- A document of an earlier generation of the region writes nothing: the device dropped
-- the region's local copy after it opened.
  IF (type::record('_replica_head', $region).generation ?? 0) != $generation {
    THROW 'replica: the region was reset';
  };
-- A snapshot that covers no more rows than the stored one writes nothing: a compaction saving
-- after a later one would replace a snapshot whose rows the later one already dropped.
  IF $covers > (
    (
      SELECT VALUE covers
      FROM _replica_snapshot
      WHERE region = $region
      LIMIT 1
    )[0] ?? 0
  ) {
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
  };
COMMIT TRANSACTION;
