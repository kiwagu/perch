SELECT VALUE bytes FROM _replica_snapshot WHERE region = $region LIMIT 1;
SELECT seq, bytes FROM _replica_update WHERE region = $region ORDER BY seq;
SELECT VALUE seq
FROM _replica_outbox
WHERE region = $region
ORDER BY seq DESC
LIMIT 1;
