-- Moves a region's head as a second engine's committed append would.
UPSERT type::record('_replica_head', $region) SET region = $region, head = $head;
