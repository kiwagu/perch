BEGIN TRANSACTION;
  LET $state = SELECT head,
  covers
  FROM ONLY type::record('_replica_head', $region);
  IF $covers > $state.head {
    THROW 'compaction:beyond-head';
  };
  IF $covers <= $state.covers {
    THROW 'compaction:stale';
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
  UPDATE type::record('_replica_head', $region) SET covers = $covers;
COMMIT TRANSACTION;
