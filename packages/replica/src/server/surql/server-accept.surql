BEGIN TRANSACTION;
  -- Deletes run first: a UNIQUE index is checked per statement, so a record the batch
  -- recreates under a new key with the same unique value must be deleted beforehand.
  FOR $row IN $deletes {
    DELETE type::record($row.table, $row.key);
    DELETE type::record('_replica_projected', [$region, $row.entry]);
  };
  FOR $row IN $upserts {
    UPSERT type::record($row.table, $row.key) CONTENT $row.data;
    UPSERT type::record('_replica_projected', [$region, $row.entry]) SET
      region = $region,
      key = $row.entry;
  };
  LET $head = (
    UPSERT type::record('_replica_head', $region) SET
      region = $region,
      head = (
        head OR 0
      ) + 1
    RETURN VALUE head
  )[0];
  CREATE _replica_update SET
    region = $region,
    seq = $head,
    bytes = $bytes,
    version = $version;
  RETURN $head;
COMMIT TRANSACTION;
