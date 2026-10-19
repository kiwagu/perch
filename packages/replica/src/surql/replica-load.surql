SELECT VALUE bytes FROM _replica_snapshot WHERE region = $region LIMIT 1;
SELECT seq, bytes FROM _replica_update WHERE region = $region ORDER BY seq;
SELECT VALUE pulled FROM _replica_cursor WHERE region = $region LIMIT 1;
RETURN type::record('_replica_head', $region).generation ?? 0;
