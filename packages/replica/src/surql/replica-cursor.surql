BEGIN TRANSACTION;
-- A document of an earlier generation of the region writes nothing: the device dropped
-- the region's local copy after it opened.
  IF (type::record('_replica_head', $region).generation ?? 0) != $generation {
    THROW 'replica: the region was reset';
  };
  UPSERT type::record('_replica_cursor', $region) SET
    region = $region,
    pulled = math::max([pulled OR 0, $pulled]);
COMMIT TRANSACTION;
