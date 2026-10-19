BEGIN TRANSACTION;
  -- A peer writes as one identity in a region: the first batch accepted with changes of a peer
  -- binds it to the identity that pushed it, and a batch of another identity that brings
  -- changes of it is refused whole. Checked first, so a refused batch does no other work.
  FOR $peer IN $peers {
    LET $bound = (
      SELECT VALUE identity FROM ONLY type::record('_replica_peer', [$region, $peer])
    );
    IF $bound != NONE AND $bound != $identity {
      THROW string::concat('peer:', $peer);
    };
    IF $bound = NONE {
      CREATE type::record('_replica_peer', [$region, $peer]) SET
        region = $region,
        peer = $peer,
        identity = $identity;
    };
  };
  -- A region writes only its own records: one the region projected (its marker exists), or
  -- one nobody holds yet. An upsert of a record that exists without this region's marker, and
  -- a delete without it, belong to another region and refuse the whole batch.
  -- Deletes run first: a UNIQUE index is checked per statement, so a record the batch
  -- recreates under a new key with the same unique value must be deleted beforehand.
  FOR $row IN $deletes {
    IF !record::exists(type::record('_replica_projected', [$region, $row.entry])) {
      THROW string::concat('ownership:', $row.entry);
    };
    DELETE type::record($row.table, $row.key);
    DELETE type::record('_replica_projected', [$region, $row.entry]);
  };
  FOR $row IN $upserts {
    IF record::exists(type::record($row.table, $row.key))
      AND !record::exists(type::record('_replica_projected', [$region, $row.entry])) {
      THROW string::concat('ownership:', $row.entry);
    };
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
