SELECT VALUE count() FROM _replica_snapshot WHERE region = $region GROUP ALL;
SELECT VALUE count() FROM _replica_update WHERE region = $region GROUP ALL;
SELECT VALUE count() FROM _replica_outbox WHERE region = $region GROUP ALL;
