SELECT VALUE version
FROM _replica_update
WHERE
  region = $region
  AND seq = $seq
LIMIT 1;
