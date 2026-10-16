DELETE _replica_outbox
WHERE
  region = $region
  AND seq <= $seq;
