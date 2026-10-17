UPSERT type::record('_replica_cursor', $region) SET
  region = $region,
  pulled = math::max([pulled OR 0, $pulled]);
