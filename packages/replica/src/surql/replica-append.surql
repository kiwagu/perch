BEGIN TRANSACTION;
-- A document of an earlier generation of the region writes nothing: the device dropped
-- the region's local copy after it opened.
  IF (type::record('_replica_head', $region).generation ?? 0) != $generation {
    THROW 'replica: the region was reset';
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
    bytes = $bytes;
  CREATE _replica_outbox SET
    region = $region,
    seq = $head,
    bytes = $bytes;
  RETURN $head;
COMMIT TRANSACTION;
