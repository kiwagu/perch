-- The generation the device holds region $region in (0 until it first dropped its local copy).
RETURN type::record('_replica_head', $region).generation ?? 0;
