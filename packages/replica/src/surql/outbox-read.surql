SELECT seq,
bytes
FROM _replica_outbox
WHERE region = $region
ORDER BY seq
LIMIT $limit;
