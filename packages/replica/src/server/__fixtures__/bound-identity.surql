-- The identity peer $peer of region $region writes as, or NONE while it is free.
SELECT VALUE identity FROM ONLY type::record('_replica_peer', [$region, $peer]);
