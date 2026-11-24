-- The server's copy of the private region $region of identity $identity (its key), as the region
-- hub keeps it: its head, a snapshot, two entries of its update log, a record it projected and a
-- Loro peer bound to the identity.
UPSERT type::record('_replica_head', $region) SET
  region = $region,
  head = 2,
  covers = 1;
CREATE _replica_snapshot SET
  region = $region,
  bytes = <bytes> 'snapshot',
  version = <bytes> 'version',
  covers = 1;
CREATE _replica_update SET
  region = $region,
  seq = 1,
  bytes = <bytes> 'first';
CREATE _replica_update SET
  region = $region,
  seq = 2,
  bytes = <bytes> 'second';
CREATE type::record('_replica_projected', [$region, 'profile/prf_1']) SET
  region = $region,
  key = 'profile/prf_1';
CREATE type::record('_replica_peer', [$region, '1']) SET
  region = $region,
  peer = '1',
  identity = $identity;
