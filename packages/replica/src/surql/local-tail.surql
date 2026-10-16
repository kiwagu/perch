SELECT
  seq,
  bytes
FROM _replica_update
WHERE
  region = $region
  AND seq > $after
ORDER BY seq;
